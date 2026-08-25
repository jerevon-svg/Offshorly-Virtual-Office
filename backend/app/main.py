from __future__ import annotations

import logging

import socketio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.realtime.socket import sio
from app.routers import chat as chat_router
from app.routers import requests as requests_router

_logger = logging.getLogger(__name__)

fastapi_app = FastAPI(title=settings.APP_NAME, version="0.1.0")

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
fastapi_app.include_router(requests_router.router)


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
