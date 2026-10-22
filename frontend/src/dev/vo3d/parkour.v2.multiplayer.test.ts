// vo3d — PARKOUR V2, ACROSS TWO BROWSERS: what a peer's screen does with a relayed vault or mantle — the line it
// travels (the walk published with it), the heights it passes through, where it ends (only ever on a real top),
// and what happens when relays are late, stale, out of order or overtaken by newer movement. Same harness as
// parkour.multiplayer.test.ts: real Coworkers, a stand-in body, no network.

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Coworkers } from "./world/Coworkers";
import type { Vo3dCoworker } from "./app/coworkers";

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


const walk = (id: string, from: { x: number; z: number }, to: { x: number; z: number }, ms: number) =>
  coworker({ point: from, walk: { movementId: id, path: [from, to], durationMs: ms, elapsedMs: 0, pacing: "linear" } });

describe("a relayed VAULT", () => {
  it("travels the published line, arcs over the obstacle's top, lands at the end on the floor, articulated", async () => {
    const c = await world({ point: { x: 40, z: 40 } });
    await c.sync([walk("v-1", { x: 40, z: 40 }, { x: 40, z: -20 }, 640)]);
    expect(c.parkour(EMAIL, "vault", 0, 5000, 1, 640, 0, 25)).toBe(true);
    expect(tumbling(c)).toBe("vault");
    const zs: number[] = [];
    const apex = run(c, 45, () => zs.push(root(c).position.z));
    expect(apex).toBeGreaterThan(22);
    expect(zs[zs.length - 1]).toBeCloseTo(-20, 0);
    for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeLessThanOrEqual(zs[i - 1] + 1e-9);
    run(c, 10);
    expect(root(c).position.y).toBe(0);
    expect(tumbling(c)).toBeNull();
  });

  it("its own walk arriving just AFTER the relay is adopted as its line", async () => {
    const c = await world({ point: { x: 40, z: 40 } });
    expect(c.parkour(EMAIL, "vault", 0, 5000, 1, 640, 0, 25)).toBe(true);
    run(c, 3);
    await c.sync([walk("v-2", { x: 40, z: 40 }, { x: 40, z: -20 }, 640)]);
    run(c, 50);
    expect(root(c).position.z).toBeCloseTo(-20, 0);
    expect(root(c).position.y).toBe(0);
  });
});

describe("a relayed MANTLE", () => {
  it("ends standing on the REAL top it climbed onto — and stays there", async () => {
    const c = await world({ point: { x: 0, z: 30 } });
    await c.sync([walk("m-1", { x: 0, z: 30 }, { x: 0, z: 0 }, 800)]);
    expect(c.parkour(EMAIL, "mantle", 0, 6000, 2, 800, SOFA_TOP, SOFA_TOP)).toBe(true);
    expect(tumbling(c)).toBe("mantle");
    const ys: number[] = [];
    run(c, 60, () => ys.push(root(c).position.y));
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] - 1e-9); // up, never down
    run(c, 60);
    expect(root(c).position.y).toBeCloseTo(SOFA_TOP, 3);
  });

  it("a height that names NO real top where it ends is never honoured: the body ends on the floor", async () => {
    const c = await world({ point: { x: 80, z: 30 } });
    await c.sync([walk("m-2", { x: 80, z: 30 }, { x: 80, z: 0 }, 800)]); // no sofa there
    expect(c.parkour(EMAIL, "mantle", 0, 6000, 3, 800, SOFA_TOP, SOFA_TOP)).toBe(true);
    const apex = run(c, 120);
    expect(apex).toBeLessThan(0.5);
    expect(root(c).position.y).toBe(0);
  });
});

describe("a relayed MANTLE whose own walk arrives a moment AFTER it (the previous leg still replaying)", () => {
  it("adopts that walk as its line and still ends on the top it climbed to", async () => {
    const c = await world({ point: { x: 0, z: 90 } });
    await c.sync([walk("run-1", { x: 0, z: 90 }, { x: 0, z: 40 }, 900)]); // the running leg toward the sofa
    run(c, 30);
    expect(c.parkour(EMAIL, "mantle", 0, 6000, 2, 800, SOFA_TOP, SOFA_TOP)).toBe(true);
    run(c, 2);
    const at = { x: root(c).position.x, z: root(c).position.z };
    await c.sync([walk("m-3", at, { x: 0, z: 0 }, 800)]); // ITS walk, a couple of frames late
    expect(tumbling(c)).toBe("mantle");
    run(c, 120);
    expect(root(c).position.z).toBeCloseTo(0, 0);
    expect(root(c).position.y).toBeCloseTo(SOFA_TOP, 3);
  });
});

describe("ordering, staleness, interruption", () => {
  it("STALE (older than the move itself) and OUT-OF-ORDER relays are dropped", async () => {
    const c = await world();
    expect(c.parkour(EMAIL, "vault", 700, 5000, 1, 640, 0, 25)).toBe(false); // already over everywhere else
    expect(c.parkour(EMAIL, "mantle", 0, 5000, 4, 800, 0, 0)).toBe(true);
    expect(c.parkour(EMAIL, "vault", 0, 4990, 9, 640, 0, 25)).toBe(false); // older server time: an older action
    expect(c.parkour(EMAIL, "mantle", 0, 5000, 4, 800, 0, 0)).toBe(false); // the same relay again
  });

  it("a LATE relay picks the move up part-way through rather than replaying it from the start", async () => {
    const c = await world({ point: { x: 40, z: 40 } });
    await c.sync([walk("v-3", { x: 40, z: 40 }, { x: 40, z: -20 }, 640)]);
    expect(c.parkour(EMAIL, "vault", 400, 5000, 1, 640, 0, 25)).toBe(true);
    let frames = 0;
    while (tumbling(c) === "vault" && frames < 120) { c.update(DT); frames++; }
    expect(frames * DT * 1000).toBeLessThan(640); // (the pose catches up; the line and height are already at 400 ms)
  });

  it("NEWER MOVEMENT WINS: a later walk overtakes a traversal, which stops — nothing older overrides it", async () => {
    const c = await world({ point: { x: 40, z: 40 } });
    await c.sync([walk("v-4", { x: 40, z: 40 }, { x: 40, z: -20 }, 640)]);
    c.parkour(EMAIL, "vault", 0, 5000, 1, 640, 0, 25);
    run(c, 24); // past the adoption window, mid-air
    await c.sync([walk("w-5", { x: 40, z: 10 }, { x: 140, z: 10 }, 1000)]);
    run(c, 2);
    expect(tumbling(c)).toBeNull();
    expect(root(c).position.y).toBe(0);
    run(c, 70);
    expect(root(c).position.x).toBeCloseTo(140, 0);
  });
});
