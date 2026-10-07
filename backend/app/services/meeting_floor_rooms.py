from __future__ import annotations

from dataclasses import dataclass

# THE MEETING FLOOR'S ROOMS, as the backend books them. The 13 rooms are defined by the frontend
# (frontend/src/dev/vo3d/rooms/floor2Meeting.ts, DRAFTS): room id `floor-2/<slug>`, live meeting id
# `mf-<slug>`. This is a copy of exactly those identifiers and nothing else — no geometry, no room
# management. tests/test_scheduled_meetings.py parses the frontend file and fails if the two drift.


@dataclass(frozen=True)
class MeetingFloorRoom:
    slug: str
    name: str
    capacity: int

    @property
    def id(self) -> str:
        return f"floor-2/{self.slug}"

    @property
    def meeting_id(self) -> str:
        return f"mf-{self.slug}"


MEETING_FLOOR_ROOMS: tuple[MeetingFloorRoom, ...] = (
    MeetingFloorRoom("alpha", "Alpha", 10),
    MeetingFloorRoom("bravo", "Bravo", 6),
    MeetingFloorRoom("charlie", "Charlie", 4),
    MeetingFloorRoom("lima", "Lima", 6),
    MeetingFloorRoom("echo", "Echo", 10),
    MeetingFloorRoom("foxtrot", "Foxtrot", 3),
    MeetingFloorRoom("golf", "Golf", 2),
    MeetingFloorRoom("hotel", "Hotel", 14),
    MeetingFloorRoom("india", "India", 8),
    MeetingFloorRoom("juliett", "Juliett", 6),
    MeetingFloorRoom("kilo", "Kilo", 4),
    MeetingFloorRoom("delta", "Delta", 6),
    MeetingFloorRoom("mike", "Mike", 8),
)

_BY_ID = {r.id: r for r in MEETING_FLOOR_ROOMS}
_BY_MEETING_ID = {r.meeting_id: r for r in MEETING_FLOOR_ROOMS}


def room_by_id(room_id: str) -> MeetingFloorRoom | None:
    return _BY_ID.get((room_id or "").strip())


def room_for_meeting_id(meeting_id: str) -> MeetingFloorRoom | None:
    """The room whose live meeting id this is, or None for any other meeting (the Cave, ad-hoc ids)."""
    return _BY_MEETING_ID.get((meeting_id or "").strip().lower())
