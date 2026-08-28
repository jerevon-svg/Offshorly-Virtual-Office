from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.position import EmployeePosition

# Durable cold-start snapshot repository — see app/models/position.py's docstring for why this
# is a plain upsert-by-email table rather than the uuid-PK / requester-lifecycle convention used
# by room_requests.py / talk_requests.py. Only ever called from walk_arrived (never walk_started
# — in-flight movement is not persisted, see PositionRegistry's docstring) and from app startup
# (list_all, to seed the in-memory registry).


def _position_to_dict(row: EmployeePosition) -> dict[str, Any]:
    return {
        "email": row.email,
        "x": row.x,
        "y": row.y,
        "facing": row.facing,
        "state": row.state,
        "seat_key": row.seat_key,
        "room_id": row.room_id,
        "revision": row.revision,
        "updated_at": row.updated_at,
    }


async def upsert_stable(
    session: AsyncSession,
    *,
    email: str,
    x: float,
    y: float,
    facing: str,
    state: str,
    seat_key: str | None,
    room_id: str | None,
    revision: int,
    updated_at: datetime,
) -> None:
    """Atomic upsert-by-email for the two dialects this app actually runs on (sqlite locally/in
    tests, Postgres in production — see app/database.py). Both branches use a single
    `INSERT ... ON CONFLICT DO UPDATE` statement rather than session.get()-then-add/setattr:
    two concurrent walk_arrived persists for the same email (e.g. two tabs/sockets for the same
    user) would otherwise both see no existing row, and the second commit would hit a PK
    violation instead of merging — a lost update. The `where=` guard on the update additionally
    makes this revision-safe: an out-of-order/older persist (lower revision than what's already
    stored) is a no-op rather than regressing the stored row, since `PositionRegistry.arrive`'s
    revisions are monotonic but persistence calls could theoretically be reordered by the async
    DB layer. A generic select+merge fallback remains for any other dialect."""
    email = email.strip().lower()
    values = dict(
        email=email,
        x=x,
        y=y,
        facing=facing,
        state=state,
        seat_key=seat_key,
        room_id=room_id,
        revision=revision,
        updated_at=updated_at,
    )
    bind_name = session.bind.dialect.name if session.bind is not None else ""
    if bind_name == "sqlite":
        stmt = sqlite_insert(EmployeePosition).values(**values)
        excluded = stmt.excluded
        stmt = stmt.on_conflict_do_update(
            index_elements=[EmployeePosition.email],
            set_={k: v for k, v in values.items() if k != "email"},
            where=(EmployeePosition.revision < excluded.revision),
        )
        await session.execute(stmt)
    elif bind_name == "postgresql":
        stmt = postgresql_insert(EmployeePosition).values(**values)
        excluded = stmt.excluded
        stmt = stmt.on_conflict_do_update(
            index_elements=[EmployeePosition.email],
            set_={k: v for k, v in values.items() if k != "email"},
            where=(EmployeePosition.revision < excluded.revision),
        )
        await session.execute(stmt)
    else:
        existing = await session.get(EmployeePosition, email)
        if existing is None:
            session.add(EmployeePosition(**values))
        elif existing.revision < revision:
            for key, value in values.items():
                setattr(existing, key, value)
    await session.commit()


async def list_all(session: AsyncSession) -> list[dict[str, Any]]:
    result = await session.execute(select(EmployeePosition))
    return [_position_to_dict(row) for row in result.scalars().all()]
