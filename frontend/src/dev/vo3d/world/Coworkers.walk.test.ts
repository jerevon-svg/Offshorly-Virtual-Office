// Phase 6A — Coworkers' side of the replay: which of the three cases a sync lands in, and what the body
// does about it. The GLB loader is stubbed (the same stub Coworkers.sync.test.ts uses), so these run the
// real reconciliation and the real walker with no asset and no renderer.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Coworkers, facingTrace } from "./Coworkers";
import type { Vo3dCoworker, Vo3dCoworkerWalk } from "../app/coworkers";
import { FACING_YAW, type Vec2 } from "../core/coords";

vi.mock("../avatar/CastPrototypes", () => ({
  prototypeFor: (id: string) =>
    Promise.resolve({ id, gltf: {} as never, scene: new THREE.Group(), clips: [] as THREE.AnimationClip[], triangles: 100, headY: 36 }),
  castLabelTexture: () => new THREE.CanvasTexture(document.createElement("canvas")),
}));

const EMAIL = "micah@offshorly.com";
/** 300 units due north, origin first — the shape the adapter produces. */
const ROUTE: Vec2[] = [{ x: 600, z: 800 }, { x: 600, z: 500 }];

function coworker(point: Vec2, walk?: Vo3dCoworkerWalk, facing: Vo3dCoworker["facing"] = "south", yaw?: number): Vo3dCoworker {
  return {
    email: EMAIL,
    displayName: "Micah",
    avatarId: "micah",
    point,
    box: { width: 26, height: 37 },
    posSource: "live",
    facing,
    ...(yaw !== undefined ? { yaw } : {}),
    ...(walk ? { walk } : {}),
  };
}
const walk = (movementId: string, path = ROUTE, durationMs = 3000, elapsedMs = 0): Vo3dCoworkerWalk => ({
  movementId,
  path,
  durationMs,
  elapsedMs,
});

let cw: Coworkers;
/** Where the one body stands, as the dev surface reports it. */
const at = (): Vec2 => {
  const p = cw.positions()[0];
  return { x: p.x, z: p.z };
};
/** Run frames until a predicate holds or the budget runs out; returns the frames spent. */
function run(ms: number, step = 16): number {
  let spent = 0;
  while (spent < ms) {
    cw.update(step / 1000);
    spent += step;
  }
  return spent;
}

beforeEach(() => {
  cw = new Coworkers({ parent: new THREE.Group(), canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1 });
});

describe("a walk V1 published", () => {
  it("walks the body along the route instead of snapping it", async () => {
    // The whole point of the phase. Phase 4B put this body at its stable position and left it there.
    await cw.sync([coworker(ROUTE[0], walk("m1"))]);
    expect(cw.moving).toBe(true);
    expect(cw.getStats().walking).toBe(1);
    expect(at()).toEqual({ x: 600, z: 800 });

    run(1500);
    const half = at();
    expect(half.z).toBeLessThan(800);
    expect(half.z).toBeGreaterThan(500);

    run(1600);
    expect(cw.moving).toBe(false);
    expect(at().z).toBeCloseTo(500, 1);
  });

  it("reports movement to the caller only while the transform is actually changing", () => {
    // The world turns this into a cheap dynamic-shadow invalidation, so a standing room must report false.
    expect(cw.update(0.016)).toBe(false);
  });

  it("starts a movement already in flight PART WAY ALONG, not back at its origin", async () => {
    await cw.sync([coworker(ROUTE[0], walk("m1", ROUTE, 3000, 2000))]);
    // Two thirds of the way in on V1's eased curve is most of the route.
    expect(at().z).toBeLessThan(600);
    expect(cw.moving).toBe(true);
  });
});

describe("the same movement, handed over again", () => {
  it("is IGNORED — the walk is not restarted and the body is not pulled back", async () => {
    // This is the case that makes it smooth. A re-render caused by somebody ELSE's event re-pushes this
    // person's unchanged walk, and their stable position is still the PRE-walk one while it runs.
    await cw.sync([coworker(ROUTE[0], walk("m1"))]);
    run(1500);
    const mid = at();

    await cw.sync([coworker(ROUTE[0], walk("m1"))]);
    expect(at()).toEqual(mid); // not snapped back to the stable point
    await cw.sync([coworker(ROUTE[0], walk("m1"))]);
    expect(at()).toEqual(mid);

    run(160);
    expect(at().z).toBeLessThan(mid.z); // ...and it kept going
  });
});

describe("a redirect", () => {
  it("replaces the walk in flight, from the successor's own origin", async () => {
    // V1 never sends an arrival for a superseded movement: the successor simply takes over.
    await cw.sync([coworker(ROUTE[0], walk("m1"))]);
    run(1000);
    const turned: Vec2[] = [{ x: 600, z: 700 }, { x: 900, z: 700 }];
    await cw.sync([coworker(ROUTE[0], walk("m2", turned, 2000))]);
    expect(at()).toEqual(turned[0]);
    run(2100);
    expect(cw.moving).toBe(false);
    expect(at().x).toBeCloseTo(900, 1);
  });
});

describe("the arrival that follows a walk", () => {
  it("settles with NO visible motion when the replay ended where V1 said it would", async () => {
    await cw.sync([coworker(ROUTE[0], walk("m1"))]);
    run(3100);
    const ended = at();
    expect(ended.z).toBeCloseTo(500, 1);
    // walk_arrived: the walk clears and the stable position becomes the route's end.
    await cw.sync([coworker({ x: 600, z: 500 }, undefined, "north")]);
    expect(cw.moving).toBe(false);
    expect(at()).toEqual({ x: 600, z: 500 });
  });

  it("GLIDES a short correction rather than flicking the body", async () => {
    await cw.sync([coworker(ROUTE[0], walk("m1"))]);
    run(3100);
    // 12 units out — clock offset, a rounding difference, a frame boundary.
    await cw.sync([coworker({ x: 612, z: 500 })]);
    expect(cw.moving).toBe(true);
    expect(at().x).toBeLessThan(612); // still on its way
    run(400);
    expect(cw.moving).toBe(false);
    expect(at().x).toBeCloseTo(612, 1);
  });

  it("SNAPS a long correction, because that is news and not jitter", async () => {
    // An interrupted walk: the walker stopped somewhere else entirely and published THAT as the arrival.
    await cw.sync([coworker(ROUTE[0], walk("m1"))]);
    run(800);
    await cw.sync([coworker({ x: 200, z: 300 })]);
    expect(cw.moving).toBe(false);
    expect(at()).toEqual({ x: 200, z: 300 });
  });

  it("does not creep: a repeated sync toward the same point does not restart the settle", async () => {
    await cw.sync([coworker(ROUTE[0], walk("m1"))]);
    run(3100);
    await cw.sync([coworker({ x: 612, z: 500 })]);
    run(100);
    const partway = at();
    await cw.sync([coworker({ x: 612, z: 500 })]);
    expect(at()).toEqual(partway);
    run(400);
    expect(at().x).toBeCloseTo(612, 1);
    expect(cw.moving).toBe(false);
  });
});

describe("a walk whose arrival never comes", () => {
  it("leaves the body at the end of the route, idle, rather than drifting or snapping back", async () => {
    // The walker's tab closed mid-stride: the movement stays active in V1's store forever. The honest
    // answer is the end of the route they published — never an extrapolation, and never the stale stable
    // position, which is where they were BEFORE the walk.
    await cw.sync([coworker(ROUTE[0], walk("m1"))]);
    run(6000);
    expect(cw.moving).toBe(false);
    expect(at().z).toBeCloseTo(500, 1);
    await cw.sync([coworker(ROUTE[0], walk("m1"))]);
    expect(at().z).toBeCloseTo(500, 1);
  });
});

describe("population changes during a walk", () => {
  it("removes a walking body cleanly when that person leaves the roster", async () => {
    await cw.sync([coworker(ROUTE[0], walk("m1"))]);
    run(800);
    expect(cw.size).toBe(1);
    await cw.sync([]);
    expect(cw.size).toBe(0);
    expect(cw.moving).toBe(false);
    expect(cw.update(0.016)).toBe(false);
  });

  it("starts a newcomer's walk already in progress, at the right point", async () => {
    // Somebody whose character was still downloading when their walk began: the body is added from the
    // NEWEST spot, and the walk it is handed carries its own elapsed time.
    await cw.sync([coworker(ROUTE[0], walk("m1", ROUTE, 3000, 1500))]);
    expect(cw.size).toBe(1);
    expect(cw.moving).toBe(true);
    expect(at().z).toBeLessThan(700);
  });
});

describe("standing people cost nothing", () => {
  it("has no walk, no movement and no reported change across many frames", async () => {
    await cw.sync([coworker({ x: 600, z: 500 })]);
    expect(cw.moving).toBe(false);
    for (let i = 0; i < 120; i++) expect(cw.update(0.016)).toBe(false);
    expect(at()).toEqual({ x: 600, z: 500 });
    expect(cw.getStats().walking).toBe(0);
  });
});

describe("a placement is not a walk", () => {
  it("applies an ordinary position change AT ONCE for a body that has never replayed anything", async () => {
    // A desk, a roster reseat, a separation nudge, a first sync. Where a coworker stands must not depend
    // on how recently they were told — that is the Phase 4C cache-equivalence guarantee, and gliding
    // these would break it as well as being wrong.
    await cw.sync([coworker({ x: 600, z: 500 })]);
    expect(at()).toEqual({ x: 600, z: 500 });
    await cw.sync([coworker({ x: 608, z: 500 })]); // 8 units — inside the glide band
    expect(cw.moving).toBe(false);
    expect(at()).toEqual({ x: 608, z: 500 });
  });

  it("stops treating later moves as a seam once a walk has been settled", async () => {
    await cw.sync([coworker(ROUTE[0], walk("m1"))]);
    run(3100);
    await cw.sync([coworker({ x: 600, z: 500 })]); // settles exactly: no glide
    expect(cw.moving).toBe(false);
    await cw.sync([coworker({ x: 608, z: 500 })]); // an ordinary move afterwards
    expect(cw.moving).toBe(false);
    expect(at()).toEqual({ x: 608, z: 500 });
  });
});

// ── Phase 6B ─────────────────────────────────────────────────────────────────────────────────────────
// The facing a walk ends on. The wire now carries the walker's ACTUAL resting yaw beside V1's four-word
// facing; the body turns onto it at its own rate when present and falls back to the compass word when not.
describe("the facing a walk ends on", () => {
  const DIAGONAL: Vec2[] = [{ x: 600, z: 800 }, { x: 900, z: 500 }];
  /** deliberately NOT the route's heading (2.356): the walker's own turn stopped short of it */
  const RESTING = 2.9;
  let parent: THREE.Group;
  const yaw = (): number => {
    const root = parent.getObjectByName("coworker:Micah");
    if (!root) throw new Error("no body");
    return root.rotation.y;
  };
  beforeEach(() => {
    parent = new THREE.Group();
    cw = new Coworkers({ parent, canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1 });
  });

  it("turns onto the EXACT yaw the walker published, smoothly, as the last beat of the walk", async () => {
    await cw.sync([coworker(DIAGONAL[0], walk("m1", DIAGONAL))]);
    run(3100);
    const before = yaw();
    await cw.sync([coworker({ x: 900, z: 500 }, undefined, "north", RESTING)]);
    // Not snapped: still where the replay left it, a turn queued.
    expect(yaw()).toBeCloseTo(before, 5);
    run(16);
    expect(yaw()).not.toBeCloseTo(before, 3); // moving...
    run(400);
    expect(yaw()).toBeCloseTo(RESTING, 6); // ...and there, exactly
  });

  it("takes the yaw even when the arrival lands BEFORE the replay's own clock runs out", async () => {
    await cw.sync([coworker(DIAGONAL[0], walk("m1", DIAGONAL))]);
    run(2900);
    await cw.sync([coworker({ x: 900, z: 500 }, undefined, "north", RESTING)]);
    run(500);
    expect(yaw()).toBeCloseTo(RESTING, 6);
    expect(cw.moving).toBe(false);
  });

  it("KEEPS it across the stream of unchanged roster syncs that follows", async () => {
    await cw.sync([coworker(DIAGONAL[0], walk("m1", DIAGONAL))]);
    run(3100);
    await cw.sync([coworker({ x: 900, z: 500 }, undefined, "north", RESTING)]);
    for (let i = 0; i < 40; i++) {
      await cw.sync([coworker({ x: 900, z: 500 }, undefined, "north", RESTING)]);
      cw.update(0.016);
    }
    expect(yaw()).toBeCloseTo(RESTING, 6);
    expect(cw.update(0.016)).toBe(false); // and nothing keeps moving
  });

  it("falls back to V1's four-word facing when no yaw came — a V1 walker, or a pre-6B row", async () => {
    await cw.sync([coworker(DIAGONAL[0], walk("m1", DIAGONAL))]);
    run(3100);
    await cw.sync([coworker({ x: 900, z: 500 }, undefined, "west")]);
    run(500);
    expect(yaw()).toBe(FACING_YAW.west);
  });

  it("takes the yaw through a GLIDED seam too", async () => {
    await cw.sync([coworker(DIAGONAL[0], walk("m1", DIAGONAL))]);
    run(3100);
    await cw.sync([coworker({ x: 912, z: 500 }, undefined, "north", RESTING)]); // 12 units out
    expect(cw.moving).toBe(true);
    run(800);
    expect(cw.moving).toBe(false);
    expect(at().x).toBeCloseTo(912, 1);
    expect(yaw()).toBeCloseTo(RESTING, 6);
  });

  it("a REDIRECT's arrival yaw is the one that counts, not the abandoned walk's", async () => {
    await cw.sync([coworker(DIAGONAL[0], walk("m1", DIAGONAL))]);
    run(1000);
    const second: Vec2[] = [{ x: 600, z: 700 }, { x: 500, z: 400 }];
    await cw.sync([coworker(DIAGONAL[0], walk("m2", second, 2000))]);
    run(2100);
    await cw.sync([coworker({ x: 500, z: 400 }, undefined, "north", -2.7)]);
    run(600);
    expect(yaw()).toBeCloseTo(-2.7, 6);
  });

  it("an INTERRUPTED walk snaps to where the walker really stopped and turns onto the yaw it really has", async () => {
    await cw.sync([coworker(DIAGONAL[0], walk("m1", DIAGONAL))]);
    run(800);
    await cw.sync([coworker({ x: 200, z: 300 }, undefined, "north", 1.9)]);
    expect(cw.moving).toBe(false);
    expect(at()).toEqual({ x: 200, z: 300 });
    run(600);
    expect(yaw()).toBeCloseTo(1.9, 6);
  });

  it("a PLACEMENT turns at once, like it moves at once — never a queued turn for a body that did not walk", async () => {
    await cw.sync([coworker({ x: 600, z: 500 }, undefined, "south", 0.7)]);
    expect(yaw()).toBe(0.7);
    await cw.sync([coworker({ x: 608, z: 500 }, undefined, "south", 1.2)]);
    expect(yaw()).toBe(1.2);
    expect(at()).toEqual({ x: 608, z: 500 });
  });

  it("records each resolved arrival on the dev surface, anonymously and bounded", async () => {
    await cw.sync([coworker(DIAGONAL[0], walk("m1", DIAGONAL))]);
    run(3100);
    await cw.sync([coworker({ x: 900, z: 500 }, undefined, "north", RESTING)]);
    expect(facingTrace().at(-1)).toEqual({ movementId: "m1", receivedYaw: RESTING, facing: "north", applied: RESTING });
    await cw.sync([coworker({ x: 900, z: 500 }, walk("m2", [{ x: 900, z: 500 }, { x: 900, z: 300 }]))]);
    run(3100);
    await cw.sync([coworker({ x: 900, z: 300 }, undefined, "north")]);
    expect(facingTrace().at(-1)).toEqual({ movementId: "m2", receivedYaw: null, facing: "north", applied: FACING_YAW.north });
    expect(JSON.stringify(facingTrace())).not.toContain("Micah");
    for (let i = 0; i < 12; i++) {
      await cw.sync([coworker({ x: 900, z: 300 }, walk(`x${i}`, [{ x: 900, z: 300 }, { x: 900, z: 300 }], 100))]);
      run(200);
      await cw.sync([coworker({ x: 900, z: 300 }, undefined, "north")]);
    }
    expect(facingTrace().length).toBeLessThanOrEqual(8);
    expect(cw.positions()[0]).toMatchObject({ movementId: null, clip: "" }); // no clips in the stub prototype
  });
});
