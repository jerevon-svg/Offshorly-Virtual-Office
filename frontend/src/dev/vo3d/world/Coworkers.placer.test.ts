// Phase 4C stage 3 — THE CACHED PLACEMENT PASS.
//
// One claim, tested two ways. The claim: CoworkerPlacer returns what the uncached placeCoworkers returns,
// for every sequence of rosters a live positions feed can produce, while not re-searching a standing spot
// whose answer cannot have changed.
//
//   EQUIVALENCE is checked against placeCoworkers itself, tick by tick, over the sequences that actually
//   occur — 60 people at 2 Hz with one mover, several movers at once, arrivals, departures, reseats, and
//   people flipping between a desk point and a live one. A cache that is only correct for the cases
//   somebody thought to enumerate is not correct, so the oracle is the real function and not a table.
//
//   THE SAVING is checked by counting stand-test calls, because that is the thing being bought: the stand
//   test is the expensive leaf (a region lookup, a clearance sample and eight rim samples per probe) and
//   standablePointNear calls it up to 73 times per person. Counting it measures the optimisation directly
//   instead of measuring a clock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CoworkerPlacer, Coworkers, placeCoworkers } from "./Coworkers";
import type { Vo3dCoworker } from "../app/coworkers";
import type { Vec2 } from "../core/coords";

// ---------------------------------------------------------------------------
// A floor with things on it. A stand test that says yes everywhere would never
// enter a ring search, which is exactly the work being cached.
// ---------------------------------------------------------------------------

const BLOCKS: { x0: number; x1: number; z0: number; z1: number }[] = [
  { x0: 20, x1: 44, z0: 0, z1: 60 },
  { x0: 0, x1: 80, z0: 96, z1: 112 },
];

function floor() {
  let calls = 0;
  const canStand = (p: Vec2): boolean => {
    calls++;
    return !BLOCKS.some((b) => p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1);
  };
  return { canStand, calls: () => calls, reset: () => { calls = 0; } };
}

const SHIFT = (p: Vec2): Vec2 => ({ x: p.x + 5, z: p.z - 3 });
const RADIUS = 8;

function coworker(email: string, point: Vec2, posSource: Vo3dCoworker["posSource"] = "desk"): Vo3dCoworker {
  return {
    email,
    displayName: email.split("@")[0],
    avatarId: "bon",
    point,
    box: { width: 26, height: 37 },
    posSource,
    facing: "south",
  };
}

/** 60 people on a 10 x 6 grid pitched at 6 units — TIGHTER than MIN_SEPARATION, so the desk pass really
 *  does resolve collisions in order, and two of the columns sit inside a block so rings really are walked. */
function crowd(n = 60): Vo3dCoworker[] {
  const out: Vo3dCoworker[] = [];
  for (let i = 0; i < n; i++) {
    out.push(coworker(`c${String(i).padStart(2, "0")}@x.com`, { x: (i % 10) * 6, z: Math.floor(i / 10) * 6 }));
  }
  return out.sort((a, b) => a.email.localeCompare(b.email));
}

/** the same person, now standing somewhere of V1's choosing */
function live(c: Vo3dCoworker, point: Vec2): Vo3dCoworker {
  return { ...c, point, posSource: "live" };
}

// ---------------------------------------------------------------------------
// 1 · Equivalence with the uncached pass
// ---------------------------------------------------------------------------

describe("CoworkerPlacer — is placeCoworkers, tick after tick", () => {
  /** Drive both through the same sequence and demand they never diverge. The uncached side gets a fresh
   *  instance every tick (that IS placeCoworkers); the cached side is one placer across all of them. */
  function agree(ticks: readonly Vo3dCoworker[][]): void {
    const f = floor();
    const placer = new CoworkerPlacer(SHIFT, f.canStand, RADIUS);
    ticks.forEach((list, i) => {
      const cached = placer.place(list);
      const fresh = placeCoworkers(list, SHIFT, f.canStand, RADIUS);
      expect(cached, `tick ${i}`).toEqual(fresh);
    });
  }

  it("60 coworkers at 2 Hz with one person walking — 30 seconds of ticks", () => {
    const base = crowd();
    const walker = base[7];
    const ticks: Vo3dCoworker[][] = [];
    for (let t = 0; t < 60; t++) {
      const next = [...base];
      next[7] = live(walker, { x: 30 + t * 3, z: 40 + (t % 7) * 4 });
      ticks.push(next);
    }
    agree(ticks);
  });

  it("several people moving on the same tick", () => {
    const base = crowd();
    const ticks: Vo3dCoworker[][] = [];
    for (let t = 0; t < 20; t++) {
      const next = [...base];
      for (const i of [3, 11, 29, 47]) next[i] = live(base[i], { x: (i * 7 + t * 5) % 160, z: (i * 3 + t * 9) % 140 });
      ticks.push(next);
    }
    agree(ticks);
  });

  it("arrivals and departures, which change the desk pass the separation rule runs over", () => {
    const base = crowd();
    agree([
      base,
      base.slice(0, 40),
      base.slice(0, 40).concat(base.slice(50)),
      base,
      base.filter((c) => c.email !== base[0].email),
      [],
      base,
    ]);
  });

  it("one person flipping between their desk and a live point, repeatedly", () => {
    const base = crowd(12);
    const ticks: Vo3dCoworker[][] = [];
    for (let t = 0; t < 12; t++) {
      const next = [...base];
      if (t % 2 === 0) next[5] = live(base[5], { x: 70 + t, z: 70 });
      ticks.push(next);
    }
    agree(ticks);
  });

  it("a reseat — the desk point itself changing — re-runs the ordered pass rather than patching it", () => {
    const base = crowd(20);
    const moved = [...base];
    moved[2] = coworker(base[2].email, { x: 33, z: 30 });
    agree([base, moved, base, moved]);
  });

  it("two live bodies on one point are still drawn honestly, through the cache", () => {
    const f = floor();
    const placer = new CoworkerPlacer((p) => p, f.canStand, RADIUS);
    const list = [coworker("a@x.com", { x: 200, z: 200 }, "live"), coworker("b@x.com", { x: 200, z: 200 }, "live")];
    for (let i = 0; i < 3; i++) {
      const { placed } = placer.place(list);
      expect(placed[0].pos).toEqual({ x: 200, z: 200 });
      expect(placed[1].pos).toEqual({ x: 200, z: 200 });
    }
  });

  it("a coworker who leaves and comes back somewhere else is placed where they are NOW", () => {
    const f = floor();
    const placer = new CoworkerPlacer((p) => p, f.canStand, RADIUS);
    const here = coworker("a@x.com", { x: 200, z: 200 }, "live");
    const there = coworker("a@x.com", { x: 400, z: 400 }, "live");
    expect(placer.place([here]).placed[0].pos).toEqual({ x: 200, z: 200 });
    expect(placer.place([]).placed).toEqual([]);
    expect(placer.place([there]).placed[0].pos).toEqual({ x: 400, z: 400 });
  });

  it("invalidate() drops everything and the next pass is a full one", () => {
    const f = floor();
    const placer = new CoworkerPlacer(SHIFT, f.canStand, RADIUS);
    const list = crowd(20);
    placer.place(list);
    f.reset();
    placer.place(list);
    expect(f.calls()).toBe(0);
    placer.invalidate();
    f.reset();
    expect(placer.place(list)).toEqual(placeCoworkers(list, SHIFT, f.canStand, RADIUS));
    expect(f.calls()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2 · The work it actually avoids
// ---------------------------------------------------------------------------

describe("CoworkerPlacer — what it stops re-searching", () => {
  it("a tick in which nobody moved costs ZERO stand tests", () => {
    const f = floor();
    const placer = new CoworkerPlacer(SHIFT, f.canStand, RADIUS);
    const list = crowd();
    placer.place(list);
    for (let t = 0; t < 10; t++) {
      f.reset();
      placer.place(list);
      expect(f.calls()).toBe(0);
    }
  });

  it("one person walking costs ONE person's search, not sixty", () => {
    const f = floor();
    const placer = new CoworkerPlacer(SHIFT, f.canStand, RADIUS);
    const base = crowd();
    f.reset();
    placer.place(base);
    const cold = f.calls();

    const next = [...base];
    next[7] = live(base[7], { x: 300, z: 300 });
    placer.place(next); // the flip to live is a desk-roster change: full desk pass, once
    const moving = [...next];
    f.reset();
    for (let t = 0; t < 10; t++) {
      moving[7] = live(base[7], { x: 300 + t * 4, z: 300 });
      placer.place(moving);
    }
    // ten steps of one walker, against a cold pass for the same roster
    expect(f.calls()).toBeLessThan(cold / 10);
  });

  it("simultaneous movers cost their own searches and nobody else's", () => {
    const f = floor();
    const placer = new CoworkerPlacer(SHIFT, f.canStand, RADIUS);
    const base = crowd();
    const start = base.map((c, i) => ([3, 11, 29, 47].includes(i) ? live(c, { x: 300 + i, z: 300 }) : c));
    placer.place(start);

    f.reset();
    const one = start.map((c, i) => (i === 3 ? live(base[3], { x: 311, z: 300 }) : c));
    placer.place(one);
    const oneMover = f.calls();

    f.reset();
    const four = start.map((c, i) => ([3, 11, 29, 47].includes(i) ? live(base[i], { x: 320 + i, z: 310 }) : c));
    placer.place(four);
    expect(f.calls()).toBeGreaterThan(oneMover);
    expect(f.calls()).toBeLessThanOrEqual(oneMover * 5);
  });

  it("a roster change pays for the whole desk pass — the separation rule is never patched", () => {
    const f = floor();
    const placer = new CoworkerPlacer(SHIFT, f.canStand, RADIUS);
    const base = crowd();
    f.reset();
    placer.place(base);
    const cold = f.calls();
    f.reset();
    placer.place(base.slice(0, 59));
    expect(f.calls()).toBeGreaterThan(cold / 2);
  });
});

// ---------------------------------------------------------------------------
// 3 · Through Coworkers.sync — the scene must be unchanged
// ---------------------------------------------------------------------------

const pending: { resolve: () => void }[] = [];
let autoResolve = true;
const loadCalls: string[] = [];

vi.mock("../avatar/CastPrototypes", () => ({
  prototypeFor: (id: string) => {
    loadCalls.push(id);
    const proto = { id, gltf: {} as never, scene: new THREE.Group(), clips: [] as THREE.AnimationClip[], triangles: 100, headY: 36 };
    if (autoResolve) return Promise.resolve(proto);
    return new Promise((resolve) => pending.push({ resolve: () => resolve(proto) }));
  },
  castLabelTexture: () => new THREE.CanvasTexture(document.createElement("canvas")),
}));

function flushPending() {
  const batch = [...pending];
  pending.length = 0;
  for (const p of batch) p.resolve();
}

beforeEach(() => {
  pending.length = 0;
  loadCalls.length = 0;
  autoResolve = true;
});
afterEach(() => vi.restoreAllMocks());

/** the scene as a comparable fact: who is standing where, rounded exactly as the dev readout rounds */
function snapshot(c: Coworkers) {
  return c.positions();
}

describe("Coworkers.sync — the cache is invisible from the scene graph", () => {
  function rig(f = floor()) {
    const parent = new THREE.Group();
    return { f, parent, coworkers: new Coworkers({ parent, canStand: f.canStand, radius: RADIUS, toWorld: SHIFT, lod: 1 }) };
  }

  it("60 coworkers at 2 Hz land exactly where the uncached pass says, every tick", async () => {
    const { coworkers } = rig();
    const f2 = floor();
    const base = crowd();
    await coworkers.sync(base);
    for (let t = 0; t < 30; t++) {
      const next = [...base];
      next[7] = live(base[7], { x: 300 + t * 4, z: 300 });
      next[22] = live(base[22], { x: 120, z: 200 + t * 2 });
      await coworkers.sync(next);
      const want = placeCoworkers(next, SHIFT, f2.canStand, RADIUS);
      const expected = want.placed
        .map((p) => ({ name: p.coworker.displayName, x: Math.round(p.pos.x * 10) / 10, z: Math.round(p.pos.z * 10) / 10, source: p.coworker.posSource }))
        .sort((a, b) => a.name.localeCompare(b.name));
      expect(snapshot(coworkers), `tick ${t}`).toEqual(expected);
    }
    expect(coworkers.size).toBe(60);
  });

  it("repeated identical syncs never build a second body for anybody", async () => {
    const { coworkers, parent } = rig();
    const base = crowd(12);
    for (let i = 0; i < 6; i++) await coworkers.sync(base);
    expect(coworkers.size).toBe(12);
    expect(parent.children[0].children).toHaveLength(12);
    expect(loadCalls).toHaveLength(12);
  });

  it("arrivals and removals still add and remove exactly one body each", async () => {
    const { coworkers } = rig();
    const base = crowd(10);
    await coworkers.sync(base);
    expect(coworkers.size).toBe(10);
    await coworkers.sync(base.slice(0, 9));
    expect(coworkers.size).toBe(9);
    await coworkers.sync(base);
    expect(coworkers.size).toBe(10);
    expect(loadCalls).toHaveLength(11);
  });

  it("a GLB that lands late is still added where that person is NOW, not where they were", async () => {
    const { coworkers } = rig();
    autoResolve = false;
    const base = crowd(4);
    const slow = coworkers.sync(base);
    // ...and while 8 MB is in flight, one of them walks, several times.
    for (let t = 0; t < 5; t++) {
      const next = [...base];
      next[1] = live(base[1], { x: 400 + t * 6, z: 260 });
      await coworkers.sync(next);
    }
    flushPending();
    await slow;
    const here = coworkers.positions().find((p) => p.name === base[1].displayName);
    expect(here).toEqual({ name: base[1].displayName, x: 400 + 4 * 6 + 5, z: 260 - 3, source: "live" });
    expect(coworkers.size).toBe(4);
  });

  it("a live tick during a load never re-requests a character", async () => {
    const { coworkers } = rig();
    autoResolve = false;
    const base = crowd(4);
    const slow = coworkers.sync(base);
    expect(loadCalls).toHaveLength(4);
    for (let t = 0; t < 4; t++) await coworkers.sync(base.map((c, i) => (i === 0 ? live(c, { x: 500 + t, z: 100 }) : c)));
    expect(loadCalls).toHaveLength(4);
    flushPending();
    await slow;
    expect(coworkers.size).toBe(4);
  });
});
