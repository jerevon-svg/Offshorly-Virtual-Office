from __future__ import annotations

import httpx
import pytest

from app.auth.atlas import (
    AtlasAuthError,
    clear_atlas_token_cache_for_tests,
    verify_atlas_token,
)

# Port of backend/src/auth/verifyAtlasToken.test.ts.


@pytest.fixture(autouse=True)
def _clear_cache():
    clear_atlas_token_cache_for_tests()
    yield
    clear_atlas_token_cache_for_tests()


def _client_for(status_code: int, body: dict, call_counter: list[int] | None = None) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if call_counter is not None:
            call_counter.append(1)
        return httpx.Response(status_code, json=body)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_verify_atlas_token_returns_lowercased_email_on_success():
    client = _client_for(200, {"email": "Someone@Example.com"})
    async with client:
        email = await verify_atlas_token("good-token", client)
    assert email == "someone@example.com"


async def test_verify_atlas_token_raises_on_non_2xx_response():
    client = _client_for(401, {})
    with pytest.raises(AtlasAuthError):
        async with client:
            await verify_atlas_token("bad-token", client)


async def test_verify_atlas_token_raises_when_body_has_no_email():
    client = _client_for(200, {"full_name": "No Email Here"})
    with pytest.raises(AtlasAuthError):
        async with client:
            await verify_atlas_token("weird-token", client)


async def test_verify_atlas_token_caches_a_successful_verification():
    calls: list[int] = []
    client = _client_for(200, {"email": "cached@example.com"}, calls)
    async with client:
        await verify_atlas_token("cache-token", client)
        await verify_atlas_token("cache-token", client)
    assert len(calls) == 1
