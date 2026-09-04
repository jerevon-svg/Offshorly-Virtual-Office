from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app import database as app_db
from app.config import settings
from app.repositories import chat as chat_repo
from app.repositories import toucan_delegation as delegation_repo
from app.services.chat_send import (
    TOUCAN_CHAT_SENDER,
    ChatSendError,
    is_toucan_sender,
    send_chat_message,
)
from app.services.toucan.delegation import first_reply_text, follow_up_reply_text

# A2.1 — TOUCAN ANSWERING A DM ON SOMEBODY'S BEHALF, deterministically.
#
# WHAT THIS IS: after a HUMAN message has gone through the ordinary send path untouched, the
# socket handler schedules evaluate_and_reply as a background task (same shape as A1.4.2's
# schedule_reply). If the OTHER participant of that DM has an active, unexpired delegation,
# Toucan posts one fixed acknowledgement into the same conversation as the reserved author,
# through the same persist + fan-out seam every message uses.
#
# WHAT THIS DELIBERATELY DOES NOT DO — the A2.1 privacy boundary, restated as code:
#   * reads no message bodies. Not the triggering message, not the history. The reply is a
#     template keyed only on the OWNER's email (for the "assisting Bon" prefix).
#   * calls no provider. There is no import of toucan_ai here and nothing to feed it.
#   * touches no office context, roster, memories, hub or feed.
#   * writes nothing but the chat reply and the delegation's reply counter.
#
# NO RECURSION BY CONSTRUCTION: the reply goes through send_chat_message directly, never through
# the socket `send_message` handler, so it can never re-enter this evaluation; a Toucan-authored
# sender is refused up front as a second wall; and the templates contain no "@toucan" token.
#
# SPAM GUARDS (process-local, see DelegationReplyGate): one reply per saved message, a cooldown
# between replies per (conversation, owner), and a hard cap on replies per delegation per
# conversation. The delegation itself is durable and authoritative; the gate only rate-limits.

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class _GateEntry:
    delegation_id: str
    last_reply_at: datetime
    replies: int = 1
    handled_message_ids: set[str] = field(default_factory=set)


class DelegationReplyGate:
    """Per-(conversation, owner) memory of what Toucan already said under a delegation. Process-
    local and ephemeral like every other registry in app/realtime/state.py: a restart forgets it,
    which at worst costs one extra acknowledgement, never a missed delegation end (that is the
    durable row's job)."""

    def __init__(self) -> None:
        self._entries: dict[tuple[str, str], _GateEntry] = {}

    @staticmethod
    def _key(conversation_id: str, owner_email: str) -> tuple[str, str]:
        return (conversation_id, owner_email.strip().lower())

    def replies_so_far(self, conversation_id: str, owner_email: str, delegation_id: str) -> int:
        entry = self._entries.get(self._key(conversation_id, owner_email))
        return entry.replies if entry and entry.delegation_id == delegation_id else 0

    def allows(
        self,
        conversation_id: str,
        owner_email: str,
        delegation_id: str,
        message_id: str | None,
        *,
        now: datetime | None = None,
    ) -> bool:
        current = now or _utc_now()
        entry = self._entries.get(self._key(conversation_id, owner_email))
        if entry is None or entry.delegation_id != delegation_id:
            return True
        if message_id and message_id in entry.handled_message_ids:
            return False
        if entry.replies >= settings.TOUCAN_DELEGATION_MAX_REPLIES_PER_CONVERSATION:
            return False
        return (current - entry.last_reply_at).total_seconds() >= settings.TOUCAN_DELEGATION_COOLDOWN_SECONDS

    def record(
        self,
        conversation_id: str,
        owner_email: str,
        delegation_id: str,
        message_id: str | None,
        *,
        now: datetime | None = None,
    ) -> None:
        current = now or _utc_now()
        key = self._key(conversation_id, owner_email)
        entry = self._entries.get(key)
        if entry is None or entry.delegation_id != delegation_id:
            entry = _GateEntry(delegation_id=delegation_id, last_reply_at=current, replies=0)
            self._entries[key] = entry
        entry.replies += 1
        entry.last_reply_at = current
        if message_id:
            entry.handled_message_ids.add(message_id)

    def reset(self) -> None:
        """Test hook, mirroring the other registries."""
        self._entries.clear()


reply_gate = DelegationReplyGate()


async def evaluate_and_reply(conversation_id: str, sender_email: str, message_id: str | None) -> dict | None:
    """Decide whether the human message just saved into `conversation_id` earns an automatic
    Toucan reply on behalf of the OTHER participant, and send it. Every condition is re-checked
    here, at reply time, against the database: DM only, sender is human and not the owner, the
    owner is (still) a participant, the owner's delegation is active and unexpired, the gate
    allows. Never raises: the human message stands on its own."""
    if not conversation_id or is_toucan_sender(sender_email):
        return None
    sender = sender_email.strip().lower()
    try:
        async with app_db.async_session_maker() as session:
            conv = await chat_repo.get_conversation_by_id(session, conversation_id)
            if conv is None or conv.get("type") != "dm":
                return None
            participants = [p for p in conv.get("participant_ids", []) if p and p != sender]
            if sender not in conv.get("participant_ids", []) or not participants:
                return None
            live = await delegation_repo.active_delegations_for_owners(session, participants)
            for delegation in live:
                owner = delegation.owner_email
                if owner == sender or owner not in participants:
                    continue
                if not reply_gate.allows(conversation_id, owner, delegation.id, message_id):
                    logger.info("toucan delegated reply suppressed by gate: conversation=%s", conversation_id)
                    return None
                first = reply_gate.replies_so_far(conversation_id, owner, delegation.id) == 0
                text = first_reply_text(owner) if first else follow_up_reply_text(owner)
                # Record BEFORE sending so a concurrent evaluation for the same conversation
                # cannot slip a second reply through while this one is in flight.
                reply_gate.record(conversation_id, owner, delegation.id, message_id)
                saved = await send_chat_message(
                    session, conversation_id=conversation_id, sender_email=TOUCAN_CHAT_SENDER, text=text
                )
                await delegation_repo.record_reply(session, delegation)
                logger.info(
                    "toucan delegated reply sent: owner=%s conversation=%s delegation=%s",
                    owner, conversation_id, delegation.id,
                )
                return saved
    except ChatSendError as err:
        logger.info("toucan delegated reply skipped: %s", err.code)
    except Exception:
        logger.exception("toucan delegated reply failed")
    return None


# Background tasks are kept referenced until done so the event loop cannot garbage-collect them.
_pending: set[asyncio.Task] = set()


def schedule_delegation_reply(conversation_id: str, sender_email: str, message_id: str | None) -> asyncio.Task:
    task = asyncio.create_task(evaluate_and_reply(conversation_id, sender_email, message_id))
    _pending.add(task)
    task.add_done_callback(_pending.discard)
    return task
