// Phase 6B — PLAYER MODE AS A PEER SEES IT: a run is a chain of 400 ms legs (app/selfMovement.ts), each
// published as one V1 movement with `pacing: "linear"`. Before this phase every leg was replayed on V1's
// ease (velocity zero at both ends) and the body dropped to idle between legs, restarting the walk clip —
// the "moving, pausing, moving" browser B recorded. These drive the real reducers and the real adapter,
// with a prototype that HAS clips so the animation state is observable, not just the position.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Coworkers } from "./Coworkers";
import { applyLivePositions } from "../adapters/v1CoworkerPositions";
import { applyArrived, applySnapshot, applyStarted, type PeerMovementState, type Pt } from "../../../services/presence/movementSync";
import { CLIP_IDLE, CLIP_RUN, CLIP_WALK } from "../adapters/v1Avatar";
import type { Vec2 } from "../core/coords";
import type { Vo3dCoworker } from "../app/coworkers";

const clip = (name: string) => new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack(".position[y]", [0, 1], [0, 0])]);
vi.mock("../avatar/CastPrototypes", () => ({
  prototypeFor: (id: string) => {
    const mk = (n: string) => new THREE.AnimationClip(n, 1, [new THREE.NumberKeyframeTrack(".position[y]", [0, 1], [0, 0])]);
    return Promise.resolve({ id, gltf: {} as never, scene: new THREE.Group(), clips: [mk("idle-9"), mk("walking"), mk("running")], triangles: 100, headY: 36 });
  },
  castLabelTexture: () => new THREE.CanvasTexture(document.createElement("canvas")),
}));
void clip;

const EMAIL = "micah@offshorly.com";
const BOX = { width: 26, height: 37 };
const topLeft = (p: Vec2): Pt => ({ x: p.x - BOX.width / 2, y: p.z - BOX.height / 2 });
const T0 = 1_700_000_000_000;
const LEG_MS = 400;

let peers: Map<string, PeerMovementState>;
let cw: Coworkers;
let revision = 0;

const rosterRow = (): Vo3dCoworker => ({
  email: EMAIL, displayName: "Micah", avatarId: "micah", point: { x: 300, z: 300 }, box: BOX, posSource: "desk", facing: "south",
});
async function push(): Promise<void> {
  const set = applyLivePositions({ coworkers: [rosterRow()], missingAvatar: [] }, [...peers.values()], true, 0);
  await cw.sync(set.coworkers);
}
const row = () => cw.positions()[0];
/** Advance wall clock and frames together; returns one sample per frame of (x, clip). */
function frames(ms: number, step = 16): { x: number; clip: string }[] {
  const out: { x: number; clip: string }[] = [];
  for (let spent = 0; spent < ms; spent += step) {
    vi.setSystemTime(Date.now() + step);
    cw.update(step / 1000);
    out.push({ x: row().x, clip: row().clip });
  }
  return out;
}
function snapshot(at: Vec2): void {
  peers = applySnapshot(peers, { serverTime: Date.now(), entries: [{ email: EMAIL, revision: ++revision, updatedAt: Date.now(), pos: topLeft(at), facing: "front", state: "standing", seatKey: null, roomId: null, active: null }] });
}
/** One published leg from `from`, `speed` units/s east for LEG_MS, sampled every 12 units like the publisher. */
function legPath(from: Vec2, speed: number): Vec2[] {
  const total = (speed * LEG_MS) / 1000;
  const pts: Vec2[] = [];
  for (let d = 12; d < total; d += 12) pts.push({ x: from.x + d, z: from.z });
  pts.push({ x: from.x + total, z: from.z });
  return pts;
}
/** `pacing: "eased"` publishes the movement UNMARKED, exactly as a planned walk or a V1 client does. */
function startLeg(id: string, from: Vec2, speed: number, pacing: "linear" | "eased" = "linear"): Vec2 {
  const path = legPath(from, speed);
  peers = applyStarted(peers, { email: EMAIL, movementId: id, revision: ++revision, origin: topLeft(from), path: path.map(topLeft), roomId: null, durationMs: LEG_MS, startedAt: Date.now(), ...(pacing === "linear" ? { pacing } : {}) });
  return path[path.length - 1];
}
function arriveLeg(id: string, at: Vec2, yaw = Math.PI / 2): void {
  peers = applyArrived(peers, { email: EMAIL, movementId: id, revision: ++revision, at: topLeft(at), facing: "right", state: "standing", seatKey: null, roomId: null, yaw });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  peers = new Map();
  revision = 0;
  cw = new Coworkers({ parent: new THREE.Group(), canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1 });
});
afterEach(() => vi.useRealTimers());

describe("a continuous run, published as consecutive linear legs", () => {
  it("is continuous remotely: constant speed within a leg, no idle between legs, no backwards step", async () => {
    snapshot({ x: 600, z: 500 });
    await push();
    let from = { x: 600, z: 500 };
    const samples: { x: number; clip: string }[] = [];
    let end = startLeg("m1", from, 100);
    await push();
    for (let k = 1; k <= 4; k++) {
      samples.push(...frames(LEG_MS));
      // The publisher's pairing: this leg's arrival and the next leg's start land together, one hop later.
      arriveLeg(`m${k}`, end);
      await push();
      from = end;
      if (k < 4) { end = startLeg(`m${k + 1}`, from, 100); await push(); }
    }
    // POSITION: never backwards, and per-frame speed never dips the way the ease did (which went to zero
    // at every leg boundary — 40% of frames under half the mean).
    const speeds: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].x, `frame ${i}`).toBeGreaterThanOrEqual(samples[i - 1].x);
      speeds.push((samples[i].x - samples[i - 1].x) / 0.016);
    }
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const slow = speeds.filter((v) => v < mean * 0.5).length;
    expect(slow).toBeLessThanOrEqual(4); // at most the four leg-boundary frames themselves
    // ANIMATION: a sprint is a RUN, and it never idles between legs.
    expect(samples.every((s) => s.clip === CLIP_RUN)).toBe(true);
    // ...and once the last arrival has landed and nothing follows, the body stops — after the grace, not before.
    frames(100);
    expect(row().clip).toBe(CLIP_RUN);
    frames(200);
    expect(row().clip).toBe(CLIP_IDLE);
    expect(row().x).toBeCloseTo(end.x, 6);
  });

  it("network jitter: the next leg landing after the last one ran out holds the pose instead of idling", async () => {
    snapshot({ x: 600, z: 500 });
    await push();
    const end1 = startLeg("m1", { x: 600, z: 500 }, 100);
    await push();
    frames(LEG_MS);
    const late = frames(64); // 64 ms with nothing from the wire: the leg has run out
    expect(late.every((s) => s.clip === CLIP_RUN)).toBe(true); // frozen in its run pose, not idle
    expect(late.every((s) => s.x === late[0].x)).toBe(true); // and not extrapolated an inch
    arriveLeg("m1", end1);
    await push();
    const end2 = startLeg("m2", end1, 100);
    await push();
    const resumed = frames(LEG_MS);
    expect(resumed[0].clip).toBe(CLIP_RUN);
    expect(resumed.every((s, i) => i === 0 || s.x >= resumed[i - 1].x)).toBe(true);
    expect(resumed.at(-1)!.x).toBeCloseTo(end2.x, 1);
  });

  it("walk → run → idle: the clip follows each movement's mean speed, and stops when the run does", async () => {
    snapshot({ x: 600, z: 500 });
    await push();
    const end1 = startLeg("m1", { x: 600, z: 500 }, 70);
    await push();
    expect(frames(LEG_MS).every((s) => s.clip === CLIP_WALK)).toBe(true);
    arriveLeg("m1", end1);
    await push();
    const end2 = startLeg("m2", end1, 100);
    await push();
    expect(frames(LEG_MS).every((s) => s.clip === CLIP_RUN)).toBe(true);
    arriveLeg("m2", end2, 1.3);
    await push();
    frames(400);
    expect(row().clip).toBe(CLIP_IDLE);
    expect(row().yaw).toBeCloseTo(1.3, 3); // and faces exactly what the runner published
  });

  it("stale and duplicate events change nothing: a lower revision is refused by the store, a re-push by the world", async () => {
    snapshot({ x: 600, z: 500 });
    await push();
    const end1 = startLeg("m1", { x: 600, z: 500 }, 100);
    await push();
    frames(LEG_MS);
    arriveLeg("m1", end1);
    await push();
    startLeg("m2", end1, 100);
    await push();
    frames(200);
    const mid = row();
    // An arrival for m1 that was delayed on the network: its revision is older than the store's.
    peers = applyArrived(peers, { email: EMAIL, movementId: "m1", revision: 1, at: topLeft(end1), facing: "right", state: "standing", seatKey: null, roomId: null });
    await push();
    await push(); // and the unchanged roster, twice
    expect(row()).toEqual(mid);
    expect(cw.moving).toBe(true);
  });

  it("a redirect mid-leg — an arrival somewhere the leg never reached — snaps and stops, as it always did", async () => {
    snapshot({ x: 600, z: 500 });
    await push();
    startLeg("m1", { x: 600, z: 500 }, 100);
    await push();
    frames(200);
    arriveLeg("m1", { x: 900, z: 900 }, 0.4);
    await push();
    expect(cw.moving).toBe(false);
    expect(row()).toMatchObject({ x: 900, z: 900 });
    frames(300);
    expect(row().clip).toBe(CLIP_IDLE);
    expect(row().yaw).toBeCloseTo(0.4, 3);
  });

  it("does not touch Phase 6A: a planned (eased, unmarked) walk still eases and idles the moment it ends", async () => {
    snapshot({ x: 600, z: 500 });
    await push();
    const end = startLeg("m1", { x: 600, z: 500 }, 100, "eased");
    await push();
    const s = frames(LEG_MS);
    const first = s[1].x - s[0].x;
    const middle = s[13].x - s[12].x;
    expect(first).toBeLessThan(middle / 3); // eased: slow off the line, fast in the middle
    // Locomotion every frame of the route, and idle ON the frame it ends — no grace for a walk that was
    // never a leg. (The route runs out on the 25th frame, whose sample is taken after the idle switch.)
    expect(s.slice(0, -1).every((x) => x.clip === CLIP_RUN || x.clip === CLIP_WALK)).toBe(true);
    expect(s.at(-1)!.clip).toBe(CLIP_IDLE);
    expect(row().x).toBeCloseTo(end.x, 6);
  });
});
