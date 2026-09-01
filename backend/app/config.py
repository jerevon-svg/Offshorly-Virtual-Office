from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    APP_NAME: str = "Virtual Office"
    APP_ENV: str = "development"
    DEBUG: bool = False
    SECRET_KEY: str = ""

    DATABASE_URL: str = "sqlite+aiosqlite:///./virtual_office.db"

    CORS_ORIGINS: str = "http://localhost:3000"

    FRONTEND_URL: str = "http://localhost:3000"

    # Base URL of Atlas's API. Identity for the chat REST/socket surface is verified by calling
    # ${ATLAS_API_URL}/api/v1/auth/me with the caller's bearer token (see app/auth/atlas.py) —
    # this backend never checks JWT signatures locally, mirroring backend/src/config.ts.
    ATLAS_API_URL: str = "https://atlas-api.offshorly.com"

    # TTL (ms) for the in-memory Atlas token verification cache — mirrors
    # backend/src/auth/verifyAtlasToken.ts's CACHE_TTL_MS.
    ATLAS_VERIFY_TTL_MS: int = 60_000

    # LiveKit media server (Stage A voice calls). BACKEND-ONLY, ALL THREE:
    #   * LIVEKIT_API_KEY / LIVEKIT_API_SECRET sign participant tokens here and must NEVER be
    #     sent to the browser, logged, or mirrored into any VITE_* var — a leaked secret lets
    #     anyone mint a token for any room and any identity.
    #   * LIVEKIT_URL is not itself a secret, but it is still returned to the client through
    #     POST /calls/token's response rather than baked into the bundle, so switching between
    #     LiveKit Cloud and a self-hosted server is a backend env change with no frontend
    #     rebuild (see app/routers/calls.py, and client.ts's note on build-time VITE_* pain).
    # Empty by default so a deploy without them fails closed with a clear 503 rather than
    # minting garbage tokens (see calls.py's _livekit_config).
    LIVEKIT_URL: str = ""
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""

    # FUTURE multi-worker realtime seam — UNSET AND UNUSED TODAY. When this backend eventually
    # runs more than one worker, Socket.IO needs a cross-process message queue (and the
    # ephemeral registries in app/realtime/state.py need a shared store) for a broadcast made on
    # worker A to reach a client held by worker B. This var reserves the config surface for that
    # queue; empty means "single worker, in-process manager", which is the only supported mode
    # right now and what every environment (local, mock rig on :8002, render.yaml) runs. Nothing
    # connects to Redis when it is set — see state.py's _build_client_manager.
    REALTIME_REDIS_URL: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def is_development(self) -> bool:
        # Exact allow-list: only the literal "development" enables dev-only surfaces. Any other
        # value (staging, prod, a typo, unset-in-a-deploy) fails closed.
        return self.APP_ENV == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
