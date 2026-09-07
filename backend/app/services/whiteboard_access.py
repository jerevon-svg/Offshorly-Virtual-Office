from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import chat as chat_repo

# Whiteboard access — the ONE rule both the REST router (app/routers/whiteboards.py) and the
# realtime join (app/realtime/socket.py whiteboard_join) apply, so the two surfaces can never
# disagree about who may open a board.
#   conversation board → caller is a participant of that conversation (unchanged from W1–W3).
#   room / office board → any authenticated office user. The office is open-plan: rooms have no
#     membership, only presence, and presence is not access (someone in the Dev Team room and
#     someone reviewing the Dev Team board from their desk are equally welcome).
#
# Room ids are the flat room ids the frontend already emits for room presence and room requests
# (office-layout.ts `rooms[]`, e.g. "design-team"); the backend deliberately keeps NO copy of that
# list — room_requests accepts any non-empty id for the same reason — so validation here is the
# same shape check room_requests applies, plus the one server-defined sentinel for the office board.

OFFICE_ROOM_ID = "office"
ROOM_ID_MAX_LEN = 64


def normalize_room_id(raw: str) -> str | None:
    """Trimmed room id, or None when it is not a usable id (empty / too long)."""
    room_id = raw.strip()
    if not room_id or len(room_id) > ROOM_ID_MAX_LEN:
        return None
    return room_id


async def can_access(session: AsyncSession, board: dict[str, Any], email: str) -> bool:
    conversation_id = board.get("conversation_id")
    if conversation_id:
        return await chat_repo.is_participant(session, conversation_id, email)
    # Room-scoped: the CHECK constraint guarantees room_id is set when conversation_id is not.
    return bool(board.get("room_id"))
