from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

# Toucan T2 — THE SHAPE OF AN ATTENTION SNAPSHOT, and nothing else.
#
# This module is the T2 sibling of context.py: a frozen, allowlisted view of one caller's
# situation, with no wording in it and no way to reach a database. It exists so the answer layer
# can be handed a value object instead of a repository, which is what keeps the storage-free
# rule over app/services/toucan/ intact (see tests/test_toucan_privacy.py) now that Toucan has
# something to say about durable data.
#
# THE FIELD LIST BELOW IS THE PRIVACY BOUNDARY, exactly as PersonView's is in context.py. If a
# fact is not a field here, the wording layer cannot say it. Note what is therefore impossible
# to express, no matter what the repository learns later:
#
#   * WHAT was said. There is no text field, no title, no preview, no subject line.
#   * WHO said it. No sender, no conversation, no participant list, no group name.
#   * WHERE it was said. No conversation id, no room, no channel, no Hub item id.
#
# Eight scalars: two timestamps, a label for what the window means, and six integers.

# What `since` means for this particular snapshot. Mirrors repositories/toucan_activity.py's
# SINCE_* constants — duplicated as a literal set here rather than imported, because importing
# anything from the repository layer into this package is exactly what the storage-free rule
# forbids, and a three-string vocabulary is cheaper to keep in step than the coupling would be.
SINCE_LAST_ACTIVE = "last_active"
SINCE_TRACKING_STARTED = "tracking_started"
SINCE_NO_HISTORY = "no_history"


@dataclass(frozen=True)
class AttentionSnapshot:
    """How much happened to the caller during a known window. Never what happened."""

    # The start of the window, and what that start actually represents. `since_reason` travels
    # with `since` on purpose: a count is meaningless without knowing whether the window is a
    # real absence, or merely everything since Toucan first laid eyes on this person.
    since: datetime
    since_reason: str
    until: datetime

    # Messages from other people in conversations the caller is a participant of.
    chat_count: int = 0
    # The subset of those that named the caller.
    mention_count: int = 0
    # Rings that ended without the caller answering.
    missed_call_count: int = 0
    # Hub items that appeared in the window, are visible to the caller under the Hub's own
    # audience rules, and that the caller has not opened.
    hub_count: int = 0
    # The subset of those the Hub itself marks required/important. Carried explicitly rather
    # than left for the wording layer to back out of important_count, so no sentence is ever
    # built on arithmetic that a later change to the roll-up would quietly invalidate.
    pressing_hub_count: int = 0
    # Roll-up of the ones that plausibly need acting on: mentions + missed calls + pressing Hub
    # items. Ordinary chat volume is excluded by design.
    important_count: int = 0

    @property
    def is_empty(self) -> bool:
        """True when nothing at all came in. Note this ignores `important_count`, which is a
        roll-up of the others and can never be non-zero while they are all zero."""
        return not (
            self.chat_count or self.mention_count or self.missed_call_count or self.hub_count
        )

    @property
    def window_is_a_real_absence(self) -> bool:
        """Whether the caller has actually been observed leaving and coming back. False means
        the numbers are still true but the phrase "while you were away" would not be."""
        return self.since_reason == SINCE_LAST_ACTIVE

    @property
    def has_no_history(self) -> bool:
        """The server has never observed this person present at all, so there is no window to
        measure and every count is trivially zero. Worth saying out loud rather than reporting
        a confident "nothing happened"."""
        return self.since_reason == SINCE_NO_HISTORY

    @classmethod
    def from_dict(cls, row: dict[str, Any]) -> "AttentionSnapshot":
        """Built from the repository's plain-dict return, at the router — the same from_dict
        seam schemas/toucan.py uses. Unknown keys are ignored rather than spread in, so a future
        field added to the repository cannot silently widen what the answer layer can see."""
        return cls(
            since=row["since"],
            since_reason=row["since_reason"],
            until=row["until"],
            chat_count=int(row.get("chat_count", 0)),
            mention_count=int(row.get("mention_count", 0)),
            missed_call_count=int(row.get("missed_call_count", 0)),
            hub_count=int(row.get("hub_count", 0)),
            pressing_hub_count=int(row.get("pressing_hub_count", 0)),
            important_count=int(row.get("important_count", 0)),
        )
