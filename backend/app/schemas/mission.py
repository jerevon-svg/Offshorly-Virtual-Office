from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.chat import to_iso_z


class MissionOut(BaseModel):
    """One active mission with the caller's own progress in its period. Same shape as QuestOut
    plus `cadence`; `completed` is derived server-side."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str
    event_type: str = Field(alias="eventType")
    mode: str
    target: int
    cadence: str
    count: int
    completed: bool
    completed_at: datetime | None = Field(alias="completedAt")

    @field_serializer("completed_at")
    def _ser_dt(self, value: datetime | None) -> str | None:
        return to_iso_z(value) if value is not None else None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MissionOut:
        return cls(
            id=data["id"],
            title=data["title"],
            event_type=data["event_type"],
            mode=data["mode"],
            target=data["target"],
            cadence=data["cadence"],
            count=data["count"],
            completed=data["completed_at"] is not None,
            completed_at=data["completed_at"],
        )


class MissionPeriodOut(BaseModel):
    """One cadence's current period: its stable key, UTC bounds (`endsAt` is when it resets) and
    the caller's pinned missions in slot order."""

    model_config = ConfigDict(populate_by_name=True)

    cadence: str
    period_key: str = Field(alias="periodKey")
    starts_at: datetime = Field(alias="startsAt")
    ends_at: datetime = Field(alias="endsAt")
    missions: list[MissionOut]

    @field_serializer("starts_at", "ends_at")
    def _ser_dt(self, value: datetime) -> str:
        return to_iso_z(value)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MissionPeriodOut:
        return cls(
            cadence=data["cadence"],
            period_key=data["period_key"],
            starts_at=data["starts_at"],
            ends_at=data["ends_at"],
            missions=[MissionOut.from_dict(m) for m in data["missions"]],
        )


class MyMissionsOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    server_time: datetime = Field(alias="serverTime")
    daily: MissionPeriodOut
    weekly: MissionPeriodOut

    @field_serializer("server_time")
    def _ser_dt(self, value: datetime) -> str:
        return to_iso_z(value)
