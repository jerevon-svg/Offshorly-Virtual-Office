from __future__ import annotations

import time

import httpx

from app.config import settings

# Identity is verified by proxying to Atlas's own `/api/v1/auth/me` with the caller's bearer
# token — this backend never checks JWT signatures locally (Atlas owns the signing key, we
# don't). A short in-memory TTL cache keyed by the raw token avoids hammering Atlas on every
# socket event/REST call from an active session. Faithful port of
# backend/src/auth/verifyAtlasToken.ts.


class AtlasAuthError(Exception):
    def __init__(self, message: str = "Invalid or expired token") -> None:
        super().__init__(message)
        self.message = message


_cache: dict[str, tuple[str, float]] = {}


def _extract_email(body: object) -> str | None:
    if not isinstance(body, dict):
        return None
    email = body.get("email")
    if not isinstance(email, str) or email.strip() == "":
        return None
    return email.strip().lower()


async def verify_atlas_token(token: str, client: httpx.AsyncClient | None = None) -> str:
    """Verify a bearer token against Atlas's /auth/me, returning the lowercased email.

    `client` is injectable for tests, mirroring the Node version's injectable `fetchImpl`.
    """
    now = time.monotonic()
    cached = _cache.get(token)
    if cached and cached[1] > now:
        return cached[0]

    base_url = settings.ATLAS_API_URL.rstrip("/")
    owns_client = client is None
    http_client = client or httpx.AsyncClient()
    try:
        try:
            res = await http_client.get(
                f"{base_url}/api/v1/auth/me",
                headers={"Authorization": f"Bearer {token}"},
            )
        except httpx.HTTPError as exc:
            raise AtlasAuthError("Failed to reach Atlas for verification") from exc
    finally:
        if owns_client:
            await http_client.aclose()

    if res.status_code < 200 or res.status_code >= 300:
        raise AtlasAuthError(f"Atlas rejected token (status {res.status_code})")

    try:
        body = res.json()
    except ValueError:
        body = None

    email = _extract_email(body)
    if not email:
        raise AtlasAuthError("Atlas /auth/me response had no usable email")

    _cache[token] = (email, now + settings.ATLAS_VERIFY_TTL_MS / 1000)
    return email


def clear_atlas_token_cache_for_tests() -> None:
    _cache.clear()
