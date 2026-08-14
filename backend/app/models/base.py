from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Any
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, server_default=func.now(), nullable=False
    )
    # `onupdate` is a PYTHON-side callable, not func.now(). A SQL-side onupdate makes SQLAlchemy
    # expire `updated_at` after every UPDATE flush (only the DB knows the new value), so any code
    # that reads it afterwards — e.g. a serializer building the response — fires a lazy re-SELECT.
    # In the async session that is sync IO in the wrong place and raises MissingGreenlet -> a 500.
    # `server_default` stays for rows written by raw SQL / migrations.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, server_default=func.now(), onupdate=_utc_now, nullable=False
    )


class BaseModel(Base, TimestampMixin):
    __abstract__ = True

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)

    def to_dict(self) -> dict[str, Any]:
        return {column.name: getattr(self, column.name) for column in self.__table__.columns}
