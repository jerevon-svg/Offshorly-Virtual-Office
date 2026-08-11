// Re-exported from the auth layer, which is the only place that knows the
// real signed-in user's id (captured once the auth gate resolves to
// "allowed" — see app/src/auth/useAuthGate.ts). This used to be a hardcoded
// literal ("bon"); it's now a getter because the real value depends on an
// async fetch resolved elsewhere. Falls back to "bon" when the gate is
// bypassed (VITE_AUTH_GATE=off) or no recognizable id is found.
export { getCurrentUserId } from "../auth/useAuthGate";
