from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.chat import to_iso_z

# camelCase wire shapes for the Company Hub V1 feature — mirrors app/schemas/requests.py's
# conventions (populate_by_name aliasing, to_iso_z for datetimes).

HubItemType = Literal["announcement", "birthday", "recognition", "survey", "whatsnew"]
HubItemPriority = Literal["normal", "important", "required"]
HubItemMyStatus = Literal["unseen", "seen", "dismissed", "acknowledged"]


class CreateHubItemIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type: HubItemType
    title: str
    description: str
    image_url: str | None = Field(default=None, alias="imageUrl")
    start_at: datetime | None = Field(default=None, alias="startAt")
    end_at: datetime | None = Field(default=None, alias="endAt")
    priority: HubItemPriority = "normal"
    cta_label: str | None = Field(default=None, alias="ctaLabel")
    cta_action: str | None = Field(default=None, alias="ctaAction")
    audience_email: str | None = Field(default=None, alias="audienceEmail")
    target_employee_email: str | None = Field(default=None, alias="targetEmployeeEmail")


class HubItemOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    type: str
    title: str
    description: str
    image_url: str | None = Field(default=None, alias="imageUrl")
    start_at: datetime = Field(alias="startAt")
    end_at: datetime | None = Field(default=None, alias="endAt")
    priority: str
    cta_label: str | None = Field(default=None, alias="ctaLabel")
    cta_action: str | None = Field(default=None, alias="ctaAction")
    audience_email: str | None = Field(default=None, alias="audienceEmail")
    target_employee_email: str | None = Field(default=None, alias="targetEmployeeEmail")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    # Viewer-specific — merged in from HubItemState for the requesting employee. "unseen" means
    # no state row exists yet for this viewer (never fetched/dismissed/acknowledged).
    my_status: HubItemMyStatus = Field(default="unseen", alias="myStatus")
    my_acted: bool = Field(default=False, alias="myActed")

    @field_serializer("start_at")
    def _serialize_start_at(self, dt: datetime) -> str:
        return to_iso_z(dt)

    @field_serializer("end_at")
    def _serialize_end_at(self, dt: datetime | None) -> str | None:
        return to_iso_z(dt) if dt is not None else None

    @field_serializer("created_at")
    def _serialize_created_at(self, dt: datetime) -> str:
        return to_iso_z(dt)

    @field_serializer("updated_at")
    def _serialize_updated_at(self, dt: datetime) -> str:
        return to_iso_z(dt)

    @classmethod
    def from_dict(
        cls,
        item: dict[str, Any],
        state: dict[str, Any] | None = None,
    ) -> HubItemOut:
        my_status: HubItemMyStatus = state["status"] if state else "unseen"
        return cls(
            id=item["id"],
            type=item["type"],
            title=item["title"],
            description=item["description"],
            image_url=item["image_url"],
            start_at=item["start_at"],
            end_at=item["end_at"],
            priority=item["priority"],
            cta_label=item["cta_label"],
            cta_action=item["cta_action"],
            audience_email=item["audience_email"],
            target_employee_email=item["target_employee_email"],
            created_at=item["created_at"],
            updated_at=item["updated_at"],
            my_status=my_status,
            my_acted=bool(state and state.get("acted_at")),
        )
