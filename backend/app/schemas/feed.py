from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from app.repositories.feed import ALLOWED_REACTION_EMOJI
from app.schemas.chat import to_iso_z

# camelCase wire shapes for Employee Feed V1 — mirrors app/schemas/hub.py's conventions.

FeedPostType = Literal["post", "birthday", "recognition", "congratulation"]
ReactionEmoji = Literal["❤️", "👏", "🎉", "🔥", "🙌"]


def _require_non_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("Text cannot be empty")
    return value


class CreatePostIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    content: str

    @field_validator("content")
    @classmethod
    def _validate_content(cls, v: str) -> str:
        return _require_non_blank(v)


class CreateCommentIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    content: str
    parent_comment_id: str | None = Field(default=None, alias="parentCommentId")

    @field_validator("content")
    @classmethod
    def _validate_content(cls, v: str) -> str:
        return _require_non_blank(v)


class ReactIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    emoji: ReactionEmoji


class FeedCommentOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    post_id: str = Field(alias="postId")
    parent_comment_id: str | None = Field(default=None, alias="parentCommentId")
    author_email: str = Field(alias="authorEmail")
    content: str
    created_at: datetime = Field(alias="createdAt")
    replies: list["FeedCommentOut"] = Field(default_factory=list)

    @field_serializer("created_at")
    def _serialize_created_at(self, dt: datetime) -> str:
        return to_iso_z(dt)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> FeedCommentOut:
        return cls(
            id=d["id"],
            post_id=d["post_id"],
            parent_comment_id=d["parent_comment_id"],
            author_email=d["author_email"],
            content=d["content"],
            created_at=d["created_at"],
            replies=[cls.from_dict(r) for r in d.get("replies", [])],
        )


class ReactionSummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    emoji: str
    count: int


class FeedPostOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    target_email: str = Field(alias="targetEmail")
    author_email: str = Field(alias="authorEmail")
    type: str
    content: str
    created_at: datetime = Field(alias="createdAt")
    reactions: list[ReactionSummary] = Field(default_factory=list)
    # The requesting employee's own reaction on this post, if any — lets the client render the
    # picker's current selection without a second round trip.
    my_reaction: str | None = Field(default=None, alias="myReaction")
    comments: list[FeedCommentOut] = Field(default_factory=list)
    can_delete: bool = Field(default=False, alias="canDelete")

    @field_serializer("created_at")
    def _serialize_created_at(self, dt: datetime) -> str:
        return to_iso_z(dt)

    @classmethod
    def from_dict(
        cls,
        post: dict[str, Any],
        *,
        reactions: list[dict[str, Any]],
        comments: list[dict[str, Any]],
        viewer_email: str,
    ) -> FeedPostOut:
        counts: dict[str, int] = {}
        my_reaction: str | None = None
        for r in reactions:
            counts[r["emoji"]] = counts.get(r["emoji"], 0) + 1
            if r["employee_email"] == viewer_email:
                my_reaction = r["emoji"]

        return cls(
            id=post["id"],
            target_email=post["target_email"],
            author_email=post["author_email"],
            type=post["type"],
            content=post["content"],
            created_at=post["created_at"],
            reactions=[ReactionSummary(emoji=e, count=c) for e, c in counts.items()],
            my_reaction=my_reaction,
            comments=[FeedCommentOut.from_dict(c) for c in comments],
            can_delete=post["type"] == "post" and post["author_email"] == viewer_email,
        )


assert ALLOWED_REACTION_EMOJI == set(ReactionEmoji.__args__)  # keep the two lists in lockstep
