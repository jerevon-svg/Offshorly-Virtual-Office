// vo3d human — THE HUMANBASE_V1 PROOF PAGE (human-base.html?humanbase=1). DEV-ONLY, isolated: nothing in the app
// imports this, and it changes no production module. It reads (never modifies) the scooter rider pose, the
// scooter geometry and the AI Workforce packet geometry to prove compatibility.
//
// Bon, built from HumanBase_V1 + his decomposed identity + a modular outfit, with every proof control on the
// panel: appearance swaps (no rebuild), the shared clips, the face, the packet, real keyboard typing, the scooter.
// `window.__hb` exposes the same controls for automated capture.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RiderPose } from "../../avatar/riderPose";
import { RIDER_GRIPS, DECK_TOP } from "../../world/scooters";
import { vehicleGeos } from "../../build/vehicles";
import { HUMAN_WORLD_SCALE as W, HAND_FRAMES, HUMAN_SOCKETS, NEUTRAL_IDENTITY, PARAM_RANGES, SHAPE_CONTROLS, type AppearanceAsset, type EmployeeAvatar, type IdentityParams, type Side } from "../humanBaseContract";
import { ANGELO_AVATAR, CLANG_AVATAR, FRANCE_AVATAR, MICAH_AVATAR, TEE_COLORWAYS, BON_AVATAR, BON_IDENTITY_ILLUSTRATED, BON_IDENTITY_V2, BON_PHASE2_AVATAR, CATALOGUE_BY_ID } from "../humanCatalogue";
import { HumanAvatar, loadGlb } from "../HumanAvatar";
import { DeskWork, HandContacts, PacketCarry, Spot, makePacketProp } from "../humanBehavior";
import { WORKSTATION, buildWorkstation } from "../humanInteraction";
import { EXPRESSIONS, type Expression } from "../humanFace";

const gate = new URLSearchParams(location.search).get("humanbase") === "1";
if (!gate) { document.getElementById("gate")!.style.display = "flex"; document.getElementById("panel")!.style.display = "none"; throw new Error("humanbase proof is gated behind ?humanbase=1"); }

// ---- renderer + scene (the VO look: hemisphere + sun, soft shadows, ACES) ----------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd9dfe6);
scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x8a8170, 1.3));
const sun = new THREE.DirectionalLight(0xfff4e2, 2.2);
sun.position.set(-90, 220, 160); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.left = -160; sc.right = 160; sc.top = 160; sc.bottom = -160; sc.near = 10; sc.far = 700;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(260, 64), new THREE.MeshStandardMaterial({ color: 0xc9cfd6, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 1, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const VIEWS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  full: { pos: [0, 30, 120], target: [0, 17, 0] },
  face: { pos: [0, 24.5, 34], target: [0, 23.5, 0] },
  face34: { pos: [21, 24.5, 27], target: [0, 23.5, 0] },
  faceSide: { pos: [34, 24, 2], target: [0, 23.5, 0] },
  faceBack: { pos: [-14, 27, -32], target: [0, 23, 0] },
  side: { pos: [105, 26, 30], target: [0, 17, 0] },
  back: { pos: [-20, 30, -115], target: [0, 17, 0] },
  vo: { pos: [0, 190, 160], target: [0, 10, 0] },
  desk: { pos: [128, 52, -82], target: [60, 12, -27] },
  hands: { pos: [97, 21, -46], target: [60, 10.5, -31] },
  scooter: { pos: [-35, 40, 110], target: [-70, 16, 10] },
  // production Bon (x −26) beside HumanBase Bon (x 0): enable "Production family" first
  compare: { pos: [-13, 25, 92], target: [-13, 17, 0] },
  compareFace: { pos: [-13, 23.5, 52], target: [-13, 22.5, 0] },
  compareSide: { pos: [60, 24, -6], target: [-13, 19, 0] },
  compareBack: { pos: [-13, 28, -92], target: [-13, 18, 0] },
};
function view(name: string, follow = true): void {
  const v = VIEWS[name]; if (!v) return;
  const off = follow && ["full", "face", "side", "back", "vo"].includes(name) ? avatar.root.position : new THREE.Vector3();
  camera.position.set(v.pos[0] + off.x, v.pos[1] + off.y, v.pos[2] + off.z);
  controls.target.set(v.target[0] + off.x, v.target[1] + off.y, v.target[2] + off.z);
  controls.update();
}

// ---- the world fixtures --------------------------------------------------------------------------------------
const station = buildWorkstation();
station.root.position.set(60, 0, -30);
scene.add(station.root);
// the delivery stand (a stand-in for the Toucan's beak / a colleague's hands) and a side table to set things on
const mat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
const stand = new THREE.Group(); stand.position.set(-36, 0, 26);
{ const post = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 13, 16), mat(0x8c9198)); post.position.y = 6.5; post.castShadow = true;
  const tray = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.8, 32), mat(0x5dd9b3)); tray.position.y = 13.4; tray.castShadow = true; stand.add(post, tray); }
scene.add(stand);
const table = new THREE.Group(); table.position.set(36, 0, 26);
{ const top = new THREE.Mesh(new THREE.BoxGeometry(18, 1, 14), mat(0xc9a77c)); top.position.y = 10.5; top.castShadow = top.receiveShadow = true; table.add(top);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.8, 10, 0.8), mat(0x8c9198)); l.position.set(sx * 8, 5, sz * 6); l.castShadow = true; table.add(l); } }
scene.add(table);
const standSpot = new Spot("delivery-stand", new THREE.Matrix4().compose(new THREE.Vector3(-36, 14.2, 26), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
const tableSpot = new Spot("side-table", new THREE.Matrix4().compose(new THREE.Vector3(36, 11.4, 26), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
// the scooter (build/vehicles, read-only) for the rider-pose compatibility check
const scooter = new THREE.Group(); scooter.position.set(-70, 0, 10);
{ const g = vehicleGeos("scooter"); const vm = (r: number, m = 0) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: r, metalness: m });
  for (const [geo, m] of [[g.paint, vm(0.45)], [g.gloss, vm(0.2, 0.3)], [g.matte, vm(0.85)], [g.lights, vm(0.3)]] as const) { const o = new THREE.Mesh(geo, m); o.castShadow = true; scooter.add(o); }
  scooter.rotation.y = Math.PI; }
scene.add(scooter);

// ---- Bon ------------------------------------------------------------------------------------------------------
const t0 = performance.now();
// ?body=feminine runs the whole playground (behaviours, desk, packet, scooter) on the feminine body preset
const BODY_PRESET = new URLSearchParams(location.search).get("body") === "feminine" ? "feminine" : "standard";
// ?head=<identity id> mounts that identity head (hair fused) on the main avatar — for behaviour checks of any employee
const HEAD_PARAM = new URLSearchParams(location.search).get("head");
// ?avatar=micah runs the playground as Micah (her full configuration)
const START = ({ micah: MICAH_AVATAR, angelo: ANGELO_AVATAR, clang: CLANG_AVATAR, france: FRANCE_AVATAR } as Record<string, EmployeeAvatar>)[new URLSearchParams(location.search).get("avatar") ?? ""] ?? BON_AVATAR;
// ?optim=<file under output/human-base/> (or production/<file> = the committed public/avatars/human-base-v1/production/) mounts an OPTIMISED identity candidate with the employee's full configuration
// (dev QA of production candidates through every behaviour)
const OPTIM_PARAM = import.meta.env.DEV ? new URLSearchParams(location.search).get("optim") : null;
if (OPTIM_PARAM) (CATALOGUE_BY_ID as Map<string, AppearanceAsset>).set(`optim:${OPTIM_PARAM}`, { id: `optim:${OPTIM_PARAM}`, slot: "identity", label: OPTIM_PARAM, url: OPTIM_PARAM.startsWith("production/") ? `${import.meta.env.BASE_URL}avatars/human-base-v1/${OPTIM_PARAM}` : `${import.meta.env.BASE_URL}scripts/avatar-pipeline/output/human-base/${OPTIM_PARAM}`, hides: [] });
const avatar = await HumanAvatar.create({ ...structuredClone(START), ...(START === BON_AVATAR ? { bodyPreset: BODY_PRESET } : {}), ...(OPTIM_PARAM ? { identity: { headAssetId: `optim:${OPTIM_PARAM}` }, ...(START === BON_AVATAR ? { hair: { assetId: null }, glasses: { assetId: null } } : {}) } : {}), ...(HEAD_PARAM ? { identity: { headAssetId: HEAD_PARAM }, hair: { assetId: null }, glasses: { assetId: null }, top: { assetId: "tee-offshorly", colorway: "white" } } : {}) } as EmployeeAvatar, CATALOGUE_BY_ID);
const firstComposeMs = performance.now() - t0;
scene.add(avatar.root);
avatar.root.traverse((o) => { o.frustumCulled = false; });
const contacts = new HandContacts();
avatar.addLayer(contacts.layer());
const packet = makePacketProp(0x6fb6ff);
scene.add(packet.root);
packet.place(standSpot);
const carry = new PacketCarry(avatar, contacts, packet);
avatar.addLayer(carry.layer());
const desk = new DeskWork(avatar, contacts, station, WORKSTATION);
avatar.addLayer(desk.layer());
const rider = new RiderPose(avatar.model, RIDER_GRIPS);
rider.setScene(avatar.scene);
avatar.addLayer({ id: "scooter-rider", order: 30, update: (dt) => rider.update(dt) });
// hands owned by a behaviour (packet, keyboard, scooter grips) are intentional contacts: clearance leaves them
avatar.clearance.intentional = (s) => contacts.w[s] > 0.02 || rider.weight > 0;
view("full");

// ---- motion modes driven by the page (walk loop, scooter) ------------------------------------------------------
let mode: "stand" | "walk-loop" | "run-loop" | "scooter" = "stand";
let loopA = 0;
const home = new THREE.Vector3(0, 0, 0);
function setMode(m: typeof mode): void {
  if (desk.phase !== "idle") return;
  if (mode === "scooter" && m !== "scooter") { rider.set(false); avatar.root.position.copy(home); avatar.root.rotation.y = 0; }
  mode = m;
  if (m === "stand") { avatar.root.position.copy(home); avatar.root.rotation.y = 0; avatar.play(idleOf(), 0.3); }
  if (m === "walk-loop") avatar.play("walking", 0.25);
  if (m === "run-loop") avatar.play("running", 0.2);
  if (m === "scooter") { avatar.root.position.set(scooter.position.x, DECK_TOP, scooter.position.z + 0.3); avatar.root.rotation.y = 0; avatar.hold(idleOf(), 0, 0.2); rider.set(true); }
}
const idleOf = () => (avatar.config.idleProfile === "feminine" ? "idle-feminine" : "idle-masculine");

// ---- debug overlay: hand frames, sockets, contact targets ------------------------------------------------------
const dbg = new THREE.Group(); dbg.visible = false; scene.add(dbg);
const dot = (c: number, r = 0.35) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color: c, depthTest: false })); m.renderOrder = 10; dbg.add(m); return m; };
const frameDots: Record<string, THREE.Mesh> = {};
for (const s of ["L", "R"] as const) for (const f of Object.keys(HAND_FRAMES)) frameDots[`${s}:${f}`] = dot({ grip: 0xff5555, palm: 0xffcc33, pinch: 0x55aaff, tip: 0x66ff99 }[f as keyof typeof HAND_FRAMES]!, 0.28);
const socketDots: Record<string, THREE.Mesh> = {}; for (const k of Object.keys(HUMAN_SOCKETS)) socketDots[k] = dot(0xff66ff, 0.4);
const goalDots = { L: dot(0xffffff, 0.45), R: dot(0xffffff, 0.45) };
function updateDebug(): void {
  if (!dbg.visible) return;
  for (const [k, m] of Object.entries(frameDots)) { const [s, f] = k.split(":"); avatar.rig.handFrame(s as Side, f as keyof typeof HAND_FRAMES, m.position); }
  for (const [k, m] of Object.entries(socketDots)) avatar.socketWorld(k as keyof typeof HUMAN_SOCKETS, m.position);
  for (const s of ["L", "R"] as const) { const g = contacts.goal[s]?.(); goalDots[s].visible = !!g && contacts.w[s] > 0; if (g) goalDots[s].position.copy(g.pos); }
}

// ---- look-at-cursor --------------------------------------------------------------------------------------------
let lookMode: "auto" | "cursor" | "left" | "right" | "camera" = "auto";
const cursor = new THREE.Vector3();
renderer.domElement.addEventListener("pointermove", (e) => {
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
  const head = avatar.rig.bone("Head").getWorldPosition(new THREE.Vector3());
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1).applyQuaternion(avatar.root.quaternion), -head.clone().add(new THREE.Vector3(0, 0, 25).applyQuaternion(avatar.root.quaternion)).dot(new THREE.Vector3(0, 0, 1).applyQuaternion(avatar.root.quaternion)));
  ray.ray.intersectPlane(plane, cursor);
});
const attention = { w: 0 };
avatar.addLayer({ id: "page-attention", order: 45, update: (dt) => {
  // the page's own look control, only when no behaviour owns the head
  const busy = carry.state !== "empty" || desk.phase !== "idle";
  const want = !busy && lookMode !== "auto" ? 1 : 0;
  attention.w += (want - attention.w) * Math.min(1, dt * 6);
  if (busy || attention.w < 0.01) { if (!busy && avatar.face) avatar.face.lookTarget = null; return; }
  const head = avatar.rig.bone("Head").getWorldPosition(new THREE.Vector3());
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(avatar.root.quaternion);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(avatar.root.quaternion);
  const target = lookMode === "cursor" ? cursor.clone() : lookMode === "camera" ? camera.position.clone()
    : head.clone().addScaledVector(fwd, 30).addScaledVector(side, lookMode === "left" ? 24 : -24);
  avatar.rig.aimHead(target.clone().sub(head), attention.w * 0.8);
  if (avatar.face) avatar.face.lookTarget = target;
} });

// ---- the panel ------------------------------------------------------------------------------------------------
const panel = document.getElementById("panel")!;
const h = (tag: string, text = "", cls = "") => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
// the viewer says which asset it shows: a production candidate is labelled as such (never mistaken for Phase 3A Bon)
const VIEW_TITLE = OPTIM_PARAM ? `${OPTIM_PARAM.startsWith("production/") ? "PRODUCTION CANDIDATE" : "Optimised candidate"} · ${OPTIM_PARAM}` : "HumanBase_V1 · Bon (Phase 3A)";
if (OPTIM_PARAM) { const b = document.createElement("div"); b.id = "hb-optim-banner"; b.textContent = VIEW_TITLE; Object.assign(b.style, { position: "fixed", top: "8px", left: "50%", transform: "translateX(-50%)", zIndex: "10", padding: "6px 14px", borderRadius: "6px", background: "#14161a", color: "#7ee0b0", font: "600 14px system-ui, sans-serif", pointerEvents: "none" }); document.body.append(b); }
panel.append(h("h1", VIEW_TITLE), h("p", "The shared canonical head + Bon's identity read from ONE front photo, a modular medium-curtain hairstyle, a modular outfit. Every control below changes parameters or one slot — no rebuild, rerig or reanimation.", "sub"));
type Btn = { label: string; on?: () => boolean; act: () => unknown };
const groups: { row: HTMLElement; btns: { b: HTMLButtonElement; d: Btn }[] }[] = [];
function row(label: string, btns: Btn[]): void {
  const r = h("div", "", "row"); r.append(h("label", label));
  const list = btns.map((d) => { const b = document.createElement("button"); b.textContent = d.label; b.onclick = async () => { await d.act(); refresh(); }; r.append(b); return { b, d }; });
  groups.push({ row: r, btns: list }); panel.append(r);
}
function refresh(): void { for (const g of groups) for (const { b, d } of g.btns) b.classList.toggle("on", !!d.on?.()); }
const cfg = () => avatar.config;
const set = async (patch: Partial<EmployeeAvatar>) => { await avatar.apply({ ...cfg(), ...patch, version: cfg().version + 1 }); };

panel.append(h("h2", "Appearance"));
row("Top", [
  { label: "CRRN IVRSE hoodie", on: () => cfg().top.assetId === "hoodie-crrn", act: () => set({ top: { assetId: "hoodie-crrn", colorway: "black" } }) },
  { label: "Offshorly tee", on: () => cfg().top.assetId === "tee-offshorly", act: () => set({ top: { assetId: "tee-offshorly", colorway: "white" } }) },
]);
row("Colour", [
  { label: "black", on: () => cfg().top.colorway === "black", act: () => avatar.setColorway("top", cfg().top.assetId === "hoodie-crrn" ? "black" : "ink") },
  { label: "heather/mint", on: () => cfg().top.colorway === "heather" || cfg().top.colorway === "mint", act: () => avatar.setColorway("top", cfg().top.assetId === "hoodie-crrn" ? "heather" : "mint") },
  { label: "bone/white", on: () => cfg().top.colorway === "bone" || cfg().top.colorway === "white", act: () => avatar.setColorway("top", cfg().top.assetId === "hoodie-crrn" ? "bone" : "white") },
]);
row("Bottom", [
  { label: "denim mid", on: () => cfg().bottom.colorway === "mid", act: () => avatar.setColorway("bottom", "mid") },
  { label: "light", on: () => cfg().bottom.colorway === "light", act: () => avatar.setColorway("bottom", "light") },
  { label: "black", on: () => cfg().bottom.colorway === "black", act: () => avatar.setColorway("bottom", "black") },
]);
row("Shoes", [
  { label: "Clogs", on: () => cfg().shoes.assetId === "clogs", act: () => set({ shoes: { assetId: "clogs", colorway: "chalk" } }) },
  { label: "Sneakers", on: () => cfg().shoes.assetId === "sneakers", act: () => set({ shoes: { assetId: "sneakers" } }) },
  { label: "clog: black", act: () => avatar.setColorway("shoes", "black") },
  { label: "sage", act: () => avatar.setColorway("shoes", "sage") },
]);
row("Hair", [
  { label: "Medium curtain", on: () => cfg().hair.assetId === "medium-curtain", act: () => set({ hair: { assetId: "medium-curtain", color: cfg().hair.color } }) },
  { label: "Off (scalp)", on: () => !cfg().hair.assetId, act: () => set({ hair: { assetId: null } }) },
]);
row("Hair col.", [
  { label: "black", act: () => avatar.setHairColor("#141213") }, { label: "brown", act: () => avatar.setHairColor("#4a3022") }, { label: "ash", act: () => avatar.setHairColor("#8a857f") },
]);
row("Glasses", [
  { label: "On", on: () => !!cfg().glasses.assetId, act: () => set({ glasses: { assetId: (avatar.identityLandmarks as { glassesFit?: unknown } | null)?.glassesFit ? "glasses-rect" : "glasses-classic" } }) },   // fit-space frames on any V1.1 identity
  { label: "Off", on: () => !cfg().glasses.assetId, act: () => set({ glasses: { assetId: null } }) },
]);
row("Accessory", [
  { label: "Badge on", on: () => cfg().accessories.length > 0, act: () => set({ accessories: [{ assetId: "offshorly-badge" }] }) },
  { label: "off", on: () => cfg().accessories.length === 0, act: () => set({ accessories: [] }) },
]);
row("Skin", [
  { label: "Bon", act: () => setId({ skin: BON_IDENTITY_V2.skin }) }, { label: "lighter", act: () => setId({ skin: "#f6cdaa" }) }, { label: "deeper", act: () => setId({ skin: "#b97a52" }) },
]);

// ---- IDENTITY: the photo-derived draft, and every bounded control on it (no rebuild: uniforms + morph weights) ----
const setId = (patch: Partial<IdentityParams>) => { avatar.setIdentity({ ...avatar.identity, ...patch }); syncSliders(); };
panel.append(h("h2", "Identity (from ONE photo)"));
row("Draft", [
  { label: "Bon · from illustration", act: () => { avatar.setIdentity(structuredClone(BON_IDENTITY_ILLUSTRATED)); syncSliders(); } },
  { label: "photo draft (old)", act: () => { avatar.setIdentity(structuredClone(BON_IDENTITY_V2)); syncSliders(); } },
  { label: "Neutral canonical", act: () => { avatar.setIdentity(structuredClone(NEUTRAL_IDENTITY)); syncSliders(); } },
  { label: "Stubble on/off", act: () => setId({ facialHair: { ...avatar.identity.facialHair, ...(avatar.identity.facialHair.stubble + avatar.identity.facialHair.mustache > 0 ? { stubble: 0, mustache: 0, chin: 0 } : { stubble: BON_IDENTITY_V2.facialHair.stubble, mustache: BON_IDENTITY_V2.facialHair.mustache, chin: BON_IDENTITY_V2.facialHair.chin }) } }) },
]);
const sliders: { get: () => number; input: HTMLInputElement; val: HTMLElement }[] = [];
function slider(group: string, label: string, range: readonly [number, number], get: () => number, put: (v: number) => void): void {
  const r = h("div", "", "row"); const l = h("label", label); l.style.width = "86px";
  const input = document.createElement("input"); input.type = "range"; input.min = String(range[0]); input.max = String(range[1]); input.step = "0.01"; input.style.flex = "1";
  const val = h("span", ""); val.style.width = "34px"; val.style.textAlign = "right"; val.style.color = "#9aa4b2";
  input.oninput = () => { put(+input.value); val.textContent = (+input.value).toFixed(2); };
  r.append(l, input, val); panel.append(r); sliders.push({ get, input, val }); void group;
}
function syncSliders(): void { for (const s of sliders) { const v = s.get(); s.input.value = String(v); s.val.textContent = v.toFixed(2); } }
const I = () => avatar.identity;
panel.append(h("div", "Face shape", "sub"));
for (const k of SHAPE_CONTROLS) slider("shape", k, PARAM_RANGES.shape, () => I().shape[k], (v) => avatar.setIdentity({ ...I(), shape: { ...I().shape, [k]: v } }));
panel.append(h("div", "Eyes", "sub"));
for (const k of ["scale", "spacing", "openness", "lidRest", "tilt", "irisSize", "crease"] as const) slider("eyes", k, PARAM_RANGES.eyes[k], () => I().eyes[k], (v) => avatar.setIdentity({ ...I(), eyes: { ...I().eyes, [k]: v } }));
panel.append(h("div", "Brows · lips · nose · cheeks · facial hair", "sub"));
for (const k of ["height", "thickness", "arch", "tilt", "length", "gap"] as const) slider("brows", `brow ${k}`, PARAM_RANGES.brows[k], () => I().brows[k], (v) => avatar.setIdentity({ ...I(), brows: { ...I().brows, [k]: v } }));
for (const k of ["width", "upper", "lower", "bow"] as const) slider("lips", `lip ${k}`, PARAM_RANGES.lips[k], () => I().lips[k], (v) => avatar.setIdentity({ ...I(), lips: { ...I().lips, [k]: v } }));
slider("nose", "nostrils", PARAM_RANGES.nose.nostril, () => I().nose.nostril, (v) => avatar.setIdentity({ ...I(), nose: { nostril: v } }));
slider("cheeks", "blush", PARAM_RANGES.cheeks.blush, () => I().cheeks.blush, (v) => avatar.setIdentity({ ...I(), cheeks: { blush: v } }));
for (const k of ["stubble", "mustache", "chin"] as const) slider("hair", k, PARAM_RANGES.facialHair[k], () => I().facialHair[k], (v) => avatar.setIdentity({ ...I(), facialHair: { ...I().facialHair, [k]: v } }));

panel.append(h("h2", "Shared animation"));
row("Clip", [
  { label: "Idle", on: () => mode === "stand" && avatar.clip === idleOf(), act: () => { setMode("stand"); avatar.play(idleOf(), 0.3); } },
  { label: "Walk", on: () => mode === "walk-loop", act: () => setMode("walk-loop") },
  { label: "Run", on: () => mode === "run-loop", act: () => setMode("run-loop") },
  // "Sit" is the upright seated pose (the shared desk pose); the chin-on-hand clip is its own gesture, never the default sit
  { label: "Sit", on: () => avatar.clip === "sitting-answering" && desk.phase === "idle", act: () => { setMode("stand"); avatar.hold("sitting-answering", 0.5, 0.3); } },
  { label: "Chin rest", on: () => avatar.clip === "sit-on-chair-arms" && desk.phase === "idle", act: () => { setMode("stand"); avatar.play("sit-on-chair-arms", 0.3); } },
  { label: "Agree", act: () => { setMode("stand"); avatar.play("agree-gesture", 0.3); } },
  { label: "Listen", act: () => { setMode("stand"); avatar.play("listening-gesture", 0.3); } },
  { label: "Seated talk", act: () => { setMode("stand"); avatar.play("sitting-answering", 0.3); } },
]);
row("Idle", [
  { label: "masculine", on: () => cfg().idleProfile === "masculine", act: () => set({ idleProfile: "masculine" }) },
  { label: "feminine", on: () => cfg().idleProfile === "feminine", act: () => set({ idleProfile: "feminine" }) },
]);
row("Scooter", [{ label: "Ride (rider pose)", on: () => mode === "scooter", act: () => { setMode(mode === "scooter" ? "stand" : "scooter"); view(mode === "scooter" ? "scooter" : "full"); } }]);

panel.append(h("h2", "Face"));
row("Eyes", [
  { label: "Blink", act: () => avatar.face?.blink() },
  { label: "Auto blink", on: () => !!avatar.face?.blinking, act: () => { if (avatar.face) avatar.face.blinking = !avatar.face.blinking; } },
]);
row("Look", [
  { label: "auto", on: () => lookMode === "auto", act: () => { lookMode = "auto"; } },
  { label: "left", on: () => lookMode === "left", act: () => { lookMode = "left"; } },
  { label: "right", on: () => lookMode === "right", act: () => { lookMode = "right"; } },
  { label: "camera", on: () => lookMode === "camera", act: () => { lookMode = "camera"; } },
  { label: "cursor", on: () => lookMode === "cursor", act: () => { lookMode = "cursor"; } },
]);
row("Talk", [{ label: "Talking", on: () => !!avatar.face?.talking, act: () => { if (avatar.face) avatar.face.talking = !avatar.face.talking; } }]);
row("Mood", (Object.keys(EXPRESSIONS) as Expression[]).map((e) => ({ label: e, on: () => avatar.face?.expression === e, act: () => { if (avatar.face) avatar.face.expression = e; } })));

panel.append(h("h2", "Packet (AI Workforce)"));
row("Packet", [
  { label: "Receive", on: () => carry.state === "receiving", act: () => { if (packet.holder === tableSpot) packet.place(standSpot); setMode("stand"); carry.receive(standSpot); view("full"); } },
  { label: "Offer (handoff-ready)", on: () => carry.state === "offering", act: () => carry.offer() },
  { label: "Hold", on: () => carry.state === "holding", act: () => carry.hold() },
  { label: "Place on table", on: () => carry.state === "placing", act: () => carry.place(tableSpot) },
  { label: "Cancel", act: () => carry.cancel() },
  { label: "Walk with it", on: () => mode === "walk-loop" && carry.holding, act: () => setMode(mode === "walk-loop" ? "stand" : "walk-loop") },
]);
panel.append(h("h2", "Workstation"));
row("Desk", [
  { label: "Go type", on: () => desk.phase === "work", act: () => { if (carry.state !== "empty") return; setMode("stand"); desk.start(); view("desk"); } },
  { label: "Stand up", act: () => { desk.standUp(); } },
  { label: "Hands view", act: () => view("hands") },
]);
// READ-ONLY reference: the approved baked Bon v3 (production asset, roster material recipe) beside the modular one
// READ-ONLY reference: approved PRODUCTION employees (baked GLBs, the roster's material recipe, their own idle) in a
// row beside the HumanBase Bon — the visual source of truth for how humans look in VO.
const PROD = [["bon", "bon-v3-hq-idle9/bon-v3-lod0.glb"], ["alex", "alex-v2-hq-idle9/alex-v2-lod0.glb"], ["gelo", "gelo-v1-hq-idle9/gelo-v1-lod0.glb"], ["jan", "jan-v1-hq-idle9/jan-v1-lod0.glb"], ["kael", "kael-v1-fix-hq-idle9/kael-v1-fix-lod0.glb"]] as const;
let compare: THREE.Object3D[] = []; const compareMixers: THREE.AnimationMixer[] = [];
async function toggleCompare(): Promise<void> {
  if (compare.length) { for (const o of compare) o.removeFromParent(); compare = []; compareMixers.length = 0; return; }
  const { clone } = await import("three/examples/jsm/utils/SkeletonUtils.js");
  let x = -26;
  for (const [, f] of PROD) {
    const gltf = await loadGlb(`${import.meta.env.BASE_URL}avatars/${f}`);
    const sceneC = clone(gltf.scene); sceneC.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(sceneC); const s = 36 / (box.max.y - box.min.y);
    sceneC.scale.setScalar(s); sceneC.position.set(-((box.min.x + box.max.x) / 2) * s + x, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
    sceneC.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
      const sm = m.material as THREE.MeshStandardMaterial; m.material = new THREE.MeshStandardMaterial({ map: sm.map, roughness: 0.9, metalness: 0, side: sm.side }); });
    const mixer = new THREE.AnimationMixer(sceneC); const idle = gltf.animations.find((c) => c.name === "idle-9"); if (idle) mixer.clipAction(idle).play();
    compareMixers.push(mixer); compare.push(sceneC); scene.add(sceneC); x -= 26;
  }
}

// the real photo (served from the gitignored pipeline output — never shipped)
// the approved ILLUSTRATED Bon — the identity blueprint (served from the gitignored pipeline output)
const illus = document.createElement("img");
illus.src = `${import.meta.env.BASE_URL}scripts/avatar-pipeline/output/human-base/bon-illustrated.png`;
Object.assign(illus.style, { position: "fixed", left: "12px", bottom: "12px", width: "300px", borderRadius: "10px", background: "#fff", boxShadow: "0 4px 18px rgba(0,0,0,0.25)", display: OPTIM_PARAM ? "none" : "block" });
document.body.append(illus);
const photo = document.createElement("img");
photo.src = `${import.meta.env.BASE_URL}scripts/avatar-pipeline/output/human-base/bon-real.jpeg`;
Object.assign(photo.style, { position: "fixed", left: "322px", bottom: "12px", width: "220px", borderRadius: "10px", boxShadow: "0 4px 18px rgba(0,0,0,0.25)", display: "none" });
document.body.append(photo);
// Phase 2's modular Bon, beside the new one (right)
let phase2: HumanAvatar | null = null;
async function togglePhase2(): Promise<void> {
  if (phase2) { phase2.dispose(); phase2 = null; return; }
  phase2 = await HumanAvatar.create(structuredClone(BON_PHASE2_AVATAR) as EmployeeAvatar, CATALOGUE_BY_ID);
  phase2.root.position.set(28, 0, 0); scene.add(phase2.root); phase2.root.traverse((o) => { o.frustumCulled = false; });
}
// ---- VARIATION LINEUP (debug): the SAME locked face system with different identity parameters — proof that it
// makes different people, not one face re-textured. Not real employees; bounded controlled variations only.
const VARIANTS: { name: string; skin: string; hair: string; p: (b: IdentityParams) => IdentityParams }[] = [
  { name: "A", skin: "#f3cba8", hair: "#3b2a20", p: (b) => ({ ...b, shape: { ...b.shape, faceWidth: -0.6, jawWidth: -0.7, chinLength: 0.6, cheekFull: -0.3, noseSize: -0.2, noseWidth: -0.5, noseLength: 0.5, forehead: -0.3, lipFull: -0.3 },
    eyes: { ...b.eyes, scale: 1.08, spacing: -0.1, openness: 1.05, lidRest: 0.04, tilt: 0.12, iris: "#4a6a3a", crease: 0.2 }, brows: { ...b.brows, height: 0.5, thickness: 0.7, arch: 0.9, tilt: 0.3, color: "#3b2a20" },
    lips: { ...b.lips, width: 0.88, upper: 0.8, lower: 0.95, bow: 0.8, color: "#d9887f" }, facialHair: { ...b.facialHair, stubble: 0, mustache: 0, chin: 0 }, cheeks: { blush: 0.55 } }) },
  { name: "B", skin: "#8d5a3b", hair: "#120f0f", p: (b) => ({ ...b, shape: { ...b.shape, faceWidth: 0.9, jawWidth: 0.9, chinLength: 0.2, cheekFull: 0.2, noseSize: 0.6, noseWidth: 1, noseLength: -0.3, forehead: 0.4, lipFull: 1 },
    eyes: { ...b.eyes, scale: 0.88, spacing: 0.3, openness: 0.9, lidRest: 0.12, tilt: 0, iris: "#1b120e", crease: 0.5 }, brows: { ...b.brows, height: -0.1, thickness: 1.5, arch: 0.1, tilt: -0.3, color: "#100c0c" },
    lips: { ...b.lips, width: 1.2, upper: 1.4, lower: 1.5, bow: 0.4, color: "#7d4a44" }, facialHair: { ...b.facialHair, stubble: 0.9, mustache: 1, chin: 1 } }) },
  { name: "C", skin: "#f0bf95", hair: "#6b4a2e", p: (b) => ({ ...b, shape: { ...b.shape, faceWidth: -0.2, jawWidth: -0.4, chinLength: -0.5, cheekFull: 1, noseSize: -0.6, noseWidth: -0.2, noseLength: -0.6, forehead: 0.8, lipFull: 0.2 },
    eyes: { ...b.eyes, scale: 1.12, spacing: 0.05, openness: 1.1, lidRest: 0.02, tilt: -0.1, iris: "#5a3a1e", irisSize: 1.08, crease: 0.1 }, brows: { ...b.brows, height: 0.8, thickness: 0.9, arch: 0.6, tilt: 0.1, color: "#5a3e26" },
    lips: { ...b.lips, width: 0.82, upper: 1.1, lower: 1.2, bow: 0.9, color: "#e0908c" }, facialHair: { ...b.facialHair, stubble: 0, mustache: 0, chin: 0 }, cheeks: { blush: 0.7 } }) },
];
let lineup: HumanAvatar[] = [];
async function toggleLineup(): Promise<void> {
  if (lineup.length) { for (const a of lineup) a.dispose(); lineup = []; return; }
  let x = 30;
  for (const v of VARIANTS) {
    const p = v.p(structuredClone(BON_IDENTITY_V2)); p.skin = v.skin;
    const cfg2 = { ...structuredClone(BON_AVATAR), employeeId: `variant-${v.name}`, identity: { headAssetId: "canonical-head-v1", params: p }, hair: { assetId: "medium-curtain", color: v.hair } } as EmployeeAvatar;
    const a = await HumanAvatar.create(cfg2, CATALOGUE_BY_ID);
    a.root.position.set(x, 0, 0); x += 26; scene.add(a.root); a.root.traverse((o) => { o.frustumCulled = false; }); lineup.push(a);
  }
}
// HEAD ENVELOPE: production Alex (bind pose, his own file) beside HumanBase wearing the neutral Alex-derived head,
// both at the contract scale and frozen at bind — the skull/head-to-body proportions must read as the same person's
const ENV_X = -240, ENV_GAP = 46;
let envelope: THREE.Object3D[] = [];
async function toggleEnvelope(): Promise<void> {
  if (envelope.length) { for (const o of envelope) o.removeFromParent(); envelope = []; return; }
  const gltf = await loadGlb(`${import.meta.env.BASE_URL}avatars/alex-v2-hq-idle9/alex-v2-lod0.glb`);
  const alex = gltf.scene; alex.scale.multiplyScalar(W); alex.position.set(ENV_X, 0, 0);
  alex.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
    const sm = m.material as THREE.MeshStandardMaterial; m.material = new THREE.MeshStandardMaterial({ map: sm.map, roughness: 0.9, metalness: 0, side: sm.side }); });
  const cfg2 = { ...structuredClone(BON_AVATAR), employeeId: "envelope", identity: { headAssetId: "alex-neutral-head-v1" }, hair: { assetId: null },
    top: { assetId: "tee-offshorly", colorway: "white" }, shoes: { assetId: "sneakers" }, glasses: { assetId: null } } as EmployeeAvatar;
  const hb = await HumanAvatar.create(cfg2, CATALOGUE_BY_ID);
  hb.root.position.set(ENV_X + ENV_GAP, 0, 0); hb.root.traverse((o) => { o.frustumCulled = false; });
  scene.add(alex, hb.root); envelope = [alex, hb.root];
}
const ENV_C = ENV_X + ENV_GAP / 2;
// MESHY BON: the integrated Meshy identity head on HumanBase in Bon's outfit, production Alex beside (both idling)
const MB_X = 420;
let meshyBon: HumanAvatar | null = null; let mbAlex: THREE.Object3D | null = null; let mbMixer: THREE.AnimationMixer | null = null;
async function toggleMeshyBon(): Promise<void> {
  if (meshyBon) { meshyBon.dispose(); mbAlex?.removeFromParent(); meshyBon = null; mbAlex = null; mbMixer = null; return; }
  const cfg2 = { ...structuredClone(BON_AVATAR), employeeId: "bon-meshy", identity: { headAssetId: "bon-meshy-chibi-v1" }, hair: { assetId: null }, glasses: { assetId: null } } as EmployeeAvatar;
  meshyBon = await HumanAvatar.create(cfg2, CATALOGUE_BY_ID);
  meshyBon.root.position.set(MB_X, 0, 0); meshyBon.root.traverse((o) => { o.frustumCulled = false; }); scene.add(meshyBon.root);
  const gltf = await loadGlb(`${import.meta.env.BASE_URL}avatars/alex-v2-hq-idle9/alex-v2-lod0.glb`);
  const { clone } = await import("three/examples/jsm/utils/SkeletonUtils.js");
  mbAlex = clone(gltf.scene); mbAlex.scale.multiplyScalar(W); mbAlex.position.set(MB_X - 40, 0, 0);
  mbAlex.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
    const sm = m.material as THREE.MeshStandardMaterial; m.material = new THREE.MeshStandardMaterial({ map: sm.map, roughness: 0.9, metalness: 0, side: sm.side }); });
  mbMixer = new THREE.AnimationMixer(mbAlex); const idle = gltf.animations.find((c) => c.name === "idle-9"); if (idle) mbMixer.clipAction(idle).play();
  scene.add(mbAlex);
}
// FAMILY LINEUP: production Alex → previous thick-neck Bon (frozen baseline, served from the gitignored pipeline
// output) → current head-only pipeline Bon on the HumanBase neck
const REGRESSION_CATALOGUE = new Map(CATALOGUE_BY_ID).set("bon-meshy-chibi-approved", { id: "bon-meshy-chibi-approved", slot: "identity", label: "Bon · approved baseline",
  url: `${import.meta.env.BASE_URL}scripts/avatar-pipeline/output/human-base/baseline/bon-meshy-chibi-v1.approved.glb`, hides: [] });
const FL_X = 560;
let family: HumanAvatar[] = []; let flAlex: THREE.Object3D | null = null; let flMixer: THREE.AnimationMixer | null = null;
async function toggleFamily(): Promise<void> {
  if (family.length) { for (const a of family) a.dispose(); flAlex?.removeFromParent(); family = []; flAlex = null; flMixer = null; return; }
  const gltf = await loadGlb(`${import.meta.env.BASE_URL}avatars/alex-v2-hq-idle9/alex-v2-lod0.glb`);
  const { clone } = await import("three/examples/jsm/utils/SkeletonUtils.js");
  flAlex = clone(gltf.scene); flAlex.scale.multiplyScalar(W); flAlex.position.set(FL_X, 0, 0);
  flAlex.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
    const sm = m.material as THREE.MeshStandardMaterial; m.material = new THREE.MeshStandardMaterial({ map: sm.map, roughness: 0.9, metalness: 0, side: sm.side }); });
  flMixer = new THREE.AnimationMixer(flAlex); const idle = gltf.animations.find((c) => c.name === "idle-9"); if (idle) flMixer.clipAction(idle).play();
  scene.add(flAlex);
  const cfgs: Partial<EmployeeAvatar>[] = [
    { identity: { headAssetId: "bon-meshy-chibi-approved" }, hair: { assetId: null } },
    { identity: { headAssetId: "bon-meshy-chibi-v1" }, hair: { assetId: null } },
  ];
  let x = FL_X + 40;
  for (const c of cfgs) {
    const a = await HumanAvatar.create({ ...structuredClone(BON_AVATAR), employeeId: `family-${x}`, glasses: { assetId: null }, ...c } as EmployeeAvatar, REGRESSION_CATALOGUE);
    a.root.position.set(x, 0, 0); a.root.traverse((o) => { o.frustumCulled = false; }); scene.add(a.root); family.push(a); x += 40;
  }
}
// CONSTRUCTION PROOF (dev): canonical anatomy → Bon normalisation → final construction, in one row at x ≥ 900.
// Each avatar shows only the parts named in `show` (identity meshes, body/garments, or all).
const DBG = `${import.meta.env.BASE_URL}scripts/avatar-pipeline/output/human-base/debug/`;
const CONSTRUCT_CAT = new Map(REGRESSION_CATALOGUE)
  .set("dbg-before-cut", { id: "dbg-before-cut", slot: "identity", label: "debug", url: `${DBG}bon-meshy-chibi-v1.before-cut.glb`, hides: [] })
  .set("dbg-no-hair", { id: "dbg-no-hair", slot: "identity", label: "debug", url: `${DBG}bon-meshy-chibi-v1.no-hair.glb`, hides: [] });
let construct: { a: HumanAvatar; label: string }[] = [];
async function toggleConstruct(): Promise<void> {
  if (construct.length) { for (const c of construct) c.a.dispose(); construct = []; return; }
  const plan: [string, string, "head" | "body" | "all", Partial<EmployeeAvatar>][] = [
    ["alexHead", "alex-neutral-head-v1", "head", { top: { assetId: "tee-offshorly", colorway: "white" }, shoes: { assetId: "sneakers" } }],
    ["humanBase", "alex-neutral-head-v1", "body", { top: { assetId: "tee-offshorly", colorway: "white" }, shoes: { assetId: "sneakers" } }],
    ["alexMounted", "alex-neutral-head-v1", "all", { top: { assetId: "tee-offshorly", colorway: "white" }, shoes: { assetId: "sneakers" } }],
    ["bonBefore", "dbg-before-cut", "head", {}],
    ["bonHead", "bon-meshy-chibi-v1", "head", {}],
    ["bonMounted", "bon-meshy-chibi-v1", "all", {}],
    ["bonNoHair", "dbg-no-hair", "all", {}],
    ["bonDiag", "bon-meshy-chibi-v1", "all", { top: { assetId: "tee-offshorly", colorway: "white" } }],
  ];
  let x = 900;
  for (const [label, head, show, extra] of plan) {
    const a = await HumanAvatar.create({ ...structuredClone(BON_AVATAR), employeeId: `construct-${label}`, identity: { headAssetId: head }, hair: { assetId: null }, glasses: { assetId: null }, ...extra } as EmployeeAvatar, CONSTRUCT_CAT);
    a.root.position.set(x, 0, 0); a.root.traverse((o) => { o.frustumCulled = false; const m = o as THREE.Mesh; if (!m.isMesh) return; const id = m.name.startsWith("identity:"); m.visible = show === "all" || (show === "head" ? id : !id); });
    scene.add(a.root); construct.push({ a, label }); x += 40;
  }
}
// OPTIMISATION LINEUP (dev): the frozen approved head + candidates from the gitignored optimisation output, in a row at
// x ≥ 1300, identical outfit; `optimRow` lists the published-path suffixes to load
const OPT = `${import.meta.env.BASE_URL}scripts/avatar-pipeline/output/human-base/`;
let optim: HumanAvatar[] = [];
async function toggleOptim(files: string[], who: "bon" | "micah" | EmployeeAvatar | EmployeeAvatar[] = "bon"): Promise<void> {
  if (optim.length) { for (const a of optim) a.dispose(); optim = []; return; }
  const cat = new Map(CATALOGUE_BY_ID); let x = 1300;
  for (const f of files) {
    cat.set(`opt:${f}`, { id: `opt:${f}`, slot: "identity", label: f, url: `${OPT}${f}`, hides: [] });
    const baseCfg = Array.isArray(who) ? who[files.indexOf(f)] : typeof who === "object" ? who : who === "micah" ? MICAH_AVATAR : { ...BON_AVATAR, hair: { assetId: null }, glasses: { assetId: null } };
    const a = await HumanAvatar.create({ ...structuredClone(baseCfg), employeeId: `opt-${x}`, identity: { headAssetId: `opt:${f}` } } as EmployeeAvatar, cat);
    a.root.position.set(x, 0, 0); a.root.traverse((o) => { o.frustumCulled = false; }); scene.add(a.root); optim.push(a); x += 40;
  }
}
// BODY PRESETS (dev): standard vs feminine HumanBase side by side at x ≥ 1800, same neutral head and outfit
let presets: HumanAvatar[] = [];
async function togglePresets(outfit: "tee" | "hoodie" = "tee"): Promise<void> {
  if (presets.length) { for (const a of presets) a.dispose(); presets = []; return; }
  let x = 1800;
  for (const bodyPreset of ["standard", "feminine"] as const) {
    const top = outfit === "tee" ? { assetId: "tee-offshorly", colorway: "white" } : { assetId: "hoodie-crrn", colorway: "black" };
    const a = await HumanAvatar.create({ ...structuredClone(BON_AVATAR), employeeId: `preset-${bodyPreset}`, bodyPreset, identity: { headAssetId: "alex-neutral-head-v1" }, hair: { assetId: null }, glasses: { assetId: null }, top, shoes: { assetId: "sneakers" } } as EmployeeAvatar, CATALOGUE_BY_ID);
    a.root.position.set(x, 0, 0); a.root.traverse((o) => { o.frustumCulled = false; }); scene.add(a.root); presets.push(a); x += 40;
  }
}
// ROW (dev): any list of configurations side by side at x ≥ 2000 (Micah reviews: glasses on/off, tee colours)
let row2: HumanAvatar[] = [];
async function toggleRow(patches: Partial<EmployeeAvatar>[], baseCfg: EmployeeAvatar = MICAH_AVATAR): Promise<void> {
  if (row2.length) { for (const a of row2) a.dispose(); row2 = []; return; }
  let x = 2000;
  for (const p of patches) { const a = await HumanAvatar.create({ ...structuredClone(baseCfg), employeeId: `row-${x}`, ...p } as EmployeeAvatar, CATALOGUE_BY_ID);
    a.root.position.set(x, 0, 0); a.root.traverse((o) => { o.frustumCulled = false; }); scene.add(a.root); row2.push(a); x += 36; }
}
/** review lighting: neutral tone mapping (keeps skin hue — ACES pushes peach toward beige) */
function neutralLight(on = true): void {
  renderer.toneMapping = on ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = on ? 1.0 : 1.05;
  scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined; if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true; });
}
Object.assign(VIEWS, {
  envFront: { pos: [ENV_C, 22, 125], target: [ENV_C, 19, 0] },
  env34: { pos: [ENV_C + 80, 23, 95], target: [ENV_C, 19, 0] },
  envSide: { pos: [ENV_C + 125, 22, 0], target: [ENV_C, 19, 0] },
  envHeads: { pos: [ENV_C, 27.5, 105], target: [ENV_C, 26.5, 0] },
  envHeadsSide: { pos: [ENV_C + 62, 27, 0], target: [ENV_C, 26, 0] },
});
panel.append(h("h2", "Reference"));
row("Envelope", [{ label: "Alex vs neutral HumanBase head", on: () => envelope.length > 0, act: () => toggleEnvelope() }]);
row("Meshy", [{ label: "Family lineup (far right)", on: () => family.length > 0, act: () => toggleFamily() }, { label: "Meshy Bon + Alex (far right)", on: () => !!meshyBon, act: () => toggleMeshyBon() }, { label: "Neutral light", on: () => renderer.toneMapping === THREE.NeutralToneMapping, act: () => neutralLight(renderer.toneMapping !== THREE.NeutralToneMapping) }]);
row("Variations", [{ label: "Identity variation lineup (right)", on: () => lineup.length > 0, act: () => toggleLineup() }]);
row("Compare", [
  { label: "Illustrated Bon", on: () => illus.style.display !== "none", act: () => { illus.style.display = illus.style.display === "none" ? "block" : "none"; } },
  { label: "Real photo", on: () => photo.style.display !== "none", act: () => { photo.style.display = photo.style.display === "none" ? "block" : "none"; } },
  { label: "Phase 2 Bon (left)", on: () => !!phase2, act: () => togglePhase2() },
  { label: "Production family (left)", on: () => compare.length > 0, act: () => toggleCompare() },
]);
panel.append(h("h2", "View"));
row("Camera", Object.keys(VIEWS).map((k) => ({ label: k, act: () => view(k) })));
row("Debug", [{ label: "Frames + sockets + targets", on: () => dbg.visible, act: () => { dbg.visible = !dbg.visible; } },
  { label: "Body clearance", on: () => avatar.clearance.enabled, act: () => { avatar.clearance.enabled = !avatar.clearance.enabled; } }]);
panel.append(h("h2", "Performance"));
const statsEl = h("div", "", ""); statsEl.id = "stats"; panel.append(statsEl);
refresh();
syncSliders();

// ---- frame loop -----------------------------------------------------------------------------------------------
const stateEl = document.getElementById("state")!;
const clock = new THREE.Clock();
let frames = 0, acc = 0, fps = 0;
function resources(): string {
  const rs = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const glb = rs.filter((r) => r.name.includes("/human-base-v1/"));
  const kb = glb.reduce((a, r) => a + (r.decodedBodySize || r.transferSize || 0), 0) / 1024;
  return `${glb.length} files · ${kb.toFixed(0)} KB`;
}
function tick(): void {
  const dt = Math.min(0.05, clock.getDelta());
  if (mode === "walk-loop" || mode === "run-loop") {
    const speed = (mode === "run-loop" ? 2.6 : 1.25) * W, R = 38;
    loopA += (speed / R) * dt;
    avatar.root.position.set(Math.sin(loopA) * R, 0, Math.cos(loopA) * R - R);
    avatar.root.rotation.y = loopA + Math.PI / 2;
  }
  avatar.update(dt);
  for (const m of compareMixers) m.update(dt);
  phase2?.update(dt);
  for (const a of lineup) a.update(dt);
  meshyBon?.update(dt); mbMixer?.update(dt); for (const a of family) a.update(dt); flMixer?.update(dt); for (const c of construct) c.a.update(dt); for (const a of optim) a.update(dt); for (const a of presets) a.update(dt); for (const a of row2) a.update(dt);
  // loops and the desk walk: the camera keeps its offset and follows Bon
  if (mode === "walk-loop" || mode === "run-loop" || desk.phase === "approach") {
    const want = avatar.root.position.clone().add(new THREE.Vector3(0, 15, 0));
    const d = want.sub(controls.target); controls.target.add(d); camera.position.add(d);
  }
  updateDebug();
  controls.update();
  renderer.render(scene, camera);
  frames++; acc += dt; if (acc > 0.5) { fps = frames / acc; frames = 0; acc = 0; }
  const st = avatar.stats();
  statsEl.textContent = [
    `fps ${fps.toFixed(0)}   draws (scene) ${renderer.info.render.calls}   tris (scene) ${(renderer.info.render.triangles / 1000).toFixed(1)}k`,
    `avatar: ${(st.triangles / 1000).toFixed(1)}k tris · ${st.draws} draws · hide mask 0x${st.hideMask.toString(16)}`,
    ...st.pieces.map((p) => `  ${p.slot.padEnd(18)} ${(p.triangles / 1000).toFixed(1).padStart(5)}k  ${p.draws}`),
    `first compose ${firstComposeMs.toFixed(0)} ms · last equip ${avatar.timing.lastEquipMs.toFixed(1)} ms`,
    `clearance: ${avatar.clearance.stats.pushes} pushes · max pen ${(avatar.clearance.stats.maxPenetration * 100).toFixed(1)} cm · legs ${(avatar.clearance.stats.legSpread * 100).toFixed(1)} cm · ${avatar.clearance.lastMs.toFixed(2)} ms`,
    `per frame: mixer ${avatar.timing.mixerMs.toFixed(2)} · layers ${avatar.timing.layersMs.toFixed(2)} · face ${(avatar.face?.lastMs ?? 0).toFixed(3)} · contacts ${contacts.lastMs.toFixed(2)} ms`,
    `downloads: ${resources()}`,
    `textures in GPU: ${renderer.info.memory.textures} · geometries ${renderer.info.memory.geometries}`,
  ].join("\n");
  stateEl.textContent = `clip ${avatar.clip}  ·  mode ${mode}  ·  packet ${carry.state}  ·  desk ${desk.phase}\nhands L ${contacts.w.L.toFixed(2)} (err ${(contacts.error.L / W * 100).toFixed(1)} cm) · R ${contacts.w.R.toFixed(2)} (err ${(contacts.error.R / W * 100).toFixed(1)} cm) · keys ${desk.presses.L + desk.presses.R}\neyes closed ${(avatar.face?.closure ?? 0).toFixed(2)} · talking ${avatar.face?.talking ? "yes" : "no"} · mood ${avatar.face?.expression}`;
  requestAnimationFrame(tick);
}
tick();
window.addEventListener("resize", () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

// ---- capture hook -------------------------------------------------------------------------------------------
Object.assign(window, { __hb: { AVATARS: { bon: { ...BON_AVATAR, identity: { headAssetId: "bon-meshy-chibi-v1" }, hair: { assetId: null }, glasses: { assetId: null } }, micah: MICAH_AVATAR, angelo: ANGELO_AVATAR, clang: CLANG_AVATAR, france: FRANCE_AVATAR }, toggleRow, getRow: () => row2.map((a) => a.root), TEE_COLORWAYS, togglePresets, getPresets: () => presets.map((a) => a.root), getPresetAvatars: () => presets, toggleOptim, getOptim: () => optim.map((a) => a.root), getOptimAvatars: () => optim, toggleConstruct, getConstruct: () => construct.map((c) => c.a.root), toggleEnvelope, toggleMeshyBon, toggleFamily, getFamily: () => [flAlex, ...family.map((a) => a.root)], neutralLight, getMeshyBon: () => [meshyBon, mbAlex] as const, getEnvelope: () => envelope, illus, toggleLineup, togglePhase2, photo, controls, toggleCompare, avatar, carry, desk, contacts, packet, view, setMode, set, standSpot, tableSpot, renderer, scene, camera, setLook: (m: typeof lookMode) => { lookMode = m; }, refresh } });
