// vo3d human — PRODUCTION-CANDIDATE QA VIEWER (human-base-qa.html?humanbase=1). DEV-ONLY, isolated: nothing in the
// app imports this. It mounts the OPTIMISED production candidate of one employee with that employee's full
// configuration (body preset, outfit, glasses, hair accessories) and makes arbitrary-angle inspection convenient:
// free orbit, the 360° QA camera set, close presets for every construction seam (eyes, hairline, fringe, neck, collar,
// waist, seat, hands, ankles), eye states, gaze, behaviours (idle / walk / turn / sit / typing / scooter / gestures),
// layer debug, and a pose-time garment ↔ skin check (`__qa.garmentCheck()`).
//
//   ?who=bon|micah|angelo|clang|france   the employee (default bon)
//   ?src=production (default)            public/avatars/human-base-v1/{production,accessories}/ — the candidates
//   ?src=v1                              the frozen V1 snapshot (output/human-base/v1-release/snapshot/) for A/B
//   ?head=<path under human-base-v1/>    dev: a working (unoptimised) identity for ?who
//   ?capture=1                           hides the UI (scripts/avatar-pipeline/human-base/qa-360.mjs drives `__qa`)
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RiderPose } from "../../avatar/riderPose";
import { RIDER_GRIPS, DECK_TOP } from "../../world/scooters";
import { vehicleGeos } from "../../build/vehicles";
import { HUMAN_WORLD_SCALE as W, idleClip, type AppearanceAsset, type EmployeeAvatar } from "../humanBaseContract";
import { ANGELO_AVATAR, BON_AVATAR, CATALOGUE_BY_ID, CLANG_AVATAR, FRANCE_AVATAR, MICAH_AVATAR } from "../humanCatalogue";
import { HumanAvatar } from "../HumanAvatar";
import { checkAccessory, fitEnvelopePositions, placeAccessory, type AttachData } from "../humanAccessoryFit";
import { DeskWork, HandContacts } from "../humanBehavior";
import { WORKSTATION, buildWorkstation } from "../humanInteraction";
import type { Expression } from "../humanFace";

const Q = new URLSearchParams(location.search);
if (Q.get("humanbase") !== "1") { document.getElementById("gate")!.style.display = "flex"; document.getElementById("panel")!.style.display = "none"; throw new Error("gated behind ?humanbase=1"); }
if (Q.get("capture") === "1") document.body.classList.add("capture");

// ---- the five production configurations (identity = the optimised production candidate) ----
const WHO = ["bon", "micah", "angelo", "clang", "france"] as const;
type Who = (typeof WHO)[number];
const CONFIG: Record<Who, EmployeeAvatar> = {
  bon: { ...BON_AVATAR, employeeId: "bon", idleProfile: "masculine", hair: { assetId: null }, glasses: { assetId: null } },
  micah: MICAH_AVATAR, angelo: ANGELO_AVATAR, clang: CLANG_AVATAR, france: FRANCE_AVATAR,
};
const SRC = Q.get("src") === "v1" ? "v1" : "production";
const B = import.meta.env.BASE_URL;
const root = SRC === "v1" ? `${B}scripts/avatar-pipeline/output/human-base/v1-release/snapshot/` : `${B}avatars/human-base-v1/`;
const catalogue = new Map<string, AppearanceAsset>(CATALOGUE_BY_ID);
for (const a of CATALOGUE_BY_ID.values()) if (a.slot === "glasses" || (a.slot === "accessory" && a.url.endsWith(".glb"))) catalogue.set(a.id, { ...a, url: `${root}accessories/${a.url.split("/").pop()}` });
const HEAD = Q.get("head");
for (const w of WHO) catalogue.set(`qa:${w}`, { id: `qa:${w}`, slot: "identity", label: `${w} production`, url: HEAD && w === Q.get("who") ? `${B}avatars/human-base-v1/${HEAD}` : `${root}production/${w}-v1.glb`, hides: [] });

// ---- renderer + scene (the VO look) ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xd9dfe6);
scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x8a8170, 1.3));
const sun = new THREE.DirectionalLight(0xfff4e2, 2.2); sun.position.set(-90, 220, 160); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120; sc.near = 10; sc.far = 700;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5; scene.add(sun);
const fill = new THREE.DirectionalLight(0xe8eef6, 0.6); fill.position.set(60, -40, -160); scene.add(fill);   // rear/underside views stay readable
const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 64), new THREE.MeshStandardMaterial({ color: 0xc9cfd6, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.5, 2000);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
// behaviour fixtures: a workstation (typing) and a scooter (rider pose), off to the side
const station = buildWorkstation(); station.root.position.set(60, 0, -30); scene.add(station.root);
const scooter = new THREE.Group(); scooter.position.set(-70, 0, 10); scooter.rotation.y = Math.PI;
{ const g = vehicleGeos("scooter"); const vm = (r: number, m = 0) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: r, metalness: m });
  for (const [geo, m] of [[g.paint, vm(0.45)], [g.gloss, vm(0.2, 0.3)], [g.matte, vm(0.85)], [g.lights, vm(0.3)]] as const) { const o = new THREE.Mesh(geo, m); o.castShadow = true; scooter.add(o); } }
scene.add(scooter);

// ---- views: azimuth (0 = the avatar's front, + = its left), elevation, distance (world units), about an AIM ----
type Aim = "head" | "eyeL" | "eyeR" | "body" | "brow" | "crown" | "jaw" | "neckjoin" | `bone:${string}`;
export const QA_VIEWS: Record<string, { az: number; el: number; d: number; aim?: Aim }> = {
  front: { az: 0, el: 4, d: 62 }, front34L: { az: 40, el: 4, d: 62 }, front34R: { az: -40, el: 4, d: 62 },
  sideL: { az: 90, el: 2, d: 62 }, sideR: { az: -90, el: 2, d: 62 }, rear34L: { az: 140, el: 6, d: 62 }, rear34R: { az: -140, el: 6, d: 62 },
  back: { az: 180, el: 6, d: 62 }, high: { az: 20, el: 58, d: 62 }, lowFront: { az: 10, el: -38, d: 58 }, lowRear: { az: 170, el: -38, d: 58 },
  under: { az: 0, el: -70, d: 50 },
  eyeFront: { az: 0, el: 2, d: 30, aim: "head" }, eye34L: { az: 38, el: 2, d: 24, aim: "eyeL" }, eye34R: { az: -38, el: 2, d: 24, aim: "eyeR" },
  eyeSideL: { az: 75, el: 0, d: 22, aim: "eyeL" }, eyeSideR: { az: -75, el: 0, d: 22, aim: "eyeR" }, eyeHigh: { az: 15, el: 40, d: 26, aim: "head" }, eyeLow: { az: 10, el: -32, d: 26, aim: "head" },
  hairline: { az: 0, el: 14, d: 30, aim: "brow" }, hairline34: { az: 35, el: 14, d: 30, aim: "brow" }, crown: { az: 20, el: 55, d: 34, aim: "crown" },
  fringeL: { az: 55, el: 8, d: 30, aim: "head" }, fringeR: { az: -55, el: 8, d: 30, aim: "head" },
  behindEarL: { az: 115, el: 5, d: 30, aim: "head" }, behindEarR: { az: -115, el: 5, d: 30, aim: "head" }, nape: { az: 180, el: -15, d: 34, aim: "head" },
  neckJoin: { az: 20, el: -40, d: 18, aim: "neckjoin" }, neckJoinSide: { az: 80, el: -20, d: 18, aim: "neckjoin" }, neckJoinBack: { az: 160, el: -25, d: 18, aim: "neckjoin" }, jawL: { az: 60, el: -18, d: 26, aim: "jaw" }, jawR: { az: -60, el: -18, d: 26, aim: "jaw" }, chin: { az: 0, el: -30, d: 26, aim: "jaw" },
  neck: { az: 25, el: -8, d: 30, aim: "bone:neck" }, neckSide: { az: 90, el: -4, d: 30, aim: "bone:neck" }, neckBack: { az: 160, el: -10, d: 30, aim: "bone:neck" },
  collar: { az: 20, el: 25, d: 40, aim: "bone:Spine02" }, shoulders: { az: 120, el: 30, d: 48, aim: "bone:Spine02" },
  waist: { az: 30, el: 0, d: 44, aim: "bone:Spine" }, waistBack: { az: 160, el: 0, d: 44, aim: "bone:Spine" },
  crotch: { az: 10, el: -22, d: 46, aim: "bone:Hips" }, seat: { az: 180, el: -12, d: 46, aim: "bone:Hips" },
  hands: { az: 70, el: 10, d: 32, aim: "bone:LeftHand" }, sleeves: { az: 75, el: 15, d: 40, aim: "bone:LeftForeArm" },
  ankles: { az: 30, el: 12, d: 34, aim: "bone:LeftFoot" }, anklesBack: { az: 160, el: 10, d: 34, aim: "bone:LeftFoot" },
  full: { az: 25, el: 8, d: 170, aim: "body" }, fullBack: { az: 160, el: 8, d: 170, aim: "body" }, fullLow: { az: 20, el: -25, d: 160, aim: "body" },
};

let avatar: HumanAvatar | null = null, who: Who = (WHO as readonly string[]).includes(Q.get("who") ?? "") ? (Q.get("who") as Who) : "bon";
let animate = true, currentView = "front34L", mode = "idle";
const worldOf = (local: number[]): THREE.Vector3 => new THREE.Vector3(...local).applyMatrix4(avatar!.rig.bindMatrixOf("Head", new THREE.Matrix4()));
function aimPoint(aim: Aim): THREE.Vector3 {
  const lm = avatar?.identityLandmarks; if (!avatar || !lm) return new THREE.Vector3(0, 23.5, 0);
  if (aim === "body") return new THREE.Vector3(0, 15, 0).add(avatar.root.position);
  if (aim.startsWith("bone:")) { const b = avatar.bones.get(aim.slice(5)); return b ? b.getWorldPosition(new THREE.Vector3()) : avatar.root.position.clone(); }
  if (aim === "brow" || aim === "crown") return worldOf([0, lm.eyes.l[1] + (aim === "brow" ? 0.3 : 0.5), aim === "brow" ? lm.eyes.l[2] - 0.05 : -0.05]);
  if (aim === "jaw") return worldOf([0, lm.mouth.c[1] - 0.12, lm.mouth.c[2] - 0.15]);
  if (aim === "neckjoin") return worldOf([0, lm.mouth.c[1] - 0.2, lm.mouth.c[2] - 0.24]);
  if (aim === "eyeL") return worldOf(lm.eyes.r);   // "left" = the avatar's left (+x)
  if (aim === "eyeR") return worldOf(lm.eyes.l);
  return worldOf([0, lm.eyes.l[1] + 0.02, lm.eyes.l[2]]);
}
function cam(name: string): void {
  const v = QA_VIEWS[name]; if (!v || !avatar) return; currentView = name;
  const t = v.aim ? aimPoint(v.aim) : aimPoint("head").add(new THREE.Vector3(0, 0.6, -2.2));
  const az = (v.az * Math.PI) / 180 + avatar.root.rotation.y, el = (v.el * Math.PI) / 180;   // about the avatar's own facing
  camera.position.set(t.x + Math.sin(az) * Math.cos(el) * v.d, t.y + Math.sin(el) * v.d, t.z + Math.cos(az) * Math.cos(el) * v.d);
  controls.target.copy(t); controls.update();
}

// ---- face states (held for stills; "live" releases them) ----
const FACE: Record<string, { close?: number; expr?: Expression }> = { open: { close: 0 }, c25: { close: 0.25 }, c50: { close: 0.5 }, sleepy: { expr: "sleepy" }, closed: { close: 1 }, happy: { expr: "happy" }, live: {} };
const GAZE: Record<string, [number, number] | null> = { center: [0, 0], left: [0.9, 0], right: [-0.9, 0], up: [0, 0.8], down: [0, -0.6], idle: null };
let faceState = "live", gaze = "idle";
function applyFace(): void {
  const f = avatar?.face; if (!f) return; const s = FACE[faceState];
  f.expression = s.expr ?? "neutral"; f.blinking = faceState === "live";
  const look = GAZE[gaze];
  f.hold = faceState === "live" && !look ? null : { ...(s.close !== undefined ? { close: s.close } : {}), ...(look ? { look } : {}) };
}

// ---- layer debug ----
let debug: "off" | "layers" | "wire" | "tex" = "off";   // tex = unlit texture only (texture vs geometry/shading defects)
const LAYER_TINT: Record<string, number> = { identity_head: 0xf2d0b8, identity_hair_scalp: 0x6a5acd, identity_hair_main: 0x2f6fdf, identity_hair_fringe: 0xe0453a, identity_face_twin: 0xf7e3a0, identity_hair_back: 0x2fbf71, identity_hair_base: 0xff9de0, face_eyes: 0xffe066, baked_interior: 0x9a6a4a, baked_skullbase: 0xc08a6a, bodyskin_neckext: 0xff8c00, glasses_frame: 0xff00ff };
const saved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
function applyDebug(): void {
  if (!avatar) return;
  for (const [m, mat] of saved) m.material = mat; saved.clear();
  if (debug === "off") return;
  avatar.root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || !m.name.includes(":")) return; const part = m.name.split(":").pop()!;
    saved.set(m, m.material);
    const tint = Object.entries(LAYER_TINT).find(([k]) => part === k || part.startsWith(k))?.[1] ?? 0xbfbfbf;
    const map = ((Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial).map ?? null;
    if (debug === "tex") { m.material = new THREE.MeshBasicMaterial({ map, color: map ? 0xffffff : tint, side: THREE.DoubleSide, transparent: part === "face_eyes", alphaTest: part === "face_eyes" ? 0.5 : 0 }); return; }
    m.material = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.7, wireframe: debug === "wire", side: THREE.DoubleSide, transparent: part === "face_eyes", opacity: part === "face_eyes" ? 0.55 : 1 }); });
}

// ---- ACCESSORY CONTRACT DEMO (QA only, procedural — not catalogue assets): the future wearable categories placed purely
// from the wearer's semantic anchors (landmarks.attach): a headband conformed to the OUTER hair envelope, earrings at the
// ear lobes, a clip on the hair surface. Skinned rigidly to the identity's Head joint like every head module.
let demo: THREE.SkinnedMesh[] = [];
function demoWearables(on: boolean): Record<string, unknown> | null {
  for (const m of demo) { m.parent?.remove(m); m.geometry.dispose(); } demo = [];
  if (!on || !avatar) return null;
  let host: THREE.SkinnedMesh | null = null; avatar.root.traverse((o) => { const m = o as THREE.SkinnedMesh; if (!host && m.isSkinnedMesh && m.name.endsWith(":identity_head")) host = m; });
  const at = (avatar.identityLandmarks as { attach?: AttachData } | null)?.attach; if (!host || !at) return null;
  const h = host as THREE.SkinnedMesh, hj = h.geometry.getAttribute("skinIndex").getX(0), report: Record<string, unknown> = {};
  const add = (geo: THREE.BufferGeometry, colour: number, name: string, expect: "hair" | "ear") => { const n = geo.getAttribute("position").count;
    geo.setAttribute("skinIndex", new THREE.BufferAttribute(new Uint16Array(n * 4).map((_, k) => (k % 4 === 0 ? hj : 0)), 4)); geo.setAttribute("skinWeight", new THREE.BufferAttribute(new Float32Array(n * 4).map((_, k) => (k % 4 === 0 ? 1 : 0)), 4));
    const m = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.4 })); m.name = `demo:${name}`; m.frustumCulled = false; h.parent!.add(m); m.bind(h.skeleton, h.bindMatrix); demo.push(m);
    report[name] = checkAccessory(geo.getAttribute("position").array, geo.index?.array ?? null, at, expect); };
  // HEADBAND: a band over the crown, ear to ear, conforming to the actual hairstyle (+ 4 mm-eq clearance)
  { const C = new THREE.Vector3(...at.centre), seg = 64, ring = 10, afit: number[] = [], idx: number[] = [];
    for (let i = 0; i <= seg; i++) { const a = -Math.PI * 0.5 + (i / seg) * Math.PI, d = new THREE.Vector3(Math.sin(a), Math.cos(a), 0.18).normalize();
      for (let j = 0; j < ring; j++) { const b = (j / ring) * Math.PI * 2, w = new THREE.Vector3(0, 0, 1).multiplyScalar(Math.cos(b) * 0.06), off = 0.008 + Math.sin(b) * 0.008; const dd = d.clone().add(w).normalize(); afit.push(dd.x, dd.y, dd.z, off); } }
    for (let i = 0; i < seg; i++) for (let j = 0; j < ring; j++) { const a = i * ring + j, b = i * ring + (j + 1) % ring; idx.push(a, a + ring, b, b, a + ring, b + ring); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(fitEnvelopePositions(afit, at, 0.004), 3)); g.setIndex(idx); g.computeVertexNormals(); void C; add(g, 0x2fbf9f, "headband", "hair"); }
  // EARRINGS: a small hoop hanging from each ear lobe
  for (const side of ["l", "r"] as const) { const g = new THREE.TorusGeometry(0.03, 0.006, 8, 24); g.translate(0, -0.042, 0.014); /* hoop plane parallel to the side of the head, hanging from the lobe */ g.applyMatrix4(placeAccessory(at, { region: "ear", side, site: "lobe", scale: 1 }, side)); add(g, 0xe0b44a, `earring-${side}`, "ear"); }
  // HAIR CLIP: on the hair surface above the left temple
  { const g = new THREE.BoxGeometry(0.11, 0.025, 0.018); g.translate(0, 0, 0.01); g.applyMatrix4(placeAccessory(at, { region: "hair", dir: [-0.55, 0.7, 0.45], standoff: 0, scale: 1 })); add(g, 0xd94f70, "clip", "hair"); }
  return report;
}

// ---- behaviours ----
let contacts: HandContacts | null = null, desk: DeskWork | null = null, rider: RiderPose | null = null, tt = 0;
function setMode(m: string): void {
  if (!avatar) return; mode = m;
  if (desk && desk.phase !== "idle") (desk as unknown as { finish(): void }).finish();   // leaving typing: release the seat + hands
  rider?.set(false); avatar.root.position.set(0, 0, 0); avatar.root.rotation.y = 0;
  const idle = idleClip(avatar.config.idleProfile ?? "masculine");
  if (m === "idle" || m === "turn") avatar.play(idle, 0.2);
  if (m === "walk") avatar.play("walking", 0.2);
  if (m === "run") avatar.play("running", 0.2);
  if (m === "sit") avatar.hold("sitting-answering", 0.5, 0.2);
  if (m === "chin") avatar.play("sit-on-chair-arms", 0.2);
  if (m === "agree") avatar.play("agree-gesture", 0.2);
  if (m === "listen") avatar.play("listening-gesture", 0.2);
  if (m === "typing") desk?.start();
  if (m === "scooter") { avatar.root.position.set(scooter.position.x, DECK_TOP, scooter.position.z + 0.3); avatar.hold(idle, 0, 0.2); rider?.set(true); }
  if (!animate) avatar.setTimeScale(0);
}

async function load(w: Who): Promise<void> {
  who = w; const t0 = performance.now();
  if (avatar) { scene.remove(avatar.root); avatar.dispose(); avatar = null; saved.clear(); }
  const cfg = { ...structuredClone(CONFIG[w]), identity: { headAssetId: `qa:${w}` } } as EmployeeAvatar;
  avatar = await HumanAvatar.create(cfg, catalogue);
  avatar.root.traverse((o) => { o.frustumCulled = false; });
  scene.add(avatar.root);
  contacts = new HandContacts(); avatar.addLayer(contacts.layer());
  desk = new DeskWork(avatar, contacts, station, WORKSTATION); avatar.addLayer(desk.layer());
  rider = new RiderPose(avatar.model, RIDER_GRIPS); rider.setScene(avatar.scene); avatar.addLayer({ id: "scooter-rider", order: 30, update: (dt) => rider!.update(dt) });
  avatar.clearance.intentional = (s) => contacts!.w[s] > 0.02 || rider!.weight > 0;
  setMode(mode === "typing" ? "idle" : mode);
  avatar.update(0.016);
  applyFace(); applyDebug(); cam(currentView);
  document.getElementById("label")!.textContent = `${SRC === "v1" ? "V1 SNAPSHOT" : HEAD ? "WORKING HEAD" : "PRODUCTION CANDIDATE"} · ${w}`;
  stats(performance.now() - t0); refresh();
}
function stats(ms = 0): void {
  if (!avatar) return; const s = avatar.stats();
  document.getElementById("stats")!.textContent = `${who} · ${s.triangles.toLocaleString()} tris · ${s.draws} draws${ms ? ` · load ${ms.toFixed(0)} ms` : ""}\n` +
    s.pieces.map((p) => `${p.slot.padEnd(9)} ${String(p.triangles).padStart(7)}  ${p.id}`).join("\n");
}

// ---- GARMENT ↔ SKIN CHECK in the CURRENT pose (CPU skinning of body and garments) ----
// clothInSkin: garment vertices INSIDE a visible (not hidden) body part (cloth cutting into an arm, hand, neck, leg) —
// i.e. skin showing THROUGH the garment there. Hidden regions (under the garment by design) never count.
function garmentCheck(): Record<string, { clothInSkin: number; worst: number }> {
  const a = avatar!; a.root.updateMatrixWorld(true);
  const body = a.body, bg = body.geometry, reg = bg.getAttribute("_region"), mask = a.hideMask, pos = bg.getAttribute("position"), nrm = bg.getAttribute("normal");
  const tol = 0.004 * W, cell = 0.03 * W, v = new THREE.Vector3(), w = new THREE.Vector3(), n = new THREE.Vector3();
  const vis: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
  for (let i = 0; i < pos.count; i++) { const r = Math.round(reg.getX(i)); if (mask & (1 << r)) continue;
    body.getVertexPosition(i, v); body.localToWorld(v);
    w.fromBufferAttribute(pos, i).addScaledVector(n.fromBufferAttribute(nrm, i), 0.01); body.applyBoneTransform(i, w); body.localToWorld(w);
    vis.push({ p: v.clone(), n: w.sub(v).normalize().clone() }); }
  // the identity head's own skin counts too (a collar through the jaw, a hood through the neck)
  a.root.traverse((o) => { const m = o as THREE.SkinnedMesh; const part = m.name.split(":").pop() ?? ""; if (!m.isSkinnedMesh || !m.visible || (part !== "identity_head" && part !== "bodyskin_neckext")) return;
    const hp = m.geometry.getAttribute("position"), hn = m.geometry.getAttribute("normal");
    for (let i = 0; i < hp.count; i++) { m.getVertexPosition(i, v); m.localToWorld(v); w.fromBufferAttribute(hp, i).addScaledVector(n.fromBufferAttribute(hn, i), 0.01); m.applyBoneTransform(i, w); m.localToWorld(w); vis.push({ p: v.clone(), n: w.sub(v).normalize().clone() }); } });
  const grid = new Map<string, number[]>(), key = (p: THREE.Vector3) => `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
  vis.forEach((b, k) => { const kk = key(b.p); (grid.get(kk) ?? grid.set(kk, []).get(kk)!).push(k); });
  const near = (p: THREE.Vector3) => { let best = -1, bd = 1e9; const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const k of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) { const d = vis[k].p.distanceToSquared(p); if (d < bd) { bd = d; best = k; } } return best; };
  const out: Record<string, { clothInSkin: number; worst: number }> = {};
  a.root.traverse((o) => { const m = o as THREE.SkinnedMesh; if (!m.isSkinnedMesh || !/^(top|bottom|shoes):/.test(m.name)) return;
    const gp = m.geometry.getAttribute("position"), gn = m.geometry.getAttribute("normal"), q = new THREE.Vector3(); let inS = 0, worst = 0;
    for (let i = 0; i < gp.count; i++) { m.getVertexPosition(i, v); m.localToWorld(v); const k = near(v); if (k < 0) continue; const b = vis[k], d = w.copy(v).sub(b.p).dot(b.n);
      if (!(d < -tol && b.p.distanceTo(v) < 0.04 * W)) continue;
      // only OUTWARD cloth counts (an inner lining / a turned-in lip lies inside the opening by design and never shows)
      q.fromBufferAttribute(gp, i).addScaledVector(n.fromBufferAttribute(gn, i), 0.01); m.applyBoneTransform(i, q); m.localToWorld(q); if (q.sub(v).dot(b.n) < 0) continue;
      inS++; worst = Math.max(worst, -d / W); }
    out[m.name.split(":").slice(0, 2).join(":")] = { clothInSkin: inS, worst: +worst.toFixed(4) }; });
  return out;
}

// ---- panel ----
const panel = document.getElementById("panel")!;
const el = (tag: string, text = "", cls = "") => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
const rows: { b: HTMLButtonElement; on: () => boolean }[] = [];
function group(title: string, items: [string, () => unknown, () => boolean][]): void {
  panel.append(el("h2", title)); const r = el("div", "", "row");
  for (const [label, act, on] of items) { const b = el("button", label) as HTMLButtonElement; b.onclick = async () => { await act(); refresh(); }; r.append(b); rows.push({ b, on }); }
  panel.append(r);
}
function refresh(): void { for (const { b, on } of rows) b.classList.toggle("on", on()); }
panel.append(el("h1", "HumanBase · production QA"), el("p", "The optimised production candidate with the employee's full configuration. Drag to orbit, scroll to zoom, right-drag to pan. Views follow the avatar (seated, riding, turning).", "sub"));
group("Employee", WHO.map((w) => [w, () => load(w), () => who === w]));
const VG: Record<string, string[]> = { "360°": ["front", "front34L", "front34R", "sideL", "sideR", "rear34L", "rear34R", "back", "high", "lowFront", "lowRear", "under", "full", "fullBack", "fullLow"],
  "Head close": ["eyeFront", "eye34L", "eye34R", "eyeSideL", "eyeSideR", "eyeHigh", "eyeLow", "hairline", "hairline34", "crown", "fringeL", "fringeR", "behindEarL", "behindEarR", "nape", "jawL", "jawR", "chin", "neckJoin", "neckJoinSide", "neckJoinBack"],
  "Body close": ["neck", "neckSide", "neckBack", "collar", "shoulders", "waist", "waistBack", "crotch", "seat", "hands", "sleeves", "ankles", "anklesBack"] };
for (const [t, vs] of Object.entries(VG)) group(t, vs.map((v) => [v, () => cam(v), () => currentView === v]));
group("Behaviour", ["idle", "walk", "run", "turn", "sit", "chin", "typing", "scooter", "agree", "listen"].map((m) => [m, () => { setMode(m); cam(currentView); }, () => mode === m]));
group("Eyes", Object.keys(FACE).map((s) => [s, () => { faceState = s; applyFace(); }, () => faceState === s]));
group("Gaze", Object.keys(GAZE).map((g) => [g, () => { gaze = g; applyFace(); }, () => gaze === g]));
group("Motion", [["animating", () => { animate = !animate; avatar?.setTimeScale(animate ? 1 : 0); }, () => animate], ["hair motion", () => { if (avatar?.hair) avatar.hair.enabled = !avatar.hair.enabled; }, () => !!avatar?.hair?.enabled],
  ["head turn", () => { headTurn = !headTurn; }, () => headTurn]]);
group("Accessories", [["glasses", async () => { if (!avatar) return; const id = avatar.config.glasses.assetId ? null : (CONFIG[who].glasses.assetId ?? "glasses-rect"); await avatar.equip("glasses", id); applyDebug(); stats(); }, () => !!avatar?.config.glasses.assetId],
  ["hair accessories", async () => { if (!avatar) return; const on = avatar.config.accessories.length > 0; await avatar.apply({ ...avatar.config, accessories: on ? [] : CONFIG[who].accessories }); applyDebug(); stats(); }, () => (avatar?.config.accessories.length ?? 0) > 0]]);
group("Debug", (["off", "layers", "wire", "tex"] as const).map((d) => [d, () => { debug = d; applyDebug(); }, () => debug === d]));
group("Checks", [["garment ↔ skin (this pose)", () => { document.getElementById("stats")!.textContent = JSON.stringify(garmentCheck(), null, 1); }, () => false]]);
const st = el("div"); st.id = "stats"; panel.append(st);

let headTurn = false;
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta()); tt += dt;
  if (avatar) {
    if (headTurn) avatar.addLayer({ id: "qa-turn", order: 60, update: () => { const h = avatar!.bones.get("Head"); if (h) { h.rotateY(Math.sin(tt * 1.3) * 0.45); h.rotateX(Math.sin(tt * 0.7) * 0.15); } } });
    else avatar.removeLayer("qa-turn");
    if (mode === "turn" && animate) avatar.root.rotation.y = Math.sin(tt * 0.8) * 1.4;
    avatar.update(animate ? dt : 0);
  }
  controls.update(); renderer.render(scene, camera);
});
await load(who);
Object.assign(window, { __qa: { load, cam, camCustom: (v: { az: number; el: number; d: number; aim?: Aim }) => { QA_VIEWS.__custom = v; cam("__custom"); },
  pick: (px: number, py: number) => { const rc = new THREE.Raycaster(), ndc = new THREE.Vector2((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1); rc.setFromCamera(ndc, camera);
    const vis: THREE.Object3D[] = []; avatar?.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) vis.push(o); }); const h = rc.intersectObjects(vis, false).slice(0, 3);
    return h.map((x) => ({ mesh: x.object.name, face: x.faceIndex, point: x.point.toArray().map((q) => +q.toFixed(3)), dist: +x.distance.toFixed(2) })); }, views: Object.keys(QA_VIEWS), setFace: (s: string, g = "center") => { faceState = s; gaze = g; applyFace(); }, setAnimate: (a: boolean) => { animate = a; avatar?.setTimeScale(a ? 1 : 0); },
  setMode, step: (dt: number) => avatar?.update(dt), garmentCheck, setDebug: (d: typeof debug) => { debug = d; applyDebug(); }, setHeadTurn: (b: boolean) => { headTurn = b; }, wear: async (slot: string, assetId: string | null) => { if (!avatar) return; await avatar.apply({ ...avatar.config, [slot]: { assetId } } as typeof avatar.config); applyDebug(); }, demoWearables: (on: boolean) => demoWearables(on), wearAccessory: async (id: string | null) => { if (!avatar) return; await avatar.apply({ ...avatar.config, accessories: id ? [{ assetId: id }] : [] } as typeof avatar.config); applyDebug(); }, hide: (prefix: string, on = true) => { avatar?.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.name.split(":").pop()!.startsWith(prefix)) m.visible = !on; }); }, stats: () => avatar?.stats(), avatar: () => avatar, ready: true } });
