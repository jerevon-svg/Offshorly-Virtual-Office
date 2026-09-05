from __future__ import annotations

import asyncio
import logging
import math
import re
from datetime import datetime, timezone

from app.auth.atlas import AtlasAuthError, verify_atlas_token
from app.config import settings
from app.database import async_session_maker
from app.repositories import chat as chat_repo
from app.repositories import room_requests as room_requests_repo
from app.repositories import talk_requests as talk_requests_repo
from app.repositories import toucan_activity as toucan_activity_repo
from app.schemas.chat import to_iso_z
from app.schemas.room_requests import RoomRequestOut
from app.schemas.talk_requests import TalkRequestOut
from app.repositories import position as position_repo
# Shared realtime state is CONSTRUCTED in state.py and only imported here — these are the same
# singleton objects the REST routers use (state.spatial_sessions is socket.spatial_sessions).
# Re-exported from this module unchanged so existing `from app.realtime.socket import ...`
# call sites and tests keep working.
from app.realtime.state import (
    call_invites,
    call_registry,
    dnd_registry,
    global_chat_activity,
    is_room_locked,
    offline_lineup,
    room_presence,
    sio,
    spatial_sessions,
    user_room,
)
from app.services.call_invites import INVITE_TTL_SECONDS
from app.services.call_invites import wire as invite_wire
from app.services.chat_assistant import detect_toucan_invocation, schedule_reply
from app.services.chat_delegation import schedule_delegation_reply
from app.services.delegation_lifecycle import mark_owner_returned, schedule_owner_returned
from app.services.chat_send import ChatSendError, is_toucan_sender, send_chat_message
from app.services.position_registry import position_registry
from app.services.quests import EVENT_SPATIAL_SESSION_JOINED, record_quest_event

# Faithful port of backend/src/socket.ts onto python-socketio's ASGI async server. Mounted in
# app/main.py via socketio.ASGIApp(sio, other_asgi_app=<fastapi app>, socketio_path="socket.io")
# so REST and realtime share one origin — matching the frontend's single
# VITE_CHAT_SOCKET_URL / single socket.io-client `io(socketBase())` call.

_logger = logging.getLogger(__name__)


# --- Toucan T2 instrumentation -------------------------------------------------------------
#
# TWO facts, and only two, are written down from this module for the "while you were away"
# layer, because they are the only ones that would otherwise not survive a restart:
#
#   1. WE SAW THIS PERSON ARRIVE OR LEAVE (_record_arrival / _record_departure). Every presence
#      store in this file is an in-memory dict; none of them can answer "when were you last
#      here?" after a redeploy, and no other durable column means it either
#      (employee_positions.updated_at means "last finished walking").
#
#      ARRIVAL is a socket connect or an explicit check-in, and is the only thing that may
#      freeze an absence boundary. DEPARTURE is an explicit checkout OR the moment this person's
#      LAST socket goes away, and only ever records a candidate.
#
#      The last-socket half is what makes "closed the laptop at 17:00 without checking out"
#      measure from 17:00 instead of from whenever that morning's session began. It is gated on
#      _has_another_live_socket, so an individual socket of a multi-socket browser closing is
#      NOT a departure, and a refresh — a departure followed within ABSENCE_GAP_SECONDS by an
#      arrival — records no absence at all.
#
#   2. A RING WENT UNANSWERED (_record_missed_call). Invites live entirely in
#      app/services/call_invites.py's in-memory registry, so a missed call leaves no trace at
#      all once the process restarts — or if the recipient was never connected to begin with,
#      which is exactly the case that matters.
#
# NEITHER IS ALLOWED TO BREAK REALTIME. Both swallow and log their failures: bookkeeping for a
# question the user has not yet asked must never refuse a socket connection, drop a ring, or
# turn into a chat_error. And neither writes a byte of content — see
# app/models/activity_event.py.
#
# NOTHING ELSE IS INSTRUMENTED. Chat and Hub already persist what they need; mirroring them
# here would create a second, silently-diverging answer.


def _has_another_live_socket(email: str, *, excluding_sid: str) -> bool:
    """Does this person still have a socket other than `excluding_sid`?

    REUSES THE EXISTING CONNECTION BOOKKEEPING rather than adding a registry: every socket joins
    its owner's user_room at connect (see the connect handler), which is the same source
    _is_online already treats as the authority on "is this person reachable". Two details make
    it correct to call from inside a disconnect handler:

      * python-socketio triggers this handler BEFORE it removes the sid from its rooms (see
        AsyncServer._handle_disconnect), so the departing socket is still listed — hence
        `excluding_sid`.
      * a sid that is itself mid-disconnect is already excluded by manager.is_connected, which
        consults the pending_disconnect list. Ten sockets closing together therefore do not each
        see the other nine as alive; whichever is genuinely last sees nobody.

    So no heartbeat, no refcount registry, and no timer — the fact is already there to read."""
    for sid, _ in sio.manager.get_participants("/", user_room(email)):
        if sid == excluding_sid:
            continue
        if sio.manager.is_connected(sid, "/"):
            return True
    return False


async def _record_arrival(email: str) -> bool:
    """This person has just turned up. The ONLY event that can freeze an absence boundary —
    see repositories/toucan_activity.py's record_arrival. Returns True only when THIS arrival
    closed a real absence (gap ≥ ABSENCE_GAP_SECONDS) — a refresh, HMR or a network blip
    reconnects inside the gap and returns False."""
    try:
        async with async_session_maker() as session:
            result = await toucan_activity_repo.record_arrival(session, email=email)
            await session.commit()
        return bool(result.get("absence_detected"))
    except Exception:  # never let bookkeeping refuse a connection
        _logger.warning("failed to record arrival for %s", email, exc_info=True)
        return False


async def _record_departure(email: str) -> None:
    """This person has just stopped being here. Records a departure CANDIDATE only; whether it
    turns out to have been a real absence is decided by their next arrival."""
    try:
        async with async_session_maker() as session:
            await toucan_activity_repo.record_departure(session, email=email)
            await session.commit()
    except Exception:  # never let bookkeeping delay a disconnect
        _logger.warning("failed to record departure for %s", email, exc_info=True)


async def _record_missed_call(invite: dict, *, reason: str) -> None:
    """One unanswered ring, recorded against the RECIPIENT — they are the person who missed it,
    and the only person who will ever be able to read it back.

    `reason` is for the log only and is deliberately not stored: "you missed a call" is the fact
    worth keeping, and the difference between a timeout and a hang-up is not something Toucan
    should be repeating back to anyone."""
    try:
        async with async_session_maker() as session:
            await toucan_activity_repo.record_missed_call(
                session,
                subject_email=invite["to_email"],
                actor_email=invite["from_email"],
                reference_id=invite.get("inviteId"),
            )
            await session.commit()
    except Exception:  # a ring must terminate cleanly regardless
        _logger.warning("failed to record missed call (%s)", reason, exc_info=True)


async def _broadcast_offline_lineup() -> None:
    await sio.emit("offline_lineup", {"entries": offline_lineup.snapshot()})


async def _broadcast_spatial_sessions() -> None:
    await sio.emit("spatial_sessions", {"sessions": spatial_sessions.snapshot()})


async def _broadcast_spatial_calls() -> None:
    await sio.emit("spatial_calls", {"calls": call_registry.snapshot()})


async def _broadcast_dnd_status() -> None:
    await sio.emit("dnd_status", {"emails": dnd_registry.snapshot()})


async def _broadcast_global_chat_activity() -> None:
    await sio.emit("global_chat_activity", {"emails": global_chat_activity.snapshot()})


async def _broadcast_room_presence() -> None:
    await sio.emit("room_presence", {"rooms": room_presence.snapshot()})


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


_DEV_EMAIL_RE = re.compile(r"^[^\s?&@]+@[^\s?&@]+\.[^\s?&@]+$")


def _dev_email_from_auth(auth: dict) -> str | None:
    """Dev-only identity bypass for sockets — mirrors http.ts's devEmailFrom / socket.ts's
    devEmailFromHandshake. Hard-gated: only reachable when settings.is_development is literally
    True (fail-closed), regardless of what the client sends.

    A malformed value (e.g. a stray `?devicetier=...` query-string tail from a bad `?as=` URL,
    or anything containing `?`/`&`/whitespace) is rejected outright via ConnectionRefusedError —
    the same path used for a bad Atlas token — rather than silently accepted as a phantom
    identity with no roster layer."""
    if not settings.is_development:
        return None
    raw = auth.get("x-dev-email") or auth.get("devEmail")
    if not isinstance(raw, str) or not raw.strip():
        return None
    candidate = raw.strip().lower()
    if not _DEV_EMAIL_RE.match(candidate):
        raise ConnectionRefusedError("Invalid dev email")
    return candidate


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


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _ms_to_dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


_FACINGS = {"front", "back", "left", "right"}
_MOVE_STATES = {"standing", "sitting"}


def _is_room_id(v) -> bool:
    return v is None or isinstance(v, str)


def _is_movement_id(v) -> bool:
    return isinstance(v, str) and 1 <= len(v) <= 64


def _valid_walk_started_payload(payload) -> bool:
    if not isinstance(payload, dict):
        return False
    if not _is_movement_id(payload.get("movementId")):
        return False
    if not _is_point(payload.get("origin")):
        return False
    path = payload.get("path")
    if not isinstance(path, list) or not path or len(path) > 64:
        return False
    if not all(_is_point(p) for p in path):
        return False
    if not _is_room_id(payload.get("roomId")):
        return False
    duration_ms = payload.get("durationMs")
    if not isinstance(duration_ms, int) or isinstance(duration_ms, bool):
        return False
    if not (100 <= duration_ms <= 20000):
        return False
    return True


def _valid_walk_arrived_payload(payload) -> bool:
    if not isinstance(payload, dict):
        return False
    if not _is_movement_id(payload.get("movementId")):
        return False
    if not _is_point(payload.get("at")):
        return False
    if payload.get("facing") not in _FACINGS:
        return False
    if payload.get("state") not in _MOVE_STATES:
        return False
    seat_key = payload.get("seatKey")
    if seat_key is not None and not isinstance(seat_key, str):
        return False
    if not _is_room_id(payload.get("roomId")):
        return False
    return True


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

    # Toucan T2: the arrival half of the presence cursor. Placed before the room bootstrap so a
    # bootstrap failure (which only emits chat_error) cannot cost us the one durable record that
    # a person came back — the absence boundary is frozen here or not at all.
    returned_from_absence = await _record_arrival(email)
    # A2.3 — a reconnect counts as "the owner is back" ONLY when it closed a proven absence AND
    # it is this person's only live socket. A second tab beside a live one, a refresh, HMR or a
    # blip never qualifies. The other return signals (own message, Toucan question, explicit
    # check-in) live on their own handlers; all of them end through the same one function.
    if returned_from_absence and not _has_another_live_socket(email, excluding_sid=sid):
        await mark_owner_returned(email)

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

    # Same reasoning for active voice calls: a client connecting mid-call must immediately know
    # whether its spatial session already has one (drives "Join call" vs "Start call") rather
    # than waiting for the next join/leave.
    await sio.emit("spatial_calls", {"calls": call_registry.snapshot()}, to=sid)

    # Same reasoning for in-flight call invites: a reconnecting/reloading client must get its own
    # pending ring back (either direction) rather than losing the Calling…/incoming prompt. Scoped
    # to invites this person is a party to — an invite is private to its two parties.
    await sio.emit(
        "call_invites",
        {"invites": [invite_wire(i) for i in call_invites.pending_for(email)]},
        to=sid,
    )

    # Same reasoning again for the DND-room-lock feature's two ephemeral registries: a client
    # connecting after others are already DND/in-room must see current lock state immediately.
    await sio.emit("dnd_status", {"emails": dnd_registry.snapshot()}, to=sid)
    await sio.emit("room_presence", {"rooms": room_presence.snapshot()}, to=sid)

    # Same reasoning for Global Chat activity: a late joiner / reconnecting client must see who
    # is currently in an active Global Chat window (drives peers' seated `sitting-answering`
    # animation) immediately, not just future changes.
    await sio.emit("global_chat_activity", {"emails": global_chat_activity.snapshot()}, to=sid)

    # Same reasoning again for live spatial positions: a client connecting mid-walk or after
    # others have already arrived somewhere must see current position state immediately, not
    # just future walk_started/walk_arrived broadcasts (see position_registry.py's docstring).
    await sio.emit(
        "positions_snapshot",
        {"entries": position_registry.snapshot(own_email=email), "serverTime": _now_ms()},
        to=sid,
    )


@sio.event
async def disconnect(sid: str) -> None:
    # Cleanup ONLY — not a new offline-detection mechanism (v1 is explicit-checkout-only, see
    # go_offline below). A real socket disconnect just means this person's connection is gone.
    try:
        session_data = await sio.get_session(sid)
    except KeyError:
        return
    email = session_data.get("email")
    if not email:
        return
    # Attendance is durable and server-authoritative (routers/attendance.py, employee_attendance):
    # a checked-out person stays in the sidewalk lineup until they explicitly check back in, so a
    # closed tab / dropped socket no longer removes them here. Connection state != attendance.
    # BY SID, never by email: this user has ~10 independent sockets open (see
    # spatial_session.py's SID-AWARE OWNERSHIP note), and only the one that emitted
    # spatial_session_start owns the membership. Every other socket's disconnect is a no-op
    # here. Returns the session id only when the LAST owning sid went away.
    if spatial_sessions.clear_sid(sid) is not None:
        await _broadcast_spatial_sessions()
    # Media cleanup is BY SID and INDEPENDENT of the spatial cleanup above: a dropped call
    # socket must never imply leaving the spatial conversation (and vice versa). A socket that
    # never joined media is not in this registry, so this is a no-op for it.
    if call_registry.clear_sid(sid):
        await _broadcast_spatial_calls()
    # Caller's socket vanished mid-ring: terminate their invite so the recipient's prompt clears.
    # Sid-aware — a socket owning no invite is a no-op here.
    for invite in call_invites.clear_sid(sid):
        # The caller's tab went away mid-ring. From the recipient's side that is indistinguishable
        # from a hang-up, and it is still a call they did not get to answer.
        await _record_missed_call(invite, reason="caller_left")
        await _emit_invite_terminal(invite, "call_invite_cancelled", {"reason": "caller_left"})
    if dnd_registry.clear(email):
        await _broadcast_dnd_status()
        await _cancel_stale_talk_requests(email)
    # Per-socket refcount: only broadcasts when this was the email's LAST active socket, so a
    # second tab keeps the person active through one tab closing.
    if global_chat_activity.clear_sid(email, sid):
        await _broadcast_global_chat_activity()
    left_room_id = room_presence.leave(email)
    if left_room_id is not None:
        await _broadcast_room_presence()
        await _cancel_stale_room_requests(left_room_id)
    # Toucan T2, and the ONLY thing in this handler that is not per-sid cleanup: if this was the
    # person's last socket, they have actually gone — record the departure candidate. Deliberately
    # last, so a bookkeeping failure cannot affect any of the cleanup above, and deliberately
    # gated: one socket of a multi-socket browser closing leaves the others live and writes
    # nothing. This does NOT resurrect explicit-checkout-only presence — no registry, broadcast
    # or client-visible state is touched here, only a durable timestamp Toucan reads later.
    if not _has_another_live_socket(email, excluding_sid=sid):
        await _record_departure(email)


@sio.on("go_offline")
async def go_offline(sid: str, _payload: dict | None = None) -> None:
    try:
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        offline_lineup.add(email)
        await _broadcast_offline_lineup()
        # An explicit checkout is the most precise departure this backend ever gets. It records
        # a CANDIDATE, not an absence: checking out and back in a minute later must not make the
        # user look like they were away.
        await _record_departure(email)
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("come_online")
async def come_online(sid: str, _payload: dict | None = None) -> None:
    try:
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        offline_lineup.remove(email)
        await _broadcast_offline_lineup()
        # The mirror of go_offline's departure. Checking back in is an arrival like any other,
        # so a checkout long enough to clear ABSENCE_GAP_SECONDS is resolved into a real
        # absence here rather than being silently forgotten.
        await _record_arrival(email)
        # A2.3 — an explicit check-in is the owner saying "I'm here": end an until_return
        # delegation regardless of how long they were gone.
        await mark_owner_returned(email)
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
        # sid is the OWNER of this membership — the only socket whose disconnect may end it.
        # Re-emitting on reconnect (spatialSessionStore.ts's "connect" re-assert) simply
        # registers the new sid; the old one was already cleared by its own disconnect.
        spatial_sessions.start(email, session_id, sid)
        await _broadcast_spatial_sessions()
        await _record_spatial_session_joined(email, session_id)
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


async def _record_spatial_session_joined(email: str, session_id: str) -> None:
    """Quest Foundation: one event per (person, spatial session identity). The registry above is
    in-memory, so this ledger row is the durable record. The reconnect re-assert and any duplicate
    emit carry the same sessionId and collapse on the unique key; a failure here is logged by the
    engine and never touches the broadcast that already went out."""
    try:
        async with async_session_maker() as session:
            await record_quest_event(
                session,
                actor_email=email,
                event_type=EVENT_SPATIAL_SESSION_JOINED,
                dedupe_key=f"{email.strip().lower()}:{session_id}",
                reference_id=session_id,
            )
            await session.commit()
    except Exception:  # noqa: BLE001 - bookkeeping must never surface as a socket error
        _logger.error("failed to record spatial session quest event for %s", email, exc_info=True)


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


@sio.on("call_joined")
async def call_joined(sid: str, payload: dict | None) -> None:
    """Edge-triggered "my LiveKit connection is live" fact — emitted by callStore.ts ONLY after
    room.connect() actually resolves, never optimistically on button click. Carries no track,
    mute or speaking state: LiveKit owns those. Refcounted per socket so multiple tabs compose.

    Deliberately does NOT touch spatial_sessions: joining media is not joining a conversation.
    """
    try:
        payload = payload or {}
        session_id = payload.get("sessionId")
        if not isinstance(session_id, str) or not session_id:
            return
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        # Same eligibility gate the token endpoint applies — a client cannot register itself as
        # a participant of a session it isn't spatially in.
        if spatial_sessions.session_of(email) != session_id:
            return
        if call_registry.join(session_id, email, sid):
            await _broadcast_spatial_calls()
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("call_left")
async def call_left(sid: str, _payload: dict | None = None) -> None:
    """Edge-triggered "I left the media call". Removes ONLY this socket's media claim — the
    caller stays in its spatial session and its chat panel stays open (see callStore.ts's leave:
    it never calls emitSpatialSessionLeave)."""
    try:
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        if call_registry.leave(email, sid):
            await _broadcast_spatial_calls()
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


def _is_online(email: str) -> bool:
    """Any live socket for this email. Mirrors requests.py's get_participants use — a ring must
    never be sent into the void."""
    return any(True for _ in sio.manager.get_participants("/", user_room(email)))


def _is_in_a_call(email: str) -> bool:
    """Read-only use of the existing CallRegistry: is this person currently connected to media
    anywhere? Drives the 'busy' rejection."""
    key = email.strip().lower()
    return any(key in entry["participants"] for entry in call_registry.snapshot())


async def _emit_invite_terminal(invite: dict, event: str, extra: dict | None = None) -> None:
    """Terminal states fan out to BOTH parties' user rooms — not just the caller. A recipient with
    several tabs open must have every prompt cleared, not only the tab that answered."""
    payload = {**invite_wire(invite), **(extra or {})}
    for email in (invite["from_email"], invite["to_email"]):
        await sio.emit(event, payload, room=user_room(email))


async def _expire_invite_later(invite_id: str) -> None:
    """Server-side TTL so a ring cannot hang forever when the recipient simply walks away. Cancels
    itself implicitly: once the invite is resolved by anyone, the sweep finds nothing."""
    try:
        await asyncio.sleep(INVITE_TTL_SECONDS)
    except asyncio.CancelledError:
        return
    invite = call_invites.resolve(invite_id)
    if invite is not None:
        # Rang out unanswered — the canonical missed call.
        await _record_missed_call(invite, reason="timeout")
        await _emit_invite_terminal(invite, "call_invite_cancelled", {"reason": "timeout"})


@sio.on("call_invite")
async def call_invite(sid: str, payload: dict | None) -> None:
    """Caller rings a specific person. NOTHING spatial or media-related happens here: no
    conversation, no spatial session, no token, no microphone. Those all wait for accept."""
    try:
        payload = payload or {}
        raw = payload.get("toEmail")
        if not isinstance(raw, str) or not raw.strip():
            return
        to_email = raw.strip().lower()
        session_data = await sio.get_session(sid)
        email = session_data["email"].strip().lower()

        def fail(reason: str) -> dict:
            return {"toEmail": to_email, "reason": reason}

        if to_email == email:
            return
        if not _is_online(to_email):
            # THE CASE T2 EXISTS FOR: nobody was there to ring, so no invite is ever minted and
            # nothing ephemeral records the attempt. Synthesised from the two emails the server
            # already holds, so the recipient can be told about it whenever they next come back.
            await _record_missed_call(
                {"to_email": to_email, "from_email": email, "inviteId": None}, reason="offline"
            )
            await sio.emit("call_invite_failed", fail("offline"), to=sid)
            return
        if dnd_registry.is_dnd(to_email):
            # DND protection is preserved: a ring never reaches a DND person. The caller's own
            # client routes them to the existing Request-Permission-to-Talk gate instead.
            await sio.emit("call_invite_failed", fail("dnd"), to=sid)
            return
        if _is_in_a_call(to_email):
            await sio.emit("call_invite_failed", fail("busy"), to=sid)
            return
        # One check covers both a duplicate re-invite and glare (both calling at once): the
        # second invite is refused rather than creating two competing rings.
        if call_invites.pending_between(email, to_email) is not None:
            await sio.emit("call_invite_failed", fail("already_ringing"), to=sid)
            return

        invite = call_invites.create(from_email=email, from_sid=sid, to_email=to_email)
        await sio.emit("call_invite_incoming", invite_wire(invite), room=user_room(to_email))
        await sio.emit("call_invite_ringing", invite_wire(invite), room=user_room(email))
        asyncio.create_task(_expire_invite_later(invite["inviteId"]))
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("call_invite_accept")
async def call_invite_accept(sid: str, payload: dict | None) -> None:
    """Recipient accepts. Still no media here — both clients now run the EXISTING approach/chat
    flow, which creates the spatial session; the existing eligibility-gated path starts LiveKit
    once that session actually has both members."""
    await _resolve_invite(sid, payload, role="recipient", event="call_invite_accepted")


@sio.on("call_invite_decline")
async def call_invite_decline(sid: str, payload: dict | None) -> None:
    await _resolve_invite(sid, payload, role="recipient", event="call_invite_declined")


@sio.on("call_invite_cancel")
async def call_invite_cancel(sid: str, payload: dict | None) -> None:
    await _resolve_invite(sid, payload, role="caller", event="call_invite_cancelled")


async def _resolve_invite(sid: str, payload: dict | None, *, role: str, event: str) -> None:
    """Shared single-shot resolution. A late or duplicate resolve — including an Accept racing a
    Cancel — pops nothing and emits nothing, so the first terminal state always wins. Never
    creates a talk_requests row and never starts a decline cooldown."""
    try:
        payload = payload or {}
        invite_id = payload.get("inviteId")
        if not isinstance(invite_id, str) or not invite_id:
            return
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        invite = call_invites.resolve(invite_id, actor_email=email, role=role)
        if invite is None:
            return
        # A CANCEL is a missed call: the caller gave up before the recipient answered. A
        # DECLINE is not — the recipient was there and made a choice — and neither is an accept.
        if event == "call_invite_cancelled":
            await _record_missed_call(invite, reason="cancelled")
        extra = {"reason": "declined"} if event == "call_invite_declined" else None
        await _emit_invite_terminal(invite, event, extra)
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("global_chat_active")
async def global_chat_active(sid: str, payload: dict | None) -> None:
    """Edge-triggered "I have an active (visible, non-minimized) Global Chat window" presence
    fact — mirrors dnd_set's contract: call exactly once per real transition (see
    frontend/src/services/presence/globalChatActivityClient.ts), never on a poll. Carries only
    the boolean; no conversation ids or contents. Tracked per socket so multiple tabs of one
    user compose correctly (see global_chat_activity.py). Broadcasts only when the email-level
    boolean actually changed. Never touches spatial_sessions — remote chats must not look
    spatial (no auto-walk / "In Conversation" / Ask to Join)."""
    try:
        payload = payload or {}
        is_active = bool(payload.get("isActive"))
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        if global_chat_activity.set_active(email, sid, is_active):
            await _broadcast_global_chat_activity()
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
    """Moving client supplies path/destination; peers replay it. Server holds live position +
    in-flight movement in memory only (position_registry.py) — no DB write here, see that
    module's docstring for why (only stable/arrived state is durable)."""
    try:
        if not _valid_walk_started_payload(payload):
            return  # silent drop on malformed input — matches this codebase's convention
            # (e.g. spatial_session_start's early-return on bad sessionId)
        session_data = await sio.get_session(sid)
        email = session_data["email"]  # server-verified identity ONLY, never payload-supplied

        movement_id = payload["movementId"]
        origin = {"x": payload["origin"]["x"], "y": payload["origin"]["y"]}
        path = [{"x": p["x"], "y": p["y"]} for p in payload["path"]]
        room_id = payload.get("roomId")
        duration_ms = payload["durationMs"]
        started_at = _now_ms()

        revision = position_registry.start(
            email,
            movement_id=movement_id,
            origin=origin,
            path=path,
            room_id=room_id,
            duration_ms=duration_ms,
            started_at=started_at,
        )

        await sio.emit(
            "peer_walk_started",
            {
                "email": email,
                "movementId": movement_id,
                "revision": revision,
                "origin": origin,
                "path": path,
                "roomId": room_id,
                "durationMs": duration_ms,
                "startedAt": started_at,
            },
            skip_sid=sid,
        )
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("walk_arrived")
async def walk_arrived(sid: str, payload: dict | None) -> None:
    """Accepted only if it matches the currently-active movementId for this employee (rejects
    stale/reordered arrivals from a superseded walk, see position_registry.arrive's docstring).
    On acceptance, stable state is persisted to the DB (position.py) BEFORE broadcasting — a
    persist failure is logged and must not block the broadcast, same pattern as
    _cancel_stale_room_requests' surrounding try/except-per-step convention."""
    try:
        if not _valid_walk_arrived_payload(payload):
            return
        session_data = await sio.get_session(sid)
        email = session_data["email"]

        movement_id = payload["movementId"]
        at = {"x": payload["at"]["x"], "y": payload["at"]["y"]}
        facing = payload["facing"]
        state = payload["state"]
        seat_key = payload.get("seatKey")
        room_id = payload.get("roomId")

        stable = position_registry.arrive(
            email,
            movement_id=movement_id,
            at=at,
            facing=facing,
            state=state,
            seat_key=seat_key,
            room_id=room_id,
            now_ms=_now_ms(),
        )
        if stable is None:
            return  # stale/wrong movementId — ignore silently

        try:
            async with async_session_maker() as session:
                await position_repo.upsert_stable(
                    session,
                    email=email,
                    x=stable.x,
                    y=stable.y,
                    facing=stable.facing,
                    state=stable.state,
                    seat_key=stable.seat_key,
                    room_id=stable.room_id,
                    revision=stable.revision,
                    updated_at=_ms_to_dt(stable.updated_at),
                )
        except Exception as exc:  # noqa: BLE001
            _logger.exception(exc)

        await sio.emit(
            "peer_walk_arrived",
            {
                "email": email,
                "movementId": movement_id,
                "revision": stable.revision,
                "at": at,
                "facing": stable.facing,
                "state": stable.state,
                "seatKey": stable.seat_key,
                "roomId": stable.room_id,
            },
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
    """Parse the payload, take the sender from the authenticated socket session, and hand off to
    the shared chat write path (services/chat_send.py) — authorization, persistence, and fan-out
    all live there so any server-side sender goes through the same seam."""
    try:
        payload = payload or {}
        conversation_id = payload.get("conversationId")
        conversation_id = conversation_id if isinstance(conversation_id, str) else ""
        client_temp_id = payload.get("clientTempId")
        client_temp_id = client_temp_id if isinstance(client_temp_id, str) else ""
        text = payload.get("text")
        text = text if isinstance(text, str) else ""
        raw_mentions = payload.get("mentionedEmails")
        mentioned_emails = [e for e in raw_mentions if isinstance(e, str)] if isinstance(raw_mentions, list) else None

        # Sender is ALWAYS the server-verified session email — a client-sent sender id is
        # never trusted, even implicitly.
        session_data = await sio.get_session(sid)
        email = session_data["email"]
        if is_toucan_sender(email):
            # The reserved Toucan author is server-side only; no socket session may speak as it.
            await sio.emit("chat_error", {"code": "forbidden", "message": "Reserved sender"}, to=sid)
            return

        try:
            async with async_session_maker() as session:
                saved = await send_chat_message(
                    session,
                    conversation_id=conversation_id,
                    sender_email=email,
                    text=text,
                    mentioned_emails=mentioned_emails,
                    origin_sid=sid,
                    client_temp_id=client_temp_id,
                )
        except ChatSendError as err:
            await sio.emit("chat_error", {"code": err.code, "message": err.message}, to=sid)
            return

        # A1.4.2 — only AFTER the human message is committed and fanned out: an "@Toucan" token
        # schedules Toucan's in-chat reply as a background task, so nothing about the reply can
        # delay or fail this send. The reply re-checks membership itself.
        prompt = detect_toucan_invocation(text)
        if prompt is not None:
            schedule_reply(conversation_id, email, prompt, saved["id"])
        # A2.1 — same ordering guarantee: only after the human message is committed and fanned
        # out, decide in the background whether the OTHER participant of a DM has an active
        # delegation that earns a deterministic Toucan acknowledgement. The evaluation reads no
        # message text and re-checks every condition against the database itself.
        # A2.3 — a human message from this person is the strongest "I'm back" there is. Ends an
        # until_return delegation of THEIRS (never anybody else's), in the background.
        schedule_owner_returned(email)
        # A message that explicitly addresses Toucan is a conversation WITH Toucan (A1.4 answers
        # it); it is not a message left for the absent owner, so no acknowledgement on their behalf.
        if prompt is None:
            # A2.2: the saved message's SERVER-VALIDATED mention list decides who was addressed in
            # a group; the evaluation never re-parses text.
            # A2.4: the saved text is passed so a simple retrieval question can be answered from
            # the owner's own earlier words in this conversation; unsafe questions never read it.
            schedule_delegation_reply(
                conversation_id, email, saved["id"], saved.get("mentionedEmails"), saved.get("text")
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
            # mark_read only mutates the in-memory participant row; unread_count/mention_count
            # re-SELECT last_read_at, so without a flush they'd compute against the OLD watermark
            # and push a stale (still-nonzero) count to the reader's badge.
            await session.flush()
            count = await chat_repo.unread_count(session, conversation_id, email)
            mentions = await chat_repo.mention_count(session, conversation_id, email)
            peers = await _other_participant_emails(session, conversation_id, email)
            await session.commit()

        # Authoritative post-read counts to EVERY socket for this email (per-user room joined at
        # connect time) — including the socket that just marked read. The marking tab has no
        # local decrement (frontend's useUnreadTotal only updates on this push), so skipping the
        # sender left its badge stuck until a refetch.
        await sio.emit("unread_count", {"conversationId": conversation_id, "count": count}, room=user_room(email))
        await sio.emit(
            "mention_count", {"conversationId": conversation_id, "count": mentions}, room=user_room(email)
        )
        if not advanced:
            # Watermark didn't actually move (redundant/stale re-ack, or no participant row) —
            # skip the read_receipt fan-out entirely rather than re-emitting a no-op event.
            return
        # Tell the peer(s) — the sender(s) of the messages just marked read — so their UI can
        # advance from "delivered" to "read" without polling.
        # readerEmail is the server-verified session identity — never a client-supplied field —
        # so a group sender's UI can attribute the receipt to the right participant's avatar.
        for peer in peers:
            await sio.emit(
                "read_receipt",
                {"conversationId": conversation_id, "readUpTo": to_iso_z(up_to_sent_at), "readerEmail": email},
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
        # recipientEmail: server-verified session identity of the acker (see readerEmail above).
        for peer in peers:
            await sio.emit(
                "delivery_receipt",
                {
                    "conversationId": conversation_id,
                    "deliveredUpTo": to_iso_z(up_to_sent_at),
                    "recipientEmail": email,
                },
                room=user_room(peer),
            )
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)


@sio.on("add_reaction")
async def add_reaction(sid: str, payload: dict | None) -> None:
    await _handle_reaction(sid, payload, action="add")


@sio.on("remove_reaction")
async def remove_reaction(sid: str, payload: dict | None) -> None:
    await _handle_reaction(sid, payload, action="remove")


async def _handle_reaction(sid: str, payload: dict | None, *, action: str) -> None:
    """Shared body for add_reaction/remove_reaction — the two differ only in which repo call
    they make, so the authorization and broadcast are written once.

    Deliberately touches NOTHING that feeds the message-derived counters: no insert_message, no
    touch_conversation, no mark_read/mark_delivered. A reaction therefore cannot create an
    unread message, cannot register as a mention, cannot reorder the conversation list, and
    cannot move a delivery/read watermark — all four of those derive exclusively from rows in
    `messages` and the participant watermark columns (see repositories/chat.py).
    """
    try:
        payload = payload or {}
        message_id = payload.get("messageId")
        message_id = message_id if isinstance(message_id, str) else ""
        emoji = payload.get("emoji")
        emoji = emoji.strip() if isinstance(emoji, str) else ""

        if not message_id or not emoji:
            await sio.emit(
                "chat_error",
                {"code": "invalid_reaction", "message": "messageId and emoji are required"},
                to=sid,
            )
            return

        if emoji not in chat_repo.ALLOWED_REACTION_EMOJIS:
            await sio.emit(
                "chat_error",
                {"code": "invalid_reaction", "message": "Unsupported reaction emoji"},
                to=sid,
            )
            return

        # Reactor is ALWAYS the server-verified session email — exactly like send_message, a
        # client-supplied reactor id is never read, not even as a hint.
        session_data = await sio.get_session(sid)
        email = session_data["email"]

        async with async_session_maker() as session:
            conversation_id = await chat_repo.get_message_conversation_id(session, message_id)
            if conversation_id is None:
                await sio.emit(
                    "chat_error", {"code": "not_found", "message": "Message not found"}, to=sid
                )
                return

            # Membership is checked against the MESSAGE's own conversation, not against any
            # conversation the caller happens to claim — the client never supplies the
            # conversation id for a reaction at all.
            ok = await chat_repo.is_participant(session, conversation_id, email)
            if not ok:
                await sio.emit(
                    "chat_error", {"code": "forbidden", "message": "Not a participant"}, to=sid
                )
                return

            if action == "add":
                changed = await chat_repo.add_reaction(session, message_id, email, emoji)
            else:
                changed = await chat_repo.remove_reaction(session, message_id, email, emoji)
            await session.commit()

        # No-op (re-adding an emoji already held, or removing one never held): the desired end
        # state already holds, so stay silent rather than broadcasting a phantom change.
        if not changed:
            return

        # Broadcast to the whole conversation room INCLUDING the reactor's own socket (no
        # skip_sid, unlike incoming_message) — reactions have no optimistic local apply, so the
        # sender needs this echo to render its own chip.
        await sio.emit(
            "message_reaction",
            {
                "messageId": message_id,
                "emoji": emoji,
                "reactorEmail": email,
                "action": action,
            },
            room=conversation_id,
        )
    except Exception as exc:  # noqa: BLE001
        await _emit_unexpected(sid, exc)
