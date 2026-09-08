from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.config import settings
from app.database import get_db
from app.repositories import feed as feed_repo
from app.repositories import hub as hub_repo
from app.services.quests import EVENT_HUB_VISITED, EVENT_RECOGNITION_GIVEN, record_quest_event, utc_day_key
from app.services.notifications import notify_kudos_received
from app.services.quests import rewards
from app.services.quests.rewards import Reward, grant_kudos_received
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
# The item type stays "recognition" and the activity stays "congratulation" — both are stored
# values on live rows, so only the WORDS people read become Kudos (company terminology); nothing
# about the schema, the quest event, or the Feed shape changes. Content is intentionally
# name-free — the Feed has no employee-name table (this app has no users table, only email
# strings, same convention as everywhere else), so the frontend composes the full
# "X gave Y Kudos!" sentence from author/target emails it already resolves for chat/roster
# rendering.
_HUB_TYPE_TO_FEED_ACTIVITY: dict[str, tuple[str, str]] = {
    "birthday": ("birthday", "wished them a Happy Birthday! 🎉"),
    "recognition": ("congratulation", "gave them Kudos! 👏"),
}

# The Hub item type that means "give this person Kudos" — the only act that pays the RECIPIENT
# (see services/quests/rewards.grant_kudos_received). A birthday wish stays ordinary engagement.
_KUDOS_ITEM_TYPE = "recognition"


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
    # Onboarding Questline + daily missions: this GET is the only server-side trace of "the Hub was
    # opened" (both the check-in overlay and the manual Hub button fetch through it). Keyed per
    # actor per UTC day — later opens the same day are duplicates and write nothing.
    await record_quest_event(
        db,
        actor_email=email,
        event_type=EVENT_HUB_VISITED,
        dedupe_key=f"{email.strip().lower()}:{utc_day_key()}",
    )
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
    """The item's CTA (Read More / Wish Happy Birthday / Give Kudos / Answer Survey / See
    What's New). Persists the interaction (acted_at) without forcing dismissed/acknowledged.
    For a birthday/Kudos item with a target_employee_email, also creates the corresponding Feed
    activity on that employee's feed — idempotently, so repeated clicks never create duplicate
    wishes/Kudos (see feed_repo.create_hub_triggered_post). Giving yourself Kudos (or wishing
    yourself a happy birthday) records the interaction but creates no activity and pays
    nothing — the quest engine already drops self-targeted events, this closes the Feed half."""
    item = await _require_item(db, item_id)
    state = await hub_repo.record_action(db, hub_item_id=item_id, employee_email=email)

    activity = _HUB_TYPE_TO_FEED_ACTIVITY.get(item["type"])
    giver = email.strip().lower()
    target_employee = (item["target_employee_email"] or "").strip().lower()
    if activity is not None and target_employee and target_employee != giver:
        feed_type, content = activity
        is_kudos = item["type"] == _KUDOS_ITEM_TYPE
        grant = None
        # ANTI-FARMING V1 — the SAME rule and the SAME helper the profile Give Kudos action uses
        # (services/quests/rewards.kudos_reward_on_cooldown), so there is one server-side
        # cooldown, not two. Probed BEFORE the post is written, so the event about to be
        # recorded cannot be mistaken for an earlier one. A birthday wish is not Kudos and is
        # never gated. On cooldown the Hub still records the action and still creates the Feed
        # activity — only the event and the payout are withheld.
        rewarded = not is_kudos or not await rewards.kudos_reward_on_cooldown(
            db, giver=giver, recipient=target_employee
        )
        post, _created = await feed_repo.create_hub_triggered_post(
            db,
            hub_item_id=item_id,
            target_email=target_employee,
            author_email=giver,
            type=feed_type,
            content=content,
        )
        if rewarded:
            # Quest Foundation: the durable post is the act, and a re-click returns the same post
            # so it collapses. Kudos carry the `kudos:` key family the cooldown probe reads.
            await record_quest_event(
                db,
                actor_email=post["author_email"],
                event_type=EVENT_RECOGNITION_GIVEN,
                dedupe_key=(
                    rewards.kudos_dedupe_key(post["id"]) if is_kudos else f"post:{post['id']}"
                ),
                target_email=post["target_email"],
                reference_id=post["id"],
                occurred_at=post["created_at"],
            )
            # Progression & Rewards: the RECIPIENT's payout, keyed on the Kudos post itself, so
            # the idempotent post above makes the reward idempotent too — a re-click returns the
            # same post id and the ledger's unique index absorbs the second grant.
            if is_kudos:
                grant = await grant_kudos_received(
                    db, recipient=post["target_email"], giver=post["author_email"], reference_id=post["id"]
                )
        # Global Notifications V1 — SAME helper the profile Give Kudos action uses, so there is
        # one place that decides the wording. `grant` is None whenever nothing was paid (the
        # cooldown, or an idempotent re-click), and the notification then omits the reward line
        # instead of claiming a payout that did not happen. Keyed on the post, which
        # create_hub_triggered_post returns idempotently, so a re-click collapses onto the one
        # bell entry rather than adding another.
        if is_kudos:
            await notify_kudos_received(
                db,
                recipient=post["target_email"],
                giver=post["author_email"],
                # The Hub CTA has no message box — `content` is the name-free Feed fragment
                # ("gave them Kudos! 👏"), not something the giver wrote, so it is
                # deliberately NOT quoted as their words.
                message="",
                post_id=post["id"],
                reward=Reward(xp=grant.xp, coins=grant.coins) if grant is not None else None,
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
