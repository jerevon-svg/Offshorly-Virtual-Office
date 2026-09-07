from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.badge import BadgeAward, BadgeProgress
from app.services.quests.badges import MAX_TIER, TIER_NAMES, all_badges, reconcile_all
from app.services.quests.rewards import badge_period_key, claimed_map, reward_for_badge_tier

# READ side of Badge Progression, self-scoped like the other progression reads. The one write it
# may cause is the one-time backfill for an actor who has history but no badge rows yet.


async def list_my_badges(session: AsyncSession, *, actor_email: str, now: datetime | None = None) -> list[dict[str, Any]]:
    actor = actor_email.strip().lower()
    now = now or datetime.now(timezone.utc)
    rows = {
        r.badge_id: r
        for r in (await session.execute(select(BadgeProgress).where(BadgeProgress.actor_email == actor))).scalars().all()
    }
    if not rows:
        await reconcile_all(session, actor=actor, now=now)
        rows = {
            r.badge_id: r
            for r in (await session.execute(select(BadgeProgress).where(BadgeProgress.actor_email == actor))).scalars().all()
        }
    awards = (await session.execute(select(BadgeAward).where(BadgeAward.actor_email == actor))).scalars().all()
    awarded_at: dict[tuple[str, int], datetime] = {(a.badge_id, a.tier): a.awarded_at for a in awards}
    tier_keys = tuple(badge_period_key(t) for t in range(1, MAX_TIER + 1))
    claimed = await claimed_map(session, actor=actor, period_keys=tier_keys)

    out: list[dict[str, Any]] = []
    for d in all_badges():
        row = rows.get(d.id)
        metric = row.metric if row else 0
        tier = row.tier if row else 0
        next_threshold = d.thresholds[tier] if tier < len(d.thresholds) else None
        out.append(
            {
                "id": d.id,
                "title": d.title,
                "description": d.description,
                "category": d.category,
                "emblem": d.emblem,
                "metric_kind": d.metric,
                "metric": metric,
                "tier": tier,
                "tier_name": TIER_NAMES[tier],
                "thresholds": list(d.thresholds),
                "next_threshold": next_threshold,
                "tiers_awarded_at": [awarded_at.get((d.id, t)) for t in range(1, 5)],
                "tiers_claimed_at": [claimed.get((d.id, badge_period_key(t))) for t in range(1, 5)],
                "tier_rewards": [
                    {"xp": reward_for_badge_tier(t).xp, "coins": reward_for_badge_tier(t).coins} for t in range(1, 5)
                ],
            }
        )
    return out
