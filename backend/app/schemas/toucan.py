from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer

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
#
# T1 adds `conversationId` to the request and the response. It is an OPAQUE SERVER-ISSUED ID,
# not an identity: supplying one only ever selects among conversations the caller already owns
# (repositories/toucan.py filters every lookup on owner_email), so a guessed or stolen id
# resolves to nothing rather than to someone else's transcript.

# Kept in step with frontend/src/services/toucan/types.ts.
MAX_QUESTION_CHARS = 2000
# BaseModel ids are stringified UUID4s (36 chars) — see app/models/base.py's generate_uuid.
MAX_CONVERSATION_ID_CHARS = 36
MAX_HISTORY_TURNS = 10
MAX_TURN_CHARS = 2000


class ToucanTurnIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    role: Literal["user", "toucan"]
    text: str = Field(max_length=MAX_TURN_CHARS)


class ToucanAskIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    question: str = Field(min_length=1, max_length=MAX_QUESTION_CHARS)
    # Which persisted conversation to append this exchange to. Omitted (or null) means "start a
    # new one" — the very first question a user ever asks takes that path. Supplied means
    # "continue this one", and the router verifies it belongs to the authenticated viewer before
    # a single row is written. Length-bounded to a UUID so a junk id costs a 422, not a query.
    conversation_id: str | None = Field(
        default=None, alias="conversationId", max_length=MAX_CONVERSATION_ID_CHARS
    )
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
    # The conversation this exchange was persisted into — the one the caller supplied, or the
    # freshly created one. Always present, so the panel never has to guess which conversation it
    # is now in after asking its first question.
    conversation_id: str = Field(alias="conversationId")


# --- T1 persistence wire shapes ---------------------------------------------------------
#
# camelCase out, matching schemas/chat.py; timestamps are ISO-8601 UTC with a literal "Z" via
# the shared to_iso_z, so the frontend parses Toucan timestamps exactly as it parses chat's.


def to_iso_z(dt: datetime) -> str:
    """ISO-8601 UTC with a literal "Z" suffix (not "+00:00") — the timestamp format every
    other wire schema in this codebase uses, so the frontend parses Toucan timestamps exactly
    as it parses chat's. Deliberately duplicated from schemas/chat.py's identical four lines
    rather than imported: Toucan importing anything out of the chat module, even a date
    formatter, is the kind of coupling the privacy tests exist to keep from starting."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class ToucanMessageOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    # "user" | "assistant" — the stored vocabulary (see models/toucan.py). The panel maps
    # "assistant" onto its own "toucan" turn role when rendering.
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime = Field(alias="createdAt")

    @field_serializer("created_at")
    def _serialize_created_at(self, dt: datetime) -> str:
        return to_iso_z(dt)

    @classmethod
    def from_dict(cls, row: dict[str, Any]) -> "ToucanMessageOut":
        return cls(id=row["id"], role=row["role"], content=row["content"], created_at=row["created_at"])


class ToucanConversationOut(BaseModel):
    """Conversation metadata only. Note what is NOT here: no owner email. The caller already
    knows who they are, and every conversation they can reach is theirs by construction, so
    echoing the owner back would add an identity field to the wire for no reason."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    # Derived from the user's own first question; null for a conversation with no turns yet.
    title: str | None = Field(default=None)
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    @field_serializer("created_at", "updated_at")
    def _serialize_timestamps(self, dt: datetime) -> str:
        return to_iso_z(dt)

    @classmethod
    def from_dict(cls, row: dict[str, Any]) -> "ToucanConversationOut":
        return cls(
            id=row["id"],
            title=row.get("title"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )


class ToucanConversationDetailOut(ToucanConversationOut):
    """A conversation plus its transcript, oldest turn first. `messages` is capped server-side
    at repositories/toucan.py's MAX_MESSAGES_RETURNED — a very long conversation returns its
    most recent turns, never everything."""

    messages: list[ToucanMessageOut] = Field(default_factory=list)

    @classmethod
    def from_rows(
        cls, conversation: dict[str, Any], messages: list[dict[str, Any]]
    ) -> "ToucanConversationDetailOut":
        return cls(
            id=conversation["id"],
            title=conversation.get("title"),
            created_at=conversation["created_at"],
            updated_at=conversation["updated_at"],
            messages=[ToucanMessageOut.from_dict(m) for m in messages],
        )
