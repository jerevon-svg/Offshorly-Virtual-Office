from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.chat import to_iso_z


class QuestOut(BaseModel):
    """One registered quest with the caller's own progress. `completed` is derived from
    `completedAt` so the UI never has to compare count against target itself."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str
    event_type: str = Field(alias="eventType")
    mode: str
    target: int
    order: int
    count: int
    completed: bool
    completed_at: datetime | None = Field(alias="completedAt")

    @field_serializer("completed_at")
    def _ser_dt(self, value: datetime | None) -> str | None:
        return to_iso_z(value) if value is not None else None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> QuestOut:
        return cls(
            id=data["id"],
            title=data["title"],
            event_type=data["event_type"],
            mode=data["mode"],
            target=data["target"],
            order=data["order"],
            count=data["count"],
            completed=data["completed_at"] is not None,
            completed_at=data["completed_at"],
        )


class MyQuestsOut(BaseModel):
    quests: list[QuestOut]
