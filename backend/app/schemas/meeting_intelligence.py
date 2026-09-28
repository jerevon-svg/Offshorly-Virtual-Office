from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class ReviewItemIn(BaseModel):
    """A human decision on one generated Meeting Intelligence item. `content` only with action "edit"."""

    action: Literal["confirm", "edit", "reject"]
    content: dict | None = None
