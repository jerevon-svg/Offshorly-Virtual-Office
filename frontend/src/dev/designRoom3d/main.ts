// Design Room true-3D reconstruction POC — standalone dev page bootstrap.
// Served by Vite in dev only (dev/design-room-3d.html); never bundled into the
// production build (only index.html is an entry). Touches nothing in the app.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { animateSway, buildRoom, countMeshes, swayNodesOf, type BuildOptions } from "./build";
import { Capture, FrameWindow, Overlay, PRESETS, describeDevice, snapshotRenderer, summarize, type CaptureSummary, type PresetId } from "./bench";
import { Avatar, routeMarkers, type AvatarLod, type Ground } from "./avatar";
import { CELL_SIZE, planWalk, roomGridCells, type NavResult } from "./nav";
import { CHAIR_4_SPEC, SeatInteraction } from "./sit";
import { DynamicNav, EditablePlant, dynamicBlockedGround } from "./edit";
import { HERO_PLANT_INDEX } from "./build";
import { ROOM } from "./layout";

const params = {
  // camera: pitch 90 = straight down (the current VO composition); lower reveals faces
  pitch: 52,
  yaw: 0,
  zoom: 1.32,
  // light: azimuth 0 = from the north (top of screen), positive = clockwise; -50 ≈ upper-left
  lightAzimuth: -48,
  lightElevation: 62,
  keyIntensity: 2.3,
  ambientIntensity: 1.25,
  envIntensity: 0.45,
  sway: true,
  shadows: true,
  ao: false, // character proof runs with SSAO off (preset B)
  aoRadius: 14,
  wallHeight: 46,
  frontWall: "low" as BuildOptions["frontWall"],
  exposure: 1.12,
  // benchmark
  overlay: true,
  motion: false, // scripted orbit/pan/zoom for reproducible camera-motion measurements
  preset: "B" as PresetId,
  captureSeconds: 30,
  editMode: false,
  // character proof
  avatar: true,
  avatarLod: 1 as AvatarLod,
  avatarHeight: 36, // world units; bon's manifest sprite box is 37.2 tall, desks are 24
  avatarLit: true,
  routePlay: true,
  walkMode: "auto" as "auto" | "idle" | "walk",
  walkSpeed: 30,
  markers: false,
  // click-to-walk (production grid + A*, read-only)
  clickToWalk: true,
  showGrid: false,
  showBlocked: false,
  showPath: true,
  showDestination: true,
};

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft is deprecated in this three; softness via shadow.radius
renderer.toneMapping = THREE.NeutralToneMapping; // keeps the cream/wood/olive palette instead of ACES' desaturation
renderer.toneMappingExposure = params.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe7ded4);
// soft studio environment: gives glass/metal gentle reflections and the matte
// surfaces a subtle wrap light, without any post-processing
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = params.envIntensity;

const target = new THREE.Vector3(ROOM.width / 2, 8, ROOM.height / 2 - 6);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
const CAM_DIST = 1500;

function placeCamera(): void {
  const pitch = THREE.MathUtils.degToRad(params.pitch);
  const yaw = THREE.MathUtils.degToRad(params.yaw);
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  camera.position.copy(target).addScaledVector(dir, CAM_DIST);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  const aspect = window.innerWidth / window.innerHeight;
  // fit: the room's depth projects to D·sin(pitch) + wall·cos(pitch); pad it
  const halfH = (ROOM.height * 0.62 + 40) / params.zoom;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.left = -halfH * aspect;
  camera.right = halfH * aspect;
  camera.updateProjectionMatrix();
  controls.target.copy(target);
  controls.update();
}

// lights
const hemi = new THREE.HemisphereLight(0xfff4ea, 0xcdb9a6, params.ambientIntensity);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff1e0, params.keyIntensity);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 200;
key.shadow.camera.far = 1600;
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.6;
key.shadow.radius = 4;
key.target.position.set(ROOM.width / 2, 0, ROOM.height / 2);
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0xe4ecff, 0.35);
fill.position.set(ROOM.width, 300, ROOM.height * 1.6);
scene.add(fill);

function placeLight(): void {
  const az = THREE.MathUtils.degToRad(params.lightAzimuth);
  const el = THREE.MathUtils.degToRad(params.lightElevation);
  const d = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  key.position.copy(key.target.position).addScaledVector(d, 800);
  key.intensity = params.keyIntensity;
  hemi.intensity = params.ambientIntensity;
  const s = Math.max(ROOM.width, ROOM.height) * 0.85;
  const sc = key.shadow.camera;
  sc.left = -s;
  sc.right = s;
  sc.top = s;
  sc.bottom = -s;
  sc.updateProjectionMatrix();
  key.shadow.needsUpdate = true;
}

// room
let room = buildRoom({ wallHeight: params.wallHeight, frontWall: params.frontWall });
scene.add(room);
function rebuildRoom(): void {
  scene.remove(room);
  room.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) m.geometry.dispose();
  });
  room = buildRoom({ wallHeight: params.wallHeight, frontWall: params.frontWall });
  scene.add(room);
  seat.reset();
  seat = new SeatInteraction(avatar, findChair(), CHAIR_4_SPEC, (to) => walkToGround(to.x, to.z));
  plant = new EditablePlant("hero-plant", findHeroPlant(), HERO_PLANT_RADIUS, dynNav);
  refreshDynOverlay();
  updateSelRing();
  updateStats();
}

// character proof: one production GLB in the same depth scene as the room
const avatar = new Avatar({ height: params.avatarHeight, lit: params.avatarLit });
avatar.speed = params.walkSpeed;
scene.add(avatar.root);
const markers = routeMarkers();
scene.add(markers);
const avatarState = { status: "loading…", clip: "", position: "", triangles: 0 };
markers.visible = params.markers;

// ---- click-to-walk over the PRODUCTION grid/A* (see nav.ts for the mapping) ----------------
const navState = { last: "click the floor", cells: 0, walkable: 0 };
const navGroup = new THREE.Group();
navGroup.name = "nav-debug";
scene.add(navGroup);
// grid overlay: one instanced quad per cell, coloured by kind
const gridCells = roomGridCells();
navState.cells = gridCells.length;
navState.walkable = gridCells.filter((c) => c.kind !== "blocked").length;
const cellGeo = new THREE.PlaneGeometry(CELL_SIZE - 1.2, CELL_SIZE - 1.2);
cellGeo.rotateX(-Math.PI / 2);
const walkableMesh = new THREE.InstancedMesh(cellGeo, new THREE.MeshBasicMaterial({ color: 0x4caf50, transparent: true, opacity: 0.28, depthWrite: false }), gridCells.length);
const blockedMesh = new THREE.InstancedMesh(cellGeo, new THREE.MeshBasicMaterial({ color: 0xd9463b, transparent: true, opacity: 0.28, depthWrite: false }), gridCells.length);
{
  const m = new THREE.Matrix4();
  let wi = 0, bi = 0;
  for (const c of gridCells) {
    m.makeTranslation(c.centre.x, 0.35, c.centre.z);
    if (c.kind === "blocked") blockedMesh.setMatrixAt(bi++, m);
    else walkableMesh.setMatrixAt(wi++, m);
  }
  walkableMesh.count = wi;
  blockedMesh.count = bi;
  walkableMesh.instanceMatrix.needsUpdate = true;
  blockedMesh.instanceMatrix.needsUpdate = true;
  // stand-here and door cells get a second, brighter tint
  const specialGeo = new THREE.PlaneGeometry(CELL_SIZE * 0.45, CELL_SIZE * 0.45);
  specialGeo.rotateX(-Math.PI / 2);
  const special = new THREE.InstancedMesh(specialGeo, new THREE.MeshBasicMaterial({ color: 0x2f6fd6, transparent: true, opacity: 0.55, depthWrite: false }), gridCells.length);
  let si = 0;
  for (const c of gridCells) {
    if (c.kind !== "stand" && c.kind !== "door") continue;
    m.makeTranslation(c.centre.x, 0.4, c.centre.z);
    special.setMatrixAt(si++, m);
  }
  special.count = si;
  special.instanceMatrix.needsUpdate = true;
  walkableMesh.add(special);
}
walkableMesh.visible = params.showGrid;
blockedMesh.visible = params.showBlocked;
navGroup.add(walkableMesh, blockedMesh);
// path line + destination ring
const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x2f6fd6 }));
pathLine.visible = params.showPath;
const pathDots = new THREE.Group();
navGroup.add(pathLine, pathDots);
const destRing = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.4, 32), new THREE.MeshBasicMaterial({ color: 0x2f6fd6, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
destRing.rotation.x = -Math.PI / 2;
destRing.visible = false;
navGroup.add(destRing);
const dotGeo = new THREE.SphereGeometry(1.1, 10, 8);
const dotMat = new THREE.MeshBasicMaterial({ color: 0x2f6fd6 });
function showNav(result: NavResult): void {
  pathDots.clear();
  if (result.ok) {
    const pts = [avatar.root.position.clone().setY(0.8), ...result.path.map((p) => new THREE.Vector3(p.x, 0.8, p.z))];
    pathLine.geometry.dispose();
    pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    for (const p of result.path) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.position.set(p.x, 0.9, p.z);
      pathDots.add(d);
    }
    destRing.position.set(result.destination.x, 0.6, result.destination.z);
    (destRing.material as THREE.MeshBasicMaterial).color.set(0x2f6fd6);
    destRing.visible = params.showDestination;
    navState.last = `ok → cell ${result.cell.cx},${result.cell.cy} · ${result.path.length} waypoint(s)`;
  } else {
    pathLine.geometry.dispose();
    pathLine.geometry = new THREE.BufferGeometry();
    if (result.destination) {
      destRing.position.set(result.destination.x, 0.6, result.destination.z);
      (destRing.material as THREE.MeshBasicMaterial).color.set(0xd9463b);
      destRing.visible = params.showDestination;
    } else destRing.visible = false;
    navState.last = `rejected: ${result.reason}${result.cell ? ` (cell ${result.cell.cx},${result.cell.cy})` : ""}`;
  }
  pathDots.visible = params.showPath;
}
const raycaster = new THREE.Raycaster();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();
let downAt: { x: number; y: number; t: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  if (e.button === 0) downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || e.button !== 0) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  const held = performance.now() - downAt.t;
  downAt = null;
  if (params.editMode) return; // edit mode: clicks select/move the plant, never walk
  if (moved > 6 || held > 400 || !params.clickToWalk) return; // a drag = orbit, not a walk
  if (seat.ownsAvatar) { navState.last = `ignored: interaction owns Bon (${seat.state})`; return; }
  walkTo(e.clientX, e.clientY);
});
export function walkTo(clientX: number, clientY: number): NavResult | null {
  if (!avatar.gltf) return null;
  const r = canvas.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (!raycaster.ray.intersectPlane(floorPlane, hit)) return null;
  return walkToGround(hit.x, hit.z);
}
export function walkToGround(x: number, z: number): NavResult {
  if (seat && seat.ownsAvatar && seat.state !== "approaching") {
    navState.last = `ignored: interaction owns Bon (${seat.state})`;
    return { ok: false, reason: "outside-room", destination: null, cell: null };
  }
  const result = planWalk(avatar.position, { x, z }, dynNav);
  showNav(result);
  if (result.ok) {
    avatar.playing = true;
    avatar.walkOverride = "auto";
    params.walkMode = "auto";
    avatar.setPath(result.path);
  }
  return result;
}
avatar.onArrive = () => {
  destRing.visible = false;
  pathDots.clear();
  pathLine.geometry.dispose();
  pathLine.geometry = new THREE.BufferGeometry();
};

// ---- chair pull + sit + stand proof (ONE chair, see sit.ts) -----------------------------------
function findChair(): THREE.Object3D {
  const c = room.getObjectByName(CHAIR_4_SPEC.chairId);
  if (!c) throw new Error(`chair ${CHAIR_4_SPEC.chairId} not found in room`);
  return c;
}
let seat = new SeatInteraction(avatar, findChair(), CHAIR_4_SPEC, (to) => walkToGround(to.x, to.z));
const seatState = { state: "idle", chairRestError: 0, note: "clips: idle-9 ↔ sit-on-chair-arms (no transition clip shipped → code-driven blend)" };

// ---- room edit mode (ONE plant) + dynamic walkability overlay (see edit.ts) ------------------
const dynNav = new DynamicNav();
const HERO_PLANT_RADIUS = 8; // pot radius 7.2 + clearance
function findHeroPlant(): THREE.Object3D {
  const g = room.getObjectByName(`plant-${HERO_PLANT_INDEX}`);
  if (!g) throw new Error("hero plant group not found");
  return g;
}
let plant = new EditablePlant("hero-plant", findHeroPlant(), HERO_PLANT_RADIUS, dynNav);
const editState = { selected: "none", placement: "—", drift: 0, blockedCells: 0 };
// selection ring + dynamic-blocked cell overlay
const selRing = new THREE.Mesh(new THREE.RingGeometry(HERO_PLANT_RADIUS - 0.8, HERO_PLANT_RADIUS + 0.6, 40), new THREE.MeshBasicMaterial({ color: 0xf2b134, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
selRing.rotation.x = -Math.PI / 2;
selRing.visible = false;
scene.add(selRing);
const dynGeo = new THREE.PlaneGeometry(CELL_SIZE - 1.2, CELL_SIZE - 1.2);
dynGeo.rotateX(-Math.PI / 2);
const dynMesh = new THREE.InstancedMesh(dynGeo, new THREE.MeshBasicMaterial({ color: 0xf2b134, transparent: true, opacity: 0.5, depthWrite: false }), 64);
dynMesh.visible = params.showBlocked;
scene.add(dynMesh);
function refreshDynOverlay(): void {
  const cells = dynamicBlockedGround(dynNav);
  const m = new THREE.Matrix4();
  cells.slice(0, 64).forEach((c, i) => dynMesh.setMatrixAt(i, m.makeTranslation(c.x, 0.45, c.z)));
  dynMesh.count = Math.min(64, cells.length);
  dynMesh.instanceMatrix.needsUpdate = true;
  editState.blockedCells = cells.length;
}
refreshDynOverlay();
function updateSelRing(): void {
  selRing.visible = params.editMode && plant.selected;
  selRing.position.set(plant.group.position.x, 0.7, plant.group.position.z);
  const v = plant.validate(plant.position);
  (selRing.material as THREE.MeshBasicMaterial).color.set(v.ok ? 0xf2b134 : 0xd9463b);
  editState.placement = v.ok ? (plant.editing ? "valid (unconfirmed)" : "committed") : `invalid: ${v.reason}`;
  editState.drift = Math.round(plant.driftFromCommitted() * 1000) / 1000;
  editState.selected = plant.selected ? plant.id : "none";
}
let dragging = false;
function plantHit(clientX: number, clientY: number): boolean {
  const r = canvas.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObject(plant.group, true).length > 0;
}
function floorPoint(clientX: number, clientY: number): Ground | null {
  const r = canvas.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(floorPlane, hit) ? { x: hit.x, z: hit.z } : null;
}
canvas.addEventListener("pointerdown", (e) => {
  if (!params.editMode || e.button !== 0) return;
  if (plantHit(e.clientX, e.clientY)) {
    plant.selected = true;
    dragging = true;
    controls.enabled = false; // drag moves the plant, not the camera
    e.preventDefault();
  } else if (!plant.editing) plant.selected = false;
  updateSelRing();
});
canvas.addEventListener("pointermove", (e) => {
  if (!params.editMode || !dragging) return;
  const p = floorPoint(e.clientX, e.clientY);
  if (p) plant.preview(p);
  updateSelRing();
});
canvas.addEventListener("pointerup", () => {
  if (dragging) { dragging = false; controls.enabled = true; updateSelRing(); }
});
/** programmatic move (dev console / tests): preview + validate at a ground point */
function movePlantTo(x: number, z: number) {
  plant.selected = true;
  const v = plant.preview({ x, z });
  updateSelRing();
  return v;
}
function confirmPlant() {
  const v = plant.confirm();
  refreshDynOverlay();
  updateSelRing();
  return v;
}
function cancelPlant(): void { plant.cancel(); updateSelRing(); }
function resetPlant(): void { plant.reset(); refreshDynOverlay(); updateSelRing(); }
function loadAvatar(): void {
  avatarState.status = `loading LOD${params.avatarLod}…`;
  avatar
    .load(params.avatarLod)
    .then(() => {
      avatarState.status = `LOD${params.avatarLod} loaded · native height ${avatar.nativeHeight.toFixed(2)} → ${params.avatarHeight} units`;
      avatarState.triangles = Math.round(avatar.triangles);
    })
    .catch((e: unknown) => {
      avatarState.status = `load failed: ${String(e).slice(0, 80)}`;
    });
}
loadAvatar();

// controls (review only — production camera math is untouched)
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = true;
controls.minZoom = 0.4;
controls.maxZoom = 6;

// post: SSAO for contact darkening at wall/floor and object/floor junctions
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ssao = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
ssao.kernelRadius = params.aoRadius;
ssao.minDistance = 0.0005;
ssao.maxDistance = 0.08;
ssao.output = SSAOPass.OUTPUT.Default;
composer.addPass(ssao);
composer.addPass(new OutputPass());

// gui
const gui = new GUI({ title: "Design Room 3D — POC" });
const cam = gui.addFolder("Camera");
cam.add(params, "pitch", 30, 90, 1).name("pitch (90 = top-down)").onChange(placeCamera);
cam.add(params, "yaw", -45, 45, 1).onChange(placeCamera);
cam.add(params, "zoom", 0.5, 3, 0.01).onChange(placeCamera);
cam.add({ reset: () => { params.pitch = 52; params.yaw = 0; params.zoom = 1.32; gui.controllersRecursive().forEach((c) => c.updateDisplay()); placeCamera(); } }, "reset").name("reset view");
const light = gui.addFolder("Light");
light.add(params, "lightAzimuth", -180, 180, 1).name("azimuth (−48 = upper-left)").onChange(placeLight);
light.add(params, "lightElevation", 15, 85, 1).onChange(placeLight);
light.add(params, "keyIntensity", 0, 5, 0.05).onChange(placeLight);
light.add(params, "ambientIntensity", 0, 3, 0.05).onChange(placeLight);
light.add(params, "envIntensity", 0, 1.5, 0.05).name("environment").onChange((v: number) => (scene.environmentIntensity = v));
light.add(params, "exposure", 0.5, 1.6, 0.01).onChange((v: number) => (renderer.toneMappingExposure = v));
function applyShadows(v: boolean): void {
  renderer.shadowMap.enabled = v;
  room.traverse((o) => { const mm = (o as THREE.Mesh).material as THREE.Material | undefined; if (mm) mm.needsUpdate = true; });
}
light.add(params, "shadows").onChange(applyShadows);
light.add(params, "ao").name("ambient occlusion (SSAO)");
light.add(params, "aoRadius", 2, 40, 0.5).onChange((v: number) => (ssao.kernelRadius = v));
const geo = gui.addFolder("Geometry");
geo.add(params, "wallHeight", 20, 110, 1).onFinishChange(rebuildRoom);
geo.add(params, "frontWall", ["low", "full", "hidden"]).onChange(rebuildRoom);
geo.add(params, "sway").name("hero plant sway");
const av = gui.addFolder("Character (production GLB)");
av.add(params, "avatar").name("show avatar").onChange((v: boolean) => (avatar.root.visible = v));
av.add(params, "avatarLod", [0, 1, 2]).name("LOD (0 = 280k tris)").onChange(loadAvatar);
av.add(params, "avatarHeight", 24, 48, 0.5).name("standing height").onChange((v: number) => avatar.setHeight(v));
av.add(params, "avatarLit").name("lit (off = production unlit)").onChange((v: boolean) => avatar.setLit(v));
av.add(params, "routePlay").name("▶ play / ⏸ pause").onChange((v: boolean) => (avatar.playing = v));
av.add({ demo: () => { avatar.resetRoute(true); } }, "demo").name("start scripted demo route");
av.add(params, "walkMode", ["auto", "idle", "walk"]).name("animation").onChange((v: "auto" | "idle" | "walk") => (avatar.walkOverride = v));
av.add(params, "walkSpeed", 8, 70, 1).name("speed (units/s)").onChange((v: number) => (avatar.speed = v));
av.add(params, "markers").name("waypoint markers").onChange((v: boolean) => (markers.visible = v));
av.add({ reset: () => { avatar.resetRoute(false); showNav({ ok: false, reason: "outside-room", destination: null, cell: null }); destRing.visible = false; navState.last = "reset"; } }, "reset").name("reset character");
const sitGui = gui.addFolder("Chair interaction (design-member-chair-4)");
sitGui.add({ sit: () => { const r = seat.sit(); if (r && !r.ok) seatState.state = seat.status; } }, "sit").name("▶ Sit");
sitGui.add({ stand: () => seat.stand() }, "stand").name("▶ Stand");
sitGui.add({ reset: () => seat.reset() }, "reset").name("reset interaction");
sitGui.add(seatState, "state").disable().listen();
sitGui.add(seatState, "chairRestError").disable().listen();
sitGui.add(seatState, "note").disable();
const editGui = gui.addFolder("Room edit mode (hero plant only)");
editGui.add(params, "editMode").name("✎ edit mode").onChange((v: boolean) => { if (!v) { if (plant.editing) plant.cancel(); plant.selected = false; } updateSelRing(); });
editGui.add({ confirm: () => { const v = confirmPlant(); editState.placement = v.ok ? "committed" : `rejected: ${v.reason}`; } }, "confirm").name("✔ confirm placement");
editGui.add({ cancel: cancelPlant }, "cancel").name("✖ cancel (revert to committed)");
editGui.add({ reset: resetPlant }, "reset").name("reset to original");
editGui.add(editState, "selected").disable().listen();
editGui.add(editState, "placement").disable().listen();
editGui.add(editState, "drift").disable().listen();
editGui.add(editState, "blockedCells").name("dynamic blocked cells").disable().listen();
const nav = gui.addFolder("Click-to-walk (production grid + A*)");
nav.add(params, "clickToWalk").name("left-click floor → walk");
nav.add(params, "showGrid").name("show walkable grid").onChange((v: boolean) => (walkableMesh.visible = v));
nav.add(params, "showBlocked").name("show blocked cells").onChange((v: boolean) => { blockedMesh.visible = v; dynMesh.visible = v; });
nav.add(params, "showPath").name("show A* path").onChange((v: boolean) => { pathLine.visible = v; pathDots.visible = v; });
nav.add(params, "showDestination").name("show destination").onChange((v: boolean) => { if (!v) destRing.visible = false; });
nav.add(navState, "last").disable().listen();
nav.add(navState, "cells").disable();
nav.add(navState, "walkable").disable();
av.add(avatarState, "status").disable().listen();
av.add(avatarState, "clip").disable().listen();
av.add(avatarState, "position").disable().listen();
av.add(avatarState, "triangles").disable().listen();
const stats = { meshes: 0, triangles: 0, materials: 0, drawCalls: 0, fps: 0 };

// ---- benchmark -------------------------------------------------------------------------
const device = describeDevice(renderer);
const overlay = new Overlay(document.body);
const liveWindow = new FrameWindow(3000);
let capture: Capture | null = null;
let lastCapture: CaptureSummary | null = null;
const benchState = { status: "idle", result: "" };
function applyPreset(id: PresetId): void {
  const pr = PRESETS.find((x) => x.id === id)!;
  params.preset = id;
  params.shadows = pr.shadows;
  params.ao = pr.ao;
  params.sway = pr.sway;
  applyShadows(pr.shadows);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}
function runCapture(seconds = params.captureSeconds): Promise<CaptureSummary> {
  capture = new Capture(seconds);
  benchState.status = `capturing ${seconds}s · preset ${params.preset}${params.motion ? " · motion" : " · idle"}`;
  return capture.done.then((r) => {
    lastCapture = r;
    capture = null;
    benchState.status = "idle";
    benchState.result = `${params.preset}${params.motion ? "/motion" : "/idle"}: ${r.avgFps} fps · med ${r.medianFrameMs} ms · p95 ${r.p95FrameMs} ms · worst ${r.worstFrameMs} ms · calls ${r.avgDrawCalls}`;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    return r;
  });
}
const bench = gui.addFolder("Benchmark");
bench.add(params, "overlay").name("stats overlay").onChange((v: boolean) => (overlay.visible = v));
bench.add(params, "preset", PRESETS.map((p) => p.id)).name("preset (A full · B no SSAO · C no SSAO/shadows · D no SSAO/sway)").onChange(applyPreset);
bench.add(params, "motion").name("scripted camera motion");
bench.add(params, "captureSeconds", 5, 60, 5);
bench.add({ run: () => void runCapture() }, "run").name("▶ run capture");
bench.add(benchState, "status").disable().listen();
bench.add(benchState, "result").disable().listen();
// scripted orbit/pan/zoom: deterministic, covers yaw ±22°, pitch 44–60°, zoom 1.05–1.9
function scriptedMotion(t: number): void {
  params.yaw = Math.sin(t * 0.45) * 22;
  params.pitch = 52 + Math.sin(t * 0.31 + 1) * 8;
  params.zoom = 1.45 + Math.sin(t * 0.23 + 2) * 0.45;
  target.x = ROOM.width / 2 + Math.sin(t * 0.19) * 30;
  target.z = ROOM.height / 2 - 6 + Math.cos(t * 0.17) * 22;
  placeCamera();
}
let lastFrameTime = performance.now();
let overlayTick = 0;
const info = gui.addFolder("Stats");
const meshCtl = info.add(stats, "meshes").disable();
const triCtl = info.add(stats, "triangles").disable();
const matCtl = info.add(stats, "materials").disable();
const callCtl = info.add(stats, "drawCalls").disable();
const fpsCtl = info.add(stats, "fps").disable();
function updateStats(): void {
  const c = countMeshes(room);
  stats.meshes = c.meshes;
  stats.triangles = c.triangles;
  stats.materials = c.materials;
  meshCtl.updateDisplay();
  triCtl.updateDisplay();
  matCtl.updateDisplay();
}
updateStats();

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  ssao.setSize(window.innerWidth, window.innerHeight);
  placeCamera();
}
window.addEventListener("resize", resize);
placeLight();
resize();

let frames = 0, last = performance.now();
const clock = new THREE.Timer();
renderer.info.autoReset = false; // count the whole frame (shadow + scene + AO passes), not just the last pass
function loop(): void {
  requestAnimationFrame(loop);
  renderer.info.reset();
  const now0 = performance.now();
  const dt = Math.min(250, now0 - lastFrameTime);
  lastFrameTime = now0;
  const t = clock.update().getElapsed();
  if (params.motion) scriptedMotion(t);
  controls.update();
  if (params.sway) animateSway(swayNodesOf(room), t);
  if (params.avatar) {
    seat.update(dt / 1000);
    seatState.state = seat.status;
    seatState.chairRestError = Math.round(seat.chairRestError() * 1000) / 1000;
    avatar.update(dt / 1000);
    avatarState.clip = avatar.currentClip ?? "";
    avatarState.position = `${avatar.root.position.x.toFixed(0)}, ${avatar.root.position.z.toFixed(0)}${avatar.moving ? ` → ${avatar.path.length} waypoint(s) left` : " · arrived"}`;
  }
  if (params.ao) composer.render();
  else renderer.render(scene, camera);
  const sample = { dt, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  liveWindow.push(sample);
  capture?.push(sample);
  overlayTick += dt;
  if (overlayTick > 250 && params.overlay) {
    overlayTick = 0;
    overlay.update(liveWindow.summary(), snapshotRenderer(renderer), device, `avatar ${params.avatar ? `on · LOD${params.avatarLod} · ${avatarState.triangles.toLocaleString()} tris · ${avatarState.clip}` : "off"}\n${benchState.status}${lastCapture ? "\nlast: " + benchState.result : ""}`);
  }
  frames++;
  const now = performance.now();
  if (now - last > 1000) {
    stats.fps = Math.round((frames * 1000) / (now - last));
    stats.drawCalls = renderer.info.render.calls;
    fpsCtl.updateDisplay();
    callCtl.updateDisplay();
    frames = 0;
    last = now;
  }
}
loop();

// expose for the review console / screenshots
(window as unknown as { __designRoom3d: unknown }).__designRoom3d = {
  scene, camera, renderer, params, stats, placeCamera, placeLight, rebuildRoom,
  bench: { device, applyPreset, runCapture, snapshot: () => snapshotRenderer(renderer), live: () => liveWindow.summary(), summarize },
  avatar, avatarState, markers, nav: { walkTo, walkToGround, navState, planWalk },
  get seat() { return seat; }, seatState,
  edit: { get plant() { return plant; }, dynNav, editState, movePlantTo, confirmPlant, cancelPlant, resetPlant },
};
