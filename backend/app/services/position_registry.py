from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# In-memory, socket-native registry of every connected (or previously-seen) employee's live
# spatial position. Adapted from room_presence.py / spatial_session.py's conventions: plain
# synchronous mutation, no locks, no I/O in here — persistence is the caller's job (see
# app/repositories/position.py), this module is pure bookkeeping + revision arithmetic.
#
# Moving client supplies path/destination; peers replay it. This registry holds the
# server-authoritative live position + in-flight movement so a client connecting mid-walk (or
# reconnecting) can be caught up via `snapshot()` instead of only seeing future events. DB
# persistence (via position.py's repository) covers only the last STABLE (arrived/sitting)
# state, for cold-start recovery — in-flight movement is never persisted.
#
# Revisions are server-issued and monotonic PER EMPLOYEE (never a client-supplied sequence
# number) so peers can always tell "is this newer than what I already applied" even across
# reordered/duplicate socket deliveries.
#
# ASSUMPTION (same single-worker-deployment caveat as room_presence.py/spatial_session.py/
# offline_lineup.py): this state is in-memory and per-process, correct only when the backend
# runs as a single worker/process (see render.yaml — no `--workers` flag). Scaling to multiple
# workers/instances would require moving this to shared state (e.g. Redis / AsyncRedisManager)
# with real distributed presence semantics. Not built now — out of scope for this stage.


@dataclass
class StableState:
    """Last known arrived/sitting position — the durable-recoverable half of an employee's
    position state."""

    x: float
    y: float
    facing: str
    state: str
    seat_key: str | None
    room_id: str | None
    revision: int
    updated_at: int  # epoch ms


@dataclass
class ActiveMovement:
    """An in-flight, not-yet-arrived walk. Superseded (not merged) by a new `start()` for the
    same employee — the old movementId simply becomes stale and any `arrive()` referencing it is
    rejected."""

    movement_id: str
    origin: dict[str, float]
    path: list[dict[str, float]]
    room_id: str | None
    duration_ms: int
    started_at: int  # epoch ms
    revision: int


@dataclass
class PositionEntry:
    email: str
    stable: StableState | None = None
    active: ActiveMovement | None = None


class PositionRegistry:
    def __init__(self) -> None:
        self._revision_by_email: dict[str, int] = {}
        self._entries: dict[str, PositionEntry] = {}

    # -- revisions ---------------------------------------------------------------------------
    def next_revision(self, email: str) -> int:
        rev = self._revision_by_email.get(email, 0) + 1
        self._revision_by_email[email] = rev
        return rev

    # -- mutation ------------------------------------------------------------------------------
    def start(
        self,
        email: str,
        *,
        movement_id: str,
        origin: dict[str, float],
        path: list[dict[str, float]],
        room_id: str | None,
        duration_ms: int,
        started_at: int,
    ) -> int:
        """Store the new active movement (superseding any prior one) and fold the
        walking-supersedes-sitting transition into the same revision bump: stable.state becomes
        "standing" and stable.seatKey is cleared, but position/facing/room are left untouched
        (they only change on arrival). If this employee has no stable state yet at all, seed one
        at `origin` so every active movement always has an accompanying stable row."""
        rev = self.next_revision(email)
        entry = self._entries.setdefault(email, PositionEntry(email=email))
        if entry.stable is None:
            entry.stable = StableState(
                x=origin["x"],
                y=origin["y"],
                facing="front",
                state="standing",
                seat_key=None,
                room_id=room_id,
                revision=rev,
                updated_at=started_at,
            )
        else:
            entry.stable.state = "standing"
            entry.stable.seat_key = None
            entry.stable.revision = rev
            entry.stable.updated_at = started_at
        entry.active = ActiveMovement(
            movement_id=movement_id,
            origin=origin,
            path=path,
            room_id=room_id,
            duration_ms=duration_ms,
            started_at=started_at,
            revision=rev,
        )
        return rev

    def arrive(
        self,
        email: str,
        *,
        movement_id: str,
        at: dict[str, float],
        facing: str,
        state: str,
        seat_key: str | None,
        room_id: str | None,
        now_ms: int,
    ) -> StableState | None:
        """Accept only if there is an active movement for `email` whose movementId matches.
        Returns the new StableState on acceptance, or None when the arrival is stale/reordered
        (wrong or no active movementId) — caller must silently ignore a None result."""
        entry = self._entries.get(email)
        if entry is None or entry.active is None or entry.active.movement_id != movement_id:
            return None
        rev = self.next_revision(email)
        stable = StableState(
            x=at["x"],
            y=at["y"],
            facing=facing,
            state=state,
            seat_key=seat_key,
            room_id=room_id,
            revision=rev,
            updated_at=now_ms,
        )
        entry.stable = stable
        entry.active = None
        return stable

    # -- reads ---------------------------------------------------------------------------------
    def get(self, email: str) -> PositionEntry | None:
        return self._entries.get(email)

    def snapshot(self, own_email: str | None = None) -> list[dict[str, Any]]:
        """Wire shape for `positions_snapshot`. Stable-ordered by email for deterministic tests.
        Only emits entries that have stable state (every active movement always has an
        accompanying stable per `start()`, so this is every employee this process has ever seen
        move or been seeded with via `load_stable`).

        `own_email`, when given, identifies the connecting/recipient client itself
        (case/whitespace-insensitive compare). That one entry is still included — self needs its
        last stable position/facing/state to restore on reload — but its `active` is forced to
        null so self never replays/fast-forwards its own in-flight movement as a ghost (the
        self-echo bug). Every OTHER entry is unchanged, including its `active`."""
        own = own_email.strip().lower() if isinstance(own_email, str) else None
        entries: list[dict[str, Any]] = []
        for email in sorted(self._entries):
            entry = self._entries[email]
            if entry.stable is None:
                continue
            stable = entry.stable
            is_self = own is not None and email.strip().lower() == own
            active_wire = None
            if entry.active is not None and not is_self:
                active_wire = {
                    "movementId": entry.active.movement_id,
                    "origin": entry.active.origin,
                    "path": entry.active.path,
                    "roomId": entry.active.room_id,
                    "durationMs": entry.active.duration_ms,
                    "startedAt": entry.active.started_at,
                }
            entries.append(
                {
                    "email": email,
                    "revision": stable.revision,
                    "pos": {"x": stable.x, "y": stable.y},
                    "facing": stable.facing,
                    "state": stable.state,
                    "seatKey": stable.seat_key,
                    "roomId": stable.room_id,
                    "updatedAt": stable.updated_at,
                    "active": active_wire,
                }
            )
        return entries

    # -- cold start ------------------------------------------------------------------------------
    def load_stable(self, rows: list[dict[str, Any]]) -> None:
        """Merge DB rows into this registry at process start. For each row: if there is no
        in-memory entry yet for that email, seed stable from the row entirely (position, facing,
        etc all come from the DB). If an in-memory entry already exists (e.g. activity happened
        between DB read and this call, or in tests), the in-memory stable data wins — only the
        revision counter is advanced to max(memory, db) so future next_revision() calls stay
        monotonic against whatever was last persisted."""
        for row in rows:
            email = row["email"]
            db_revision = int(row["revision"])
            entry = self._entries.get(email)
            if entry is None or entry.stable is None:
                entry = self._entries.setdefault(email, PositionEntry(email=email))
                updated_at = row["updated_at"]
                updated_at_ms = _to_epoch_ms(updated_at)
                entry.stable = StableState(
                    x=row["x"],
                    y=row["y"],
                    facing=row["facing"],
                    state=row["state"],
                    seat_key=row.get("seat_key"),
                    room_id=row.get("room_id"),
                    revision=db_revision,
                    updated_at=updated_at_ms,
                )
                self._revision_by_email[email] = max(self._revision_by_email.get(email, 0), db_revision)
            else:
                self._revision_by_email[email] = max(self._revision_by_email.get(email, 0), db_revision)

    def reset(self) -> None:
        """Test-only helper — mirrors the pattern socket tests use to clear other module-level
        singleton registries between tests (e.g. spatial_sessions._session_by_email.clear())."""
        self._revision_by_email.clear()
        self._entries.clear()


def _to_epoch_ms(value: Any) -> int:
    if isinstance(value, (int, float)):
        return int(value)
    # datetime from the DB row
    try:
        return int(value.timestamp() * 1000)
    except AttributeError:
        return 0


# Single shared instance — matches this module's sibling registries' pattern (room_presence,
# spatial_session, offline_lineup, dnd_registry) of holding shared server state as a plain
# module-level object.
position_registry = PositionRegistry()
