from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - registers every model on Base.metadata
from app.database import Base, get_db
from app.main import fastapi_app
from app.models.notification import Notification
from app.repositories import hub as hub_repo
from app.repositories import notifications as notifications_repo
from app.services import notifications as notifications_service
from app.services.quests import rewards

# Global Notifications V1. Covers the generic model/service/REST layer (unread count, read /
# mark-all-read, self-scoping, persistence, realtime push) and the first real integration:
# Kudos received — including the one wording rule that matters, that a Kudos which paid nothing
# must never claim a payout. Same isolated-engine fixture as test_kudos.py.

pytestmark = pytest.mark.asyncio

REWARD_LINE = f"+{rewards.REWARD_KUDOS_RECEIVED.xp} XP · +{rewards.REWARD_KUDOS_RECEIVED.coins} Coins"


@pytest.fixture(autouse=True)
async def _isolated_db():
    engine = create_async_engine(
        "sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_get_db():
        async with session_maker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    fastapi_app.dependency_overrides[get_db] = _override_get_db
    yield session_maker
    fastapi_app.dependency_overrides.pop(get_db, None)
    await engine.dispose()


@pytest.fixture
def emitted(monkeypatch):
    """Captures every realtime emit the service makes, so the push can be asserted without a
    live Socket.IO client. Patches the object the service actually holds."""
    calls: list[tuple[str, dict, dict]] = []

    async def _fake_emit(event, payload=None, **kwargs):
        calls.append((event, payload, kwargs))

    monkeypatch.setattr(notifications_service.sio, "emit", _fake_emit)
    return calls


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _headers(email: str) -> dict:
    return {"x-dev-email": email}


async def _kudos(client, giver: str, recipient: str, message: str = "Great work on the deployment!"):
    return await client.post(f"/feed/{recipient}/kudos", json={"message": message}, headers=_headers(giver))


async def _rows(session_maker, recipient: str) -> list[Notification]:
    async with session_maker() as session:
        rows = await session.execute(
            select(Notification)
            .where(Notification.recipient_email == recipient)
            .order_by(Notification.created_at)
        )
        return list(rows.scalars().all())


async def _seed(session_maker, recipient: str, *, count: int, read: bool = False) -> list[dict]:
    """Writes notifications straight through the service, one second apart so newest-first is
    unambiguous regardless of clock resolution."""
    base = datetime.now(timezone.utc) - timedelta(hours=1)
    out = []
    async with session_maker() as session:
        for i in range(count):
            row = await notifications_service.notify(
                session,
                recipient=recipient,
                type="kudos_received",
                title=f"Notification {i}",
                body=None,
                dedupe_key=f"seed:{i}",
                now=base + timedelta(seconds=i),
            )
            out.append(row)
        if read:
            await notifications_repo.mark_all_read(session, recipient_email=recipient)
        await session.commit()
    return out


# --- generic layer: list / unread count / read / mark-all ------------------------------------


async def test_list_returns_newest_first_with_an_exact_unread_count(_isolated_db, emitted):
    await _seed(_isolated_db, "alex@example.com", count=3)

    async with await _client() as client:
        resp = await client.get("/notifications/me", headers=_headers("alex@example.com"))

    assert resp.status_code == 200
    body = resp.json()
    assert [n["title"] for n in body["notifications"]] == ["Notification 2", "Notification 1", "Notification 0"]
    assert body["unreadCount"] == 3
    assert all(n["readAt"] is None for n in body["notifications"])


async def test_empty_state_is_an_empty_list_and_a_zero_count(_isolated_db):
    async with await _client() as client:
        resp = await client.get("/notifications/me", headers=_headers("nobody@example.com"))

    assert resp.json() == {"notifications": [], "unreadCount": 0}


async def test_marking_one_read_lowers_the_count_and_is_idempotent(_isolated_db, emitted):
    await _seed(_isolated_db, "alex@example.com", count=2)

    async with await _client() as client:
        listed = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()
        target = listed["notifications"][0]["id"]

        first = await client.post(f"/notifications/{target}/read", headers=_headers("alex@example.com"))
        second = await client.post(f"/notifications/{target}/read", headers=_headers("alex@example.com"))
        after = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()

    assert first.json() == {"unreadCount": 1, "updated": 1}
    # Replay: same 200, same count, nothing changed twice.
    assert second.json() == {"unreadCount": 1, "updated": 0}
    assert after["unreadCount"] == 1
    assert after["notifications"][0]["readAt"] is not None


async def test_mark_all_read_clears_the_badge(_isolated_db, emitted):
    await _seed(_isolated_db, "alex@example.com", count=3)

    async with await _client() as client:
        resp = await client.post("/notifications/read-all", headers=_headers("alex@example.com"))
        after = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()

    assert resp.json() == {"unreadCount": 0, "updated": 3}
    assert after["unreadCount"] == 0
    assert all(n["readAt"] is not None for n in after["notifications"])
    # Mark-all on an already-clear bell is a no-op, not an error.
    async with await _client() as client:
        again = await client.post("/notifications/read-all", headers=_headers("alex@example.com"))
    assert again.json() == {"unreadCount": 0, "updated": 0}


async def test_notifications_are_self_scoped(_isolated_db, emitted):
    await _seed(_isolated_db, "alex@example.com", count=1)
    mine = (await _rows(_isolated_db, "alex@example.com"))[0]

    async with await _client() as client:
        # Somebody else cannot see it...
        theirs = await client.get("/notifications/me", headers=_headers("bon@example.com"))
        # ...nor mark it read (same answer as a missing id — no existence leak).
        steal = await client.post(f"/notifications/{mine.id}/read", headers=_headers("bon@example.com"))
        missing = await client.post("/notifications/does-not-exist/read", headers=_headers("bon@example.com"))
        # ...nor clear it with mark-all.
        await client.post("/notifications/read-all", headers=_headers("bon@example.com"))
        still_mine = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()

    assert theirs.json()["notifications"] == []
    assert steal.json() == missing.json() == {"unreadCount": 0, "updated": 0}
    assert still_mine["unreadCount"] == 1


async def test_state_persists_across_a_fresh_client(_isolated_db, emitted):
    """Refresh/reconnect persistence: the server holds read state, so a brand-new client (a new
    tab, a reloaded page) re-asks and gets exactly what the previous one left behind."""
    await _seed(_isolated_db, "alex@example.com", count=2)

    async with await _client() as client:
        listed = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()
        await client.post(
            f"/notifications/{listed['notifications'][0]['id']}/read", headers=_headers("alex@example.com")
        )

    async with await _client() as reconnected:
        after = (await reconnected.get("/notifications/me", headers=_headers("alex@example.com"))).json()

    assert after["unreadCount"] == 1
    assert after["notifications"][0]["readAt"] is not None
    assert after["notifications"][1]["readAt"] is None


async def test_the_listing_window_never_caps_the_unread_badge(_isolated_db, emitted):
    await _seed(_isolated_db, "alex@example.com", count=5)

    async with await _client() as client:
        resp = await client.get("/notifications/me?limit=2", headers=_headers("alex@example.com"))

    body = resp.json()
    assert len(body["notifications"]) == 2
    assert body["unreadCount"] == 5


# --- realtime push ---------------------------------------------------------------------------


async def test_a_new_notification_is_pushed_to_the_recipients_user_room(_isolated_db, emitted):
    async with await _client() as client:
        await _kudos(client, "bon@example.com", "alex@example.com")

    assert len(emitted) == 1
    event, payload, kwargs = emitted[0]
    assert event == notifications_service.EVENT_NOTIFICATION_NEW
    assert kwargs["room"] == "user:alex@example.com"
    assert payload["unreadCount"] == 1
    # The pushed object is byte-for-byte what a fetch returns, so a client needs no second code
    # path for a live notification.
    async with await _client() as client:
        listed = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()
    assert payload["notification"] == listed["notifications"][0]


async def test_the_giver_is_not_notified(_isolated_db, emitted):
    async with await _client() as client:
        await _kudos(client, "bon@example.com", "alex@example.com")
        giver_bell = (await client.get("/notifications/me", headers=_headers("bon@example.com"))).json()

    assert giver_bell == {"notifications": [], "unreadCount": 0}
    assert [k["room"] for _, _, k in emitted] == ["user:alex@example.com"]


async def test_a_dead_socket_never_breaks_the_action(_isolated_db, monkeypatch):
    async def _boom(*args, **kwargs):
        raise RuntimeError("socket is gone")

    monkeypatch.setattr(notifications_service.sio, "emit", _boom)

    async with await _client() as client:
        resp = await _kudos(client, "bon@example.com", "alex@example.com")

    assert resp.status_code == 201
    assert len(await _rows(_isolated_db, "alex@example.com")) == 1


# --- Kudos integration: wording and idempotency ----------------------------------------------


async def test_a_rewarded_kudos_quotes_the_message_and_the_amounts_that_were_granted(_isolated_db, emitted):
    async with await _client() as client:
        await _kudos(client, "bon@example.com", "alex@example.com", "Great work on the deployment!")
        listed = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()

    entry = listed["notifications"][0]
    assert entry["type"] == "kudos_received"
    assert entry["title"] == "🏆 You received Kudos!"
    assert entry["body"] == 'Bon: “Great work on the deployment!”\n' + REWARD_LINE
    assert listed["unreadCount"] == 1


async def test_a_cooldown_kudos_is_announced_without_claiming_a_payout(_isolated_db, emitted):
    """The whole point of passing the grant rather than the reward table: the SECOND Kudos from
    the same giver inside the anti-farming window pays nothing, so its notification must carry
    no +XP/+Coins line."""
    async with await _client() as client:
        await _kudos(client, "bon@example.com", "alex@example.com", "First one")
        await _kudos(client, "bon@example.com", "alex@example.com", "Second one")
        listed = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()

    assert listed["unreadCount"] == 2
    second, first = listed["notifications"]
    assert second["body"] == 'Bon: “Second one”'
    assert REWARD_LINE not in (second["body"] or "")
    assert first["body"] == 'Bon: “First one”\n' + REWARD_LINE
    # And the ledger — the source of truth — still shows exactly one payout.
    async with await _client() as client:
        progression = (await client.get("/progression/me", headers=_headers("alex@example.com"))).json()
    assert progression["xp"] == rewards.REWARD_KUDOS_RECEIVED.xp


async def test_a_kudos_notification_points_at_the_recipients_feed_and_the_kudos_post(_isolated_db, emitted):
    async with await _client() as client:
        created = (await _kudos(client, "bon@example.com", "alex@example.com")).json()
        listed = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()

    entry = listed["notifications"][0]
    assert entry["navKind"] == notifications_service.NAV_PROFILE_FEED
    assert entry["navPayload"] == {"email": "alex@example.com", "postId": created["id"]}


async def test_the_hub_kudos_cta_notifies_once_however_often_it_is_clicked(_isolated_db, emitted):
    async with _isolated_db() as session:
        item = await hub_repo.create_item(
            session,
            type="recognition",
            title="Employee of the Month",
            description="d",
            cta_label="Give Kudos",
            target_employee_email="alex@example.com",
        )
        await session.commit()

    async with await _client() as client:
        await client.post(f"/hub/items/{item['id']}/action", headers=_headers("bon@example.com"))
        await client.post(f"/hub/items/{item['id']}/action", headers=_headers("bon@example.com"))
        listed = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()

    assert listed["unreadCount"] == 1
    entry = listed["notifications"][0]
    # No message box on the Hub CTA — the giver is named, nothing is put in their mouth.
    assert entry["body"] == "Bon gave you Kudos.\n" + REWARD_LINE
    assert len(emitted) == 1  # the re-click's duplicate is absorbed, not re-pushed


async def test_a_birthday_wish_creates_no_notification(_isolated_db, emitted):
    async with _isolated_db() as session:
        item = await hub_repo.create_item(
            session, type="birthday", title="Happy Birthday", description="d",
            target_employee_email="alex@example.com",
        )
        await session.commit()

    async with await _client() as client:
        await client.post(f"/hub/items/{item['id']}/action", headers=_headers("bon@example.com"))
        listed = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()

    assert listed == {"notifications": [], "unreadCount": 0}
    assert emitted == []


async def test_a_normal_feed_post_creates_no_notification(_isolated_db, emitted):
    async with await _client() as client:
        await client.post(
            "/feed/alex@example.com/posts", json={"content": "hello"}, headers=_headers("bon@example.com")
        )
        listed = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()

    assert listed["unreadCount"] == 0


async def test_self_kudos_is_refused_and_notifies_nobody(_isolated_db, emitted):
    async with await _client() as client:
        resp = await _kudos(client, "alex@example.com", "alex@example.com")
        listed = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()

    assert resp.status_code == 400
    assert listed["unreadCount"] == 0
    assert emitted == []


# --- service-level guarantees ----------------------------------------------------------------


async def test_a_duplicate_dedupe_key_never_rolls_back_the_callers_own_writes(_isolated_db, emitted):
    """A notification must never break the thing it announces (services/notifications.py rule
    2): the duplicate INSERT unwinds inside its own SAVEPOINT and the surrounding work stands."""
    async with _isolated_db() as session:
        first = await notifications_service.notify(
            session, recipient="alex@example.com", type="kudos_received", title="one", dedupe_key="k"
        )
        second = await notifications_service.notify(
            session, recipient="alex@example.com", type="kudos_received", title="two", dedupe_key="k"
        )
        # The session is still usable — that is the part a failed SAVEPOINT would have destroyed.
        third = await notifications_service.notify(
            session, recipient="alex@example.com", type="kudos_received", title="three", dedupe_key="k2"
        )
        await session.commit()

    assert first is not None and second is None and third is not None
    assert sorted(r.title for r in await _rows(_isolated_db, "alex@example.com")) == ["one", "three"]


async def test_notify_without_a_recipient_is_dropped_not_raised(_isolated_db, emitted):
    async with _isolated_db() as session:
        assert await notifications_service.notify(
            session, recipient="  ", type="kudos_received", title="x", dedupe_key="k"
        ) is None
    assert emitted == []


async def test_keyless_notifications_never_collide(_isolated_db, emitted):
    async with _isolated_db() as session:
        a = await notifications_service.notify(
            session, recipient="alex@example.com", type="kudos_received", title="a"
        )
        b = await notifications_service.notify(
            session, recipient="alex@example.com", type="kudos_received", title="b"
        )
        await session.commit()

    assert a is not None and b is not None
    assert len(await _rows(_isolated_db, "alex@example.com")) == 2


# --- 8-hour checkout reminder: the client-requested, self-scoped, once-per-day bell entry ------


async def test_work_hours_reached_writes_one_unread_entry_pointing_at_checkout(_isolated_db, emitted):
    async with await _client() as client:
        res = await client.post(
            "/notifications/me/work-hours-reached",
            json={"workDate": "2026-09-11"},
            headers=_headers("alex@example.com"),
        )
        listed = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()

    assert res.status_code == 200
    assert res.json()["created"] is True
    assert listed["unreadCount"] == 1
    row = listed["notifications"][0]
    assert row["type"] == notifications_service.TYPE_WORK_HOURS_REACHED
    assert row["title"] == "8 hours reached"
    assert row["body"] == "You’ve completed your work hours for today. Ready to check out?"
    assert row["navKind"] == notifications_service.NAV_CHECKOUT
    assert row["readAt"] is None
    # Pushed live to the caller's own room, like every other notification.
    assert [event for event, _payload, _kw in emitted] == [notifications_service.EVENT_NOTIFICATION_NEW]


async def test_work_hours_reached_is_once_per_work_date_however_often_the_client_asks(_isolated_db, emitted):
    async with await _client() as client:
        first = await client.post(
            "/notifications/me/work-hours-reached", json={"workDate": "2026-09-11"}, headers=_headers("alex@example.com")
        )
        # A refresh re-arming the reminder and the 30-minute follow-up cards both re-ask.
        second = await client.post(
            "/notifications/me/work-hours-reached", json={"workDate": "2026-09-11"}, headers=_headers("alex@example.com")
        )
        third = await client.post(
            "/notifications/me/work-hours-reached", json={"workDate": "2026-09-11"}, headers=_headers("alex@example.com")
        )
        # A new work day is a new entry.
        next_day = await client.post(
            "/notifications/me/work-hours-reached", json={"workDate": "2026-09-12"}, headers=_headers("alex@example.com")
        )
        listed = (await client.get("/notifications/me", headers=_headers("alex@example.com"))).json()

    assert first.json()["created"] is True
    assert second.json()["created"] is False and second.json()["notification"] is None
    assert third.json()["created"] is False
    assert next_day.json()["created"] is True
    assert listed["unreadCount"] == 2
    assert len(await _rows(_isolated_db, "alex@example.com")) == 2


async def test_work_hours_reached_is_self_scoped_and_rejects_a_malformed_date(_isolated_db, emitted):
    async with await _client() as client:
        await client.post(
            "/notifications/me/work-hours-reached", json={"workDate": "2026-09-11"}, headers=_headers("alex@example.com")
        )
        other = (await client.get("/notifications/me", headers=_headers("bon@example.com"))).json()
        bad = await client.post(
            "/notifications/me/work-hours-reached", json={"workDate": "today"}, headers=_headers("alex@example.com")
        )

    assert other == {"notifications": [], "unreadCount": 0}
    assert bad.status_code == 422
