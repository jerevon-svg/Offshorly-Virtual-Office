from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

# Whiteboard W3: server-authoritative realtime rooms, one per open board.
#
# WHAT THE SERVER KNOWS: elements are opaque dicts, but every Excalidraw element carries `id`,
# `version` (bumped on each mutation) and `versionNonce` (random tiebreak). That is the whole
# merge rule Excalidraw itself applies client-side in data/reconcile.ts, reproduced in
# `remote_wins` below so server and every client converge on the same winner. Deletions arrive as
# ordinary elements with `isDeleted: true` and a bumped version — TOMBSTONES — and are kept in
# the live room (and in debounced writes) so a late/reconnecting client cannot resurrect them.
# Only the final write when the room empties strips them.
#
# PERSISTENCE: the room is the authority while anyone is in it. Accepted batches mark the room
# dirty and schedule one debounced DB write (`schedule_flush`); the caller supplies the writer,
# which lives in socket.py because that is where DB sessions are opened. `version` bumps on every
# write, so a REST PUT from a client that is NOT in the room still 409s correctly.
#
# Same in-memory/single-process assumption as every other registry in app/realtime/state.py.

EXCALIDRAW_DOCUMENT_TYPE = "excalidraw"
EXCALIDRAW_DOCUMENT_VERSION = 2
EXCALIDRAW_DOCUMENT_SOURCE = "virtual-office-whiteboard"

# Cursor colours, chosen deterministically per email so every client shows the same colour.
_COLLABORATOR_PALETTE = (
    ("#e03131", "#ffc9c9"),
    ("#2f9e44", "#b2f2bb"),
    ("#1971c2", "#a5d8ff"),
    ("#f08c00", "#ffec99"),
    ("#9c36b5", "#eebefa"),
    ("#0c8599", "#99e9f2"),
    ("#e8590c", "#ffd8a8"),
    ("#5f3dc4", "#d0bfff"),
)


def _int(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def remote_wins(local: dict[str, Any] | None, remote: dict[str, Any]) -> bool:
    """Excalidraw's reconcile rule, from the receiver's side: the incoming element replaces the
    local copy when there is no local copy, when its version is higher, or — on an equal
    version — when its versionNonce is LOWER. Lower version, or equal version with a higher
    nonce, keeps the local copy."""
    if local is None:
        return True
    local_version, remote_version = _int(local.get("version")), _int(remote.get("version"))
    if remote_version != local_version:
        return remote_version > local_version
    return _int(remote.get("versionNonce")) < _int(local.get("versionNonce"))


def merge_elements(
    current: dict[str, dict[str, Any]], incoming: list[Any]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Merge `incoming` into `current` (mutated in place, keyed by id). Returns (accepted,
    rejected): accepted are the incoming elements that won and should be broadcast; rejected are
    the CURRENT copies that beat an incoming element, to be sent back to the sender so it
    converges on the room's state. Malformed entries are ignored."""
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for element in incoming:
        if not isinstance(element, dict) or not isinstance(element.get("id"), str) or not element["id"]:
            continue
        local = current.get(element["id"])
        if remote_wins(local, element):
            current[element["id"]] = element
            accepted.append(element)
        elif local is not None:
            rejected.append(local)
    return accepted, rejected


def elements_from_document(
    document: Any,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any], dict[str, Any]]:
    """Split a stored document into (elements by id, appState, files). Anything that is not an
    Excalidraw document — null, or a legacy tldraw snapshot — loads as an empty board; the first
    room write then replaces it, exactly like the editor's "Start fresh"."""
    if not isinstance(document, dict) or document.get("type") != EXCALIDRAW_DOCUMENT_TYPE:
        return {}, {}, {}
    elements: dict[str, dict[str, Any]] = {}
    for element in document.get("elements") or []:
        if isinstance(element, dict) and isinstance(element.get("id"), str):
            elements[element["id"]] = element
    app_state = document.get("appState")
    files = document.get("files")
    return (
        elements,
        app_state if isinstance(app_state, dict) else {},
        files if isinstance(files, dict) else {},
    )


def build_document(
    elements: dict[str, dict[str, Any]],
    app_state: dict[str, Any],
    files: dict[str, Any],
    *,
    include_deleted: bool,
) -> dict[str, Any]:
    """The same Excalidraw file format the editor writes (whiteboardDocument.ts). Tombstones are
    kept while the room is live (include_deleted=True) and dropped on the final write."""
    kept = [el for el in elements.values() if include_deleted or not el.get("isDeleted")]
    return {
        "type": EXCALIDRAW_DOCUMENT_TYPE,
        "version": EXCALIDRAW_DOCUMENT_VERSION,
        "source": EXCALIDRAW_DOCUMENT_SOURCE,
        "elements": kept,
        "appState": app_state,
        "files": files,
    }


def collaborator_color(email: str) -> dict[str, str]:
    digest = hashlib.sha1(email.strip().lower().encode("utf-8")).digest()
    stroke, background = _COLLABORATOR_PALETTE[digest[0] % len(_COLLABORATOR_PALETTE)]
    return {"background": background, "stroke": stroke}


@dataclass
class Collaborator:
    sid: str
    email: str
    username: str

    def wire(self) -> dict[str, Any]:
        return {"sid": self.sid, "email": self.email, "username": self.username, "color": collaborator_color(self.email)}


@dataclass
class WhiteboardRoom:
    board_id: str
    conversation_id: str
    elements: dict[str, dict[str, Any]]
    app_state: dict[str, Any]
    files: dict[str, Any]
    version: int
    members: dict[str, Collaborator] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # Room-local counter of accepted batches; echoed to clients so they can order snapshots.
    seq: int = 0
    dirty: bool = False
    # True once any debounced write landed — the final write must then run even when not dirty,
    # because intermediate writes carried tombstones that the final one strips.
    written: bool = False
    last_editor: str = ""
    flush_task: asyncio.Task | None = None

    def presence(self) -> list[dict[str, Any]]:
        return [member.wire() for member in self.members.values()]

    def snapshot(self) -> dict[str, Any]:
        return {
            "boardId": self.board_id,
            "elements": list(self.elements.values()),
            "appState": self.app_state,
            "files": self.files,
            "version": self.version,
            "seq": self.seq,
            "collaborators": self.presence(),
        }


# Writer supplied by socket.py: persists the room's document (final=True strips tombstones) and
# returns the new DB version.
PersistRoom = Callable[[WhiteboardRoom, bool], Awaitable[int]]


class WhiteboardRoomRegistry:
    def __init__(self, *, flush_delay_seconds: float = 1.0) -> None:
        self.flush_delay_seconds = flush_delay_seconds
        self._rooms: dict[str, WhiteboardRoom] = {}
        self._sid_index: dict[str, str] = {}

    # -- membership -------------------------------------------------------------------------

    def get(self, board_id: str) -> WhiteboardRoom | None:
        return self._rooms.get(board_id)

    def ensure(self, board_id: str, conversation_id: str, document: Any, version: int) -> WhiteboardRoom:
        """Return the live room, creating it from the stored document if nobody has it open.
        Callers load `document`/`version` from the DB first; if another join created the room in
        the meantime, the existing (possibly already edited) room wins."""
        room = self._rooms.get(board_id)
        if room is None:
            elements, app_state, files = elements_from_document(document)
            room = WhiteboardRoom(board_id, conversation_id, elements, app_state, files, version)
            self._rooms[board_id] = room
        return room

    def join(self, room: WhiteboardRoom, sid: str, email: str, username: str) -> None:
        previous = self._sid_index.get(sid)
        if previous is not None and previous != room.board_id:
            self.leave(sid)
        room.members[sid] = Collaborator(sid=sid, email=email, username=username)
        self._sid_index[sid] = room.board_id

    def leave(self, sid: str) -> WhiteboardRoom | None:
        board_id = self._sid_index.pop(sid, None)
        if board_id is None:
            return None
        room = self._rooms.get(board_id)
        if room is not None:
            room.members.pop(sid, None)
        return room

    def room_of(self, sid: str) -> WhiteboardRoom | None:
        board_id = self._sid_index.get(sid)
        return self._rooms.get(board_id) if board_id is not None else None

    # -- elements -------------------------------------------------------------------------------

    async def apply(
        self, room: WhiteboardRoom, incoming: list[Any], *, editor_email: str
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        async with room.lock:
            accepted, rejected = merge_elements(room.elements, incoming)
            if accepted:
                room.seq += 1
                room.dirty = True
                room.last_editor = editor_email
        return accepted, rejected

    # -- persistence ----------------------------------------------------------------------------

    def schedule_flush(self, room: WhiteboardRoom, persist: PersistRoom) -> None:
        """Debounced write: each accepted batch pushes the write back by flush_delay_seconds."""
        if room.flush_task is not None and not room.flush_task.done():
            room.flush_task.cancel()

        async def run() -> None:
            await asyncio.sleep(self.flush_delay_seconds)
            await self.flush(room, persist, final=False)

        room.flush_task = asyncio.create_task(run())

    async def flush(self, room: WhiteboardRoom, persist: PersistRoom, *, final: bool) -> None:
        async with room.lock:
            if not room.dirty and not (final and room.written):
                return
            room.version = await persist(room, final)
            room.dirty = False
            room.written = True

    async def close_if_empty(self, room: WhiteboardRoom, persist: PersistRoom) -> bool:
        """When the last member left: cancel the pending debounce, write the final tombstone-free
        document if anything was ever written, and drop the room. Returns True if closed."""
        if room.members:
            return False
        if room.flush_task is not None and not room.flush_task.done():
            room.flush_task.cancel()
        room.flush_task = None
        await self.flush(room, persist, final=True)
        if self._rooms.get(room.board_id) is room:
            del self._rooms[room.board_id]
        return True

    def reset(self) -> None:
        for room in self._rooms.values():
            if room.flush_task is not None and not room.flush_task.done():
                room.flush_task.cancel()
        self._rooms.clear()
        self._sid_index.clear()
