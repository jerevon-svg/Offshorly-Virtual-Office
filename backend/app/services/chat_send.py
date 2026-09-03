from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from app.realtime.state import sio, user_room
from app.repositories import chat as chat_repo
from app.schemas.chat import serialize_message_dict

# THE ONE CHAT WRITE PATH. Persist a message and fan it out exactly the way the Socket.IO
# `send_message` handler always has — this module IS that handler's body, lifted out so a
# non-socket caller (a REST endpoint, a later Toucan action) can send through the same
# authorization, persistence, and fan-out instead of growing a parallel path.
#
# What lives here, in order: participant check → non-empty text → insert (which re-validates
# mentions against real participants) → touch conversation → commit → emits. Persistence always
# happens before any emit. Receipts (delivered/read watermarks) are NOT part of sending and stay
# on their own socket events; DND is not consulted, matching the existing chat behavior where a
# message never interrupts a DND recipient by itself (it only bumps counts).
#
# `sender_email` is trusted as given: it must come from a server-verified identity (the socket
# session email or a bearer-derived email), never from a client payload.


class ChatSendError(Exception):
    """A send the caller must surface (bad request / not a participant). `code`/`message` are
    the exact `chat_error` wire strings the socket handler has always emitted."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


async def ensure_participant_sockets_in_room(conversation_id: str, participant_emails: Iterable[str]) -> None:
    """Enter every already-connected socket of each participant into the conversation room.

    A socket joins its conversation rooms on connect (and when the client asks via
    join_conversation), so a conversation created AFTER a participant connected has no live
    sockets in its room until they reconnect. Same migration routers/requests.py does when a
    join_group upgrade mints a new conversation. Idempotent — re-entering a room is a no-op."""
    for email in participant_emails:
        for sid, _ in list(sio.manager.get_participants("/", user_room(email))):
            await sio.enter_room(sid, conversation_id)


async def send_chat_message(
    session: AsyncSession,
    *,
    conversation_id: str,
    sender_email: str,
    text: str,
    mentioned_emails: list[str] | None = None,
    origin_sid: str | None = None,
    client_temp_id: str = "",
    join_participant_sockets: bool = False,
) -> dict:
    """Persist one message from `sender_email` into `conversation_id` and fan it out.

    origin_sid set (a Socket.IO send): `message_saved` echoes to that sid with `client_temp_id`
    and `incoming_message` goes to everyone else in the room — unchanged wire behavior.
    origin_sid None (no originating socket): `incoming_message` goes to the whole room, so the
    sender's own open chat surfaces render the message too, and no `message_saved` is emitted.

    join_participant_sockets: when the conversation may have been created after participants
    connected, migrate their live sockets into the room BEFORE fan-out (see
    ensure_participant_sockets_in_room). Off by default — the socket path never needs it.

    Raises ChatSendError for the caller to surface; returns the serialized saved message."""
    if not conversation_id:
        raise ChatSendError("invalid_message", "conversationId is required")

    ok = await chat_repo.is_participant(session, conversation_id, sender_email)
    if not ok:
        raise ChatSendError("forbidden", "Not a participant")

    text = text.strip() if isinstance(text, str) else ""
    if not text:
        raise ChatSendError("invalid_message", "Message text is empty")

    # Sender is ALWAYS the server-verified identity handed in by the caller. mentioned_emails is
    # never trusted as-is — insert_message re-validates every candidate against membership.
    message = await chat_repo.insert_message(
        session, conversation_id, sender_email, text, mentioned_emails=mentioned_emails
    )
    await chat_repo.touch_conversation(session, conversation_id, message.sent_at)
    conv = await chat_repo.get_conversation_by_id(session, conversation_id)
    await session.commit()

    participant_ids = conv["participant_ids"] if conv else []
    if join_participant_sockets:
        await ensure_participant_sockets_in_room(conversation_id, participant_ids)

    # Freshly-inserted message: nothing delivered/read yet — payload shape always includes
    # deliveredTo/readBy (both empty lists on send), matching serialize_message_dict's
    # per-reader wire format.
    message_payload = serialize_message_dict(message, delivered_to=[], read_by=[])
    if origin_sid is not None:
        await sio.emit(
            "message_saved", {"clientTempId": client_temp_id, "message": message_payload}, to=origin_sid
        )
        await sio.emit("incoming_message", {"message": message_payload}, room=conversation_id, skip_sid=origin_sid)
    else:
        await sio.emit("incoming_message", {"message": message_payload}, room=conversation_id)

    # Push each recipient's (not the sender's) fresh unread count to their own per-user room,
    # so an idle badge updates live without polling.
    sender_key = sender_email.strip().lower()
    recipients = [pid for pid in participant_ids if pid != sender_key]
    for recipient in recipients:
        count = await chat_repo.unread_count(session, conversation_id, recipient)
        await sio.emit("unread_count", {"conversationId": conversation_id, "count": count}, room=user_room(recipient))
        # @mentions V1: same live-push pattern as unread_count above, purely a count update —
        # this never touches DND state and never triggers any notification, so a mention can
        # never interrupt a DND recipient by itself.
        if message.mentioned_emails and recipient in message.mentioned_emails:
            mentions = await chat_repo.mention_count(session, conversation_id, recipient)
            await sio.emit(
                "mention_count",
                {"conversationId": conversation_id, "count": mentions},
                room=user_room(recipient),
            )

    return message_payload


# --- direct-message entry points ---------------------------------------------------------------
# For server-side senders that know WHO they are messaging rather than which conversation: the
# DM is resolved (or created) by the same deterministic dm_key upsert the REST create-conversation
# endpoint uses, then the message goes through send_chat_message above. Because a brand-new DM
# has no live sockets in its room yet, join_participant_sockets is always on here.


async def find_direct_conversation_id(session: AsyncSession, email_a: str, email_b: str) -> str | None:
    """The existing DM between two people, or None. Read-only — creates nothing."""
    return await chat_repo.get_dm_conversation_id(session, email_a, email_b)


async def send_direct_message(
    session: AsyncSession,
    *,
    sender_email: str,
    recipient_email: str,
    text: str,
) -> dict:
    """Upsert the DM between sender and recipient, then send through send_chat_message. The
    sender must be a server-verified identity. Returns the serialized saved message."""
    conv = await chat_repo.upsert_conversation(session, sender_email, recipient_email)
    return await send_chat_message(
        session,
        conversation_id=conv["id"],
        sender_email=sender_email,
        text=text,
        join_participant_sockets=True,
    )
