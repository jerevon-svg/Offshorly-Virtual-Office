// ARM PERCH on a real composed Bon: the presented arm comes up straight ahead, a little raised and nearly straight; a folded
// toucan at the (companion-sized) perched scale, standing on the fist and turned to face him, clears his face, hair and
// body; the eyes look at it; lowering the arm hands it back to the clip.
import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only).
import fs from "node:fs";
import { HUMAN_WORLD_SCALE as W, type EmployeeAvatar } from "./humanBaseContract";
import { BON_AVATAR, CATALOGUE_BY_ID, HUMAN_BASE_URL } from "./humanCatalogue";
import { HumanAvatar, setGlbFetcher } from "./HumanAvatar";
import { loadHumanGlb, publicPath } from "./humanGlb.testutil";
import { ArmPerch } from "./armPerch";

/** the folded toucan as spheres (body, head, beak), in its GLB units about its origin, beak along +z; ×10 = world at
 *  scale 1 (LENGTH 17 over the asset's 1.70 wingspan). Measured off public/toucan/toucan.glb's bones. */
const BIRD: [number, number, number, number][] = [[0, -0.11, -0.1, 0.27], [0, 0.29, 0.1, 0.2], [0, 0.27, 0.35, 0.1], [0, 0.25, 0.55, 0.06]];
const FOOT = 0.534, PERCH_SCALE = 0.75;   // as app/world.ts

describe.skipIf(!fs.existsSync(publicPath(HUMAN_BASE_URL)))("ArmPerch (Bon)", () => {
  beforeAll(() => setGlbFetcher(loadHumanGlb));
  it("presents the arm straight ahead, a perched bird clears face, hair and body, and the arm lowers again", async () => {
    const a = await HumanAvatar.create(structuredClone(BON_AVATAR) as EmployeeAvatar, CATALOGUE_BY_ID);
    const perch = new ArmPerch(a); a.addLayer(perch.layer());
    const run = (s: number) => { for (let t = 0; t < s; t += 1 / 60) a.update(1 / 60); };
    const wp = (n: string) => a.rig.bone(n).getWorldPosition(new THREE.Vector3());
    perch.want = 1; run(1.2);
    expect(perch.extended).toBe(true);
    const sh = wp("RightArm"), fore = wp("RightForeArm"), hand = wp("RightHand"), p = perch.perchPoint(), out = perch.outward();
    const chain = sh.distanceTo(fore) + fore.distanceTo(hand);
    expect(hand.distanceTo(sh) / chain, "elbow mostly straight").toBeGreaterThan(0.8);
    expect(p.z - sh.z, "in front of the body (it faces +z)").toBeGreaterThan(0.3 * W);
    expect(Math.abs(p.clone().sub(sh).dot(out)), "in front of its own shoulder, not swung out").toBeLessThan(0.12 * W);
    expect(p.y - sh.y, "a little above the shoulder").toBeGreaterThan(0);
    expect(p.y - sh.y).toBeLessThan(0.25 * W);
    const along = hand.clone().sub(fore);
    expect(along.y / along.length(), "forearm rising gently, not pointing up").toBeLessThan(0.5);
    perch.lookAt = p.clone().add(new THREE.Vector3(0, 4, 0)); run(0.6);
    expect(a.face?.lookTarget ?? null, "the eyes on the bird").not.toBeNull();
    expect(a.clearance.intentional("R")).toBe(true);

    // the folded bird on the perch, turned to the face front: clear of every body / hair / garment vertex not on the
    // perching forearm and hand
    const face = perch.headCentre().add(new THREE.Vector3(0, 0, 6)), yaw = Math.atan2(face.x - p.x, face.z - p.z), k = 10 * PERCH_SCALE;
    const origin = p.clone().add(new THREE.Vector3(0, FOOT * k, 0));
    const spheres = BIRD.map(([x, y, z, r]) => ({ c: new THREE.Vector3(x * k, y * k, z * k).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(origin), r: r * k }));
    let clear = Infinity;
    a.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !m.visible) return;
      const pos = m.geometry.getAttribute("position"), si = m.geometry.getAttribute("skinIndex"), sw = m.geometry.getAttribute("skinWeight"), v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += 2) {
        let best = 0, bi = 0; for (let j = 0; j < 4; j++) if (sw.getComponent(i, j) > best) { best = sw.getComponent(i, j); bi = si.getComponent(i, j); }
        if (/^Right(ForeArm|Hand|Thumb|Index|Fingers)/.test(m.skeleton.bones[bi].name)) continue;
        v.fromBufferAttribute(pos, i); m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld);
        for (const s of spheres) clear = Math.min(clear, v.distanceTo(s.c) - s.r);
      }
    });
    expect(clear, "bird clear of the face, hair and body").toBeGreaterThan(0.3);

    perch.want = 0; perch.lookAt = null; run(1);
    expect(a.face?.lookTarget ?? null, "eyes handed back").toBeNull();
    expect(perch.weight).toBe(0);
    expect(wp("RightArm").y - wp("RightHand").y, "arm hanging in the clip again").toBeGreaterThan(0.2 * W);
    expect(a.clearance.intentional("R")).toBe(false);
  }, 120_000);
});
