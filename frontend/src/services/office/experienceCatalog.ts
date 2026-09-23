// THE OFFICE EXPERIENCE CATALOG — which offices the SERVER says this employee may open.
//
// WHY THIS EXISTS. Until Phase 9A the answer was a constant in the browser, which was fine while it
// was always "the 3D one and the Classic one". A seasonal office is different in kind: it can be
// unpublished, it can be private to a Creator, and a company default can point at it. None of those
// are facts a browser can be trusted to hold, so the browser stops holding them — it asks.
//
// THE SECURITY PROPERTY, IN ONE SENTENCE: the allowed set is whatever the server listed for this
// verified identity, so a hand-edited `?world=halloween`, a hand-edited localStorage key and a stale
// saved preference all name something that is not in it, and resolution falls past them to the
// default. Nothing here decides availability; it only reports what was returned.
//
// FAILURE IS A REAL STATE, NOT AN EXCEPTION. A backend that is down, slow, pre-migration or behind a
// flaky network must not lock anybody out of the office and must not rewrite what they chose. So a
// failed read resolves to PERMANENT_FALLBACK — the two offices that are available by construction —
// with `status: "unavailable"`, and the preference store is never written on this path. An employee
// whose saved office is Classic still opens Classic; an employee whose saved office is a season
// opens the 3D one for that load and gets their season back on the next successful read.
import { getAuthToken } from "../api/client";
import {
  KNOWN_OFFICE_EXPERIENCES,
  PERMANENT_OFFICE_EXPERIENCES,
  DEFAULT_OFFICE_EXPERIENCE,
  type OfficeExperience,
} from "../settings/officeExperience";

/** One seasonal experience's state, as the Creator Studio shows it.
 *
 *  `implemented` is the honest half and the reason the Studio can be useful before any decoration
 *  exists: a season with no shipped decoration layer is listed and explained rather than offered. */
export interface ExperiencePublication {
  experience: OfficeExperience;
  published: boolean;
  implemented: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface ExperienceCatalog {
  /** What anyone may open. Always contains the two permanent offices. */
  available: readonly OfficeExperience[];
  /** A Creator's private set: implemented seasons that are not published yet. Empty for everyone
   *  else, because the server does not put anything in it for them. */
  previewable: readonly OfficeExperience[];
  /** The company-wide default, for an employee who has never chosen. */
  default: OfficeExperience;
  /** Whether the SERVER recognises this caller as a Creator. The only thing the Studio gates on. */
  creator: boolean;
  publications: readonly ExperiencePublication[];
  /** "ok" — this is the server's answer. "unavailable" — the read failed and this is the safe
   *  fallback. The distinction is surfaced in Settings rather than hidden, because "your season is
   *  missing because the office could not be reached" and "your season was unpublished" are
   *  different facts and an employee is entitled to know which one happened. */
  status: "ok" | "unavailable";
}

/** WHAT IS TRUE WITH NO SERVER AT ALL. The two offices that are available by construction, the 3D
 *  one as the default, and no Creator. Nothing here can be widened by a failure. */
export const PERMANENT_FALLBACK: ExperienceCatalog = Object.freeze({
  available: PERMANENT_OFFICE_EXPERIENCES,
  previewable: [] as readonly OfficeExperience[],
  default: DEFAULT_OFFICE_EXPERIENCE,
  creator: false,
  publications: [] as readonly ExperiencePublication[],
  status: "unavailable" as const,
});

function asExperience(value: unknown): OfficeExperience | null {
  return typeof value === "string" && (KNOWN_OFFICE_EXPERIENCES as readonly string[]).includes(value)
    ? (value as OfficeExperience)
    : null;
}

/** Keep only identifiers this build knows, de-duplicated, order preserved. A server that grew a new
 *  experience name before this bundle did must not put a value into the allowed set that no code
 *  here can render — that would be the "a card promising a place that does not exist" failure with
 *  the roles reversed. */
function experienceList(value: unknown): OfficeExperience[] {
  if (!Array.isArray(value)) return [];
  const out: OfficeExperience[] = [];
  for (const item of value) {
    const name = asExperience(item);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

function publicationList(value: unknown): ExperiencePublication[] {
  if (!Array.isArray(value)) return [];
  const out: ExperiencePublication[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const name = asExperience(row.experience);
    if (!name) continue;
    out.push({
      experience: name,
      published: row.published === true,
      implemented: row.implemented === true,
      updatedBy: typeof row.updatedBy === "string" ? row.updatedBy : null,
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
    });
  }
  return out;
}

/** Turn whatever arrived into a catalog this app can act on, or refuse it.
 *
 *  THE PERMANENT OFFICES ARE RE-ADDED HERE unconditionally. The server always sends them, but this
 *  module's job is that there is no response — not a truncated one, not a reordered one, not one
 *  from a future build — after which an employee has nowhere to go. */
function parseCatalog(payload: unknown): ExperienceCatalog {
  const body = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const available = experienceList(body.available);
  for (const name of PERMANENT_OFFICE_EXPERIENCES) {
    if (!available.includes(name)) available.push(name);
  }
  const creator = body.creator === true;
  const previewable = creator ? experienceList(body.previewable) : [];
  const preferred = asExperience(body.default);
  return {
    available,
    previewable,
    // A default naming something this caller cannot open is not a default. The server already
    // guarantees this; re-checking costs one lookup and removes a whole class of "why am I in an
    // office I was never offered" question.
    default: preferred && available.includes(preferred) ? preferred : DEFAULT_OFFICE_EXPERIENCE,
    creator,
    publications: publicationList(body.publications),
    status: "ok",
  };
}

/** Everything this caller may open: the public set plus, for a Creator, their private previews. */
export function allowedExperiences(catalog: ExperienceCatalog): readonly OfficeExperience[] {
  return [...catalog.available, ...catalog.previewable.filter((name) => !catalog.available.includes(name))];
}

// ══ WHICH BACKEND THIS TALKS TO, AND WHY IT IS NOT apiFetch ══
//
// GET /office/experience lives in the VIRTUAL OFFICE backend (backend/app/routers/office_experience.py)
// — the same FastAPI app as chat, hub, attendance and quests. It is NOT an Atlas route.
//
// `apiFetch` builds its URL from VITE_API_URL, which is ATLAS (https://atlas-api.offshorly.com in
// production). Using it here sent every catalog read to a service that has no such route: in
// production it would have 404'd into the silent permanent-offices fallback forever, so no season
// could ever have been published or chosen and the Creator Studio would never have appeared — with
// nothing anywhere reporting a fault, because a failed read is a legitimate state.
//
// So this follows the convention every other VO-backend client already follows — see
// services/attendance/RealAttendanceService.ts and services/hub/hubClient.ts, which say the same
// thing in their own headers: base URL from VITE_CHAT_SOCKET_URL, identity from the dev header when
// one is set and the bearer token otherwise.
//
// IT ALSO MEANS THIS MODULE CAN NEVER SEND ANYBODY TO THE LOGIN PAGE. `apiFetch` treats a missing
// token as "this session is over" and NAVIGATES THE DOCUMENT before it throws — right for the auth
// gate, which is asking whether the viewer is signed in, and wrong for this module, which is asking
// which offices to offer. That is not hypothetical: it took the local mock rig off the air, because
// VITE_AUTH_GATE=off seeds a dev identity without ever writing a token, so every load bounced to
// /login — outside Vite's /virtual-office/ base — and rendered Vite's base-URL warning instead of
// the office. Deciding a session is over belongs to auth/useAuthGate, which runs first.

/** DEV-ONLY, and identical to hubClient's / RealAttendanceService's: on the local rig the auth gate
 *  is bypassed and there is no bearer token, so the backend is told who is asking with the same
 *  `x-dev-email` header every other VO-backend client uses. Set from auth/useAuthGate alongside the
 *  rest. The backend only honours it when APP_ENV is development (app/auth/deps.py). */
let devEmail: string | null = null;
export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
}

function backendBase(): string | null {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  // NULL RATHER THAN A THROW. Every other client throws here because it is called in response to
  // something a person did; this one runs unprompted on every boot, and an unconfigured environment
  // must degrade to the permanent offices rather than break the office's startup path.
  return raw ? raw.replace(/\/+$/, "") : null;
}

/** Who is asking, as a header — or null when nobody is, which is the one case where there is no
 *  point issuing the request at all. */
function identityHeaders(): Headers | null {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (devEmail) {
    headers.set("x-dev-email", devEmail);
    return headers;
  }
  const token = getAuthToken();
  if (!token) return null;
  headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

/** Read the catalog. NEVER REJECTS and never throws: every failure is PERMANENT_FALLBACK, and so is
 *  every state in which there is nothing to ask or nobody to ask as. */
export async function fetchExperienceCatalog(): Promise<ExperienceCatalog> {
  const base = backendBase();
  const headers = identityHeaders();
  if (!base || !headers) return PERMANENT_FALLBACK;
  try {
    const response = await fetch(`${base}/office/experience`, { headers });
    if (!response.ok) return PERMANENT_FALLBACK;
    return parseCatalog(await response.json());
  } catch {
    return PERMANENT_FALLBACK;
  }
}

/** Creator-only: publish or unpublish one seasonal experience. Resolves to the fresh catalog the
 *  server answered with, or rejects with a message the Studio shows verbatim.
 *
 *  This REJECTS where the read above does not, and the asymmetry is the point: a failed read has a
 *  correct silent fallback, while a failed write must never look like it worked. */
export async function setExperiencePublication(
  experience: OfficeExperience,
  published: boolean,
  note?: string,
): Promise<ExperienceCatalog> {
  return writeCatalog(`office/experience/${encodeURIComponent(experience)}/publication`, {
    published,
    ...(note ? { note } : {}),
  });
}

/** Creator-only: set the company-wide default office. Passing "v2" is the restore. */
export async function setDefaultExperience(experience: OfficeExperience): Promise<ExperienceCatalog> {
  return writeCatalog("office/experience/default", { experience });
}

async function writeCatalog(path: string, body: unknown): Promise<ExperienceCatalog> {
  const base = backendBase();
  const headers = identityHeaders();
  // A write with no backend or no identity is a failure the Creator must SEE, not a silent fallback.
  if (!base) throw new Error("The office backend is not configured in this build.");
  if (!headers) throw new Error("You are not signed in.");
  const response = await fetch(`${base}/${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // This app's REST error shape is `{"error": "..."}` (app/main.py's http_exception_handler),
    // never FastAPI's `{"detail": ...}`. The server's own words are more useful than anything that
    // could be invented here — it is the side that knows why.
    let message = `Request failed (${response.status})`;
    try {
      const failure = (await response.json()) as { error?: unknown };
      if (typeof failure?.error === "string" && failure.error) message = failure.error;
    } catch {
      // A non-JSON body (a proxy's HTML error page) leaves the status-code message in place.
    }
    throw new Error(message);
  }
  return parseCatalog(await response.json());
}
