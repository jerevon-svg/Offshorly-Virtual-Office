import { useEffect, useState } from "react";
import { apiFetch, AuthRedirectError, HOME_PATH } from "../services/api/client";

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

// Local-dev escape hatch. This gate is the ONLY thing in the app that talks
// to Atlas (everything else — Zoho data, avatar generation — defaults to
// mock), so without it nobody lacking an Atlas account or the
// can_view_virtual_office flag can run the office at all. Set
// VITE_AUTH_GATE=off in app/.env.local to short-circuit to "allowed".
//
// Double-guarded on import.meta.env.DEV: `vite build` sets DEV=false, so the
// branch is dead code the bundler drops entirely. A stray VITE_AUTH_GATE=off
// in a deploy env therefore cannot open the gate on atlas.offshorly.com.
// This weakens nothing that was ever a security boundary — see the UX-ONLY
// note above; Atlas enforces the flag server-side on every office endpoint.
function isGateBypassed(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_AUTH_GATE === "off";
}

export function useAuthGate(): AuthGateStatus {
  const [status, setStatus] = useState<AuthGateStatus>(() =>
    isGateBypassed() ? "allowed" : "pending",
  );

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
        const allowed = extractCanViewVirtualOffice(body);
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
