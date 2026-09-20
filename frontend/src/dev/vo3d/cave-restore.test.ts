import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CaveTransition } from "./interact/CaveTransition";
import { SPAWN } from "./rooms/cave";

// PHASE 7D — RESTORING SOMEBODY WHO WAS ALREADY IN THE CAVE.
//
// A reload is not a transition. The world has not been drawn yet, so there is nothing to fade; nobody is
// being taken from anybody, so there is nothing to refuse; and being in the Cave is not being in a
// meeting, so nothing is joined. What it MUST do is the same swap every entry does — otherwise there
// would be a second way into this room, which is how the office ends up half-hidden or the body ends up
// standing in geometry.

function harness(landed = true) {
  const build = { group: new THREE.Group() };
  const officeRoot = new THREE.Group();
  const media = { ensure: vi.fn(() => null), play: vi.fn(), pause: vi.fn() };
  const place = vi.fn(() => landed);
  const onWhere = vi.fn();
  const requirePlayer = vi.fn(() => true);
  const t = new CaveTransition({
    build: build as never, officeRoot, media: media as never,
    place: place as never,
    portalPoint: () => ({ x: 10, z: 20 }),
    portalLook: { x: 0, z: -1 },
    setInterior: vi.fn(),
    invalidateShadows: vi.fn(),
    requirePlayer,
    onWhere,
  } as never);
  return { t, place, onWhere, officeRoot, build, requirePlayer, media };
}

describe("restoreInside", () => {
  it("puts the world in the Cave and lands the body on the same spawn every entry uses", () => {
    const { t, place, officeRoot, build } = harness();
    expect(t.restoreInside()).toBe(true);
    expect(t.inside).toBe(true);
    expect(place).toHaveBeenCalledWith(SPAWN, expect.anything(), expect.anything());
    // The same world state an ordinary entry produces — no half-swapped room.
    expect(officeRoot.visible).toBe(false);
    expect(build.group.visible).toBe(true);
  });

  it("names the place for the movement feed, so peers are told where this body went", () => {
    const { t, onWhere } = harness();
    t.restoreInside();
    expect(onWhere).toHaveBeenCalledWith("cave");
  });

  it("takes the avatar for PLAYER, or the restored body cannot walk", () => {
    const { t, requirePlayer } = harness();
    t.restoreInside();
    expect(requirePlayer).toHaveBeenCalled();
  });

  it("refuses, rather than landing a body nothing owns, when PLAYER cannot take it", () => {
    const build = { group: new THREE.Group() };
    const officeRoot = new THREE.Group();
    const t = new CaveTransition({
      build: build as never, officeRoot, media: { ensure: vi.fn(), play: vi.fn(), pause: vi.fn() } as never,
      place: vi.fn(() => true) as never,
      portalPoint: () => ({ x: 10, z: 20 }), portalLook: { x: 0, z: -1 },
      setInterior: vi.fn(), invalidateShadows: vi.fn(),
      requirePlayer: vi.fn(() => false), onWhere: vi.fn(),
    } as never);
    expect(t.restoreInside()).toBe(false);
    expect(t.inside).toBe(false);
    expect(officeRoot.visible).toBe(true);
  });

  it("does not fade — a reload has nothing to hide", () => {
    const { t } = harness();
    t.restoreInside();
    // `busy` is the fade's own flag; a restore never raises it, so the world is usable immediately.
    expect(t.busy).toBe(false);
  });

  it("is idempotent — restoring twice is not a second entry", () => {
    const { t, place } = harness();
    t.restoreInside();
    const callsAfterFirst = place.mock.calls.length;
    expect(t.restoreInside()).toBe(true);
    expect(place.mock.calls.length).toBe(callsAfterFirst);
  });

  it("refuses safely when there is nowhere to land, leaving the world in the office", () => {
    const { t, onWhere, officeRoot } = harness(false);
    expect(t.restoreInside()).toBe(false);
    expect(t.inside).toBe(false);
    expect(officeRoot.visible).toBe(true);
    // And the place announcement is taken back, so the feed does not claim a Cave nobody entered.
    expect(onWhere).toHaveBeenLastCalledWith("office");
  });

  it("starts no meeting and joins no call — only the LOCATION is persisted", () => {
    const { t } = harness();
    // The transition has no call surface at all; this asserts the shape rather than a behaviour, which
    // is the point: there is nothing here that could join a meeting even by mistake.
    expect(t).not.toHaveProperty("startMeeting");
    expect(t).not.toHaveProperty("join");
    t.restoreInside();
    expect(t.inside).toBe(true);
  });
});

// PHASE 7D — THE INVARIANT THAT LETS A CAVE PATH BE REPLAYED UNCONVERTED.
//
// `Coworkers` maps every walk path through `toWorld` (homeDeskWorldPoint), which shifts a point by the
// room whose V1 art box contains it. A Cave coordinate is outside every one of those boxes, so that
// mapping is the IDENTITY there — which is the only reason a local path can be handed to the same
// replay without being double-shifted. Pinned here because it is an assumption about V1's layout, and
// an art box that ever grew far enough east would break Cave movement silently.
describe("a Cave point is outside every V1 art box", () => {
  it("passes through homeDeskWorldPoint unchanged", async () => {
    const { homeDeskWorldPoint } = await import("./app/spawn");
    const { v1Rooms } = await import("./adapters/v1Floor");
    const { ROOM_WORLD_SHIFT_Z } = await import("./rooms/ground-floor");
    const { SPAWN } = await import("./rooms/cave");

    const rooms = v1Rooms();
    for (const p of [SPAWN, { x: SPAWN.x - 200, z: SPAWN.z }, { x: SPAWN.x + 200, z: SPAWN.z + 150 }]) {
      expect(homeDeskWorldPoint(p, rooms, ROOM_WORLD_SHIFT_Z)).toEqual(p);
    }
  });
});
