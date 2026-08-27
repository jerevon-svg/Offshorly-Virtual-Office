from __future__ import annotations

import pytest

from app.repositories import feed as feed_repo
from app.repositories import hub as hub_repo

# Repository-layer coverage for Employee Feed V1 — see backend/app/repositories/feed.py.

pytestmark = pytest.mark.asyncio


async def test_list_posts_for_target_orders_newest_first(db_session):
    first = await feed_repo.create_post(
        db_session, target_email="alex@example.com", author_email="a@example.com", type="post", content="one"
    )
    second = await feed_repo.create_post(
        db_session, target_email="alex@example.com", author_email="a@example.com", type="post", content="two"
    )

    posts = await feed_repo.list_posts_for_target(db_session, "alex@example.com")

    assert [p["id"] for p in posts] == [second["id"], first["id"]]


async def test_create_hub_triggered_post_is_idempotent_per_author(db_session):
    item = await hub_repo.create_item(
        db_session, type="birthday", title="t", description="d", target_employee_email="alex@example.com"
    )

    first, first_created = await feed_repo.create_hub_triggered_post(
        db_session,
        hub_item_id=item["id"],
        target_email="alex@example.com",
        author_email="bon@example.com",
        type="birthday",
        content="wished them a Happy Birthday! 🎉",
    )
    second, second_created = await feed_repo.create_hub_triggered_post(
        db_session,
        hub_item_id=item["id"],
        target_email="alex@example.com",
        author_email="bon@example.com",
        type="birthday",
        content="wished them a Happy Birthday! 🎉",
    )

    assert first["id"] == second["id"]
    assert first_created is True
    assert second_created is False

    posts = await feed_repo.list_posts_for_target(db_session, "alex@example.com")
    assert len(posts) == 1


async def test_create_hub_triggered_post_allows_different_authors(db_session):
    item = await hub_repo.create_item(
        db_session, type="birthday", title="t", description="d", target_employee_email="alex@example.com"
    )

    await feed_repo.create_hub_triggered_post(
        db_session,
        hub_item_id=item["id"],
        target_email="alex@example.com",
        author_email="bon@example.com",
        type="birthday",
        content="wished them a Happy Birthday! 🎉",
    )
    await feed_repo.create_hub_triggered_post(
        db_session,
        hub_item_id=item["id"],
        target_email="alex@example.com",
        author_email="micah@example.com",
        type="birthday",
        content="wished them a Happy Birthday! 🎉",
    )

    posts = await feed_repo.list_posts_for_target(db_session, "alex@example.com")
    assert {p["author_email"] for p in posts} == {"bon@example.com", "micah@example.com"}


async def test_upsert_reaction_changes_emoji_without_duplicating(db_session):
    post = await feed_repo.create_post(
        db_session, target_email="alex@example.com", author_email="a@example.com", type="post", content="x"
    )

    await feed_repo.upsert_reaction(db_session, post_id=post["id"], employee_email="b@example.com", emoji="❤️")
    await feed_repo.upsert_reaction(db_session, post_id=post["id"], employee_email="b@example.com", emoji="🔥")

    reactions = (await feed_repo.get_reactions_for_posts(db_session, [post["id"]])).get(post["id"], [])
    assert len(reactions) == 1
    assert reactions[0]["emoji"] == "🔥"


async def test_upsert_reaction_rejects_unknown_emoji(db_session):
    post = await feed_repo.create_post(
        db_session, target_email="alex@example.com", author_email="a@example.com", type="post", content="x"
    )

    with pytest.raises(ValueError):
        await feed_repo.upsert_reaction(db_session, post_id=post["id"], employee_email="b@example.com", emoji="💩")


async def test_remove_reaction(db_session):
    post = await feed_repo.create_post(
        db_session, target_email="alex@example.com", author_email="a@example.com", type="post", content="x"
    )
    await feed_repo.upsert_reaction(db_session, post_id=post["id"], employee_email="b@example.com", emoji="❤️")

    removed = await feed_repo.remove_reaction(db_session, post_id=post["id"], employee_email="b@example.com")
    removed_again = await feed_repo.remove_reaction(db_session, post_id=post["id"], employee_email="b@example.com")

    assert removed is True
    assert removed_again is False
    assert (await feed_repo.get_reactions_for_posts(db_session, [post["id"]])) == {}


async def test_comment_and_one_level_reply(db_session):
    post = await feed_repo.create_post(
        db_session, target_email="alex@example.com", author_email="a@example.com", type="post", content="x"
    )
    comment = await feed_repo.create_comment(
        db_session, post_id=post["id"], author_email="micah@example.com", content="Happy birthday!"
    )
    await feed_repo.create_comment(
        db_session,
        post_id=post["id"],
        author_email="alex@example.com",
        content="Thank you!!",
        parent_comment_id=comment["id"],
    )

    grouped = await feed_repo.get_comments_for_posts(db_session, [post["id"]])
    top_level = grouped[post["id"]]

    assert len(top_level) == 1
    assert len(top_level[0]["replies"]) == 1
    assert top_level[0]["replies"][0]["author_email"] == "alex@example.com"


async def test_cannot_reply_to_a_reply(db_session):
    post = await feed_repo.create_post(
        db_session, target_email="alex@example.com", author_email="a@example.com", type="post", content="x"
    )
    comment = await feed_repo.create_comment(
        db_session, post_id=post["id"], author_email="micah@example.com", content="Happy birthday!"
    )
    reply = await feed_repo.create_comment(
        db_session,
        post_id=post["id"],
        author_email="alex@example.com",
        content="Thank you!!",
        parent_comment_id=comment["id"],
    )

    with pytest.raises(ValueError):
        await feed_repo.create_comment(
            db_session,
            post_id=post["id"],
            author_email="micah@example.com",
            content="one level too deep",
            parent_comment_id=reply["id"],
        )


async def test_delete_post_only_by_author_and_only_normal_posts(db_session):
    normal_post = await feed_repo.create_post(
        db_session, target_email="alex@example.com", author_email="a@example.com", type="post", content="x"
    )

    denied_wrong_author = await feed_repo.delete_post(
        db_session, post_id=normal_post["id"], requester_email="someone-else@example.com"
    )
    allowed = await feed_repo.delete_post(db_session, post_id=normal_post["id"], requester_email="a@example.com")

    assert denied_wrong_author is False
    assert allowed is True
    assert await feed_repo.get_post_by_id(db_session, normal_post["id"]) is None


async def test_delete_post_refuses_hub_generated_activity(db_session):
    item = await hub_repo.create_item(
        db_session, type="birthday", title="t", description="d", target_employee_email="alex@example.com"
    )
    post, _ = await feed_repo.create_hub_triggered_post(
        db_session,
        hub_item_id=item["id"],
        target_email="alex@example.com",
        author_email="bon@example.com",
        type="birthday",
        content="wished them a Happy Birthday! 🎉",
    )

    deleted = await feed_repo.delete_post(db_session, post_id=post["id"], requester_email="bon@example.com")

    assert deleted is False
    assert await feed_repo.get_post_by_id(db_session, post["id"]) is not None


async def test_delete_comment_cascades_replies(db_session):
    post = await feed_repo.create_post(
        db_session, target_email="alex@example.com", author_email="a@example.com", type="post", content="x"
    )
    comment = await feed_repo.create_comment(
        db_session, post_id=post["id"], author_email="micah@example.com", content="Happy birthday!"
    )
    await feed_repo.create_comment(
        db_session,
        post_id=post["id"],
        author_email="alex@example.com",
        content="Thank you!!",
        parent_comment_id=comment["id"],
    )

    deleted = await feed_repo.delete_comment(db_session, comment_id=comment["id"], requester_email="micah@example.com")

    grouped = await feed_repo.get_comments_for_posts(db_session, [post["id"]])
    assert deleted is True
    assert grouped == {}
