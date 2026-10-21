// EVERY KIND OF OFFICE WORKSTATION, built the way the office builds it (each room's static architecture + its entities), with
// a composed HumanBase body seated by the shared seat formula and the shared HumanBase tuck: it types on the desk's OWN
// keyboard or laptop, reaches it, faces a lit screen turned to it, and nothing of the body is inside the furniture; it
// lets go when it stands. Seats that
// are not work desks (visitor chairs, the meeting room, the hub's café, the Meeting Floor) never type and never tuck.
// The Dev Room's desks have their own, finer test (seatedWork.devdesk.test.ts).
import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only).
import fs from "node:fs";
import type { EmployeeAvatar } from "./humanBaseContract";
import { BON_AVATAR, CATALOGUE_BY_ID, HUMAN_BASE_URL } from "./humanCatalogue";
import { setGlbFetcher } from "./HumanAvatar";
import { loadHumanGlb, publicPath } from "./humanGlb.testutil";
import { createHumanBody } from "../avatar/humanBody";
import { deskSeatContact, deskSeatedRootForRig, HUMANBASE_PELVIS_BELOW_HIPS, isSolidSurface, sceneRig, seatedTuckFor } from "../interact/seatContact";
import { buildEntity, ROOM_STATIC } from "../build/registry";
import { seatedYawFor } from "../app/seats";
import type { Entity, RoomDef } from "../world/WorldState";
import { SeatedWork } from "./seatedWork";
import { AI_ROOM, aiRoomEntities } from "../rooms/ai";
import { CMS_ROOM, cmsRoomEntities } from "../rooms/cms";
import { DESIGN_ROOM, designRoomEntities } from "../rooms/design-room";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "../rooms/executive";
import { GAMING_ROOM, gamingRoomEntities } from "../rooms/gaming";
import { QA_ROOM, qaRoomEntities } from "../rooms/qa";
import { DEV_ROOM, devRoomEntities } from "../rooms/dev";
import { MEETING_ROOM, meetingRoomEntities } from "../rooms/meeting";
import { CENTRAL_HUB, centralHubEntities } from "../rooms/central-hub";

/** room → [its representative WORK seats (one per kind of desk), seats that must NOT type] */
const ROOMS: [string, RoomDef, () => Entity[], string[], string[]][] = [
  ["AI", AI_ROOM, aiRoomEntities, ["member-chair-1-1", "member-chair-6-3", "lead-chair"], ["visitor-chair-west"]],
  ["CMS", CMS_ROOM, cmsRoomEntities, ["member-chair-f1", "member-chair-b3", "lead-chair-west"], []],
  ["Design", DESIGN_ROOM, designRoomEntities, ["design-member-chair1", "design-chair-3", "design-lead-chair"], []],
  ["Executive", EXECUTIVE_ROOM, executiveRoomEntities, ["exec-chair-left", "exec-chair-right", "workstation-chair"], []],
  ["Gaming", GAMING_ROOM, gamingRoomEntities, ["gaming-chair-0", "gaming-chair-3"], []],
  ["QA", QA_ROOM, qaRoomEntities, ["bench-chair-w1", "bench-chair-e2", "lead-chair"], ["visitor-chair-east"]],
  ["Dev (off-centre bays)", DEV_ROOM, devRoomEntities, ["bay-chair-n1", "bay-chair-s5"], ["visitor-chair-w1"]],
  ["Meeting", MEETING_ROOM, meetingRoomEntities, [], ["chair-south-0", "chair-north-2"]],
  ["Central Hub café", CENTRAL_HUB, centralHubEntities, [], ["cafe-chair-0-north", "cafe-chair-3-west"]],
];

describe.skipIf(!fs.existsSync(publicPath(HUMAN_BASE_URL)))("HumanBase at every kind of office workstation", () => {
  beforeAll(() => setGlbFetcher(loadHumanGlb));
  for (const [label, def, entities, work, notWork] of ROOMS) it(`${label}: work desks type on their own device, clear of the furniture; other seats never do`, async () => {
    const body = await createHumanBody(structuredClone(BON_AVATAR) as EmployeeAvatar, CATALOGUE_BY_ID);
    const h = body.human, rig = { ...sceneRig(h.scene, body.clips), pelvisBelowHips: HUMANBASE_PELVIS_BELOW_HIPS };
    const scene = new THREE.Scene(), views = new Map<string, THREE.Object3D>(), ents = entities();
    scene.add(ROOM_STATIC[def.id](def, {} as never));
    for (const e of ents) { const g = buildEntity(e).group; scene.add(g); views.set(e.id, g); }
    const holder = new THREE.Group(); holder.add(h.root); scene.add(holder);
    for (const id of [...work, ...notWork]) {
      const e = ents.find((x) => x.id.endsWith(`/${id}`))!, spec = e.capabilities.seat!, chair = views.get(e.id)!;
      const isWork = work.includes(id), rest = chair.position.clone(), yaw = seatedYawFor(e.id, spec.seatedYaw);
      expect(spec.workstation === true, `${id} flagged as a work desk`).toBe(isWork);
      // the occupied chair, parked as the live sit parks it under a HumanBase body
      const tuck = seatedTuckFor(spec, true, { view: chair, restPos: rest.clone(), restQuat: chair.quaternion.clone(), yaw });
      if (!isWork) expect(tuck, `${id} keeps its own tuck`).toBe(spec.seatedTuck);
      chair.position.addScaledVector(new THREE.Vector3(spec.pullDir.x, 0, spec.pullDir.z), tuck);
      holder.position.copy(deskSeatedRootForRig(rig, deskSeatContact(chair, spec), yaw)); holder.rotation.set(0, yaw, 0);
      h.play("sit-on-chair-arms", 0);
      const sw = new SeatedWork(h); sw.atWorkstation = spec.workstation === true;
      const run = (s: number, on: boolean) => { for (let t = 0; t < s; t += 1 / 60) { sw.update(1 / 60, on); h.update(1 / 60); } };
      run(2.2, true);
      if (!isWork) { expect(sw.mode, `${id} rests`).toBe("resting"); sw.dispose(); chair.position.copy(rest); continue; }
      expect(sw.mode, `${id} types`).toBe("typing");
      const w = sw.workstation!;
      expect(w.device, `${id} found its desk's own keyboard / laptop`).toBe(true);
      for (const s of ["L", "R"] as const) {
        expect(sw.contacts.error[s], `${id} ${s} reaches the keys`).toBeLessThan(0.1);
        expect(Math.abs(h.rig.handFrame(s, "tip").y - w.keyboard.y), `${id} ${s} fingertip on the keys`).toBeLessThan(0.8);
      }
      // nothing of the body (the arms aside — they rest ON the desk) inside any solid piece of furniture around it
      const solids: THREE.Mesh[] = [];
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || !isSolidSurface(m)) return;
        for (let a: THREE.Object3D | null = o; a; a = a.parent) if (a === chair || a === h.root) return;
        solids.push(m);
      });
      const boxes = solids.map((m) => new THREE.Box3().setFromObject(m)), sides = solids.map((m) => (m.material as THREE.Material).side);
      for (const m of solids) (m.material as THREE.Material).side = THREE.DoubleSide;
      const ray = new THREE.Raycaster(), up = new THREE.Vector3(0, 1, 0);
      let inside = 0;
      h.root.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh || !m.visible) return;
        const p = m.geometry.getAttribute("position"), si = m.geometry.getAttribute("skinIndex"), wt = m.geometry.getAttribute("skinWeight"), v = new THREE.Vector3();
        for (let i = 0; i < p.count; i += 4) {
          let b = 0, bi = 0; for (let k = 0; k < 4; k++) if (wt.getComponent(i, k) > b) { b = wt.getComponent(i, k); bi = si.getComponent(i, k); }
          if (/(Arm|Hand|Thumb|Index|Fingers)/.test(m.skeleton.bones[bi].name)) continue;
          v.fromBufferAttribute(p, i); m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld);
          if (Math.abs(v.y - w.deskY) > 4) continue;
          const near = solids.filter((_, k) => boxes[k].containsPoint(v));   // a closed piece the point could be in
          if (!near.length) continue;
          ray.set(v, up); ray.far = 40;
          if (ray.intersectObjects(near, false).length % 2 === 1) inside++;
        }
      });
      // a SCREEN faces the sitter: forward rays from the eyes over the desk meet a lit (emissive) face turned toward them
      const head = h.rig.bone("Head").getWorldPosition(new THREE.Vector3()), across = new THREE.Vector3().crossVectors(w.forward, up);
      let facing = 0;
      for (let rise = 3; rise <= 14 && !facing; rise += 1.5) for (let x = -12; x <= 12; x += 2) {
        const o = head.clone().addScaledVector(across, x); o.y = w.deskY + rise;
        ray.set(o, w.forward); ray.far = 40;
        const hit = ray.intersectObjects(solids, false)[0];
        const mt = hit && ((hit.object as THREE.Mesh).material as THREE.MeshStandardMaterial);
        if (mt && mt.emissive && mt.emissive.getHex() !== 0 && mt.emissiveIntensity >= 0.2 && hit.face!.normal.clone().transformDirection(hit.object.matrixWorld).dot(w.forward) < -0.3) facing++;
      }
      solids.forEach((m, k) => { (m.material as THREE.Material).side = sides[k]; });
      expect(inside, `${id}: body inside the furniture`).toBe(0);
      expect(facing, `${id}: a lit screen faces the sitter`).toBeGreaterThan(0);
      run(1.5, false);
      expect(sw.mode, `${id} lets go on standing`).toBe("none");
      sw.dispose(); chair.position.copy(rest);
    }
  }, 240_000);
});
