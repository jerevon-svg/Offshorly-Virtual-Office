from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.avatar_wardrobe import WARDROBE_SLOTS

_CONTROL = re.compile(r"[\u0000-\u001f\u007f<>]")


class OutfitItem(BaseModel):
    """One dressed slot: a catalogue garment id and one of its colourway names (shape-checked only)."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    asset_id: str = Field(alias="assetId", pattern=r"^[a-z0-9-]{1,40}$")
    colorway: str = Field(pattern=r"^[a-z0-9-]{1,24}$")


class WardrobeIn(BaseModel):
    """PUT /avatar/wardrobe/me — carries NO identity: the row written is always the caller's own."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    nickname: str | None = None
    outfit: dict[str, OutfitItem] = Field(default_factory=dict)

    @field_validator("nickname")
    @classmethod
    def _clean_nickname(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = _CONTROL.sub("", v).strip()[:40]
        return cleaned or None

    @field_validator("outfit")
    @classmethod
    def _known_slots(cls, v: dict[str, OutfitItem]) -> dict[str, OutfitItem]:
        unknown = sorted(set(v) - set(WARDROBE_SLOTS))
        if unknown:
            raise ValueError(f"unknown wardrobe slot(s): {', '.join(unknown)}")
        return v


class WardrobeOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    nickname: str | None = None
    outfit: dict[str, OutfitItem] = Field(default_factory=dict)
    updated_at: datetime | None = Field(default=None, alias="updatedAt")


class WardrobesOut(BaseModel):
    """GET /avatar/wardrobes — every saved OUTFIT, keyed by email, so the office can dress each coworker's body as
    they chose. Outfits only: nicknames stay with their owner's own read."""

    model_config = ConfigDict(populate_by_name=True)

    outfits: dict[str, dict[str, OutfitItem]]
