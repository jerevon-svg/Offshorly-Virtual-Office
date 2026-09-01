from __future__ import annotations

from datetime import datetime
from typing import Protocol, runtime_checkable

# TYPING-ONLY contracts for the realtime stores that a future shared-state (multi-worker)
# backend would have to reimplement. Nothing here runs, wraps, or subclasses anything: the
# existing registries in app/services/* satisfy these structurally, exactly as they are today.
#
# WHY ONLY THESE THREE: spatial sessions, calls and call invites are the registries whose state
# is read/written from BOTH the socket layer and the REST routers, so they are the ones a second
# worker would immediately disagree about. The purely socket-local registries (DND, room
# presence, offline lineup, global chat activity, positions) are deliberately left without a
# Protocol — a contract nobody swaps out is just duplication to keep in sync.
#
# DELIBERATELY SYNCHRONOUS: every method below is `def`, not `async def`, mirroring today's
# registries. A Redis-backed implementation would need async methods and therefore a NEW
# protocol plus call-site changes — that cost is a fact about the future work, and writing these
# as async now would be a lie about what the current code does.
#
# `runtime_checkable` is here only so the conformance test can assert method presence with
# isinstance(); it never changes how the registries behave.


@runtime_checkable
class SpatialSessionStore(Protocol):
    """Who is spatially clustered with whom — see app/services/spatial_session.py.
    `start`/`clear_sid` carry the sid-ownership/refcount semantics; `leave` is the explicit
    email-level exit. Any replacement must keep those three distinct."""

    def start(self, email: str, session_id: str, sid: str) -> None: ...

    def leave(self, email: str) -> str | None: ...

    def clear_sid(self, sid: str) -> str | None: ...

    def session_of(self, email: str) -> str | None: ...

    def snapshot(self) -> list[dict]: ...


@runtime_checkable
class CallStore(Protocol):
    """Spatial session -> LiveKit room mapping plus who is connected to media — see
    app/services/call_registry.py. `rekey_session` is part of the contract because the
    Ask-to-Join upgrade path depends on it (routers/requests.py)."""

    def room_for_session(self, session_id: str) -> str: ...

    def existing_room_for_session(self, session_id: str) -> str | None: ...

    def rekey_session(self, old_session_id: str, new_session_id: str) -> str | None: ...

    def join(self, session_id: str, email: str, sid: str) -> bool: ...

    def leave(self, email: str, sid: str) -> bool: ...

    def clear_sid(self, sid: str) -> bool: ...

    def participants(self, session_id: str) -> list[str]: ...

    def has_active_call(self, session_id: str) -> bool: ...

    def snapshot(self) -> list[dict]: ...


@runtime_checkable
class CallInviteStore(Protocol):
    """Person-to-person ringing state — see app/services/call_invites.py. `resolve` keeps its
    single-shot + authority-check semantics (first caller wins, later ones get None), and
    `expired` stays a pure sweep the caller drives, so TTL behaviour is not baked into the
    store."""

    def pending_between(self, a: str, b: str) -> dict | None: ...

    def pending_for(self, email: str) -> list[dict]: ...

    def create(self, *, from_email: str, from_sid: str, to_email: str) -> dict: ...

    def get(self, invite_id: str) -> dict | None: ...

    def resolve(
        self, invite_id: str, *, actor_email: str | None = ..., role: str | None = ...
    ) -> dict | None: ...

    def clear_sid(self, sid: str) -> list[dict]: ...

    def expired(self, *, now: datetime | None = ..., ttl_seconds: int = ...) -> list[dict]: ...
