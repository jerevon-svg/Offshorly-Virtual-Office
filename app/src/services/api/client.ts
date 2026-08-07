// Atlas API client. This app is reverse-proxied at
// https://atlas.offshorly.com/virtual-office — same origin as Atlas, so it
// inherits Atlas's session (JWT in localStorage["token"]).
//
// CRITICAL: never build a relative "/api/..." request path. Under the proxy,
// a relative path resolves against atlas.offshorly.com (the proxy's own
// origin), which has no such routes and returns Atlas's HTML 404 where JSON
// is expected. Every request must go through apiUrl()/apiFetch(), which
// build an ABSOLUTE URL from VITE_API_URL.

// LOGIN_PATH / HOME_PATH are Atlas-origin paths ("/login", "/"), NOT paths
// inside this app. They must never be built from `import.meta.env.BASE_URL`
// or any /virtual-office-prefixed helper — Atlas's login page lives at the
// proxy's root, not under /virtual-office. Centralized here as constants so
// no call site can accidentally prefix them.
export const LOGIN_PATH = "/login";
export const HOME_PATH = "/";

function resolveApiBase(): string {
  const raw = import.meta.env.VITE_API_URL;
  if (!raw) {
    throw new Error(
      "VITE_API_URL is not set. This must be configured at build time (see .env.example) " +
        "— a static bundle has no runtime env, so a missing value here means every API " +
        "call has no backend to reach. Set VITE_API_URL and rebuild.",
    );
  }
  return raw;
}

// Builds an absolute URL from VITE_API_URL + path. Always absolute — never
// falls back to a relative path, per the proxy hazard above.
export function apiUrl(path: string): string {
  const base = resolveApiBase().replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  return `${base}/${trimmedPath}`;
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return null;
  }
  return window.localStorage.getItem("token");
}

// Thrown by apiFetch when there is no auth token to send. Distinguishable
// (via instanceof) from a plain network/runtime Error so callers — notably
// useAuthGate — can tell "apiFetch already redirected to /login, do not
// navigate again" apart from a genuine unexpected failure.
export class AuthRedirectError extends Error {
  constructor() {
    super("No auth token present; redirecting to login.");
    this.name = "AuthRedirectError";
  }
}

// Fetch wrapper that injects the Atlas bearer token and handles the two
// auth failure modes uniformly:
//  - no token at all -> redirect to Atlas login (throws AuthRedirectError)
//  - 401 from the API -> token is stale/invalid; clear ONLY the auth keys
//    (never localStorage.clear() — that would also wipe the mock checkout
//    flow's `checkout:*` draft/result keys) and redirect to Atlas login.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  if (!token) {
    window.location.href = LOGIN_PATH;
    throw new AuthRedirectError();
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(apiUrl(path), { ...init, headers });

  if (response.status === 401) {
    window.localStorage.removeItem("token");
    window.localStorage.removeItem("user");
    window.location.href = LOGIN_PATH;
  }

  // Caller-beware: on a 401 the navigation above has already fired before
  // this Response is returned. Callers must not treat the 401 body as
  // meaningful (e.g. do not `await response.json()` and branch on it) — the
  // page is already navigating away to /login.
  return response;
}
