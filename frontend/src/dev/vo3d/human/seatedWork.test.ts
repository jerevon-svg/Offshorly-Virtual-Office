// SEATED WORK, on a real composed Bon in VO's seated clip: a desk with a monitor in front → typing with the fingertips on
// the desk; a cafe table (no monitor) or open space → hands rest on the lap; standing eases everything back out.
import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only).
import fs from "node:fs";
import { HUMAN_WORLD_SCALE as W, type EmployeeAvatar } from "./humanBaseContract";
import { BON_AVATAR, CATALOGUE_BY_ID, HUMAN_BASE_URL } from "./humanCatalogue";
import { HumanAvatar, setGlbFetcher } from "./HumanAvatar";
import { loadHumanGlb, publicPath } from "./humanGlb.testutil";
import { SeatedWork } from "./seatedWork";
import { createHumanBody } from "../avatar/humanBody";
import { deskSeatedRootForRig, HUMANBASE_PELVIS_BELOW_HIPS, sceneRig } from "../interact/seatContact";

const SIT = "sit-on-chair-arms";
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial()); m.position.set(x, y, z); return m; };

async function seated(furnish: (sh: THREE.Vector3, head: THREE.Vector3) => THREE.Object3D[]) {
  const a = await HumanAvatar.create(structuredClone(BON_AVATAR) as EmployeeAvatar, CATALOGUE_BY_ID);
  const scene = new THREE.Scene(); scene.add(a.root);
  a.play(SIT, 0); a.update(1 / 60);
  const wp = (n: string) => a.rig.bone(n).getWorldPosition(new THREE.Vector3());
  const sh = wp("LeftArm").add(wp("RightArm")).multiplyScalar(0.5);
  for (const o of furnish(sh, wp("Head"))) scene.add(o);
  const sw = new SeatedWork(a);
  const run = (s: number, on: boolean) => { for (let t = 0; t < s; t += 1 / 60) { sw.update(1 / 60, on); a.update(1 / 60); } };
  return { a, sw, run, sh };
}
const desk = (sh: THREE.Vector3) => box(1.2 * W, 0.03 * W, 0.6 * W, 0, sh.y - 0.2 * W, sh.z + 0.55 * W);   // body faces +z
const monitor = (sh: THREE.Vector3, head: THREE.Vector3) => box(0.6 * W, 0.35 * W, 0.03 * W, 0, head.y, sh.z + 0.75 * W);

describe.skipIf(!fs.existsSync(publicPath(HUMAN_BASE_URL)))("SeatedWork (Bon, the shared seated clip)", () => {
  beforeAll(() => setGlbFetcher(loadHumanGlb));

  it("at a desk with a monitor: types with the fingertips on the desk, then eases out on standing", async () => {
    const { a, sw, run, sh } = await seated((sh, head) => [desk(sh), monitor(sh, head)]);
    run(2, true);
    expect(sw.mode).toBe("typing");
    const topY = sh.y - 0.2 * W + 0.015 * W;
    for (const s of ["L", "R"] as const) {
      expect(sw.contacts.error[s], s).toBeLessThan(0.05);
      const tip = a.rig.handFrame(s, "tip");
      expect(Math.abs(tip.y - topY), `${s} fingertip height over the desk`).toBeLessThan(0.08 * W);
      expect(tip.z - sh.z, `${s} fingertip ahead of the shoulders`).toBeGreaterThan(0.2 * W);
    }
    run(1.5, false);
    expect(sw.mode).toBe("none");
    expect((a as unknown as { layers: { id: string }[] }).layers.map((l) => l.id)).not.toContain("hand-contacts");
  }, 120_000);

  it("at a VO-height desk (top just above the seated shoulders): sits upright, hands on the desk top, typing", async () => {
    const top = { y: 0 };
    const { a, sw, run } = await seated((sh, head) => {
      top.y = sh.y + 1.5;   // VO's desks were built for the legacy cast
      return [box(1.2 * W, 0.03 * W, 0.6 * W, 0, top.y - 0.015 * W, sh.z + 0.2 * W + 0.3 * W), monitor(sh, head)];
    });
    run(2.5, true);
    expect(sw.mode).toBe("typing");
    const hips = a.rig.bone("Hips").getWorldPosition(new THREE.Vector3()), neck = a.rig.bone("neck").getWorldPosition(new THREE.Vector3());
    const lean = Math.acos(neck.clone().sub(hips).normalize().y);
    expect(lean, "torso upright (the clip alone slumps ~25°)").toBeLessThan(0.2);
    for (const s of ["L", "R"] as const) {
      expect(sw.contacts.error[s], s).toBeLessThan(0.05);
      expect(Math.abs(a.rig.handFrame(s, "tip").y - top.y), `${s} fingertip on the desk top`).toBeLessThan(0.06 * W);
    }
  }, 120_000);

  it("a HumanBase body in a desk chair rests its pelvis ON the cushion (the legacy formula sank it ~4.4 u)", async () => {
    const body = await createHumanBody(structuredClone(BON_AVATAR) as EmployeeAvatar, CATALOGUE_BY_ID);
    const h = body.human; h.clearance.enabled = false;
    h.play(SIT, 0); h.update(1 / 60);
    const cushion = new THREE.Vector3(0, 14.2, 0);
    h.root.position.copy(deskSeatedRootForRig({ ...sceneRig(h.scene, body.clips), pelvisBelowHips: HUMANBASE_PELVIS_BELOW_HIPS }, cushion, 0));
    h.root.updateMatrixWorld(true); h.update(0);
    const hips = h.rig.bone("Hips").getWorldPosition(new THREE.Vector3());
    let low = Infinity;
    h.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const p = m.geometry.getAttribute("position"), si = m.geometry.getAttribute("skinIndex"), sw = m.geometry.getAttribute("skinWeight"), v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        let b = 0, bi = 0; for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > b) { b = sw.getComponent(i, k); bi = si.getComponent(i, k); }
        if (!/^(Hips|LeftUpLeg|RightUpLeg)$/.test(m.skeleton.bones[bi].name)) continue;
        v.fromBufferAttribute(p, i); m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld);
        if (Math.abs(v.x - hips.x) < 3 && Math.abs(v.z - hips.z) < 3) low = Math.min(low, v.y);
      }
    });
    expect(Math.abs(low - (cushion.y - 0.3)), "pelvis underside on the cushion (0.3 settle)").toBeLessThan(0.5);
  }, 120_000);

  it("at a cafe table (no monitor) or on open seating: the hands rest on the lap, never typing", async () => {
    for (const furnish of [(sh: THREE.Vector3) => [desk(sh)], () => []]) {
      const { a, sw, run } = await seated(furnish);
      run(2, true);
      expect(sw.mode).toBe("resting");
      for (const s of ["L", "R"] as const) {
        expect(sw.contacts.error[s], s).toBeLessThan(0.05);
        const palm = a.rig.handFrame(s, "palm"), knee = a.rig.bone(s === "L" ? "LeftLeg" : "RightLeg").getWorldPosition(new THREE.Vector3());
        expect(palm.distanceTo(knee), `${s} palm near the knee end of the thigh`).toBeLessThan(0.35 * W);
      }
    }
  }, 120_000);
});
