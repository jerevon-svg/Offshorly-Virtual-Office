// A REAL modular Bon composed in vitest from the built files: slot swaps never rebuild him, procedural layers
// never compound, hands reach their targets, the face blinks fully, and both behaviours run end to end.
import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only).
import fs from "node:fs";
import { HUMAN_WORLD_SCALE as W, type EmployeeAvatar } from "./humanBaseContract";
import { BON_AVATAR, BON_IDENTITY_V2, CATALOGUE_BY_ID, HUMAN_BASE_URL } from "./humanCatalogue";
import { NEUTRAL_IDENTITY } from "./humanBaseContract";
import { HumanAvatar, setGlbFetcher } from "./HumanAvatar";
import { BLINK_S } from "./humanFace";
import { DeskWork, HandContacts, PacketCarry, Spot, makePacketProp } from "./humanBehavior";
import { WORKSTATION, buildWorkstation } from "./humanInteraction";
import { loadHumanGlb, publicPath } from "./humanGlb.testutil";

const run = (a: HumanAvatar, seconds: number, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) a.update(dt); };
const bon = () => HumanAvatar.create(structuredClone(BON_AVATAR) as EmployeeAvatar, CATALOGUE_BY_ID);

describe.skipIf(!fs.existsSync(publicPath(HUMAN_BASE_URL)))("HumanAvatar (Bon, composed from the built modules)", () => {
  beforeAll(() => setGlbFetcher(loadHumanGlb));

  it("composes Bon on the CANONICAL head: base + identity + hair + top + bottom + shoes (glasses off), hiding what the clothes cover", async () => {
    const a = await bon();
    const st = a.stats();
    expect(st.pieces.map((p) => p.slot).sort()).toEqual(["base", "bottom", "hair", "identity", "shoes", "top"]);
    expect(a.piece("identity")!.id).toBe("canonical-head-v1");
    // hidden: chest/belly/arms (hoodie), pelvis/thighs (shorts), feet (clogs) — the neck, hands and shins show
    const visible = (r: number) => !((a.hideMask >> r) & 1);
    expect(visible(0) && visible(8) && visible(9) && visible(12) && visible(13)).toBe(true);
    expect([1, 2, 3, 4, 5, 6, 7, 10, 11, 14, 15].every((r) => !visible(r))).toBe(true);
    expect(a.face).not.toBeNull();
  }, 120_000);

  it("swapping a slot never rebuilds the avatar: same skeleton, mixer, clip, face and other pieces", async () => {
    const a = await bon();
    a.play("walking", 0);
    run(a, 0.3);
    const skeleton = a.body.skeleton, mixer = a.mixer, face = a.face, hair = a.piece("hair")!.meshes[0], shoes = a.piece("shoes")!.meshes[0];
    const changed = await a.apply({ ...a.config, top: { assetId: "tee-offshorly", colorway: "white" }, version: 2 });
    expect(changed).toEqual(["top"]);
    expect(a.body.skeleton).toBe(skeleton); expect(a.mixer).toBe(mixer); expect(a.face).toBe(face);
    expect(a.clip).toBe("walking");
    expect(a.piece("hair")!.meshes[0]).toBe(hair); expect(a.piece("shoes")!.meshes[0]).toBe(shoes);
    expect(a.piece("top")!.id).toBe("tee-offshorly");
    // the tee leaves the forearms bare; the hoodie hid them
    expect((a.hideMask >> 6) & 1).toBe(0);
    await a.apply({ ...a.config, shoes: { assetId: "sneakers" }, glasses: { assetId: "glasses-classic" }, version: 3 });
    expect(a.piece("glasses")!.id).toBe("glasses-classic");
    await a.apply({ ...a.config, glasses: { assetId: null }, version: 4 });
    expect(a.piece("glasses")).toBeNull();
    expect(a.piece("shoes")!.id).toBe("sneakers");
    // swapped meshes are bound to THIS avatar's bones, not their own file's
    const top = a.piece("top")!.meshes[0] as THREE.SkinnedMesh;
    expect(top.skeleton.bones[0]).toBe(a.bones.get(top.skeleton.bones[0].name));
  }, 120_000);

  it("identity parameters change the face without rebuilding anything; the head, shells, hair and glasses all follow", async () => {
    const a = await bon();
    await a.apply({ ...a.config, glasses: { assetId: "glasses-classic" }, version: 2 });
    const skeleton = a.body.skeleton, mixer = a.mixer, head = a.piece("identity")!.meshes[0];
    a.setIdentity({ ...NEUTRAL_IDENTITY, shape: { ...NEUTRAL_IDENTITY.shape, faceWidth: 0.8, noseSize: -0.5 } });
    expect(a.body.skeleton).toBe(skeleton); expect(a.mixer).toBe(mixer); expect(a.piece("identity")!.meshes[0]).toBe(head);
    for (const slot of ["identity", "hair", "glasses"]) for (const o of a.piece(slot)!.meshes) {
      const m = o as THREE.Mesh; if (!m.morphTargetDictionary?.faceWidth && m.morphTargetDictionary?.faceWidth !== 0) continue;
      expect(m.morphTargetInfluences![m.morphTargetDictionary.faceWidth]).toBeCloseTo(0.8);
    }
    // the medium hairstyle covers the ears: the head tucks them while it is worn, and only then
    const hm = head as THREE.Mesh, tuck = () => hm.morphTargetInfluences![hm.morphTargetDictionary!.earTuck];
    expect(tuck()).toBe(1);
    await a.apply({ ...a.config, hair: { assetId: null }, version: 3 });
    expect(tuck()).toBe(0);
    a.setIdentity(BON_IDENTITY_V2);
    expect(a.identity.eyes.lidRest).toBeCloseTo(BON_IDENTITY_V2.eyes.lidRest);
  }, 120_000);

  it("a medium-skinned hairstyle brings its own chain joints: created on equip under Head, removed on unequip", async () => {
    const a = await bon();
    expect(a.bones.get("HairSideL1")?.parent?.name).toBe("Head");
    expect(a.bones.get("HairSideL2")?.parent?.name).toBe("HairSideL1");
    expect(a.body.skeleton.bones.length).toBe(36);              // the base skeleton is untouched
    a.play("running", 0); run(a, 0.6);                          // secondary motion runs, nothing explodes
    const tip = a.bones.get("HairBackC2")!.getWorldPosition(new THREE.Vector3());
    expect(Number.isFinite(tip.x + tip.y + tip.z)).toBe(true);
    await a.apply({ ...a.config, hair: { assetId: null }, version: 2 });
    expect(a.bones.has("HairSideL1")).toBe(false);
    expect(a.hair).toBeNull();
  }, 120_000);

  it("body clearance: in every shared clip the arms end outside the torso, pelvis and thighs (hoodie + shorts included)", async () => {
    const a = await bon();
    for (const clip of ["idle-masculine", "walking", "running", "agree-gesture", "listening-gesture"]) {
      a.play(clip, 0);
      for (let t = 0; t < 1.2; t += 1 / 30) { a.update(1 / 30); for (const s of ["L", "R"] as const) expect(a.clearance.armPenetration(s), `${clip} ${s}`).toBeLessThan(0.006); }
    }
    // without it, the idle hands DO sink into the clothes (the problem it exists for)
    a.clearance.enabled = false; a.play("idle-masculine", 0); run(a, 0.3);
    expect(Math.max(a.clearance.armPenetration("L"), a.clearance.armPenetration("R"))).toBeGreaterThan(0.02);
  }, 120_000);

  it("intentional contacts are never pushed: a hand owned by a behaviour keeps its target", async () => {
    const a = await bon();
    const contacts = new HandContacts(); a.addLayer(contacts.layer());
    a.clearance.intentional = (s) => contacts.w[s] > 0.02;
    const target = a.rig.bone("Spine").getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.12 * W, -0.05 * W, 0.2 * W)); // on the belly
    contacts.goal.L = () => ({ frame: "palm", pos: target, fwd: new THREE.Vector3(0, -0.3, 1).normalize(), palm: new THREE.Vector3(0, 0, -1), pole: new THREE.Vector3(30, 0, -10), curl: {} });
    contacts.want.L = 1; run(a, 0.8);
    expect(contacts.error.L).toBeLessThan(0.05);
  }, 120_000);

  it("procedural layers never compound on a HELD clip (the mixer does not rewrite a frozen pose)", async () => {
    const a = await bon();
    a.hold("sitting-answering", 0.5, 0);
    a.addLayer({ id: "lean", order: 10, update: () => a.rig.leanSpine(0.3) });
    run(a, 1 / 60);
    const q1 = a.bones.get("Spine")!.quaternion.clone();
    run(a, 1);
    expect(a.bones.get("Spine")!.quaternion.angleTo(q1)).toBeLessThan(1e-4);
  }, 120_000);

  it("a hand frame reaches a reachable world point (fingertip on a key) and fingers curl", async () => {
    const a = await bon();
    run(a, 0.1);
    const contacts = new HandContacts();
    a.addLayer(contacts.layer());
    const target = a.rig.bone("LeftArm").getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.05 * W, -0.15 * W, 0.3 * W));
    contacts.goal.L = () => ({ frame: "tip", pos: target, fwd: new THREE.Vector3(0, -0.3, 1).normalize(), palm: new THREE.Vector3(0, -1, 0), pole: new THREE.Vector3(30, 0, -10), curl: { Fingers: 0.6, Thumb: 0.3, Index: 0.1 } });
    contacts.want.L = 1;
    run(a, 0.8);
    expect(a.rig.handFrame("L", "tip").distanceTo(target)).toBeLessThan(0.05 * W / 21); // < 0.25 cm
    expect(contacts.error.L).toBeLessThan(0.05);
    expect(a.bones.get("LeftFingers1")!.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.5);
  }, 120_000);

  it("the face blinks FULLY closed and reopens", async () => {
    const a = await bon();
    a.face!.blinking = false;
    a.face!.blink();
    let maxClosure = 0;
    for (let t = 0; t < BLINK_S + 0.1; t += 1 / 240) { a.update(1 / 240); maxClosure = Math.max(maxClosure, a.face!.closure); }
    expect(maxClosure).toBeGreaterThan(0.99);
    expect(a.face!.closure).toBeLessThan(a.face!.lidRest + 0.05);   // back to the identity's resting lid
  }, 120_000);

  it("packet: receive → hold → offer → cancel (withdraw) → place; and an incoming packet can be sent back", async () => {
    const a = await bon();
    const contacts = new HandContacts(); a.addLayer(contacts.layer());
    const packet = makePacketProp();
    const stand = new Spot("stand", new THREE.Matrix4().makeTranslation(-30, 14, 20));
    const table = new Spot("table", new THREE.Matrix4().makeTranslation(30, 11, 20));
    packet.place(stand);
    const carry = new PacketCarry(a, contacts, packet); a.addLayer(carry.layer());
    carry.receive(stand); run(a, 1.5);
    expect(carry.state).toBe("holding"); expect(packet.holder).toBe(carry);
    expect(contacts.error.L).toBeLessThan(0.1); expect(contacts.error.R).toBeLessThan(0.1);
    carry.offer(); run(a, 0.8); expect(carry.state).toBe("offering");
    carry.cancel(); run(a, 0.2); expect(carry.state).toBe("holding");
    carry.place(table); run(a, 1.5);
    expect(carry.state).toBe("empty"); expect(packet.holder).toBe(table);
    // interrupt mid-receive: the packet goes back to where it came from
    packet.place(stand); carry.receive(stand); run(a, 0.4); carry.cancel(); run(a, 1.2);
    expect(carry.state).toBe("empty"); expect(packet.holder).toBe(stand);
  }, 120_000);

  it("desk: approach → sit → type with both fingertips on keys → stand up (interruptible)", async () => {
    const a = await bon();
    const contacts = new HandContacts(); a.addLayer(contacts.layer());
    const station = buildWorkstation(); station.root.position.set(60, 0, -30); station.root.updateMatrixWorld(true);
    const desk = new DeskWork(a, contacts, station, WORKSTATION); a.addLayer(desk.layer());
    desk.start(); run(a, 6);
    expect(desk.phase).toBe("work");
    expect(a.clip).toBe("sitting-answering");
    expect(desk.presses.L + desk.presses.R).toBeGreaterThan(10);
    expect(contacts.error.L).toBeLessThan(0.1); expect(contacts.error.R).toBeLessThan(0.1);
    desk.standUp(); run(a, 1.2);
    expect(desk.phase).toBe("idle");
    expect(a.clip).toBe("idle-masculine");
  }, 120_000);
});
