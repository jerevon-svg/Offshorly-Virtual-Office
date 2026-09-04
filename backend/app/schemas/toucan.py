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
    # A2.3: the caller's IANA zone, used ONLY to interpret a wall-clock they typed ("until 3 PM").
    # Never identity, never stored, validated server-side (services/toucan/delegation.py).
    client_timezone: str | None = Field(default=None, alias="clientTimezone", max_length=64)


class ToucanActionProposalOut(BaseModel):
    """T8 — one PROPOSED (not executed) action, riding along on an ask() answer. Everything here
    is server-derived from the validated proposal: the id is server-minted, `summary` is the
    server-worded exact effect, and the args are the frozen validated ones — never the model's
    raw output. Receiving this changes nothing; only POST /toucan/actions/{id}/confirm does."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    action: Literal["set_status", "send_message", "start_delegation"]
    # set_status: one of the manual statuses (services/toucan/actions.py MANUAL_STATUSES).
    status: str | None = None
    # set_status: present only for DND, already clamped server-side.
    dnd_minutes: int | None = Field(default=None, alias="dndMinutes")
    # send_message: the RESOLVED target and the exact outgoing text — both must be visible on
    # the card before Confirm. Server-resolved; the client never names a target. target_kind
    # "dm" carries recipient_email; "group" carries an existing group's title as the label.
    target_kind: Literal["dm", "group"] | None = Field(default=None, alias="targetKind")
    recipient_email: str | None = Field(default=None, alias="recipientEmail")
    recipient_label: str | None = Field(default=None, alias="recipientLabel")
    message: str | None = None
    # start_delegation (A2.1): the clamped duration and the scope ("dm" only). The card shows
    # both; the resolved end time is only known at Confirm (see ToucanDelegationOut).
    duration_minutes: int | None = Field(default=None, alias="durationMinutes")
    scope: Literal["dm", "dm_and_groups"] | None = None
    # A2.3: "at_time" (duration or clock) | "until_return"; ends_at is the RESOLVED UTC end for a
    # clock-time request, so the card can show it in the viewer's zone before Confirm.
    end_condition: Literal["at_time", "until_return"] | None = Field(default=None, alias="endCondition")
    ends_at: datetime | None = Field(default=None, alias="endsAt")
    # The exact effect, as the confirmation card must show it.
    summary: str
    expires_at: datetime = Field(alias="expiresAt")

    @field_serializer("expires_at")
    def _serialize_expires_at(self, dt: datetime) -> str:
        return to_iso_z(dt)

    @field_serializer("ends_at")
    def _serialize_ends_at(self, dt: datetime | None) -> str | None:
        return to_iso_z(dt) if dt is not None else None


class ToucanDelegationOut(BaseModel):
    """A2.1 — one delegation row as the owner sees it. Server times, ISO-Z; the client formats
    the end in the viewer's own zone. Never carries another owner's row: every producer filters
    on the bearer identity."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    status: Literal["active", "ended"]
    end_condition: str = Field(alias="endCondition")
    scope: str
    starts_at: datetime = Field(alias="startsAt")
    expires_at: datetime | None = Field(default=None, alias="expiresAt")
    hard_cap_at: datetime = Field(alias="hardCapAt")
    ended_at: datetime | None = Field(default=None, alias="endedAt")
    ended_reason: str | None = Field(default=None, alias="endedReason")
    reply_count: int = Field(alias="replyCount")

    @field_serializer("starts_at", "expires_at", "hard_cap_at", "ended_at")
    def _serialize_times(self, dt: datetime | None) -> str | None:
        return to_iso_z(dt) if dt is not None else None


class ToucanActionResultOut(BaseModel):
    """The outcome of confirming or cancelling one pending action — echoes the same frozen
    action fields so the client applies exactly what was confirmed, plus the transcript line."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    outcome: Literal["executed", "cancelled"]
    action: Literal["set_status", "send_message", "start_delegation"]
    status: str | None = None
    dnd_minutes: int | None = Field(default=None, alias="dndMinutes")
    target_kind: Literal["dm", "group"] | None = Field(default=None, alias="targetKind")
    recipient_email: str | None = Field(default=None, alias="recipientEmail")
    recipient_label: str | None = Field(default=None, alias="recipientLabel")
    message: str | None = None
    # send_message, executed only: where the message landed, so a client can open the chat.
    conversation_id: str | None = Field(default=None, alias="conversationId")
    message_id: str | None = Field(default=None, alias="messageId")
    duration_minutes: int | None = Field(default=None, alias="durationMinutes")
    scope: Literal["dm", "dm_and_groups"] | None = None
    end_condition: Literal["at_time", "until_return"] | None = Field(default=None, alias="endCondition")
    ends_at: datetime | None = Field(default=None, alias="endsAt")
    # start_delegation, executed only: the durable delegation that is now active.
    delegation: ToucanDelegationOut | None = None

    @field_serializer("ends_at")
    def _serialize_ends_at(self, dt: datetime | None) -> str | None:
        return to_iso_z(dt) if dt is not None else None
    summary: str
    # The assistant's outcome line, also persisted into the conversation transcript.
    text: str


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
    # T8, backward-compatible: a pending action proposal awaiting explicit confirmation, or None
    # (the overwhelmingly common case — every pre-T8 client simply never reads it). Its presence
    # means NOTHING has executed: the text above asks for confirmation and this carries the id
    # the Confirm/Cancel buttons target.
    action: ToucanActionProposalOut | None = None


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


# --- T2 activity wire shape ---------------------------------------------------------------


class ToucanActivityOut(BaseModel):
    """The attention snapshot: how much the caller missed, and over what window.

    WHAT IS NOT ON THIS WIRE, and cannot be added without changing this class: message text,
    conversation ids, titles, sender names, Hub item ids or bodies. Nine scalars — two
    timestamps, a label, and six counts. A client receiving this learns HOW MUCH happened to
    THEM and nothing about what it was or who else was involved.

    Scoped entirely by the bearer identity, like every other Toucan response: there is no query
    parameter and no body, so there is nothing through which a caller could ask about somebody
    else."""

    model_config = ConfigDict(populate_by_name=True)

    # The window. `since_reason` ships alongside `since` so a client can never present a count
    # as "while you were away" when the window actually means "since Toucan first saw you" —
    # see app/repositories/toucan_activity.py's SINCE_* constants.
    since: datetime
    since_reason: Literal["last_active", "tracking_started", "no_history"] = Field(
        alias="sinceReason"
    )
    until: datetime

    chat_count: int = Field(alias="chatCount")
    mention_count: int = Field(alias="mentionCount")
    missed_call_count: int = Field(alias="missedCallCount")
    hub_count: int = Field(alias="hubCount")
    pressing_hub_count: int = Field(alias="pressingHubCount")
    important_count: int = Field(alias="importantCount")

    @field_serializer("since", "until")
    def _serialize_window(self, dt: datetime) -> str:
        return to_iso_z(dt)

    @classmethod
    def from_dict(cls, row: dict[str, Any]) -> "ToucanActivityOut":
        return cls(
            since=row["since"],
            since_reason=row["since_reason"],
            until=row["until"],
            chat_count=row["chat_count"],
            mention_count=row["mention_count"],
            missed_call_count=row["missed_call_count"],
            hub_count=row["hub_count"],
            pressing_hub_count=row["pressing_hub_count"],
            important_count=row["important_count"],
        )


# --- T4 memory + resource wire shapes -------------------------------------------------------
#
# Same two deliberate properties as ToucanAskIn: NO IDENTITY FIELD anywhere (extra="forbid"
# turns a smuggled "email"/"ownerEmail" into a 422, loudly), and every inbound string bounded at
# the edge. The owner of everything below is the bearer identity, decided server-side, always.

# Kept in step with repositories/toucan_memory.py and toucan_resources.py.
MAX_MEMORY_CONTENT_CHARS = 1000
MAX_DISPLAY_NAME_CHARS = 255
MAX_LOCATOR_CHARS = 1024
MAX_MEDIA_TYPE_CHARS = 127


class ToucanMemoryIn(BaseModel):
    """POST /toucan/memories — the REST twin of the "Remember that ..." chat command. Content
    only (plus an optional kind label); there is nothing else a memory is allowed to be made of."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    content: str = Field(min_length=1, max_length=MAX_MEMORY_CONTENT_CHARS)
    kind: Literal["fact", "note"] = "note"


class ToucanMemoryOut(BaseModel):
    """No owner email on the wire — everything the caller can list is theirs by construction,
    same reasoning as ToucanConversationOut."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    kind: str
    content: str
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    @field_serializer("created_at", "updated_at")
    def _serialize_timestamps(self, dt: datetime) -> str:
        return to_iso_z(dt)

    @classmethod
    def from_dict(cls, row: dict[str, Any]) -> "ToucanMemoryOut":
        return cls(
            id=row["id"],
            kind=row["kind"],
            content=row["content"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )


class ToucanResourceIn(BaseModel):
    """POST /toucan/resources — registers a REFERENCE, never content. There is deliberately no
    field a file body could travel in: no data, no bytes, no base64 — extra="forbid" makes an
    attempt a 422 rather than a silent drop. `locator` says where a thing lives (a URL today, an
    object-storage key once that layer exists) and is bounded far below any useful payload size."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    display_name: str = Field(alias="displayName", min_length=1, max_length=MAX_DISPLAY_NAME_CHARS)
    locator: str | None = Field(default=None, max_length=MAX_LOCATOR_CHARS)
    media_type: str | None = Field(default=None, alias="mediaType", max_length=MAX_MEDIA_TYPE_CHARS)
    # Optional attachment points into the CALLER'S OWN data — ownership is verified before the
    # row is written, and a foreign id 404s (see repositories/toucan_resources.py).
    conversation_id: str | None = Field(
        default=None, alias="conversationId", max_length=MAX_CONVERSATION_ID_CHARS
    )
    memory_id: str | None = Field(
        default=None, alias="memoryId", max_length=MAX_CONVERSATION_ID_CHARS
    )


class ToucanResourceOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    display_name: str = Field(alias="displayName")
    locator: str | None = None
    media_type: str | None = Field(default=None, alias="mediaType")
    conversation_id: str | None = Field(default=None, alias="conversationId")
    memory_id: str | None = Field(default=None, alias="memoryId")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    @field_serializer("created_at", "updated_at")
    def _serialize_timestamps(self, dt: datetime) -> str:
        return to_iso_z(dt)

    @classmethod
    def from_dict(cls, row: dict[str, Any]) -> "ToucanResourceOut":
        return cls(
            id=row["id"],
            display_name=row["display_name"],
            locator=row["locator"],
            media_type=row["media_type"],
            conversation_id=row["conversation_id"],
            memory_id=row["memory_id"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
