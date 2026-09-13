// vo3d player — THE ONE PLACE the player's "can I stand here?" question is answered, composed from the
// navigation data V2 already owns. Separated from PlayerBody so the body stays pure and this stays the
// only file that knows the shape of the world handles.
//
// AUTHORITY PER POINT, not per body. A body straddling a doorway has its centre in one regime and a rim
// sample in the other, so each sample asks whoever governs the cell IT lands in. That is what lets a
// player walk out of a derived room into the V1-governed hall without a seam at the wall plane.
import { worldToCell } from "../adapters/v1Grid";
import type { Vec2 } from "../core/coords";
import type { DerivedNav } from "../nav/derived";
import type { Walkability } from "../nav/Walkability";
import type { WorldState } from "../world/WorldState";
import type { StandTest } from "./PlayerBody";

/** rim samples, as unit offsets scaled by the body radius. Four is enough at a 16-unit cell pitch. */
const RIM: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export type StandTestDeps = {
  world: WorldState;
  walkability: Walkability;
  derived: DerivedNav;
  radius: number;
  /** V0 is INTERIOR ONLY: the sidewalk is a registered walkable region, and the player may not use it */
  allowExterior?: boolean;
};

export function makeStandTest({ world, walkability, derived, radius, allowExterior = false }: StandTestDeps): StandTest {
  return (p: Vec2): boolean => {
    // 1. is this office floor at all? Registered regions already encode "reconstructed room floor",
    //    "shared hall", "unreconstructed footprint (not walkable)" and "exterior sidewalk".
    const region = world.regionAt(p);
    if (!region || !region.walkable) return false;
    if (!allowExterior && region.kind === "exterior") return false;
    // 2. the body centre, judged by whoever governs its cell
    const c = worldToCell(p);
    if (derived.governs(c.cx, c.cy)) {
      if (derived.clearanceAtPoint(p) < radius) return false;
    } else if (!walkability.walkable(c.cx, c.cy)) return false;
    // 3. the rim. Inside a derived room the centre test already covered the full radius, so a rim sample
    //    only has to be OUT of a solid (asking for the whole radius again would double-count and shut
    //    every legal gap). Outside one, the rim is the only way an 8-unit body is represented at all in a
    //    16-unit grid.
    for (const [ox, oz] of RIM) {
      const q = { x: p.x + ox * radius, z: p.z + oz * radius };
      const qc = worldToCell(q);
      if (derived.governs(qc.cx, qc.cy)) {
        if (derived.clearanceAtPoint(q) <= 0) return false;
      } else if (!walkability.walkable(qc.cx, qc.cy)) return false;
    }
    return true;
  };
}
