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
export type InteractKind = "seat" | "lounge" | "approach" | "person";
export type Candidate = { id: EntityId; kind: InteractKind; pos: Vec2; label: string; roomId: string };
export type Target = Candidate & { distance: number };

/** how far a player can reach an interactable, in world units (Bon is 36 tall; a desk is 24 deep) */
export const REACH = 62;
/** half-angle of the facing cone at full reach, in radians. Widens to PI as distance → 0. */
const CONE = 0.7;
const CLOSE_ENOUGH = 20;

const labelFor = (id: EntityId, kind: InteractKind, fallback?: string): string =>
  fallback ?? `${kind === "approach" ? "Use" : "Sit"} — ${id.split("/").slice(1).join("/") || id}`;

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
    if (seat) push({ id: e.id, kind: "seat", pos, label: labelFor(e.id, "seat"), roomId: e.roomId });
    else if (lounge) push({ id: e.id, kind: "lounge", pos, label: labelFor(e.id, "lounge"), roomId: e.roomId });
    else if (approach) push({ id: e.id, kind: "approach", pos, label: labelFor(e.id, "approach", approach.label), roomId: e.roomId });
  }
  return byRoom;
}

/** The best interactable for a player at `p` facing `forward` (a unit ground vector), or null. */
export function pickTarget(candidates: readonly Candidate[], p: Vec2, forward: Vec2): Target | null {
  let best: Target | null = null;
  let bestAngle = Infinity;
  for (const c of candidates) {
    const dx = c.pos.x - p.x, dz = c.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > REACH) continue;
    // dead-on close: no aiming required
    const angle = d < 1e-4 ? 0 : Math.acos(Math.max(-1, Math.min(1, (dx * forward.x + dz * forward.z) / d)));
    const allowed = d <= CLOSE_ENOUGH ? Math.PI : CONE + (1 - d / REACH) * (Math.PI - CONE) * 0.5;
    if (angle > allowed) continue;
    // smallest angle wins; within a degree of each other, the nearer one does
    if (angle < bestAngle - 0.02 || (Math.abs(angle - bestAngle) <= 0.02 && best !== null && d < best.distance)) {
      best = { ...c, distance: d };
      bestAngle = angle;
    }
  }
  return best;
}
