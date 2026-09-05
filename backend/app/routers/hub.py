from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.config import settings
from app.database import get_db
from app.repositories import feed as feed_repo
from app.repositories import hub as hub_repo
from app.services.quests import EVENT_RECOGNITION_GIVEN, record_quest_event
from app.scripts import seed_dev_hub_content as hub_mock
from app.schemas.hub import CreateHubItemIn, HubItemOut

# Company Hub V1 REST layer — mirrors routers/requests.py's dependency pattern (server-derived
# identity via get_current_email, a per-request AsyncSession via get_db). No realtime push in
# V1: the Hub is fetched on check-in and on manual reopen, not kept live like chat/presence.
#
# Hub -> Employee Feed wiring (Employee Feed V1): the Hub only ever TRIGGERS an activity here;
# all social discussion (reactions/comments/replies) lives exclusively in the Feed (see
# repositories/feed.py's module docstring) — the Hub item/state model gains nothing new for
# this.

router = APIRouter(tags=["hub"])

# Hub item `type` -> the Feed activity `type` it creates on acting (see act_on_hub_item below).
# Recognition items map to "congratulation" (not "recognition") per the Employee Feed V1 spec's
# explicit example. Content is intentionally name-free — the Feed has no employee-name table
# (this app has no users table, only email strings, same convention as everywhere else), so the
# frontend composes the full "X wished Y a Happy Birthday!" sentence from author/target emails
# it already resolves for chat/roster rendering.
_HUB_TYPE_TO_FEED_ACTIVITY: dict[str, tuple[str, str]] = {
    "birthday": ("birthday", "wished them a Happy Birthday! 🎉"),
    "recognition": ("congratulation", "congratulated them! 👏"),
}


@router.post("/hub/items", response_model=HubItemOut, status_code=201)
async def create_hub_item(
    body: CreateHubItemIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> HubItemOut:
    item = await hub_repo.create_item(
        db,
        type=body.type,
        title=body.title,
        description=body.description,
        image_url=body.image_url,
        start_at=body.start_at,
        end_at=body.end_at,
        priority=body.priority,
        cta_label=body.cta_label,
        cta_action=body.cta_action,
        audience_email=body.audience_email,
        target_employee_email=body.target_employee_email,
        created_by=email,
    )
    return HubItemOut.from_dict(item)


@router.get("/hub/items", response_model=list[HubItemOut])
async def list_hub_items(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> list[HubItemOut]:
    """Every item currently active for this employee (date-windowed, audience-filtered),
    merged with this employee's own seen/dismissed/acknowledged state. Required-priority items
    sort first — see list_active_items_for's ordering."""
    items = await hub_repo.list_active_items_for(db, email)
    states = await hub_repo.get_states_for(db, email, [i["id"] for i in items])
    return [HubItemOut.from_dict(item, states.get(item["id"])) for item in items]


async def _require_item(db: AsyncSession, item_id: str) -> dict:
    item = await hub_repo.get_item_by_id(db, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Hub item not found")
    return item


@router.post("/hub/items/{item_id}/dismiss", response_model=HubItemOut)
async def dismiss_hub_item(
    item_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> HubItemOut:
    item = await _require_item(db, item_id)
    state = await hub_repo.upsert_state(db, hub_item_id=item_id, employee_email=email, status="dismissed")
    return HubItemOut.from_dict(item, state)


@router.post("/hub/items/{item_id}/acknowledge", response_model=HubItemOut)
async def acknowledge_hub_item(
    item_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> HubItemOut:
    item = await _require_item(db, item_id)
    state = await hub_repo.upsert_state(
        db, hub_item_id=item_id, employee_email=email, status="acknowledged"
    )
    return HubItemOut.from_dict(item, state)


@router.post("/hub/items/{item_id}/action", response_model=HubItemOut)
async def act_on_hub_item(
    item_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> HubItemOut:
    """The item's CTA (Read More / Wish Happy Birthday / Congratulate / Answer Survey / See
    What's New). Persists the interaction (acted_at) without forcing dismissed/acknowledged.
    For a birthday/recognition item with a target_employee_email, also creates the
    corresponding Feed activity on that employee's feed — idempotently, so repeated clicks
    never create duplicate wishes/congratulations (see feed_repo.create_hub_triggered_post)."""
    item = await _require_item(db, item_id)
    state = await hub_repo.record_action(db, hub_item_id=item_id, employee_email=email)

    activity = _HUB_TYPE_TO_FEED_ACTIVITY.get(item["type"])
    if activity is not None and item["target_employee_email"]:
        feed_type, content = activity
        post, _created = await feed_repo.create_hub_triggered_post(
            db,
            hub_item_id=item_id,
            target_email=item["target_employee_email"],
            author_email=email,
            type=feed_type,
            content=content,
        )
        # Quest Foundation: same event and same key family as a hand-written feed post — the
        # durable post is the act, and a re-click returns the same post so it collapses.
        await record_quest_event(
            db,
            actor_email=post["author_email"],
            event_type=EVENT_RECOGNITION_GIVEN,
            dedupe_key=f"post:{post['id']}",
            target_email=post["target_email"],
            reference_id=post["id"],
            occurred_at=post["created_at"],
        )

    return HubItemOut.from_dict(item, state)


@router.post("/hub/dev/reset-my-state", status_code=200)
async def reset_dev_hub_state(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Dev-only demo control: restores the whole mock Hub experience for the CALLER, so the
    check-in flow can be re-run from scratch — wipes their own seen/dismissed/acknowledged/acted
    state AND their own Hub-triggered Feed activities on dev-seeded ([DEV]) items, then
    re-seeds/re-dates the mock dataset (see app/scripts/seed_dev_hub_content.py). Without the
    Feed half, `uq_feed_hub_activity` makes a second "Wish Happy Birthday" click a silent no-op
    and the action is only ever testable once.

    Hard-gated on settings.is_development (same fail-closed allow-list as app/auth/deps.py's
    dev-email bypass) — unreachable in production regardless of who calls it. Never touches real
    (non-[DEV]) items or any other employee's state/activities. `resetCount` keeps its original
    meaning (state rows removed) so the existing frontend DEV button needs no change."""
    if not settings.is_development:
        raise HTTPException(status_code=404, detail="Not found")
    return await hub_mock.reset_mock_hub_for_employee(db, employee_email=email)
