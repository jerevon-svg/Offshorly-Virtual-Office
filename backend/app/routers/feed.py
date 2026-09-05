from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.repositories import feed as feed_repo
from app.services.quests import EVENT_PROFILE_VIEWED, EVENT_RECOGNITION_GIVEN, record_quest_event, utc_day_key
from app.schemas.feed import CreateCommentIn, CreatePostIn, FeedPostOut, ReactIn

# Employee Feed V1 REST layer — mirrors routers/hub.py's dependency pattern. The Feed owns all
# social discussion (reactions/comments/replies); Company Hub actions only ever create a post
# here via routers/hub.py's act_on_hub_item calling feed_repo.create_hub_triggered_post directly
# (no HTTP hop) — see that router for the Hub->Feed wiring.

router = APIRouter(tags=["feed"])


async def _assemble_feed(db: AsyncSession, target_email: str, viewer_email: str) -> list[FeedPostOut]:
    posts = await feed_repo.list_posts_for_target(db, target_email)
    post_ids = [p["id"] for p in posts]
    reactions_by_post = await feed_repo.get_reactions_for_posts(db, post_ids)
    comments_by_post = await feed_repo.get_comments_for_posts(db, post_ids)
    return [
        FeedPostOut.from_dict(
            post,
            reactions=reactions_by_post.get(post["id"], []),
            comments=comments_by_post.get(post["id"], []),
            viewer_email=viewer_email,
        )
        for post in posts
    ]


@router.get("/feed/{target_email}", response_model=list[FeedPostOut])
async def get_feed(
    target_email: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> list[FeedPostOut]:
    """Every authenticated employee can view any employee's feed — see Employee Feed V1's
    permissions scope ("Authenticated employees can view employee feeds")."""
    # Onboarding Questline + missions: EmployeeProfile fetches this on open, so it is the
    # server-side trace of "a profile was viewed". Own profile (the 👤 Profile button) must not
    # count. Keyed per actor+target per UTC day: re-opening the same profile is one view.
    actor = email.strip().lower()
    target = target_email.strip().lower()
    if target and target != actor:
        await record_quest_event(
            db,
            actor_email=actor,
            event_type=EVENT_PROFILE_VIEWED,
            dedupe_key=f"{actor}:{target}:{utc_day_key()}",
            target_email=target,
        )
    return await _assemble_feed(db, target_email, email)


@router.post("/feed/{target_email}/posts", response_model=FeedPostOut, status_code=201)
async def create_post(
    target_email: str,
    body: CreatePostIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> FeedPostOut:
    """Always creates a `type="post"` normal post — Hub-generated types (birthday/
    recognition/congratulation) are never client-creatable through this endpoint, so a caller
    can't spoof a fake birthday wish."""
    post = await feed_repo.create_post(
        db, target_email=target_email, author_email=email, type="post", content=body.content
    )
    # Quest Foundation: writing on a COWORKER's feed is a social act (the engine drops a
    # self-targeted event by rule, so a post on your own feed never counts). Key = post id.
    await record_quest_event(
        db,
        actor_email=post["author_email"],
        event_type=EVENT_RECOGNITION_GIVEN,
        dedupe_key=f"post:{post['id']}",
        target_email=post["target_email"],
        reference_id=post["id"],
        occurred_at=post["created_at"],
    )
    return FeedPostOut.from_dict(post, reactions=[], comments=[], viewer_email=email)


@router.delete("/feed/posts/{post_id}", status_code=204)
async def delete_post(
    post_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> None:
    deleted = await feed_repo.delete_post(db, post_id=post_id, requester_email=email)
    if not deleted:
        raise HTTPException(
            status_code=403,
            detail="Cannot delete: not found, not yours, or not a normal post",
        )


@router.post("/feed/posts/{post_id}/react", response_model=FeedPostOut)
async def react_to_post(
    post_id: str,
    body: ReactIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> FeedPostOut:
    post = await feed_repo.get_post_by_id(db, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")

    await feed_repo.upsert_reaction(db, post_id=post_id, employee_email=email, emoji=body.emoji)
    # Quest Foundation: reacting to a coworker's post counts once per (post, reactor) no matter
    # how many times the emoji changes; the author is the target so self-reactions are dropped.
    await record_quest_event(
        db,
        actor_email=email,
        event_type=EVENT_RECOGNITION_GIVEN,
        dedupe_key=f"reaction:{post_id}:{email.strip().lower()}",
        target_email=post["author_email"],
        reference_id=post_id,
    )
    reactions = (await feed_repo.get_reactions_for_posts(db, [post_id])).get(post_id, [])
    comments = (await feed_repo.get_comments_for_posts(db, [post_id])).get(post_id, [])
    return FeedPostOut.from_dict(post, reactions=reactions, comments=comments, viewer_email=email)


@router.delete("/feed/posts/{post_id}/react", response_model=FeedPostOut)
async def remove_reaction(
    post_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> FeedPostOut:
    post = await feed_repo.get_post_by_id(db, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")

    await feed_repo.remove_reaction(db, post_id=post_id, employee_email=email)
    reactions = (await feed_repo.get_reactions_for_posts(db, [post_id])).get(post_id, [])
    comments = (await feed_repo.get_comments_for_posts(db, [post_id])).get(post_id, [])
    return FeedPostOut.from_dict(post, reactions=reactions, comments=comments, viewer_email=email)


@router.post("/feed/posts/{post_id}/comments", response_model=FeedPostOut, status_code=201)
async def create_comment(
    post_id: str,
    body: CreateCommentIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> FeedPostOut:
    post = await feed_repo.get_post_by_id(db, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")

    try:
        await feed_repo.create_comment(
            db,
            post_id=post_id,
            author_email=email,
            content=body.content,
            parent_comment_id=body.parent_comment_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    reactions = (await feed_repo.get_reactions_for_posts(db, [post_id])).get(post_id, [])
    comments = (await feed_repo.get_comments_for_posts(db, [post_id])).get(post_id, [])
    return FeedPostOut.from_dict(post, reactions=reactions, comments=comments, viewer_email=email)


@router.delete("/feed/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> None:
    deleted = await feed_repo.delete_comment(db, comment_id=comment_id, requester_email=email)
    if not deleted:
        raise HTTPException(status_code=403, detail="Cannot delete: not found or not yours")
