// OFFICE EXPERIENCE — which office an employee opens: the 3D world, or the Classic 2D one.
//
// It is the SAME idiom services/settings/environmentPreferences.ts established, down to the storage
// shape: a module-level singleton, a listener set, a per-employee localStorage key, a sanitiser that
// throws away any value no UI could have produced, and a re-resolve when /auth/me lands. Nothing is
// written server-side: no table, no endpoint, no migration.
//
// WHY PER EMPLOYEE, like environment and unlike experiencePreferences. This is a personal choice, not a
// machine-level "how the office feels" record. Two people signing into the same browser must not inherit
// each other's office, so it is keyed by the authenticated identity the same way environmentPreferences
// and components/OfficeMap/toucanReturnBriefing.ts already key theirs.
//
// WHAT READS IT. Exactly one thing: App.tsx, once, immediately after the auth gate opens. It is
// deliberately NOT a live subscription there — see resolveOfficeExperience below.
//
// WHAT IS NOT HERE. The switching itself. Changing this value does not navigate, reload or move anybody;
// components/OfficeMap/OfficeExperiencePanel.tsx owns the confirm and the reload, because a preference
// store that could reload the page out from under an open call would be a preference store with a
// side effect nobody asked for. A change made in ANOTHER tab reaches this tab's store and changes
// nothing until that tab is reloaded, which is the correct amount of surprise.
import { getCurrentUser, subscribeCurrentUser } from "../../auth/currentUserStore";

/** "v2" is the 3D office (dev/vo3d). "classic" is V1's 2D office (components/OfficeMap). The two
 *  seasonal values are DECORATIONS OF THE SAME V2 WORLD — same rooms, same navigation, same seating —
 *  and they are recognised here so a saved or previewed one is a value with a meaning rather than a
 *  stray string. Recognised is NOT available: see ALLOWED, below. */
export type OfficeExperience = "v2" | "classic" | "halloween" | "christmas";

/** EVERY IDENTIFIER THIS BUILD RECOGNISES. The vocabulary, not the permission — being in here only
 *  means the value has a meaning and may be held in storage, never that anybody may open it. */
export const KNOWN_OFFICE_EXPERIENCES: readonly OfficeExperience[] = ["v2", "classic", "halloween", "christmas"];

/** THE TWO OFFICES THAT ARE AVAILABLE BY CONSTRUCTION. No server can unpublish them, and they are
 *  what remains available when the catalog cannot be read at all — which is what guarantees there is
 *  no state of the backend in which somebody has nowhere to go.
 *
 *  PHASE 9A MOVED THE REST OF THIS QUESTION TO THE SERVER. Which seasonal offices an employee may
 *  open is now `services/office/experienceCatalog`'s answer for their verified identity, because a
 *  browser cannot be trusted to hold a fact that an unpublish is supposed to take away. */
export const PERMANENT_OFFICE_EXPERIENCES: readonly OfficeExperience[] = ["v2", "classic"];

/** @deprecated Phase 9A renamed this. It used to mean "the complete set an employee may be put in",
 *  which is now a server answer and is passed to `resolveOfficeExperience` as `allowed`. What is
 *  left of the old meaning — the offices that are always selectable — is
 *  PERMANENT_OFFICE_EXPERIENCES, which this now aliases so no existing reader silently changes
 *  meaning. */
export const SELECTABLE_OFFICE_EXPERIENCES: readonly OfficeExperience[] = PERMANENT_OFFICE_EXPERIENCES;

/** @deprecated the oldest name for the same list. */
export const OFFICE_EXPERIENCES = PERMANENT_OFFICE_EXPERIENCES;

/** THE DEFAULT, AND THE WHOLE ROLLBACK. Flipping this one word puts every employee who has never opened
 *  the setting back into the Classic office — no migration, no deploy of anything else, and every
 *  employee who DID choose keeps their choice. */
export const DEFAULT_OFFICE_EXPERIENCE: OfficeExperience = "v2";

const STORAGE_PREFIX = "vo:officeExperience:v1:";

/** The signed-in employee, normalised the way every other per-viewer key in this app normalises it.
 *  "anon" before /auth/me lands and in the standalone dev rig — a real key, so a choice made there is
 *  still remembered, just not as anyone. */
function viewerKey(): string {
  return (getCurrentUser()?.email ?? "").trim().toLowerCase() || "anon";
}

/** Anything that is not a word this build recognises is not a preference, it is a hand-edited or
 *  stale payload — and the answer to that is the default.
 *
 *  WHY THIS VALIDATES AGAINST THE VOCABULARY AND NOT AGAINST WHAT IS AVAILABLE. A saved "halloween"
 *  must SURVIVE the season being unpublished: the employee chose it, the company merely turned it
 *  off for now, and erasing their choice on the way past would mean they came back to the 3D office
 *  next October with no idea why. So an unavailable-but-known value is kept in storage and filtered
 *  out at RESOLUTION instead (see `resolveOfficeExperience`), where the server's answer is in hand.
 *  A tampered "halloween" is held the same way and is equally inert, because holding a value has
 *  never been what opens an office. */
function sanitize(value: unknown): OfficeExperience {
  return KNOWN_OFFICE_EXPERIENCES.includes(value as OfficeExperience)
    ? (value as OfficeExperience)
    : DEFAULT_OFFICE_EXPERIENCE;
}

/** THE RAW STORED CHOICE, or null when this employee has never made one.
 *
 *  "NEVER CHOSE" AND "CHOSE THE 3D OFFICE" ARE DIFFERENT FACTS, and Phase 9A is what made the
 *  difference matter: the company default applies to the first and must not override the second. The
 *  store used to collapse them — a missing key read as the default — which would have made a Creator
 *  setting the company default to Classic move everybody who had explicitly chosen the 3D office.
 *  So the null survives to the one caller that needs it, `resolveOfficeExperience`, and every other
 *  reader still gets the flattened answer through `getOfficeExperience`.
 *
 *  A stored value this build does not recognise is a hand-edited or stale payload, and is reported as
 *  "never chose" rather than as a choice — the same answer somebody who never opened the setting gets. */
function readStored(viewer: string): OfficeExperience | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_PREFIX + viewer);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    return KNOWN_OFFICE_EXPERIENCES.includes(parsed as OfficeExperience) ? (parsed as OfficeExperience) : null;
  } catch {
    // Storage unavailable (private browsing), or unparseable. "No choice on record" either way.
    return null;
  }
}


// The identity is not known at import time (useAuthGate fetches it at boot), so the viewer is resolved
// lazily and re-resolved when it changes rather than captured once.
let viewer = viewerKey();
/** null until this employee makes a choice — see readStored. */
let stored: OfficeExperience | null = readStored(viewer);
let state: OfficeExperience = stored ?? DEFAULT_OFFICE_EXPERIENCE;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

/** Re-point at whoever is signed in now. Called when /auth/me lands, and defensively on every read. */
function syncViewer(): boolean {
  const next = viewerKey();
  if (next === viewer) return false;
  viewer = next;
  stored = readStored(viewer);
  state = stored ?? DEFAULT_OFFICE_EXPERIENCE;
  return true;
}

subscribeCurrentUser(() => {
  if (syncViewer()) notify();
});

export function getOfficeExperience(): OfficeExperience {
  syncViewer();
  return state;
}

/** This employee's own EXPLICIT choice, or null if they have never made one.
 *
 *  The one caller is `resolveOfficeExperience`, which must let the company default through for
 *  somebody who never chose and must not let it past somebody who did. Everything that renders the
 *  current selection wants `getOfficeExperience` instead — a picker has to have a card selected. */
export function getStoredOfficeExperience(): OfficeExperience | null {
  syncViewer();
  return stored;
}

export function setOfficeExperience(next: OfficeExperience): void {
  syncViewer();
  const value = sanitize(next);
  if (value === state && stored !== null) return;
  state = value;
  stored = value;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + viewer, JSON.stringify(state));
  } catch {
    // ignore — the in-memory value still drives this session, it just will not outlive it
  }
  notify();
}

export function subscribeOfficeExperience(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The URL's say, when it has one. `?world=v1` and `?world=v2` are an EXPLICIT override for this tab and
 *  they beat the stored preference — that is what makes them a support and QA lever that needs no deploy
 *  and cannot be locked out by a bad saved value. Their meaning is UNCHANGED by Phase 9A.
 *
 *  A SEASONAL NAME IS ALSO PARSED, and that is deliberate rather than an oversight. It is how a Creator
 *  opens a private preview in one tab without changing what they have saved, and it is the same lever
 *  support already has. It grants nothing: `resolveOfficeExperience` intersects whatever this returns
 *  with the server's allowed set, so `?world=halloween` typed by an employee who was not listed for it
 *  resolves exactly as if it had not been typed. Parsing it is not permission — nothing in this module
 *  is permission.
 *
 *  Any other value of `world` is not an override at all (V1's own route already treated it that way), so
 *  it falls through to the preference. */
export function officeExperienceFromUrl(search: string): OfficeExperience | null {
  const world = new URLSearchParams(search).get("world");
  if (world === "v1") return "classic";
  if (world === "v2") return "v2";
  if (world && KNOWN_OFFICE_EXPERIENCES.includes(world as OfficeExperience)) {
    return world as OfficeExperience;
  }
  return null;
}

/** Where a Settings switch lands, with everything else about the current URL left alone.
 *
 *  `world` is DROPPED rather than rewritten, in BOTH directions. It is a per-tab override that BEATS the
 *  saved preference, so leaving an old `?world=v1` in place while saving "3D Office" would save one thing
 *  and open the other — the setting would look broken while being right. Dropping it hands the decision
 *  back to the preference that was just written. Every other parameter and the fragment are untouched, so
 *  an existing deep link keeps whatever else it was carrying. */
export function switchUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("world");
  return url.toString();
}

/** THE EMERGENCY EXIT: open the Classic office in this tab WITHOUT changing what is saved.
 *
 *  This is the failure-screen control in dev/vo3d/app/Vo3dHost.tsx, and the distinction it draws is the
 *  whole reason it is not just `setOfficeExperience("classic")` plus a reload. A 3D office that failed to
 *  start is an INCIDENT, not a preference. Writing the preference here would quietly demote an employee
 *  to Classic because of one bad load — a flaky network, a GPU hiccup — and they would have no idea why
 *  their office had changed or where to change it back. Setting `?world=v1` gets them working in this
 *  tab immediately and leaves their saved choice exactly as they left it, so the next ordinary load is
 *  the 3D office again. Leaving for good stays a decision made in Settings.
 *
 *  Every other parameter is preserved, so an employee who hit this on a deep link keeps it. */
export function classicOverrideUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.set("world", "v1");
  return url.toString();
}

export function openClassicOffice(): void {
  // A full document navigation, never a router transition: V2 scatters listeners and GPU state across
  // window, document and document.body, and a document teardown is the one teardown that cannot leave
  // anything behind.
  window.location.href = classicOverrideUrl(window.location.href);
}

/** THE ONE ANSWER, resolved once per session by App.tsx after the auth gate opens AND after the
 *  server's catalog has landed.
 *
 *  ORDER, and every step is intersected with what the SERVER allowed:
 *    1. an allowed URL override          (`?world=…` — support, QA and a Creator's private preview)
 *    2. an allowed saved preference      (this employee's own explicit choice)
 *    3. the company default              (already guaranteed allowed; re-checked anyway)
 *    4. the 3D office                    (available by construction; there is always somewhere to go)
 *
 *  THE INTERSECTIONS ARE THE WHOLE SECURITY MODEL. A URL parameter and a localStorage key are both
 *  things an employee can type, so neither is ever trusted to name an office on its own — each is a
 *  REQUEST that is granted only if the server already listed that office for this identity. An
 *  unpublished season therefore cannot be reached by typing its name in either place.
 *
 *  `allowed` DEFAULTS TO THE PERMANENT OFFICES rather than to "everything". A caller who forgot to
 *  pass the catalog, or one running before it landed, gets the 3D or Classic office — never a
 *  season. Failing open here would have made every other check in this file decorative.
 *
 *  It is a plain function rather than a hook on purpose — the office must NOT change under a
 *  signed-in session because a store or a company setting changed, and a component that re-read this
 *  live would do exactly that. A new company default reaches an employee on their next ordinary
 *  load. */
export function resolveOfficeExperience(
  search = window.location.search,
  allowed: readonly OfficeExperience[] = PERMANENT_OFFICE_EXPERIENCES,
  companyDefault: OfficeExperience = DEFAULT_OFFICE_EXPERIENCE,
): OfficeExperience {
  const permit = (value: OfficeExperience | null): OfficeExperience | null =>
    value !== null && allowed.includes(value) ? value : null;
  return (
    permit(officeExperienceFromUrl(search)) ??
    permit(getStoredOfficeExperience()) ??
    permit(companyDefault) ??
    DEFAULT_OFFICE_EXPERIENCE
  );
}

/** Tests only — back to the shipped default for whoever is signed in, without touching the listeners. */
export function __resetOfficeExperienceForTests(): void {
  viewer = viewerKey();
  stored = null;
  state = DEFAULT_OFFICE_EXPERIENCE;
  notify();
}
