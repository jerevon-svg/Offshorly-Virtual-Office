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

/** "v2" is the 3D office (dev/vo3d). "classic" is V1's 2D office (components/OfficeMap). */
export type OfficeExperience = "v2" | "classic";

/** THE OFFICES AN EMPLOYEE MAY ACTUALLY BE PUT IN, and therefore the only values this store will hold.
 *
 *  The gallery in components/OfficeMap/officeExperienceGallery may LIST more than this — a seasonal
 *  office that is previewed but not yet available — and the two lists are deliberately not the same
 *  thing. A value that is shown but not yet selectable must never survive a write to storage, or an
 *  employee could be booted into an office that does not exist yet. So this list, not the gallery, is
 *  what the sanitiser below validates against. */
export const SELECTABLE_OFFICE_EXPERIENCES: readonly OfficeExperience[] = ["v2", "classic"];

/** @deprecated the older name for SELECTABLE_OFFICE_EXPERIENCES; kept so nothing silently changes
 *  meaning. Prefer the explicit name — "these are the ones that can be picked". */
export const OFFICE_EXPERIENCES = SELECTABLE_OFFICE_EXPERIENCES;

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

/** Anything that is not one of the two words this app's own UI can write is not a preference, it is a
 *  hand-edited or stale payload — and the answer to that is the default, which is also what somebody
 *  who never opened the setting gets. */
function sanitize(value: unknown): OfficeExperience {
  return SELECTABLE_OFFICE_EXPERIENCES.includes(value as OfficeExperience)
    ? (value as OfficeExperience)
    : DEFAULT_OFFICE_EXPERIENCE;
}

function read(viewer: string): OfficeExperience {
  try {
    const stored = window.localStorage.getItem(STORAGE_PREFIX + viewer);
    if (stored === null) return DEFAULT_OFFICE_EXPERIENCE;
    return sanitize(JSON.parse(stored));
  } catch {
    // Storage unavailable (private browsing), or unparseable. The default is correct either way.
    return DEFAULT_OFFICE_EXPERIENCE;
  }
}

// The identity is not known at import time (useAuthGate fetches it at boot), so the viewer is resolved
// lazily and re-resolved when it changes rather than captured once.
let viewer = viewerKey();
let state: OfficeExperience = read(viewer);
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

/** Re-point at whoever is signed in now. Called when /auth/me lands, and defensively on every read. */
function syncViewer(): boolean {
  const next = viewerKey();
  if (next === viewer) return false;
  viewer = next;
  state = read(viewer);
  return true;
}

subscribeCurrentUser(() => {
  if (syncViewer()) notify();
});

export function getOfficeExperience(): OfficeExperience {
  syncViewer();
  return state;
}

export function setOfficeExperience(next: OfficeExperience): void {
  syncViewer();
  const value = sanitize(next);
  if (value === state) return;
  state = value;
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
 *  and cannot be locked out by a bad saved value. Any other value of `world` is not an override at all
 *  (V1's own route already treated it that way), so it falls through to the preference. */
export function officeExperienceFromUrl(search: string): OfficeExperience | null {
  const world = new URLSearchParams(search).get("world");
  if (world === "v1") return "classic";
  if (world === "v2") return "v2";
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

/** THE ONE ANSWER, resolved once per session by App.tsx after the auth gate opens.
 *
 *  Order: the URL override, then this employee's saved preference, then the default. It is a plain
 *  function rather than a hook on purpose — the office must NOT change under a signed-in session
 *  because a store changed, and a component that re-read this live would do exactly that. */
export function resolveOfficeExperience(search = window.location.search): OfficeExperience {
  return officeExperienceFromUrl(search) ?? getOfficeExperience();
}

/** Tests only — back to the shipped default for whoever is signed in, without touching the listeners. */
export function __resetOfficeExperienceForTests(): void {
  viewer = viewerKey();
  state = DEFAULT_OFFICE_EXPERIENCE;
  notify();
}
