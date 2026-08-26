from __future__ import annotations

from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feed import FeedComment, FeedPost, FeedReaction

# Employee Feed V1 repository. Plain-dict returns, matching this codebase's house style (see
# app/repositories/requests.py's module docstring). The Feed owns all social discussion
# (reactions/comments/replies); the Company Hub only ever triggers a post via
# create_hub_triggered_post — see routers/hub.py's act_on_hub_item.

ALLOWED_REACTION_EMOJI = {"❤️", "👏", "🎉", "🔥", "🙌"}


def _post_to_dict(post: FeedPost) -> dict[str, Any]:
    return {
        "id": post.id,
        "target_email": post.target_email,
        "author_email": post.author_email,
        "type": post.type,
        "content": post.content,
        "source_hub_item_id": post.source_hub_item_id,
        "created_at": post.created_at,
        "updated_at": post.updated_at,
    }


def _comment_to_dict(comment: FeedComment) -> dict[str, Any]:
    return {
        "id": comment.id,
        "post_id": comment.post_id,
        "parent_comment_id": comment.parent_comment_id,
        "author_email": comment.author_email,
        "content": comment.content,
        "created_at": comment.created_at,
        "updated_at": comment.updated_at,
    }


def _reaction_to_dict(reaction: FeedReaction) -> dict[str, Any]:
    return {
        "id": reaction.id,
        "post_id": reaction.post_id,
        "employee_email": reaction.employee_email,
        "emoji": reaction.emoji,
    }


async def create_post(
    session: AsyncSession,
    *,
    target_email: str,
    author_email: str,
    type: str,
    content: str,
) -> dict[str, Any]:
    post = FeedPost(
        target_email=target_email.strip().lower(),
        author_email=author_email.strip().lower(),
        type=type,
        content=content,
    )
    session.add(post)
    await session.flush()
    await session.commit()
    return _post_to_dict(post)


async def create_hub_triggered_post(
    session: AsyncSession,
    *,
    hub_item_id: str,
    target_email: str,
    author_email: str,
    type: str,
    content: str,
) -> tuple[dict[str, Any], bool]:
    """Idempotent create for a Hub-generated activity (birthday/congratulation) — same
    idempotent-retry shape as requests.py's create_request. `uq_feed_hub_activity` (hub_item_id,
    author_email) is what actually prevents the duplicate; this just makes a repeat call (the
    same employee re-clicking "Wish Happy Birthday" on the same Hub item) return the existing
    post instead of raising. Returns (post, created) so the caller can log/skip side effects on
    the not-created path without a second lookup."""
    author = author_email.strip().lower()
    try:
        async with session.begin_nested():
            post = FeedPost(
                target_email=target_email.strip().lower(),
                author_email=author,
                type=type,
                content=content,
                source_hub_item_id=hub_item_id,
            )
            session.add(post)
            await session.flush()
    except IntegrityError:
        result = await session.execute(
            select(FeedPost).where(
                FeedPost.source_hub_item_id == hub_item_id,
                FeedPost.author_email == author,
            )
        )
        existing = result.scalar_one_or_none()
        if existing is None:
            raise
        await session.commit()
        return _post_to_dict(existing), False

    await session.commit()
    return _post_to_dict(post), True


async def get_post_by_id(session: AsyncSession, post_id: str) -> dict[str, Any] | None:
    result = await session.execute(select(FeedPost).where(FeedPost.id == post_id))
    post = result.scalar_one_or_none()
    return _post_to_dict(post) if post is not None else None


async def list_posts_for_target(session: AsyncSession, target_email: str) -> list[dict[str, Any]]:
    """Newest first — see Employee Feed V1 spec."""
    result = await session.execute(
        select(FeedPost)
        .where(FeedPost.target_email == target_email.strip().lower())
        .order_by(FeedPost.created_at.desc())
    )
    return [_post_to_dict(p) for p in result.scalars().all()]


async def delete_post(session: AsyncSession, *, post_id: str, requester_email: str) -> bool:
    """Deletes a post the requester authored. Only `type == "post"` (a normal post) is
    deletable — Hub-generated activities (birthday/recognition/congratulation) are not, per the
    Employee Feed V1 spec's "users can delete their own normal posts" scope. Explicitly deletes
    reactions/comments/replies first rather than relying on the FK's ON DELETE CASCADE — SQLite
    in this app does not enforce it (no `PRAGMA foreign_keys=ON`, see app/database.py), so a
    cascade-only delete would silently orphan rows in local/dev sqlite. Returns False (no-op) if
    the post doesn't exist, isn't authored by requester, or isn't a normal post."""
    post = await get_post_by_id(session, post_id)
    if post is None or post["author_email"] != requester_email.strip().lower():
        return False
    if post["type"] != "post":
        return False

    await session.execute(delete(FeedReaction).where(FeedReaction.post_id == post_id))
    await session.execute(delete(FeedComment).where(FeedComment.post_id == post_id))
    await session.execute(delete(FeedPost).where(FeedPost.id == post_id))
    await session.commit()
    return True


async def upsert_reaction(
    session: AsyncSession, *, post_id: str, employee_email: str, emoji: str
) -> dict[str, Any]:
    """One reaction per (post, employee) — reacting again with a different emoji changes it
    rather than adding a second row. Same insert-then-fall-back-to-update-on-IntegrityError shape
    as hub.py's upsert_state."""
    if emoji not in ALLOWED_REACTION_EMOJI:
        raise ValueError(f"Invalid reaction emoji: {emoji!r}")
    email = employee_email.strip().lower()

    result = await session.execute(
        select(FeedReaction).where(
            FeedReaction.post_id == post_id, FeedReaction.employee_email == email
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        existing.emoji = emoji
        await session.commit()
        return _reaction_to_dict(existing)

    try:
        async with session.begin_nested():
            reaction = FeedReaction(post_id=post_id, employee_email=email, emoji=emoji)
            session.add(reaction)
            await session.flush()
    except IntegrityError:
        result = await session.execute(
            select(FeedReaction).where(
                FeedReaction.post_id == post_id, FeedReaction.employee_email == email
            )
        )
        existing = result.scalar_one_or_none()
        assert existing is not None
        existing.emoji = emoji

    await session.commit()
    result = await session.execute(
        select(FeedReaction).where(
            FeedReaction.post_id == post_id, FeedReaction.employee_email == email
        )
    )
    reaction = result.scalar_one()
    return _reaction_to_dict(reaction)


async def remove_reaction(session: AsyncSession, *, post_id: str, employee_email: str) -> bool:
    result = await session.execute(
        delete(FeedReaction).where(
            FeedReaction.post_id == post_id,
            FeedReaction.employee_email == employee_email.strip().lower(),
        )
    )
    await session.commit()
    return result.rowcount > 0


async def get_reactions_for_posts(
    session: AsyncSession, post_ids: list[str]
) -> dict[str, list[dict[str, Any]]]:
    if not post_ids:
        return {}
    result = await session.execute(select(FeedReaction).where(FeedReaction.post_id.in_(post_ids)))
    by_post: dict[str, list[dict[str, Any]]] = {}
    for reaction in result.scalars().all():
        by_post.setdefault(reaction.post_id, []).append(_reaction_to_dict(reaction))
    return by_post


async def create_comment(
    session: AsyncSession,
    *,
    post_id: str,
    author_email: str,
    content: str,
    parent_comment_id: str | None = None,
) -> dict[str, Any]:
    """Creates a top-level comment, or a reply when `parent_comment_id` is given. V1 keeps
    replies exactly one level deep: replying to a comment that is ITSELF a reply (i.e. whose own
    parent_comment_id is set) is rejected, rather than silently re-parenting to the top-level
    comment — see Employee Feed V1 spec's "do not create infinitely nested threads"."""
    if parent_comment_id is not None:
        result = await session.execute(
            select(FeedComment).where(FeedComment.id == parent_comment_id)
        )
        parent = result.scalar_one_or_none()
        if parent is None or parent.post_id != post_id:
            raise ValueError("Parent comment not found on this post")
        if parent.parent_comment_id is not None:
            raise ValueError("Cannot reply to a reply — V1 supports one level of nesting only")

    comment = FeedComment(
        post_id=post_id,
        parent_comment_id=parent_comment_id,
        author_email=author_email.strip().lower(),
        content=content,
    )
    session.add(comment)
    await session.flush()
    await session.commit()
    return _comment_to_dict(comment)


async def get_comment_by_id(session: AsyncSession, comment_id: str) -> dict[str, Any] | None:
    result = await session.execute(select(FeedComment).where(FeedComment.id == comment_id))
    comment = result.scalar_one_or_none()
    return _comment_to_dict(comment) if comment is not None else None


async def delete_comment(session: AsyncSession, *, comment_id: str, requester_email: str) -> bool:
    """Deletes a comment or reply the requester authored. Deleting a top-level comment also
    explicitly deletes its replies (not relied on FK cascade — see delete_post's docstring for
    why). Returns False if the comment doesn't exist or isn't authored by requester."""
    comment = await get_comment_by_id(session, comment_id)
    if comment is None or comment["author_email"] != requester_email.strip().lower():
        return False

    if comment["parent_comment_id"] is None:
        await session.execute(delete(FeedComment).where(FeedComment.parent_comment_id == comment_id))
    await session.execute(delete(FeedComment).where(FeedComment.id == comment_id))
    await session.commit()
    return True


async def get_comments_for_posts(
    session: AsyncSession, post_ids: list[str]
) -> dict[str, list[dict[str, Any]]]:
    """Top-level comments and their (at most one level of) replies, grouped by post_id. Each
    top-level comment dict gets a `replies` key (a plain list, oldest first) so callers don't
    need a second lookup."""
    if not post_ids:
        return {}
    result = await session.execute(
        select(FeedComment)
        .where(FeedComment.post_id.in_(post_ids))
        .order_by(FeedComment.created_at.asc())
    )
    all_comments = [_comment_to_dict(c) for c in result.scalars().all()]

    replies_by_parent: dict[str, list[dict[str, Any]]] = {}
    top_level_by_post: dict[str, list[dict[str, Any]]] = {}
    for comment in all_comments:
        if comment["parent_comment_id"] is not None:
            replies_by_parent.setdefault(comment["parent_comment_id"], []).append(comment)
        else:
            top_level_by_post.setdefault(comment["post_id"], []).append(comment)

    for comments in top_level_by_post.values():
        for comment in comments:
            comment["replies"] = replies_by_parent.get(comment["id"], [])

    return top_level_by_post
