"""Dev-only Company Hub mock content seeder.

Adds clearly-tagged (created_by="dev-seed-mock") Hub items so the Company Hub UI
(Announcement/Birthday/Recognition/Survey/What's New, plus dismiss/acknowledge/action
persistence) can be manually tested end-to-end without touching real company data.

NOT an alembic migration on purpose: render.yaml runs `alembic upgrade head` on every deploy
(including production), so seeding fake birthday/recognition content about named test
employees there would ship confusing/fake data in front of real coworkers. This script is
hard-gated on settings.is_development (same fail-closed allow-list as app/auth/deps.py's
dev-email bypass) and must be run manually against a local dev DB.

Usage (from backend/, with the venv active):
    python -m app.scripts.seed_dev_hub_content            # insert the 5 mock items (no-op if
                                                           # already present)
    python -m app.scripts.seed_dev_hub_content --clear    # remove every item (and every
                                                           # employee's seen/dismissed/
                                                           # acknowledged state on them) this
                                                           # script has ever created, and
                                                           # nothing else
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from app.config import settings
from app.database import async_session_maker
from app.models.hub import HubItem, HubItemState
from app.repositories import hub as hub_repo
from app.repositories.hub import DEV_SEED_TAG

# Existing test identities this app is already bound to for local dev — reused rather than
# inventing fake employees (see frontend/src/services/office/MockOfficeService.ts's mockPeople
# and frontend/src/data/avatarRegistry.ts).
BIRTHDAY_TARGET = ("Micah", "micah@offshorly.com")
RECOGNITION_TARGET = ("Alex", "alex@offshorly.com")


async def _already_seeded(session) -> bool:
    result = await session.execute(select(HubItem.id).where(HubItem.created_by == DEV_SEED_TAG))
    return result.first() is not None


async def seed() -> None:
    async with async_session_maker() as session:
        if await _already_seeded(session):
            print(
                f"Dev mock Hub content already present (created_by={DEV_SEED_TAG!r}); skipping. "
                "Run with --clear first to reset."
            )
            return

        now = datetime.now(timezone.utc)
        birthday_name, birthday_email = BIRTHDAY_TARGET
        recognition_name, recognition_email = RECOGNITION_TARGET

        await hub_repo.create_item(
            session,
            type="announcement",
            title="[DEV] Mock Announcement: Office Wi-Fi Upgrade",
            description=(
                "Development/test announcement. Priority is `required`, so its action button "
                'reads "Read More & Acknowledge" — one click both performs the action and '
                'acknowledges it, which is what unblocks "Enter Office".'
            ),
            priority="required",
            cta_label="Read More",
            audience_email=None,
            created_by=DEV_SEED_TAG,
        )
        await hub_repo.create_item(
            session,
            type="birthday",
            title=f"[DEV] Happy Birthday, {birthday_name}! 🎂",
            description=(
                f"Mock birthday for manual testing — wish {birthday_name} ({birthday_email}) a "
                "happy birthday below. Dismissible; not required. Clicking Wish Happy Birthday "
                "creates a `birthday` activity on their Employee Feed."
            ),
            priority="normal",
            cta_label="Wish Happy Birthday",
            audience_email=None,
            target_employee_email=birthday_email,
            created_by=DEV_SEED_TAG,
        )
        await hub_repo.create_item(
            session,
            type="recognition",
            title=f"[DEV] Employee of the Month: {recognition_name} 🏆",
            description=(
                f"Mock recognition for manual testing — congratulate {recognition_name} "
                f"({recognition_email}) below. Dismissible; not required. Clicking Congratulate "
                "creates a `congratulation` activity on their Employee Feed."
            ),
            priority="important",
            cta_label="Congratulate",
            end_at=now + timedelta(days=14),
            audience_email=None,
            target_employee_email=recognition_email,
            created_by=DEV_SEED_TAG,
        )
        await hub_repo.create_item(
            session,
            type="survey",
            title="[DEV] Mock Employee Survey",
            description="Development/test survey for exercising the Answer Survey action.",
            priority="normal",
            cta_label="Answer Survey",
            audience_email=None,
            created_by=DEV_SEED_TAG,
        )
        await hub_repo.create_item(
            session,
            type="whatsnew",
            title="[DEV] Mock Virtual Office Update",
            description="Development/test What's New card for exercising the See What's New action.",
            priority="normal",
            cta_label="See What's New",
            audience_email=None,
            created_by=DEV_SEED_TAG,
        )
        print(f"Seeded 5 dev-only Company Hub mock items (created_by={DEV_SEED_TAG!r}).")


async def clear() -> None:
    async with async_session_maker() as session:
        item_ids = (
            (await session.execute(select(HubItem.id).where(HubItem.created_by == DEV_SEED_TAG)))
            .scalars()
            .all()
        )
        if not item_ids:
            print("No dev-only Company Hub mock content found; nothing to clear.")
            return

        # SQLite in this app does not enforce ON DELETE CASCADE (no `PRAGMA foreign_keys=ON` —
        # see app/database.py), so every tester's seen/dismissed/acknowledged state on these mock
        # items is deleted explicitly rather than relied on to cascade.
        await session.execute(delete(HubItemState).where(HubItemState.hub_item_id.in_(item_ids)))
        result = await session.execute(delete(HubItem).where(HubItem.id.in_(item_ids)))
        await session.commit()
        print(f"Removed {result.rowcount} dev-only Company Hub mock item(s) and their state rows.")


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
