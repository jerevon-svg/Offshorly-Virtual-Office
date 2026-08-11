import { rooms, teamRooms } from "./office-layout";

// The room join, and the counterpart to avatarIdentity.ts. Same rule: this
// is the ONLY place that translates between Atlas's room namespace and this
// app's hand-drawn one.
//
// The two namespaces are not the same kind of thing, which is why a plain
// id-to-id table would not work:
//
//   Atlas TEAM / CUSTOM  — stable, seeded once, carry a persisted layout
//   Atlas PROJECT / CLIQ_CHANNEL — EPHEMERAL. They exist only while occupied
//     or recently active, and Atlas itself ignores their stored position and
//     repacks them every render (frontend/src/app/(dashboard)/office/
//     office-channel-layout.ts). There is one per Zoho project and one per
//     Cliq channel, so the set is unbounded and changes without warning.
//
// This app has exactly ten hand-drawn rooms. Ten pieces of art cannot track
// an unbounded set, so we map only the stable species onto the canvas and
// surface the ephemeral ones in the room sidebar instead. See the rollout
// plan (Option C).

// Atlas seeds one TEAM room per distinct ZohoEmployee.department_name, and
// uses that department NAME as the room's source_ref (there is no stable
// Zoho department id on the employee record). So the reliable join key for
// a desk is the department name — which every /floor row already carries —
// not the generated room id.
//
// Keys are normalized by normalizeDepartmentKey() below, so write them in
// whatever case; matching is case- and separator-insensitive.
// Taken from the live data: SELECT DISTINCT department_name FROM
// zoho_employees WHERE employment_status = 'ACTIVE'. As it turns out NONE
// of the real names slugify onto a room id on their own ("AI Team" ->
// "ai-team", not "ai-room"; "Dev" -> "dev", not "dev-team"), so every row
// below is load-bearing — without them all 65 employees fall through to
// FALLBACK_ROOM_ID and the office renders as one crowd in reception.
const DEPARTMENT_TO_ROOM_ID: Record<string, string> = {
  "ai-team": "ai-room",
  dev: "dev-team",
  cms: "cms-team",
  design: "design-team",
  management: "executive-team",
  // Judgment calls, not confirmed with anyone — the remaining departments
  // have no obviously matching hand-drawn room:
  //   Product Excellence -> QA, on the assumption it is the QA function.
  //   Operations -> reception, as the front-of-house/admin function.
  // "External" is deliberately absent: contractors and client-side people
  // aren't part of a department room, so they take the reception fallback
  // by default rather than being asserted into a team they don't belong to.
  "product-excellence-team": "qa-room",
  operations: "reception-room",
};

// Atlas CUSTOM rooms are admin-created (lobby, focus, social). A handful may
// genuinely correspond to a hand-drawn space; those go here, keyed by Atlas
// room id. Everything not listed is treated as having no canvas twin.
const ATLAS_ROOM_ID_TO_ROOM_ID: Record<string, string> = {};

const KNOWN_ROOM_IDS = new Set(rooms.map((room) => room.id));
const TEAM_ROOM_IDS = new Set(teamRooms.map((room) => room.id));

// Where people land when nothing else resolves. Reception is the shared
// entry space — a real room on the canvas, so an unmapped person is visible
// and clickable rather than silently dropped from the floor.
export const FALLBACK_ROOM_ID = "reception-room";

export function isKnownRoomId(candidate: string): boolean {
  return KNOWN_ROOM_IDS.has(candidate);
}

export function isTeamRoomId(candidate: string): boolean {
  return TEAM_ROOM_IDS.has(candidate);
}

// "Dev Team" / "dev team" / "DEV_TEAM" -> "dev-team", which is already the
// id convention this app's rooms use. Lets most departments resolve with no
// table entry at all, the same trick avatarIdentity.ts plays with email
// localparts.
export function normalizeDepartmentKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// A person's home desk: the hand-drawn room for their Zoho department.
// Returns null (not the fallback) when nothing matches, so callers can tell
// "no department" apart from "department we deliberately place in
// reception" and decide for themselves.
export function roomIdForDepartment(
  departmentName: string | null | undefined,
): string | null {
  if (!departmentName) return null;
  const key = normalizeDepartmentKey(departmentName);
  if (!key) return null;

  const override = DEPARTMENT_TO_ROOM_ID[key];
  if (override && isKnownRoomId(override)) return override;

  if (isKnownRoomId(key)) return key;

  return null;
}

// Explicit per-person overrides, checked before the department table above.
// This exists for the same reason EMAIL_TO_AVATAR_ID exists in
// avatarIdentity.ts: a handful of real people need to land in a specific
// hand-drawn room regardless of what their department string says (or even
// when there is no department string at all, e.g. mock data). Add a row
// here whenever a person's home room should be pinned by email.
//
// Keys MUST be lowercase; lookups lowercase the incoming address, matching
// the convention in avatarIdentity.ts.
const EMAIL_TO_ROOM_ID: Record<string, string> = {
  "jerevon@offshorly.com": "design-team",
  "micah@offshorly.com": "design-team",
  "lui@offshorly.com": "dev-team",
  "alex@offshorly.com": "executive-team",
};

// A person's home desk, with the per-person override applied first. Falls
// back to roomIdForDepartment() when the person has no override, so this is
// a strict superset of that function's behavior — safe to call in any spot
// that currently calls roomIdForDepartment() and also has an email on hand.
export function roomIdForPerson(
  email: string | null | undefined,
  departmentName: string | null | undefined,
): string | null {
  if (email) {
    const override = EMAIL_TO_ROOM_ID[email.trim().toLowerCase()];
    if (override && isKnownRoomId(override)) return override;
  }
  return roomIdForDepartment(departmentName);
}

// An Atlas room id -> hand-drawn room, for the CUSTOM rooms that have a
// twin. Null means "this room does not exist on the canvas", which is the
// correct answer for every PROJECT and CLIQ_CHANNEL room.
export function roomIdForAtlasRoom(
  atlasRoomId: string | null | undefined,
): string | null {
  if (!atlasRoomId) return null;
  const mapped = ATLAS_ROOM_ID_TO_ROOM_ID[atlasRoomId];
  return mapped && isKnownRoomId(mapped) ? mapped : null;
}

// PROJECT and CLIQ_CHANNEL rooms are the ephemeral species — they belong in
// the sidebar list, never on the canvas.
export function isEphemeralRoomType(roomType: string): boolean {
  return roomType === "PROJECT" || roomType === "CLIQ_CHANNEL";
}
