// vo3d world — AI LAB V2 WORKSTATIONS, as data. A station is a TYPED, PLACED MODULE, never a bespoke desk.
//
// WHY. Milo, Nova and Pip are the FOUNDING agents, not the workforce's ceiling. A future agent is ASSIGNED to a
// free station of a compatible type ("a BUILD station"), and walks to it through the same traversal graph, so
// adding BUILD_03 is one entry in STATIONS — the geometry (build/labStations), the player's collision and the
// MonkeyAgent's route (world/ailabV2 buildLabV2Graph) all follow from it.
//
// THE LOCAL FRAME. Every template is authored with the operator standing/sitting at the origin FACING −z (north,
// toward its screens — the side the VO camera sees the screens from). A station's `yaw` rotates the whole module
// (π = facing north, 0 = facing south). The operator's posture, seat and work-surface heights are the proven
// Phase 1 ergonomics (avatar/monkeyMotion): stool 12 / footrest 7 / bench 18 seated, bench 13 standing, screens
// ≥ 14 in front of the spine.
import type { Rect } from "../core/coords";
import { v3, type V3 } from "./monkeyTraversal";

export type StationType = "design" | "build" | "review" | "flex" | "specialist" | "master";
export type StationPosture = "seated" | "standing";
/** what a station's screens show — one atlas family per kind of work (build/labScreens) */
export type ScreenKind = "design" | "reference" | "code" | "terminal" | "review" | "compare" | "devices" | "general" | "orchestration" | "status";
export type StationState = "active" | "idle" | "offline" | "future";

/** a box in the station's local frame (x right, z forward is NEGATIVE), standing on y0 */
export type LocalBox = { x0: number; x1: number; z0: number; z1: number; h: number; y0?: number };
/** a screen in the local frame: its face's centre-left-right span on x, its plane z, height range */
export type LocalScreen = { kind: ScreenKind; x0: number; x1: number; z: number; y0: number; y1: number; yaw?: number };

export type StationTemplate = {
  posture: StationPosture;
  seatY?: number;
  surfaceY: number;
  /** solid footprints a body collides with at floor level */
  solids: readonly LocalBox[];
  screens: readonly LocalScreen[];
};

const SEAT = 12, BENCH = 18, STAND = 13;
/** the stool the operator sits on — solid for the player, the operator node stands ON it */
const STOOL: LocalBox = { x0: -6, x1: 6, z0: -5.5, z1: 5.5, h: SEAT };

export const STATION_TEMPLATES: Readonly<Record<StationType, StationTemplate>> = {
  design: {
    posture: "seated", seatY: SEAT, surfaceY: BENCH,
    solids: [{ x0: -58, x1: 58, z0: -38.5, z1: -4.5, h: BENCH }, STOOL],
    screens: [
      { kind: "design", x0: -46, x1: -6, z: -34.6, y0: BENCH + 4, y1: BENCH + 28 },
      { kind: "reference", x0: 0, x1: 18, z: -34.6, y0: BENCH + 4, y1: BENCH + 34 },
    ],
  },
  build: {
    posture: "seated", seatY: SEAT, surfaceY: BENCH,
    solids: [{ x0: -58, x1: 58, z0: -38.5, z1: -4.5, h: BENCH }, { x0: 58, x1: 88, z0: -38.5, z1: 44, h: BENCH }, STOOL],
    screens: [
      { kind: "code", x0: -32, x1: -12, z: -33.8, y0: BENCH + 4, y1: BENCH + 24, yaw: 0.32 },
      { kind: "code", x0: -10, x1: 12, z: -34.8, y0: BENCH + 4, y1: BENCH + 25 },
      { kind: "terminal", x0: 14, x1: 34, z: -33.8, y0: BENCH + 4, y1: BENCH + 24, yaw: -0.32 },
      { kind: "code", x0: -54, x1: -38, z: -34.6, y0: BENCH + 4, y1: BENCH + 34 },
    ],
  },
  review: {
    posture: "standing", surfaceY: STAND,
    solids: [{ x0: -60, x1: 60, z0: -30.5, z1: -4.5, h: STAND }, { x0: -45, x1: 45, z0: -50, z1: -45, h: 14 }],
    screens: [{ kind: "review", x0: -44, x1: 44, z: -45.4, y0: 15, y1: 51 }],
  },
  flex: {
    posture: "seated", seatY: SEAT, surfaceY: BENCH,
    solids: [{ x0: -50, x1: 50, z0: -34.5, z1: -4.5, h: BENCH }, STOOL],
    screens: [
      { kind: "general", x0: -34, x1: -4, z: -30.6, y0: BENCH + 4, y1: BENCH + 22 },
      { kind: "general", x0: 2, x1: 26, z: -30.6, y0: BENCH + 4, y1: BENCH + 22 },
    ],
  },
  specialist: {
    posture: "standing", surfaceY: STAND,
    solids: [{ x0: -40, x1: 40, z0: -28.5, z1: -4.5, h: STAND }],
    screens: [{ kind: "status", x0: -24, x1: 24, z: -26.6, y0: STAND + 4, y1: STAND + 22 }],
  },
  master: {
    posture: "standing", surfaceY: 16,
    solids: [{ x0: -40, x1: 40, z0: -24.5, z1: -4.5, h: 16 }],
    screens: [
      { kind: "orchestration", x0: -36, x1: -14, z: -21, y0: 20, y1: 38, yaw: 0.4 },
      { kind: "orchestration", x0: -11, x1: 11, z: -23, y0: 20, y1: 40 },
      { kind: "orchestration", x0: 14, x1: 36, z: -21, y0: 20, y1: 38, yaw: -0.4 },
    ],
  },
};

export type StationDef = {
  id: string;
  type: StationType;
  /** how many agents work it at once (every module today seats one) */
  capacity: number;
  /** the operator's spot (its floor point; y = the surface it stands on) */
  at: V3;
  /** the operator's facing: π = north (toward its screens from the south camera), 0 = south */
  yaw: number;
  /** deterministic layout / prop variation — repeated modules never look copy-pasted */
  seed: number;
  /** what work it can host (assignment matches these, not the station's name) */
  capabilities: readonly string[];
  /** the zone (bay) it stands in */
  bay: string;
  /** the founding agent it was set up for, if any (an assignment preference, not an ownership) */
  founder?: string;
  /** how the operator gets there: the floor approach spot, then the route from it to the operator's spot */
  approach: V3 | null;
  state: StationState;
};

const N = Math.PI, S = 0;
/** THE STATIONS. Two of each kind of work on the floor, two orchestration consoles on the overlook, and four
 *  SPECIALIST sockets in the finished lakeside pavilions (built, powered down, no route yet). */
export const STATIONS: readonly StationDef[] = [
  { id: "DESIGN_01", type: "design", capacity: 1, at: v3(250, 0, -845.5), yaw: N, seed: 11, capabilities: ["design", "research", "visual"], bay: "design", founder: "nova", approach: v3(250, 0, -790), state: "active" },
  { id: "DESIGN_02", type: "design", capacity: 1, at: v3(395, 0, -845.5), yaw: N, seed: 12, capabilities: ["design", "research", "visual"], bay: "design", approach: v3(395, 0, -790), state: "idle" },
  { id: "BUILD_01", type: "build", capacity: 1, at: v3(1105, 0, -845.5), yaw: N, seed: 21, capabilities: ["build", "code", "integration"], bay: "build", founder: "milo", approach: v3(1105, 0, -790), state: "active" },
  { id: "BUILD_02", type: "build", capacity: 1, at: v3(1250, 0, -845.5), yaw: N, seed: 22, capabilities: ["build", "code", "integration"], bay: "build", approach: v3(1250, 0, -790), state: "idle" },
  { id: "QA_01", type: "review", capacity: 1, at: v3(1150, 0, -589.5), yaw: N, seed: 31, capabilities: ["review", "qa", "test"], bay: "review", founder: "pip", approach: v3(1150, 0, -545), state: "active" },
  { id: "QA_02", type: "review", capacity: 1, at: v3(1270, 0, -548.5), yaw: N, seed: 32, capabilities: ["review", "qa", "test"], bay: "review", approach: v3(1270, 0, -505), state: "idle" },
  { id: "FLEX_01", type: "flex", capacity: 1, at: v3(250, 0, -555.5), yaw: N, seed: 41, capabilities: ["general", "research", "writing", "design", "build"], bay: "flex", approach: v3(250, 0, -510), state: "idle" },
  { id: "FLEX_02", type: "flex", capacity: 1, at: v3(395, 0, -555.5), yaw: N, seed: 42, capabilities: ["general", "research", "writing", "review"], bay: "flex", approach: v3(395, 0, -510), state: "idle" },
  { id: "MASTER_01", type: "master", capacity: 1, at: v3(600, 16, -950), yaw: S, seed: 51, capabilities: ["orchestration"], bay: "overlook", approach: null, state: "idle" },
  { id: "MASTER_02", type: "master", capacity: 1, at: v3(880, 16, -950), yaw: S, seed: 52, capabilities: ["orchestration"], bay: "overlook", approach: null, state: "idle" },
  { id: "SPEC_A1", type: "specialist", capacity: 1, at: v3(176, 3, -1022), yaw: N, seed: 61, capabilities: ["specialist"], bay: "pavilion-w", approach: null, state: "future" },
  { id: "SPEC_A2", type: "specialist", capacity: 1, at: v3(244, 3, -1022), yaw: N, seed: 62, capabilities: ["specialist"], bay: "pavilion-w", approach: null, state: "future" },
  { id: "SPEC_B1", type: "specialist", capacity: 1, at: v3(1236, 3, -1022), yaw: N, seed: 63, capabilities: ["specialist"], bay: "pavilion-e", approach: null, state: "future" },
  { id: "SPEC_B2", type: "specialist", capacity: 1, at: v3(1304, 3, -1022), yaw: N, seed: 64, capabilities: ["specialist"], bay: "pavilion-e", approach: null, state: "future" },
];

// ---- the local → world transform -------------------------------------------------------------------------
/** rotate a local (x, z) by the station's yaw (π = identity: the template is authored facing north) */
export function toWorld(st: StationDef, x: number, z: number): { x: number; z: number } {
  const a = st.yaw - Math.PI, c = Math.cos(a), s = Math.sin(a);
  return { x: st.at.x + x * c + z * s, z: st.at.z - x * s + z * c };
}
/** a local box → its world axis-aligned rect (exact for the multiples of 90° stations use) */
export function boxRect(st: StationDef, b: LocalBox): Rect {
  const ps = [toWorld(st, b.x0, b.z0), toWorld(st, b.x1, b.z0), toWorld(st, b.x0, b.z1), toWorld(st, b.x1, b.z1)];
  const xs = ps.map((p) => p.x), zs = ps.map((p) => p.z);
  return { x: Math.min(...xs), z: Math.min(...zs), w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) };
}
export const stationTemplate = (st: StationDef): StationTemplate => STATION_TEMPLATES[st.type];
/** every floor-level solid every station contributes (stations on the overlook / pavilions are raised) */
export function stationSolids(): Rect[] {
  return STATIONS.filter((s) => s.at.y === 0).flatMap((s) => stationTemplate(s).solids.map((b) => boxRect(s, b)));
}
/** the work ergonomics a station node carries (avatar/monkeyMotion reads them) */
export const stationWork = (st: StationDef) => { const t = stationTemplate(st); return { seatY: t.seatY, surfaceY: t.surfaceY }; };
export const stationNodeId = (st: StationDef) => `st-${st.id.toLowerCase()}`;

// ---- ASSIGNMENT: the seam a population manager will use ---------------------------------------------------
/** Which free station suits this work? Deterministic: founders first get the one set up for them, then the
 *  lowest-numbered free station whose type or capabilities fit. Returns null when the Lab is full for it. */
export function assignStation(work: string, occupied: ReadonlySet<string>, agentId?: string): StationDef | null {
  const usable = STATIONS.filter((s) => s.state !== "future" && s.state !== "offline" && !occupied.has(s.id) && (s.type === work || s.capabilities.includes(work)));
  return usable.find((s) => s.founder === agentId) ?? usable.find((s) => s.type === work) ?? usable[0] ?? null;
}
