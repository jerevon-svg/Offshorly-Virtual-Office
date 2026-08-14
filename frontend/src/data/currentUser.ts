import { useCurrentUser } from "../auth/currentUserStore";
import { avatarIdForEmail, FALLBACK_AVATAR_ID } from "./avatarIdentity";

// Who "you" are on the canvas.
//
// Two related-but-distinct notions of "current user" live here:
//  - getCurrentUserId(): the Atlas employee id, resolved once useAuthGate's
//    /auth/me call lands (see ../auth/useAuthGate.ts). This is the id used
//    for checkout/time-log submission and anywhere the app needs to talk to
//    Atlas about "this employee".
//  - useCurrentUserAvatarId(): which SPRITE to render as "you" on the map.
//    This used to be a hardcoded `CURRENT_USER_ID = "bon"`, which meant every
//    signed-in person saw themselves as Bon. The id now comes from the Atlas
//    identity that useAuthGate parked in the currentUserStore, resolved to a
//    sprite by the single join in avatarIdentity.ts.
export { getCurrentUserId } from "../auth/useAuthGate";

// Retained as the pre-identity default: the value returned on the first
// paint (before /auth/me resolves), in mock mode, and for anyone with no
// sprite mapping. Prefer useCurrentUserAvatarId() in components — a bare
// import of this constant is a self-render that will never update.
export const CURRENT_USER_ID = FALLBACK_AVATAR_ID;

// Re-renders once the gate's /auth/me response lands, so a component that
// paints before identity is known corrects itself instead of staying on the
// fallback sprite for the rest of the session.
//
// Returns null when identity IS known but no registry entry (nor localpart
// convention) matches it — a real "this person has no character yet"
// signal, distinct from the pre-identity loading state below. Callers
// (OfficeMap) are expected to render the faceless placeholder for null, not
// silently fall back to Bon.
export function useCurrentUserAvatarId(): string | null {
  const user = useCurrentUser();
  return user ? avatarIdForEmail(user.email) : CURRENT_USER_ID;
}
