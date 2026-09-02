from __future__ import annotations

import re

from fastapi import HTTPException, Request

from app.auth.atlas import AtlasAuthError, verify_atlas_token
from app.config import settings

_BEARER_RE = re.compile(r"^Bearer\s+(.+)$", re.IGNORECASE)


def _dev_email_from_request(request: Request) -> str | None:
    """Dev-only identity bypass — trusts an x-dev-email header/query param instead of calling
    Atlas, so local two-browser testing works without real Atlas tokens. Hard-gated: only
    reachable when settings.is_development is literally True (fail-closed allow-list, not
    "not production") — see app/config.py Settings.is_development."""
    if not settings.is_development:
        return None
    header = request.headers.get("x-dev-email")
    query_param = request.query_params.get("x-dev-email")
    raw = header or query_param
    return raw.strip().lower() if raw and raw.strip() else None


def bearer_token_from_request(request: Request) -> str | None:
    """The caller's raw bearer token, or None when there isn't one (the dev-email bypass).

    ONLY for forwarding a request to Atlas ON THE CALLER'S BEHALF — see
    app/services/toucan/roster.py. It is never an identity source: identity always comes from
    get_current_email below, which verifies the token rather than trusting it. Returns None
    rather than raising so a caller on the dev bypass degrades to "no Atlas access", never to a
    fallback credential."""
    match = _BEARER_RE.match(request.headers.get("authorization") or "")
    return match.group(1) if match else None


async def get_current_email(request: Request) -> str:
    """FastAPI dependency mirroring backend/src/http.ts's authMiddleware: server always derives
    the caller's identity itself — REST bodies/query params never supply a trusted sender/user
    id."""
    dev_email = _dev_email_from_request(request)
    if dev_email:
        return dev_email

    auth_header = request.headers.get("authorization") or ""
    match = _BEARER_RE.match(auth_header)
    if not match:
        raise HTTPException(status_code=401, detail="Missing Authorization bearer token")

    try:
        return await verify_atlas_token(match.group(1))
    except AtlasAuthError as exc:
        raise HTTPException(status_code=401, detail=exc.message) from exc
