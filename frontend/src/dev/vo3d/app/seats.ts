// vo3d app — THE SEAT CONTRACT, Phase 6C's counterpart to app/spawn.ts and app/selfMovement.ts.
//
// Same split, same reason: the V1 side (adapters/v1Seats.ts) reads V1's painted seats and V1's seat-key
// rule, while app/world.ts must stay loadable by the standalone dev page with no V1 module in its graph.
// What both sides name lives here, in a module that imports nothing but V2's own room data and its
// coordinate leaf.
//
// WHAT A SEAT ANCHOR IS. Every place a body can sit in the built V2 world, flattened to ONE entry per
// sittable spot with a stable string id:
//
//   a MOVABLE desk chair (Capabilities.seat)       →  id = the chair entity's id       e.g. "dev-room/bay-chair-n1"
//   one cushion of FIXED seating (Capabilities.lounge)  →  id = `${entityId}#${slot.id}`  e.g. "executive-room/sofa-west#seat-left"
//
// The id is what crosses the V1/V2 seam in BOTH directions — the sink publishes it, the position adapter
// resolves a peer's V1 seat back into it — and it is V2's own vocabulary: V1 never sees it. V1's own seat
// identity (data/emptySeats.ts seatCentroidKey) is a painted-chair centroid, and adapters/v1Seats.ts is
// the ONE place the two are joined.
//
// `point` is the anchor's position IN WORLD UNITS, before any room shift is undone — for a chair that is
// the chair's rest transform (the point V1 draws the same chair at), for a cushion the furniture's
// position plus the slot's authored local offset (every multi-cushion piece on the floor is built
// axis-aligned with its mirroring expressed in the authored offsets, and adapters/v1Seats' probe confirmed
// this lands within two units of V1's own sofa sub-seats). `yaw` is the body's seated rotation, the
// chair's own — never a universal sitting yaw.
import { designRoomEntities } from "../rooms/design-room";
import { receptionEntities } from "../rooms/reception";
import { meetingRoomEntities } from "../rooms/meeting";
import { projectRoomEntities } from "../rooms/project";
import { gamingRoomEntities } from "../rooms/gaming";
import { centralHubEntities } from "../rooms/central-hub";
import { executiveRoomEntities } from "../rooms/executive";
import { cmsRoomEntities } from "../rooms/cms";
import { aiRoomEntities } from "../rooms/ai";
import { devRoomEntities } from "../rooms/dev";
import { qaRoomEntities } from "../rooms/qa";
import type { Entity } from "../world/WorldState";
import type { Vec2 } from "../core/coords";
import seatFacingConfig from "../data/seatFacing.json";

/** The separator between a lounge entity id and its slot id. Entity ids are `${roomId}/${name}` and slot
 *  ids are plain words, so `#` is free in both. */
const SLOT_SEPARATOR = "#";

export type Vo3dSeatAnchor = {
  /** the anchor id — see the header */
  id: string;
  entityId: string;
  /** the lounge slot id, for a cushion; absent for a movable chair */
  slotId?: string;
  kind: "seat" | "lounge";
  /** world units — the chair's rest position, or the cushion's authored front waypoint */
  point: Vec2;
  /** the body's rotation while seated here, radians (core/coords FACING_YAW convention) */
  yaw: number;
  /** V1 provenance when the entity was derived from the production manifest (adapters/v1Manifest) */
  v1LayerId?: string;
};

export const seatAnchorId = (entityId: string, slotId?: string): string =>
  slotId === undefined ? entityId : `${entityId}${SLOT_SEPARATOR}${slotId}`;

/** The inverse of seatAnchorId. */
export function parseSeatAnchorId(id: string): { entityId: string; slotId?: string } {
  const i = id.indexOf(SLOT_SEPARATOR);
  return i < 0 ? { entityId: id } : { entityId: id.slice(0, i), slotId: id.slice(i + 1) };
}

/** Every anchor a set of entities offers, in entity order then slot order — deterministic, so two
 *  sessions enumerate the same list. */
export function collectSeatAnchors(entities: Iterable<Entity>): Vo3dSeatAnchor[] {
  const out: Vo3dSeatAnchor[] = [];
  for (const e of entities) {
    const seat = e.capabilities.seat;
    if (seat) {
      out.push({ id: seatAnchorId(e.id), entityId: e.id, kind: "seat", point: { ...e.transform.pos }, yaw: seat.seatedYaw, ...(e.source?.v1LayerId ? { v1LayerId: e.source.v1LayerId } : {}) });
    }
    const lounge = e.capabilities.lounge;
    if (lounge) {
      for (const slot of lounge.slots) {
        const point = { x: e.transform.pos.x + slot.contactLocal.x, z: e.transform.pos.z + slot.contactLocal.z };
        out.push({ id: seatAnchorId(e.id, slot.id), entityId: e.id, slotId: slot.id, kind: "lounge", point, yaw: slot.seatedYaw });
      }
    }
  }
  return out;
}

/** THE GROUND FLOOR'S ENTITIES, in the order app/world.ts registers them. One list, so the seat mapping
 *  (adapters/v1Seats.ts, resolved by the React host before any world exists) and the built world agree
 *  about which chairs there are. Pure data: every builder here is a plain function over authored constants. */
export function groundFloorEntities(): Entity[] {
  return [
    ...designRoomEntities(),
    ...receptionEntities(),
    ...meetingRoomEntities(),
    ...projectRoomEntities(),
    ...gamingRoomEntities(),
    ...centralHubEntities(),
    ...executiveRoomEntities(),
    ...cmsRoomEntities(),
    ...aiRoomEntities(),
    ...devRoomEntities(),
    ...qaRoomEntities(),
  ];
}

let anchorsMemo: Vo3dSeatAnchor[] | null = null;
/** Every sittable spot on the ground floor. Computed once — the builders are pure and the result is
 *  read from several places per session. */
export function groundFloorSeatAnchors(): Vo3dSeatAnchor[] {
  if (!anchorsMemo) anchorsMemo = collectSeatAnchors(groundFloorEntities());
  return anchorsMemo;
}

// ---- SEAT FACING — the configured direction a body faces in each seat ------------------------------
//
// Phase 6C's direction fix. The direction a sitter faces is CONFIGURATION, not geometry: V1 already keeps
// it that way (data/seatDirections.ts is a hand-curated table keyed by seat, in the four sprite words), and
// V2 now keeps the same kind of table keyed by seat anchor — data/seatFacing.json, checked into the
// project. Every anchor on the floor has an entry (seats.facing.test.ts enforces it). The seed was
// generated once: a mapped anchor took its V1 seat's own direction, a V2-only anchor took the compass word
// nearest its authored yaw; from then on the file is the authority and is edited by hand or through the
// dev tool (app/world.ts "Seat facing", which POSTs the whole table to the Vite dev server, which writes
// this file). Nothing here reads furniture rotation at runtime.
//
// THE FOUR WORDS ARE V1's, deliberately: "front" faces the camera (south), "back" north, "left" west,
// "right" east — one vocabulary for both offices, translated through the one table adapters/v1Facing owns.
//
// `seatedYawFor` is the ONE function every consumer of a seated yaw goes through — the local interaction's
// spec, the peer pose, the published yaw and the restore — so a change in the table reaches all of them.

export type SeatFacing = "front" | "back" | "left" | "right";
export const SEAT_FACINGS: readonly SeatFacing[] = ["front", "back", "left", "right"];
export const isSeatFacing = (v: unknown): v is SeatFacing => typeof v === "string" && (SEAT_FACINGS as readonly string[]).includes(v);

/** V1 word → the yaw whose BODY FORWARD points that way, measured, not looked up.
 *
 *  The avatar's forward is +z at yaw 0 (core/coords), and a rotation of θ about +y turns +z into
 *  (sin θ, 0, cos θ). So south (+z, V1 "front") is 0, north (−z, "back") is π, west (−x, "left") is −π/2 and
 *  east (+x, "right") is +π/2. core/coords FACING_YAW carries the OPPOSITE sign for east and west (its
 *  `west: π/2` faces +x); the rooms are authored against those labels-by-value and render correctly, so it
 *  is not touched here — but it must not be consulted for a seat facing either. Verified live on
 *  2026-09-19: a body configured "front" faces its desk with forward (0, +1), "back" with (0, −1), and the
 *  AI Room's west-facing member chair needs forward (−1, 0), which this table gives "left". Every entry in
 *  data/seatFacing.json is written in V1's meaning of the word; this is the only translation. */
export const SEAT_FACING_YAW: Readonly<Record<SeatFacing, number>> = { front: 0, back: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
export const seatFacingYaw = (f: SeatFacing): number => SEAT_FACING_YAW[f];

const configured: Record<string, SeatFacing> = {};
for (const [id, word] of Object.entries(seatFacingConfig as Record<string, string>)) if (isSeatFacing(word)) configured[id] = word;
/** Unsaved edits made through the dev tool this session. They win over the file until saved (which makes
 *  them the file) or the page reloads. */
const overrides = new Map<string, SeatFacing>();
const facingListeners = new Set<(id: string, facing: SeatFacing) => void>();

/** The configured facing of an anchor: an unsaved edit, else the project file, else null (unconfigured). */
export function seatFacingFor(anchorId: string): SeatFacing | null {
  return overrides.get(anchorId) ?? configured[anchorId] ?? null;
}

/** THE SEATED YAW every consumer uses: the configured facing's yaw, or the authored `seatedYaw` for an
 *  anchor the table does not know (a chair added after the file was last saved). */
export function seatedYawFor(anchorId: string, authoredYaw: number): number {
  const f = seatFacingFor(anchorId);
  return f ? seatFacingYaw(f) : authoredYaw;
}

/** Dev tool: change one anchor's facing for this session and tell the world so it can re-pose bodies. */
export function setSeatFacingOverride(anchorId: string, facing: SeatFacing): void {
  overrides.set(anchorId, facing);
  for (const l of facingListeners) l(anchorId, facing);
}
export function subscribeSeatFacing(listener: (id: string, facing: SeatFacing) => void): () => void {
  facingListeners.add(listener);
  return () => { facingListeners.delete(listener); };
}
/** How many edits are unsaved. */
export const unsavedSeatFacingCount = (): number => overrides.size;

/** The whole table as it should be saved: the file plus this session's edits, sorted by anchor id. */
export function seatFacingTable(): Record<string, SeatFacing> {
  const merged: Record<string, SeatFacing> = { ...configured };
  for (const [id, f] of overrides) merged[id] = f;
  return Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
}
/** After a successful save the edits ARE the file. */
export function markSeatFacingSaved(): void {
  for (const [id, f] of overrides) configured[id] = f;
  overrides.clear();
}
/** Test-only. */
export function __resetSeatFacingForTests(): void { overrides.clear(); facingListeners.clear(); }
