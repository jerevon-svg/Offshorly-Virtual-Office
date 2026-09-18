// Phase 6B — THE LIVE EVENT ORDERING, end to end, with no stubs between the wire and the body.
//
// These drive services/presence/movementSync's OWN reducers (applySnapshot / applyStarted / applyArrived)
// through the REAL adapter (adapters/v1CoworkerPositions) into the REAL world, on a clock the test moves
// by hand — and, for the parity case, drive the REAL navigation step (avatar/Controller stepAlong) as the
// local body, so "local resting yaw equals remote rendered yaw" is measured, not assumed. The only stubs
// are the GLB loader and the renderer, the same line every other Coworkers test draws.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Coworkers, facingTrace } from "./Coworkers";
import { applyLivePositions } from "../adapters/v1CoworkerPositions";
import { applyArrived, applySnapshot, applyStarted, type PeerMovementState, type Pt } from "../../../services/presence/movementSync";
import { stepAlong } from "../avatar/Controller";
import type { Avatar } from "../avatar/Avatar";
import { DIRECTION_BY_FACING } from "../adapters/v1Facing";
import { FACING_YAW, facingForYaw, wrapAngle, type Vec2 } from "../core/coords";
import type { Vo3dCoworker } from "../app/coworkers";

vi.mock("../avatar/CastPrototypes", () => ({
  prototypeFor: (id: string) =>
    Promise.resolve({ id, gltf: {} as never, scene: new THREE.Group(), clips: [] as THREE.AnimationClip[], triangles: 100, headY: 36 }),
  castLabelTexture: () => new THREE.CanvasTexture(document.createElement("canvas")),
}));

const EMAIL = "micah@offshorly.com";
const BOX = { width: 26, height: 37 };
const topLeft = (p: Vec2): Pt => ({ x: p.x - BOX.width / 2, y: p.z - BOX.height / 2 });
const T0 = 1_700_000_000_000;

let peers: Map<string, PeerMovementState>;
let cw: Coworkers;
let parent: THREE.Group;

const rosterRow = (): Vo3dCoworker => ({
  email: EMAIL, displayName: "Micah", avatarId: "micah", point: { x: 300, z: 300 }, box: BOX, posSource: "desk", facing: "south",
});
async function push(): Promise<void> {
  const set = applyLivePositions({ coworkers: [rosterRow()], missingAvatar: [] }, [...peers.values()], true, 0);
  await cw.sync(set.coworkers);
}
function frames(ms: number, step = 16): void {
  for (let spent = 0; spent < ms; spent += step) {
    vi.setSystemTime(Date.now() + step);
    cw.update(step / 1000);
  }
}
const remoteYaw = (): number => parent.getObjectByName("coworker:Micah")!.rotation.y;

let revision = 0;
function snapshot(at: Vec2, yaw?: number): void {
  peers = applySnapshot(peers, {
    serverTime: Date.now(),
    entries: [{ email: EMAIL, revision: ++revision, updatedAt: Date.now(), pos: topLeft(at), facing: "front", state: "standing", seatKey: null, roomId: null, ...(yaw !== undefined ? { yaw } : {}), active: null }],
  });
}
function started(id: string, origin: Vec2, path: Vec2[], durationMs: number): void {
  peers = applyStarted(peers, { email: EMAIL, movementId: id, revision: ++revision, origin: topLeft(origin), path: path.map(topLeft), roomId: null, durationMs, startedAt: Date.now() });
}
/** walk_arrived as browser A's publisher sends it: the four-word facing AND the exact yaw, or the word alone. */
function arrived(id: string, at: Vec2, yaw: number | undefined): void {
  const facing = yaw === undefined ? "front" : DIRECTION_BY_FACING[facingForYaw(yaw)];
  peers = applyArrived(peers, { email: EMAIL, movementId: id, revision: ++revision, at: topLeft(at), facing, state: "standing", seatKey: null, roomId: null, ...(yaw !== undefined ? { yaw } : {}) });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  peers = new Map();
  revision = 0;
  parent = new THREE.Group();
  cw = new Coworkers({ parent, canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1 });
});
afterEach(() => vi.useRealTimers());

/** THE LOCAL BODY, driven by the real navigation step at the real speed and turn rate. */
function walkLocally(origin: Vec2, path: Vec2[], speed = 70, turnRate = 7): { yaw: number; ms: number } {
  const root = new THREE.Object3D();
  root.position.set(origin.x, 0, origin.z);
  const body = { yaw: 0 };
  const avatar = { root, get yaw() { return body.yaw; }, setYaw(y: number) { body.yaw = y; root.rotation.set(0, y, 0); } } as unknown as Avatar;
  const queue = path.map((p) => ({ ...p }));
  let ms = 0;
  while (queue.length > 0 && ms < 60_000) { stepAlong(avatar, queue, speed, turnRate, 0.016); ms += 16; }
  return { yaw: body.yaw, ms };
}
const routeLength = (origin: Vec2, path: Vec2[]): number => {
  let total = 0, from = origin;
  for (const p of path) { total += Math.hypot(p.x - from.x, p.z - from.z); from = p; }
  return total;
};

describe("local resting yaw equals remote rendered yaw — the acceptance criterion, measured", () => {
  // North for 300 units, then 8 units south-east: a 135° final corner into a short final segment — the
  // shape a derived room's stand point produces (nav/planner.ts replaces the last cell centre with the
  // room's own point). At 70 u/s that segment is 8 frames; at 7 rad/s the body turns 0.9 rad of the 2.36
  // it needs, and the controller writes no yaw at all on the frame the path empties. The local rests well
  // short of the route's heading. That is the case the route-heading heuristic got wrong, and the case the
  // wire yaw gets right. (A full diagonal cell at 70 u/s happens to give the turn exactly enough frames —
  // which is why the failure was intermittent: it depended on the last segment's length.)
  const ORIGIN = { x: 600, z: 800 };
  const PATH: Vec2[] = [{ x: 600, z: 500 }, { x: 608, z: 508 }];
  const END = PATH[PATH.length - 1];

  it("sharp final corner, short final segment: the remote lands on the walker's actual yaw, not the route's", async () => {
    const local = walkLocally(ORIGIN, PATH);
    const routeHeading = Math.atan2(8, 8);
    expect(Math.abs(wrapAngle(local.yaw - routeHeading))).toBeGreaterThan(0.3); // the premise: they differ

    snapshot(ORIGIN);
    await push();
    const durationMs = (routeLength(ORIGIN, PATH) / 70) * 1000;
    started("m1", ORIGIN, PATH, durationMs);
    await push();
    frames(durationMs + 50);
    arrived("m1", END, wrapAngle(local.yaw));
    await push();
    frames(600);
    expect(Math.abs(wrapAngle(remoteYaw() - local.yaw))).toBeLessThan(0.02);
    expect(Math.abs(wrapAngle(remoteYaw() - local.yaw))).toBeLessThan(1e-6);
  });

  it("holds whether the arrival lands BEFORE or AFTER the replay's own clock runs out", async () => {
    const local = walkLocally(ORIGIN, PATH);
    for (const arriveAt of [0.9, 1.2]) {
      peers = new Map(); revision = 0;
      parent = new THREE.Group();
      cw = new Coworkers({ parent, canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1 });
      snapshot(ORIGIN);
      await push();
      const durationMs = (routeLength(ORIGIN, PATH) / 70) * 1000;
      started("m1", ORIGIN, PATH, durationMs);
      await push();
      frames(durationMs * arriveAt);
      arrived("m1", END, wrapAngle(local.yaw));
      await push();
      for (let i = 0; i < 40; i++) { await push(); frames(16); } // the roster stream that follows
      expect(Math.abs(wrapAngle(remoteYaw() - local.yaw)), `arrival at ${arriveAt}×`).toBeLessThan(1e-6);
      expect(cw.moving).toBe(false);
    }
  });

  it("V1→V2: an arrival with no yaw (a 2D walker) falls back to the four-word facing, exactly as before", async () => {
    snapshot(ORIGIN);
    await push();
    started("m1", ORIGIN, PATH, 3000);
    await push();
    frames(3100);
    arrived("m1", END, undefined);
    await push();
    frames(600);
    expect(remoteYaw()).toBe(FACING_YAW.south); // "front"
    expect(facingTrace().at(-1)).toMatchObject({ movementId: "m1", receivedYaw: null, facing: "south" });
  });

  it("reload/reconnect: a positions_snapshot carrying the yaw stands the body at exactly that yaw", async () => {
    snapshot(END, -2.3561944901923448);
    await push();
    expect(remoteYaw()).toBe(-2.3561944901923448);
    // ...and a snapshot from a pre-6B row still stands them on the compass word.
    peers = new Map();
    parent = new THREE.Group();
    cw = new Coworkers({ parent, canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1 });
    snapshot(END);
    await push();
    expect(remoteYaw()).toBe(FACING_YAW.south);
  });

  it("walks smoothly throughout: the body is on its route, not at either end of it (Phase 6A, re-measured)", async () => {
    snapshot(ORIGIN);
    await push();
    started("m1", ORIGIN, [{ x: 700, z: 800 }], 3000);
    await push();
    const seen: number[] = [];
    for (let i = 0; i < 10; i++) { frames(250); await push(); seen.push(cw.positions()[0].x); }
    expect(seen[0]).toBeGreaterThan(ORIGIN.x);
    expect(seen[9]).toBeLessThan(700);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
  });
});
