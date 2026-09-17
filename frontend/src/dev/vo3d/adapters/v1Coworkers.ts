// vo3d adapter — READ-ONLY view of the coworkers V1's roster already lists. Phase 4A.
//
// PURE, and given its inputs rather than fetching them. Everything here is a transformation of values the
// React host (app/Vo3dHost.tsx) has already subscribed to through V1's own hooks — so this module opens no
// socket, issues no request, and cannot trigger apiFetch's 401 -> /login redirect, exactly like
// adapters/v1Identity.ts and adapters/v1HomeDesk.ts before it.
//
// WHY officePeopleToLayers AND NOT resolveHomeDesk. They answer different questions and only one of them
// is right here:
//   • data/homeSeat.ts resolveHomeDesk(email, dept) returns the seat nearest the room's door-in stand
//     point. It does not look at who else is in the room, so it hands EVERY person in Design the SAME
//     chair — its own comment says so. Used for coworkers it stacks a whole team on one seat.
//   • data/rosterLayers.ts officePeopleToLayers(people) is V1's actual roster seating: it dedupes by
//     normalized email, groups by room, sorts each room by email, gives out that room's real painted
//     chairs one per person, and packs the remainder into a per-room overflow grid. That is the
//     assignment V1 itself draws, so V2 reusing it means the two offices seat people identically rather
//     than plausibly.
//
// TOP-LEFT vs CENTROID. A layer's x/y is the sprite's TOP-LEFT and its width/height are THAT PERSON'S OWN
// box — rosterLayers gives a live-3D employee their own manifest dimensions rather than Bon's, because
// micah and angelo are deliberately taller for raised-arm headroom. So the centroid is computed from the
// layer's own width/height. adapters/v1Pathfinding.ts converts through bonLayer's halves and is a
// TESTS-ONLY oracle for precisely this reason; it must not be reached for here.
import { getCurrentUser } from "../../../auth/currentUserStore";
import { officePeopleToLayers } from "../../../data/rosterLayers";
import type { OfficePerson } from "../../../services/office/floorMerge";
import { hasCastLods } from "./v1Avatar";
import { FACING_BY_DIRECTION } from "./v1Facing";
import { EMPTY_COWORKER_SET, type Vo3dCoworker, type Vo3dCoworkerSet } from "../app/coworkers";

/** The join key every V1 feed already uses. */
export function emailKey(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * The signed-in employee's own email key, or "" when V1 could not parse an identity.
 *
 * Read here rather than carried on Vo3dIdentity on purpose: app/identity.ts's contract is the REDACTED
 * one (it deliberately carries no email, because that shape is rendered into the DOM readout), and the
 * self-exclusion below needs the address itself. It stays inside this adapter and is never returned.
 */
export function selfEmailKey(): string {
  return emailKey(getCurrentUser()?.email);
}

/**
 * Every coworker V2 may draw, from the roster V1 already has.
 *
 * `offlineEmails` is V1's OWN visibility predicate, computed by the caller and passed in — the caller is
 * the one that knows which mode it is in (services/presence/offlineLineupPlacement.ts exports both
 * halves: computeOfflineEmailSet for real Atlas presence, computeServerLineupEmailSet for mock, where
 * MockOfficeService's fixed status spread hard-codes Bon OFFLINE and is not a truthful signal). Passing
 * it in rather than deciding it here keeps this module pure and keeps the mode switch in exactly one
 * place, shared with V1's own placement.
 *
 * EXCLUDED, each for its own reason and none of them fabricated:
 *   • self — the viewer already has a body; a second one would be a duplicate of them, not a coworker.
 *   • anyone V1 counts as offline/checked-out — V1 moves them to its sidewalk lineup, which V2 has no
 *     equivalent of in this phase. Omitting them says nothing about them; drawing them at a desk would
 *     claim they are in the building.
 *   • anyone with no approved 3D character — counted in `missingAvatar`, never substituted with somebody
 *     else's body.
 */
export function resolveVo3dCoworkers(
  people: readonly OfficePerson[],
  offlineEmails: ReadonlySet<string>,
  selfEmail: string,
): Vo3dCoworkerSet {
  if (people.length === 0) return EMPTY_COWORKER_SET;

  const self = emailKey(selfEmail);
  const coworkers: Vo3dCoworker[] = [];
  const missingAvatar: string[] = [];

  // officePeopleToLayers already lowercases each layer id and collapses duplicate rows for one employee
  // whose emails differ only in case (Atlas produces those) — so no second dedupe is needed or wanted
  // here, and the id can be trusted as the key.
  for (const layer of officePeopleToLayers(people as OfficePerson[])) {
    const email = emailKey(layer.id);
    if (!email || email === self) continue;
    if (offlineEmails.has(email)) continue;

    const displayName = layer.name?.trim() || email.split("@")[0] || email;
    const avatarId = layer.avatarId ?? null;
    // Two different absences, one honest answer. `avatarId` is null for anyone V1 has no registry
    // mapping for; a NON-null id can still name a 2D-only sprite set with no consolidated GLB. V2 draws
    // nothing but GLBs, so hasCastLods is what tells the two apart — and asking castLods directly would
    // throw on the missing registry row and take the whole world down with it.
    if (!avatarId || !hasCastLods(avatarId)) {
      missingAvatar.push(displayName);
      continue;
    }

    coworkers.push({
      email,
      displayName,
      avatarId,
      // THEIR OWN BOX, never bonLayer's — see the header note.
      point: { x: layer.x + layer.width / 2, z: layer.y + layer.height / 2 },
      // A layer with no sitDirection is an overflow-grid occupant in a room with no default direction;
      // rosterLayers already falls back to "front" there, and so does this.
      facing: FACING_BY_DIRECTION[layer.sitDirection ?? "front"],
    });
  }

  // Sorted so the placement pass downstream is deterministic: it resolves collisions in iteration order,
  // and an upstream roster array is free to reorder itself between renders.
  coworkers.sort((a, b) => a.email.localeCompare(b.email));
  missingAvatar.sort((a, b) => a.localeCompare(b));
  return { coworkers, missingAvatar };
}
