// Phase 4A — Coworkers.sync's RECONCILIATION, with the GLB loader stubbed. These are the cases a browser
// shows only intermittently: a roster that changes while 8 MB of character is still in flight.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Coworkers } from "./Coworkers";
import type { Vo3dCoworker } from "../app/coworkers";
import type { Vec2 } from "../core/coords";

// Deferred so a test can decide WHEN a character finishes loading.
const pending: { resolve: (v: unknown) => void; id: string }[] = [];
let autoResolve = true;
/** every prototypeFor call, so a test can prove a position update did not re-request a character. */
const loadCalls: string[] = [];

vi.mock("../avatar/CastPrototypes", () => ({
  prototypeFor: (id: string) => {
    loadCalls.push(id);
    const proto = {
      id,
      gltf: {} as never,
      scene: new THREE.Group(),
      clips: [] as THREE.AnimationClip[],
      triangles: 100,
      headY: 36,
    };
    if (autoResolve) return Promise.resolve(proto);
    return new Promise((resolve) => pending.push({ resolve: () => resolve(proto), id }));
  },
  castLabelTexture: () => new THREE.CanvasTexture(document.createElement("canvas")),
}));

function coworker(
  email: string,
  avatarId = "bon",
  point: Vec2 = { x: 0, z: 0 },
  posSource: Vo3dCoworker["posSource"] = "desk",
): Vo3dCoworker {
  return {
    email,
    displayName: email.split("@")[0],
    avatarId,
    point,
    box: { width: 26, height: 37 },
    posSource,
    facing: "south",
  };
}

function makeCoworkers() {
  const parent = new THREE.Group();
  return new Coworkers({ parent, canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1 });
}

function flushPending() {
  const batch = [...pending];
  pending.length = 0;
  for (const p of batch) p.resolve(undefined);
}

beforeEach(() => {
  pending.length = 0;
  loadCalls.length = 0;
  autoResolve = true;
});
afterEach(() => vi.restoreAllMocks());

const A = coworker("a@x.com", "bon", { x: 0, z: 0 });
const B = coworker("b@x.com", "alex", { x: 200, z: 0 });
const C = coworker("c@x.com", "jan", { x: 400, z: 0 });

describe("Coworkers.sync", () => {
  it("adds a body per coworker", async () => {
    const cw = makeCoworkers();
    await cw.sync([A, B]);
    expect(cw.size).toBe(2);
    expect(cw.group.children).toHaveLength(2);
    expect(cw.getStats().rendered).toBe(2);
  });

  it("removes a body when the roster drops that person", async () => {
    const cw = makeCoworkers();
    await cw.sync([A, B]);
    await cw.sync([A]);
    expect(cw.size).toBe(1);
    expect(cw.group.children).toHaveLength(1);
  });

  it("leaves an unchanged body alone — no rebuild on an identical roster", async () => {
    const cw = makeCoworkers();
    await cw.sync([A, B]);
    const before = [...cw.group.children];
    await cw.sync([A, B]);
    expect(cw.group.children).toEqual(before);
  });

  it("moves a body rather than rebuilding it when the roster reseats that person", async () => {
    const cw = makeCoworkers();
    await cw.sync([A]);
    const body = cw.group.children[0];
    await cw.sync([coworker("a@x.com", "bon", { x: 99, z: 77 })]);
    expect(cw.group.children[0]).toBe(body);
    expect(body.position.x).toBe(99);
    expect(body.position.z).toBe(77);
  });

  it("rebuilds when a person's CHARACTER changes — a new avatarId is a different body", async () => {
    const cw = makeCoworkers();
    await cw.sync([A]);
    const body = cw.group.children[0];
    await cw.sync([coworker("a@x.com", "alex", { x: 0, z: 0 })]);
    expect(cw.size).toBe(1);
    expect(cw.group.children[0]).not.toBe(body);
  });

  it("reports a coworker whose desk has no standable point instead of forcing them in", async () => {
    const parent = new THREE.Group();
    const cw = new Coworkers({ parent, canStand: () => false, radius: 8, toWorld: (p) => p });
    await cw.sync([A, B]);
    expect(cw.size).toBe(0);
    expect(cw.getStats().unplaced).toEqual(["a", "b"]);
  });

  it("survives a character that will not load — one bad asset is not a broken world", async () => {
    const cw = makeCoworkers();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../avatar/CastPrototypes");
    vi.spyOn(mod, "prototypeFor").mockImplementation((id: string) =>
      id === "alex" ? Promise.reject(new Error("404")) : Promise.resolve({ id, gltf: {} as never, scene: new THREE.Group(), clips: [], triangles: 100, headY: 36 }),
    );
    await expect(cw.sync([A, B])).resolves.toBeUndefined();
    expect(cw.size).toBe(1);
    spy.mockRestore();
  });

  // THE RACE. A roster refetch fires on every SSE reconnect, and a GLB takes seconds — so a second
  // sync routinely starts while the first one's characters are still in flight. Every sync must still
  // converge on the CURRENT roster; a newer sync cancelling an older one's work left the office
  // permanently empty (bodies 0, nobody unplaced, no error anywhere).
  it("still renders when a second sync starts while the first is still loading", async () => {
    autoResolve = false;
    const cw = makeCoworkers();
    const first = cw.sync([A, B]);
    const second = cw.sync([A, B, C]);
    flushPending();
    await Promise.all([first, second]);
    flushPending();
    await Promise.all([first, second]);
    expect(cw.size).toBe(3);
    expect(cw.getStats().rendered).toBe(3);
  });

  it("converges on the LAST roster when syncs overlap, not the first", async () => {
    autoResolve = false;
    const cw = makeCoworkers();
    const first = cw.sync([A, B]);
    const second = cw.sync([C]);
    flushPending();
    await Promise.all([first, second]);
    flushPending();
    await Promise.all([first, second]);
    expect([...cw.group.children].map((c) => c.name)).toEqual(["coworker:c"]);
  });

  it("never double-adds one person across overlapping syncs", async () => {
    autoResolve = false;
    const cw = makeCoworkers();
    const runs = [cw.sync([A]), cw.sync([A]), cw.sync([A])];
    flushPending();
    await Promise.all(runs);
    flushPending();
    await Promise.all(runs);
    expect(cw.size).toBe(1);
    expect(cw.group.children).toHaveLength(1);
  });

  it("adds nothing after dispose, even for a load that was already in flight", async () => {
    autoResolve = false;
    const cw = makeCoworkers();
    const run = cw.sync([A, B]);
    cw.dispose();
    flushPending();
    await run;
    expect(cw.size).toBe(0);
    expect(cw.group.children).toHaveLength(0);
  });

  it("dispose detaches the group and drops every body", async () => {
    const parent = new THREE.Group();
    const cw = new Coworkers({ parent, canStand: () => true, radius: 8, toWorld: (p) => p });
    await cw.sync([A, B]);
    expect(parent.children).toContain(cw.group);
    cw.dispose();
    expect(parent.children).not.toContain(cw.group);
    expect(cw.group.children).toHaveLength(0);
    expect(cw.size).toBe(0);
  });

  it("is idempotent on dispose", async () => {
    const cw = makeCoworkers();
    await cw.sync([A]);
    cw.dispose();
    expect(() => cw.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Phase 4B — the population/position split
// ---------------------------------------------------------------------------

/** the same person, somewhere new and on a live V1 position */
function movedTo(base: Vo3dCoworker, x: number, z = 0): Vo3dCoworker {
  return { ...base, point: { x, z }, posSource: "live" };
}

function withOnChanged() {
  const onChanged = vi.fn();
  const parent = new THREE.Group();
  const cw = new Coworkers({ parent, canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1, onChanged });
  return { cw, onChanged };
}

describe("Coworkers.sync — position updates", () => {
  // THE ONE THAT MATTERS. Positions now arrive from a live feed, many per walk. If a position update took
  // the population path it would bump `generation` and drop whatever GLB was in flight — with people
  // moving faster than a character parses, nobody would ever finish loading and the office would stay
  // permanently empty with no error anywhere.
  it("NEVER cancels a character that is still downloading", async () => {
    autoResolve = false;
    const cw = makeCoworkers();
    const load = cw.sync([A]);
    await cw.sync([movedTo(A, 300)]);
    await cw.sync([movedTo(A, 600)]);
    flushPending();
    await load;
    expect(cw.size).toBe(1);
  });

  it("adds a late-landing body where that person is NOW, not where they were when the fetch started", async () => {
    autoResolve = false;
    const cw = makeCoworkers();
    const load = cw.sync([A]);
    await cw.sync([movedTo(A, 300)]);
    flushPending();
    await load;
    expect(cw.group.children[0].position.x).toBe(300);
  });

  it("does not re-request a character just because that person moved", async () => {
    autoResolve = false;
    const cw = makeCoworkers();
    const load = cw.sync([A]);
    await cw.sync([movedTo(A, 300)]);
    flushPending();
    await load;
    expect(loadCalls).toEqual(["bon"]);
  });

  it("moves the SAME body rather than rebuilding it — the idle clip is never restarted", async () => {
    const cw = makeCoworkers();
    await cw.sync([A]);
    const body = cw.group.children[0];
    await cw.sync([movedTo(A, 500)]);
    expect(cw.group.children[0]).toBe(body);
    expect(cw.group.children).toHaveLength(1);
    expect(body.position.x).toBe(500);
    expect(loadCalls).toEqual(["bon"]);
  });

  it("does not disturb anybody else when one person moves", async () => {
    const cw = makeCoworkers();
    await cw.sync([A, B, C]);
    const before = cw.group.children.map((c) => ({ node: c, x: c.position.x, z: c.position.z }));
    await cw.sync([A, movedTo(B, 900), C]);
    for (const { node, x, z } of before) {
      if (node.name === "coworker:b") continue;
      expect(node.parent).toBe(cw.group);
      expect(node.position.x).toBe(x);
      expect(node.position.z).toBe(z);
    }
  });
});

describe("Coworkers.sync — shadow invalidation", () => {
  it("reports a change once when somebody actually moves", async () => {
    const { cw, onChanged } = withOnChanged();
    await cw.sync([A, B]);
    onChanged.mockClear();
    await cw.sync([A, movedTo(B, 900)]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("reports NOTHING when a sync re-applies the positions already on screen", async () => {
    // A live store notifies on every walk_started as well as every arrival, and a roster refetch fires on
    // every SSE reconnect. Redrawing the shadow map for each of those costs more than the bodies do.
    const { cw, onChanged } = withOnChanged();
    await cw.sync([A, B]);
    onChanged.mockClear();
    await cw.sync([A, B]);
    await cw.sync([A, B]);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("reports a change when the population changes", async () => {
    const { cw, onChanged } = withOnChanged();
    await cw.sync([A, B]);
    onChanged.mockClear();
    await cw.sync([A]);
    expect(onChanged).toHaveBeenCalled();
  });

  // PHASE 4C STAGE 1. The world does two DIFFERENT things with these two reasons — a "population" change
  // re-marks the new clone's meshes onto the dynamic-caster layer, a "position" change does not — so a
  // sync that mislabels itself either leaves a body casting no shadow or re-marks the whole group on every
  // step somebody takes. Nothing here asserts a full static invalidation: a coworker is never in the
  // cached static depth, so there is nothing of it for them to stale.
  it("labels a pure MOVE as a position change — no new meshes exist", async () => {
    const { cw, onChanged } = withOnChanged();
    await cw.sync([A, B]);
    onChanged.mockClear();
    await cw.sync([A, movedTo(B, 900)]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith("position");
  });

  it("labels an ARRIVAL as a population change — the clone's meshes only exist now", async () => {
    const { cw, onChanged } = withOnChanged();
    await cw.sync([A]);
    onChanged.mockClear();
    await cw.sync([A, B]);
    expect(onChanged).toHaveBeenCalledWith("population");
  });

  it("labels a DEPARTURE as a population change", async () => {
    const { cw, onChanged } = withOnChanged();
    await cw.sync([A, B]);
    onChanged.mockClear();
    await cw.sync([A]);
    expect(onChanged).toHaveBeenCalledWith("population");
  });

  it("labels a CHARACTER SWAP as a population change — the old body is rebuilt, not moved", async () => {
    const { cw, onChanged } = withOnChanged();
    await cw.sync([A]);
    onChanged.mockClear();
    await cw.sync([{ ...A, avatarId: "micah" }]);
    expect(onChanged).toHaveBeenCalledWith("population");
  });

  it("reports the SUPERSET when one person leaves and another moves in the same sync", async () => {
    // Both happened, so the world must take the population path: skipping the re-mark here would leave
    // whatever is rebuilt afterwards off the caster layer.
    const { cw, onChanged } = withOnChanged();
    await cw.sync([A, B]);
    onChanged.mockClear();
    await cw.sync([movedTo(A, 700)]);
    expect(onChanged).toHaveBeenCalledWith("population");
  });

  it("labels a LATE-LANDING character as a population change once its GLB resolves", async () => {
    // The async half: the body is added long after sync() returned, and that is the moment its meshes
    // first exist. If this arrived as anything but "population" the late body would never be marked.
    autoResolve = false;
    const { cw, onChanged } = withOnChanged();
    const load = cw.sync([A]);
    onChanged.mockClear();
    flushPending();
    await load;
    expect(cw.size).toBe(1);
    expect(onChanged).toHaveBeenCalledWith("population");
  });

  it("a stream of MOVES never reports a population change — the re-mark is not per-step work", async () => {
    const { cw, onChanged } = withOnChanged();
    await cw.sync([A, B]);
    onChanged.mockClear();
    for (let x = 100; x <= 500; x += 100) await cw.sync([A, movedTo(B, x)]);
    expect(onChanged).toHaveBeenCalledTimes(5);
    expect(onChanged.mock.calls.every((c) => c[0] === "position")).toBe(true);
  });
});

describe("Coworkers — the read-only verification surface", () => {
  it("counts how many rendered bodies stand on a live V1 position", async () => {
    const cw = makeCoworkers();
    await cw.sync([A, B, C]);
    expect(cw.getStats().live).toBe(0);
    await cw.sync([movedTo(A, 10), B, movedTo(C, 20)]);
    expect(cw.getStats().live).toBe(2);
    expect(cw.getStats().rendered).toBe(3);
  });

  it("reports each body by DISPLAY NAME, position and source — never by email", async () => {
    const cw = makeCoworkers();
    await cw.sync([movedTo(A, 42), B]);
    expect(cw.positions()).toEqual([
      { name: "a", x: 42, z: 0, yaw: 0, source: "live", movementId: null, clip: "" },
      { name: "b", x: 200, z: 0, yaw: 0, source: "desk", movementId: null, clip: "" },
    ]);
    expect(JSON.stringify(cw.positions())).not.toContain("@");
  });
});
