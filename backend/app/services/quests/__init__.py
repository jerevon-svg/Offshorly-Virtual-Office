"""Quest Foundation — authoritative VO action → validated quest event → materialized progress.

Feature code imports exactly one thing from here: `record_quest_event`. Definitions live in
`registry.py` (code, not DB); the engine in `engine.py` owns every write to quest_events /
quest_progress. See app/models/quest.py for the storage rules."""

from app.services.quests.engine import QuestRecordResult, record_quest_event
from app.services.quests.missions import MissionRef, utc_day_key
from app.services.quests.registry import (
    EVENT_ASK_TO_JOIN,
    EVENT_CHECK_IN,
    EVENT_CHECK_OUT,
    EVENT_COWORKER_APPROACHED,
    EVENT_DM_SENT,
    EVENT_GROUP_MESSAGE_SENT,
    EVENT_HUB_VISITED,
    EVENT_PROFILE_VIEWED,
    EVENT_RECOGNITION_GIVEN,
    EVENT_SPATIAL_SESSION_JOINED,
    EVENT_TOUCAN_ASKED,
    QuestDefinition,
    all_definitions,
    definitions_for,
)

__all__ = [
    "EVENT_ASK_TO_JOIN",
    "EVENT_CHECK_IN",
    "EVENT_CHECK_OUT",
    "EVENT_COWORKER_APPROACHED",
    "EVENT_DM_SENT",
    "EVENT_GROUP_MESSAGE_SENT",
    "EVENT_HUB_VISITED",
    "EVENT_PROFILE_VIEWED",
    "EVENT_RECOGNITION_GIVEN",
    "EVENT_SPATIAL_SESSION_JOINED",
    "EVENT_TOUCAN_ASKED",
    "QuestDefinition",
    "MissionRef",
    "QuestRecordResult",
    "all_definitions",
    "definitions_for",
    "record_quest_event",
    "utc_day_key",
]
