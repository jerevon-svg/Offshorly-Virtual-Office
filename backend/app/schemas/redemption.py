from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.models.redemption import RewardRedemption
from app.schemas.chat import to_iso_z
from app.schemas.progression import ProgressionOut
from app.services.redemption import CatalogItem


class CatalogItemOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str
    description: str
    cost: int
    category: str
    requires_approval: bool = Field(alias="requiresApproval")
    affordable: bool

    @classmethod
    def from_item(cls, item: CatalogItem, balance: int) -> CatalogItemOut:
        return cls(
            id=item.id,
            title=item.title,
            description=item.description,
            cost=item.cost,
            category=item.category,
            requires_approval=item.requires_approval,
            affordable=balance >= item.cost,
        )


class CatalogOut(BaseModel):
    items: list[CatalogItemOut]
    progression: ProgressionOut


class RedemptionOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    item_id: str = Field(alias="itemId")
    title: str
    cost: int
    status: str
    note: str | None
    created_at: datetime = Field(alias="createdAt")
    decided_at: datetime | None = Field(alias="decidedAt")

    @field_serializer("created_at")
    def _ser_created(self, v: datetime) -> str:
        return to_iso_z(v)

    @field_serializer("decided_at")
    def _ser_decided(self, v: datetime | None) -> str | None:
        return to_iso_z(v) if v is not None else None

    @classmethod
    def from_row(cls, row: RewardRedemption, title: str) -> RedemptionOut:
        return cls(
            id=row.id,
            item_id=row.item_id,
            title=title,
            cost=row.cost,
            status=row.status,
            note=row.note,
            created_at=row.created_at,
            decided_at=row.decided_at,
        )


class RedeemIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    item_id: str = Field(alias="itemId")
    idempotency_key: str = Field(alias="idempotencyKey")


class RedeemOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    redemption: RedemptionOut
    created_now: bool = Field(alias="createdNow")
    progression: ProgressionOut


class RedemptionActionOut(BaseModel):
    redemption: RedemptionOut
    progression: ProgressionOut


class DecideIn(BaseModel):
    status: str
    note: str | None = None


class MyRedemptionsOut(BaseModel):
    redemptions: list[RedemptionOut]
