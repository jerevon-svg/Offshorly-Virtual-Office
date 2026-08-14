import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.ATLAS_API_URL ??= "https://atlas-api.test";
process.env.NODE_ENV ??= "test";
process.env.CORS_ORIGIN ??= "http://localhost:5173";

const { verifyAtlasToken, AtlasAuthError, clearAtlasTokenCacheForTests } = await import(
  "./verifyAtlasToken.js"
);

beforeEach(() => {
  clearAtlasTokenCacheForTests();
});

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as typeof fetch;
}

test("verifyAtlasToken returns the lowercased email on success", async () => {
  const fetchImpl = fakeFetch(200, { email: "Someone@Example.com" });
  const email = await verifyAtlasToken("good-token", fetchImpl);
  assert.equal(email, "someone@example.com");
});

test("verifyAtlasToken throws AtlasAuthError on a non-2xx response", async () => {
  const fetchImpl = fakeFetch(401, {});
  await assert.rejects(() => verifyAtlasToken("bad-token", fetchImpl), AtlasAuthError);
});

test("verifyAtlasToken throws AtlasAuthError when the body has no email", async () => {
  const fetchImpl = fakeFetch(200, { full_name: "No Email Here" });
  await assert.rejects(() => verifyAtlasToken("weird-token", fetchImpl), AtlasAuthError);
});

test("verifyAtlasToken caches a successful verification (fetch not called twice)", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = (async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ email: "cached@example.com" }) } as Response;
  }) as typeof fetch;

  await verifyAtlasToken("cache-token", fetchImpl);
  await verifyAtlasToken("cache-token", fetchImpl);
  assert.equal(calls, 1);
});
