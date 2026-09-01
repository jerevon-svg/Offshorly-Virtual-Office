from __future__ import annotations

import pytest

from app.repositories import chat as chat_repo
from app.schemas.chat import serialize_message_dict

# Reaction repository behaviour. The load-bearing group is the "reactions do not disturb the
# message-derived counters" block at the bottom — reactions live in their own table precisely
# so unread/mention/last_message_at/watermarks cannot move, and these tests pin that.

pytestmark = pytest.mark.asyncio

A = "a@example.com"
B = "b@example.com"
C = "c@example.com"


async def _dm_with_message(db_session, text: str = "hello", sender: str = A):
    conv = await chat_repo.upsert_conversation(db_session, A, B)
    message = await chat_repo.insert_message(db_session, conv["id"], sender, text)
    await chat_repo.touch_conversation(db_session, conv["id"], message.sent_at)
    await db_session.commit()
    return conv["id"], message


async def test_add_reaction_persists_and_groups(db_session):
    _conv_id, message = await _dm_with_message(db_session)

    assert await chat_repo.add_reaction(db_session, message.id, B, "👍") is True
    await db_session.commit()

    groups = await chat_repo.get_reactions_for_message(db_session, message.id)
    assert groups == [{"emoji": "👍", "count": 1, "reactors": [B]}]


async def test_duplicate_same_message_user_emoji_cannot_duplicate(db_session):
    _conv_id, message = await _dm_with_message(db_session)

    assert await chat_repo.add_reaction(db_session, message.id, B, "👍") is True
    await db_session.commit()
    # Second identical add is a no-op, not an error and not a second row — the unique index
    # makes the duplicate impossible and add_reaction absorbs the IntegrityError.
    assert await chat_repo.add_reaction(db_session, message.id, B, "👍") is False
    await db_session.commit()

    groups = await chat_repo.get_reactions_for_message(db_session, message.id)
    assert groups == [{"emoji": "👍", "count": 1, "reactors": [B]}]


async def test_reactor_email_is_canonicalized_before_uniqueness_check(db_session):
    """A differently-cased email must collide with the existing row rather than sneak past the
    unique index as a second reactor."""
    _conv_id, message = await _dm_with_message(db_session)

    assert await chat_repo.add_reaction(db_session, message.id, B, "👍") is True
    await db_session.commit()
    assert await chat_repo.add_reaction(db_session, message.id, "B@Example.com", "👍") is False
    await db_session.commit()

    groups = await chat_repo.get_reactions_for_message(db_session, message.id)
    assert groups[0]["count"] == 1


async def test_same_user_can_hold_several_different_emojis(db_session):
    _conv_id, message = await _dm_with_message(db_session)

    await chat_repo.add_reaction(db_session, message.id, B, "👍")
    await chat_repo.add_reaction(db_session, message.id, B, "🎉")
    await db_session.commit()

    groups = await chat_repo.get_reactions_for_message(db_session, message.id)
    assert {g["emoji"] for g in groups} == {"👍", "🎉"}
    assert all(g["count"] == 1 for g in groups)


async def test_multiple_users_aggregate_into_one_emoji_group(db_session):
    conv = await chat_repo.create_group_conversation(db_session, A, [B, C], "Team")
    message = await chat_repo.insert_message(db_session, conv["id"], A, "hi all")
    await db_session.commit()

    await chat_repo.add_reaction(db_session, message.id, B, "👍")
    await chat_repo.add_reaction(db_session, message.id, C, "👍")
    await db_session.commit()

    groups = await chat_repo.get_reactions_for_message(db_session, message.id)
    assert groups == [{"emoji": "👍", "count": 2, "reactors": sorted([B, C])}]


async def test_remove_reaction_removes_only_the_callers_own(db_session):
    conv = await chat_repo.create_group_conversation(db_session, A, [B, C], "Team")
    message = await chat_repo.insert_message(db_session, conv["id"], A, "hi all")
    await db_session.commit()

    await chat_repo.add_reaction(db_session, message.id, B, "👍")
    await chat_repo.add_reaction(db_session, message.id, C, "👍")
    await db_session.commit()

    assert await chat_repo.remove_reaction(db_session, message.id, B, "👍") is True
    await db_session.commit()

    groups = await chat_repo.get_reactions_for_message(db_session, message.id)
    # C's reaction survives — remove is scoped by reactor_email, so one participant can never
    # clear another's.
    assert groups == [{"emoji": "👍", "count": 1, "reactors": [C]}]


async def test_remove_reaction_that_does_not_exist_is_a_no_op(db_session):
    _conv_id, message = await _dm_with_message(db_session)
    assert await chat_repo.remove_reaction(db_session, message.id, B, "👍") is False


async def test_last_reactor_removed_drops_the_group_entirely(db_session):
    _conv_id, message = await _dm_with_message(db_session)
    await chat_repo.add_reaction(db_session, message.id, B, "👍")
    await db_session.commit()
    await chat_repo.remove_reaction(db_session, message.id, B, "👍")
    await db_session.commit()

    assert await chat_repo.get_reactions_for_message(db_session, message.id) == []


async def test_get_message_conversation_id_backs_the_authorization_check(db_session):
    conv_id, message = await _dm_with_message(db_session)

    assert await chat_repo.get_message_conversation_id(db_session, message.id) == conv_id
    assert await chat_repo.get_message_conversation_id(db_session, "no-such-message") is None
    # The authorization pair the socket layer uses: membership is asked of the MESSAGE's own
    # conversation, so an outsider is rejected even though the message id is valid.
    assert await chat_repo.is_participant(db_session, conv_id, C) is False
    assert await chat_repo.is_participant(db_session, conv_id, B) is True


async def test_batch_load_is_one_query_and_omits_unreacted_messages(db_session):
    conv = await chat_repo.upsert_conversation(db_session, A, B)
    m1 = await chat_repo.insert_message(db_session, conv["id"], A, "one")
    m2 = await chat_repo.insert_message(db_session, conv["id"], A, "two")
    m3 = await chat_repo.insert_message(db_session, conv["id"], A, "three")
    await db_session.commit()

    await chat_repo.add_reaction(db_session, m1.id, B, "👍")
    await chat_repo.add_reaction(db_session, m3.id, B, "😂")
    await db_session.commit()

    batch = await chat_repo.get_reactions_for_messages(db_session, [m1.id, m2.id, m3.id])
    assert set(batch.keys()) == {m1.id, m3.id}
    # m2 is simply absent — every read site defaults a missing key to [].
    assert batch.get(m2.id, []) == []


async def test_batch_load_of_empty_id_list_short_circuits(db_session):
    assert await chat_repo.get_reactions_for_messages(db_session, []) == {}


async def test_existing_message_serializes_reactions_as_empty_list(db_session):
    """Backward compatibility: a message written before this feature existed (no reaction rows,
    no schema change to `messages`) still serializes cleanly, with `reactions: []`."""
    _conv_id, message = await _dm_with_message(db_session)

    payload = serialize_message_dict(message, delivered_to=[], read_by=[])
    assert payload["reactions"] == []
    # Nothing else about the existing wire shape shifted.
    assert payload["text"] == "hello"
    assert payload["mentionedEmails"] == []


async def test_serializer_emits_grouped_reactions_when_present(db_session):
    _conv_id, message = await _dm_with_message(db_session)
    await chat_repo.add_reaction(db_session, message.id, B, "👍")
    await db_session.commit()

    groups = await chat_repo.get_reactions_for_message(db_session, message.id)
    payload = serialize_message_dict(message, delivered_to=[], read_by=[], reactions=groups)
    assert payload["reactions"] == [{"emoji": "👍", "count": 1, "reactors": [B]}]


# --- The counters reactions must never touch --------------------------------------------


async def test_reactions_do_not_change_unread_count(db_session):
    conv_id, message = await _dm_with_message(db_session, sender=A)

    before = await chat_repo.unread_count(db_session, conv_id, B)
    await chat_repo.add_reaction(db_session, message.id, B, "👍")
    await db_session.commit()
    after_add = await chat_repo.unread_count(db_session, conv_id, B)

    # A reacting to their own conversation must not manufacture an unread for B either.
    await chat_repo.add_reaction(db_session, message.id, A, "🎉")
    await db_session.commit()
    after_peer_add = await chat_repo.unread_count(db_session, conv_id, B)

    await chat_repo.remove_reaction(db_session, message.id, B, "👍")
    await db_session.commit()
    after_remove = await chat_repo.unread_count(db_session, conv_id, B)

    assert before == after_add == after_peer_add == after_remove == 1


async def test_reactions_do_not_change_mention_count(db_session):
    conv = await chat_repo.upsert_conversation(db_session, A, B)
    message = await chat_repo.insert_message(
        db_session, conv["id"], A, "hey @b", mentioned_emails=[B]
    )
    await db_session.commit()

    before = await chat_repo.mention_count(db_session, conv["id"], B)
    await chat_repo.add_reaction(db_session, message.id, B, "👍")
    await chat_repo.add_reaction(db_session, message.id, A, "🎉")
    await db_session.commit()
    after = await chat_repo.mention_count(db_session, conv["id"], B)

    assert before == after == 1


async def test_reactions_do_not_change_last_message_at(db_session):
    conv_id, message = await _dm_with_message(db_session)

    before = (await chat_repo.get_conversation_by_id(db_session, conv_id))["last_message_at"]
    await chat_repo.add_reaction(db_session, message.id, B, "👍")
    await db_session.commit()
    await chat_repo.remove_reaction(db_session, message.id, B, "👍")
    await db_session.commit()
    after = (await chat_repo.get_conversation_by_id(db_session, conv_id))["last_message_at"]

    assert before == after


async def test_reactions_do_not_move_delivery_or_read_watermarks(db_session):
    conv_id, message = await _dm_with_message(db_session)

    before = await chat_repo.get_participant_watermarks(db_session, conv_id)
    await chat_repo.add_reaction(db_session, message.id, B, "👍")
    await db_session.commit()
    after = await chat_repo.get_participant_watermarks(db_session, conv_id)

    assert before == after
    # Derived per-message status is likewise untouched: B reacting is not B reading.
    delivered_to, read_by = chat_repo.compute_message_receipts(message, after)
    assert delivered_to == []
    assert read_by == []
