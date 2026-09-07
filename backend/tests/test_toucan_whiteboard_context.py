from __future__ import annotations

import httpx
import pytest

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.realtime.state import whiteboard_rooms
from app.repositories import chat as chat_repo
from app.repositories import whiteboards as wb_repo
from app.services.toucan.whiteboard_context import (
    BOARD_CONTEXT_MAX_CHARS,
    BOARD_INTENT,
    board_fallback_answer,
    build_board_context,
    extract_board_items,
)
from app.services.toucan_ai.provider import _BOARD_HEADER, _build_messages
from app.services.toucan.context import build_office_context_from

# W5-C — Toucan Whiteboard Context V1: text-only projection of ONE board, bounded; access is the
# board's own rule; the provider sees a data block only when a board is in play; without a
# provider (conftest blanks the key) the answer is the verbatim listing. Read-only throughout.

pytestmark = pytest.mark.asyncio

A, B, C = "a@example.com", "b@example.com", "c@example.com"


def _text(id_, text, *, x=0, y=0, container=None, deleted=False):
    return {"id": id_, "type": "text", "text": text, "x": x, "y": y, "containerId": container, "isDeleted": deleted, "version": 1}


DOC = {
    "type": "excalidraw",
    "version": 2,
    "elements": [
        {"id": "r1", "type": "rectangle", "x": 0, "y": 0, "customData": {"sticky": True}},
        _text("t2", "Ship W5 by Friday", x=10, y=200),
        _text("t1", "  Idea:\n  offline   mode ", x=5, y=10, container="r1"),
        _text("t3", "deleted secret", deleted=True),
        _text("t4", "   ", y=50),
        {"id": "a1", "type": "arrow", "x": 0, "y": 0},
        {"id": "img", "type": "image", "fileId": "f1"},
    ],
    "appState": {"viewBackgroundColor": "#fff", "scrollX": 42},
    "files": {"f1": {"dataURL": "data:image/png;base64,AAAA"}},
}


def test_extract_reads_text_and_sticky_labels_only_in_reading_order():
    items = extract_board_items(DOC)
    assert [(i.kind, i.text) for i in items] == [("note", "Idea: offline mode"), ("text", "Ship W5 by Friday")]
    assert extract_board_items(None) == [] and extract_board_items({"document": {"store": {}}}) == []


def test_context_is_bounded_and_carries_only_text_and_names():
    big = {"elements": [_text(f"t{i}", "x" * 250, y=i) for i in range(40)]}
    ctx = build_board_context(
        {"id": "b1", "title": "  Sprint   plan ", "conversation_id": "c1", "room_id": None, "document": big},
        collaborators=["Alex", "Alex", "  ", "Bon"],
    )
    payload = ctx.as_payload()
    assert payload["title"] == "Sprint plan" and payload["scope"] == "conversation"
    assert payload["collaborators_now"] == ["Alex", "Bon"]
    total = sum(len(i["text"]) for i in payload["items"]) + len(payload["title"]) + 7
    assert total <= BOARD_CONTEXT_MAX_CHARS
    assert payload["items_omitted"] == 40 - len(payload["items"]) > 0
    # Nothing but text, kind, title, scope, names and the omitted count ever leaves.
    assert set(payload) == {"title", "scope", "items", "items_omitted", "collaborators_now"}
    assert all(set(i) == {"kind", "text"} for i in payload["items"])
    flat = str(payload)
    for never in ("scrollX", "dataURL", "containerId", "pointer", "sid", "x\":", "deleted secret"):
        assert never not in flat


def test_fallback_lists_the_board_verbatim_and_states_read_only():
    ctx = build_board_context({"id": "b1", "title": "Retro", "room_id": "dev-team", "document": DOC}, collaborators=["Bon"])
    text = board_fallback_answer(ctx)
    assert "Retro" in text and "Ship W5 by Friday" in text and "Idea: offline mode" in text
    assert "Bon" in text and "can't add or change" in text
    empty = board_fallback_answer(build_board_context({"id": "b2", "title": "Blank", "room_id": "x", "document": None}))
    assert "nothing for me to summarise" in empty


def test_provider_messages_carry_the_board_block_only_when_a_board_is_given():
    office = build_office_context_from(A)
    without = _build_messages("summarise this board", office, [])
    assert _BOARD_HEADER not in without[0]["content"]
    board = build_board_context({"id": "b1", "title": "Retro", "room_id": "r", "document": DOC}).as_payload()
    with_board = _build_messages("summarise this board", office, [], board=board)
    system = with_board[0]["content"]
    assert _BOARD_HEADER in system and "Ship W5 by Friday" in system and "READ the board" in system
    assert with_board[-1] == {"role": "user", "content": "summarise this board"}


# --- router: access + answer -------------------------------------------------------------------


@pytest.fixture(autouse=True)
async def _isolated(isolated_app_db):
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    whiteboard_rooms.reset()
    yield
    whiteboard_rooms.reset()


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _as(email: str) -> dict[str, str]:
    return {"x-dev-email": email}


async def _conversation_board() -> str:
    async with app_db.async_session_maker() as session:
        conv = await chat_repo.upsert_conversation(session, A, B)
        board = await wb_repo.create(session, conversation_id=conv["id"], title="Retro", creator_email=A)
        await wb_repo.replace_document(session, board_id=board["id"], document=DOC, editor_email=A)
        return board["id"]


async def test_ask_with_board_id_applies_board_access_and_answers_from_the_board():
    board_id = await _conversation_board()
    # Presence: A is on the board (the router reads emails → names only).
    room = whiteboard_rooms.ensure(board_id, "conv", DOC, 1)
    whiteboard_rooms.join(room, "sid-a", A, "a")
    async with _client() as client:
        forbidden = await client.post("/toucan/ask", json={"question": "Summarize this board", "boardId": board_id}, headers=_as(C))
        assert forbidden.status_code == 403
        missing = await client.post("/toucan/ask", json={"question": "Summarize this board", "boardId": "nope"}, headers=_as(A))
        assert missing.status_code == 404

        ok = await client.post("/toucan/ask", json={"question": "Summarize this board", "boardId": board_id}, headers=_as(B))
        assert ok.status_code == 200, ok.text
        answer = ok.json()
        assert answer["supported"] is True and answer["intent"] == BOARD_INTENT
        assert "Ship W5 by Friday" in answer["text"] and "Idea: offline mode" in answer["text"]
        assert "deleted secret" not in answer["text"]
        assert "a" in answer["text"]  # collaborator name (local part fallback — no roster in tests)

        # An office question with a board open is still an office answer, not a board listing.
        office = await client.post("/toucan/ask", json={"question": "who is online", "boardId": board_id}, headers=_as(A))
        assert office.status_code == 200 and office.json()["intent"] != BOARD_INTENT

        # No board id → exactly the pre-W5-C behaviour (unsupported → generic fallback).
        plain = await client.post("/toucan/ask", json={"question": "Summarize this board"}, headers=_as(A))
        assert plain.status_code == 200 and plain.json()["supported"] is False


async def test_unknown_fields_are_still_rejected():
    async with _client() as client:
        res = await client.post("/toucan/ask", json={"question": "hi", "board": "x"}, headers=_as(A))
        assert res.status_code == 422
