// vo3d adapter — READ-ONLY view of the employee V1 has ALREADY signed in. No fetch, no store, no auth.
//
// Everything here is a pure read of state V1 resolved before the V2 route could render: App.tsx mounts
// Vo3dHost only once useAuthGate reaches "allowed", and that gate's single GET /api/v1/auth/me is what
// populated auth/currentUserStore. So this function is synchronous, has no loading state, and cannot
// cause a request — which also means it can never trigger apiFetch's 401 -> /login redirect.
import { getCurrentUser } from "../../../auth/currentUserStore";
import { getCurrentUserId } from "../../../auth/useAuthGate";
import { avatarIdForEmail } from "../../../data/avatarIdentity";
import { hasCastLods } from "./v1Avatar";
import type { Vo3dIdentity } from "../app/identity";

/** The value getCurrentUserId() returns when it could NOT read a real id.
 *
 *  useAuthGate keeps this as a private FALLBACK_USER_ID and does not export it, so it is restated here
 *  rather than reached for — a copy of a literal, not a copy of a decision. It is deliberately NOT
 *  data/avatarIdentity's FALLBACK_AVATAR_ID even though both are currently "bon": those are two
 *  unrelated constants that happen to agree, and coupling them would make a future change to one
 *  silently rewrite the meaning of the other.
 *
 *  Why it matters: useAuthGate returns this literal BOTH for the real Bon and for any /auth/me body
 *  whose id field this app did not recognise (its own UNCONFIRMED note). An id that ambiguous is not a
 *  verified identity, so it is discarded rather than carried. */
const UNVERIFIED_EMPLOYEE_ID = "bon";

/** Is this the local dev bypass rather than a real Atlas session? A LABEL for the dev readout only —
 *  nothing branches on it for access, and it re-reads the same two env flags useAuthGate's own
 *  isGateBypassed() does rather than re-deciding anything. */
function isDevBypass(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_AUTH_GATE === "off";
}

/**
 * The signed-in employee as V2 needs them, or NULL when V1 does not know who this is.
 *
 * Null is returned rather than a guess. currentUserStore holds null until a /auth/me body with a usable
 * email has been parsed, and a malformed body leaves it null forever — in that case the world is built
 * with no identity at all, which is exactly the standalone behaviour, instead of the app asserting that
 * whoever is at the keyboard is Bon.
 */
/** The employee's own 3D character, or null when V2 has no body to put them in — either because V1 knows
 *  of no character for them at all, or because the one it knows is 2D-only. Never somebody else's. */
function live3dAvatarId(email: string): string | null {
  const id = avatarIdForEmail(email);
  return id && hasCastLods(id) ? id : null;
}

export function resolveVo3dIdentity(): Vo3dIdentity | null {
  const user = getCurrentUser();
  if (!user || !user.email) return null;

  const source = isDevBypass() ? "dev-bypass" : "atlas";
  const rawId = getCurrentUserId();
  // A bypass session has no Atlas employee id by construction (useAuthGate substitutes the resolved
  // email for one), and the sentinel above is not an id either. Both resolve to null.
  const employeeId =
    source === "dev-bypass" || !rawId || rawId === UNVERIFIED_EMPLOYEE_ID ? null : rawId;

  // full_name is "" whenever /auth/me omitted it (currentUserStore's parse is defensive, not strict).
  // The localpart is a better label than an empty pill, and is never itself empty for a parsed user.
  const displayName = user.full_name.trim() || user.email.split("@")[0] || user.email;

  return {
    displayName,
    // THE ONLY IDENTITY KEY THAT IS ACTUALLY CONFIRMED — and narrowed to what V2 can actually draw.
    //
    // avatarIdForEmail returns null for anyone with no registered character, and that null is passed
    // straight through, never widened to a fallback. But a NON-null answer is not enough on its own:
    // V1's registry names the character that renders a person there, where a 2D SPRITE SET is a complete
    // answer ("lui" is one — a real employee, a real V1 avatar, no consolidated GLB). V2 has only GLBs,
    // so for that person its honest answer is the same "no character yet" an unmapped person gets, and
    // hasCastLods is what distinguishes the two. Before this check the id was handed on and the world
    // threw looking it up in the 3D registry, which blanked the whole preview.
    avatarId: live3dAvatarId(user.email),
    employeeId,
    source,
  };
}
