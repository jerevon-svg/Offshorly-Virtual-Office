// vo3d app — ROOM DETAILS: WHAT "WHO IS IN THIS ROOM" MEANS, as a pure function.
//
// The V1/V2 parity pass for V1's RoomSidebar (components/OfficeMap/RoomSidebar.tsx). Everything V1's panel
// derives, derived here once, so the V2 panel is a presentation of V1's answer rather than a second answer.
//
// THE DATA IS V1'S, ALL OF IT, AND NOTHING IS INVENTED.
//
//   room name      data/office-layout formatRoomName, over the MANIFEST room id the world's own region
//                  carries (app/interactions.ts onRoomSelected explains why that is the id).
//   occupants      services/office/useOfficeRoster's people — Atlas /floor merged with /presence and kept
//                  live by V1's own SSE stream. A person's `roomId` is the FLAT id (data/roomIdentity), so
//                  the manifest id is bridged to it through V1's own geometry (flatRoomIdForRoomLayer).
//   role           OfficePerson.jobTitle, straight off the Zoho row. Absent when Atlas has none — the row
//                  then simply has no role line. A department is NOT substituted for a missing job title.
//   project        THE ONLY project fact these services publish per person: when somebody is ONLINE in an
//                  Atlas PROJECT or CLIQ_CHANNEL room, that room has no hand-drawn twin
//                  (data/roomIdentity), so they are drawn at their desk and `inEphemeralRoom` is set. The
//                  room's NAME comes from V1's own roomNames map (officeService.listRooms). That is the
//                  same fact V1's sidebar renders as "in Design Sprint"; it is a live Zoho project or Cliq
//                  channel, and it is all there is. No task list, no assignment and no project membership
//                  is fetched, because no endpoint this app already calls answers "which projects belong
//                  to this room".
//   membership     data/office-layout roomMembersById — the hand-drawn manifest cast. V1's fallback for
//                  when there is no live roster at all (mock mode), and the fallback here too.
//
// WHAT IS DELIBERATELY NOT HERE: the V2 world's own idea of where a body is standing. V1's roster is the
// presence authority for both offices (a V2 walk publishes a position, not an Atlas room), and having the
// panel answer from the scene while V1's office answers from the roster is exactly the drift this is
// written to avoid.
import {
  flatRoomIdForRoomLayer,
  formatCharacterName,
  formatRoomName,
  roomMembersById,
} from "../../../data/office-layout";
import type { OfficePerson } from "../../../services/office/floorMerge";
import { mapAtlasToOfficeStatus, type OfficeStatus } from "../../../services/presence/status";
import { portraitSrcFor } from "../../../data/portraits";

/** One row of the panel. Every field is either a fact one of V1's feeds published or absent. */
export interface Vo3dRoomOccupant {
  /** Normalised email — the key every V1 feed joins on, and what an action is dispatched against. */
  email: string;
  displayName: string;
  /** V1's presence, already in the office vocabulary the nameplates and the action card use. */
  status: OfficeStatus;
  /** Zoho job title. Null when Atlas has none. */
  role: string | null;
  /** The live Atlas PROJECT / CLIQ_CHANNEL room they are in, by NAME, when they are in one that this
   *  office has no art for. Null otherwise — including for somebody in an ephemeral room whose name the
   *  rooms feed could not supply, which degrades to no chip rather than to a raw room id. */
  project: string | null;
  /** V1's free-text activity line ("In a meeting", "Heads down"), when Atlas published one. */
  activity: string | null;
  /** A real portrait (data/portraits) or null — the row then falls back to an initial, never to art
   *  belonging to somebody else. */
  portrait: string | null;
  /** True for the signed-in employee's own row. */
  isSelf: boolean;
}

/** What the panel shows, in one value, so the component branches on a state rather than on four booleans. */
export type Vo3dRoomDetails =
  | { kind: "loading"; roomName: string }
  /** V1's live roster answered. `occupants` may be empty — an empty room is an answer. */
  | { kind: "roster"; roomName: string; occupants: Vo3dRoomOccupant[] }
  /** No live roster (mock mode, or the roster failed): V1's own fallback to the hand-drawn cast, whose
   *  rows carry a name and nothing else, because the manifest knows nothing else about them. */
  | { kind: "manifest"; roomName: string; members: { id: string; name: string; path: string }[] }
  /** A room the roster CANNOT answer for: a manifest room with no flat twin. "central-hub" is the only
   *  one — the wall-less shared space has art but no flat rect, so no roster row can ever be keyed to it.
   *  Said plainly rather than rendered as a confident "nobody is here". */
  | { kind: "untracked"; roomName: string };

export interface ResolveRoomDetailsInput {
  /** The MANIFEST room layer id the world reported, or null when nothing is selected. */
  roomId: string | null;
  /** V1's roster. Empty while it is still loading, and empty in mock mode — `rosterActive` tells them
   *  apart, exactly as OfficeMap's own `rosterActive` does. */
  people: readonly OfficePerson[];
  /** Atlas room id -> display name (useOfficeRoster roomNames). Missing names degrade to no chip. */
  roomNames?: ReadonlyMap<string, string>;
  /** True while V1's first roster load is still in flight. */
  loading?: boolean;
  /** The signed-in employee's normalised email, for the "You" row. */
  selfEmail?: string;
}

const key = (email: string): string => email.trim().toLowerCase();

/** V1's own `rosterActive`: a roster exists once it has listed anybody. */
export function rosterActive(people: readonly OfficePerson[]): boolean {
  return people.length > 0;
}

export function resolveRoomDetails(input: ResolveRoomDetailsInput): Vo3dRoomDetails | null {
  const { roomId, people, roomNames, loading = false, selfEmail } = input;
  if (!roomId) return null;
  const roomName = formatRoomName(roomId);

  // LOADING BEFORE EVERYTHING ELSE: an empty roster that has not finished loading is not an empty room,
  // and the two must never look the same.
  if (loading && !rosterActive(people)) return { kind: "loading", roomName };

  if (!rosterActive(people)) {
    const members = (roomMembersById[roomId] ?? []).map((layer) => ({
      id: layer.id,
      name: formatCharacterName(layer),
      path: layer.path,
    }));
    return { kind: "manifest", roomName, members };
  }

  const flatRoomId = flatRoomIdForRoomLayer(roomId);
  if (!flatRoomId) return { kind: "untracked", roomName };

  const self = selfEmail ? key(selfEmail) : null;
  const occupants = people
    .filter((person) => person.roomId === flatRoomId)
    .map((person): Vo3dRoomOccupant => {
      const email = key(person.email);
      return {
        email,
        displayName: person.displayName?.trim() || email.split("@")[0] || email,
        status: mapAtlasToOfficeStatus(person.status),
        role: person.jobTitle?.trim() || null,
        project:
          person.inEphemeralRoom && person.atlasRoomId
            ? roomNames?.get(person.atlasRoomId)?.trim() || null
            : null,
        activity: person.currentActivity?.trim() || null,
        portrait: portraitSrcFor(person.email),
        isSelf: self !== null && email === self,
      };
    })
    // The viewer first, then alphabetically: a stable order the live feed cannot reshuffle under the
    // reader's cursor, and "you" where you expect to find yourself.
    .sort((a, b) =>
      a.isSelf === b.isSelf ? a.displayName.localeCompare(b.displayName) : a.isSelf ? -1 : 1,
    );

  return { kind: "roster", roomName, occupants };
}

/** The header's count line. V1's own two wordings, kept verbatim so the two offices read the same. */
export function roomSubtitle(details: Vo3dRoomDetails): string {
  switch (details.kind) {
    case "loading":
      return "Loading the room…";
    case "roster":
      return details.occupants.length === 1 ? "1 person in the room" : `${details.occupants.length} people in the room`;
    case "manifest":
      return details.members.length === 1 ? "1 seat" : `${details.members.length} seats`;
    case "untracked":
      return "Shared space";
  }
}

/** One hand-drawn cast row, for the manifest fallback's own rendering. */
export type ManifestMember = Extract<Vo3dRoomDetails, { kind: "manifest" }>["members"][number];
