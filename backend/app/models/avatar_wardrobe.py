from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# The HumanBase character slots an employee may dress (frontend humanCatalogue: every garment with colourways).
WARDROBE_SLOTS: tuple[str, ...] = ("top", "bottom", "shoes")


class AvatarWardrobe(Base):
    """One employee's saved outfit (and nickname) for their HumanBase character — Character Studio's EDIT.

    ONE ROW PER EMPLOYEE, keyed by the verified email: the only row a caller can ever write is their own
    (routers/avatar_wardrobe.py derives the key from the session, never from the request). Absent means
    "never edited" — the character wears its approved default (the Offshorly uniform), so nothing seeds this.

    The outfit is DATA, not geometry: {slot: {assetId, colorway}} for top / bottom / shoes. It never touches the
    generated head — saving a wardrobe regenerates nothing and costs nothing. The ids are validated for shape
    here; which garments exist is the frontend catalogue's business, and the office ignores an id it does not
    carry (so a stale row can only ever fall back to the default, never break a body)."""

    __tablename__ = "avatar_wardrobes"

    email: Mapped[str] = mapped_column(String(255), primary_key=True)
    nickname: Mapped[str | None] = mapped_column(String(40), nullable=True)
    outfit: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
