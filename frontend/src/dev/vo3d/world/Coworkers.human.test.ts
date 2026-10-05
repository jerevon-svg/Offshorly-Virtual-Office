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
      const human = { root, scene, update, dispose, stats: () => ({ triangles: 42 }), actionFor: (n: string) => actions[n] };
      const clipName = (n: string) => (n === CLIP_IDLE ? "idle-masculine" : n);
      return { human, clips: [...lib, Object.assign(lib[0].clone(), { name: CLIP_IDLE })], clipName, action: (n: string) => actions[clipName(n)] };
    },
  };
});

const coworker = (email: string, avatarId: string): Vo3dCoworker => ({
  email, displayName: email.split("@")[0], avatarId, point: { x: 0, z: 0 }, box: { width: 26, height: 37 }, posSource: "desk", facing: "south",
});
const make = () => new Coworkers({ parent: new THREE.Group(), canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1 });

beforeEach(() => { legacyCalls.length = 0; humanCalls.length = 0; built.length = 0; humanFails = false; });

describe("Coworkers — HumanBase remote parity", () => {
  it("a remote Bon is a HumanBase body from the shared factory; a legacy employee is the shared prototype", async () => {
    const cw = make();
    await cw.sync([coworker("jerevon@x.com", "bon"), coworker("alex@x.com", "alex")]);
    expect(humanCalls).toEqual(["bon"]);
    expect(legacyCalls).toEqual(["alex"]);
    expect(cw.size).toBe(2);
    const bonRoot = cw.group.children.find((c) => c.name === "coworker:jerevon")!;
    expect(bonRoot.children).toContain(built[0].root);
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
