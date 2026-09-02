from __future__ import annotations

import ast
import inspect
import pathlib

import httpx
import pytest

from app.database import Base, async_session_maker, engine
from app.main import fastapi_app
from app.realtime.state import (
    call_registry,
    dnd_registry,
    offline_lineup,
    room_presence,
    spatial_sessions,
)
from app.repositories import chat as chat_repo
from app.routers import toucan as toucan_router
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
_FORBIDDEN_TOKENS = (
    "last_message",
    "lastmessage",
    "current_activity",
    "currentactivity",
    "livekit",
    "transcript",
    "unread",
    "mention",
    "read_receipt",
    "message_body",
)

# Modules the Toucan package must never import, directly or aliased.
_FORBIDDEN_IMPORTS = (
    "app.repositories.chat",
    "app.repositories.hub",
    "app.repositories.feed",
    # Toucan FORWARDS the caller's credential; it never verifies one.
    "app.auth.atlas",
    "app.database",
)

# `httpx` is allowed in exactly one Toucan module — the roster reader — so the feature's outbound
# surface stays one file wide and reviewable. Everything else must stay network-free.
_NETWORK_MODULE = "roster.py"


def _toucan_sources() -> list[tuple[pathlib.Path, ast.Module]]:
    modules = []
    for path in sorted(_TOUCAN_PACKAGE.glob("*.py")):
        modules.append((path, ast.parse(path.read_text())))
    # Also cover the router and schema modules that make up the feature's surface.
    for extra in ("app/routers/toucan.py", "app/schemas/toucan.py"):
        path = _TOUCAN_PACKAGE.parents[2] / extra
        modules.append((path, ast.parse(path.read_text())))
    return modules


@pytest.fixture(autouse=True)
def _fresh_registries():
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
    """Covers Cliq's last_message/current_activity, LiveKit media, chat transcripts, unread and
    mention counts — the categories T0 is explicitly forbidden to read."""
    offenders: list[str] = []
    for path, tree in _toucan_sources():
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
                # Docstrings are Constant nodes too; skip the ones that ARE a docstring by
                # checking length — the prohibitions are only ever documented in prose, and no
                # short literal in this codebase carries one.
                and len(node.value) < 200
            ):
                values.append(node.value)
            for value in values:
                lowered = value.lower()
                for token in _FORBIDDEN_TOKENS:
                    if token in lowered:
                        offenders.append(f"{path.name}: {value!r} contains {token!r}")
    assert offenders == []


async def test_toucan_package_imports_no_chat_atlas_or_database_module():
    offenders: list[str] = []
    for path, tree in _toucan_sources():
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            else:
                continue
            for name in names:
                if name in _FORBIDDEN_IMPORTS:
                    offenders.append(f"{path.name}: imports {name}")
                if name == "httpx" and path.name != _NETWORK_MODULE:
                    offenders.append(f"{path.name}: imports httpx")
    assert offenders == []


async def test_the_endpoint_declares_no_database_dependency():
    """No `db` parameter means no session, no query, no migration — T0 owns no storage. The
    `request` parameter is the credential-forwarding seam (bearer header -> Atlas roster), not
    an identity source: `email` still comes from get_current_email."""
    params = inspect.signature(toucan_router.ask_toucan).parameters
    assert set(params) == {"request", "body", "email"}
    assert "db" not in params


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
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session_maker() as session:
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
    """The response is three fields wide: one human sentence plus two labels. There is nowhere
    for a raw context object, a registry snapshot or a media identifier to ride along."""
    async with await _client() as client:
        res = await client.post(
            "/toucan/ask", json={"question": "who is online"}, headers={"x-dev-email": "a@example.com"}
        )
    assert set(res.json()) == {"text", "intent", "supported"}
