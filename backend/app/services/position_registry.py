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
    # The V2 3D office's exact resting yaw, radians, beside V1's four-word `facing`. None for every
    # arrival a V1 client publishes and for every row persisted before the column existed; a 3D peer
    # falls back to `facing` then. Persisted, so a reload restores the exact orientation.
    yaw: float | None = None
    # PHASE 7D — THE CAVE-LOCAL POSITION, and the one rule that keeps it safe.
    #
    # The Championship Cave is outside V1's coordinate frame entirely, so `x`/`y` above CANNOT
    # describe a body inside it — they stay the last real in-frame point (the portal), which is what
    # V1 keeps holding for that employee and what V1's own office keeps drawing.
    #
    # `local_*` is where they actually are, in the frame `room_id` names. It is EPHEMERAL BY DESIGN:
    # carried in this in-memory registry and on the wire, and NEVER passed to position_repo — see
    # socket.py's walk_arrived, which persists `x`/`y` and nothing from here. A reload therefore
    # restores through the portal point + room_id exactly as it does today, and `employee_positions`
    # neither gains a column nor changes a value.
    local_x: float | None = None
    local_y: float | None = None


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
    # PHASE 7D — the same movement expressed in `room_id`'s local frame, when the client published
    # one. `origin`/`path` above stay V1's, so a V1 peer replays exactly the walk it always did.
    local_origin: dict[str, float] | None = None
    local_path: list[dict[str, float]] | None = None
    # "eased" | "linear" | None (== eased). How peers replay it — see socket.py's _PACINGS. Not
    # persisted: an in-flight movement never is.
    pacing: str | None = None


@dataclass
class PositionEntry:
    email: str
    stable: StableState | None = None
    active: ActiveMovement | None = None
    # PHASE 7D — has this employee's V1 position ever reached `employee_positions`? Needed because the
    # Cave write-skip below may only skip a write that would be REDUNDANT, and the very first arrival
    # is never redundant even when `start()` has pre-seeded an identical stable in memory.
    persisted: bool = False


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
        pacing: str | None = None,
        local_origin: dict[str, float] | None = None,
        local_path: list[dict[str, float]] | None = None,
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
            pacing=pacing,
            local_origin=local_origin,
            local_path=local_path,
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
        yaw: float | None = None,
        local_at: dict[str, float] | None = None,
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
            yaw=yaw,
            local_x=local_at["x"] if local_at else None,
            local_y=local_at["y"] if local_at else None,
        )
        entry.stable = stable
        entry.active = None
        return stable

    def mark_persisted(self, email: str) -> None:
        """The caller wrote this employee's stable state to the database."""
        entry = self._entries.get(email)
        if entry is not None:
            entry.persisted = True

    def v1_fields_changed(self, email: str, *, at: dict[str, float], facing: str, state: str,
                          seat_key: str | None, room_id: str | None) -> bool:
        """PHASE 7D — WOULD THIS ARRIVAL CHANGE ANYTHING V1 PERSISTS?

        Called BEFORE `arrive`, so it compares against the stable state still on file. Walking around
        the Cave republishes the SAME in-frame portal point on every leg (only the local coordinates
        move), and persisting that would be a row write per step for a V1 fact that did not change.
        Returns False for exactly that case, and True for anything a V1 client would see differently —
        so an ordinary office walk is persisted exactly as it always was.

        Deliberately does not consider yaw or the local coordinates: yaw rides the same row and is
        cheap to keep current, and the local coordinates are never persisted at all."""
        entry = self._entries.get(email)
        prev = entry.stable if entry else None
        # Never persisted: this arrival is the first real fact about them, whatever `start()` seeded.
        if prev is None or entry is None or not entry.persisted:
            return True
        return (
            prev.x != at["x"]
            or prev.y != at["y"]
            or prev.facing != facing
            or prev.state != state
            or prev.seat_key != seat_key
            or prev.room_id != room_id
        )

    # -- reads ---------------------------------------------------------------------------------
    def get(self, email: str) -> PositionEntry | None:
        return self._entries.get(email)

    def seat_holder(self, seat_key: str, *, exclude_email: str | None = None) -> str | None:
        """Who currently OCCUPIES `seat_key`: the employee (other than `exclude_email`) whose stable
        state is `sitting` on it with no movement in flight — the same two conditions every client's
        occupancy read uses. None when the seat is free. Read-only; `walk_arrived` consults it before
        accepting a `sitting` arrival so two employees cannot both be persisted into one chair.

        This registry is a single in-process dict and the check-then-arrive in the socket handler has
        no await between the two, so within one worker the decision is serialised. It is NOT a
        distributed lock: a multi-worker deployment would need shared state to make the same promise."""
        for email, entry in self._entries.items():
            if email == exclude_email or entry.active is not None or entry.stable is None:
                continue
            if entry.stable.state == "sitting" and entry.stable.seat_key == seat_key:
                return email
        return None

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
                    **({"localOrigin": entry.active.local_origin} if entry.active.local_origin else {}),
                    **({"localPath": entry.active.local_path} if entry.active.local_path else {}),
                    "durationMs": entry.active.duration_ms,
                    "startedAt": entry.active.started_at,
                    "pacing": entry.active.pacing,
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
                    **({"localAt": {"x": stable.local_x, "y": stable.local_y}} if stable.local_x is not None and stable.local_y is not None else {}),
                    "updatedAt": stable.updated_at,
                    "yaw": stable.yaw,
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
            # It came FROM the database, so whatever this loop leaves in memory is already persisted.
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
                    yaw=row.get("yaw"),
                )
                self._revision_by_email[email] = max(self._revision_by_email.get(email, 0), db_revision)
            else:
                self._revision_by_email[email] = max(self._revision_by_email.get(email, 0), db_revision)
            entry.persisted = True

    def reset(self) -> None:
        """Test-only helper — mirrors the pattern socket tests use to clear other module-level
        singleton registries between tests (e.g. spatial_sessions.reset())."""
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
