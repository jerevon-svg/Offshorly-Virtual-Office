// Phase 6C — TWO-SESSION SEATING, end to end from the wire to the body.
//
// Browser A's publisher is adapters/v1SelfMovement (its own tests pin what goes out); this is browser B:
// V1's own reducers → the real position adapter (with the real seat mapping) → the real Coworkers module,
// with a world-side seat anchor stub standing in for app/world.ts's chair views. Same stubs as
// Coworkers.live.test.ts: the GLB loader and the renderer, nothing else.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Coworkers, type SeatAnchorPose } from "./Coworkers";
import { applyLivePositions } from "../adapters/v1CoworkerPositions";
import { v1SeatForAnchor } from "../adapters/v1Seats";
import { applyArrived, applySnapshot, applyStarted, type PeerMovementState, type Pt } from "../../../services/presence/movementSync";
import { CLIP_IDLE, CLIP_SIT, CLIP_WALK } from "../adapters/v1Avatar";
import { FACING_YAW, type Vec2 } from "../core/coords";
import type { Vo3dCoworker } from "../app/coworkers";

const clips = [CLIP_IDLE, CLIP_SIT, CLIP_WALK].map((name) => new THREE.AnimationClip(name, 1, []));
vi.mock("../avatar/CastPrototypes", () => ({
  prototypeFor: (id: string) =>
    Promise.resolve({ id, gltf: {} as never, scene: new THREE.Group(), clips: [CLIP_IDLE, CLIP_SIT, CLIP_WALK].map((name) => new THREE.AnimationClip(name, 1, [])), triangles: 100, headY: 36 }),
  castLabelTexture: () => new THREE.CanvasTexture(document.createElement("canvas")),
}));
void clips;

const EMAIL = "alex@offshorly.com";
const BOX = { width: 26, height: 37 };
const topLeft = (p: Vec2): Pt => ({ x: p.x - BOX.width / 2, y: p.z - BOX.height / 2 });

/** Four chairs, one per facing, and the poses the "world" answers for them. */
const CHAIRS = {
  south: "dev-room/bay-chair-n1",
  north: "dev-room/bay-chair-s1",
  east: "ai-room/lead-chair",
  west: "qa-room/lead-chair",
} as const;

let peers: Map<string, PeerMovementState>;
let cw: Coworkers;
let parent: THREE.Group;
let anchors: Record<string, SeatAnchorPose>;
let released: string[];

const rosterRow = (): Vo3dCoworker => ({ email: EMAIL, displayName: "Alex", avatarId: "alex", point: { x: 300, z: 300 }, box: BOX, posSource: "desk", facing: "south" });
async function push(): Promise<void> {
  const set = applyLivePositions({ coworkers: [rosterRow()], missingAvatar: [] }, [...peers.values()], true, 0);
  await cw.sync(set.coworkers);
}
const body = () => parent.getObjectByName("coworker:Alex")!;

let revision = 0;
function snapshot(at: Vec2): void {
  peers = applySnapshot(peers, { serverTime: Date.now(), entries: [{ email: EMAIL, revision: ++revision, updatedAt: Date.now(), pos: topLeft(at), facing: "front", state: "standing", seatKey: null, roomId: null, active: null }] });
}
function started(id: string, origin: Vec2, path: Vec2[]): void {
  peers = applyStarted(peers, { email: EMAIL, movementId: id, revision: ++revision, origin: topLeft(origin), path: path.map(topLeft), roomId: null, durationMs: 500, startedAt: Date.now() });
}
/** walk_arrived as V2's publisher sends a SIT: state sitting, V1's seat key, the centroid, the chair's yaw. */
function satDown(id: string, anchorId: string, yaw?: number): void {
  const seat = v1SeatForAnchor(anchorId)!;
  peers = applyArrived(peers, { email: EMAIL, movementId: id, revision: ++revision, at: topLeft({ x: seat.x, z: seat.y }), facing: seat.direction, state: "sitting", seatKey: seat.key, roomId: seat.roomId, ...(yaw !== undefined ? { yaw } : {}) });
}
function stoodAt(id: string, at: Vec2): void {
  peers = applyArrived(peers, { email: EMAIL, movementId: id, revision: ++revision, at: topLeft(at), facing: "front", state: "standing", seatKey: null, roomId: null });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  peers = new Map();
  revision = 0;
  released = [];
  parent = new THREE.Group();
  anchors = {};
  for (const [facing, id] of Object.entries(CHAIRS)) {
    const seat = v1SeatForAnchor(id)!;
    expect(seat, `${id} must be a mapped chair`).not.toBeNull();
    anchors[id] = { contact: new THREE.Vector3(seat.x, 15, seat.y), yaw: FACING_YAW[facing as keyof typeof CHAIRS], kind: "seat" };
  }
  cw = new Coworkers({
    parent, canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1,
    seatAnchor: (id) => anchors[id] ?? null,
    releaseSeat: (id) => { released.push(id); },
  });
});
afterEach(() => vi.useRealTimers());

describe("a peer sits down", () => {
  it("is put on the chair's cushion at the chair's own yaw, playing the seated clip", async () => {
    snapshot({ x: 300, z: 300 });
    await push();
    expect(body().position.y).toBe(0);
    started("m1", { x: 300, z: 300 }, [{ x: 320, z: 300 }]);
    await push();
    satDown("m1", CHAIRS.south, FACING_YAW.south);
    await push();
    const pose = anchors[CHAIRS.south];
    expect(body().position.x).toBeCloseTo(pose.contact.x, 6);
    expect(body().position.z).toBeCloseTo(pose.contact.z, 6);
    expect(body().position.y).toBeGreaterThan(0); // on the cushion, not the floor
    expect(body().rotation.y).toBe(FACING_YAW.south);
    expect(cw.positions()[0].clip).toBe(CLIP_SIT);
    expect(cw.positions()[0].seat).toBe(CHAIRS.south);
    expect(cw.getStats().seated).toBe(1);
    // a frame does not idle the body back out of the chair
    cw.update(0.016);
    expect(cw.positions()[0].clip).toBe(CLIP_SIT);
    expect(body().position.y).toBeGreaterThan(0);
  });

  it("faces the chair — all four directions — and never a universal sitting yaw", async () => {
    for (const [facing, id] of Object.entries(CHAIRS) as [keyof typeof CHAIRS, string][]) {
      snapshot({ x: 300, z: 300 });
      await push();
      started(`m-${facing}`, { x: 300, z: 300 }, [{ x: 310, z: 300 }]);
      await push();
      satDown(`m-${facing}`, id, FACING_YAW[facing]);
      await push();
      expect(body().rotation.y, facing).toBe(FACING_YAW[facing]);
      expect(cw.positions()[0].seat, facing).toBe(id);
    }
  });

  it("V1 compatibility: a V1 client's sitting arrival (no yaw) seats the body at the chair's own yaw", async () => {
    snapshot({ x: 300, z: 300 });
    await push();
    started("m1", { x: 300, z: 300 }, [{ x: 320, z: 300 }]);
    await push();
    satDown("m1", CHAIRS.north); // no yaw on the wire — V1 has none to send
    await push();
    expect(body().rotation.y).toBe(FACING_YAW.north);
    expect(cw.positions()[0].clip).toBe(CLIP_SIT);
  });

  it("a newcomer already seated (first sync of a session) is created in the chair", async () => {
    started("m1", { x: 300, z: 300 }, [{ x: 320, z: 300 }]);
    satDown("m1", CHAIRS.east, FACING_YAW.east);
    await push();
    expect(body().position.y).toBeGreaterThan(0);
    expect(body().rotation.y).toBe(FACING_YAW.east);
    expect(cw.positions()[0].seat).toBe(CHAIRS.east);
  });

  it("a V2-ONLY seat (namespaced key) seats the body at that anchor's pose", async () => {
    const id = "central-hub/cafe-chair-0-north";
    anchors[id] = { contact: new THREE.Vector3(700, 15, 600), yaw: 0.7, kind: "seat" };
    snapshot({ x: 300, z: 300 });
    await push();
    started("m1", { x: 300, z: 300 }, [{ x: 700, z: 600 }]);
    await push();
    peers = applyArrived(peers, { email: EMAIL, movementId: "m1", revision: ++revision, at: topLeft({ x: 700, z: 600 }), facing: "front", state: "sitting", seatKey: `v2:${id}`, roomId: null, yaw: 0.7 });
    await push();
    expect(cw.positions()[0].seat).toBe(id);
    expect(body().position.y).toBeGreaterThan(0);
    expect(body().rotation.y).toBe(0.7);
    expect(cw.positions()[0].clip).toBe(CLIP_SIT);
  });

  it("a sitter in a chair V2 cannot identify is drawn STANDING at V1's centroid, honestly", async () => {
    snapshot({ x: 300, z: 300 });
    await push();
    started("m1", { x: 300, z: 300 }, [{ x: 320, z: 300 }]);
    await push();
    peers = applyArrived(peers, { email: EMAIL, movementId: "m1", revision: ++revision, at: topLeft({ x: 320, z: 300 }), facing: "front", state: "sitting", seatKey: "1,1", roomId: null });
    await push();
    expect(cw.positions()[0].seat).toBeNull();
    expect(body().position.y).toBe(0);
    expect(cw.getStats().seated).toBe(0);
  });
});

describe("a peer stands up", () => {
  it("the walk_started that follows stands the body up, releases the chair, and replays the walk", async () => {
    snapshot({ x: 300, z: 300 });
    await push();
    started("m1", { x: 300, z: 300 }, [{ x: 320, z: 300 }]);
    await push();
    satDown("m1", CHAIRS.south, FACING_YAW.south);
    await push();
    started("m2", { x: 320, z: 300 }, [{ x: 400, z: 300 }]);
    await push();
    expect(released).toEqual([CHAIRS.south]);
    expect(body().position.y).toBe(0);
    expect(cw.positions()[0].seat).toBeNull();
    expect(cw.moving).toBe(true);
    cw.update(0.6);
    stoodAt("m2", { x: 400, z: 300 });
    await push();
    for (let i = 0; i < 40; i++) cw.update(0.016);
    expect(cw.positions()[0].clip).toBe(CLIP_IDLE);
    expect(cw.getStats().seated).toBe(0);
  });

  it("re-pushing the same seated row leaves the body untouched (no re-seat per snapshot tick)", async () => {
    started("m1", { x: 300, z: 300 }, [{ x: 320, z: 300 }]);
    satDown("m1", CHAIRS.west, FACING_YAW.west);
    await push();
    const before = body().position.clone();
    await push();
    await push();
    expect(body().position.equals(before)).toBe(true);
    expect(released).toEqual([]);
  });

  it("a seated peer leaving the roster releases the chair", async () => {
    started("m1", { x: 300, z: 300 }, [{ x: 320, z: 300 }]);
    satDown("m1", CHAIRS.west, FACING_YAW.west);
    await push();
    await cw.sync([]);
    expect(released).toEqual([CHAIRS.west]);
    expect(cw.size).toBe(0);
  });
});
