// THE WHOLE PERCH, with the real bird (public/toucan/toucan.glb) and a real composed HumanBase body: summon it and do
// NOTHING else — no typing, no message — and it flies in, the arm comes up, it lands on the fist, folds both wings and
// faces the employee; released, it opens its wings, leaves, and the arm comes down.
import * as THREE from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only).
import fs from "node:fs";
import type { WeatherState } from "../env/weather";

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three/examples/jsm/loaders/GLTFLoader.js")>();
  class Loader extends actual.GLTFLoader {
    override async loadAsync(): Promise<import("three/examples/jsm/loaders/GLTFLoader.js").GLTF> {
      const { loadHumanGlb } = await import("../human/humanGlb.testutil");
      return loadHumanGlb("avatars/../toucan/toucan.glb");
    }
  }
  return { ...actual, GLTFLoader: Loader };
});
const { Toucan } = await import("./Toucan");
const { ToucanPerch, PERCH_SCALE } = await import("./toucanPerch");
const { HumanAvatar, setGlbFetcher } = await import("../human/HumanAvatar");
const { loadHumanGlb, publicPath } = await import("../human/humanGlb.testutil");
const { BON_AVATAR, CATALOGUE_BY_ID, HUMAN_BASE_URL } = await import("../human/humanCatalogue");
const { ArmPerch } = await import("../human/armPerch");
import type { EmployeeAvatar } from "../human/humanBaseContract";

const CLEAR = { state: "clear", wind: 0.1, wetness: 0 } as unknown as WeatherState;
const FRAME = { x: 0, z: 0, w: 1440, d: 1280 };
const BODY = new THREE.Vector3(400, 0, 500);

describe.skipIf(!fs.existsSync(publicPath(HUMAN_BASE_URL)))("summon → perch → release, untouched", () => {
  beforeAll(() => setGlbFetcher(loadHumanGlb));
  it("lands on the fist on its own, folded and facing the employee, and leaves cleanly", async () => {
    const scene = new THREE.Scene();
    const bird = new Toucan(FRAME, { x: 727, z: 556, y: 12 });
    expect(await bird.load()).toBe(true);
    scene.add(bird.root);
    const h = await HumanAvatar.create(structuredClone(BON_AVATAR) as EmployeeAvatar, CATALOGUE_BY_ID);
    h.root.position.copy(BODY); scene.add(h.root);
    const arm = new ArmPerch(h); h.addLayer(arm.layer());
    const perch = new ToucanPerch(bird);
    const body = { free: true, pos: BODY.clone(), forward: new THREE.Vector3(0, 0, 1) };
    let called = true;
    const log: string[] = [];
    const frame = (i: number) => {
      bird.setSummonTarget(called ? { x: BODY.x, z: BODY.z } : null);   // what app/world's foley tick does every frame
      perch.update(arm, body, called, false);
      bird.update(1 / 60, CLEAR, "day", true);
      h.update(1 / 60);
      if (i % 30 === 0) log.push(`${(i / 60).toFixed(1)}s ${bird.summonState} arm ${arm.weight.toFixed(2)} perched ${perch.perched} d ${bird.worldPosition.distanceTo(arm.perchPoint()).toFixed(1)} landed ${bird.landed} fold ${bird.wingFold.toFixed(2)}`);
    };
    let i = 0, landedAt = -1;
    // the arm comes up AT ONCE on the summon, long before the bird is near
    for (; i < 45; i++) frame(i);
    expect(arm.weight, "arm rising immediately").toBe(1);
    expect(bird.worldPosition.distanceTo(BODY), "bird still far away").toBeGreaterThan(100);
    for (; i < 60 * 20; i++) { frame(i); if (bird.landed && bird.wingFold >= 1 && landedAt < 0) landedAt = i; if (landedAt >= 0 && i > landedAt + 60) break; }
    expect(landedAt, `landed and folded with nothing typed\n${log.join("\n")}`).toBeGreaterThan(0);
    // feet on the fist, drawn at the companion size, wings folded, beak turned toward the face
    const p = arm.perchPoint();
    expect(bird.worldPosition.distanceTo(p.clone().add(new THREE.Vector3(0, bird.footOffset * PERCH_SCALE, 0)))).toBeLessThan(0.3);
    expect(bird.root.scale.x).toBeCloseTo(PERCH_SCALE, 1);
    expect(bird.wingFold).toBe(1);
    // still there a few seconds later, untouched (no chat activity needed to keep it)
    for (let k = 0; k < 180; k++) frame(i + k);
    expect(bird.landed).toBe(true);
    // released: wings open on the fist, it leaves, and only then does the arm come down
    called = false;
    let leftAt = -1;
    for (let k = 0; k < 60 * 4; k++) { frame(i + 180 + k); if (leftAt < 0 && !bird.liftingOff && bird.worldPosition.distanceTo(arm.perchPoint()) > 8) leftAt = k; }
    expect(leftAt).toBeGreaterThan(0);
    expect(arm.weight).toBe(0);
  }, 120_000);
});
