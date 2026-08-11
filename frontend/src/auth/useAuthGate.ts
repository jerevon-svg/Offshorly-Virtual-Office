import { useEffect, useState } from "react";
import { apiFetch, AuthRedirectError, HOME_PATH } from "../services/api/client";
import { getCurrentUser, setCurrentUserFromMeResponse } from "./currentUserStore";

// Boot-time permission gate for the Virtual Office. Calls Atlas's
// GET /api/v1/auth/me and checks the can_view_virtual_office flag.
//
// *** UX ONLY — NOT ACCESS CONTROL ***
// This check runs entirely client-side in a publicly served static bundle,
// at a publicly routable path (/virtual-office). Anyone can load the JS,
// skip this check, or hit the backend directly. It exists purely to avoid
// flashing the office UI at someone who shouldn't see it. The Atlas backend
// MUST independently enforce can_view_virtual_office on every office API
// endpoint — this gate provides zero security on its own.
//
// Atlas confirmed (per spec): GET /api/v1/auth/me returns the flag NESTED
// under `permissions` — `{ permissions: { can_view_virtual_office: true } }`.
// They also documented GET /api/v1/auth/permissions, which returns the same
// permissions object UNNESTED — `{ can_view_virtual_office: true }`.
// extractCanViewVirtualOffice below stays defensive (checks both shapes)
// rather than narrowing to nested-only: that's what makes it already
// compatible with /auth/permissions if we ever switch endpoints.
// "denied"         -> gate itself decides to bounce to HOME_PATH (permission
//                      flag false, or a non-401 request error — see below).
// "unauthenticated" -> apiFetch already redirected to LOGIN_PATH (no token,
//                      or a 401). The gate must NOT issue a competing
//                      navigation here; App just renders null while that
//                      redirect completes.
export type AuthGateStatus = "pending" | "allowed" | "denied" | "unauthenticated";

interface MeResponseShape {
  can_view_virtual_office?: boolean;
  permissions?: {
    can_view_virtual_office?: boolean;
  };
  id?: string;
  employee_id?: string;
  employeeId?: string;
  user?: {
    id?: string;
    employee_id?: string;
    employeeId?: string;
  };
}

function extractCanViewVirtualOffice(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const shaped = body as MeResponseShape;
  if (typeof shaped.can_view_virtual_office === "boolean") {
    return shaped.can_view_virtual_office;
  }
  if (typeof shaped.permissions?.can_view_virtual_office === "boolean") {
    return shaped.permissions.can_view_virtual_office;
  }
  return false;
}

// Fallback identity used when the gate is bypassed (VITE_AUTH_GATE=off, no
// network call happens) or when a real /auth/me response has no recognizable
// id field. Matches the office sprite/asset this app was originally built
// around; see app/src/data/office-layout.ts.
const FALLBACK_USER_ID = "bon";

// UNCONFIRMED WITH ATLAS: unlike can_view_virtual_office (spec-confirmed
// shape), nobody has confirmed which field on GET /api/v1/auth/me actually
// carries the real user/employee id. This tries several plausible shapes
// (top-level id/employee_id/employeeId, or nested under `user`) and falls
// back to FALLBACK_USER_ID if none match. Tighten this once Atlas confirms
// the real field name/shape.
function extractCurrentUserId(body: unknown): string {
  if (typeof body !== "object" || body === null) return FALLBACK_USER_ID;
  const shaped = body as MeResponseShape;
  const candidate =
    shaped.id ??
    shaped.employee_id ??
    shaped.employeeId ??
    shaped.user?.id ??
    shaped.user?.employee_id ??
    shaped.user?.employeeId;
  // Atlas's field shape is UNCONFIRMED — a numeric employee id (e.g. `id: 42`)
  // is a plausible real-world shape and must not silently fall through to
  // FALLBACK_USER_ID (that would mask a real employee as "bon").
  const normalized =
    typeof candidate === "number" && Number.isFinite(candidate) ? String(candidate) : candidate;
  return typeof normalized === "string" && normalized.length > 0 ? normalized : FALLBACK_USER_ID;
}

// Module-level value set once the gate resolves. OfficeMap (and everything
// else that needs "who am I") only ever renders after the gate reaches
// "allowed", so a plain module-level variable — read via getCurrentUserId()
// — is sufficient; no context/state plumbing needed.
let currentUserId: string = FALLBACK_USER_ID;

export function getCurrentUserId(): string {
  return currentUserId;
}

// Test-only reset hook. Production code never calls this — currentUserId is
// meant to persist for the lifetime of the tab. Tests need it to avoid
// state leaking across cases via the shared module singleton.
export function __resetCurrentUserIdForTest(): void {
  currentUserId = FALLBACK_USER_ID;
}

// Local-dev escape hatch. This gate is the ONLY thing in the app that talks
// to Atlas (everything else — Zoho data, avatar generation — defaults to
// mock), so without it nobody lacking an Atlas account or the
// can_view_virtual_office flag can run the office at all. Set
// VITE_AUTH_GATE=off in frontend/.env.local to short-circuit to "allowed".
//
// Double-guarded on import.meta.env.DEV: `vite build` sets DEV=false, so the
// branch is dead code the bundler drops entirely. A stray VITE_AUTH_GATE=off
// in a deploy env therefore cannot open the gate on atlas.offshorly.com.
// This weakens nothing that was ever a security boundary — see the UX-ONLY
// note above; Atlas enforces the flag server-side on every office endpoint.
function isGateBypassed(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_AUTH_GATE === "off";
}

// When the gate is bypassed, no real /auth/me call ever happens, so
// currentUserStore is otherwise left with no identity at all (email null
// forever). That breaks anything keyed off "who is the viewer" — notably
// OfficeMap's roster de-dup, which drops the signed-in viewer's own static
// roster portrait by matching their email; with no email, the filter never
// matches and the viewer's roster entry renders alongside their animated
// player sprite (two Bons on screen). Bon's real email is hardcoded here
// deliberately (matches FALLBACK_USER_ID's/FALLBACK_AVATAR_ID's "bon"
// convention and avatarIdentity.ts's EMAIL_TO_AVATAR_ID override) — local
// dev with the gate off is meant to behave as "you are Bon", same as it
// always has. Keep this in sync with that override if it ever changes.
const DEV_BYPASS_EMAIL = "jerevon@offshorly.com";

function seedDevBypassIdentity(): void {
  if (getCurrentUser()) return;
  setCurrentUserFromMeResponse({
    id: FALLBACK_USER_ID,
    email: DEV_BYPASS_EMAIL,
    full_name: "Bon",
    role: "",
    team: null,
  });
}

export function useAuthGate(): AuthGateStatus {
  const [status, setStatus] = useState<AuthGateStatus>(() => {
    if (isGateBypassed()) {
      seedDevBypassIdentity();
      return "allowed";
    }
    return "pending";
  });

  useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
      if (isGateBypassed()) return;
      try {
        const response = await apiFetch("/api/v1/auth/me");
        if (response.status === 401) {
          // apiFetch already cleared token+user and redirected to
          // LOGIN_PATH. Do not also bounce to HOME_PATH — that would fire a
          // second, competing navigation and land the user on / instead of
          // the re-auth entry point.
          if (!cancelled) setStatus("unauthenticated");
          return;
        }
        if (!response.ok) {
          // Deliberate choice: a non-401 failure (e.g. 500, malformed
          // gateway response) is treated as unauthorized-for-this-gate and
          // bounced to HOME_PATH rather than LOGIN_PATH, since it isn't
          // Atlas's re-auth signal.
          if (!cancelled) setStatus("denied");
          return;
        }
        const body: unknown = await response.json();
        // Same response also carries the signed-in user's identity, so the
        // app learns who it is here rather than issuing a second /auth/me.
        // Stored before the permission check deliberately: a denied user is
        // navigating away, and the store is harmless either way.
        setCurrentUserFromMeResponse(body);
        const allowed = extractCanViewVirtualOffice(body);
        if (allowed) {
          const resolvedId = extractCurrentUserId(body);
          currentUserId = resolvedId;
          if (resolvedId === FALLBACK_USER_ID) {
            // Atlas responded and the gate is allowed, but no recognizable
            // id field was found in the body (see UNCONFIRMED note above).
            // Surface this — silently returning "bon" for every real
            // employee would look like success while being wrong.
            console.warn(
              "[useAuthGate] /api/v1/auth/me returned no recognizable user id field; " +
                "falling back to FALLBACK_USER_ID. Update extractCurrentUserId() once Atlas " +
                "confirms the real field name/shape.",
            );
          }
        }
        if (!cancelled) setStatus(allowed ? "allowed" : "denied");
      } catch (err) {
        if (err instanceof AuthRedirectError) {
          // No token was present; apiFetch already redirected to
          // LOGIN_PATH. Do not also navigate to HOME_PATH.
          if (!cancelled) setStatus("unauthenticated");
          return;
        }
        // Network error or bad JSON — deliberately treated as unauthorized
        // and bounced to HOME_PATH (see non-401 comment above).
        if (!cancelled) setStatus("denied");
      }
    }

    void checkAccess();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status === "denied") {
      window.location.href = HOME_PATH;
    }
    // "unauthenticated" intentionally does not navigate here — apiFetch
    // already redirected to LOGIN_PATH.
  }, [status]);

  return status;
}
