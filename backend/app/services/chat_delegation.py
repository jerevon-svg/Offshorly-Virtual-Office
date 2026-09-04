from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app import database as app_db
from app.config import settings
from app.repositories import chat as chat_repo
from app.repositories import toucan_delegation as delegation_repo
from app.repositories import toucan_urgency as urgency_repo
from app.services.chat_send import (
    TOUCAN_CHAT_SENDER,
    ChatSendError,
    is_toucan_sender,
    send_chat_message,
)
from app.services.delegation_events import emit_delegation_ended, emit_delegation_urgent_flagged
from app.services.toucan.delegation import (
    SCOPE_DM_AND_GROUPS,
    combined_first_reply_text,
    combined_follow_up_reply_text,
    display_name_from_email,
)
from app.services.toucan.delegation_grounding import (
    build_evidence_window,
    grounded_reply_text,
    has_owner_evidence,
    is_retrieval_question,
    strip_mentions,
    validate_grounded_answer,
)
from app.services.toucan.urgency import (
    URGENCY_AFFIRMATIVE,
    URGENCY_EXPLICIT,
    URGENCY_NEGATIVE,
    classify_urgency_reply,
    urgent_flagged_reply_text,
)
from app.services.toucan_ai.provider import ai_enabled, generate_delegated_answer

# A2.1 — TOUCAN ANSWERING A DM ON SOMEBODY'S BEHALF, deterministically.
# A2.2 — and a GROUP message, but only one that carries a SERVER-VALIDATED @mention of the owner
# (the saved message's stored mention list, never re-parsed text), only for a delegation whose
# scope includes groups, and with ONE combined reply when several mentioned owners qualify.
#
# WHAT THIS IS: after a HUMAN message has gone through the ordinary send path untouched, the
# socket handler schedules evaluate_and_reply as a background task (same shape as A1.4.2's
# schedule_reply). If the OTHER participant of that DM has an active, unexpired delegation,
# Toucan posts one fixed acknowledgement into the same conversation as the reserved author,
# through the same persist + fan-out seam every message uses.
#
# THE PRIVACY BOUNDARY, restated as code:
#   * The DETERMINISTIC path reads no message bodies: the acknowledgement is a template keyed only
#     on the OWNER's email. It is what every reply was through A2.3 and what every reply still is
#     whenever the grounded path below declines.
#   * A2.4's GROUNDED path may run only for ONE eligible owner, only for a short, plainly
#     retrieval-shaped question with no decision/commitment/opinion marker, and only after
#     membership has been re-verified. It then reads the bounded LATEST window of THIS
#     conversation (the same SQL-limited read A1.4.3 uses), hands the provider exactly that window
#     plus the question, and accepts the answer only if every cited message is inside that window
#     and at least one was written by the owner. Anything else → the acknowledgement.
#   * Nothing here touches office context, roster, memories, other conversations, hub or feed.
#   * Writes nothing but the chat reply and the delegation's reply counter.
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

    # --- A3 — what the gate remembers that urgency needs ------------------------------------

    def already_handled(self, conversation_id: str, owner_email: str, delegation_id: str, message_id: str | None) -> bool:
        entry = self._entries.get(self._key(conversation_id, owner_email))
        return bool(
            entry and entry.delegation_id == delegation_id and message_id and message_id in entry.handled_message_ids
        )

    def question_outstanding(
        self, conversation_id: str, owner_email: str, delegation_id: str, *, now: datetime | None = None
    ) -> bool:
        """Has Toucan spoken for this owner in this conversation recently enough that a bare "yes"
        reads as the answer to its "Is this urgent?"? Process-local like the rest of the gate: a
        restart forgets the question, and a bare "yes" after one is an ordinary message (explicit
        markers never depend on this)."""
        entry = self._entries.get(self._key(conversation_id, owner_email))
        if entry is None or entry.delegation_id != delegation_id or entry.replies < 1:
            return False
        current = now or _utc_now()
        return (current - entry.last_reply_at).total_seconds() <= settings.TOUCAN_URGENCY_WINDOW_SECONDS

    def owners_asked_in(self, conversation_id: str, *, now: datetime | None = None) -> list[str]:
        """Owners with an outstanding question in this conversation — how a group "yes" with no
        fresh @mention finds who it answers."""
        current = now or _utc_now()
        return sorted(
            owner
            for (conv, owner), entry in self._entries.items()
            if conv == conversation_id
            and entry.replies >= 1
            and (current - entry.last_reply_at).total_seconds() <= settings.TOUCAN_URGENCY_WINDOW_SECONDS
        )

    def reset(self) -> None:
        """Test hook, mirroring the other registries."""
        self._entries.clear()


reply_gate = DelegationReplyGate()


async def evaluate_and_reply(
    conversation_id: str,
    sender_email: str,
    message_id: str | None,
    mentioned: list[str] | None = None,
    text: str | None = None,
) -> dict | None:
    """Decide whether the human message just saved into `conversation_id` earns an automatic
    Toucan reply on behalf of the OTHER participant, and send it. Every condition is re-checked
    here, at reply time, against the database: DM only, sender is human and not the owner, the
    owner is (still) a participant, the owner's delegation is active and unexpired, the gate
    allows. Never raises: the human message stands on its own.

    A3 — before the acknowledgement, the message is read for what it SAYS about urgency (a
    deterministic classifier, never the provider). A declared-urgent message records one durable
    flag per owner and earns one confirmation instead of the acknowledgement; a bare "no" to
    Toucan's own question earns silence; everything else is exactly the A2 path."""
    if not conversation_id or is_toucan_sender(sender_email):
        return None
    sender = sender_email.strip().lower()
    try:
        async with app_db.async_session_maker() as session:
            conv = await chat_repo.get_conversation_by_id(session, conversation_id)
            if conv is None:
                return None
            kind = conv.get("type")
            members = [p for p in conv.get("participant_ids", []) if p]
            if sender not in members:
                return None
            verdict = classify_urgency_reply(text)
            tagged: set[str] = set()
            if kind == "dm":
                candidates = [p for p in members if p != sender]
            elif kind == "group":
                # ONLY the stored, membership-validated mention list decides who was addressed.
                tagged = {m.strip().lower() for m in (mentioned or []) if isinstance(m, str)}
                candidates = [p for p in members if p in tagged and p != sender]
                if verdict is not None:
                    # A3 — a reply to Toucan's own question rarely re-@mentions the owner. Owners
                    # Toucan recently spoke for HERE are candidates for the urgency path only;
                    # the A2 acknowledgement below still requires the validated mention.
                    asked = set(reply_gate.owners_asked_in(conversation_id))
                    candidates = sorted(set(candidates) | {p for p in members if p in asked and p != sender})
            else:
                return None
            if not candidates:
                return None
            live = await delegation_repo.active_delegations_for_owners(
                session, candidates, on_ended=emit_delegation_ended
            )
            eligible = sorted(
                (
                    d for d in live
                    if d.owner_email in candidates
                    and d.owner_email != sender
                    and (kind == "dm" or d.scope == SCOPE_DM_AND_GROUPS)
                ),
                key=lambda d: d.owner_email,
            )
            if not eligible:
                return None
            # A3 — urgency first. Returns the reply it sent, None for deliberate silence, or the
            # sentinel to carry on with the A2 acknowledgement.
            if verdict is not None:
                outcome = await _handle_urgency(
                    session,
                    conversation_id=conversation_id,
                    kind=kind,
                    sender=sender,
                    message_id=message_id,
                    verdict=verdict,
                    eligible=eligible,
                    tagged=tagged,
                )
                if outcome is not _NOT_HANDLED:
                    return outcome
            # A2 — exactly as before: in a group only the validated mention earns the acknowledgement.
            addressed = [d for d in eligible if kind == "dm" or d.owner_email in tagged]
            included = [
                d for d in addressed if reply_gate.allows(conversation_id, d.owner_email, d.id, message_id)
            ]
            if not included:
                if addressed:
                    logger.info("toucan delegated reply suppressed by gate: conversation=%s", conversation_id)
                return None
            owners = [d.owner_email for d in included]
            first = any(reply_gate.replies_so_far(conversation_id, d.owner_email, d.id) == 0 for d in included)
            reply = combined_first_reply_text(owners) if first else combined_follow_up_reply_text(owners)
            # A2.4 — a grounded answer, for exactly one owner, only when every wall lets it through.
            if len(included) == 1:
                grounded = await _grounded_answer(session, conversation_id, owners[0], message_id, text)
                if grounded:
                    reply = grounded
            # Record BEFORE sending so a concurrent evaluation for the same conversation cannot
            # slip a second reply through while this one is in flight.
            for d in included:
                reply_gate.record(conversation_id, d.owner_email, d.id, message_id)
            saved = await send_chat_message(
                session, conversation_id=conversation_id, sender_email=TOUCAN_CHAT_SENDER, text=reply
            )
            for d in included:
                await delegation_repo.record_reply(session, d)
            logger.info(
                "toucan delegated reply sent: owners=%s conversation=%s kind=%s",
                ",".join(owners), conversation_id, kind,
            )
            return saved
    except ChatSendError as err:
        logger.info("toucan delegated reply skipped: %s", err.code)
    except Exception:
        logger.exception("toucan delegated reply failed")
    return None


# Sentinel: "urgency had nothing to say about this message — run the A2 path".
_NOT_HANDLED = object()


async def _handle_urgency(
    session,
    *,
    conversation_id: str,
    kind: str,
    sender: str,
    message_id: str | None,
    verdict: str,
    eligible: list,
    tagged: set[str],
) -> dict | None | object:
    """A3 — turn a declared urgency into durable flags and ONE confirmation.

    Who qualifies, per eligible owner:
      * EXPLICIT marker  → the owner was addressed (DM, validated @mention) OR Toucan's question
                           to them is outstanding here.
      * bare AFFIRMATIVE → only an outstanding question. "yes" to nothing is nothing.
      * bare NEGATIVE    → an outstanding question earns silence (it was answered); otherwise the
                           message is ordinary and the A2 path runs.

    Idempotent end to end: a flag already on file means no new flag, no event, no confirmation.
    A duplicate explicit message then falls through to the A2 acknowledgement (subject to its
    gate); a duplicate "yes" stays silent. A bare "yes" with no question outstanding is an
    ordinary message and takes the A2 path. The confirmation bypasses the cooldown and cap — it is
    bounded on its own by one flag per (delegation, conversation, requester) — but still counts
    as a reply, so the A2 budget only ever shrinks."""
    outstanding = {
        d.owner_email: reply_gate.question_outstanding(conversation_id, d.owner_email, d.id) for d in eligible
    }
    if verdict == URGENCY_NEGATIVE:
        return None if any(outstanding.values()) else _NOT_HANDLED
    qualifying = [
        d for d in eligible
        if not reply_gate.already_handled(conversation_id, d.owner_email, d.id, message_id)
        and (
            outstanding[d.owner_email]
            or (verdict == URGENCY_EXPLICIT and (kind == "dm" or d.owner_email in tagged))
        )
    ]
    if not qualifying:
        # Nothing to answer and nobody addressed: an ordinary message, A2 decides.
        return _NOT_HANDLED
    created = []
    for d in qualifying:
        flag, is_new = await urgency_repo.record_urgent_flag(
            session,
            delegation=d,
            conversation_id=conversation_id,
            requester_email=sender,
            message_reference=message_id,
        )
        if is_new:
            created.append((d, flag))
    if not created:
        return _NOT_HANDLED if verdict == URGENCY_EXPLICIT else None
    owners = [d.owner_email for d, _ in created]
    for d, _ in created:
        reply_gate.record(conversation_id, d.owner_email, d.id, message_id)
    saved = await send_chat_message(
        session, conversation_id=conversation_id, sender_email=TOUCAN_CHAT_SENDER, text=urgent_flagged_reply_text(owners)
    )
    for d, flag in created:
        await delegation_repo.record_reply(session, d)
        count = await urgency_repo.count_unseen_for_delegation(session, delegation_id=d.id, owner_email=d.owner_email)
        await emit_delegation_urgent_flagged(flag, urgent_count=count)
    logger.info(
        "toucan urgency flagged: owners=%s conversation=%s kind=%s verdict=%s",
        ",".join(owners), conversation_id, kind, verdict,
    )
    return saved


async def _grounded_answer(
    session, conversation_id: str, owner: str, message_id: str | None, text: str | None
) -> str | None:
    """A2.4 — try to answer a simple retrieval question with what the owner already said HERE.
    Returns the full reply text, or None for the deterministic acknowledgement. Called only after
    eligibility (membership, live delegation, gate) is established. Never raises."""
    if not settings.TOUCAN_DELEGATION_GROUNDED_ANSWERS or not text or not ai_enabled():
        return None
    question = strip_mentions(text)
    if not is_retrieval_question(question):
        return None
    try:
        # The ONE read: the bounded latest window of THIS conversation (+1 so the incoming
        # question does not cost a slot), exactly as A1.4.3 reads it.
        recent = await chat_repo.list_recent_messages(
            session, conversation_id, settings.TOUCAN_CHAT_WINDOW_MESSAGES + 1
        )
        window = build_evidence_window(
            recent,
            owner_email=owner,
            incoming_id=message_id,
            exclude_sender=TOUCAN_CHAT_SENDER,
            max_messages=settings.TOUCAN_CHAT_WINDOW_MESSAGES,
            max_message_chars=settings.TOUCAN_CHAT_MAX_MESSAGE_CHARS,
            max_total_chars=settings.TOUCAN_CHAT_MAX_CONTEXT_CHARS,
        )
        if not has_owner_evidence(window):
            return None  # nothing the owner said → nothing to retrieve; no provider call
        result = await generate_delegated_answer(question, display_name_from_email(owner), window)
        answer = validate_grounded_answer(result, window, owner)
        if answer is None:
            return None
        logger.info("toucan delegated grounded answer: owner=%s conversation=%s", owner, conversation_id)
        return grounded_reply_text(owner, answer)
    except Exception:
        logger.exception("toucan delegated grounded answer failed; falling back")
        return None


# Background tasks are kept referenced until done so the event loop cannot garbage-collect them.
_pending: set[asyncio.Task] = set()


def schedule_delegation_reply(
    conversation_id: str,
    sender_email: str,
    message_id: str | None,
    mentioned: list[str] | None = None,
    text: str | None = None,
) -> asyncio.Task:
    task = asyncio.create_task(evaluate_and_reply(conversation_id, sender_email, message_id, mentioned, text))
    _pending.add(task)
    task.add_done_callback(_pending.discard)
    return task
