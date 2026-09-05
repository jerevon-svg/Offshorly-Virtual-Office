from __future__ import annotations

from dataclasses import dataclass

# Quest definitions live in CODE for this checkpoint. Onboarding needs stable ids and no admin
# authoring; a definitions table is a later, additive change because quest_progress already keys
# on the string quest_id and nothing here is joined against a row.
#
# Event types are the vocabulary feature code speaks. Each one is emitted from exactly one
# server-authoritative write site (see the hook list in services/quests/engine.py). Adding an
# event type here does NOT make the engine store it — only an event type some definition
# subscribes to is ever written to quest_events (filtered ledger, not raw analytics).

EVENT_CHECK_IN = "check_in"  # a real CHECKED_OUT → CHECKED_IN attendance transition
EVENT_CHECK_OUT = "check_out"  # a real CHECKED_IN → CHECKED_OUT transition (the Log Time flow)
EVENT_DM_SENT = "dm_sent"  # a persisted message in a type="dm" conversation; target = recipient
EVENT_GROUP_MESSAGE_SENT = "group_message_sent"  # a persisted message in a type="group" conversation
EVENT_ASK_TO_JOIN = "ask_to_join"  # a persisted join_group conversation request
EVENT_SPATIAL_SESSION_JOINED = "spatial_session_joined"  # spatial_session_start, keyed by session identity
EVENT_RECOGNITION_GIVEN = "recognition_given"  # a feed post / reaction / Hub congratulation aimed at a coworker
EVENT_TOUCAN_ASKED = "toucan_asked"  # a persisted user turn in a Toucan conversation
# Onboarding Questline signals. The first two reuse the only server-observable trace of the act —
# the self-scoped GET the client makes when the surface opens — so no new write endpoint exists.
EVENT_HUB_VISITED = "hub_visited"  # GET /hub/items by the bearer (check-in or manual Hub open)
EVENT_PROFILE_VIEWED = "profile_viewed"  # GET /feed/{target} where target != bearer
EVENT_COWORKER_APPROACHED = "coworker_approached"  # socket approach_arrived with a real coworker target

# Progress modes. `once`: the first accepted event completes the quest. `unique_count`: progress
# is the number of DISTINCT target_email values across the actor's events of that type, and the
# quest completes when that reaches `target`. No blind increments anywhere — both modes are
# recomputed from the ledger, so replays and duplicates cannot inflate them.
MODE_ONCE = "once"
MODE_UNIQUE_COUNT = "unique_count"

# Daily/Weekly Missions will introduce real period keys; until then every definition uses this
# single stable key and no timezone or reset semantics exist.
DEFAULT_PERIOD_KEY = ""


@dataclass(frozen=True)
class QuestDefinition:
    id: str
    title: str
    event_type: str
    mode: str = MODE_ONCE
    target: int = 1
    # Ordering hint for a future questline UI; not a dependency chain.
    order: int = 0

    def __post_init__(self) -> None:
        if self.mode not in (MODE_ONCE, MODE_UNIQUE_COUNT):
            raise ValueError(f"unknown quest mode {self.mode!r}")
        if self.target < 1:
            raise ValueError("quest target must be >= 1")
        if self.mode == MODE_ONCE and self.target != 1:
            raise ValueError("once-mode quests always have target 1")


# Foundation definitions — enough to prove both modes and to back the next Onboarding phase.
# Ids are STABLE: they are the join key of every quest_progress row.
QUEST_DEFINITIONS: tuple[QuestDefinition, ...] = (
    QuestDefinition(id="first_check_in", title="Check in for the first time", event_type=EVENT_CHECK_IN, order=10),
    QuestDefinition(id="first_dm", title="Send your first DM", event_type=EVENT_DM_SENT, order=20),
    QuestDefinition(
        id="chat_unique_coworkers",
        title="Chat with 3 different coworkers",
        event_type=EVENT_DM_SENT,
        mode=MODE_UNIQUE_COUNT,
        target=3,
        order=30,
    ),
    QuestDefinition(
        id="join_spatial_conversation",
        title="Start or join a spatial conversation",
        event_type=EVENT_SPATIAL_SESSION_JOINED,
        order=40,
    ),
    QuestDefinition(id="use_ask_to_join", title="Use Ask-to-Join", event_type=EVENT_ASK_TO_JOIN, order=50),
    QuestDefinition(id="give_recognition", title="Recognise a coworker", event_type=EVENT_RECOGNITION_GIVEN, order=60),
    QuestDefinition(id="first_time_log", title="Complete your first time log", event_type=EVENT_CHECK_OUT, order=70),
    QuestDefinition(id="meet_toucan", title="Meet Toucan", event_type=EVENT_TOUCAN_ASKED, order=80),
    # Onboarding Questline additions. Interleaved into the existing order so the questline reads
    # as one guided sequence: check in → look around the Hub → meet people → deeper actions.
    QuestDefinition(id="visit_central_hub", title="Visit the Company Hub", event_type=EVENT_HUB_VISITED, order=12),
    QuestDefinition(
        id="view_coworker_profile", title="View a coworker's profile", event_type=EVENT_PROFILE_VIEWED, order=14
    ),
    QuestDefinition(
        id="approach_coworker", title="Walk up to a coworker", event_type=EVENT_COWORKER_APPROACHED, order=16
    ),
)

_BY_ID: dict[str, QuestDefinition] = {d.id: d for d in QUEST_DEFINITIONS}
if len(_BY_ID) != len(QUEST_DEFINITIONS):
    raise RuntimeError("duplicate quest id in QUEST_DEFINITIONS")

_BY_EVENT: dict[str, tuple[QuestDefinition, ...]] = {}
for _d in QUEST_DEFINITIONS:
    _BY_EVENT[_d.event_type] = _BY_EVENT.get(_d.event_type, ()) + (_d,)


def all_definitions() -> tuple[QuestDefinition, ...]:
    """Every registered quest in display order."""
    return tuple(sorted(QUEST_DEFINITIONS, key=lambda d: (d.order, d.id)))


def definitions_for(event_type: str) -> tuple[QuestDefinition, ...]:
    """The quests that subscribe to `event_type`; empty when nothing cares (the engine then
    stores nothing)."""
    return _BY_EVENT.get(event_type, ())


def get_definition(quest_id: str) -> QuestDefinition | None:
    return _BY_ID.get(quest_id)
