from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.avatar_wardrobe import AvatarWardrobe


async def get(session: AsyncSession, email: str) -> AvatarWardrobe | None:
    return await session.get(AvatarWardrobe, email.strip().lower())


async def upsert(session: AsyncSession, email: str, nickname: str | None, outfit: dict) -> AvatarWardrobe:
    """Write the caller's ONE row (insert or replace) and commit."""
    key = email.strip().lower()
    row = await session.get(AvatarWardrobe, key)
    now = datetime.now(timezone.utc)
    if row is None:
        row = AvatarWardrobe(email=key, nickname=nickname, outfit=outfit, updated_at=now)
        session.add(row)
    else:
        row.nickname = nickname
        row.outfit = outfit
        row.updated_at = now
    await session.commit()
    await session.refresh(row)
    return row


async def all_outfits(session: AsyncSession) -> dict[str, dict]:
    rows = (await session.execute(select(AvatarWardrobe.email, AvatarWardrobe.outfit))).all()
    return {email: outfit for email, outfit in rows if outfit}
