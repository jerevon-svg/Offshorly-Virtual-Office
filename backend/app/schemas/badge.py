from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.chat import to_iso_z


class TierRewardOut(BaseModel):
    xp: int
    coins: int


class BadgeOut(BaseModel):
    """One badge with the caller's metric and tier. `tier` 0-4 (none/bronze/silver/gold/platinum);
    `nextThreshold` is null at Platinum."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str
    description: str
    category: str
    emblem: str
    metric_kind: str = Field(alias="metricKind")
    metric: int
    tier: int
    tier_name: str = Field(alias="tierName")
    thresholds: list[int]
    next_threshold: int | None = Field(alias="nextThreshold")
    # Index 0..3 = bronze..platinum; null where not yet awarded.
    tiers_awarded_at: list[datetime | None] = Field(alias="tiersAwardedAt")
    # Index 0..3 = bronze..platinum; when the tier's XP/Coins bonus was claimed (null = unclaimed).
    tiers_claimed_at: list[datetime | None] = Field(alias="tiersClaimedAt")
    tier_rewards: list[TierRewardOut] = Field(alias="tierRewards")

    @field_serializer("tiers_awarded_at", "tiers_claimed_at")
    def _ser(self, value: list[datetime | None]) -> list[str | None]:
        return [to_iso_z(v) if v is not None else None for v in value]

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> BadgeOut:
        return cls(
            id=d["id"],
            title=d["title"],
            description=d["description"],
            category=d["category"],
            emblem=d["emblem"],
            metric_kind=d["metric_kind"],
            metric=d["metric"],
            tier=d["tier"],
            tier_name=d["tier_name"],
            thresholds=d["thresholds"],
            next_threshold=d["next_threshold"],
            tiers_awarded_at=d["tiers_awarded_at"],
            tiers_claimed_at=d["tiers_claimed_at"],
            tier_rewards=[TierRewardOut(**r) for r in d["tier_rewards"]],
        )


class MyBadgesOut(BaseModel):
    badges: list[BadgeOut]
