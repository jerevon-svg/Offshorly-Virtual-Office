// Phase 6C — THE A/B MISMATCH, reproduced end to end and pinned.
//
// Browser A sat; browser B stood the same person beside the chair. The chain is: A's feed → A's sink
// (adapters/v1SelfMovement, REAL) → the wire payload → the backend relay (shape only) → B's reducer
// (services/presence/movementSync, REAL) → B's position adapter (REAL, real seat mapping) → B's Coworkers
// (REAL). Only the socket emit and the GLB loader are stubbed. The one link this cannot exercise is the
// world's own sink wrapper, which is a closure inside app/world.ts — world.seatWiring.test.ts pins that
// line by source, because that line was the bug.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

const emitWalkStarted = vi.fn();
const emitWalkArrived = vi.fn();
vi.mock("./../../services/presence/movementSync", async () => {
  const actual = await vi.importActual<typeof import("../../services/presence/movementSync")>("../../services/presence/movementSync");
  return { ...actual, emitWalkStarted: (...a: unknown[]) => emitWalkStarted(...a), emitWalkArrived: (...a: unknown[]) => emitWalkArrived(...a) };
});
vi.mock("./avatar/CastPrototypes", () => ({
  prototypeFor: (id: string) =>
    Promise.resolve({ id, gltf: {} as never, scene: new THREE.Group(), clips: ["idle-9", "sit-on-chair-arms", "walking"].map((n) => new THREE.AnimationClip(n, 1, [])), triangles: 100, headY: 36 }),
  castLabelTexture: () => new THREE.CanvasTexture(document.createElement("canvas")),
}));

import { createV1SelfMovementSink, resolveV1SelfPosition } from "./adapters/v1SelfMovement";
import { applyLivePositions } from "./adapters/v1CoworkerPositions";
import { anchorForSeatKey, isV2SeatKey, v1SeatForAnchor, v2SeatKey } from "./adapters/v1Seats";
import { SelfMovementFeed } from "./app/selfMovement";
import { Coworkers, type SeatAnchorPose } from "./world/Coworkers";
import { applyArrived, applyStarted, type PeerMovementState } from "../../services/presence/movementSync";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../auth/currentUserStore";
import { __resetCurrentUserIdForTest } from "../../auth/useAuthGate";
import { bonLayer } from "../../data/office-layout";
import { resolveSpawnPlacement } from "../../components/OfficeMap/spawnPlacement";
import { computeEmptySeats } from "../../data/emptySeats";
import { CLIP_SIT } from "./adapters/v1Avatar";
import { __resetSeatFacingForTests, SEAT_FACINGS, seatFacingYaw, seatedYawFor, setSeatFacingOverride } from "./app/seats";
import { FACING_YAW } from "./core/coords";
import type { Vo3dCoworker } from "./app/coworkers";

const BON = "jerevon@offshorly.com";
const BOX = { width: bonLayer.width, height: bonLayer.height };
const MAPPED = "dev-room/bay-chair-s5"; // faces north; V1 knows it
const V2_ONLY = "central-hub/cafe-chair-0-north"; // V1 has no seats in the hub

let peers: Map<string, PeerMovementState>;
let revision = 0;
let parent: THREE.Group;
let cw: Coworkers;
// The world answers a peer's pose with the CONFIGURED yaw (app/world.ts peerSeatAnchor → seatedYawFor); the
// stub does the same, over the authored yaws the two chairs carry.
const contacts: Record<string, { contact: THREE.Vector3; authoredYaw: number }> = {
  [MAPPED]: { contact: new THREE.Vector3(1345.7, 15, 235.78), authoredYaw: FACING_YAW.north },
  [V2_ONLY]: { contact: new THREE.Vector3(700, 15, 600), authoredYaw: 0.7 },
};
const poses = new Proxy({} as Record<string, SeatAnchorPose>, {
  get: (_t, id: string) => (contacts[id] ? { contact: contacts[id].contact, yaw: seatedYawFor(id, contacts[id].authoredYaw), kind: "seat" as const } : undefined),
});

/** BROWSER A: a real feed over a real sink. Returns the payload the wire would carry. */
function browserASits(anchor: string, bodyAt: { x: number; z: number }, yaw: number) {
  setCurrentUserFromMeResponse({ id: "atlas-1", email: BON, full_name: "Bon", role: "dev", team: null });
  const sink = createV1SelfMovementSink()!;
  const feed = new SelfMovementFeed(sink);
  feed.frame(16, { x: bodyAt.x - 30, z: bodyAt.z }, 0, false);
  // the approach walk — an interaction stepping the body — then the seat
  for (let i = 1; i <= 20; i++) feed.frame(16, { x: bodyAt.x - 30 + i * 1.5, z: bodyAt.z }, 0, false);
  feed.seated(bodyAt, yaw, anchor);
  for (let i = 0; i < 60; i++) feed.frame(16, bodyAt, yaw, false); // the held arrival goes out
  const started = emitWalkStarted.mock.calls.at(-1)![0];
  const arrived = emitWalkArrived.mock.calls.at(-1)![0];
  expect(arrived.movementId).toBe(started.movementId);
  return { started, arrived };
}

/** THE BACKEND: relays what it validated, plus identity and revision. */
function relay(started: Record<string, unknown>, arrived: Record<string, unknown>): void {
  peers = applyStarted(peers, { email: BON, revision: ++revision, startedAt: Date.now(), ...(started as object) } as never);
  peers = applyArrived(peers, { email: BON, revision: ++revision, ...(arrived as object) } as never);
}

/** BROWSER B: the roster row for Bon, the live overlay, the world's coworkers. */
async function browserBSyncs(): Promise<Vo3dCoworker> {
  const roster: Vo3dCoworker = { email: BON, displayName: "Bon", avatarId: "bon", point: { x: 300, z: 300 }, box: BOX, posSource: "desk", facing: "south" };
  const set = applyLivePositions({ coworkers: [roster], missingAvatar: [] }, [...peers.values()], true, 0);
  await cw.sync(set.coworkers);
  return set.coworkers[0];
}
const body = () => parent.getObjectByName("coworker:Bon")!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  resetCurrentUserForTests();
  __resetCurrentUserIdForTest();
  emitWalkStarted.mockClear();
  emitWalkArrived.mockClear();
  peers = new Map();
  revision = 0;
  parent = new THREE.Group();
  cw = new Coworkers({ parent, canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1, seatAnchor: (id) => poses[id] ?? null });
});
afterEach(() => {
  vi.useRealTimers();
  resetCurrentUserForTests();
  __resetCurrentUserIdForTest();
  __resetSeatFacingForTests();
});

describe("A sits on a chair V1 knows; B shows the same chair, seated", () => {
  it("the payload is a SITTING arrival with V1's key, and B seats the body at that chair's pose", async () => {
    const v1Seat = v1SeatForAnchor(MAPPED)!;
    const { arrived } = browserASits(MAPPED, { x: 1345.7, z: 240 }, FACING_YAW.north);
    // what left A
    expect(arrived.state).toBe("sitting");
    expect(arrived.seatKey).toBe(v1Seat.key);
    expect(arrived.at).toEqual({ x: v1Seat.x - BOX.width / 2, y: v1Seat.y - BOX.height / 2 });
    expect(arrived.yaw).toBe(FACING_YAW.north);
    relay(emitWalkStarted.mock.calls.at(-1)![0], arrived);
    // what B resolves
    const coworker = await browserBSyncs();
    expect(coworker.seat).toBe(MAPPED);
    expect(body().position.x).toBeCloseTo(poses[MAPPED].contact.x, 6);
    expect(body().position.z).toBeCloseTo(poses[MAPPED].contact.z, 6);
    expect(body().position.y).toBeGreaterThan(0);
    expect(body().rotation.y).toBe(FACING_YAW.north);
    expect(cw.positions()[0].clip).toBe(CLIP_SIT);
    // and A's own reload restores the same chair
    expect(resolveV1SelfPosition([...peers.values()], true)!.seat).toBe(MAPPED);
  });

  it("REGRESSION — the observed mismatch: a sit forwarded WITHOUT its seat is a standing arrival, and B stands the body", async () => {
    // This is what app/world.ts's wrapper did when it dropped the fourth argument.
    setCurrentUserFromMeResponse({ id: "atlas-1", email: BON, full_name: "Bon", role: "dev", team: null });
    const sink = createV1SelfMovementSink()!;
    sink.started({ x: 1300, z: 240 }, [{ x: 1345.7, z: 240 }], 500);
    sink.arrived({ x: 1345.7, z: 240 }, "north", FACING_YAW.north /* no seat */);
    const arrived = emitWalkArrived.mock.calls.at(-1)![0];
    expect(arrived.state).toBe("standing");
    relay(emitWalkStarted.mock.calls.at(-1)![0], arrived);
    const coworker = await browserBSyncs();
    expect(coworker.seat).toBeUndefined();
    expect(body().position.y).toBe(0); // beside the chair, on the floor — the bug's symptom
  });
});

describe("A sits on a V2-ONLY seat; B shows the same seat, seated; V1 stays honest", () => {
  it("the payload is SITTING under the namespaced key at the body's true position, and B seats the body", async () => {
    expect(v1SeatForAnchor(V2_ONLY)).toBeNull(); // the premise: V1 has no chair here
    // A's world hands the feed the CONFIGURED yaw (seatedYawOf), never the authored 0.7.
    const { arrived } = browserASits(V2_ONLY, { x: 700, z: 600 }, seatedYawFor(V2_ONLY, 0.7));
    expect(arrived.state).toBe("sitting");
    expect(arrived.seatKey).toBe(v2SeatKey(V2_ONLY));
    expect(isV2SeatKey(arrived.seatKey)).toBe(true);
    expect(arrived.at).toEqual({ x: 700 - BOX.width / 2, y: 600 - BOX.height / 2 });
    relay(emitWalkStarted.mock.calls.at(-1)![0], arrived);
    const coworker = await browserBSyncs();
    expect(coworker.seat).toBe(V2_ONLY);
    expect(body().position.y).toBeGreaterThan(0);
    expect(body().rotation.y).toBe(seatedYawFor(V2_ONLY, 0.7)); // the configured facing, not the authored 0.7
    expect(cw.positions()[0].clip).toBe(CLIP_SIT);
    expect(anchorForSeatKey(arrived.seatKey)!.id).toBe(V2_ONLY);
    expect(resolveV1SelfPosition([...peers.values()], true)!.seat).toBe(V2_ONLY);
  });

  it("V1 tolerates the namespaced key: it collides with no painted seat, hides none, and its restore falls back to the desk", () => {
    const key = v2SeatKey(V2_ONLY);
    // V1's occupancy read adds the key to a set; computeEmptySeats hides only seats whose centroid key is in it.
    const before = computeEmptySeats(new Set()).length;
    expect(computeEmptySeats(new Set([key])).length).toBe(before);
    // V1's own spawn restore: a sitting row with a key it cannot find → its existing "desk" fallback, no throw.
    const placement = resolveSpawnPlacement("CHECKED_IN", "IDLE", { pos: { x: 700, y: 600 }, facing: "front", state: "sitting", seatKey: key, roomId: null }, {
      avatarSize: { w: BOX.width, h: BOX.height }, isInsideOffice: () => true, isWalkable: () => true, isRoomLocked: () => false, findSeat: () => null,
    });
    expect(placement).toEqual({ kind: "desk" });
    // and a key nobody can resolve (a future anchor) still degrades to standing at the position, not a crash
    expect(anchorForSeatKey("v2:nowhere/chair")).toBeNull();
  });
});

describe("the configured facing is what EVERY browser shows — all four directions", () => {
  for (const word of SEAT_FACINGS) {
    it(`${word}: local yaw = published yaw = published V1 word = peer rotation = restore`, async () => {
      setSeatFacingOverride(MAPPED, word);
      const yaw = seatFacingYaw(word);
      // A's local interaction sits at the configured yaw (app/world.ts seatSpecFor) and the world publishes
      // seatedYawOf(anchor), which is the same function — so the feed is handed exactly this yaw.
      expect(seatedYawFor(MAPPED, FACING_YAW.north)).toBe(yaw);
      const { arrived } = browserASits(MAPPED, { x: 1345.7, z: 240 }, yaw);
      expect(arrived.state).toBe("sitting");
      expect(arrived.yaw).toBe(yaw);
      expect(arrived.facing).toBe(word); // V1 shows the same direction
      relay(emitWalkStarted.mock.calls.at(-1)![0], arrived);
      await browserBSyncs();
      expect(body().rotation.y).toBe(yaw); // B's peer body faces the configured way
      expect(body().position.y).toBeGreaterThan(0); // still seated, same cushion
      expect(body().position.x).toBeCloseTo(contacts[MAPPED].contact.x, 6);
      expect(cw.positions()[0].clip).toBe(CLIP_SIT);
      // and A's own reload comes back into the same anchor, whose interaction takes the configured yaw
      expect(resolveV1SelfPosition([...peers.values()], true)!.seat).toBe(MAPPED);
    });
  }

  it("a V2-only cushion honours an override too, and a change re-poses an already-seated peer in place", async () => {
    setSeatFacingOverride(V2_ONLY, "left");
    const { arrived } = browserASits(V2_ONLY, { x: 700, z: 600 }, seatFacingYaw("left"));
    expect(arrived.facing).toBe("left");
    relay(emitWalkStarted.mock.calls.at(-1)![0], arrived);
    await browserBSyncs();
    expect(body().rotation.y).toBe(seatFacingYaw("left"));
    const before = { x: body().position.x, y: body().position.y, z: body().position.z };
    setSeatFacingOverride(V2_ONLY, "back");
    expect(cw.reposeSeated(V2_ONLY)).toBe(true);
    expect(body().rotation.y).toBe(seatFacingYaw("back"));
    expect(body().position.y).toBe(before.y); // height unchanged
    expect(cw.positions()[0].clip).toBe(CLIP_SIT); // still seated
  });
});
