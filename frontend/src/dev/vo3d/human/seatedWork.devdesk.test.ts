// THE DEV ROOM'S REAL DESKS, built by build/dev-furniture from the room's own entities, with a composed HumanBase body seated
// on the real chairs by the shared seat formula: the body sits upright with its torso and chin clear of the desk, finds the
// desk's OWN keyboard and mouse (not an invisible one), and types on it — fingertips on its key field — then lets go when
// it stands. Bay north row, bay south row and a lead desk.
import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only).
import fs from "node:fs";
import type { EmployeeAvatar } from "./humanBaseContract";
import { BON_AVATAR, CATALOGUE_BY_ID, HUMAN_BASE_URL } from "./humanCatalogue";
import { setGlbFetcher } from "./HumanAvatar";
import { loadHumanGlb, publicPath } from "./humanGlb.testutil";
import { createHumanBody } from "../avatar/humanBody";
import { deskSeatContact, deskSeatedRootForRig, HUMANBASE_PELVIS_BELOW_HIPS, sceneRig } from "../interact/seatContact";
import { BAY_D, BAY_Z, LEAD_DESK_Z0, devRoomEntities } from "../rooms/dev";
import { DEV_DESK_TOP, KEYBOARD_EDGE_INSET, buildDevFurniture } from "../build/dev-furniture";
import { SeatedWork } from "./seatedWork";
import { seatedTuckFor } from "../interact/seatContact";
const TUCK = (spec: Parameters<typeof seatedTuckFor>[0]) => seatedTuckFor(spec, true);

const CASES = [
  // rim: the dark moulding under the top's lip (its underside); plinth: how far in from the edge the base starts, and its top
  { chair: "bay-chair-n2", desk: "bay-desk-west", edge: BAY_Z - BAY_D / 2, toward: 1, rim: DEV_DESK_TOP - 3.4, plinthIn: 9, plinthTop: 21 },
  { chair: "bay-chair-s3", desk: "bay-desk-west", edge: BAY_Z + BAY_D / 2, toward: -1, rim: DEV_DESK_TOP - 3.4, plinthIn: 9, plinthTop: 21 },
  { chair: "lead-chair-west", desk: "lead-desk-west", edge: LEAD_DESK_Z0, toward: 1, rim: DEV_DESK_TOP - 3.9, plinthIn: 4.5, plinthTop: 21 },
] as const;

describe.skipIf(!fs.existsSync(publicPath(HUMAN_BASE_URL)))("HumanBase at the Dev Room's real desks", () => {
  beforeAll(() => setGlbFetcher(loadHumanGlb));
  for (const c of CASES) it(`${c.chair}: upright, clear of the desk, typing on the desk's own keyboard`, async () => {
    const ents = devRoomEntities(), find = (id: string) => ents.find((e) => e.id.endsWith(`/${id}`))!;
    const seat = find(c.chair), spec = seat.capabilities.seat!;
    const scene = new THREE.Scene();
    scene.add(buildDevFurniture(find(c.desk))!);
    // the occupied chair: the room's REAL chair (its view is the built group, turned by its facing), tucked as
    // interact/Seat parks it under a HumanBase body
    const chair = buildDevFurniture(seat)!;
    chair.position.addScaledVector(new THREE.Vector3(spec.pullDir.x, 0, spec.pullDir.z), TUCK(spec)); scene.add(chair);
    const body = await createHumanBody(structuredClone(BON_AVATAR) as EmployeeAvatar, CATALOGUE_BY_ID);
    const h = body.human, holder = new THREE.Group(); holder.add(h.root); scene.add(holder);
    holder.position.copy(deskSeatedRootForRig({ ...sceneRig(h.scene, body.clips), pelvisBelowHips: HUMANBASE_PELVIS_BELOW_HIPS }, deskSeatContact(chair, spec), spec.seatedYaw));
    holder.rotation.y = spec.seatedYaw;
    h.play("sit-on-chair-arms", 0);
    const sw = new SeatedWork(h);
    const run = (s: number, on: boolean) => { for (let t = 0; t < s; t += 1 / 60) { sw.update(1 / 60, on); h.update(1 / 60); } };
    run(2.5, true);
    expect(sw.mode).toBe("typing");
    // the desk's OWN keyboard: its key field, KEYBOARD_EDGE_INSET in from the near edge, 1.15 above the desk top
    const kb = sw.workstation!.keyboard, keyTop = DEV_DESK_TOP + 1.15;
    expect(Math.abs(kb.y - keyTop), "found the real key field").toBeLessThan(0.2);
    expect(Math.abs((kb.z - c.edge) * c.toward - KEYBOARD_EDGE_INSET), "at the real keyboard's depth").toBeLessThan(1.6);
    expect(sw.workstation!.mouse, "found the real mouse").not.toBeNull();
    for (const s of ["L", "R"] as const) {
      const tip = h.rig.handFrame(s, "tip");
      expect(sw.contacts.error[s], `${s} reaches`).toBeLessThan(0.1);
      expect(Math.abs(tip.y - keyTop), `${s} fingertip on the keys`).toBeLessThan(0.8);
      expect((tip.z - c.edge) * c.toward, `${s} fingertip over the keyboard, not the edge`).toBeGreaterThan(1);
      expect(Math.abs(tip.x - kb.x), `${s} within the keyboard's width`).toBeLessThan(6.5);
    }
    // upright, the torso clear of the desk and the chin above its top
    const hips = h.rig.bone("Hips").getWorldPosition(new THREE.Vector3()), neck = h.rig.bone("neck").getWorldPosition(new THREE.Vector3());
    expect(Math.acos(neck.clone().sub(hips).normalize().y), "upright").toBeLessThan(0.2);
    let torsoInto = -Infinity, headLow = Infinity;
    h.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !m.visible) return;
      const p = m.geometry.getAttribute("position"), si = m.geometry.getAttribute("skinIndex"), sw2 = m.geometry.getAttribute("skinWeight"), v = new THREE.Vector3();
      for (let i = 0; i < p.count; i += 2) {
        let b = 0, bi = 0; for (let k = 0; k < 4; k++) if (sw2.getComponent(i, k) > b) { b = sw2.getComponent(i, k); bi = si.getComponent(i, k); }
        const n = m.skeleton.bones[bi].name;
        v.fromBufferAttribute(p, i); m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld);
        if (/^(Head|neck|Hair)/.test(n)) headLow = Math.min(headLow, v.y);
        else if (!/(Arm|Hand|Thumb|Index|Fingers)/.test(n) && v.y > DEV_DESK_TOP - 3 && v.y < DEV_DESK_TOP) torsoInto = Math.max(torsoInto, (v.z - c.edge) * c.toward);
      }
    });
    expect(torsoInto, "torso behind the desk's edge").toBeLessThan(0);
    expect(headLow, "chin above the desk top").toBeGreaterThan(DEV_DESK_TOP);
    // the chair pulled up under it stays out of the desk: nothing of it in the top / rim, nothing low into the base
    let chairTop = -Infinity, chairBase = -Infinity;
    chair.updateMatrixWorld(true);
    chair.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const p = m.geometry.getAttribute("position"), v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
        const into = (v.z - c.edge) * c.toward;
        if (v.y > c.rim && v.y < DEV_DESK_TOP) chairTop = Math.max(chairTop, into);
        if (v.y < c.plinthTop && v.y > 0.5) chairBase = Math.max(chairBase, into - c.plinthIn);
      }
    });
    expect(chairTop, "chair clear of the desk top").toBeLessThan(0);
    expect(chairBase, "chair clear of the desk's base").toBeLessThan(0);
    // standing up: everything eases back out to the clip
    run(1.5, false);
    expect(sw.mode).toBe("none");
  }, 120_000);
});
