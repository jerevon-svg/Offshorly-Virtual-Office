from __future__ import annotations

from app.services.offline_lineup import OfflineLineup


def test_concurrent_style_adds_get_distinct_slots():
    lineup = OfflineLineup()
    assert lineup.add("a@example.com") == 0
    assert lineup.add("b@example.com") == 1
    assert lineup.add("c@example.com") == 2


def test_remove_frees_lowest_index_for_reuse():
    lineup = OfflineLineup()
    lineup.add("a@example.com")  # slot 0
    lineup.add("b@example.com")  # slot 1
    lineup.add("c@example.com")  # slot 2

    lineup.remove("b@example.com")  # frees slot 1

    assert lineup.add("d@example.com") == 1


def test_readd_reuses_a_freed_slot():
    lineup = OfflineLineup()
    lineup.add("a@example.com")  # slot 0
    lineup.remove("a@example.com")

    assert lineup.add("a@example.com") == 0


def test_snapshot_ordering_is_stable_by_slot():
    lineup = OfflineLineup()
    lineup.add("a@example.com")  # slot 0
    lineup.add("b@example.com")  # slot 1
    lineup.add("c@example.com")  # slot 2
    lineup.remove("a@example.com")  # frees slot 0
    lineup.add("d@example.com")  # reuses slot 0

    assert lineup.snapshot() == [
        {"email": "d@example.com", "slot": 0},
        {"email": "b@example.com", "slot": 1},
        {"email": "c@example.com", "slot": 2},
    ]


def test_add_is_idempotent_for_an_already_present_email():
    lineup = OfflineLineup()
    first = lineup.add("a@example.com")
    lineup.add("b@example.com")

    assert lineup.add("a@example.com") == first
    assert len(lineup.snapshot()) == 2


def test_remove_is_a_noop_for_an_absent_email():
    lineup = OfflineLineup()
    lineup.add("a@example.com")

    lineup.remove("not-present@example.com")

    assert len(lineup.snapshot()) == 1
