// vo3d adapter — the PRODUCTION planner as a READ-ONLY reference oracle (tests only).
// Production works in a layer-top-left basis for bon's manifest box; we convert ground ↔ top-left.
import { classifyDestination, findPath } from "../../../data/officePathfinding";
import { bonLayer } from "../../../data/office-layout";
import type { Vec2 } from "../core/coords";

const HALF = { x: bonLayer.width / 2, y: bonLayer.height / 2 };
const toTopLeft = (g: Vec2) => ({ x: g.x - HALF.x, y: g.z - HALF.y });
const fromTopLeft = (p: { x: number; y: number }): Vec2 => ({ x: p.x + HALF.x, z: p.y + HALF.y });

export function v1Classify(from: Vec2, clicked: Vec2): { valid: boolean; cellCentre: Vec2 } {
  const r = classifyDestination(toTopLeft(from), { x: clicked.x, y: clicked.z });
  return { valid: r.valid, cellCentre: fromTopLeft(r.cellCenter) };
}
export function v1Path(from: Vec2, to: Vec2): Vec2[] {
  return findPath(toTopLeft(from), toTopLeft(to)).map(fromTopLeft);
}
