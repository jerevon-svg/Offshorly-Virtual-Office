// vo3d devtools — THE STRESS MATRIX. Dev-only, measurement-only, isolated from V1 and from production.
//
// PHASE 1 IS A MEASUREMENT PHASE. Nothing in this file changes what is rendered or how: no quality knob
// is lowered, no shadow policy is touched, no LOD is dropped. It places a crowd, points the camera,
// waits for the frame to settle, and records what the renderer reports. The two A/B sub-captures it can
// run (crowd hidden, shadows frozen) exist to ATTRIBUTE cost, and both restore the approved state before
// the scenario ends.
//
// FULL GRAPHICS, in the sense the phase brief means it: preset A (SSAO on via the approved depth reuse,
// shadows on, sway on), the approved DPR, room visibility + static batching + foliage instancing on,
// environment and weather running. The runner asserts that state at the top of every scenario instead of
// trusting whatever the page was last left in.
import type { Rect, Vec2 } from "../core/coords";
import type { CrowdSpawn } from "./Crowd";
import type { CaptureSummary } from "./Bench";

/** Deterministic PRNG — the same seed spawns the same crowd in the same places, so two captures of one
 *  scenario differ by frame timing alone. Lives here, in the pure module, so the scenario/placement code
 *  (and its tests) never pull in the GLB loader. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type StressLayout = "distributed" | "hub" | "cave";

export type StressScenario = {
  id: string;
  label: string;
  /** how many EXTRA bodies beyond the hero avatar. Scenario 1's "1 avatar" is the hero alone. */
  count: number;
  layout: StressLayout;
  /** true = every body roams (walk clip + translation + shadow invalidation every frame) */
  motion: boolean;
  seconds: number;
};

/** THE REQUIRED MATRIX, in order. Durations are long enough for the 1%-low figure to mean something
 *  (a 20 s capture at 60 fps is 1200 frames, so p99 is an average of the worst dozen). */
export const STRESS_MATRIX: readonly StressScenario[] = [
  { id: "s1-baseline-1", label: "1 avatar — baseline", count: 0, layout: "distributed", motion: false, seconds: 20 },
  { id: "s2-10", label: "10 avatars — distributed", count: 9, layout: "distributed", motion: false, seconds: 20 },
  { id: "s3-25", label: "25 avatars — distributed", count: 24, layout: "distributed", motion: false, seconds: 20 },
  { id: "s4-50", label: "50 avatars — distributed", count: 49, layout: "distributed", motion: false, seconds: 20 },
  { id: "s5-70", label: "70 avatars — distributed across the office", count: 69, layout: "distributed", motion: false, seconds: 20 },
  { id: "s6-70-hub", label: "70 avatars — clustered in Central Hub", count: 69, layout: "hub", motion: false, seconds: 20 },
  { id: "s7-70-cave", label: "70 avatars — inside the CAVE (worst case)", count: 69, layout: "cave", motion: false, seconds: 20 },
  { id: "s8-70-cave-motion", label: "70 avatars — CAVE + movement/animation burst", count: 69, layout: "cave", motion: true, seconds: 20 },
  // Added for the shadow phase: the office is where a shadow-map redraw has ~2,800 STATIC casters behind
  // it, so this is the scenario that separates "the avatars are expensive to re-shadow" from "the WORLD
  // is expensive to re-shadow because an avatar moved".
  { id: "s9-70-distributed-motion", label: "70 avatars — distributed + movement/animation burst", count: 69, layout: "distributed", motion: true, seconds: 20 },
];

// ---- placement ---------------------------------------------------------------------------------

/** Candidate standing points inside a rect on a jittered lattice, filtered by the world's own stand test. */
export function candidatesIn(rect: Rect, spacing: number, canStand: (p: Vec2) => boolean, rng: () => number, inset = 0): Vec2[] {
  const out: Vec2[] = [];
  const x0 = rect.x + inset, z0 = rect.z + inset;
  const w = rect.w - 2 * inset, d = rect.d - 2 * inset;
  if (w <= 0 || d <= 0) return out;
  const cols = Math.max(1, Math.floor(w / spacing));
  const rows = Math.max(1, Math.floor(d / spacing));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = {
        x: x0 + (c + 0.5) * (w / cols) + (rng() - 0.5) * spacing * 0.35,
        z: z0 + (r + 0.5) * (d / rows) + (rng() - 0.5) * spacing * 0.35,
      };
      if (canStand(p)) out.push(p);
    }
  }
  return out;
}

/** Fisher-Yates against a seeded PRNG — the same seed always yields the same crowd. */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Spread `count` bodies over several areas ROUND-ROBIN, so a 70-body office fills every room rather
 *  than saturating the first one. Areas that run out of legal ground are skipped, never re-used. */
export function spreadOver(areas: readonly Vec2[][], count: number, roam: number): CrowdSpawn[] {
  const out: CrowdSpawn[] = [];
  const cursors = areas.map(() => 0);
  let guard = 0;
  while (out.length < count && guard++ < count * areas.length + areas.length) {
    let placed = false;
    for (let i = 0; i < areas.length && out.length < count; i++) {
      const c = cursors[i];
      if (c >= areas[i].length) continue;
      cursors[i] = c + 1;
      out.push({ home: areas[i][c], roam });
      placed = true;
    }
    if (!placed) break;
  }
  return out;
}

export type PlacementDeps = {
  /** every reconstructed room's floor rect, hub included, in a stable order */
  roomRects: readonly { id: string; rect: Rect }[];
  hubRect: Rect;
  caveRect: Rect;
  canStand: (p: Vec2) => boolean;
};

/** ROAM RADII. Distributed bodies wander around their own desk area; clustered ones only shuffle, which
 *  is what a crowded room actually looks like — and keeps 70 bodies from walking through each other. */
const ROAM = { distributed: 46, hub: 22, cave: 30 };

export function planPlacements(layout: StressLayout, count: number, deps: PlacementDeps, seed = 7): CrowdSpawn[] {
  if (count <= 0) return [];
  const rng = mulberry32(seed);
  if (layout === "distributed") {
    const areas = deps.roomRects.map((r) => shuffled(candidatesIn(r.rect, 34, deps.canStand, rng, 24), rng));
    return spreadOver(areas, count, ROAM.distributed);
  }
  if (layout === "hub") {
    // CLUSTERED means shoulder-to-shoulder, not "somewhere in the hub": a 240 × 180 box on the hub's
    // own centre, at a 17-unit pitch. Seventy bodies land inside a single room-sized frustum.
    const r = deps.hubRect;
    const box: Rect = { x: r.x + r.w / 2 - 120, z: r.z + r.d / 2 - 90, w: 240, d: 180 };
    let pts = shuffled(candidatesIn(box, 17, deps.canStand, rng, 0), rng);
    if (pts.length < count) pts = pts.concat(shuffled(candidatesIn(r, 20, deps.canStand, rng, 20), rng));
    return spreadOver([pts], count, ROAM.hub);
  }
  // CAVE. The front two thirds of the hall, so the bodies are in front of the arrival camera as well as
  // inside the volume — the scenario is worthless if the renderer submits 70 bodies nobody can see.
  const c = deps.caveRect;
  const box: Rect = { x: c.x + 40, z: c.z + 40, w: c.w - 80, d: c.d * 0.72 };
  let pts = shuffled(candidatesIn(box, 26, deps.canStand, rng, 0), rng);
  if (pts.length < count) pts = pts.concat(shuffled(candidatesIn(c, 22, deps.canStand, rng, 30), rng));
  return spreadOver([pts], count, ROAM.cave);
}

// ---- results -----------------------------------------------------------------------------------

export type ScenarioConfig = {
  id: string;
  label: string;
  avatars: number;
  layout: StressLayout;
  motion: boolean;
  seconds: number;
  lod: number;
  labels: boolean;
  preset: string;
  ssao: boolean;
  ssaoDepthReuse: boolean;
  shadows: boolean;
  roomCulling: boolean;
  staticBatching: boolean;
  pixelRatio: number;
  drawingBuffer: string;
  camera: string;
  placed: number;
};

export type ScenarioResult = {
  config: ScenarioConfig;
  /** the approved-state capture — this is THE result for the scenario */
  frame: CaptureSummary;
  scene: { visibleMeshes: number; drawCalls: number; triangles: number; geometries: number; textures: number; programs: number };
  memory: { jsHeapMb: number | null; totalHeapMb: number | null; limitMb: number | null };
  /** what the crowd itself costs: the same capture with the crowd hidden, and the delta */
  avatarCost: { hiddenFrameMs: number; crowdFrameMs: number; deltaMs: number; perAvatarMs: number; deltaCalls: number; deltaTriangles: number } | null;
  /** What the shadow map costs at this crowd size: the same capture with invalidation frozen, plus the
   *  static/dynamic split (crowd dropped out of the shadow pass only — it still moves and still draws). */
  shadowCost: {
    invalidationRate: number; frozenFrameMs: number; liveFrameMs: number; deltaMs: number; sharePct: number;
    staticOnlyFrameMs: number | null; staticShareMs: number | null; dynamicShareMs: number | null;
    liveCalls: number | null; frozenCalls: number | null; liveTriangles: number | null; frozenTriangles: number | null;
    /** the split shadow update: how often the FULL static redraw was actually needed, and which path ran */
    staticRedrawRate: number; cacheActive: boolean; staticPasses: number; dynamicPasses: number; fullPasses: number; passFrames: number;
  } | null;
  errors: string[];
  startedAt: string;
  durationMs: number;
};

export function markdownTable(results: readonly ScenarioResult[]): string {
  const head = "| scenario | avatars | avg fps | 1% low | avg ms | med ms | p95 ms | p99 ms | worst ms | draw calls | triangles | vis meshes | heap MB |";
  const sep = "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
  const rows = results.map((r) => {
    const f = r.frame;
    return `| ${r.config.label} | ${r.config.avatars} | ${f.avgFps} | ${f.onePercentLowFps} | ${f.avgFrameMs} | ${f.medianFrameMs} | ${f.p95FrameMs} | ${f.p99FrameMs} | ${f.worstFrameMs} | ${f.avgDrawCalls} | ${f.avgTriangles.toLocaleString()} | ${r.scene.visibleMeshes} | ${r.memory.jsHeapMb ?? "n/a"} |`;
  });
  return [head, sep, ...rows].join("\n");
}
