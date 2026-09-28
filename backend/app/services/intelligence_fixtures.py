from __future__ import annotations

from dataclasses import dataclass

from app.models.meeting_intelligence import (
    ITEM_COMMITMENT,
    ITEM_DECISION,
    ITEM_KEY_POINT,
    ITEM_OPEN_LOOP,
    ITEM_SUMMARY,
    ITEM_TOPIC,
)
from app.services.intelligence_generator import ItemDraft, TranscriptEvidence

# PHASE 7B — DEVELOPMENT FIXTURES for the FakeGenerator. Each is a short transcript plus the understanding a
# real generator is expected to produce from it, written by hand. They prove the CONTRACT (what a
# decision / commitment / open loop is, how evidence and owners are cited); they are not a phrase matcher.
# A fixture applies only when the transcript is EXACTLY its lines (case and spacing aside) with one
# distinct speaker per role. Output is bound to the real transcript: `ev` indexes become segment ids,
# `owner_at` becomes that segment's persisted speaker, and {A}/{B}/… become that role's display name.
#
# What they demonstrate:
#   launch-planning  "We could launch Thursday" + "Maybe, let's think about it" → no decision; "Okay, let's
#                    launch Friday" + "Agreed" → decision. "What are we charging?" later answered → not open.
#                    "Jan, can you check deployment?" + Jan's "Yes, I'll check it this afternoon" → Jan's
#                    commitment with its timeframe. "Bon should handle …" said by someone else → no Bon
#                    commitment, an unowned open loop. "I can probably take a look" → NOT a commitment
#                    (and nothing else: it is not independently an open issue). "Who will approve pricing?"
#                    never answered → open.
#   hedged-offers    "I'll send the release notes tomorrow" → commitment. "I might be able to do it" and "I
#                    can look into it if needed" → no commitment; the changelog stays an unowned open loop
#                    because the meeting said someone needs to do it and nobody took it.
#   undecided-launch a suggestion and a deferral → no decision, a deferred-decision open loop.
#   unanswered-request a request nobody accepts → no commitment, an unowned-action open loop.


@dataclass(frozen=True)
class _Item:
    item_type: str
    content: dict
    ev: tuple[int, ...] = ()
    confidence: float | None = 0.9
    uncertainty: str | None = None
    owner_at: int | None = None


@dataclass(frozen=True)
class Fixture:
    name: str
    #: (role, text) in transcript order
    lines: tuple[tuple[str, str], ...]
    items: tuple[_Item, ...]


FIXTURES: dict[str, Fixture] = {
    f.name: f
    for f in (
        Fixture(
            name="launch-planning",
            lines=(
                ("A", "Let's plan the launch. First question is the date."),  # 0
                ("B", "We could launch Thursday."),  # 1
                ("A", "Maybe, let's think about it."),  # 2
                ("B", "Thursday clashes with the client demo though."),  # 3
                ("A", "Okay, let's launch Friday."),  # 4
                ("B", "Agreed, Friday it is."),  # 5
                ("A", "What are we charging?"),  # 6
                ("B", "Twenty dollars feels right to me."),  # 7
                ("A", "Yes, we agreed on $20."),  # 8
                ("A", "Jan, can you check deployment?"),  # 9
                ("A", "Bon should handle the homepage copy."),  # 10
                ("J", "Yes, I'll check it this afternoon."),  # 11
                ("M", "I can probably take a look at the pricing page."),  # 12
                ("A", "Who will approve pricing?"),  # 13
                ("B", "Good question, not sure yet."),  # 14
                ("A", "Okay, let's wrap up."),  # 15
            ),
            items=(
                _Item(
                    ITEM_SUMMARY,
                    {
                        "text": "{A} led launch planning with {B}, {J} and {M}. Thursday was ruled out because it "
                        "clashes with the client demo, and the team agreed to launch on Friday at a $20 price. "
                        "{J} will check deployment this afternoon. {M} mentioned possibly looking at the pricing "
                        "page without committing. Who approves pricing, and who owns the homepage copy, were "
                        "left open."
                    },
                    confidence=None,
                ),
                _Item(ITEM_TOPIC, {"text": "Launch date"}, ev=(1, 3, 4)),
                _Item(ITEM_TOPIC, {"text": "Pricing"}, ev=(6, 8, 13)),
                _Item(ITEM_TOPIC, {"text": "Launch follow-ups"}, ev=(9, 10, 12)),
                _Item(
                    ITEM_DECISION,
                    {"text": "Launch on Friday.", "rationale": "{A} proposed Friday and {B} agreed; the earlier "
                     "Thursday suggestion was not adopted."},
                    ev=(4, 5),
                ),
                _Item(
                    ITEM_DECISION,
                    {"text": "Price at $20.", "rationale": "{B} proposed twenty dollars and {A} stated the team "
                     "agreed on $20."},
                    ev=(6, 7, 8),
                ),
                _Item(
                    ITEM_COMMITMENT,
                    {"text": "{J} will check deployment this afternoon.", "action": "Check deployment",
                     "deadline": "this afternoon", "rationale": "{A} asked {J}; {J} accepted."},
                    ev=(9, 11),
                    owner_at=11,
                ),
                _Item(
                    ITEM_OPEN_LOOP,
                    {"text": "Who will approve pricing is unresolved.", "kind": "unanswered_question"},
                    ev=(13, 14),
                ),
                _Item(
                    ITEM_OPEN_LOOP,
                    {"text": "Nobody accepted ownership of the homepage copy.", "kind": "unowned_action",
                     "rationale": "{A} said {B} should handle it; {B} did not respond to it."},
                    ev=(10,),
                    confidence=0.6,
                    uncertainty="{B} may have accepted outside the meeting; the transcript shows no reply.",
                ),
                _Item(ITEM_KEY_POINT, {"text": "Thursday clashes with the client demo."}, ev=(3,)),
            ),
        ),
        Fixture(
            name="undecided-launch",
            lines=(("A", "We could launch Thursday."), ("B", "Maybe, let's think about it.")),
            items=(
                _Item(ITEM_SUMMARY, {"text": "{A} suggested a Thursday launch; {B} deferred the decision."},
                      confidence=None),
                _Item(ITEM_TOPIC, {"text": "Launch date"}, ev=(0,)),
                _Item(
                    ITEM_OPEN_LOOP,
                    {"text": "The launch date was not decided.", "kind": "deferred_decision",
                     "rationale": "Thursday was suggested, then deferred."},
                    ev=(0, 1),
                ),
            ),
        ),
        Fixture(
            name="hedged-offers",
            lines=(
                ("A", "Someone needs to update the changelog."),  # 0
                ("B", "I might be able to do it."),  # 1
                ("M", "I can look into it if needed."),  # 2
                ("J", "I'll send the release notes tomorrow."),  # 3
            ),
            items=(
                _Item(ITEM_SUMMARY, {"text": "{J} will send the release notes tomorrow. The changelog update "
                                     "was raised, but nobody committed to it."}, confidence=None),
                _Item(ITEM_TOPIC, {"text": "Release notes and changelog"}, ev=(0, 3)),
                _Item(
                    ITEM_COMMITMENT,
                    {"text": "{J} will send the release notes tomorrow.", "action": "Send the release notes",
                     "deadline": "tomorrow"},
                    ev=(3,),
                    owner_at=3,
                ),
                _Item(
                    ITEM_OPEN_LOOP,
                    {"text": "The changelog update has no owner.", "kind": "unowned_action",
                     "rationale": "It was raised as needed; the replies were hedged offers, not acceptances."},
                    ev=(0, 1, 2),
                ),
            ),
        ),
        Fixture(
            name="unanswered-request",
            lines=(("A", "Jan, can you check deployment?"), ("B", "Let's move on to the next item.")),
            items=(
                _Item(ITEM_SUMMARY, {"text": "{A} asked for a deployment check; nobody took it on."},
                      confidence=None),
                _Item(
                    ITEM_OPEN_LOOP,
                    {"text": "The deployment check has no owner.", "kind": "unowned_action",
                     "rationale": "It was requested but not accepted."},
                    ev=(0, 1),
                ),
            ),
        ),
    )
}


def _norm(text: str) -> str:
    return " ".join(text.lower().split())


def _roles(fixture: Fixture, segs: tuple[TranscriptEvidence, ...]) -> dict[str, TranscriptEvidence] | None:
    """role → the first segment of that role, if every role is one distinct speaker; else None."""
    first: dict[str, TranscriptEvidence] = {}
    for (role, _), seg in zip(fixture.lines, segs):
        kept = first.setdefault(role, seg)
        if kept.speaker_email != seg.speaker_email:
            return None
    if len({s.speaker_email for s in first.values()}) != len(first):
        return None
    return first


def _fill(value, names: dict[str, str]):
    return value.format_map(names) if isinstance(value, str) else value


def understand(segs: tuple[TranscriptEvidence, ...]) -> list[ItemDraft] | None:
    """The fixture understanding of `segs`, or None when the transcript is not a fixture."""
    texts = [_norm(s.text) for s in segs]
    for fixture in FIXTURES.values():
        if texts != [_norm(t) for _, t in fixture.lines]:
            continue
        roles = _roles(fixture, segs)
        if roles is None:
            continue
        names = {r: s.speaker_name or s.speaker_email for r, s in roles.items()}
        drafts = []
        for it in fixture.items:
            content = {k: _fill(v, names) for k, v in it.content.items()}
            if it.owner_at is not None:
                content["ownerEmail"] = segs[it.owner_at].speaker_email
            drafts.append(
                ItemDraft(
                    item_type=it.item_type,
                    content=content,
                    evidence_segment_ids=tuple(segs[i].segment_id for i in it.ev),
                    confidence=it.confidence,
                    uncertainty=_fill(it.uncertainty, names),
                )
            )
        return drafts
    return None
