from __future__ import annotations

import asyncio
import dataclasses
import logging
import re
import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting_intelligence import ITEM_COMMITMENT, ITEM_DECISION, ITEM_OPEN_LOOP
from app.repositories import meeting_intelligence as intel_repo
from app.services import org_twin_generator, organizational_memory
from app.services.intelligence_generator import GeneratorUnavailable
from app.services.meeting_twin import MAX_QUESTION, TwinError, _norm, _prior, _Rate
from app.services.org_twin_generator import (
    INTENT_COMMITMENT,
    INTENT_DECISION,
    INTENT_DISCUSSION,
    INTENT_OPEN,
    INTENT_WHICH,
    INTENT_WHY,
    OrgTwinAnswerDraft,
    OrgTwinGenerator,
    OrgTwinInput,
    OrgTwinPlan,
)
from app.services.organizational_memory import OrganizationalMemoryContext, OrgMemoryError
from app.services.twin_generator import STATUS_GROUNDED, STATUS_INSUFFICIENT, STATUSES, PriorTurn

# PHASE 9B — ORGANIZATIONAL TWIN: "ask your Memory". One question across the caller's Meeting Memory, answered
# only from what Phase 9A retrieval returns for THIS authenticated caller, with the memories and transcript
# lines each part rests on. (8B's Meeting Twin is "ask this meeting"; both reuse the same conventions.)
#
# ORDER IS THE RULE:
#   1. validate the question and the bounded prior turns; the generator must exist; per-caller rate limit;
#   2. PLAN (`plan`, below): a small deterministic classifier turns the question into retrieval terms, an
#      intent and — for "I / me / my" — the authenticated caller as the commitment owner. Never a display name
#      from the client, never a name found in meeting text. A follow-up with no words of its own ("Which meeting
#      was that?", "Why?") borrows the terms of the previous QUESTION — never of an answer. If nothing
#      meaningful can be searched, the answer is an honest "say more", not a search of everything;
#   3. RETRIEVE through 9A only (organizational_memory.build_context): meeting_access decides the scope before
#      any content loads; rejected items, hidden meetings and other sessions' lines never arrive;
#   4. GENERATE over that OrganizationalMemoryContext alone — the generator has no database, no session ids to
#      ask for, no room, no meeting_access;
#   5. ACCEPT the answer whole or not at all (`_accept`): every ref must be one 9A supplied (context.resolve),
#      every cited line must be that same memory's evidence AND owned by its session in the database, a
#      grounded answer must cite. Anything else → `answer_rejected`.
#
# From the caller's side only their authorized Memory exists: nothing here says, or varies with, whether some
# other meeting might hold an answer. NOTHING IS STORED — no conversation, question or answer; logs carry
# codes only.

_logger = logging.getLogger(__name__)

MAX_ANSWER = 1500
MAX_UNCERTAINTY = 500
MAX_REFS = 12
MAX_CITATIONS = 24
RETRIEVAL_LIMIT = 12
TWIN_TIMEOUT_S = 30.0
RATE_LIMIT = 12
RATE_WINDOW_S = 60.0

rate = _Rate(RATE_LIMIT, RATE_WINDOW_S)

REASON_NO_MEMORIES = "no_memories"
REASON_UNCLEAR = "unclear"


# ---- 2. query planning --------------------------------------------------------------------------------------

_WHICH = re.compile(r"\b(?:which|what) (?:meeting|meetings|call|sync)\b|\bwhen (?:was|did|were)\b|\bwhere (?:was|did)\b")
_WHY = re.compile(r"^\s*why\b|\bwhat was the reason\b|\breasons?\b|\bwhat led\b")
_COMMIT = re.compile(
    r"\b(?:agree(?:d)? to|promis\w*|commit\w*|responsib\w*|signed up|volunteer\w*|take on|took on|action items?|owe)\b"
)
_OPEN = re.compile(r"\b(?:unresolved|open|outstanding|pending|undecided|unanswered|resolved)\b")
_DECIDE = re.compile(r"\b(?:decid\w*|decision\w*|agreed on|conclu\w*|land(?:ed)? on|chose|settled|chang\w*)\b")
_DISCUSS = re.compile(r"\b(?:discuss\w*|talk\w*|mention\w*|came up|come up|said|say)\b")
_SELF = re.compile(r"\b(?:i|me|my|mine|myself|i'm|i've)\b")
_PRONOUN = re.compile(r"\b(?:that|it|this|those|them|there)\b")

# Words that carry the intent (above) or nothing at all — never retrieval terms.
_FILLER = frozenset(
    """am me my mine myself you your still ever any anything everything something things thing stuff about around
    regarding re so far yet lately recent recently happened happen happening tell show list know please can could
    would should will been being there their they them those these it its one ones all get got made make up out
    just really also meeting meetings call calls sync which why reason reasons led lead when where who whom whose
    decide decided decides deciding decision decisions agree agreed agreement agreements commit commits committed
    commitment commitments responsible responsibility responsibilities promise promised unresolved open
    outstanding pending undecided unanswered resolved discuss discussed discussing discussion discussions talk
    talked talking mention mentioned say said change changed changes action actions items item left remaining
    remain owe need needs""".split()
)


def _stem(word: str) -> str:
    """A tiny, explainable suffix trim so "moved" finds "move" and "pricing" finds "price" (9A matches substrings)."""
    for suffix in ("ing", "ed", "s"):
        if len(word) >= 5 and word.endswith(suffix) and not word.endswith("ss"):
            return word[: -len(suffix)]
    return word


def _terms(question: str) -> tuple[str, ...]:
    words = organizational_memory._TOKEN.findall(" ".join(question.split()).casefold())
    kept = [_stem(w) for w in words
            if len(w) >= 2 and w not in organizational_memory._STOPWORDS and w not in _FILLER]
    return tuple(dict.fromkeys(kept))[: organizational_memory.MAX_TOKENS]


def _intent(q: str) -> tuple[str | None, str | None]:
    """(intent, what a which/why question is about)."""
    found = [name for name, rx in ((INTENT_COMMITMENT, _COMMIT), (INTENT_OPEN, _OPEN), (INTENT_DECISION, _DECIDE))
             if rx.search(q)]
    about = found[0] if found else None
    if _WHICH.search(q):
        return INTENT_WHICH, about
    if _WHY.search(q):
        return INTENT_WHY, about or INTENT_DECISION
    if found:
        return found[0], None
    if _DISCUSS.search(q):
        return INTENT_DISCUSSION, None
    return None, None


_BROWSABLE = frozenset({INTENT_DECISION, INTENT_OPEN, INTENT_COMMITMENT})


def plan(question: str, prior: tuple[PriorTurn, ...] = ()) -> OrgTwinPlan | None:
    """The retrieval plan for `question`, or None when it gives nothing meaningful to search for."""
    q = question.casefold()
    intent, about = _intent(q)
    terms = _terms(question)
    about_self = bool(_SELF.search(q))
    if terms:
        return OrgTwinPlan(intent or INTENT_DISCUSSION, about, about_self, terms)
    if intent in _BROWSABLE and not _PRONOUN.search(q):
        return OrgTwinPlan(intent, None, about_self, ())  # "What have we decided recently?"
    if intent is None and not _PRONOUN.search(q):
        return None
    # A follow-up with no subject of its own: the previous QUESTION names it. Answers are never read.
    if not prior:
        return None
    before = plan(prior[-1].question, prior[:-1])
    if before is None:
        return None
    if intent in (INTENT_WHICH, INTENT_WHY):
        base = before.about if before.intent in (INTENT_WHICH, INTENT_WHY) else before.intent
        about = about or base
        if intent == INTENT_WHY:
            about = INTENT_DECISION
    else:
        intent, about = intent or before.intent, before.about
    return OrgTwinPlan(intent, about, about_self or before.about_self, before.terms, follow_up=True)


def _types(p: OrgTwinPlan) -> frozenset[str]:
    focus = p.about if p.intent == INTENT_WHICH else p.intent
    if focus == INTENT_COMMITMENT:
        return frozenset({ITEM_COMMITMENT})
    if focus == INTENT_OPEN:
        return frozenset({ITEM_OPEN_LOOP, ITEM_DECISION})  # a later decision may bear on an earlier open loop
    if focus == INTENT_DECISION and not p.terms:
        return frozenset({ITEM_DECISION})
    return frozenset()  # every type: a decision question must also be able to say "only discussed"


def _query(email: str, p: OrgTwinPlan) -> organizational_memory.OrganizationalMemoryQuery:
    types = _types(p)
    focus = p.about if p.intent == INTENT_WHICH else p.intent
    owner = email if focus == INTENT_COMMITMENT and p.about_self else None
    if p.terms:
        q = organizational_memory.parse_query(email, " ".join(p.terms), types=types, limit=RETRIEVAL_LIMIT)
        return dataclasses.replace(q, owner_email=owner)
    return organizational_memory.browse_query(email, types, owner_email=owner, limit=RETRIEVAL_LIMIT)


def _zone(name) -> str:
    """The asker's IANA zone if it is a real one, else UTC — it only names days, it never narrows or widens."""
    if not isinstance(name, str) or not 0 < len(name) <= 64:
        return "UTC"
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return "UTC"
    return name


# ---- 5. acceptance ------------------------------------------------------------------------------------------


def _plain(text: str, reason: str) -> dict:
    return {"status": STATUS_INSUFFICIENT, "answer": text, "uncertainty": None, "sources": [], "reason": reason}


def _nothing_found(p: OrgTwinPlan) -> dict:
    focus = p.about if p.intent == INTENT_WHICH else p.intent
    if focus == INTENT_COMMITMENT and p.about_self:
        return _plain("The meetings you can access don't record a commitment from you" +
                      (" on that." if p.terms else "."), REASON_NO_MEMORIES)
    return _plain("I couldn't find that in the meetings you can access.", REASON_NO_MEMORIES)


async def _accept(db: AsyncSession, ctx: OrganizationalMemoryContext, draft) -> dict:
    if not isinstance(draft, OrgTwinAnswerDraft) or draft.status not in STATUSES:
        raise TwinError("answer_rejected")
    text = draft.text.strip() if isinstance(draft.text, str) else ""
    if not text or len(text) > MAX_ANSWER:
        raise TwinError("answer_rejected")
    u = draft.uncertainty
    if u is not None and (not isinstance(u, str) or len(u) > MAX_UNCERTAINTY):
        raise TwinError("answer_rejected")
    if not isinstance(draft.refs, (tuple, list)) or len(draft.refs) > MAX_REFS:
        raise TwinError("answer_rejected")
    if not isinstance(draft.citations, (tuple, list)) or len(draft.citations) > MAX_CITATIONS:
        raise TwinError("answer_rejected")
    used = ctx.resolve(draft.refs)
    if used is None:
        raise TwinError("answer_rejected")  # a memory 9A did not supply — forged, hidden or another caller's
    by_ref = {m.ref: m for m in used}
    lines: dict[str, list[str]] = {m.ref: [] for m in used}
    for pair in draft.citations:
        if not isinstance(pair, (tuple, list)) or len(pair) != 2:
            raise TwinError("answer_rejected")
        ref, sid = pair
        m = by_ref.get(ref) if isinstance(ref, str) else None
        if m is None or not isinstance(sid, str) or sid not in {e.segment_id for e in m.evidence}:
            raise TwinError("answer_rejected")  # not that memory's own evidence (invented or cross-session)
        if sid not in lines[ref]:
            lines[ref].append(sid)
    if any(not ids for ids in lines.values()):
        raise TwinError("answer_rejected")  # every conclusion it names must have a line behind it
    if draft.status == STATUS_GROUNDED and not used:
        raise TwinError("answer_rejected")
    owners = await intel_repo.segment_session_ids(db, [sid for ids in lines.values() for sid in ids])
    if any(owners.get(sid) != by_ref[ref].meeting.session_id for ref, ids in lines.items() for sid in ids):
        raise TwinError("answer_rejected")  # defense in depth, from the database

    # Sources grouped by meeting, in the meetings' actual order; only the lines the answer cited.
    groups: dict[str, dict] = {}
    for m in sorted(used, key=lambda m: (m.meeting.started_at, m.meeting.session_id)):
        wire = organizational_memory.to_wire(m)
        meeting = wire.pop("meeting")
        for key in ("ref", "matchedOn"):
            wire.pop(key)
        cited = set(lines[m.ref])
        wire["evidence"] = sorted((e for e in wire["evidence"] if e["segmentId"] in cited),
                                  key=lambda e: e["startOffsetMs"])
        groups.setdefault(m.meeting.session_id, {"meeting": meeting, "memories": []})["memories"].append(wire)
    return {
        "status": draft.status,
        "answer": text,
        "uncertainty": u.strip() if u and u.strip() else None,
        "sources": list(groups.values()),
        "reason": None,
    }


async def ask(
    db: AsyncSession,
    email: str,
    *,
    question: str,
    history: list[tuple[str, str]] = (),
    generator: OrgTwinGenerator | None = None,
    now: float | None = None,
    time_zone: str | None = None,
) -> dict:
    email = _norm(email)
    q = question.strip() if isinstance(question, str) else ""
    if not email or not q or len(q) > MAX_QUESTION:
        raise TwinError("invalid_question")
    prior = _prior(list(history))
    try:
        gen = generator or org_twin_generator.resolve()
    except GeneratorUnavailable:
        raise TwinError("generator_unavailable") from None
    if not rate.allow(email, time.monotonic() if now is None else now):
        raise TwinError("rate_limited")

    p = plan(q, prior)
    if p is None:
        return _plain("I'm not sure what to look for. Could you name the topic, decision or project you mean?",
                      REASON_UNCLEAR)
    try:
        mq = _query(email, p)
    except OrgMemoryError:
        return _plain("I'm not sure what to look for. Could you name the topic, decision or project you mean?",
                      REASON_UNCLEAR)
    ctx = await organizational_memory.build_context(db, mq, q)
    if not ctx.memories:
        return _nothing_found(p)
    source = OrgTwinInput(context=ctx, plan=p, prior_turns=prior, time_zone=_zone(time_zone))
    try:
        draft = await asyncio.wait_for(gen.answer(source), timeout=TWIN_TIMEOUT_S)
    except asyncio.TimeoutError:
        _logger.warning("organizational twin: generator %s timed out", getattr(gen, "id", "?"))
        raise TwinError("twin_failed") from None
    except Exception:  # noqa: BLE001 — any generator error is a refusal, never a 500 (and never logged with content)
        _logger.warning("organizational twin: generator %s failed", getattr(gen, "id", "?"))
        raise TwinError("twin_failed") from None
    try:
        return await _accept(db, ctx, draft)
    except TwinError:
        _logger.warning("organizational twin: rejected an answer from %s", getattr(gen, "id", "?"))
        raise
