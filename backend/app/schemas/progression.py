from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.services.quests.rewards import Progression


class ProgressionOut(BaseModel):
    """Lifetime XP and Coins (sums over reward_grants) and the level derived from XP."""

    model_config = ConfigDict(populate_by_name=True)

    xp: int
    coins: int
    level: int
    level_start_xp: int = Field(alias="levelStartXp")
    next_level_xp: int = Field(alias="nextLevelXp")

    @classmethod
    def from_progression(cls, p: Progression) -> ProgressionOut:
        return cls(xp=p.xp, coins=p.coins, level=p.level, level_start_xp=p.level_start_xp, next_level_xp=p.next_level_xp)


class ClaimIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    quest_id: str = Field(alias="questId")
    # Empty (default) for a permanent quest; the mission's period key ("d:..."/"w:...") otherwise.
    period_key: str = Field(default="", alias="periodKey")


class RewardOut(BaseModel):
    xp: int
    coins: int


class ClaimOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    quest_id: str = Field(alias="questId")
    period_key: str = Field(alias="periodKey")
    # False when this call found the reward already claimed (idempotent replay): same 200, same
    # balances, nothing granted twice.
    granted_now: bool = Field(alias="grantedNow")
    reward: RewardOut
    progression: ProgressionOut
