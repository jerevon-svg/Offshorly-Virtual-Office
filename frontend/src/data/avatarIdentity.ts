import { EMAIL_TO_AVATAR_ID } from "./avatarRegistry";
import { SPRITE_SET_BY_AVATAR_ID } from "./bonWalkFrames";

// The identity join: Atlas keys every person by EMAIL; this app's canvas
// keys every sprite by a hand-authored layer id ("bon", "alex", ...).
// Something has to bridge the two, and this file is deliberately the only
// place that does — so replacing the mechanism later is a one-file change
// with no call sites to chase.
//
// The intended end state is a field on Atlas's user record (e.g.
// office_avatar_id) served straight from the API, at which point
// avatarIdForPerson() collapses into "read person.office_avatar_id, fall
// back to null". Until that migration exists, the mapping lives in
// avatarRegistry.ts (the committed Layer D registry). This WILL drift as
// people join and leave — that is the known cost of the interim.

// Legacy "everyone with no mapping renders as Bon" sprite. Kept ONLY as the
// pre-identity/loading-state default (see data/currentUser.ts's
// CURRENT_USER_ID) — it must NOT be returned by avatarIdForEmail below for
// an unmapped person anymore. A real unmapped person has no character yet;
// masking them as Bon was the bug this file used to have. Callers that need
// a "no match" answer get `null` instead and are expected to render the
// faceless placeholder (see services/avatar/placeholder.ts).
export const FALLBACK_AVATAR_ID = "bon";

// Domain used to synthesize mock emails and to read the localpart
// convention below.
const OFFICE_EMAIL_DOMAIN = "offshorly.com";

// Deliberately NOT all 20 office-assets-manifest characterLayers ids — 16 of
// those are hardcoded Figma stock-art decoration with no animated sprite set
// (e.g. "nicole", "arisha"), not real pipeline-generated avatars. Only ids
// with an actual AvatarSpriteSet (bon/alex/micah/lui) count as "known" here,
// so a real Atlas employee whose email localpart happens to collide with a
// decorative name (e.g. nicole@offshorly.com) correctly falls through to
// `null` -> the faceless placeholder, instead of rendering that decoration's
// flat stock PNG as if it were their avatar.
const KNOWN_AVATAR_IDS = new Set(Object.keys(SPRITE_SET_BY_AVATAR_ID));

export function isKnownAvatarId(candidate: string): boolean {
  return KNOWN_AVATAR_IDS.has(candidate);
}

// Inverse of the localpart convention, used by MockOfficeService so mock
// people flow through the same join real people do.
export function mockEmailForAvatarId(avatarId: string): string {
  return `${avatarId}@${OFFICE_EMAIL_DOMAIN}`;
}

// Resolves an Atlas person to a sprite id, or null when nobody in
// avatarRegistry.ts (nor the localpart convention) matches — a distinct,
// honest "no character" signal rather than silently defaulting to a real
// person's id. Accepts anything carrying an email — Presence, FloorPerson,
// MapPerson, PersonCard and AtlasUser all satisfy this shape under
// different field names, so callers pass the address itself rather than
// the record.
export function avatarIdForEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();

  const override = EMAIL_TO_AVATAR_ID[normalized];
  if (override && isKnownAvatarId(override)) return override;

  // Convention fallback: bon@offshorly.com -> "bon". Only honoured when it
  // names a sprite that actually exists, so a new hire whose localpart
  // happens to collide with nothing simply gets `null` instead of a broken
  // image.
  const localpart = normalized.split("@")[0];
  if (localpart && isKnownAvatarId(localpart)) return localpart;

  return null;
}

// Convenience wrapper for the record shapes the office API returns.
export function avatarIdForPerson(
  person: { user_email: string } | { email: string },
): string | null {
  const email = "user_email" in person ? person.user_email : person.email;
  return avatarIdForEmail(email);
}
