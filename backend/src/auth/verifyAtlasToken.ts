import { config } from "../config.js";

// Identity is verified by proxying to Atlas's own `/api/v1/auth/me` with
// the caller's bearer token — this backend never checks JWT signatures
// locally (Atlas owns the signing key, we don't). A short in-memory TTL
// cache keyed by the raw token avoids hammering Atlas on every socket
// event/REST call from an active session.

const CACHE_TTL_MS = 60_000; // few minutes would also be fine; keep it short

interface CacheEntry {
  email: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export class AtlasAuthError extends Error {
  constructor(message = "Invalid or expired token") {
    super(message);
    this.name = "AtlasAuthError";
  }
}

interface AtlasMeShape {
  email?: unknown;
}

function extractEmail(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const shaped = body as AtlasMeShape;
  if (typeof shaped.email !== "string" || shaped.email.trim() === "") return null;
  return shaped.email.trim().toLowerCase();
}

// Injectable fetch impl for tests — defaults to the global fetch.
export async function verifyAtlasToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const cached = cache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.email;
  }

  let res: Response;
  try {
    res = await fetchImpl(`${config.atlasApiUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new AtlasAuthError("Failed to reach Atlas for verification");
  }

  if (!res.ok) {
    throw new AtlasAuthError(`Atlas rejected token (status ${res.status})`);
  }

  const body = await res.json().catch(() => null);
  const email = extractEmail(body);
  if (!email) {
    throw new AtlasAuthError("Atlas /auth/me response had no usable email");
  }

  cache.set(token, { email, expiresAt: Date.now() + CACHE_TTL_MS });
  return email;
}

// Test-only: cache persists across calls in the same process.
export function clearAtlasTokenCacheForTests(): void {
  cache.clear();
}
