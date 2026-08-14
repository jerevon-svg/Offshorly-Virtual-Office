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
