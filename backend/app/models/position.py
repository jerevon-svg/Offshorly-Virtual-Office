from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class EmployeePosition(Base):
    """Durable cold-start snapshot of each employee's last-known *stable* (arrived/sitting)
    spatial position. Deliberately NOT the source of truth while the server is live — that is
    app/services/position_registry.py's in-memory `PositionRegistry` (mirrors room_presence.py /
    spatial_session.py's in-memory-authoritative pattern). This table exists only so a fresh
    process (deploy restart, single-worker crash-restart) can repopulate the registry via
    `load_stable()` instead of showing everyone at (0, 0). In-flight movement (a walk currently
    underway) is never persisted here — only the last arrived/sitting state.

    Does NOT extend BaseModel: the natural key here is the normalized email itself (no
    surrogate uuid `id`, no created_at — see TalkRequest/RoomEntryRequest for the uuid-PK
    convention this deliberately departs from, since there is exactly one row per email that is
    upserted in place, never inserted repeatedly)."""

    __tablename__ = "employee_positions"

    email: Mapped[str] = mapped_column(String(255), primary_key=True)
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    facing: Mapped[str] = mapped_column(String(8), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    seat_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    room_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
