from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app import database as app_db
from app.config import settings
from app.models.toucan import ToucanDelegation
from app.repositories import toucan_delegation as delegation_repo
from app.services.delegation_events import emit_delegation_ended

# A2.3 — THE DELEGATION LIFECYCLE'S TWO CLOCKS, and nothing else.
#
#   * RETURN. mark_owner_returned is the single entry point every "the owner is back" signal
#     uses (socket connect after a proven absence, explicit come_online, an owner's own chat
#     message, an owner's Toucan question). It ends ONLY an until_return delegation, with
#     reason "returned", through the repository's one return function — no signal-specific
#     lifecycle logic exists anywhere else.
#   * SWEEP. One process-wide periodic task ends expired / hard-capped rows even when nobody
#     sends a message or opens the panel. Lazy expiry on every read stays as the second wall;
#     the repository's conditional UPDATE guarantees the two walls end a row exactly once.
#
# Both emit delegation_ended to the owner's user room only, via delegation_events. Neither reads
# any message, conversation, presence snapshot or office context: identities and timestamps in,
# row endings out.

logger = logging.getLogger(__name__)


async def mark_owner_returned_in(
    session: AsyncSession, owner_email: str, *, now: datetime | None = None
) -> ToucanDelegation | None:
    """Return-signal entry point for callers that already hold a session (the Toucan router)."""
    return await delegation_repo.end_until_return_for_owner(
        session, owner_email=owner_email, now=now, on_ended=emit_delegation_ended
    )


async def mark_owner_returned(owner_email: str, *, now: datetime | None = None) -> ToucanDelegation | None:
    """Return-signal entry point for the socket layer. Opens its own session and never raises:
    presence bookkeeping must not be able to break a connection or a message send."""
    try:
        async with app_db.async_session_maker() as session:
            ended = await mark_owner_returned_in(session, owner_email, now=now)
        if ended is not None:
            logger.info("toucan delegation ended on return: owner=%s delegation=%s", ended.owner_email, ended.id)
        return ended
    except Exception:
        logger.exception("toucan return detection failed for %s", owner_email)
        return None


_pending: set[asyncio.Task] = set()


def schedule_owner_returned(owner_email: str) -> asyncio.Task:
    """Fire-and-forget form for hot paths (a chat send): the human message must never wait on it."""
    task = asyncio.create_task(mark_owner_returned(owner_email))
    _pending.add(task)
    task.add_done_callback(_pending.discard)
    return task


async def sweep_once(now: datetime | None = None) -> int:
    """End every expired or hard-capped active delegation; return how many. Safe with none."""
    async with app_db.async_session_maker() as session:
        ended = await delegation_repo.expire_stale_delegations(session, now=now, on_ended=emit_delegation_ended)
    if ended:
        logger.info("toucan delegation sweep ended %d delegation(s)", len(ended))
    return len(ended)


class DelegationSweeper:
    """The one periodic task. start() is idempotent; stop() cancels and awaits it. An interval of
    zero or less disables the sweep entirely (lazy expiry alone then applies)."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self, interval_seconds: float | None = None) -> None:
        interval = settings.TOUCAN_DELEGATION_SWEEP_SECONDS if interval_seconds is None else interval_seconds
        if interval <= 0 or self.running:
            return
        self._task = asyncio.create_task(self._run(interval), name="toucan-delegation-sweep")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            logger.debug("toucan delegation sweep stopped")
        except Exception:
            logger.exception("toucan delegation sweep task ended with an error")

    async def _run(self, interval: float) -> None:
        while True:
            await asyncio.sleep(interval)
            try:
                await sweep_once()
            except Exception:
                logger.exception("toucan delegation sweep failed")


delegation_sweeper = DelegationSweeper()
