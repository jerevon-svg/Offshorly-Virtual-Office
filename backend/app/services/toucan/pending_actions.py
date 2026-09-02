from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.services.toucan.actions import SetStatusAction

# T8 — PENDING ACTION STATE: the gap between "proposed" and "confirmed", held server-side.
#
# IN-MEMORY, PER-PROCESS, AND TEMPORARY BY DESIGN — the same single-worker caveat as every
# ephemeral registry in this codebase (app/services/dnd_registry.py, spatial_session.py,
# app/realtime/state.py). A pending confirmation is seconds-lived, worthless across a restart,
# and owned by exactly one caller, so durable storage would buy nothing here; if the process
# restarts, every pending proposal simply becomes "not found or no longer available", which the
# confirm/cancel endpoints already word safely. No Redis, no multi-worker claims — that whole
# axis is docs/realtime-scaling-roadmap.md's problem, not T8's.
#
# THE PROPERTIES THE CONFIRMATION FLOW LEANS ON, all enforced right here:
#   * OPAQUE SERVER-GENERATED ID — a UUID4 minted at propose time; the client never chooses it.
#   * OWNER-BOUND — take()/cancel() require the same authenticated email that proposed. A
#     mismatch behaves exactly like an unknown id (None/False), so another user can neither
#     confirm, cancel, nor probe for existence.
#   * ARGS FROZEN SERVER-SIDE — the validated SetStatusAction is stored here at propose time
#     and is what executes. Confirm carries only the id; there is no channel through which the
#     args could be mutated between proposal and execution.
#   * ONE-TIME — take() POPS the entry, so a replayed confirm (or a confirm after cancel, or a
#     cancel after confirm) finds nothing.
#   * BOUNDED TTL — an expired entry is unusable and is purged rather than honoured.
#   * ONE PENDING PER OWNER — proposing again replaces the owner's previous pending action,
#     which both matches the UX (the newest confirmation card is the live one) and caps the
#     registry at one entry per active user.


@dataclass(frozen=True)
class PendingAction:
    id: str
    owner_email: str
    # Which transcript the eventual outcome line belongs to — ownership of the conversation is
    # re-verified against the bearer identity at confirm time in the router, like every other
    # conversation lookup.
    conversation_id: str
    action: SetStatusAction
    # The server-worded exact effect, frozen alongside the args it describes.
    summary: str
    expires_at: datetime


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PendingActionRegistry:
    def __init__(self) -> None:
        self._by_id: dict[str, PendingAction] = {}

    def propose(
        self,
        *,
        owner_email: str,
        conversation_id: str,
        action: SetStatusAction,
        summary: str,
        ttl_seconds: float,
        now: datetime | None = None,
    ) -> PendingAction:
        """Register one validated proposal and return it, replacing any pending action the same
        owner already had. `ttl_seconds` is passed in by the router (from settings) so this
        module stays configuration-free."""
        current = now or _utc_now()
        self._purge_expired(current)
        for existing_id, existing in list(self._by_id.items()):
            if existing.owner_email == owner_email:
                del self._by_id[existing_id]
        pending = PendingAction(
            id=str(uuid.uuid4()),
            owner_email=owner_email,
            conversation_id=conversation_id,
            action=action,
            summary=summary,
            expires_at=current + timedelta(seconds=ttl_seconds),
        )
        self._by_id[pending.id] = pending
        return pending

    def take(
        self, action_id: str, *, owner_email: str, now: datetime | None = None
    ) -> PendingAction | None:
        """Consume the pending action for execution — pops it, so it can happen at most once.
        Unknown id, someone else's id, and an expired id are all the same None; an owner
        mismatch deliberately leaves the entry in place so a guesser cannot burn somebody
        else's pending confirmation."""
        current = now or _utc_now()
        entry = self._by_id.get(action_id)
        if entry is None or entry.owner_email != owner_email:
            return None
        if current >= entry.expires_at:
            del self._by_id[action_id]
            return None
        del self._by_id[action_id]
        return entry

    def cancel(
        self, action_id: str, *, owner_email: str, now: datetime | None = None
    ) -> PendingAction | None:
        """Identical contract to take() — cancellation is just consumption with no execution."""
        return self.take(action_id, owner_email=owner_email, now=now)

    def _purge_expired(self, now: datetime) -> None:
        expired = [k for k, v in self._by_id.items() if now >= v.expires_at]
        for key in expired:
            del self._by_id[key]

    def reset(self) -> None:
        """Test hook, mirroring the other registries' reset/clear helpers."""
        self._by_id.clear()


# The process-wide instance the router uses — one per worker, like dnd_registry et al.
pending_actions = PendingActionRegistry()
