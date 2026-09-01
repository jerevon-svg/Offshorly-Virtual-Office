from __future__ import annotations

import inspect

from app.realtime import socket as socket_module
from app.realtime import state as state_module
from app.realtime.protocols import CallInviteStore, CallStore, SpatialSessionStore
from app.routers import calls as calls_router
from app.routers import requests as requests_router
from app.routers import room_requests as room_requests_router
from app.routers import talk_requests as talk_requests_router

# Guards the construction seam introduced when the realtime singletons moved out of socket.py
# into state.py. The ONLY thing that makes that move safe is object identity: socket.py, every
# REST router and every existing test must all be looking at the same registry instances. A
# second instance anywhere would silently split the ephemeral state (a router would answer from
# one dict while the socket layer mutates another) and would not fail any existing test.

# name on state.py -> the modules that must be re-exporting/importing that SAME object
_SHARED_SINGLETONS = [
    "sio",
    "offline_lineup",
    "spatial_sessions",
    "call_registry",
    "call_invites",
    "dnd_registry",
    "room_presence",
    "global_chat_activity",
]


def test_socket_module_reexports_the_same_singleton_objects():
    for name in _SHARED_SINGLETONS:
        assert getattr(socket_module, name) is getattr(state_module, name), name


def test_routers_hold_the_same_singleton_objects():
    assert requests_router.call_registry is state_module.call_registry
    assert requests_router.sio is state_module.sio
    assert calls_router.call_registry is state_module.call_registry
    assert calls_router.spatial_sessions is state_module.spatial_sessions
    assert room_requests_router.dnd_registry is state_module.dnd_registry
    assert room_requests_router.room_presence is state_module.room_presence
    assert room_requests_router.sio is state_module.sio
    assert talk_requests_router.dnd_registry is state_module.dnd_registry
    assert talk_requests_router.sio is state_module.sio


def test_shared_helpers_are_the_same_functions():
    assert socket_module.user_room is state_module.user_room
    assert socket_module.is_room_locked is state_module.is_room_locked
    assert room_requests_router.is_room_locked is state_module.is_room_locked
    assert room_requests_router.user_room is state_module.user_room


def test_a_mutation_through_state_is_visible_through_socket():
    """The identity assertions above would still pass against two aliases of a copy; this proves
    the shared state itself is shared."""
    state_module.dnd_registry.set_dnd("seam@example.com", True)
    try:
        assert socket_module.dnd_registry.is_dnd("seam@example.com")
        assert "seam@example.com" in socket_module.dnd_registry.snapshot()
    finally:
        state_module.dnd_registry.set_dnd("seam@example.com", False)


def test_socketio_server_uses_the_in_process_manager():
    """R2 seam is config-only: with REALTIME_REDIS_URL unset (the default and the only supported
    mode today) the server must still be on python-socketio's plain in-process AsyncManager, not
    any pubsub/Redis manager."""
    from socketio import AsyncManager
    from socketio.async_pubsub_manager import AsyncPubSubManager

    assert type(state_module.sio.manager) is AsyncManager
    assert not isinstance(state_module.sio.manager, AsyncPubSubManager)


_PROTOCOL_PAIRS = [
    (SpatialSessionStore, "spatial_sessions"),
    (CallStore, "call_registry"),
    (CallInviteStore, "call_invites"),
]


def test_live_registries_conform_to_their_protocols():
    for protocol, attr in _PROTOCOL_PAIRS:
        registry = getattr(state_module, attr)
        assert isinstance(registry, protocol), f"{attr} does not satisfy {protocol.__name__}"


def _protocol_methods(protocol) -> list[str]:
    return sorted(name for name in vars(protocol) if not name.startswith("_"))


def test_protocol_methods_stay_synchronous():
    """The Protocols are typing-only and describe TODAY's synchronous registries. If a method
    here ever became `async def`, every call site in socket.py and the routers would need
    awaiting — this test makes that a deliberate, visible change rather than a silent one."""
    for protocol, attr in _PROTOCOL_PAIRS:
        registry = getattr(state_module, attr)
        names = _protocol_methods(protocol)
        assert names, f"{protocol.__name__} declares no methods"
        for name in names:
            method = getattr(registry, name)
            assert callable(method), f"{attr}.{name} is not callable"
            assert not inspect.iscoroutinefunction(method), f"{attr}.{name} became async"


def test_protocol_parameter_shapes_match_the_live_registries():
    """isinstance() against a runtime_checkable Protocol only checks that the names exist, so
    pin the parameter names/kinds too — that is where a signature change (a new required
    argument, a positional turned keyword-only) would actually break call sites."""
    for protocol, attr in _PROTOCOL_PAIRS:
        registry = getattr(state_module, attr)
        for name in _protocol_methods(protocol):
            declared = [
                (p.name, p.kind)
                for p in inspect.signature(getattr(protocol, name)).parameters.values()
                if p.name != "self"
            ]
            actual = [
                (p.name, p.kind)
                for p in inspect.signature(getattr(registry, name)).parameters.values()
            ]
            assert declared == actual, f"{attr}.{name} drifted from {protocol.__name__}"
