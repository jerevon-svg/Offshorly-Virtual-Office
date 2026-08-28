from __future__ import annotations

import logging
import math
from datetime import datetime, timezone

import socketio

from app.auth.atlas import AtlasAuthError, verify_atlas_token
from app.config import settings
from app.database import async_session_maker
from app.repositories import chat as chat_repo
from app.repositories import room_requests as room_requests_repo
from app.repositories import talk_requests as talk_requests_repo
from app.schemas.chat import serialize_message_dict, to_iso_z
from app.schemas.room_requests import RoomRequestOut
from app.schemas.talk_requests import TalkRequestOut
from app.services.dnd_registry import DndRegistry
from app.services.offline_lineup import OfflineLineup
from app.services.room_presence import RoomPresenceRegistry
from app.services.spatial_session import SpatialSessionRegistry

# Faithful port of backend/src/socket.ts onto python-socketio's ASGI async server. Mounted in
# app/main.py via socketio.ASGIApp(sio, other_asgi_app=<fastapi app>, socketio_path="socket.io")
# so REST and realtime share one origin — matching the frontend's single
# VITE_CHAT_SOCKET_URL / single socket.io-client `io(socketBase())` call.

_logger = logging.getLogger(__name__)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.cors_origins_list or "*",
)


def user_room(email: str) -> str:
    return f"user:{email}"


# Single shared instance — matches this module's existing pattern of holding shared server
# state as a plain module-level object (see `sio` above), not per-request/per-session state.
# See offline_lineup.py's module docstring for the in-memory/single-process assumption.
offline_lineup = OfflineLineup()

# Ephemeral in-world spatial clustering presence — see spatial_session.py's module docstring
# for the in-memory/single-process assumption. Distinct from the DB-backed Conversation /
# ConversationRequest models from Stage 1/2.
spatial_sessions = SpatialSessionRegistry()

# Ephemeral DND-room-lock feature state — see dnd_registry.py/room_presence.py module
# docstrings. Same in-memory/single-process assumption as the registries above.
dnd_registry = DndRegistry()
room_presence = RoomPresenceRegistry()


async def _broadcast_offline_lineup() -> None:
    await sio.emit("offline_lineup", {"entries": offline_lineup.snapshot()})


async def _broadcast_spatial_sessions() -> None:
    await sio.emit("spatial_sessions", {"sessions": spatial_sessions.snapshot()})


async def _broadcast_dnd_status() -> None:
    await sio.emit("dnd_status", {"emails": dnd_registry.snapshot()})


async def _broadcast_room_presence() -> None:
    await sio.emit("room_presence", {"rooms": room_presence.snapshot()})


def is_room_locked(room_id: str) -> bool:
    """A room is locked iff at least one of its current occupants is DND (feature spec section
    2). Occupancy and DND are two independent ephemeral registries, both populated by explicit
    client emits (room_presence_enter/leave, dnd_set) — combining them here is the single
    source of truth both the REST layer (room_requests router) and the auto-expiry logic below
    use."""
    return any(dnd_registry.is_dnd(email) for email in room_presence.occupants(room_id))


async def _cancel_stale_room_requests(room_id: str | None) -> None:
    """Called after any change that could have unlocked a room (an occupant left, or the last
    DND occupant turned DND off/disconnected). If the room is no longer locked, any pending
    Knock/Request-Entry requests against it are now stale — cancel them and tell each requester
    live (feature spec section 11: "room becomes unlocked while request is pending")."""
    if room_id is None or is_room_locked(room_id):
        return
    async with async_session_maker() as session:
        cancelled = await room_requests_repo.cancel_pending_for_room(session, room_id=room_id)
    for req in cancelled:
        out = RoomRequestOut.from_dict(req)
        await sio.emit(
            "room_request_cancelled", out.model_dump(by_alias=True), room=user_room(req["requester_email"])
        )


async def _cancel_stale_talk_requests(target_email: str) -> None:
    """Called whenever `target_email`'s DND turns off (manual cancel, timer expiry, or
    disconnect). Any still-pending "Request Permission to Talk" against them is now moot —
    cancel it and tell the requester live, same reasoning as _cancel_stale_room_requests."""
    if dnd_registry.is_dnd(target_email):
        return
    async with async_session_maker() as session:
        cancelled = await talk_requests_repo.cancel_pending_for_target(session, target_email=target_email)
    for req in cancelled:
        out = TalkRequestOut.from_dict(req)
        await sio.emit(
            "talk_request_cancelled", out.model_dump(by_alias=True), room=user_room(req["requester_email"])
        )


def _dev_email_from_auth(auth: dict) -> str | None:
    """Dev-only identity bypass for sockets — mirrors http.ts's devEmailFrom / socket.ts's
    devEmailFromHandshake. Hard-gated: only reachable when settings.is_development is literally
    True (fail-closed), regardless of what the client sends."""
    if not settings.is_development:
        return None
    raw = auth.get("x-dev-email") or auth.get("devEmail")
    return raw.strip().lower() if isinstance(raw, str) and raw.strip() else None


def _parse_iso(value: str) -> datetime:
    v = value.strip()
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    dt = datetime.fromisoformat(v)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _is_number(v) -> bool:
    # reject bool (bool is a subclass of int in Python) and non-finite (NaN/Inf) —
    # non-finite coordinates are exactly what caused a hang in the frontend's
    # cluster-geometry code (Stage 1) when they leaked through; reject them here too.
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _is_point(p) -> bool:
    return isinstance(p, dict) and _is_number(p.get("x")) and _is_number(p.get("y"))


def _valid_walk_payload(payload) -> bool:
    if not isinstance(payload, dict):
        return False
    if not _is_point(payload.get("from")):
        return False
    path = payload.get("path")
    if not isinstance(path, list) or not path or len(path) > 64:
        return False
    return all(_is_point(p) for p in path)


async def _emit_unexpected(sid: str, err: Exception) -> None:
    _logger.exception(err)
    await sio.emit("chat_error", {"code": "internal_error", "message": "Unexpected server error"}, to=sid)


@sio.event
async def connect(sid: str, environ: dict, auth: dict | None) -> None:
    auth = auth or {}
    dev_email = _dev_email_from_auth(auth)

    if dev_email:
        email = dev_email
    else:
        token = auth.get("token")
        if not isinstance(token, str) or not token:
            raise ConnectionRefusedError("Missing auth token")
        try:
            email = await verify_atlas_token(token)
        except AtlasAuthError as exc:
            raise ConnectionRefusedError(exc.message) from exc

    await sio.save_session(sid, {"email": email})
    await sio.enter_room(sid, user_room(email))

    # Fire-and-forget-equivalent room bootstrap (mirrors bootstrapRooms in socket.ts): failures
    # here surface as chat_error rather than rejecting the already-established connection.
    try:
        async with async_session_maker() as session:
            conversations = await chat_repo.list_conversations_for_user(session, email)
        for conv in conversations:
            await sio.enter_room(sid, conv["id"])
    except Exception as exc:  # noqa: BLE001 - mirrors emitUnexpected's catch-all
        await _emit_unexpected(sid, exc)

    # A client that connects after others have already checked out must see the current
    # lineup immediately, not just future changes — send it directly to this sid rather than
    # waiting for the next broadcast.
    await sio.emit("offline_lineup", {"entries": offline_lineup.snapshot()}, to=sid)

    # Same reasoning for spatial sessions: a client connecting after a session already exists
    # must see the current grouping immediately, not just future changes.
    await sio.emit("spatial_sessions", {"sessions": spatial_sessions.snapshot()}, to=sid)

    # Same reasoning again for the DND-room-lock feature's two ephemeral registries: a client
    # connecting after others are already DND/in-room must see current lock state immediately.
    await sio.emit("dnd_status", {"emails": dnd_registry.snapshot()}, to=sid)
    await sio.emit("room_presence", {"rooms": room_presence.snapshot()}, to=sid)


@sio.event
async def disconnect(sid: str) -> None:
    # Cleanup ONLY — not a new offline-detection mechanism (v1 is explicit-checkout-only, see
    # go_offline below). A real socket disconnect just means this person's connection is gone;
    # if they had already explicitly checked out and were occupying a slot, free it so it
    # doesn't linger forever for someone who will never emit come_online again this session.
    try:
        session_data = await sio.get_session(sid)
    except KeyError:
        return
    email = session_data.get("email")
    if not email:
        return
    if email in {entry["email"] for entry in offline_lineup.snapshot()}:
        offline_lineup.remove(email)
        await _broadcast_offline_lineup()
    if spatial_sessions.leave(email) is not None:
        await _broadcast_spatial_sessions()
    if dnd_registry.clear(email):
        await _broadcast_dnd_status()
        await _cancel_stale_talk_requests(email)
    left_room_id = room_presence.leave(email)
    if left_room_id is not None:
        await _broadcast_room_presence()
        await _cancel_stale_room_requests(left_room_id)


@sio.on("go_offline")
async def go_offline(sid: str, _payload: dict | None = None) -> None:
    try:
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        offline_lineup.add(email)
        await _broadcast_offline_lineup()
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("come_online")
async def come_online(sid: str, _payload: dict | None = None) -> None:
    try:
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        offline_lineup.remove(email)
        await _broadcast_offline_lineup()
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("spatial_session_start")
async def spatial_session_start(sid: str, payload: dict | None) -> None:
    try:
        payload = payload or {}
        session_id = payload.get("sessionId")
        if not isinstance(session_id, str) or not session_id:
            return
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        spatial_sessions.start(email, session_id)
        await _broadcast_spatial_sessions()
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("spatial_session_leave")
async def spatial_session_leave(sid: str, _payload: dict | None = None) -> None:
    try:
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        left = spatial_sessions.leave(email)
        if left is not None:
            await _broadcast_spatial_sessions()
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("dnd_set")
async def dnd_set(sid: str, payload: dict | None) -> None:
    """Edge-triggered self-DND broadcast — mirrors spatial_session_start's contract exactly:
    call exactly once per real manualStatus transition into/out of DND (see
    frontend/src/services/presence/selfStatusStore.ts), never on a poll. DND was previously
    client-side/localStorage-only with no realtime channel; this is the minimal addition making
    it visible to other clients, which the DND-room-lock feature needs to compute lock state."""
    try:
        payload = payload or {}
        is_dnd = bool(payload.get("isDnd"))
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        changed = dnd_registry.set_dnd(email, is_dnd)
        if not changed:
            return
        await _broadcast_dnd_status()
        if not is_dnd:
            await _cancel_stale_room_requests(room_presence.room_of(email))
            await _cancel_stale_talk_requests(email)
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("room_presence_enter")
async def room_presence_enter(sid: str, payload: dict | None) -> None:
    """Edge-triggered self room-occupancy broadcast — call exactly once per real "entered a new
    flat room" transition (computed client-side from the same flatRoomIdAt() geometry OfficeMap
    already uses for door-choreography, see doorStandPoints.ts), never on a per-frame poll.
    room_id is the flat rects/teamRooms-namespace id (e.g. "design-team")."""
    try:
        payload = payload or {}
        room_id = payload.get("roomId")
        if not isinstance(room_id, str) or not room_id:
            return
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        previous_room_id = room_presence.room_of(email)
        if previous_room_id == room_id:
            return
        room_presence.enter(email, room_id)
        await _broadcast_room_presence()
        await _cancel_stale_room_requests(previous_room_id)
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("room_presence_leave")
async def room_presence_leave(sid: str, _payload: dict | None = None) -> None:
    """Edge-triggered self room-occupancy broadcast — call exactly once when leaving a flat room
    for open floor/corridor (not when crossing directly into another room — use
    room_presence_enter for that, which already replaces the prior membership)."""
    try:
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        left_room_id = room_presence.leave(email)
        if left_room_id is None:
            return
        await _broadcast_room_presence()
        await _cancel_stale_room_requests(left_room_id)
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("walk_started")
async def walk_started(sid: str, payload: dict | None) -> None:
    try:
        if not _valid_walk_payload(payload):
            return  # silent drop on malformed input — matches this codebase's convention
            # (e.g. spatial_session_start's early-return on bad sessionId)
        session_data = await sio.get_session(sid)
        email = session_data["email"]  # server-verified identity ONLY, never payload-supplied
        await sio.emit(
            "peer_walk_started",
            {
                "email": email,
                "from": {"x": payload["from"]["x"], "y": payload["from"]["y"]},
                "path": [{"x": p["x"], "y": p["y"]} for p in payload["path"]],
            },
            skip_sid=sid,
        )
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("walk_arrived")
async def walk_arrived(sid: str, payload: dict | None) -> None:
    try:
        payload = payload or {}
        at = payload.get("at")
        if not _is_point(at):
            return
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        await sio.emit(
            "peer_walk_arrived",
            {"email": email, "at": {"x": at["x"], "y": at["y"]}},
            skip_sid=sid,
        )
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("join_conversation")
async def join_conversation(sid: str, payload: dict | None) -> None:
    try:
        payload = payload or {}
        conversation_id = payload.get("conversationId")
        if not isinstance(conversation_id, str) or not conversation_id:
            return

        session_data = await sio.get_session(sid)
        email = session_data["email"]

        async with async_session_maker() as session:
            ok = await chat_repo.is_participant(session, conversation_id, email)

        if not ok:
            await sio.emit("chat_error", {"code": "forbidden", "message": "Not a participant"}, to=sid)
            return

        await sio.enter_room(sid, conversation_id)
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("send_message")
async def send_message(sid: str, payload: dict | None) -> None:
    try:
        payload = payload or {}
        conversation_id = payload.get("conversationId")
        conversation_id = conversation_id if isinstance(conversation_id, str) else ""
        client_temp_id = payload.get("clientTempId")
        client_temp_id = client_temp_id if isinstance(client_temp_id, str) else ""
        text = payload.get("text")
        text = text.strip() if isinstance(text, str) else ""
        raw_mentions = payload.get("mentionedEmails")
        mentioned_emails = [e for e in raw_mentions if isinstance(e, str)] if isinstance(raw_mentions, list) else None

        if not conversation_id:
            await sio.emit(
                "chat_error", {"code": "invalid_message", "message": "conversationId is required"}, to=sid
            )
            return

        session_data = await sio.get_session(sid)
        email = session_data["email"]

        async with async_session_maker() as session:
            ok = await chat_repo.is_participant(session, conversation_id, email)
            if not ok:
                await sio.emit("chat_error", {"code": "forbidden", "message": "Not a participant"}, to=sid)
                return
            if not text:
                await sio.emit(
                    "chat_error", {"code": "invalid_message", "message": "Message text is empty"}, to=sid
                )
                return

            # Sender is ALWAYS the server-verified session email — a client-sent sender id is
            # never trusted, even implicitly. mentioned_emails is likewise never trusted as-is —
            # insert_message re-validates every candidate against actual participant membership.
            message = await chat_repo.insert_message(
                session, conversation_id, email, text, mentioned_emails=mentioned_emails
            )
            await chat_repo.touch_conversation(session, conversation_id, message.sent_at)
            conv = await chat_repo.get_conversation_by_id(session, conversation_id)
            await session.commit()

        # Freshly-inserted message: nothing delivered/read yet — payload shape always includes
        # deliveredTo/readBy (both empty lists on send), matching serialize_message_dict's
        # per-reader wire format.
        message_payload = serialize_message_dict(message, delivered_to=[], read_by=[])
        await sio.emit("message_saved", {"clientTempId": client_temp_id, "message": message_payload}, to=sid)
        await sio.emit("incoming_message", {"message": message_payload}, room=conversation_id, skip_sid=sid)

        # Push each recipient's (not the sender's) fresh unread count to their own per-user
        # room, so an idle badge updates live without polling.
        recipients = [pid for pid in (conv["participant_ids"] if conv else []) if pid != email]
        for recipient in recipients:
            async with async_session_maker() as recipient_session:
                count = await chat_repo.unread_count(recipient_session, conversation_id, recipient)
            await sio.emit(
                "unread_count", {"conversationId": conversation_id, "count": count}, room=user_room(recipient)
            )
            # @mentions V1: same live-push pattern as unread_count above, purely a count update —
            # this never touches DND state (DndRegistry/talk_requests) and never triggers any
            # notification (none exists in this codebase to trigger — see MessageNotificationBadge/
            # RealChatService), so a mention can never interrupt a DND recipient by itself.
            if message.mentioned_emails and recipient in message.mentioned_emails:
                async with async_session_maker() as mention_session:
                    mentions = await chat_repo.mention_count(mention_session, conversation_id, recipient)
                await sio.emit(
                    "mention_count",
                    {"conversationId": conversation_id, "count": mentions},
                    room=user_room(recipient),
                )
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


async def _other_participant_emails(session, conversation_id: str, self_email: str) -> list[str]:
    conv = await chat_repo.get_conversation_by_id(session, conversation_id)
    return [pid for pid in (conv["participant_ids"] if conv else []) if pid != self_email]


@sio.on("typing")
async def typing(sid: str, payload: dict | None) -> None:
    try:
        payload = payload or {}
        conversation_id = payload.get("conversationId")
        conversation_id = conversation_id if isinstance(conversation_id, str) else ""
        is_typing = bool(payload.get("isTyping"))

        if not conversation_id:
            return

        session_data = await sio.get_session(sid)
        email = session_data["email"]

        async with async_session_maker() as session:
            ok = await chat_repo.is_participant(session, conversation_id, email)
            if not ok:
                await sio.emit("chat_error", {"code": "forbidden", "message": "Not a participant"}, to=sid)
                return

        await sio.emit(
            "peer_typing",
            {"conversationId": conversation_id, "senderEmail": email, "isTyping": is_typing},
            room=conversation_id,
            skip_sid=sid,
        )
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("message_read")
async def message_read(sid: str, payload: dict | None) -> None:
    try:
        payload = payload or {}
        conversation_id = payload.get("conversationId")
        if not isinstance(conversation_id, str) or not conversation_id:
            return
        up_to_raw = payload.get("upToSentAt")
        up_to_sent_at = _parse_iso(up_to_raw) if isinstance(up_to_raw, str) and up_to_raw else datetime.now(
            timezone.utc
        )

        session_data = await sio.get_session(sid)
        email = session_data["email"]

        async with async_session_maker() as session:
            ok = await chat_repo.is_participant(session, conversation_id, email)
            if not ok:
                await sio.emit("chat_error", {"code": "forbidden", "message": "Not a participant"}, to=sid)
                return
            advanced = await chat_repo.mark_read(session, conversation_id, email, up_to_sent_at)
            count = await chat_repo.unread_count(session, conversation_id, email)
            mentions = await chat_repo.mention_count(session, conversation_id, email)
            peers = await _other_participant_emails(session, conversation_id, email)
            await session.commit()

        # "This user's other sockets" — broadcast to every socket for this email except the one
        # that just marked it read, via the per-user room joined at connect time.
        await sio.emit(
            "unread_count", {"conversationId": conversation_id, "count": count}, room=user_room(email), skip_sid=sid
        )
        await sio.emit(
            "mention_count", {"conversationId": conversation_id, "count": mentions}, room=user_room(email), skip_sid=sid
        )
        if not advanced:
            # Watermark didn't actually move (redundant/stale re-ack, or no participant row) —
            # skip the read_receipt fan-out entirely rather than re-emitting a no-op event.
            return
        # Tell the peer(s) — the sender(s) of the messages just marked read — so their UI can
        # advance from "delivered" to "read" without polling.
        for peer in peers:
            await sio.emit(
                "read_receipt",
                {"conversationId": conversation_id, "readUpTo": to_iso_z(up_to_sent_at)},
                room=user_room(peer),
            )
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("message_delivered")
async def message_delivered(sid: str, payload: dict | None) -> None:
    try:
        payload = payload or {}
        conversation_id = payload.get("conversationId")
        if not isinstance(conversation_id, str) or not conversation_id:
            return
        up_to_raw = payload.get("upToSentAt")
        up_to_sent_at = _parse_iso(up_to_raw) if isinstance(up_to_raw, str) and up_to_raw else datetime.now(
            timezone.utc
        )

        session_data = await sio.get_session(sid)
        email = session_data["email"]

        async with async_session_maker() as session:
            ok = await chat_repo.is_participant(session, conversation_id, email)
            if not ok:
                await sio.emit("chat_error", {"code": "forbidden", "message": "Not a participant"}, to=sid)
                return
            advanced = await chat_repo.mark_delivered(session, conversation_id, email, up_to_sent_at)
            peers = await _other_participant_emails(session, conversation_id, email)
            await session.commit()

        if not advanced:
            # Watermark didn't actually move (redundant/stale re-ack, or no participant row) —
            # skip the delivery_receipt fan-out entirely rather than re-emitting a no-op event.
            return
        # Delivery receipt goes to the PEER's room only (the message sender(s) whose messages
        # just got marked delivered) — never back to the acker's own room.
        for peer in peers:
            await sio.emit(
                "delivery_receipt",
                {"conversationId": conversation_id, "deliveredUpTo": to_iso_z(up_to_sent_at)},
                room=user_room(peer),
            )
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)
