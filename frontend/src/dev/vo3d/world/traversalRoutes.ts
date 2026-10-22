// vo3d world — TRAVERSAL ROUTES (PARKOUR V3): ladders, climb routes and ziplines, declared as WORLD DATA.
//
// A route is a line the body's FEET follow, end to end, at its own pace — never a jump between its endpoints. Each
// route says what it is (`kind`, which picks the articulated pose and the pace), where it may be entered (its ends,
// within `enterRadius`, at the end's own height), which ways it runs (`twoWay`), where it lets go (its last point —
// an ordinary stand point the tests prove), and the place it belongs to (the server checks it against where the
// employee is). Environments DECLARE their routes (world/ailabV2 LAB_ROUTES today); the player (player/PlayerMode),
// every peer (world/Coworkers) and the server's route table read the same records, so a route can be added to a
// future floor or the campus without touching the movement code.
//
// PURE: no THREE, no scene.
import type { Vec2 } from "../core/coords";

export type RouteKind = "ladder" | "zipline";
export type RoutePoint = { x: number; y: number; z: number };
/** "a" = from the path's first point to its last; "b" = the reverse (two-way routes only) */
export type RouteDir = "a" | "b";

export type TraversalRoute = {
  id: string;
  kind: RouteKind;
  /** the place it belongs to (the place id the movement feed publishes there) */
  place: string;
  /** THE FEET'S LINE from end A to end B, absolute y: [stand at A, …the climb or the ride…, stand at B] */
  path: readonly RoutePoint[];
  twoWay: boolean;
  /** a ladder's facing (headingFor convention: toward the rungs) — a zipline faces along its line */
  facing?: number;
  /** pace along the path, units/s (a ladder's climb; a zipline's mean speed) */
  speed: number;
  /** how close to an end the body must stand to enter there, and how level with it */
  enterRadius: number;
  levelTol: number;
  /** a zipline's CABLE over the rider's feet line, and how far under the cable its handle hangs (the trolley runs on
   *  the cable; the hands hold the handle) */
  grip?: number;
  handleDrop?: number;
  /** the solids the body is MOUNTED ON while on the route (a ladder's own stair or rungs) — part of the route, so
   *  never an obstacle to it; nothing else is excused */
  holds?: readonly string[];
  /** the prompt at each end */
  label: { a: string; b?: string };
};

const len3 = (a: RoutePoint, b: RoutePoint): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
export function routeLength(r: TraversalRoute): number {
  let L = 0;
  for (let i = 1; i < r.path.length; i++) L += len3(r.path[i - 1], r.path[i]);
  return L;
}

/** how long a full traversal takes, ms */
export function routeDuration(r: TraversalRoute): number {
  return Math.round((routeLength(r) / r.speed) * 1000);
}

/** the path in the direction of travel */
export const routePath = (r: TraversalRoute, dir: RouteDir): readonly RoutePoint[] => (dir === "a" ? r.path : [...r.path].reverse());

/** HOW FAR ALONG (0..1 of the length) the body is at time fraction u: a ladder climbs at a steady pace; a zipline
 *  pulls away from rest, runs, and brakes into its landing */
export function routeProgress(r: TraversalRoute, u: number): number {
  const x = Math.min(1, Math.max(0, u));
  if (r.kind === "ladder") return x;
  return (1 - Math.cos(Math.PI * x)) / 2;
}

export type RouteSample = { p: RoutePoint; yaw: number; s: number; phase: "on" | "move" | "off" };

/** WHERE THE FEET ARE at time fraction u of a traversal in `dir`, which way the body faces, and which part of the
 *  route it is in (stepping on, the climb or the ride, stepping off) */
export function sampleRoute(r: TraversalRoute, dir: RouteDir, u: number): RouteSample {
  const path = routePath(r, dir);
  const s = routeProgress(r, u);
  const total = routeLength(r);
  let want = s * total, i = 1;
  for (; i < path.length; i++) {
    const seg = len3(path[i - 1], path[i]);
    if (want <= seg || i === path.length - 1) break;
    want -= seg;
  }
  const a = path[i - 1], b = path[i], seg = Math.max(1e-6, len3(a, b));
  const t = Math.min(1, Math.max(0, want / seg));
  const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  const along = Math.atan2(path[path.length - 1].x - path[0].x, path[path.length - 1].z - path[0].z);
  const yaw = r.kind === "ladder" && r.facing !== undefined ? r.facing : along;
  // the first and last legs of the path are stepping on and off
  const first = len3(path[0], path[1]) / total, last = len3(path[path.length - 2], path[path.length - 1]) / total;
  const phase = s < first ? "on" : s > 1 - last ? "off" : "move";
  return { p, yaw, s, phase };
}

/** THE ENTRIES a body at `p` with its feet at `feet` may take: an end within `enterRadius`, level with it */
export function routeEntriesAt(routes: readonly TraversalRoute[], p: Vec2, feet: number): { route: TraversalRoute; dir: RouteDir; at: RoutePoint }[] {
  const out: { route: TraversalRoute; dir: RouteDir; at: RoutePoint }[] = [];
  for (const r of routes) {
    const ends: [RouteDir, RoutePoint][] = [["a", r.path[0]]];
    if (r.twoWay) ends.push(["b", r.path[r.path.length - 1]]);
    for (const [dir, at] of ends) if (Math.hypot(p.x - at.x, p.z - at.z) <= r.enterRadius && Math.abs(feet - at.y) <= r.levelTol) out.push({ route: r, dir, at });
  }
  return out;
}

/** the end a traversal in `dir` lets go at (its last point) */
export const routeExit = (r: TraversalRoute, dir: RouteDir): RoutePoint => (dir === "a" ? r.path[r.path.length - 1] : r.path[0]);

/** THE SERVER'S COPY of the declared routes (backend/app/realtime/traversal_routes.json): what the relay is checked
 *  against — the kind, the place, which ways it runs, its two ends and its duration. Generated from the routes
 *  themselves, and a test keeps the two identical. */
export function routeTable(routes: readonly TraversalRoute[]): Record<string, { kind: RouteKind; place: string; twoWay: boolean; ms: number; enterRadius: number; a: RoutePoint; b: RoutePoint }> {
  const r2 = (q: RoutePoint): RoutePoint => ({ x: Math.round(q.x * 100) / 100, y: Math.round(q.y * 100) / 100, z: Math.round(q.z * 100) / 100 });
  return Object.fromEntries(routes.map((r) => [r.id, { kind: r.kind, place: r.place, twoWay: r.twoWay, ms: routeDuration(r), enterRadius: r.enterRadius, a: r2(r.path[0]), b: r2(r.path[r.path.length - 1]) }]));
}

/** A ZIPLINE'S HOLD at time fraction u: where the trolley is on the cable, where the handle hangs under it, the
 *  cable's slope there (the trolley's pitch) and the way it runs. The trolley rides the cable the whole way: parked at
 *  the top while the rider steps up to it, travelling with them, stopped where they let go. Shared by the rider's own
 *  screen and every peer's, so the trolley, the handle and the hands on it are the same everywhere. */
export function ziplineHold(r: TraversalRoute, dir: RouteDir, u: number): { cable: RoutePoint; handle: RoutePoint; pitch: number; yaw: number; hanging: boolean; hang: number } | null {
  if (r.kind !== "zipline" || r.grip === undefined) return null;
  const path = routePath(r, dir);
  const s = sampleRoute(r, dir, u);
  const first = path[1], last = path[path.length - 2];
  const feet = s.phase === "on" ? first : s.phase === "off" ? last : s.p;
  const cable = { x: feet.x, y: feet.y + r.grip, z: feet.z };
  const handle = { x: cable.x, y: cable.y - (r.handleDrop ?? 0), z: cable.z };
  // the slope where the trolley is: between the ride's own samples
  const ride = path.slice(1, -1);
  let i = 0, best = Infinity;
  for (let k = 0; k < ride.length - 1; k++) { const d = Math.hypot(ride[k].x - feet.x, ride[k].z - feet.z); if (d < best) { best = d; i = k; } }
  const a = ride[i], b = ride[i + 1];
  const pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
  // HOW MUCH OF THE BODY THE HANDLE CARRIES: taking hold over the step up to it, all of it on the ride, letting go
  // over the drop at the end
  const total = routeLength(r), firstF = len3(path[0], path[1]) / total, lastF = len3(path[path.length - 2], path[path.length - 1]) / total;
  const hang = s.phase === "on" ? s.s / firstF : s.phase === "off" ? 1 - (s.s - (1 - lastF)) / lastF : 1;
  return { cable, handle, pitch, yaw: s.yaw, hanging: s.phase === "move", hang: Math.min(1, Math.max(0, hang)) };
}
