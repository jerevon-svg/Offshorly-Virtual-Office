// vo3d app — THE IDENTITY CONTRACT, and deliberately nothing else.
//
// A leaf module with NO imports at all, which is the whole point. `Vo3dIdentity` is named by two sides
// that must never reach each other: app/world.ts (the V2 world, which must stay loadable by the
// standalone dev page with no V1 auth anywhere in its graph) and adapters/v1Identity.ts (which reads
// V1's signed-in user and therefore pulls in V1's auth store). Parking the type here means world.ts
// names it without importing the adapter, so no refactor can accidentally turn a type-only edge into a
// value one and drag V1's auth into `dev/vo3d.html`.
//
// EMAIL IS THE KEY, not the id. V1's own avatar join is keyed on email (data/avatarIdentity.ts) because
// that is the field Atlas's /auth/me response is CONFIRMED to carry; the id field's shape is not (see
// useAuthGate's UNCONFIRMED note). Nothing here is fetched — every field is a value V1 had already
// resolved before the V2 route could mount.

export interface Vo3dIdentity {
  /** Display name for the signed-in employee. Never empty — the resolver falls back to the email's
   *  localpart rather than handing the world a blank label. */
  displayName: string;
  /** The employee's registered 3D character id (data/avatarRegistry + render3d/live3dCharacters), or
   *  NULL when this person has no approved 3D asset set.
   *
   *  Null is a real answer, not an error, and it must NEVER be widened into somebody else's character.
   *  V1's own rule (data/avatarIdentity.ts) is that an unmapped person renders a faceless placeholder
   *  rather than being masked as Bon; V2 has no 3D placeholder, so it shows an explicit missing-avatar
   *  state instead. Substituting Bon here would tell a real employee they are looking at themselves. */
  avatarId: string | null;
  /** The Atlas employee id, or NULL when it could not be VERIFIED.
   *
   *  Null is the common case and is expected. getCurrentUserId() returns the literal "bon" both for the
   *  real Bon and for any /auth/me response whose id field this app did not recognise, and the dev
   *  bypass substitutes an email for it — so the value cannot distinguish "this is Bon" from "no idea
   *  who this is". Nothing in Phase 2 consumes it; it is carried only so later phases have a field to
   *  fill in once Atlas confirms the shape, and it is null rather than wrong until then. */
  employeeId: string | null;
  /** Where this identity came from, for the dev readout only. Never a permission or a trust signal. */
  source: "atlas" | "dev-bypass";
}
