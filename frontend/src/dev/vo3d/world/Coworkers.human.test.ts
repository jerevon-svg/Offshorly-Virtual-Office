// HumanBase Phase 2 — a REMOTE HumanBase employee is built by the same factory the local player uses
// (avatar/humanBody createHumanBody), resolved by the same appearance resolver (humanBodyFor); everyone else,
// and a HumanBase load failure, keeps the legacy shared prototype. The factory is stubbed (no GLB in node).
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Coworkers } from "./Coworkers";
import type { Vo3dCoworker } from "../app/coworkers";
import { CLIP_IDLE } from "../adapters/v1Avatar";

const legacyCalls: string[] = [];
const humanCalls: string[] = [];
let humanFails = false;
const built: { update: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; root: THREE.Group }[] = [];
/** S2 — post-mixer layers a HumanBase body was given (the scooter rider pose is one) */
const layers: string[] = [];

vi.mock("../avatar/CastPrototypes", () => ({
  prototypeFor: (id: string) => {
    legacyCalls.push(id);
    return Promise.resolve({ id, gltf: {} as never, scene: new THREE.Group(), clips: [] as THREE.AnimationClip[], triangles: 100, headY: 36 });
  },
  castLabelTexture: () => new THREE.CanvasTexture(document.createElement("canvas")),
}));

vi.mock("../avatar/humanBody", async (orig) => {
  const real = await orig<typeof import("../avatar/humanBody")>();
  return {
    ...real,
    createHumanBody: async (cfg: { employeeId: string }) => {
      humanCalls.push(cfg.employeeId);
      if (humanFails) throw new Error("no GLB");
      const root = new THREE.Group(), scene = new THREE.Group();
      root.add(scene);
      const mixer = new THREE.AnimationMixer(scene);
      const track = (n: string) => new THREE.AnimationClip(n, 1, [new THREE.NumberKeyframeTrack(".scale[x]", [0, 1], [1, 1])]);
      const lib = ["idle-masculine", "walking", "running", "sit-on-chair-arms"].map(track);
      const actions = Object.fromEntries(lib.map((c) => [c.name, mixer.clipAction(c)]));
      const update = vi.fn((dt: number) => mixer.update(dt)), dispose = vi.fn();
      built.push({ update, dispose, root });
      const human = { root, scene, update, dispose, stats: () => ({ triangles: 42 }), actionFor: (n: string) => actions[n], addLayer: (l: { id: string }) => layers.push(l.id) };
      const clipName = (n: string) => (n === CLIP_IDLE ? "idle-masculine" : n);
      return { human, clips: [...lib, Object.assign(lib[0].clone(), { name: CLIP_IDLE })], clipName, action: (n: string) => actions[clipName(n)] };
    },
  };
});

const coworker = (email: string, avatarId: string): Vo3dCoworker => ({
  email, displayName: email.split("@")[0], avatarId, point: { x: 0, z: 0 }, box: { width: 26, height: 37 }, posSource: "desk", facing: "south",
});
const make = () => new Coworkers({ parent: new THREE.Group(), canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1 });

beforeEach(() => { legacyCalls.length = 0; humanCalls.length = 0; built.length = 0; humanFails = false; layers.length = 0; });

describe("Coworkers — HumanBase remote parity", () => {
  it("a remote Bon is a HumanBase body from the shared factory; a legacy employee is the shared prototype", async () => {
    const cw = make();
    await cw.sync([coworker("jerevon@x.com", "bon"), coworker("alex@x.com", "alex")]);
    expect(humanCalls).toEqual(["bon"]);
    expect(legacyCalls).toEqual(["alex"]);
    expect(cw.size).toBe(2);
    const bonRoot = cw.group.children.find((c) => c.name === "coworker:jerevon")!;
    // mounted under this coworker's root, through the body's model frame (the scooter rider pose leans it)
    expect(built[0].root.parent?.parent).toBe(bonRoot);
  });

  it("S2 — a HumanBase peer on a scooter: the rider pose is ONE layer on its runtime, added on the first ride only", async () => {
    const cw = make();
    await cw.sync([coworker("jerevon@x.com", "bon")]);
    expect(layers).toEqual(["vo-gait-shape"]); // the gait's shape is every body's; the rider's only once they ride
    expect(cw.setScooterRide("jerevon@x.com", { x: 900, z: 1330, y: 4, yaw: 0.5, lean: 0.1, pitch: 0 })).toBe(true);
    cw.update(1 / 60);
    const bonRoot = cw.group.children.find((c) => c.name === "coworker:jerevon")!;
    expect([bonRoot.position.x, bonRoot.position.y, bonRoot.position.z]).toEqual([900, 4, 1330]);
    cw.setScooterRide("jerevon@x.com", null);
    cw.setScooterRide("jerevon@x.com", { x: 910, z: 1330, y: 4, yaw: 0.5, lean: 0, pitch: 0 });
    // (S6: the crash layer is made with it — a crash only ever follows a ride)
    expect(layers).toEqual(["vo-gait-shape", "vo-scooter-rider", "vo-scooter-crash"]);
  });

  it("S6 — a peer's CRASH frame drives its body: the root stays upright under the hips; a body with no rig to pose is tipped whole about its hips; null gives it back", async () => {
    const cw = make();
    await cw.sync([coworker("jerevon@x.com", "bon")]);
    const root = cw.group.children.find((c) => c.name === "coworker:jerevon")!;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.6, 0, -0.8), Math.PI / 2);
    const crash = { hip: { x: 900, y: 6, z: 1330 }, q, ground: 2, contact: 1, anchor: 0, weight: 1, limbs: new Array(16).fill(0) };
    cw.setScooterRide("jerevon@x.com", { x: 900, z: 1330, y: 2, yaw: 0.4, lean: 0, pitch: 0, crash, rider: false });
    cw.update(1 / 60);
    // the stub body has no skeleton: the fallback tips the whole body about its hips
    expect(root.quaternion.angleTo(q)).toBeLessThan(1e-6);
    expect(layers).toContain("vo-scooter-crash");
    cw.setScooterRide("jerevon@x.com", null);
    cw.update(1 / 60);
    expect([root.rotation.x, root.rotation.z]).toEqual([0, 0]); // back on its feet
  });

  it("speaks VO's clip names: idle-9 rests on the idle profile, the runtime (not a bare mixer) is ticked", async () => {
    const cw = make();
    await cw.sync([coworker("jerevon@x.com", "bon")]);
    expect(cw.restingClips()["jerevon@x.com"]).toBe(CLIP_IDLE);
    cw.update(0.016);
    expect(built[0].update).toHaveBeenCalledWith(0.016);
  });

  it("a HumanBase load failure falls back to the legacy character, never to an absent person", async () => {
    humanFails = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cw = make();
    await cw.sync([coworker("jerevon@x.com", "bon")]);
    expect(legacyCalls).toEqual(["bon"]);
    expect(cw.size).toBe(1);
    warn.mockRestore();
  });

  it("removing the peer disposes its own HumanBase runtime", async () => {
    const cw = make();
    await cw.sync([coworker("jerevon@x.com", "bon")]);
    await cw.sync([]);
    expect(built[0].dispose).toHaveBeenCalled();
  });

  it("lift riders take the same resolver", async () => {
    const cw = make();
    expect(await cw.addRider("jerevon@x.com", "bon", "jerevon", { x: 0, z: 0 }, 0)).toBe(true);
    expect(humanCalls).toEqual(["bon"]);
    expect(legacyCalls).toEqual([]);
  });
});
