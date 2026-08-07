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
// TODO(atlas): confirm the exact response shape for can_view_virtual_office.
// Unconfirmed as of writing whether it is top-level
// (`{ can_view_virtual_office: true }`) or nested under a permissions
// object (`{ permissions: { can_view_virtual_office: true } }`). Read
// defensively below until Atlas confirms; update once their OpenAPI schema
// lands.
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

export function useAuthGate(): AuthGateStatus {
  const [status, setStatus] = useState<AuthGateStatus>("pending");

  useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
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
