import { characterLayers } from "./office-layout";

// The identity join: Atlas keys every person by EMAIL; this app's canvas
// keys every sprite by a hand-authored layer id ("bon", "alex", ...).
// Something has to bridge the two, and this file is deliberately the only
// place that does — so replacing the mechanism later is a one-file change
// with no call sites to chase.
//
// The intended end state is a field on Atlas's user record (e.g.
// office_avatar_id) served straight from the API, at which point
// avatarIdForPerson() collapses into "read person.office_avatar_id, fall
// back to FALLBACK_AVATAR_ID". Until that migration exists, the mapping
// lives here. This WILL drift as people join and leave — that is the known
// cost of the interim, and the fallback below is what keeps drift from
// being a crash.

// Sprite shown for anyone with no mapping. Must be a real character layer,
// so an unmapped person renders as a generic body rather than a blank.
export const FALLBACK_AVATAR_ID = "bon";

// Domain used to synthesize mock emails and to read the localpart
// convention below.
const OFFICE_EMAIL_DOMAIN = "offshorly.com";

// Explicit overrides, checked first. Add a row here whenever someone's
// email localpart is not simply their sprite id — that is the only case
// this table needs to cover, because of the localpart fallback below.
//
// Keys MUST be lowercase; lookups lowercase the incoming address, since
// email localparts are not reliably case-consistent between systems.
const EMAIL_TO_AVATAR_ID: Record<string, string> = {
  // "jan.michael@offshorly.com": "bon",
};

const KNOWN_AVATAR_IDS = new Set(characterLayers.map((layer) => layer.id));

export function isKnownAvatarId(candidate: string): boolean {
  return KNOWN_AVATAR_IDS.has(candidate);
}

// Inverse of the localpart convention, used by MockOfficeService so mock
// people flow through the same join real people do.
export function mockEmailForAvatarId(avatarId: string): string {
  return `${avatarId}@${OFFICE_EMAIL_DOMAIN}`;
}

// Resolves an Atlas person to a sprite. Accepts anything carrying an email
// — Presence, FloorPerson, MapPerson, PersonCard and AtlasUser all satisfy
// this shape under different field names, so callers pass the address
// itself rather than the record.
export function avatarIdForEmail(email: string | null | undefined): string {
  if (!email) return FALLBACK_AVATAR_ID;
  const normalized = email.trim().toLowerCase();

  const override = EMAIL_TO_AVATAR_ID[normalized];
  if (override && isKnownAvatarId(override)) return override;

  // Convention fallback: bon@offshorly.com -> "bon". Only honoured when it
  // names a sprite that actually exists, so a new hire whose localpart
  // happens to collide with nothing simply gets the fallback body instead
  // of a broken image.
  const localpart = normalized.split("@")[0];
  if (localpart && isKnownAvatarId(localpart)) return localpart;

  return FALLBACK_AVATAR_ID;
}

// Convenience wrapper for the record shapes the office API returns.
export function avatarIdForPerson(person: { user_email: string } | { email: string }): string {
  const email = "user_email" in person ? person.user_email : person.email;
  return avatarIdForEmail(email);
}
