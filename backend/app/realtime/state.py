from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import socketio

from app.config import settings
from app.services.call_invites import CallInviteRegistry
from app.services.call_registry import CallRegistry
from app.services.dnd_registry import DndRegistry
from app.services.global_chat_activity import GlobalChatActivityRegistry
from app.services.offline_lineup import OfflineLineup
from app.services.room_presence import RoomPresenceRegistry
from app.services.spatial_session import SpatialSessionRegistry
from app.services.whiteboard_rooms import WhiteboardRoomRegistry

# CONSTRUCTION SEAM for realtime shared state. This module owns the Socket.IO server and every
# ephemeral registry singleton; it is the only place they are instantiated.
#
# WHY IT EXISTS: these singletons used to be constructed in socket.py, so every REST router that
# needed to read live spatial/DND/call state had to import the 1000-line socket handler module.
# That made "where does shared state come from?" the same question as "where are the handlers?".
# Splitting construction out means a future multi-worker/shared-store swap (Redis-backed stores,
# see app/realtime/protocols.py) has exactly one file to change, and routers keep importing the
# same names from a module with no handlers in it.
#
# IDENTITY IS THE WHOLE POINT: socket.py re-exports these same objects, so `state.spatial_sessions
# is socket.spatial_sessions` — there is exactly ONE of each registry in the process. Never
# construct a second instance anywhere.
#
# NOT A BEHAVIOUR CHANGE: same classes, same construction order, same single-process in-memory
# assumption documented in each service module. app/main.py still imports socket.py, which is
# what registers the Socket.IO event handlers — importing this module alone would give you a
# server with no handlers on it.

if TYPE_CHECKING:  # pragma: no cover - typing-only conformance check, never runs
    from app.realtime.protocols import CallInviteStore, CallStore, SpatialSessionStore

_logger = logging.getLogger(__name__)


def _build_client_manager() -> socketio.AsyncManager | None:
    """FUTURE MULTI-WORKER SEAM — returns None today, which is exactly what socket.py passed
    implicitly before: AsyncServer(client_manager=None) constructs the ordinary in-process
    AsyncManager (see socketio/async_server.py). Nothing about today's fan-out changes.

    A second worker would need cross-process fan-out, i.e. socketio.AsyncRedisManager over
    REALTIME_REDIS_URL. That is deliberately NOT built here: the python-socketio redis extra is
    not installed, no Redis runs locally or in the deploy, and Socket.IO fan-out alone would
    not make the registries above correct across workers (they are still per-process dicts).
    Setting REALTIME_REDIS_URL today therefore only logs — it must not silently half-enable a
    multi-worker mode that the registry layer cannot honour yet."""
    if not settings.REALTIME_REDIS_URL:
        return None
    _logger.warning(
        "REALTIME_REDIS_URL is set but multi-worker realtime is not implemented yet; "
        "continuing with the in-process Socket.IO manager and per-process registries."
    )
    return None


sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.cors_origins_list or "*",
    client_manager=_build_client_manager(),
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

# Ephemeral Stage A voice-call state layered on top of spatial_sessions — see call_registry.py.
# Holds ONLY the session->room mapping plus who is connected to media; LiveKit owns tracks, mute,
# speaking and reconnection. Same in-memory/single-process assumption as the registries above.
call_registry = CallRegistry()

# Ephemeral person-to-person call ringing ("A is calling B") — see call_invites.py for why this is
# NOT the persisted talk_requests table. Holds no sessionId and no LiveKit room.
call_invites = CallInviteRegistry()

# Ephemeral DND-room-lock feature state — see dnd_registry.py/room_presence.py module
# docstrings. Same in-memory/single-process assumption as the registries above.
dnd_registry = DndRegistry()
room_presence = RoomPresenceRegistry()
# Ephemeral "has an active Global Chat window" presence — see global_chat_activity.py. Same
# in-memory/single-process assumption as the registries above; refcounted per socket so
# multi-tab users are handled correctly.
global_chat_activity = GlobalChatActivityRegistry()
# Ephemeral Whiteboard W3 realtime rooms (one per open board) — see whiteboard_rooms.py. The room
# is the authority for a board's elements while anyone has it open and writes the DB on a
# debounce; same in-memory/single-process assumption as the registries above.
whiteboard_rooms = WhiteboardRoomRegistry()


def is_room_locked(room_id: str) -> bool:
    """A room is locked iff at least one of its current occupants is DND (feature spec section
    2). Occupancy and DND are two independent ephemeral registries, both populated by explicit
    client emits (room_presence_enter/leave, dnd_set) — combining them here is the single
    source of truth both the REST layer (room_requests router) and socket.py's auto-expiry
    logic use."""
    return any(dnd_registry.is_dnd(email) for email in room_presence.occupants(room_id))


if TYPE_CHECKING:  # pragma: no cover - asserts structural conformance for type checkers only
    _spatial_store_contract: SpatialSessionStore = spatial_sessions
    _call_store_contract: CallStore = call_registry
    _call_invite_store_contract: CallInviteStore = call_invites
