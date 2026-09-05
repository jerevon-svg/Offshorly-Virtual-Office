from __future__ import annotations

from sqlalchemy import Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# Daily/Weekly Missions — the one table this checkpoint adds on top of Quest Foundation.
#
# Progress itself is NOT here: a mission's progress is a quest_progress row whose period_key is
# the mission period ("d:2026-09-05" / "w:2026-W36"), exactly the seam that table reserved.
# Events are the same quest_events ledger the foundation writes. This table only answers "which
# missions from the pool are active for this actor in this period" — the roll of the dice,
# pinned so a pool change mid-period cannot reshuffle what someone is already working on.
#
# WHO WRITES: services/quests/missions.py's ensure_assignments (lazily, on the first event or the
# first read of a period), and nothing else.
#
# FUTURE SEAM (Progression & Rewards): reward/claim state belongs on THIS row (e.g. claimed_at,
# reward columns) as an additive migration — one row per (actor, period, mission) already exists
# and is unique. Completion detection for XP/Coins is QuestRecordResult.completed_missions.


class MissionAssignment(BaseModel):
    __tablename__ = "mission_assignments"
    __table_args__ = (
        Index(
            "ux_mission_assignments_actor_period_mission", "actor_email", "period_key", "mission_id", unique=True
        ),
        Index("ix_mission_assignments_actor_period", "actor_email", "period_key"),
    )

    actor_email: Mapped[str] = mapped_column(String(255), nullable=False)
    cadence: Mapped[str] = mapped_column(String(8), nullable=False)
    period_key: Mapped[str] = mapped_column(String(32), nullable=False)
    mission_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # Display order within the period; the deterministic draw's position.
    slot: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
