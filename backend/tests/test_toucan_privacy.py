from __future__ import annotations

import ast
import inspect
import pathlib
import re

import httpx
import pytest

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.realtime.state import (
    call_registry,
    dnd_registry,
    offline_lineup,
    room_presence,
    spatial_sessions,
)
from app.auth.deps import get_current_email
from app.repositories import chat as chat_repo
from app.routers import toucan as toucan_router
from app.services.toucan.context import build_office_context
from app.services.toucan.office_assistant import answer_question
from app.services.position_registry import position_registry

# PRIVACY BOUNDARY TESTS.
#
# These are the tests that make the boundary in app/services/toucan/context.py real rather than
# aspirational. Two complementary strategies:
#
#   * STATIC — parse every module in the Toucan package and assert the forbidden concepts appear
#     nowhere in its code (identifiers, attribute accesses, string literals, imports). Comments
#     and docstrings are excluded from the identifier scan on purpose: the modules *document*
#     what they must not read, and that documentation must not fail its own test.
#   * DYNAMIC — drive the real endpoint with real private data sitting in the database and a
#     network client rigged to explode, and assert nothing leaks and nothing dials out.

pytestmark = pytest.mark.asyncio

_TOUCAN_PACKAGE = pathlib.Path(__file__).resolve().parents[1] / "app" / "services" / "toucan"

# Substrings that must not appear in any Toucan identifier, attribute or string literal.
#
# T2 NARROWED EXACTLY ONE ENTRY IN THIS LIST, and it is worth being explicit about why. "mention"
# used to be banned outright, because at T0/T1 Toucan had no business knowing anything about
# chat at all. T2's charter is the opposite for counts specifically: "How many times was I
# mentioned?" is one of the five questions it exists to answer. So the ban moves from the WORD
# to every CONTENT-BEARING form of it (see _FORBIDDEN_MENTION_FORMS below) — Toucan may learn
# that it happened three times; it must still be structurally incapable of learning what was
# said, who said it, or where.
#
# "unread" stays banned in full. T2 counts a TIME WINDOW, never a read cursor: it deliberately
# does not touch last_read_at (see repositories/toucan_activity.py's _chat_count for why those
# are different questions), so nothing in the Toucan surface has any reason to name it.
_FORBIDDEN_TOKENS = (
    "last_message",
    "lastmessage",
    "current_activity",
    "currentactivity",
    "livekit",
    "transcript",
    "unread",
    "read_receipt",
    "message_body",
    "message_text",
)

# The content-bearing forms of "mention", banned in place of the bare word. Each of these names
# something that would let a mention be READ rather than COUNTED — `mentioned_emails` in
# particular is the raw column app/repositories/toucan_activity.py reads, which the Toucan
# answer surface must never touch directly.
_FORBIDDEN_MENTION_FORMS = (
    "mention_text",
    "mention_body",
    "mention_preview",
    "mention_content",
    "mentioned_emails",
    "mentioned_in",
    "mention_snippet",
)

# Modules NO Toucan module may import, directly or aliased — at any layer.
_FORBIDDEN_IMPORTS = (
    "app.repositories.chat",
    "app.repositories.hub",
    "app.repositories.feed",
    # Toucan FORWARDS the caller's credential; it never verifies one.
    "app.auth.atlas",
)

# T1 gave Toucan a database, but ONLY for its own transcript. The split below is the whole
# point: the router and the repository may open a session; the answer-building package
# (services/toucan/) still may not, so no office context, roster row or registry snapshot can
# reach a table even by accident. That is why "app.database" moved out of the list above and
# into this package-scoped one rather than simply being deleted.
_STORAGE_FREE_PACKAGE_FORBIDDEN_IMPORTS = (
    "app.database",
    "app.models.toucan",
    "app.repositories.toucan",
    "sqlalchemy",
)

# `httpx` is allowed in exactly one Toucan module — the roster reader — so the feature's outbound
# surface stays one file wide and reviewable. Everything else must stay network-free.
_NETWORK_MODULE = "roster.py"


def _docstring_constants(tree: ast.Module) -> set[int]:
    """Identity of every Constant node that IS a docstring. The modules under test *document*
    the fields they must never read, and that prose must not fail its own test — but only real
    docstrings get the exemption, never an ordinary string literal that happens to be long."""
    exempt: set[int] = set()
    holders = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
    for node in ast.walk(tree):
        if not isinstance(node, holders):
            continue
        first = node.body[0] if node.body else None
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
        ):
            exempt.add(id(first.value))
    return exempt


def _toucan_sources() -> list[tuple[pathlib.Path, ast.Module]]:
    modules = []
    for path in sorted(_TOUCAN_PACKAGE.glob("*.py")):
        modules.append((path, ast.parse(path.read_text())))
    # Also cover the router, schema, model and repository modules that make up the rest of
    # the feature's surface. The T1 persistence modules are swept by exactly the same rules as
    # the rest — a forbidden field name is no more acceptable in a column than in a variable.
    for extra in (
        "app/routers/toucan.py",
        "app/schemas/toucan.py",
        "app/models/toucan.py",
        "app/repositories/toucan.py",
        # T4 — the memory and resource persistence modules are swept by the same rules: a
        # forbidden field is no more acceptable in a memory row than in a variable.
        "app/repositories/toucan_memory.py",
        "app/repositories/toucan_resources.py",
    ):
        path = _TOUCAN_PACKAGE.parents[2] / extra
        modules.append((path, ast.parse(path.read_text())))
    return modules


@pytest.fixture(autouse=True)
async def _fresh_registries(isolated_app_db):
    # Takes `isolated_app_db` purely for its side effect: this file drives the real endpoint
    # with real private data (see the dynamic tests below), and that data must never be
    # written into the developer's own database.

    def clear():
        offline_lineup._slot_by_email.clear()
        dnd_registry._dnd_emails.clear()
        room_presence._room_by_email.clear()
        spatial_sessions.reset()
        call_registry.reset()
        position_registry.reset()

    clear()
    yield
    clear()


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


# --- static -------------------------------------------------------------------------------


async def test_toucan_code_never_names_a_forbidden_field():
    """Covers Cliq's last_message/current_activity, LiveKit media, chat transcripts, read
    cursors, and every content-bearing form of a mention. T2 may count mentions; it must remain
    unable to name, read or locate one."""
    offenders: list[str] = []
    for path, tree in _toucan_sources():
        docstrings = _docstring_constants(tree)
        for node in ast.walk(tree):
            values: list[str] = []
            if isinstance(node, ast.Name):
                values.append(node.id)
            elif isinstance(node, ast.Attribute):
                values.append(node.attr)
            elif isinstance(node, ast.arg):
                values.append(node.arg)
            elif (
                isinstance(node, ast.Constant)
                and isinstance(node.value, str)
                # Docstrings are Constant nodes too — see _docstring_constants above.
                and id(node) not in docstrings
            ):
                values.append(node.value)
            for value in values:
                lowered = value.lower()
                for token in _FORBIDDEN_TOKENS + _FORBIDDEN_MENTION_FORMS:
                    if token in lowered:
                        offenders.append(f"{path.name}: {value!r} contains {token!r}")
    assert offenders == []


def _imported_module_names(tree: ast.Module) -> list[str]:
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            names.append(node.module or "")
    return names


async def test_no_toucan_module_imports_chat_hub_feed_or_atlas_verification():
    offenders: list[str] = []
    for path, tree in _toucan_sources():
        for name in _imported_module_names(tree):
            if name in _FORBIDDEN_IMPORTS:
                offenders.append(f"{path.name}: imports {name}")
            if name == "httpx" and path.name != _NETWORK_MODULE:
                offenders.append(f"{path.name}: imports httpx")
    assert offenders == []


async def test_the_answer_building_package_still_owns_no_storage():
    """T1's database stops at the router/repository. Every module under services/toucan/ — the
    context builder and the answer wording — must remain unable to reach a session or a table,
    so no roster row, room snapshot or registry state can be written down even by mistake."""
    offenders: list[str] = []
    for path in sorted(_TOUCAN_PACKAGE.glob("*.py")):
        tree = ast.parse(path.read_text())
        for name in _imported_module_names(tree):
            root = name.split(".")[0]
            if name in _STORAGE_FREE_PACKAGE_FORBIDDEN_IMPORTS or root == "sqlalchemy":
                offenders.append(f"{path.name}: imports {name}")
    assert offenders == []


async def test_the_endpoint_takes_a_session_but_never_an_identity_argument():
    """T1 adds `db` — the transcript has to be written somewhere. What must NOT change is where
    identity comes from: `email` is still a get_current_email dependency, and there is still no
    parameter through which a caller could name somebody else. The `request` parameter remains
    the credential-forwarding seam (bearer header -> Atlas roster), not an identity source."""
    params = inspect.signature(toucan_router.ask_toucan).parameters
    assert set(params) == {"request", "body", "email", "db"}
    assert params["email"].default.dependency is get_current_email


async def test_the_context_and_answer_layers_are_never_handed_a_session():
    """The one-way street: a session exists in the router, and it stops there. Neither the
    context builder nor the answer writer can be passed one, so neither can persist anything."""
    for func in (build_office_context, answer_question):
        params = inspect.signature(func).parameters
        assert not {"db", "session", "conn"} & set(params), func.__name__


async def test_no_ai_provider_or_api_key_is_referenced():
    """T0 must contain no provider SDK and no key lookup."""
    banned = ("openai", "anthropic", "gemini", "api_key", "apikey", "getenv", "os.environ")
    for path, _ in _toucan_sources():
        lowered = path.read_text().lower()
        for term in banned:
            assert term not in lowered, f"{path.name} references {term}"


# --- dynamic -------------------------------------------------------------------------------


async def test_a_real_private_chat_message_never_reaches_a_toucan_answer():
    secret = "SECRET-DM-BODY-do-not-leak"
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with app_db.async_session_maker() as session:
        conversation = await chat_repo.upsert_conversation(
            session, "angelo@example.com", "micah@example.com"
        )
        await chat_repo.insert_message(session, conversation["id"], "micah@example.com", secret)
        await session.commit()

    room_presence.enter("angelo@example.com", "ai-room")
    room_presence.enter("micah@example.com", "ai-room")

    questions = [
        "who is online",
        "who is in this room",
        "where is micah",
        "is micah available",
        "who is in a call",
        "who is dnd",
        "who is offline",
        "summarize my messages",
    ]
    async with await _client() as client:
        for question in questions:
            res = await client.post(
                "/toucan/ask",
                json={"question": question},
                headers={"x-dev-email": "angelo@example.com"},
            )
            assert res.status_code == 200, question
            assert secret not in res.text, question


async def test_the_only_outbound_call_toucan_can_make_is_the_atlas_roster(monkeypatch):
    """Record every real egress request. Patched at AsyncHTTPTransport (actual network) rather
    than on AsyncClient, because this test's own in-process ASGITransport client goes through
    the latter. A dev-bypass caller has no bearer token, so there must be NO egress at all."""
    seen: list[str] = []

    async def _record(self, request, *args, **kwargs):
        seen.append(str(request.url))
        raise AssertionError(f"unexpected outbound call to {request.url}")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", _record)

    room_presence.enter("angelo@example.com", "ai-room")
    async with await _client() as client:
        res = await client.post(
            "/toucan/ask",
            json={"question": "who is in this room"},
            headers={"x-dev-email": "angelo@example.com"},
        )
    assert res.status_code == 200
    assert "AI Room" in res.json()["text"]
    assert seen == []


async def test_a_failed_roster_fetch_is_never_surfaced_to_the_user(monkeypatch):
    """A roster failure degrades to a normal answer — no Atlas diagnostic, no credential."""

    async def _fail(bearer_token, *, client=None):
        # fetch_roster owns its own error handling; a failure reaches the context as "no roster".
        return ()

    monkeypatch.setattr("app.services.toucan.context.fetch_roster", _fail)
    room_presence.enter("angelo@example.com", "ai-room")
    async with await _client() as client:
        res = await client.post(
            "/toucan/ask",
            json={"question": "who is in this room"},
            headers={"x-dev-email": "angelo@example.com", "Authorization": "Bearer sekrit-token"},
        )
    assert res.status_code == 200
    assert "AI Room" in res.json()["text"]
    assert "sekrit-token" not in res.text
    assert "Atlas" not in res.text
    assert "roster" not in res.text.lower()


async def test_the_answer_payload_has_no_channel_for_office_data():
    """The response is four fields wide: one human sentence, two labels, and T1's opaque
    conversation id. There is nowhere for a raw context object, a registry snapshot or a media
    identifier to ride along — and the one field T1 added carries a UUID, not office data."""
    async with await _client() as client:
        res = await client.post(
            "/toucan/ask", json={"question": "who is online"}, headers={"x-dev-email": "a@example.com"}
        )
    body = res.json()
    assert set(body) == {"text", "intent", "supported", "conversationId"}
    assert re.fullmatch(r"[0-9a-f-]{36}", body["conversationId"])
