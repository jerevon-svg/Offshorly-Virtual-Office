from __future__ import annotations

import logging
import os

import socketio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import async_session_maker
# Imported from socket.py, NOT state.py, on purpose: `sio` is constructed in
# app/realtime/state.py, but importing socket.py is what registers every Socket.IO event
# handler onto it. Point this at state.py and the server comes up with no handlers.
from app.realtime.socket import sio
from app.repositories import position as position_repo
from app.routers import calls as calls_router
from app.routers import chat as chat_router
from app.routers import feed as feed_router
from app.routers import hub as hub_router
from app.routers import requests as requests_router
from app.routers import room_requests as room_requests_router
from app.routers import talk_requests as talk_requests_router
from app.routers import toucan as toucan_router
from app.scripts import seed_dev_hub_content as hub_mock
from app.services.position_registry import position_registry

_logger = logging.getLogger(__name__)

fastapi_app = FastAPI(title=settings.APP_NAME, version="0.1.0")


@fastapi_app.on_event("startup")
async def _load_positions_into_registry() -> None:
    """Cold-start recovery: repopulate the in-memory PositionRegistry from the last-persisted
    stable positions so a deploy restart / single-worker crash-restart doesn't show everyone at
    (0, 0) until they next move. Tolerant of DB unavailability (log, continue with an empty
    registry) so tests/dev without the table present don't crash — matches this app's general
    "connection failures degrade gracefully, never crash startup" posture."""
    try:
        async with async_session_maker() as session:
            rows = await position_repo.list_all(session)
        position_registry.load_stable(rows)
    except Exception as exc:  # noqa: BLE001
        _logger.exception(exc)


@fastapi_app.on_event("startup")
async def _start_delegation_sweeper() -> None:
    # A2.3 — one periodic task; see services/delegation_lifecycle.py.
    from app.services.delegation_lifecycle import delegation_sweeper

    delegation_sweeper.start()


@fastapi_app.on_event("shutdown")
async def _stop_delegation_sweeper() -> None:
    from app.services.delegation_lifecycle import delegation_sweeper

    await delegation_sweeper.stop()


@fastapi_app.on_event("startup")
async def _seed_mock_hub_content() -> None:
    """MOCK-RIG ONLY: insert/re-date the [DEV] Company Hub test dataset on boot, so the mock
    frontend always has a required announcement / birthday / recognition / announcement / survey
    to exercise instead of an immediate "You're all caught up!".

    Double-gated and OPT-IN: it needs both APP_ENV=development and an explicit MOCK_HUB_SEED=1
    in the process env. The ordinary local backend (and every deploy) leaves MOCK_HUB_SEED
    unset, so this is a no-op there and no mock content can reach a real database. Only the
    mock instance — its own DATABASE_URL, its own port — ever passes it. Tolerant of DB
    unavailability, matching the position-registry hook above.
    """
    if not (settings.is_development and os.getenv("MOCK_HUB_SEED") == "1"):
        return
    try:
        async with async_session_maker() as session:
            counts = await hub_mock.ensure_seeded(session, prune_legacy=True)
        _logger.info("Mock Company Hub dataset ready: %s", counts)
    except Exception as exc:  # noqa: BLE001
        _logger.exception(exc)


fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@fastapi_app.get("/health")
async def health_check() -> dict:
    return {"status": "ok"}


fastapi_app.include_router(chat_router.router)
fastapi_app.include_router(calls_router.router)
fastapi_app.include_router(requests_router.router)
fastapi_app.include_router(room_requests_router.router)
fastapi_app.include_router(talk_requests_router.router)
fastapi_app.include_router(hub_router.router)
fastapi_app.include_router(feed_router.router)
fastapi_app.include_router(toucan_router.router)


# Faithful port of backend/src/http.ts's error shape: REST error responses always come back as
# `{"error": "<message>"}` (never FastAPI's default `{"detail": ...}`), since
# frontend/src/services/chat/RealChatService.ts reads `body?.error`.
@fastapi_app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and "error" in detail:
        body = detail
    else:
        body = {"error": detail if isinstance(detail, str) else str(detail)}
    return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)


@fastapi_app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc: Exception) -> JSONResponse:
    _logger.exception(exc)
    return JSONResponse(status_code=500, content={"error": "Internal server error"})


# Wraps the whole FastAPI app with the python-socketio ASGI app so REST and realtime share one
# origin — this becomes what render.yaml's `uvicorn app.main:app` serves. Non-socket.io paths
# (e.g. /health, /conversations) are routed through to `fastapi_app` unchanged.
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app, socketio_path="socket.io")
