from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Wire contract for the Toucan assistant (POST /toucan/ask). Mirrors the camelCase/
# populate_by_name conventions of the other schema modules; every field here happens to be a
# single word, so no aliases are needed.
#
# TWO DELIBERATE PROPERTIES OF THE REQUEST MODEL:
#
#   1. THERE IS NO IDENTITY FIELD, and `extra="forbid"` means one cannot be smuggled in. The
#      caller is derived server-side from the bearer token (app/auth/deps.py's
#      get_current_email), exactly as in every other router. A body carrying "email" or
#      "viewerEmail" is rejected with 422 rather than silently ignored, so an impersonation
#      attempt fails loudly and is visible in tests.
#
#   2. HISTORY IS BOUNDED AT THE EDGE. The client sends it, so it is untrusted input: the limits
#      below are enforced by the server, not trusted from the frontend's own constants.

# Kept in step with frontend/src/services/toucan/types.ts.
MAX_QUESTION_CHARS = 2000
MAX_HISTORY_TURNS = 10
MAX_TURN_CHARS = 2000


class ToucanTurnIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    role: Literal["user", "toucan"]
    text: str = Field(max_length=MAX_TURN_CHARS)


class ToucanAskIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    question: str = Field(min_length=1, max_length=MAX_QUESTION_CHARS)
    # Accepted and bounded, but UNUSED at T0: the deterministic resolver answers each question
    # on its own. It is on the wire now so the frontend contract does not have to change when a
    # provider that does need conversation context arrives.
    history: list[ToucanTurnIn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)


class ToucanAnswerOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    # The one and only string shown to the user, in the assistant panel.
    text: str
    # Resolved intent id, or "unsupported". Useful for tests and future telemetry; the panel
    # does not render it.
    intent: str
    supported: bool
