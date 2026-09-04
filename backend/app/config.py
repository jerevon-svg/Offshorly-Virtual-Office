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

    # Toucan AI provider (T6). BACKEND-ONLY, like the LiveKit block above: the key signs in to
    # OpenAI from app/services/toucan_ai/provider.py and must never be sent to the browser,
    # logged, or mirrored into a VITE_* var. Empty by default so a deploy without it fails
    # closed into the deterministic assistant — the provider reports itself disabled and every
    # /toucan/ask keeps working exactly as it did at T5 (see provider.ai_enabled).
    OPENAI_API_KEY: str = ""
    # Deliberately a cheap, fast, non-reasoning default; overridable per environment without a
    # code change. A reasoning model here would silently spend the output-token budget on
    # thinking and return empty text under the cap below.
    TOUCAN_AI_MODEL: str = "gpt-4.1-mini"
    # Hard cost/latency bounds on every provider call. No retries are configured anywhere —
    # one question is at most one request, and a failure falls back to the deterministic answer.
    TOUCAN_AI_TIMEOUT_SECONDS: float = 12.0
    TOUCAN_AI_MAX_OUTPUT_TOKENS: int = 500
    # Input bounds: at most this many recent turns of the CURRENT conversation ride along, and
    # at most this many people from the office context are projected into the prompt.
    TOUCAN_AI_MAX_HISTORY_TURNS: int = 6
    TOUCAN_AI_MAX_CONTEXT_PEOPLE: int = 40
    # T7: at most this many of the caller's own saved memories — the ones the deterministic
    # relevance pass in services/toucan/memory_retrieval.py judged relevant to the question —
    # ride along per request, each clamped to this many characters. Both are token-cost bounds
    # on an already owner-filtered, already-projected payload, not the privacy boundary itself.
    TOUCAN_AI_MAX_MEMORIES: int = 5
    TOUCAN_AI_MAX_MEMORY_CHARS: int = 300
    # T8: how long a proposed action stays confirmable. Short on purpose — a confirmation is a
    # "right now" decision, and an expired proposal simply reads as "not found or no longer
    # available"; the user asks again. See services/toucan/pending_actions.py.
    TOUCAN_ACTION_TTL_SECONDS: float = 120.0
    # A1.4.3: bounds on the conversation window an explicit in-chat "@Toucan <prompt>" may show
    # the provider — at most this many of the LATEST messages of THAT conversation only, each
    # clamped to this many characters, and the whole window clamped to this many characters
    # (oldest messages dropped first). See services/chat_assistant.py.
    TOUCAN_CHAT_WINDOW_MESSAGES: int = 20
    TOUCAN_CHAT_MAX_MESSAGE_CHARS: int = 600
    TOUCAN_CHAT_MAX_CONTEXT_CHARS: int = 4000
    # A2.1: bounds on Toucan's AUTOMATIC replies under an explicit delegation (see
    # services/chat_delegation.py). Per (conversation, owner): at least this many seconds between
    # two automatic replies, and at most this many automatic replies for one delegation. Both are
    # spam/loop guards, process-local like every other ephemeral registry; the delegation itself
    # is durable (repositories/toucan_delegation.py).
    TOUCAN_DELEGATION_COOLDOWN_SECONDS: float = 120.0
    TOUCAN_DELEGATION_MAX_REPLIES_PER_CONVERSATION: int = 3

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
