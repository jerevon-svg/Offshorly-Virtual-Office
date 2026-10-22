// THE ARM PERCH, on the REAL shipped toucan.glb (decoded in node): a summoned bird lands on a landing point at the perched
// scale, is held exactly on it as it moves, folds BOTH wings back against its body, and on release opens them on the spot
// before it lifts off.
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { WeatherState } from "../env/weather";

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three/examples/jsm/loaders/GLTFLoader.js")>();
  class Loader extends actual.GLTFLoader {
    // the app loads public/toucan/toucan.glb by URL; the test decodes the same file in node
    override async loadAsync(): Promise<import("three/examples/jsm/loaders/GLTFLoader.js").GLTF> {
      const { loadHumanGlb } = await import("../human/humanGlb.testutil");
      return loadHumanGlb("avatars/../toucan/toucan.glb");
    }
  }
  return { ...actual, GLTFLoader: Loader };
});
const { Toucan } = await import("./Toucan");

const CLEAR = { state: "clear", wind: 0.1, wetness: 0 } as unknown as WeatherState;
const FRAME = { x: 0, z: 0, w: 1440, d: 1280 };
const BODY = { x: 400, z: 500 };
const step = (t: InstanceType<typeof Toucan>, s: number) => { for (let i = 0; i < Math.round(s * 60); i++) t.update(1 / 60, CLEAR, "day", true); };

describe("the toucan's arm perch (real asset)", () => {
  it("lands at the perched scale, stays on a moving perch, folds both wings, and opens them before lifting off", async () => {
    const t = new Toucan(FRAME, { x: 727, z: 556, y: 12 });
    expect(await t.load()).toBe(true);
    const bone = (n: string) => { let b: THREE.Object3D | undefined; t.root.traverse((o) => { if (!b && o.name === n) b = o; }); return b!; };
    const local = (o: THREE.Object3D) => t.root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
    const span = () => local(bone("LeftHand")).distanceTo(local(bone("RightHand")));

    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    expect(t.summonState).toBe("attending");
    const open = span();

    const perch = t.worldPosition.clone().add(new THREE.Vector3(4, -6, 2));
    t.setLanding(perch, 0.75);
    step(t, 3);
    expect(t.landed).toBe(true);
    expect(t.root.scale.x).toBeCloseTo(0.75, 2);
    expect(t.wingFold).toBe(1);
    // BOTH wings laid back: the wingtips close in on the body and sit behind the shoulders
    expect(span(), "folded span vs open").toBeLessThan(open * 0.5);
    const beak = local(bone("headfront")).sub(local(bone("Hips"))).setY(0).normalize();
    for (const s of ["Left", "Right"]) expect(local(bone(`${s}Hand`)).sub(local(bone(`${s}Arm`))).dot(beak), `${s} wingtip behind its shoulder`).toBeLessThan(0);
    // the head is alive while it listens
    const h0 = bone("Head").quaternion.clone(); step(t, 0.5);
    expect(bone("Head").quaternion.angleTo(h0)).toBeGreaterThan(0.005);

    // held exactly on a perch that moves (the body turning or stepping)
    for (let i = 0; i < 30; i++) { perch.x += 0.5; t.setLanding(perch, 0.75); t.update(1 / 60, CLEAR, "day", true); }
    expect(t.worldPosition.distanceTo(perch)).toBeLessThan(1e-6);

    // released: wings open ON the arm first, then it goes
    // (as app/world does: the landing stays set until the bird has left the arm)
    t.setSummonTarget(null);
    t.update(1 / 60, CLEAR, "day", true);
    expect(t.liftingOff).toBe(true);
    const at = t.worldPosition.clone();
    step(t, 0.3);
    expect(t.worldPosition.distanceTo(at), "still on the arm while the wings open").toBeLessThan(0.5);
    expect(t.wingFold).toBe(0);
    step(t, 0.2); t.setLanding(null);
    step(t, 1.3);
    expect(t.liftingOff).toBe(false);
    expect(t.root.scale.x, "back to its own size in flight").toBeGreaterThan(0.6);
    // and the fold is fully released: in flight both wings are spread again, as wide as before the perch
    step(t, 1);
    expect(t.wingFold).toBe(0);
    expect(span(), "wings spread in flight after the perch").toBeGreaterThan(open * 0.85);
    expect(t.worldPosition.distanceTo(at)).toBeGreaterThan(5);
  }, 60_000);
});
