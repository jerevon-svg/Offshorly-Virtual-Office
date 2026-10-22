// vo3d — PARKOUR V1, ACROSS TWO BROWSERS: what a peer's screen does with a relayed double jump (and its flip), a
// relayed landing roll, and a published feet height (somebody standing on a sofa). Same harness as
// jump.multiplayer.test.ts: real Coworkers, a stand-in body, no network — the relays are fed straight in.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Coworkers } from "./world/Coworkers";
import type { Vo3dCoworker } from "./app/coworkers";
import { PARKOUR_MS } from "./avatar/parkourPose";

const DT = 1 / 60;
const rig = vi.hoisted(() => ({ clips: ["idle-9", "walking", "sit-on-chair-arms"] }));
vi.mock("./avatar/humanBody", async (orig) => ({ ...(await orig<typeof import("./avatar/humanBody")>()), humanBodyFor: () => null }));
vi.mock("./avatar/CastPrototypes", async () => {
  const T = await import("three");
  return {
    prototypeFor: (id: string) => {
      const scene = new T.Group();
      const mesh = new T.Mesh(new T.BoxGeometry(1, 36, 1), new T.MeshStandardMaterial());
      mesh.name = "body";
      scene.add(mesh);
      const clips = rig.clips.map((name) => new T.AnimationClip(name, 1.067, [new T.VectorKeyframeTrack("body.position", [0, 1.067], [0, 0, 0, 0, 0, 0])]));
      return Promise.resolve({ id, gltf: {} as never, scene, clips, triangles: 100, headY: 36 });
    },
    castLabelTexture: () => new T.CanvasTexture(document.createElement("canvas")),
  };
});

const EMAIL = "peer@offshorly.com";
const coworker = (o: Partial<Vo3dCoworker> = {}): Vo3dCoworker => ({
  email: EMAIL, displayName: "Peer", avatarId: "bon", point: { x: 0, z: 0 }, posSource: "live", box: { width: 20, height: 37 }, facing: "south", ...o,
});
/** a sofa-sized standable top at the origin: 15.6 high, radius 12 */
const SOFA_TOP = 15.6;
const onSofa = (p: { x: number; z: number }) => Math.hypot(p.x, p.z) < 12;
const topAt = (p: { x: number; z: number }, feet: number) => (onSofa(p) && Math.abs(feet - SOFA_TOP) <= 2.5 ? SOFA_TOP : null);

async function world(c: Partial<Vo3dCoworker> = {}, deps: Partial<ConstructorParameters<typeof Coworkers>[0]> = {}) {
  const cw = new Coworkers({ parent: new THREE.Group(), canStand: () => true, radius: 8, toWorld: (p) => p, topAt, ...deps });
  await cw.sync([coworker(c)]);
  return cw;
}
const root = (c: Coworkers): THREE.Object3D => c.group.children[0];
const tumbling = (c: Coworkers): string | null => (c as unknown as { bodies: Map<string, { tumbling: string | null }> }).bodies.get(EMAIL)!.tumbling;
function run(c: Coworkers, frames: number, each?: () => void): number {
  let apex = 0;
  for (let i = 0; i < frames; i++) { c.update(DT); apex = Math.max(apex, root(c).position.y); each?.(); }
  return apex;
}

describe("a relayed DOUBLE JUMP", () => {
  it("from the peer's own arc: a second takeoff, ONE flip, a higher apex, then a landing absorb", async () => {
    const c = await world();
    expect(c.jump(EMAIL, 0, 1000, 1)).toBe(true);
    run(c, 18); // near the top of the first arc
    expect(c.parkour(EMAIL, "double", 0, 1300, 2)).toBe(true);
    expect(tumbling(c)).toBe("flip");
    let sawLand = false;
    const apex = run(c, 120, () => { if (tumbling(c) === "land") sawLand = true; });
    expect(apex).toBeGreaterThan(20);
    expect(sawLand).toBe(true);
    expect(root(c).position.y).toBe(0);
  });

  it("with NO arc to build on (its jump was lost): one ordinary hop and NO flip — and the late jump is then dropped", async () => {
    const c = await world();
    expect(c.parkour(EMAIL, "double", 0, 1300, 2)).toBe(true);
    expect(tumbling(c)).toBeNull();
    const apex = run(c, 60);
    expect(apex).toBeLessThan(13);
    expect(c.jump(EMAIL, 0, 1000, 1)).toBe(false); // older than what was already applied for this sender
  });

  it("DUPLICATES and REORDERED relays never play twice", async () => {
    const c = await world();
    expect(c.jump(EMAIL, 0, 1000, 1)).toBe(true);
    run(c, 10);
    expect(c.parkour(EMAIL, "double", 0, 1300, 2)).toBe(true);
    expect(c.parkour(EMAIL, "double", 0, 1300, 2)).toBe(false); // the same relay again
    expect(c.parkour(EMAIL, "double", 0, 1200, 3)).toBe(false); // an older one
  });

  it("STALE relays are dropped, never drawn late", async () => {
    const c = await world();
    expect(c.parkour(EMAIL, "double", 1500, 1300, 2)).toBe(false);
    expect(c.parkour(EMAIL, "roll", 900, 1400, 3, 800)).toBe(false); // older than the roll itself
  });
});

describe("a relayed LANDING ROLL", () => {
  it("plays the shoulder roll for exactly the duration it was sent with", async () => {
    const c = await world();
    expect(c.parkour(EMAIL, "roll", 0, 2000, 5, 900)).toBe(true);
    expect(tumbling(c)).toBe("roll");
    let frames = 0;
    while (tumbling(c) === "roll" && frames < 300) { c.update(DT); frames++; }
    expect(frames * DT * 1000).toBeGreaterThan(880);
    expect(frames * DT * 1000).toBeLessThan(940);
  });

  it("arriving while the peer's own arc is still in the air: it waits for that landing", async () => {
    const c = await world();
    c.jump(EMAIL, 0, 1000, 1);
    run(c, 5);
    expect(c.parkour(EMAIL, "roll", 0, 1100, 2, PARKOUR_MS.roll)).toBe(true);
    expect(tumbling(c)).toBeNull();
    let rolled = false;
    run(c, 60, () => { if (tumbling(c) === "roll") rolled = true; });
    expect(rolled).toBe(true);
  });

  it("travels with the WALK it was published with: the roll is drawn moving along the path, not in place", async () => {
    const c = await world();
    // the publisher sends the roll's planned travel as an ordinary decel walk, and the roll beside it
    await c.sync([coworker({ walk: { movementId: "roll-1", path: [{ x: 0, z: 0 }, { x: 0, z: -40 }], durationMs: 900, elapsedMs: 0, pacing: "decel" } })]);
    c.parkour(EMAIL, "roll", 0, 3000, 9, 900);
    const zs: number[] = [];
    run(c, 54, () => zs.push(root(c).position.z));
    expect(zs[0]).toBeLessThan(0);
    expect(zs[zs.length - 1]).toBeLessThan(-35);
    for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeLessThanOrEqual(zs[i - 1] + 1e-9); // forward, never back
  });
});

describe("somebody STANDING ON A SOFA — the published feet height", () => {
  beforeEach(() => vi.useRealTimers());

  it("lifts them onto a REAL top under them, for everyone including a late joiner", async () => {
    const c = await world({ feet: SOFA_TOP });
    run(c, 60);
    expect(root(c).position.y).toBeCloseTo(SOFA_TOP, 1);
  });

  it("a height that names no real top is ignored: nobody is floated by a hint", async () => {
    const c = await world({ feet: 60 });
    run(c, 60);
    expect(root(c).position.y).toBe(0);
    const d = await world({ feet: SOFA_TOP, point: { x: 80, z: 0 } }); // no sofa there
    run(d, 60);
    expect(root(d).position.y).toBe(0);
  });

  it("with no hint (a V1 peer, anybody at their desk) nothing changes — never perched on a chair", async () => {
    const c = await world({});
    run(c, 60);
    expect(root(c).position.y).toBe(0);
  });

  it("is PLACED on the top even though a floor-level stand test refuses the spot — and only then", async () => {
    const insideSofaRefused = (p: { x: number; z: number }) => !onSofa(p);
    const on = await world({ feet: SOFA_TOP }, { canStand: insideSofaRefused });
    expect(root(on).position.x).toBe(0);
    expect(root(on).position.z).toBe(0);
    const off = await world({}, { canStand: insideSofaRefused });
    expect(Math.hypot(root(off).position.x, root(off).position.z)).toBeGreaterThanOrEqual(12);
  });
});
