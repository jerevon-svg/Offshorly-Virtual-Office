// vo3d world — MONKEYAGENT TRAVERSAL: authored routes, a deterministic planner, a stateless plan sampler.
//
// THE CONTRACT WITH THE ORCHESTRATION LAYER. A job never says "walk to (412, -880)". It says
// `goTo("nova-design-station")` (a DESTINATION), and this module decides HOW a MonkeyAgent gets there: which
// authored links it takes (a floor path, a trunk climb, a ladder, a pole, a jump, a branch, a hang) and how
// long each takes for THIS agent. The body layer (avatar/MonkeyLocomotion) only ever asks "where are you and
// what are you doing at time t?".
//
// WHY IT IS PURE. No THREE, no clock, no randomness: a Plan is data, and `samplePlan(plan, t)` is a function
// of (plan, t) alone. Two clients holding the same plan and the same start time see the same monkey — which
// is all a later multiplayer / Agent Harness sync needs to send (destination, start time), not a stream of
// positions.
//
// THE REPRESENTATION. A TraversalGraph is NODES (places a body can be: floor spots, platform spots, a rung top,
// a hanging grip, a perch, a workstation seat) joined by LINKS, each carrying the GEOMETRY of the thing it
// crosses — the trunk's axis and radius, the ladder's rungs, the pole, the branch's centre line and width.
// The body layer reads that same geometry to put hands and feet ON it. Destinations are names for nodes.

export type V3 = { x: number; y: number; z: number };
export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scl = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return scl(a, 1 / l); };
export const lerp3 = (a: V3, b: V3, t: number): V3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const flat = (a: V3): V3 => norm({ x: a.x, y: 0, z: a.z });
export const yawOf = (dir: V3): number => Math.atan2(dir.x, dir.z);
export const dirOfYaw = (yaw: number): V3 => ({ x: Math.sin(yaw), y: 0, z: Math.cos(yaw) });
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const smooth = (t: number) => { const u = clamp01(t); return u * u * (3 - 2 * u); };

// ============================== THE GRAPH ===================================================================

/** A platform edge you can pull yourself up onto: a point ON the edge at deck height, and the horizontal
 *  direction from the edge onto the deck. */
export type Ledge = { edge: V3; inward: V3 };

export type LinkGeom =
  /** floor or branch: a centre line (y included — ramps and sloped branches are just y along the line). A
   *  branch is a cylinder of `radius` under the line: the line is its TOP. */
  | { kind: "ground"; path: V3[]; surface: "floor" | "branch"; radius?: number }
  /** a trunk or steep branch: a cylinder axis bottom→top, its radius, and the horizontal outward normal of the
   *  face climbed. `topLedge`: the climb ends by mantling onto a platform; otherwise it steps off at the top. */
  | { kind: "climb"; bottom: V3; top: V3; radius: number; out: V3; topLedge?: Ledge }
  /** a ladder: rail feet → rail tops at centre, the side it is climbed from, rung spacing, rail width */
  | { kind: "ladder"; bottom: V3; top: V3; out: V3; rung: number; width: number; topLedge: Ledge }
  /** a fire pole: reached from a platform ledge, slid down only */
  | { kind: "pole"; top: V3; bottom: V3; radius: number; ledge: Ledge }
  /** a short jump between two authored surfaces; `apex` is the height above the higher end */
  | { kind: "jump"; apex: number }
  /** lowering from a ledge into a hang (and climbing back up): `grip` is the hand line's centre on the edge */
  | { kind: "hang"; grip: V3; along: V3; out: V3 }
  /** letting go from a hang onto the ground below */
  | { kind: "drop" }
  /** THROUGH A BUILDING THAT IS NOT MODELLED (the residence): the body is not drawn for `dur` seconds — the seam
   *  by which an agent appears from, or disappears into, the MonkeyAgents' home */
  | { kind: "interior"; dur: number };

export type TLink = { id: string; from: string; to: string; geom: LinkGeom; oneWay?: boolean };
/** what a body does on ARRIVING at a node, if it is a destination */
export type NodeAction = "stand" | "sit" | "perch" | "sleep" | "hang" | "work-seated" | "work-standing" | "handoff" | "lie" | "lean" | "inside";
/** `out`: for a HANG node, the horizontal side of the bar the body hangs on (away from the structure).
 *  `work`: for a WORKSTATION node, its ergonomics — the stool seat height (seated work) and the work surface
 *  height the hands rest on. MonkeyAgent furniture is built to monkey proportions (avatar/monkeyMotion). */
export type TNode = { id: string; at: V3; yaw?: number; action?: NodeAction; out?: V3; work?: { seatY?: number; surfaceY: number }; /** a node ON A LIMB: its radius and its rise per unit forward, so a still pose grips the cylinder */ branch?: { r: number; rise?: number } };
export type TraversalGraph = { nodes: readonly TNode[]; links: readonly TLink[]; destinations: Readonly<Record<string, string>> };

/** PLACE A GRAPH: author it in a local frame, then translate every POINT (never a direction) by `o`. The
 *  treehouse is authored this way and dropped into the Lab's world frame. */
export function offsetGraph(g: TraversalGraph, o: V3): TraversalGraph {
  const P = (p: V3): V3 => add(p, o);
  const L = (l: Ledge): Ledge => ({ edge: P(l.edge), inward: l.inward });
  const geom = (x: LinkGeom): LinkGeom => {
    switch (x.kind) {
      case "ground": return { ...x, path: x.path.map(P) };
      case "climb": return { ...x, bottom: P(x.bottom), top: P(x.top), ...(x.topLedge ? { topLedge: L(x.topLedge) } : {}) };
      case "ladder": return { ...x, bottom: P(x.bottom), top: P(x.top), topLedge: L(x.topLedge) };
      case "pole": return { ...x, top: P(x.top), bottom: P(x.bottom), ledge: L(x.ledge) };
      case "hang": return { ...x, grip: P(x.grip) };
      default: return x;
    }
  };
  return {
    nodes: g.nodes.map((n) => ({ ...n, at: P(n.at) })),
    links: g.links.map((l) => ({ ...l, geom: geom(l.geom) })),
    destinations: g.destinations,
  };
}

export function graphIndex(g: TraversalGraph) {
  const node = new Map(g.nodes.map((n) => [n.id, n]));
  const out = new Map<string, { link: TLink; dir: 1 | -1; to: string }[]>();
  for (const n of g.nodes) out.set(n.id, []);
  for (const l of [...g.links].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!node.has(l.from) || !node.has(l.to)) throw new Error(`traversal: link ${l.id} joins unknown nodes`);
    out.get(l.from)!.push({ link: l, dir: 1, to: l.to });
    const reversible = !l.oneWay && l.geom.kind !== "pole" && l.geom.kind !== "drop";
    if (reversible) out.get(l.to)!.push({ link: l, dir: -1, to: l.from });
  }
  return { node, out };
}

// ============================== IDENTITY: HOW THIS MONKEY MOVES ============================================

export type Gait = "walk" | "scamper" | "knuckle";
/** Per-identity motion character. Shared vocabulary, different temperament: deterministic numbers, never
 *  randomness, so the same agent always moves the same way. */
export type MotionProfile = {
  id: string;
  speed: Record<Gait, number>;
  /** climbing / ladder speed along the structure, units per second */
  climb: number;
  ladder: number;
  /** ground acceleration (units/s²) — how briskly it gets going and pulls up */
  accel: number;
  /** a floor run shorter than this is walked; shorter than `knuckleFrom` is scampered; longer, knuckle-run */
  walkMax: number;
  knuckleFrom: number;
  /** scales every authored transition (attach, mantle, land, sit-down…): <1 brisk, >1 unhurried */
  tempo: number;
  /** posture: forward lean of the upright gaits (radians) and how deep the knuckle crouch sits (0..1) */
  lean: number;
  crouch: number;
  /** a fixed phase offset so three monkeys never step in lockstep */
  stridePhase: number;
  /** ROUTE TEMPERAMENT: planner cost multipliers per way of moving (1 = neutral). They change which route an
   *  agent CHOOSES, never how long a link takes — Nova avoids branches and drops, Pip seeks them, Milo likes
   *  the pole. */
  routeBias?: Partial<Record<"branch" | "climb" | "ladder" | "pole" | "jump" | "hang" | "drop", number>>;
};

export const BASE_PROFILE: MotionProfile = {
  id: "base", speed: { walk: 26, scamper: 50, knuckle: 74 }, climb: 15, ladder: 18, accel: 150,
  walkMax: 70, knuckleFrom: 150, tempo: 1, lean: 0.12, crouch: 0.5, stridePhase: 0,
};

// ============================== PLANS =======================================================================

export type SegKind = "run" | "climb" | "ladder" | "pole" | "jump" | "hang-in" | "hang-out" | "drop" | "interior";
export type Segment = {
  kind: SegKind;
  t0: number;
  dur: number;
  link: TLink;
  dir: 1 | -1;
  from: TNode;
  to: TNode;
  /** RUN only: the smoothed centre line, cumulative lengths, gait, top speed and the gait arc offset */
  run?: { pts: V3[]; cum: number[]; length: number; gait: Gait; vmax: number; accel: number; s0: number; surface: "floor" | "branch"; carry: boolean };
  /** structured segments: authored sub-phase durations (attach / main / detach), in seconds */
  phases?: { a: number; m: number; b: number };
  /** the previous segment's kind and gait — a segment blends in from what came before */
  prev: { kind: SegKind | "still"; gait?: Gait };
  next: { kind: SegKind | "still"; gait?: Gait };
};
export type Plan = { t0: number; t1: number; segs: Segment[]; start: TNode; end: TNode; action: NodeAction; carry: boolean; profile: MotionProfile };

/** TRANSITION TIMES (seconds at tempo 1). Authored, then scaled per identity. */
export const TRANSITION = {
  climbAttach: 0.65, climbMantle: 1.35, climbMount: 1.15, climbStepOff: 0.55,
  ladderAttach: 0.5, ladderMantle: 1.05, ladderMount: 1.0, ladderStepOff: 0.45,
  poleReach: 0.95, poleLand: 0.5,
  jumpCrouch: 0.3, jumpLand: 0.42,
  hangIn: 1.25, hangOut: 1.55, dropLand: 0.5,
} as const;
export const GRAVITY = 260; // units/s² — stylised: a 48-unit fall takes ~0.6 s
/** a hanging body's feet sit this far below its grip (the one-arm hang: arm 9.4 straight up from a shoulder
 *  15.6 above the feet, the body rolled ~45° — avatar/monkeyMotion hangPose) */
export const HANG_FEET = 23;

function chooseGait(length: number, surface: "floor" | "branch", carry: boolean, p: MotionProfile): Gait {
  if (carry) return length > p.knuckleFrom ? "scamper" : "walk";
  if (surface === "branch") return "knuckle";
  return length <= p.walkMax ? "walk" : length < p.knuckleFrom ? "scamper" : "knuckle";
}

/** ROUND THE CORNERS of a centre line, so heading changes smoothly instead of snapping at vertices. */
export function smoothPath(pts: readonly V3[], radius = 14): V3[] {
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const out: V3[] = [{ ...pts[0] }];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], v = pts[i], b = pts[i + 1];
    const d1 = len(sub(v, a)), d2 = len(sub(b, v));
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const p0 = add(v, scl(norm(sub(a, v)), r)), p1 = add(v, scl(norm(sub(b, v)), r));
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      // quadratic Bézier p0 → v → p1
      out.push(add(add(scl(p0, (1 - t) * (1 - t)), scl(v, 2 * (1 - t) * t)), scl(p1, t * t)));
    }
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}
function cumulative(pts: readonly V3[]): number[] {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + len(sub(pts[i], pts[i - 1])));
  return c;
}
/** point + unit tangent at arc length s along a polyline */
export function along(pts: readonly V3[], cum: readonly number[], s: number): { p: V3; t: V3 } {
  const L = cum[cum.length - 1];
  const x = Math.min(L, Math.max(0, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < x) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const k = (x - cum[i - 1]) / seg;
  return { p: lerp3(pts[i - 1], pts[i], k), t: norm(sub(pts[i], pts[i - 1])) };
}

/** distance covered by time τ on a trapezoid profile (accelerate, cruise, brake) over `L` */
function trapezoid(L: number, vmax: number, a: number): { T: number; s: (t: number) => number; v: (t: number) => number } {
  const tA = vmax / a, dA = 0.5 * a * tA * tA;
  if (2 * dA >= L) {
    const tp = Math.sqrt(L / a), vp = a * tp;
    return {
      T: 2 * tp,
      s: (t) => (t <= tp ? 0.5 * a * t * t : L - 0.5 * a * Math.max(0, 2 * tp - t) ** 2),
      v: (t) => (t <= tp ? a * t : Math.max(0, vp - a * (t - tp))),
    };
  }
  const tC = (L - 2 * dA) / vmax, T = 2 * tA + tC;
  return {
    T,
    s: (t) => (t <= tA ? 0.5 * a * t * t : t <= tA + tC ? dA + vmax * (t - tA) : L - 0.5 * a * Math.max(0, T - t) ** 2),
    v: (t) => (t <= tA ? a * t : t <= tA + tC ? vmax : Math.max(0, a * (T - t))),
  };
}

const geomLength = (g: LinkGeom, from: TNode, to: TNode): number => {
  switch (g.kind) {
    case "ground": return cumulative(g.path).at(-1)!;
    case "climb": return len(sub(g.top, g.bottom));
    case "ladder": return len(sub(g.top, g.bottom));
    case "pole": return len(sub(g.top, g.bottom));
    default: return len(sub(to.at, from.at));
  }
};

/** THE COST of crossing a link one way, in seconds, for this profile — the planner's edge weight and the
 *  segment's duration are the same number, so the planner prefers what is genuinely quickest for THIS agent. */
function structuredDuration(link: TLink, dir: 1 | -1, from: TNode, to: TNode, p: MotionProfile): { dur: number; phases: { a: number; m: number; b: number } } {
  const g = link.geom, k = p.tempo, T = TRANSITION;
  const L = geomLength(g, from, to);
  switch (g.kind) {
    case "climb": {
      const top = g.topLedge ? (dir > 0 ? T.climbMantle : T.climbMount) : T.climbStepOff;
      const bot = dir > 0 ? T.climbAttach : T.climbStepOff;
      const a = (dir > 0 ? bot : top) * k, b = (dir > 0 ? top : bot) * k;
      // down-climbing is a little quicker than up
      return { dur: a + L / (p.climb * (dir > 0 ? 1 : 1.25)) + b, phases: { a, m: L / (p.climb * (dir > 0 ? 1 : 1.25)), b } };
    }
    case "ladder": {
      const a = (dir > 0 ? T.ladderAttach : T.ladderMount) * k, b = (dir > 0 ? T.ladderMantle : T.ladderStepOff) * k;
      const m = L / (p.ladder * (dir > 0 ? 1 : 1.2));
      return { dur: a + m + b, phases: { a, m, b } };
    }
    case "pole": {
      // slide: accelerate under friction-limited gravity, brake hard over the last fifth
      const m = Math.sqrt((2 * L) / (GRAVITY * 0.45)) * 1.15;
      const a = T.poleReach * k, b = T.poleLand * k;
      return { dur: a + m + b, phases: { a, m, b } };
    }
    case "jump": {
      const hi = Math.max(from.at.y, to.at.y) + g.apex;
      const up = Math.sqrt((2 * (hi - from.at.y)) / GRAVITY), down = Math.sqrt((2 * (hi - to.at.y)) / GRAVITY);
      const a = T.jumpCrouch * k, b = T.jumpLand * k;
      return { dur: a + up + down + b, phases: { a, m: up + down, b } };
    }
    case "hang": {
      const d = (dir > 0 ? T.hangIn : T.hangOut) * k;
      return { dur: d, phases: { a: 0, m: d, b: 0 } };
    }
    case "interior": return { dur: g.dur * k, phases: { a: 0, m: g.dur * k, b: 0 } };
    case "drop": {
      const m = Math.sqrt((2 * Math.max(0, from.at.y - HANG_FEET - to.at.y)) / GRAVITY);
      const b = T.dropLand * k;
      return { dur: m + b, phases: { a: 0, m, b } };
    }
    default: return { dur: 0, phases: { a: 0, m: 0, b: 0 } };
  }
}

/** links a body may not take with its hands full */
const needsHands = (g: LinkGeom) => g.kind !== "ground" || g.surface === "branch";

/** THE PLANNER: the quickest route for this agent, Dijkstra over link durations, ties broken by node id so the
 *  same request always yields the same route. Returns the links walked, in order, with their directions. */
export function route(g: TraversalGraph, from: string, to: string, p: MotionProfile, carry = false): { link: TLink; dir: 1 | -1; to: string }[] | null {
  const ix = graphIndex(g);
  if (!ix.node.has(from) || !ix.node.has(to)) return null;
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { link: TLink; dir: 1 | -1; from: string; to: string }>();
  const done = new Set<string>();
  for (;;) {
    let best: string | null = null, bd = Infinity;
    for (const [n, d] of dist) if (!done.has(n) && (d < bd || (d === bd && best !== null && n < best))) { best = n; bd = d; }
    if (best === null) return null;
    if (best === to) break;
    done.add(best);
    for (const e of ix.out.get(best)!) {
      if (carry && needsHands(e.link.geom)) continue;
      const a = ix.node.get(best)!, b = ix.node.get(e.to)!;
      const g = e.link.geom;
      const bias = p.routeBias?.[g.kind === "ground" ? (g.surface === "branch" ? "branch" : "climb") : g.kind as "climb"] ?? 1;
      const c = g.kind === "ground"
        ? (geomLength(g, a, b) / p.speed[chooseGait(geomLength(g, a, b), g.surface, carry, p)] + 0.15) * (g.surface === "branch" ? bias : 1)
        : structuredDuration(e.link, e.dir, a, b, p).dur * bias;
      const nd = bd + c;
      if (nd < (dist.get(e.to) ?? Infinity) - 1e-9) { dist.set(e.to, nd); prev.set(e.to, { ...e, from: best }); }
    }
  }
  const out: { link: TLink; dir: 1 | -1; to: string }[] = [];
  for (let n = to; n !== from;) { const e = prev.get(n)!; out.unshift({ link: e.link, dir: e.dir, to: e.to }); n = e.from; }
  return out;
}

const pathOf = (g: Extract<LinkGeom, { kind: "ground" }>, dir: 1 | -1): V3[] => (dir > 0 ? g.path.slice() : g.path.slice().reverse());

/** BUILD A PLAN: route → timed segments. Consecutive floor links merge into ONE run (one acceleration, one
 *  gait, corners rounded), so a body does not stop at every authored waypoint. */
export function buildPlan(g: TraversalGraph, fromNode: string, destination: string, p: MotionProfile, t0: number, opts: { carry?: boolean } = {}): Plan | null {
  const ix = graphIndex(g);
  const target = g.destinations[destination] ?? destination;
  const r = route(g, fromNode, target, p, !!opts.carry);
  // no route, or already there: nothing to schedule
  if (!r || r.length === 0) return null;
  const carry = !!opts.carry;
  const segs: Segment[] = [];
  let t = t0, s0 = p.stridePhase * 30;
  let cur = ix.node.get(fromNode)!;
  for (let i = 0; i < r.length;) {
    const e = r[i];
    const geom = e.link.geom;
    if (geom.kind === "ground") {
      // gather the run: consecutive ground links on the SAME surface
      const pts: V3[] = [];
      let j = i, last = cur;
      while (j < r.length && r[j].link.geom.kind === "ground" && (r[j].link.geom as { surface: string }).surface === geom.surface) {
        const gp = pathOf(r[j].link.geom as Extract<LinkGeom, { kind: "ground" }>, r[j].dir);
        if (pts.length) gp.shift();
        pts.push(...gp);
        last = ix.node.get(r[j].to)!;
        j++;
      }
      const sm = smoothPath(pts, geom.surface === "branch" ? 6 : 16);
      const cum = cumulative(sm), L = cum.at(-1)!;
      const gait = chooseGait(L, geom.surface, carry, p);
      const vmax = p.speed[gait] * (geom.surface === "branch" ? 0.55 : 1);
      const tr = trapezoid(L, vmax, p.accel);
      segs.push({ kind: "run", t0: t, dur: tr.T, link: e.link, dir: e.dir, from: cur, to: last, run: { pts: sm, cum, length: L, gait, vmax, accel: p.accel, s0, surface: geom.surface, carry }, prev: { kind: "still" }, next: { kind: "still" } });
      t += tr.T; s0 += L; cur = last; i = j;
      continue;
    }
    const to = ix.node.get(e.to)!;
    const { dur, phases } = structuredDuration(e.link, e.dir, cur, to, p);
    const kind: SegKind = geom.kind === "hang" ? (e.dir > 0 ? "hang-in" : "hang-out") : (geom.kind as SegKind);
    segs.push({ kind, t0: t, dur, link: e.link, dir: e.dir, from: cur, to, phases, prev: { kind: "still" }, next: { kind: "still" } });
    t += dur; cur = to; i++;
  }
  for (let k = 0; k < segs.length; k++) {
    if (k > 0) segs[k].prev = { kind: segs[k - 1].kind, gait: segs[k - 1].run?.gait };
    if (k < segs.length - 1) segs[k].next = { kind: segs[k + 1].kind, gait: segs[k + 1].run?.gait };
  }
  const end = ix.node.get(target)!;
  return { t0, t1: t, segs, start: ix.node.get(fromNode)!, end, action: end.action ?? "stand", carry, profile: p };
}

// ============================== SAMPLING ====================================================================

/** WHERE A BODY IS AND WHAT IT IS DOING at time t — everything the body layer needs, nothing it must remember. */
export type MotionSample = {
  /** "still" = before the plan starts or after it ends (the node's action holds) */
  kind: SegKind | "still";
  seg: Segment | null;
  /** seconds into the segment, and 0..1 of it */
  local: number;
  u: number;
  /** RUN: arc length into the run, total gait arc (for stride phase), speed now, and top speed */
  s: number;
  gaitS: number;
  speed: number;
  /** the body's ground anchor (feet line) and horizontal heading for runs; structured segments compute their
   *  own placement from the link geometry */
  pos: V3;
  heading: V3;
  /** seconds since the plan ended (for the arrival action's settle) */
  since: number;
};

export function samplePlan(plan: Plan, t: number): MotionSample {
  const first = plan.segs[0];
  if (!first || t < plan.t0) {
    return { kind: "still", seg: null, local: 0, u: 0, s: 0, gaitS: 0, speed: 0, pos: plan.start.at, heading: dirOfYaw(plan.start.yaw ?? 0), since: -1 };
  }
  if (t >= plan.t1) {
    const last = plan.segs.at(-1)!;
    const heading = plan.end.yaw !== undefined ? dirOfYaw(plan.end.yaw) : endHeading(last);
    return { kind: "still", seg: last, local: 0, u: 1, s: 0, gaitS: 0, speed: 0, pos: plan.end.at, heading, since: t - plan.t1 };
  }
  let seg = first;
  for (const s of plan.segs) { if (s.t0 <= t) seg = s; else break; }
  const local = t - seg.t0, u = seg.dur > 0 ? local / seg.dur : 1;
  if (seg.run) {
    const R = seg.run;
    const tr = trapezoid(R.length, R.vmax, R.accel);
    const s = tr.s(local);
    const at = along(R.pts, R.cum, s);
    return { kind: "run", seg, local, u, s, gaitS: R.s0 + s, speed: tr.v(local), pos: at.p, heading: flat(at.t), since: -1 };
  }
  return { kind: seg.kind, seg, local, u, s: 0, gaitS: 0, speed: 0, pos: lerp3(seg.from.at, seg.to.at, smooth(u)), heading: flat(sub(seg.to.at, seg.from.at)), since: -1 };
}

/** the heading a body finishes a segment with (used when the destination declares none) */
export function endHeading(seg: Segment): V3 {
  if (seg.run) { const n = seg.run.pts.length; return flat(sub(seg.run.pts[n - 1], seg.run.pts[n - 2])); }
  const g = seg.link.geom;
  if ((g.kind === "climb" || g.kind === "ladder") && seg.dir > 0) return flat(g.topLedge?.inward ?? scl(g.out, -1));
  if (g.kind === "climb" || g.kind === "ladder") return flat(g.out);
  if (g.kind === "pole") return flat(g.ledge.inward); // it lands facing the pole, back to the open floor
  if (g.kind === "hang") return seg.dir > 0 ? flat(g.along) : flat(scl(g.out, -1));
  if (g.kind === "drop") return dirOfYaw(seg.from.yaw ?? 0);
  if (g.kind === "interior") return dirOfYaw(seg.to.yaw ?? 0);
  const d = sub(seg.to.at, seg.from.at);
  return Math.hypot(d.x, d.z) > 1e-3 ? flat(d) : dirOfYaw(seg.to.yaw ?? 0);
}
