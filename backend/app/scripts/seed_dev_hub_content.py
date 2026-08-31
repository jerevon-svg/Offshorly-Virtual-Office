"""Dev-only Company Hub mock content: the seeded test dataset, plus the full mock reset.

Adds clearly-tagged (created_by="dev-seed-mock") Hub items so the Company Hub UI
(Announcement/Birthday/Recognition/Survey/What's New, plus dismiss/acknowledge/action
persistence) can be manually tested end-to-end without touching real company data.

NOT an alembic migration on purpose: render.yaml runs `alembic upgrade head` on every deploy
(including production), so seeding fake birthday/recognition content about named test
employees there would ship confusing/fake data in front of real coworkers. Every entry point
here is hard-gated on settings.is_development by its caller (the CLI's main() below, the
MOCK_HUB_SEED startup hook in app/main.py, and routers/hub.py's dev reset endpoint) — the same
fail-closed allow-list as app/auth/deps.py's dev-email bypass.

Two properties make this dataset re-testable rather than a one-shot seed:

* **Stable ids** (MOCK_ITEM_IDS) — every item is upserted by a fixed, human-readable id instead
  of a fresh uuid4, so re-seeding refreshes the SAME rows rather than piling up duplicates, and
  a test/bookmark can name an item directly.
* **Relative dates** — start_at/end_at are recomputed from `now` on every ensure_seeded() call
  (server start, or a mock reset), never frozen at first-seed time. A dataset seeded weeks ago
  can't age out of list_active_items_for's [start_at, end_at) window and silently send the Hub
  back to "You're all caught up!". Production date filtering is untouched; only the seeded rows'
  own dates move.

Usage (from backend/, with the venv active):
    python -m app.scripts.seed_dev_hub_content            # insert/refresh the mock items
    python -m app.scripts.seed_dev_hub_content --clear    # remove every item (and every
                                                          # employee's seen/dismissed/
                                                          # acknowledged state, and every
                                                          # Hub-triggered Feed activity) this
                                                          # script has ever created, and
                                                          # nothing else
"""
from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session_maker
from app.models.feed import FeedPost
from app.models.hub import HubItem, HubItemState
from app.repositories import hub as hub_repo
from app.repositories.hub import DEV_SEED_TAG

# Existing test identities this app is already bound to for local dev — reused rather than
# inventing fake employees (see frontend/src/services/office/MockOfficeService.ts's mockPeople
# and frontend/src/data/avatarRegistry.ts).
BIRTHDAY_TARGET = ("Micah", "micah@offshorly.com")
RECOGNITION_TARGET = ("Alex", "alex@offshorly.com")

_HOUR = timedelta(hours=1)
_LONG_WINDOW = timedelta(days=90)


@dataclass(frozen=True)
class MockHubItemSpec:
    """One seeded Hub item. `start_offset`/`end_offset` are relative to the seeding moment, so
    the row is re-dated (not re-created) every time ensure_seeded runs — see module docstring.
    `end_offset=None` means no end date at all (never expires)."""

    id: str
    type: str
    title: str
    description: str
    priority: str
    cta_label: str
    start_offset: timedelta
    end_offset: timedelta | None
    target_employee_email: str | None = None


_BIRTHDAY_NAME, _BIRTHDAY_EMAIL = BIRTHDAY_TARGET
_RECOGNITION_NAME, _RECOGNITION_EMAIL = RECOGNITION_TARGET

# Stable ids: HubItem.id is String(36); these are deliberately readable rather than uuid4 so a
# failing test or a manual sqlite poke names the item it means.
MOCK_ITEMS: tuple[MockHubItemSpec, ...] = (
    MockHubItemSpec(
        id="devmock-announcement-required",
        type="announcement",
        title="[DEV] Mock Announcement: Office Wi-Fi Upgrade",
        description=(
            "Development/test announcement. Priority is `required`, so its action button "
            'reads "Read More & Acknowledge" — one click both performs the action and '
            'acknowledges it, which is what unblocks "Enter Office". Until then the Hub has no '
            "Dismiss button for this card and the primary button stays disabled."
        ),
        priority="required",
        cta_label="Read More",
        start_offset=-_HOUR,
        end_offset=None,
    ),
    MockHubItemSpec(
        id="devmock-announcement-normal",
        type="announcement",
        title="[DEV] Mock Announcement: Quarterly Town Hall",
        description=(
            "Development/test announcement at `normal` priority — the dismissible counterpart "
            "to the required one above. Use it to exercise unseen -> seen -> dismissed: Read "
            "More records the action (button gains a ✓), Dismiss hides it from the check-in "
            "view while the manual Hub view keeps showing it labelled 'Dismissed'."
        ),
        priority="normal",
        cta_label="Read More",
        start_offset=-_HOUR,
        end_offset=None,
    ),
    MockHubItemSpec(
        id="devmock-birthday-micah",
        type="birthday",
        title=f"[DEV] Happy Birthday, {_BIRTHDAY_NAME}! 🎂",
        description=(
            f"Mock birthday for manual testing — wish {_BIRTHDAY_NAME} ({_BIRTHDAY_EMAIL}) a "
            "happy birthday below. Dismissible; not required. Clicking Wish Happy Birthday "
            "creates a `birthday` activity on their Employee Feed (once per person — the "
            "mock reset clears your own so it can be re-tested)."
        ),
        priority="normal",
        cta_label="Wish Happy Birthday",
        start_offset=-_HOUR,
        end_offset=_LONG_WINDOW,
        target_employee_email=_BIRTHDAY_EMAIL,
    ),
    MockHubItemSpec(
        id="devmock-recognition-alex",
        type="recognition",
        title=f"[DEV] Employee of the Month: {_RECOGNITION_NAME} 🏆",
        description=(
            f"Mock recognition for manual testing — congratulate {_RECOGNITION_NAME} "
            f"({_RECOGNITION_EMAIL}) below. Dismissible; not required. Clicking Congratulate "
            "creates a `congratulation` activity on their Employee Feed (once per person — the "
            "mock reset clears your own so it can be re-tested)."
        ),
        priority="important",
        cta_label="Congratulate",
        start_offset=-_HOUR,
        end_offset=_LONG_WINDOW,
        target_employee_email=_RECOGNITION_EMAIL,
    ),
    MockHubItemSpec(
        id="devmock-survey",
        type="survey",
        title="[DEV] Mock Employee Survey",
        description=(
            "Development/test survey for exercising the Answer Survey action. Survey is an "
            "existing Hub item `type` with a CTA + dismiss, not a separate question/response "
            "system — this seeds that existing shape, nothing new."
        ),
        priority="normal",
        cta_label="Answer Survey",
        start_offset=-_HOUR,
        end_offset=_LONG_WINDOW,
    ),
    MockHubItemSpec(
        id="devmock-whatsnew",
        type="whatsnew",
        title="[DEV] Mock Virtual Office Update",
        description="Development/test What's New card for exercising the See What's New action.",
        priority="normal",
        cta_label="See What's New",
        start_offset=-_HOUR,
        end_offset=None,
    ),
)

MOCK_ITEM_IDS: frozenset[str] = frozenset(spec.id for spec in MOCK_ITEMS)


def _dev_item_ids_subquery():
    return select(HubItem.id).where(HubItem.created_by == DEV_SEED_TAG)


async def ensure_seeded(
    session: AsyncSession, *, now: datetime | None = None, prune_legacy: bool = False
) -> dict[str, int]:
    """Idempotently insert-or-refresh the mock dataset, re-dating every item relative to `now`.

    Safe to call repeatedly (server start, every mock reset): matching rows are UPDATED in
    place, so ids, and therefore any other employee's state on them, survive. Only rows tagged
    created_by == DEV_SEED_TAG are ever touched; real Hub content is invisible to this function.

    `prune_legacy` additionally drops DEV_SEED_TAG rows whose id is NOT in MOCK_ITEM_IDS — the
    pre-stable-id seeder's uuid4 output, which would otherwise show up as a second copy of every
    card in a long-lived playground DB. It is off by default and enabled only by the seeding
    entry points (the CLI and the MOCK_HUB_SEED startup hook), never by the per-caller reset:
    deleting an item necessarily deletes EVERY tester's state on it, which would break the
    reset's "only your own rows" guarantee.
    """
    moment = now or datetime.now(timezone.utc)

    existing = {
        item.id: item
        for item in (
            await session.execute(select(HubItem).where(HubItem.created_by == DEV_SEED_TAG))
        )
        .scalars()
        .all()
    }

    stale_ids = (
        [item_id for item_id in existing if item_id not in MOCK_ITEM_IDS] if prune_legacy else []
    )
    if stale_ids:
        # SQLite in this app does not enforce ON DELETE CASCADE / SET NULL (no
        # `PRAGMA foreign_keys=ON` — see app/database.py), so dependent rows go explicitly.
        await session.execute(delete(HubItemState).where(HubItemState.hub_item_id.in_(stale_ids)))
        await session.execute(delete(FeedPost).where(FeedPost.source_hub_item_id.in_(stale_ids)))
        await session.execute(delete(HubItem).where(HubItem.id.in_(stale_ids)))

    created = 0
    refreshed = 0
    for spec in MOCK_ITEMS:
        start_at = moment + spec.start_offset
        end_at = moment + spec.end_offset if spec.end_offset is not None else None
        row = existing.get(spec.id)
        if row is None:
            session.add(
                HubItem(
                    id=spec.id,
                    type=spec.type,
                    title=spec.title,
                    description=spec.description,
                    start_at=start_at,
                    end_at=end_at,
                    priority=spec.priority,
                    cta_label=spec.cta_label,
                    audience_email=None,
                    target_employee_email=spec.target_employee_email,
                    created_by=DEV_SEED_TAG,
                )
            )
            created += 1
        else:
            row.type = spec.type
            row.title = spec.title
            row.description = spec.description
            row.priority = spec.priority
            row.cta_label = spec.cta_label
            row.audience_email = None
            row.target_employee_email = spec.target_employee_email
            row.start_at = start_at
            row.end_at = end_at
            refreshed += 1

    await session.commit()
    return {"created": created, "refreshed": refreshed, "removedStale": len(stale_ids)}


async def reset_mock_hub_for_employee(
    session: AsyncSession, *, employee_email: str, now: datetime | None = None
) -> dict[str, int]:
    """Full mock-Hub restore for ONE tester, so the check-in experience can be re-run from
    scratch without restarting anything or hand-editing the sqlite file.

    Deliberately narrow on both axes, matching the guarantee the old state-only reset made:
    only rows belonging to DEV_SEED_TAG items are considered (a real Hub item is never touched),
    and within those only `employee_email`'s own rows are deleted — a second tester's
    acknowledgements and their Feed wishes/congratulations survive intact.

    Three effects, in order:
      1. the caller's seen/dismissed/acknowledged + acted_at state on mock items is deleted;
      2. the caller's Hub-triggered Feed activities (birthday/congratulation) sourced from mock
         items are deleted — without this, `uq_feed_hub_activity` makes the second
         "Wish Happy Birthday" click a silent no-op, so the action is only ever testable once;
      3. the dataset is re-seeded/re-dated (ensure_seeded), restoring anything deleted and
         pushing the date window forward again.
    """
    self_email = employee_email.strip().lower()

    # Step 1 reuses the existing repository primitive rather than re-deriving its scoping.
    state_count = await hub_repo.reset_dev_state_for_employee(session, employee_email=self_email)
    posts = await session.execute(
        delete(FeedPost).where(
            FeedPost.author_email == self_email,
            FeedPost.source_hub_item_id.in_(_dev_item_ids_subquery()),
        )
    )
    await session.commit()

    seeded = await ensure_seeded(session, now=now)
    return {
        "resetCount": state_count,
        "feedActivitiesCleared": posts.rowcount,
        "itemsCreated": seeded["created"],
        "itemsRefreshed": seeded["refreshed"],
    }


async def clear_mock_content(session: AsyncSession) -> int:
    """Remove the mock dataset entirely — items, every employee's state on them, and every
    Hub-triggered Feed activity sourced from them. Nothing outside created_by == DEV_SEED_TAG."""
    item_ids = (
        (await session.execute(select(HubItem.id).where(HubItem.created_by == DEV_SEED_TAG)))
        .scalars()
        .all()
    )
    if not item_ids:
        return 0

    await session.execute(delete(HubItemState).where(HubItemState.hub_item_id.in_(item_ids)))
    await session.execute(delete(FeedPost).where(FeedPost.source_hub_item_id.in_(item_ids)))
    result = await session.execute(delete(HubItem).where(HubItem.id.in_(item_ids)))
    await session.commit()
    return result.rowcount


async def seed() -> None:
    async with async_session_maker() as session:
        counts = await ensure_seeded(session, prune_legacy=True)
    print(
        f"Mock Company Hub content ready (created_by={DEV_SEED_TAG!r}): "
        f"{counts['created']} created, {counts['refreshed']} re-dated, "
        f"{counts['removedStale']} legacy row(s) removed."
    )


async def clear() -> None:
    async with async_session_maker() as session:
        removed = await clear_mock_content(session)
    if removed == 0:
        print("No dev-only Company Hub mock content found; nothing to clear.")
    else:
        print(f"Removed {removed} dev-only Company Hub mock item(s) and their dependent rows.")


def main() -> None:
    if not settings.is_development:
        print(
            'Refusing to run: APP_ENV is not "development" (this seeder is dev-only, mirroring '
            "app/auth/deps.py's dev-email bypass gate).",
            file=sys.stderr,
        )
        raise SystemExit(1)

    if "--clear" in sys.argv:
        asyncio.run(clear())
    else:
        asyncio.run(seed())


if __name__ == "__main__":
    main()
