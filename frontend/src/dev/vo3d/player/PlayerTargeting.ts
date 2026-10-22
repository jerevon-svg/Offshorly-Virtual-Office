// vo3d player — WHAT AM I LOOKING AT? The generic interaction-targeting seam for PLAYER mode.
//
// Pure logic, no THREE, no raycast, NO PER-FRAME SCENE TRAVERSAL. Candidates are harvested from
// WorldState ONCE and bucketed by room; a frame then scores only the interactables in the room the player
// is standing in, which is a handful even in the Central Hub (24 café chairs + a counter + a shelf + a
// monument). Standing in the hall targets nothing, which is correct: every V2 interactable lives in a room.
//
// SCORING is a facing cone, not a screen-space pick. A crosshair ray would need the scene; "the thing I am
// closest to and most directly facing" needs two dot products and is what a player actually means. The
// cone widens as you get closer (you can sit on the chair you are standing on top of without aiming at it)
// and the winner is the smallest angle, with distance breaking ties.
//
// IT DOES NOT ACTIVATE ANYTHING. It returns an entity id; the app hands that to the SAME starters the GUI
// and click-to-walk already call. That is the whole point — PLAYER proves it can invoke V2's interactions,
// it does not own a second copy of them.
import type { Vec2 } from "../core/coords";
import type { EntityId, WorldState } from "../world/WorldState";

/** PHASE 6D adds "person": a COWORKER, targeted exactly like a chair is. It is the one kind whose
 *  candidates are not static — people walk — so they are supplied per frame rather than harvested once
 *  (see PlayerDeps.dynamicCandidates), and the one kind whose activation does not move this body: it
 *  opens the interaction menu, which is the host's business. */
/** "ride" — a docked shared e-scooter (world/scooters): activated like a person, without handing the avatar away */
export type InteractKind = "seat" | "lounge" | "approach" | "person" | "ride";
/** INTERACTION V2 — `anchors` are WHERE YOU STAND to use the thing (a seat's stand cell, a cushion's, a fixture's
 *  walk-up point). Reach is measured to the nearer of the object and its anchors, so standing at a chair's own
 *  stand cell always reaches it; the facing test is still made against the object, which is what a player aims at. */
export type Candidate = { id: EntityId; kind: InteractKind; pos: Vec2; label: string; roomId: string; anchors?: readonly Vec2[] };
export type Target = Candidate & { distance: number };

/** how far a player can reach an interactable, in world units (Bon is 36 tall; a desk is 24 deep) */
export const REACH = 62;
/** INTERACTION V2 — THE FACING CONE. Half-angle at full reach, widening only to FACING_MAX up close: nothing
 *  beside-and-behind you is ever the target (the café chair picked with your back to it was the old cone
 *  opening to a full 180° inside 20 units). */
const CONE = 0.7;
export const FACING_MAX = 1.4;
/** point-blank: a body standing ON the thing needs no aim (the footprints overlap) */
const ON_TOP = 9;
/** A WALK-UP FIXTURE (the lift's call plate, the Cave's exit, a kiosk) is a place, not an aim: standing within
 *  this of its anchor offers it whichever way you face — and it outranks the people standing round it there. */
export const FIXTURE_ZONE = 20;
const FIXTURE_PRIORITY = 0.5;
/** how much further a target's score must lose by before the selection moves off it (radians-equivalent) —
 *  the hysteresis that stops two chairs side by side flickering as the body sways */
const STICKY = 0.18;
/** distance's share of the score: one full reach costs this much angle */
const DISTANCE_WEIGHT = 0.35;

/** INTERACTION V2 — WHAT THE PROMPT SAYS. Never an asset id: a person reads "[E] Sit on chair", not
 *  "[E] Sit — cafe-chair-1-south". A walk-up fixture's own authored verb ("Grab a coffee", "Call the elevator"). */
export const friendlyLabel = (kind: InteractKind, opts: { workstation?: boolean; action?: string; label?: string } = {}): string =>
  kind === "seat" ? (opts.workstation ? "Sit at desk" : "Sit on chair")
  : kind === "lounge" ? "Sit down"
  : kind === "approach" ? (opts.action && !/^[a-z]+(-[a-z]+)+$/.test(opts.action) ? opts.action : opts.label ?? "Use")
  : opts.label ?? "Interact";

/** PHASE 6D — the entity-id namespace a coworker candidate occupies. It is NOT a world entity (nobody
 *  registered a person in WorldState and nobody should) — it is an address the activation bridge can
 *  route on, and `coworkerEmailOf` is its one reader. */
export const PERSON_ID_PREFIX = "person/";
export const personCandidateId = (email: string): EntityId => `${PERSON_ID_PREFIX}${email}`;
export const coworkerEmailOf = (id: EntityId): string | null =>
  id.startsWith(PERSON_ID_PREFIX) ? id.slice(PERSON_ID_PREFIX.length) : null;

/** Harvest every interactable the world declares, bucketed by room. Call once: entities are static. */
export function collectCandidates(world: WorldState): Map<string, Candidate[]> {
  const byRoom = new Map<string, Candidate[]>();
  const push = (c: Candidate): void => {
    const list = byRoom.get(c.roomId);
    if (list) list.push(c);
    else byRoom.set(c.roomId, [c]);
  };
  for (const e of world.entities.values()) {
    const { approach, seat, lounge } = e.capabilities;
    const pos = { x: e.transform.pos.x, z: e.transform.pos.z };
    // an entity may carry more than one; a seat is the more specific verb, so it wins the slot
    if (seat) push({ id: e.id, kind: "seat", pos, label: friendlyLabel("seat", { workstation: seat.workstation }), roomId: e.roomId, anchors: [seat.approach] });
    else if (lounge) push({ id: e.id, kind: "lounge", pos, label: friendlyLabel("lounge"), roomId: e.roomId, anchors: lounge.slots.map((sl) => sl.approach) });
    else if (approach) push({ id: e.id, kind: "approach", pos, label: friendlyLabel("approach", approach), roomId: e.roomId, anchors: [approach.point] });
  }
  return byRoom;
}

export type PickOptions = {
  /** the target held last frame: kept until something beats it by STICKY, or it stops being eligible */
  current?: EntityId | null;
  /** LINE OF SIGHT between the body and a candidate (walls, closed barriers). Absent = always clear. */
  sight?: (from: Vec2, to: Vec2) => boolean;
};

const nearestOf = (p: Vec2, c: Candidate): number => {
  let d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
  if (c.anchors) for (const a of c.anchors) d = Math.min(d, Math.hypot(a.x - p.x, a.z - p.z));
  return d;
};
const inFixtureZone = (p: Vec2, c: Candidate): boolean =>
  c.kind === "approach" && (c.anchors ?? []).some((a) => Math.hypot(a.x - p.x, a.z - p.z) <= FIXTURE_ZONE);

/** EVERY ELIGIBLE TARGET with its score (lower is better), best first. Eligible = within reach, inside the facing
 *  cone (or point-blank, or inside a fixture's stand zone), and in sight. */
export function rankTargets(candidates: readonly Candidate[], p: Vec2, forward: Vec2, sight?: PickOptions["sight"]): (Target & { score: number })[] {
  const out: (Target & { score: number })[] = [];
  for (const c of candidates) {
    const d = nearestOf(p, c);
    if (d > REACH) continue;
    const dx = c.pos.x - p.x, dz = c.pos.z - p.z;
    const toObj = Math.hypot(dx, dz);
    const angle = toObj < 1e-4 ? 0 : Math.acos(Math.max(-1, Math.min(1, (dx * forward.x + dz * forward.z) / toObj)));
    const zone = inFixtureZone(p, c);
    const allowed = d <= ON_TOP || zone ? Math.PI : CONE + (1 - d / REACH) * (FACING_MAX - CONE);
    if (angle > allowed) continue;
    if (sight && toObj > ON_TOP && !sight(p, c.pos)) continue;
    // aim first, distance second; a fixture you are standing at outranks the people standing round it
    const score = Math.min(angle, FACING_MAX) + DISTANCE_WEIGHT * (d / REACH) - (zone ? FIXTURE_PRIORITY : 0);
    out.push({ ...c, distance: d, score });
  }
  return out.sort((a, b) => a.score - b.score);
}

/** The best interactable for a player at `p` facing `forward` (a unit ground vector), or null. With
 *  `current`, the held target survives a near-tie (STICKY) so the selection does not flicker. */
export function pickTarget(candidates: readonly Candidate[], p: Vec2, forward: Vec2, opts: PickOptions = {}): Target | null {
  const ranked = rankTargets(candidates, p, forward, opts.sight);
  if (ranked.length === 0) return null;
  const best = ranked[0];
  if (opts.current && opts.current !== best.id) {
    const held = ranked.find((t) => t.id === opts.current);
    if (held && held.score <= best.score + STICKY) return strip(held);
  }
  return strip(best);
}
const strip = (t: Target & { score: number }): Target => { const { score: _s, ...rest } = t; void _s; return rest; };

/** THE NEXT ELIGIBLE TARGET after `current`, in score order (Tab in a crowded spot), or null when there is
 *  only one. Wraps. */
export function cycleTarget(candidates: readonly Candidate[], p: Vec2, forward: Vec2, current: EntityId | null, sight?: PickOptions["sight"]): Target | null {
  const ranked = rankTargets(candidates, p, forward, sight);
  if (ranked.length < 2) return null;
  const i = ranked.findIndex((t) => t.id === current);
  return strip(ranked[(i + 1) % ranked.length]);
}

/** JUST OUT OF REACH: the nearest walk-up fixture you are facing within `range` but cannot use from here — what the
 *  HUD names ("Walk to the marker…") and marks on the floor. Null when one is in reach or none is ahead. */
export function nearbyFixture(fixtures: readonly Candidate[], p: Vec2, forward: Vec2, range: number, sight?: PickOptions["sight"]): Target | null {
  let best: Target | null = null;
  for (const c of fixtures) {
    if (c.kind !== "approach" || !c.anchors?.length) continue;
    const a = c.anchors[0];
    const d = Math.hypot(a.x - p.x, a.z - p.z);
    if (d <= FIXTURE_ZONE || d > range) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, ((c.pos.x - p.x) * forward.x + (c.pos.z - p.z) * forward.z) / Math.max(1e-4, Math.hypot(c.pos.x - p.x, c.pos.z - p.z)))));
    if (ang > 0.9) continue;
    if (sight && !sight(p, a)) continue;
    if (!best || d < best.distance) best = { ...c, distance: d };
  }
  return best;
}
