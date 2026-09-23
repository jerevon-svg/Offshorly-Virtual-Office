// vo3d nav — architectural clearance layer. The V1 grid is authored at 16-unit cells and its door bands are
// generous; real jambs, fixed panes and a parked leaf are narrower than that. A cell is clear when a body of
// `bodyRadius` standing on its centre overlaps none of the registered solids. Static: composed into the static
// layer (composeStatic) next to the V1 grid and the world regions; dynamic footprints/reservations stay separate.
import { cellCentre } from "../adapters/v1Grid";
import { circleOverlapsRect, pointInRect, type Rect } from "../core/coords";
import type { CellPredicate } from "./pathfind";
import type { WorldState } from "../world/WorldState";

export type Clearance = { band: Rect; solids: Rect[]; bodyRadius: number };

/** THE HARD PHYSICAL RADIUS. Bon's skinned bounding box measures 19.6 × 16.9 units walking, so 10.5 covers
 *  his widest extent including arm swing. This is the number architecture is judged against — door jambs,
 *  gate pedestals, a parked leaf — where clipping a wall is never acceptable. Until 7B it was copy-pasted
 *  into four files; this is now its only definition. */
export const BODY_RADIUS = 10.5;

/** THE ROUTING RADIUS. Threading furniture is not the same problem as clearing a door jamb: 10.5 is the
 *  avatar's widest SWEPT extent (arms out, mid-stride), while the volume that actually has to fit between a
 *  café chair and a table is the torso. Routing at the swept extent shuts lanes a body plainly walks down.
 *
 *  CHOSEN FROM MEASUREMENT ACROSS ALL SIX DERIVED ROOMS — derived-nav.test.ts sweeps the candidates and
 *  pins the result. Cells are "walkable / of those, connected to the hall":
 *
 *    radius  connected  worst café   design    reception   meeting   project    gaming    central hub
 *      6.0     3597        43.1     174/187    872/872    257/257   218/220   240/240    424/481
 *      7.0     3479        45.6     156/162    836/860    244/244   218/220   215/215    398/470
 *      8.0     3430        45.6     136/150    827/847    238/238   218/220   213/213    386/455   ← here
 *      8.5     3355        48.1     137/143    822/838    238/238   193/199   186/198    367/437
 *      9.0     3287        48.1     127/139    784/798    238/238   193/199   185/197    347/409
 *     10.5     3099        77.7      95/118    742/750    221/221   180/186   131/160    316/387
 *
 *  7B chose 8.5 on two rooms. The full six overrule it: at 8.5 the Gaming Room's east nook throat shuts and
 *  takes the arcade-print walk-up point with it — an interaction the room has shipped since 5C — and the
 *  Project Room loses its south lounge lane. The binding constraint is that nook, measured to close between
 *  8.3 and 8.4, so 8.3 is literally the largest value that works and is exactly why it is NOT the choice:
 *  it sits one tenth of a unit from a cliff, and any furniture nudge would silently seal a room.
 *
 *  8 is the largest ROUND value with real margin below that constraint, and it dominates 8.5 everywhere —
 *  more connected floor in all six rooms, and a better worst-case café approach. Bon stands 36 units for
 *  roughly 1.75 m, so 8 is a 16-unit (≈0.78 m) routing corridor: wider than a real shoulder span at that
 *  scale, and still well inside the swept extent BODY_RADIUS keeps for door jambs. */
export const NAV_RADIUS = 8;

/** every clearance the world's entities declare: moving architecture (door capabilities) and static
 *  architecture the V1 grid resolves too coarsely (gate pedestals, bollards — `clearance` capability). */
export function worldClearances(world: WorldState): Clearance[] {
  const out: Clearance[] = [];
  for (const e of world.entities.values()) {
    if (e.capabilities.door) out.push(e.capabilities.door.clearance);
    if (e.capabilities.clearance) out.push(e.capabilities.clearance);
  }
  return out;
}

export function clearanceLayer(clearances: readonly Clearance[]): CellPredicate {
  return (cx, cy) => {
    const c = cellCentre({ cx, cy });
    for (const cl of clearances) { if (!pointInRect(c, cl.band)) continue; for (const s of cl.solids) if (circleOverlapsRect(c, cl.bodyRadius, s)) return false; }
    return true;
  };
}
