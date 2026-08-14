// Canonical email -> sprite-id registry (Layer D of the identity join).
//
// This is the committed, single source of truth avatarIdentity.ts reads
// from. It exists as its own file (rather than an inline object inside
// avatarIdentity.ts) so it can eventually be swapped for a real Atlas field
// (e.g. office_avatar_id) with a one-file diff and no call-site changes —
// see avatarIdentity.ts's module comment for the full migration story.
//
// Keys MUST be lowercase; avatarIdentity.ts lowercases the incoming address
// before looking it up here, since email localparts are not reliably
// case-consistent between systems.
export const EMAIL_TO_AVATAR_ID: Record<string, string> = {
  // Bon's real Zoho/Atlas email localpart ("jerevon") does not match his
  // sprite id ("bon"), unlike micah/alex whose localparts already match by
  // convention and need no entry here.
  "jerevon@offshorly.com": "bon",
  // Lui's real Atlas login email ("louiejie") does not match his sprite id
  // ("lui") by the localpart convention, so it needs an explicit entry here.
  "louiejie@offshorly.com": "lui",
};
