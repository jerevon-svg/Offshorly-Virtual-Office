from __future__ import annotations

import asyncio

import pytest

from app.services.whiteboard_rooms import (
    WhiteboardRoomRegistry,
    build_document,
    collaborator_color,
    elements_from_document,
    merge_elements,
    remote_wins,
)

# Whiteboard W3 merge semantics — the Python copy of Excalidraw's reconcile rule, plus the room
# registry's tombstone and flush behaviour. Pure/in-memory; no sockets, no DB.

def el(id_: str, version: int, nonce: int, **extra):
    return {"id": id_, "type": "rectangle", "version": version, "versionNonce": nonce, **extra}


class TestRemoteWins:
    def test_unknown_element_is_accepted(self):
        assert remote_wins(None, el("a", 1, 5)) is True

    def test_higher_version_wins_regardless_of_nonce(self):
        assert remote_wins(el("a", 1, 1), el("a", 2, 999)) is True
        assert remote_wins(el("a", 3, 1), el("a", 2, 0)) is False

    def test_equal_version_lower_nonce_wins(self):
        assert remote_wins(el("a", 2, 50), el("a", 2, 10)) is True
        assert remote_wins(el("a", 2, 10), el("a", 2, 50)) is False
        # Identical copy (same version and nonce) is not a change — local kept.
        assert remote_wins(el("a", 2, 10), el("a", 2, 10)) is False

    def test_missing_or_bogus_numbers_count_as_zero(self):
        assert remote_wins({"id": "a"}, el("a", 1, 1)) is True
        assert remote_wins(el("a", 1, 1), {"id": "a", "version": "9"}) is False


class TestMergeElements:
    def test_accepts_winners_and_returns_current_copies_for_losers(self):
        current = {"a": el("a", 2, 10), "b": el("b", 1, 1)}
        accepted, rejected = merge_elements(current, [el("a", 1, 0), el("b", 2, 7), el("c", 1, 3)])
        assert [e["id"] for e in accepted] == ["b", "c"]
        assert rejected == [el("a", 2, 10)]
        assert current["b"]["version"] == 2 and current["c"]["version"] == 1

    def test_deletion_tombstone_replaces_live_element_and_is_kept(self):
        current = {"a": el("a", 3, 1)}
        accepted, _ = merge_elements(current, [el("a", 4, 2, isDeleted=True)])
        assert accepted[0]["isDeleted"] is True
        assert current["a"]["isDeleted"] is True
        # A stale live copy (lower version) cannot resurrect the deleted element.
        accepted, rejected = merge_elements(current, [el("a", 3, 1)])
        assert accepted == [] and rejected[0]["isDeleted"] is True

    def test_ignores_malformed_entries(self):
        current: dict = {}
        accepted, rejected = merge_elements(current, [None, "x", {"version": 1}, {"id": ""}])
        assert accepted == [] and rejected == [] and current == {}


class TestDocuments:
    def test_legacy_or_null_document_loads_empty(self):
        assert elements_from_document(None) == ({}, {}, {})
        assert elements_from_document({"document": {"store": {}}}) == ({}, {}, {})

    def test_excalidraw_document_round_trips_and_final_write_strips_tombstones(self):
        doc = {
            "type": "excalidraw",
            "version": 2,
            "elements": [el("a", 1, 1), el("b", 2, 2, isDeleted=True)],
            "appState": {"viewBackgroundColor": "#fff"},
            "files": {"f1": {"id": "f1"}},
        }
        elements, app_state, files = elements_from_document(doc)
        assert set(elements) == {"a", "b"} and app_state == {"viewBackgroundColor": "#fff"} and "f1" in files
        live = build_document(elements, app_state, files, include_deleted=True)
        final = build_document(elements, app_state, files, include_deleted=False)
        assert [e["id"] for e in live["elements"]] == ["a", "b"]
        assert [e["id"] for e in final["elements"]] == ["a"]
        assert final["type"] == "excalidraw" and final["version"] == 2 and final["files"] == files

    def test_collaborator_color_is_stable_per_email(self):
        assert collaborator_color("A@Example.com") == collaborator_color("a@example.com")
        assert set(collaborator_color("a@example.com")) == {"background", "stroke"}


@pytest.mark.asyncio
class TestRegistry:
    async def test_join_leave_presence_and_snapshot(self):
        reg = WhiteboardRoomRegistry()
        room = reg.ensure("b1", "c1", None, 1)
        reg.join(room, "s1", "a@example.com", "a")
        reg.join(room, "s2", "b@example.com", "b")
        assert [c["email"] for c in room.presence()] == ["a@example.com", "b@example.com"]
        assert reg.room_of("s2") is room
        snap = room.snapshot()
        assert snap["boardId"] == "b1" and snap["elements"] == [] and snap["version"] == 1 and snap["seq"] == 0
        assert reg.leave("s1") is room and reg.leave("s1") is None
        assert [c["sid"] for c in room.presence()] == ["s2"]

    async def test_ensure_returns_the_live_room_not_a_reload(self):
        reg = WhiteboardRoomRegistry()
        room = reg.ensure("b1", "c1", None, 1)
        await reg.apply(room, [el("a", 1, 1)], editor_email="a@example.com")
        again = reg.ensure("b1", "c1", {"type": "excalidraw", "elements": []}, 1)
        assert again is room and "a" in again.elements

    async def test_apply_bumps_seq_only_when_something_was_accepted(self):
        reg = WhiteboardRoomRegistry()
        room = reg.ensure("b1", "c1", None, 1)
        accepted, _ = await reg.apply(room, [el("a", 1, 1)], editor_email="a@example.com")
        assert accepted and room.seq == 1 and room.dirty is True
        accepted, rejected = await reg.apply(room, [el("a", 0, 0)], editor_email="b@example.com")
        assert accepted == [] and rejected and room.seq == 1 and room.last_editor == "a@example.com"

    async def test_debounced_flush_keeps_tombstones_and_final_flush_strips_them(self):
        reg = WhiteboardRoomRegistry(flush_delay_seconds=0.02)
        room = reg.ensure("b1", "c1", None, 1)
        reg.join(room, "s1", "a@example.com", "a")
        writes: list[tuple[bool, list[str]]] = []

        async def persist(r, final):
            doc = build_document(r.elements, r.app_state, r.files, include_deleted=not final)
            writes.append((final, [e["id"] for e in doc["elements"]]))
            return r.version + 1

        await reg.apply(room, [el("a", 1, 1), el("b", 1, 1)], editor_email="a@example.com")
        reg.schedule_flush(room, persist)
        await reg.apply(room, [el("b", 2, 1, isDeleted=True)], editor_email="a@example.com")
        reg.schedule_flush(room, persist)  # cancels the first timer: one write, not two
        await asyncio.sleep(0.1)
        assert writes == [(False, ["a", "b"])]
        assert room.version == 2 and room.dirty is False and room.written is True

        reg.leave("s1")
        assert await reg.close_if_empty(room, persist) is True
        assert writes[-1] == (True, ["a"])
        assert room.version == 3 and reg.get("b1") is None

    async def test_close_if_empty_without_any_write_does_not_touch_the_db(self):
        reg = WhiteboardRoomRegistry()
        room = reg.ensure("b1", "c1", None, 1)
        reg.join(room, "s1", "a@example.com", "a")
        calls = 0

        async def persist(_r, _final):
            nonlocal calls
            calls += 1
            return 99

        assert await reg.close_if_empty(room, persist) is False  # still a member
        reg.leave("s1")
        assert await reg.close_if_empty(room, persist) is True
        assert calls == 0 and reg.get("b1") is None
