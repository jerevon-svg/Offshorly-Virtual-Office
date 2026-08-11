import { useSyncExternalStore } from "react";
import type { AtlasUser } from "../services/office/types";

// Holds the signed-in Atlas user for the lifetime of the page.
//
// useAuthGate already fetches GET /api/v1/auth/me at boot to check the
// can_view_virtual_office flag, and that same response carries the user's
// identity. Parking it here means the app learns who it is without a second
// round trip — and keeps useAuthGate's public signature (a status string)
// unchanged, so its existing tests stay valid.
//
// A module-level store rather than React context on purpose: the identity
// is fetched exactly once, never changes without a full page load, and is
// needed by leaf components that would otherwise all have to be threaded
// through a provider.

let currentUser: AtlasUser | null = null;
const listeners = new Set<() => void>();

interface AtlasUserShape {
  id?: unknown;
  email?: unknown;
  full_name?: unknown;
  role?: unknown;
  team?: unknown;
}

// Defensive in the same spirit as extractCanViewVirtualOffice: the gate
// treats a malformed /auth/me body as "denied" rather than crashing, so
// this must not throw on one either. Returns null when the body doesn't
// carry a usable identity, which callers render as the unmapped fallback.
function parseAtlasUser(body: unknown): AtlasUser | null {
  if (typeof body !== "object" || body === null) return null;
  const shaped = body as AtlasUserShape;
  if (typeof shaped.email !== "string" || shaped.email === "") return null;
  return {
    id: typeof shaped.id === "string" ? shaped.id : "",
    email: shaped.email,
    full_name: typeof shaped.full_name === "string" ? shaped.full_name : "",
    role: typeof shaped.role === "string" ? shaped.role : "",
    team: typeof shaped.team === "string" ? shaped.team : null,
  };
}

export function setCurrentUserFromMeResponse(body: unknown): void {
  const parsed = parseAtlasUser(body);
  // Never clobber a good identity with a null — a later malformed response
  // should leave the app knowing who it is.
  if (!parsed) return;
  currentUser = parsed;
  for (const listener of listeners) listener();
}

export function getCurrentUser(): AtlasUser | null {
  return currentUser;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Re-renders subscribers once the gate's /auth/me response lands. Returns
// null on the first paint — callers must handle that, since the identity is
// genuinely not known yet at that point.
export function useCurrentUser(): AtlasUser | null {
  return useSyncExternalStore(subscribe, getCurrentUser, getCurrentUser);
}

// Test-only: module state outlives a single test, so suites that assert on
// identity need a way back to the boot state.
export function resetCurrentUserForTests(): void {
  currentUser = null;
  for (const listener of listeners) listener();
}
