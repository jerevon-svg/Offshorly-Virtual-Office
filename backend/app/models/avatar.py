from __future__ import annotations
from sqlalchemy import Float, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import BaseModel


class Avatar(BaseModel):
    """Mirrors frontend `SavedAvatar` (services/avatar/types.ts). `id` (BaseModel) is the internal
    row UUID; `avatar_id` is the frontend-generated GeneratedAvatar.avatarId used to look the row up.
    """

    __tablename__ = "avatars"

    avatar_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    # Atlas email of the avatar's owner. Nullable: colleague avatars generated on someone else's
    # behalf (see SaveAvatarRequest.ownerEmail) have no logged-in owner of their own.
    owner_email: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)

    nickname: Mapped[str] = mapped_column(String(255), nullable=False)
    employee_name: Mapped[str] = mapped_column(String(255), nullable=False)
    outfit_id: Mapped[str] = mapped_column(String(64), nullable=False)
    room_id: Mapped[str] = mapped_column(String(64), nullable=False)

    preview_url: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    seed: Mapped[str] = mapped_column(String(255), nullable=False)

    # ISO timestamp strings as produced by the frontend (GeneratedAvatar.generatedAt /
    # SavedAvatar.savedAt) — kept as-is rather than parsed into DateTime to avoid any lossy
    # round-trip through a different serialization.
    generated_at: Mapped[str] = mapped_column(String(64), nullable=False)
    saved_at: Mapped[str] = mapped_column(String(64), nullable=False)

    # "pending" | "ready" | "error" — optional on SavedAvatar for backward compatibility with
    # avatars saved before this field existed (see types.ts).
    generation_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    job_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # The 24-slot AvatarSpriteSet Record (walk/idle/pat/sitType), optional — most avatars today
    # omit this and render as a static portrait (see types.ts).
    sprite_set: Mapped[dict | None] = mapped_column(JSON, nullable=True)
