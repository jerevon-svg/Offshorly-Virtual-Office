from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.chat import to_iso_z


class WhiteboardCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class WhiteboardSaveIn(BaseModel):
    """`version` is the version the client LOADED (or last saved) — see save_document."""

    document: dict[str, Any]
    version: int = Field(ge=1)


class WhiteboardSummaryOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    conversation_id: str = Field(alias="conversationId")
    title: str
    version: int
    created_by_email: str = Field(alias="createdByEmail")
    updated_by_email: str = Field(alias="updatedByEmail")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    @field_serializer("created_at", "updated_at")
    def _ser_dt(self, value: datetime) -> str:
        return to_iso_z(value)


class WhiteboardOut(WhiteboardSummaryOut):
    # Opaque tldraw editor snapshot; null for a board nobody has saved yet.
    document: dict[str, Any] | None = None
