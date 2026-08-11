import { useCurrentUser } from "../auth/currentUserStore";
import { avatarIdForEmail, FALLBACK_AVATAR_ID } from "./avatarIdentity";

// Who "you" are on the canvas.
//
// This used to be a hardcoded `CURRENT_USER_ID = "bon"`, which meant every
// signed-in person saw themselves as Bon. The id now comes from the Atlas
// identity that useAuthGate parked in the currentUserStore, resolved to a
// sprite by the single join in avatarIdentity.ts.

// Retained as the pre-identity default: the value returned on the first
// paint (before /auth/me resolves), in mock mode, and for anyone with no
// sprite mapping. Prefer useCurrentUserAvatarId() in components — a bare
// import of this constant is a self-render that will never update.
export const CURRENT_USER_ID = FALLBACK_AVATAR_ID;

// Re-renders once the gate's /auth/me response lands, so a component that
// paints before identity is known corrects itself instead of staying on the
// fallback sprite for the rest of the session.
export function useCurrentUserAvatarId(): string {
  const user = useCurrentUser();
  return user ? avatarIdForEmail(user.email) : CURRENT_USER_ID;
}
