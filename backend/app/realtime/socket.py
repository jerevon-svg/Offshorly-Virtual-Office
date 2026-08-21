from __future__ import annotations

import logging
from datetime import datetime, timezone

import socketio

from app.auth.atlas import AtlasAuthError, verify_atlas_token
from app.config import settings
from app.database import async_session_maker
from app.repositories import chat as chat_repo
from app.schemas.chat import serialize_message_dict, to_iso_z
from app.services.offline_lineup import OfflineLineup

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


async def _broadcast_offline_lineup() -> None:
    await sio.emit("offline_lineup", {"entries": offline_lineup.snapshot()})


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
            # never trusted, even implicitly.
            message = await chat_repo.insert_message(session, conversation_id, email, text)
            await chat_repo.touch_conversation(session, conversation_id, message.sent_at)
            conv = await chat_repo.get_conversation_by_id(session, conversation_id)
            await session.commit()

        # Freshly-inserted message: nothing delivered/read yet — payload shape always includes
        # deliveredAt/readAt (both null on send), matching serialize_message_dict's defaults.
        message_payload = serialize_message_dict(message, delivered_at=None, read_at=None)
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
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


async def _other_participant_emails(session, conversation_id: str, self_email: str) -> list[str]:
    conv = await chat_repo.get_conversation_by_id(session, conversation_id)
    return [pid for pid in (conv["participant_ids"] if conv else []) if pid != self_email]


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
            await chat_repo.mark_read(session, conversation_id, email, up_to_sent_at)
            count = await chat_repo.unread_count(session, conversation_id, email)
            peers = await _other_participant_emails(session, conversation_id, email)
            await session.commit()

        # "This user's other sockets" — broadcast to every socket for this email except the one
        # that just marked it read, via the per-user room joined at connect time.
        await sio.emit(
            "unread_count", {"conversationId": conversation_id, "count": count}, room=user_room(email), skip_sid=sid
        )
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
            await chat_repo.mark_delivered(session, conversation_id, email, up_to_sent_at)
            peers = await _other_participant_emails(session, conversation_id, email)
            await session.commit()

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
