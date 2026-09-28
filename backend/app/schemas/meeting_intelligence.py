from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class ReviewItemIn(BaseModel):
    """A human decision on one generated Meeting Intelligence item. `content` only with action "edit"."""

    action: Literal["confirm", "edit", "reject"]
    content: dict | None = None


class TwinTurnIn(BaseModel):
    """One earlier question and answer from the open Twin view — referent context only, never evidence."""

    question: str
    answer: str


class TwinQueryIn(BaseModel):
    """PHASE 8B — a Meeting Twin question. Lengths and turn counts are enforced by services/meeting_twin.py
    so a refusal carries a stable code."""

    question: str = ""
    history: list[TwinTurnIn] = []


class OrgMemorySearchIn(BaseModel):
    """PHASE 9A — an Organizational Memory retrieval query. Bounds and values are enforced by
    services/organizational_memory.py so a refusal carries a stable code."""

    query: str = ""
    types: list[str] = []
    attendance: str = "all"
    since: str | None = None
    until: str | None = None
    roomId: str | None = None
    limit: int = 10
