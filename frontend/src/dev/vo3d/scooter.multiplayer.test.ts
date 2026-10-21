// S2 — a remote rider's REAL body on a scooter (world/Coworkers setScooterRide), the local rider's quiet
// movement feed while the pose stream carries them (app/selfMovement), and the scooters drawn under them
// (build/exterior placeRemote).
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Coworkers } from "./world/Coworkers";
import type { Vo3dCoworker } from "./app/coworkers";
import { SelfMovementFeed, type Vo3dSelfMovementSink } from "./app/selfMovement";
import { buildExterior } from "./build/exterior";
import { scooterStations } from "./world/scooters";
import { v1Sidewalk } from "./adapters/v1Floor";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only); vitest runs it in node
import { readFileSync } from "node:fs";

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

const EMAIL = "rider@offshorly.com";
const DT = 1 / 60;
const coworker = (over: Partial<Vo3dCoworker> = {}): Vo3dCoworker => ({
  email: EMAIL, displayName: "Rider", avatarId: "bon", point: { x: 0, z: 0 }, posSource: "live", box: { width: 20, height: 37 }, facing: "south", ...over,
});
async function world(): Promise<Coworkers> {
  const c = new Coworkers({ parent: new THREE.Group(), canStand: () => true, radius: 8, toWorld: (p) => p });
  await c.sync([coworker()]);
  return c;
}
const root = (c: Coworkers) => c.group.children[0];

describe("a remote rider's real body on the scooter", () => {
  it("stands on the deck where the stream says, turned and raised, and will not jump or walk while there", async () => {
    const c = await world();
    expect(c.setScooterRide(EMAIL, { x: 1200, z: 1330, y: 4.5, yaw: 1, lean: 0.1, pitch: 0 })).toBe(true);
    c.update(DT);
    expect([root(c).position.x, root(c).position.y, root(c).position.z]).toEqual([1200, 4.5, 1330]);
    expect(root(c).rotation.y).toBeCloseTo(1, 9);
    expect(c.jump(EMAIL)).toBe(false);
    expect(c.setScooterRide("nobody@x", { x: 0, z: 0, y: 0, yaw: 0, lean: 0, pitch: 0 })).toBe(false);
  });

  it("the step-off walk that overtakes the release is held, then played the moment the ride ends", async () => {
    const c = await world();
    c.setScooterRide(EMAIL, { x: 100, z: 0, y: 4, yaw: 0, lean: 0, pitch: 0 });
    c.update(DT);
    await c.sync([coworker({ point: { x: 100, z: 200 }, walk: { movementId: "off", path: [{ x: 100, z: 0 }, { x: 100, z: 200 }], durationMs: 500, elapsedMs: 0, pacing: "linear" } })]);
    for (let i = 0; i < 10; i++) c.update(DT);
    expect(root(c).position.z).toBe(0); // still on the deck
    c.setScooterRide(EMAIL, null);
    for (let i = 0; i < 120; i++) c.update(DT);
    expect(root(c).position.z).toBeCloseTo(200, 0);
    expect(root(c).position.y).toBe(0); // and back on the ground
  });
});

describe("the local rider's movement feed while the stream carries them", () => {
  function rec() {
    const calls: string[] = [];
    type V = { x: number; z: number };
    const sink = {
      started: (o: V, p: readonly V[]) => calls.push(`started:${o.x},${o.z}>${p.map((q) => `${q.x},${q.z}`).join("|")}`),
      arrived: (p: V) => calls.push(`arrived:${p.x},${p.z}`),
      seated: () => calls.push("seated"),
      enteredPlace: (p: V, _y: number, place: string | null) => calls.push(`place:${place}@${p.x},${p.z}`),
      movedInPlace: () => calls.push("movedInPlace"),
    } as unknown as Vo3dSelfMovementSink;
    return { sink, calls };
  }

  it("publishes nothing while mounted, then exactly one relocation where they stepped off", () => {
    const { sink, calls } = rec();
    const feed = new SelfMovementFeed(sink);
    feed.placed({ x: 500, z: 500 });
    calls.length = 0;
    feed.mountedScooter({ x: 500, z: 500 }, 0);
    expect(feed.ridingScooter).toBe(true);
    for (let i = 1; i <= 60; i++) feed.frame(16, { x: 500 + i * 3, z: 500 }, 0, false);
    expect(calls).toEqual([]);
    feed.dismountedScooter({ x: 700, z: 520 }, 0);
    expect(feed.ridingScooter).toBe(false);
    expect(calls.some((c) => c.startsWith("arrived:700,520"))).toBe(true);
    const n = calls.length;
    feed.frame(16, { x: 700, z: 520 }, 0, false);
    expect(calls.length).toBe(n); // nothing repeated
  });
});

describe("the scooters drawn under other riders", () => {
  it("one slot per scooter in the fleet, in the existing batches; a seventh is never drawn, a released slot is reused", () => {
    const sc = buildExterior({ scooterStations: scooterStations(v1Sidewalk()) });
    const s = sc.scooters!;
    const moving = sc.root.getObjectByName("traffic-gloss") as THREE.BatchedMesh;
    const visible = () => { let n = 0; for (let i = 0; i < 500; i++) { try { if (moving.getVisibleAt(i)) n++; } catch { break; } } return n; };
    const base = visible();
    const ids = ["scooter-r1", "scooter-r2", "scooter-r3", "scooter-r4", "scooter-l1", "scooter-l2"];
    ids.forEach((id, i) => s.placeRemote(id, 100 * i, 1330, 0, 0));
    expect(visible()).toBe(base + 6 * 2); // paint + detail per scooter in the gloss batch
    s.placeRemote("extra", 0, 0, 0, 0);
    expect(visible()).toBe(base + 12);
    s.placeRemote("scooter-r1", 50, 1330, 0.2, 0.1); // the same scooter again: moved, not doubled
    expect(visible()).toBe(base + 12);
    s.hideRemote("scooter-r1");
    expect(visible()).toBe(base + 10);
    s.placeRemote("extra", 0, 0, 0, 0);
    expect(visible()).toBe(base + 12);
    s.hideRemote("never-placed");
  });
});

describe("wiring", () => {
  const strip = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  it("a streamed ride quiets the feed on the way on and hands back to it on the way off", () => {
    const w = strip("src/dev/vo3d/app/world.ts");
    expect(w).toContain("selfFeed?.mountedScooter({ ...playerMode.body.pos }, avatar.yaw);");
    // (S6: after an accident the hand-back waits until they are up — app/world endLocalFall)
    expect(w).toContain("if (rideStreamed) { rideStreamed = false; ridePoseNow = null; if (!accident) selfFeed?.dismountedScooter(at, avatar.yaw); }");
    expect(w).toContain("selfFeed?.dismountedScooter({ ...playerMode.body.pos }, avatar.yaw);");
    expect(w).toContain("rideStreamed = scooterGate.online;");
    expect(w).toContain("remoteRiders.update(Date.now());");
  });
});
