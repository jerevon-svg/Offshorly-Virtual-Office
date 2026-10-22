// studio/self-auth.mjs — WHO IS ASKING (dev-only VO ↔ Studio bridge, 2026-10-13). The Virtual Office forwards its own session
// token; the Studio asks VO's backend (GET /api/v1/auth/me, the same call the app's auth gate makes) who that token belongs to and
// derives the person id SERVER-SIDE with the app's own email → avatar-id rule (src/data/avatarRegistry.ts exceptions, else the
// email localpart). A client never names the person it acts on, so one employee can never reach another's photo, head or records.
// The backend URL must be one the app itself is configured with (frontend/.env*: VITE_API_URL) — a client cannot point the check at
// a server it controls. Run from frontend/.
import fs from "node:fs";

/** the app's email → avatar-id exceptions, read from src/data/avatarRegistry.ts (the committed single source of truth) */
export function parseAvatarRegistry(src) { const out = {}; for (const m of src.matchAll(/"([^"]+@[^"]+)"\s*:\s*"([a-z0-9-]+)"/g)) out[m[1].toLowerCase()] = m[2]; return out; }
export function personIdForEmail(email, registry) { const e = String(email ?? "").trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+$/.test(e)) return null;
  if (registry[e]) return registry[e];
  const id = e.split("@")[0].replace(/[^a-z0-9-]/g, "") || null;
  // a localpart that equals an id the registry gives to SOMEONE ELSE (jerevon@ → bon, so bon@… must never become "bon") is refused
  return id && Object.values(registry).includes(id) ? null : id; }
/** the owner ledger (studio/owners.json: person id → email): the first verified email to use an id owns it; any other email asking
 *  for the same id (two localparts that sanitise alike, another domain) is refused instead of being handed that person's records */
export function claimOwner(ledger, personId, email) { const owner = ledger[personId];
  if (owner && owner !== email) return { ok: false, ledger };
  return { ok: true, ledger: owner ? ledger : { ...ledger, [personId]: email } }; }
/** the backend base URLs this app is configured with (VITE_API_URL in frontend/.env*), normalised without a trailing slash */
export function allowedApis(root = ".") { const out = new Set(); for (const f of fs.readdirSync(root).filter((x) => x.startsWith(".env"))) {
  for (const line of fs.readFileSync(`${root}/${f}`, "utf8").split("\n")) { const m = line.match(/^VITE_API_URL\s*=\s*(\S+)/); if (m) out.add(m[1].replace(/\/+$/, "")); } } return out; }
/** resolve the caller: { personId, email } or { error, status } — never trusts a client-named person */
export async function resolveSelf({ authorization, voApi }, { allowed, registry, devUser = null, fetchFn = fetch }) {
  // DEV-USER MODE: the operator who STARTED the Studio named the person (HB_STUDIO_DEV_USER — the counterpart of the app's own
  // VITE_AUTH_GATE=off + VITE_DEV_USER_EMAIL bypass). Server-side configuration, never a request field: a client still cannot choose.
  if (devUser) { const e = String(devUser).trim().toLowerCase(), personId = personIdForEmail(e, registry);
    return personId ? { personId, email: e, dev: true } : { status: 422, error: "HB_STUDIO_DEV_USER has no usable character id" }; }
  const api = String(voApi ?? "").replace(/\/+$/, ""); if (!allowed.has(api)) return { status: 403, error: "this VO backend is not one the app is configured with" };
  if (!/^Bearer\s+\S+/.test(String(authorization ?? ""))) return { status: 401, error: "sign in to the Virtual Office first" };
  let r; try { r = await fetchFn(`${api}/api/v1/auth/me`, { headers: { Authorization: authorization } }); } catch { return { status: 502, error: "the VO backend is not reachable" }; }
  if (r.status === 401 || r.status === 403) return { status: 401, error: "your Virtual Office session has expired — sign in again" }; if (!r.ok) return { status: 502, error: `VO backend answered ${r.status}` };
  const me = await r.json().catch(() => null), email = me?.email ?? me?.user?.email ?? null, personId = personIdForEmail(email, registry);
  return personId ? { personId, email: String(email).toLowerCase() } : { status: 422, error: "your account has no usable email for a character" }; }
