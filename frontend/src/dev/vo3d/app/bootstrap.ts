// vo3d app — wires world → nav → render → avatar → interactions → editor → devtools. Dev-only entry.
import * as THREE from "three";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { WorldState } from "../world/WorldState";
import { DESIGN_ROOM, DESIGN_SOLIDS, CHAIR_4_ID, HERO_PLANT_ID, designRoomEntities } from "../rooms/design-room";
import { Walkability } from "../nav/Walkability";
import { planWalk, type NavResult } from "../nav/planner";
import { v1Static } from "../adapters/v1Grid";
import { Renderer } from "../render/Renderer";
import { SceneMirror } from "../render/SceneMirror";
import { Avatar } from "../avatar/Avatar";
import { ControllerStack, NavigationController } from "../avatar/Controller";
import { SeatInteraction } from "../interact/Seat";
import { EditSession } from "../editor/EditSession";
import { NavDebug } from "../devtools/NavDebug";
import { Capture, FrameWindow, Overlay, PRESETS, describeDevice, snapshotRenderer, summarize, type CaptureSummary, type PresetId } from "../devtools/Bench";
import { BON_STANDING_HEIGHT, type AvatarLod } from "../adapters/v1Avatar";
import { pointInRect, type Vec2 } from "../core/coords";

// ---- world -------------------------------------------------------------------------------------
const world = new WorldState();
world.addRoom(DESIGN_ROOM);
for (const e of designRoomEntities()) world.addEntity(e);
// baked decor solids (visual comes from the shell builder) participate in placement as footprint-only entities
DESIGN_SOLIDS.forEach((r, i) =>
  world.addEntity({ id: `${DESIGN_ROOM.id}/solid-${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {}, source: { baked: true } }),
);
const inBounds = (p: Vec2): boolean => [...world.rooms.values()].some((r) => pointInRect(p, r.floorRect));

// ---- nav ---------------------------------------------------------------------------------------
const walkability = new Walkability(v1Static);
walkability.syncFromWorld(world);

// ---- render ------------------------------------------------------------------------------------
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const params = {
  pitch: 52, yaw: 0, zoom: 1.32,
  lightAzimuth: -48, lightElevation: 62, keyIntensity: 2.3, ambientIntensity: 1.25, envIntensity: 0.45, exposure: 1.12,
  shadows: true, ao: false, sway: true, wallHeight: DESIGN_ROOM.shell.wallHeight, frontWall: "low" as "low" | "full" | "hidden",
  overlay: true, motion: false, preset: "B" as PresetId, captureSeconds: 30,
  avatar: true, avatarLod: 1 as AvatarLod, avatarLit: true, walkSpeed: 30,
  clickToWalk: true, showGrid: false, showBlocked: false, showPath: true, showDestination: true,
  editMode: false,
};
const R = new Renderer(canvas, DESIGN_ROOM.rect);
const mirror = new SceneMirror(world, R.scene);
mirror.buildRoom(DESIGN_ROOM, { wallHeight: params.wallHeight, frontWall: params.frontWall });
// solids have no builder: skip them in the mirror by giving them no view (buildEntity would throw) — filtered here
// (they are never rendered; the baked group already draws them)

// ---- avatar + ownership ------------------------------------------------------------------------
const avatar = new Avatar({ height: BON_STANDING_HEIGHT, lit: params.avatarLit });
R.scene.add(avatar.root);
const stack = new ControllerStack();
const navCtl = new NavigationController(avatar, stack);
const avatarState = { status: "loading…", clip: "", position: "", owner: "Idle", triangles: 0 };
function loadAvatar(): void {
  avatarState.status = `loading LOD${params.avatarLod}…`;
  avatar.load(params.avatarLod).then(() => {
    avatarState.status = `LOD${params.avatarLod} loaded · native ${avatar.nativeHeight.toFixed(2)} → ${BON_STANDING_HEIGHT} units`;
    avatarState.triangles = Math.round(avatar.triangles);
  }).catch((e: unknown) => { avatarState.status = `load failed: ${String(e).slice(0, 80)}`; });
}
const chairSeat = world.get(CHAIR_4_ID).capabilities.seat!;
avatar.setPosition(chairSeat.approach);
avatar.setYaw(Math.PI / 2);
loadAvatar();

// ---- devtools: nav debug, overlay, bench -------------------------------------------------------
const navDebug = new NavDebug(R.scene, [DESIGN_ROOM.floorRect], 8);
navDebug.refreshDynamic(walkability);
const navState = { last: "click the floor", cells: navDebug.cells, walkable: navDebug.walkable };
const device = describeDevice(R.renderer);
const overlay = new Overlay(document.body);
const liveWindow = new FrameWindow(3000);
let capture: Capture | null = null;
let lastCapture: CaptureSummary | null = null;
const benchState = { status: "idle", result: "" };

// ---- interactions -------------------------------------------------------------------------------
function walkToGround(x: number, z: number): NavResult {
  if (stack.owner === "Interaction" || stack.owner === "Editor") {
    navState.last = `ignored: avatar owned by ${stack.owner}`;
    return { ok: false, reason: "outside-room", destination: null, cell: null };
  }
  const result = planWalk(avatar.position, { x, z }, walkability, inBounds);
  navDebug.showNav(avatar.position, result);
  navState.last = result.ok ? `ok → cell ${result.cell.cx},${result.cell.cy} · ${result.path.length} waypoint(s)` : `rejected: ${result.reason}`;
  if (result.ok) navCtl.setPath(result.path);
  return result;
}
navCtl.onArrive = () => navDebug.clearNav();
let seat = new SeatInteraction(avatar, stack, mirror.view(CHAIR_4_ID), chairSeat, (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
const seatState = { state: "idle", chairRestError: 0 };
const edit = new EditSession(world, mirror, walkability, stack);
const editState = { selected: "none", placement: "—", drift: 0, blockedCells: walkability.dynamicBlockedKeys.length };
function refreshEditVisuals(): void {
  const pos = edit.currentPos();
  const v = edit.validateCurrent();
  navDebug.showSelection(edit.editMode && edit.selected ? pos : null, v.ok);
  editState.selected = edit.selected ?? "none";
  editState.placement = !edit.selected ? "—" : v.ok ? (edit.previewing ? "valid (unconfirmed)" : "committed") : `invalid: ${v.reason}`;
  editState.drift = Math.round(edit.drift() * 1000) / 1000;
  editState.blockedCells = navDebug.refreshDynamic(walkability);
}

// ---- pointer: click-to-walk vs orbit drag vs edit drag ------------------------------------------
const raycaster = new THREE.Raycaster();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();
function floorPoint(cx: number, cy: number): Vec2 | null {
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, R.camera);
  return raycaster.ray.intersectPlane(floorPlane, hit) ? { x: hit.x, z: hit.z } : null;
}
let downAt: { x: number; y: number; t: number } | null = null;
let dragging = false;
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (edit.editMode) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, R.camera);
    const hitEntity = edit.editable().find((en) => raycaster.intersectObject(mirror.view(en.id), true).length > 0);
    if (hitEntity) { edit.select(hitEntity.id); dragging = true; R.controls.enabled = false; e.preventDefault(); }
    else if (!edit.previewing) edit.select(null);
    refreshEditVisuals();
    return;
  }
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener("pointermove", (e) => {
  if (!edit.editMode || !dragging) return;
  const p = floorPoint(e.clientX, e.clientY);
  if (p) edit.preview(p);
  refreshEditVisuals();
});
canvas.addEventListener("pointerup", (e) => {
  if (dragging) { dragging = false; R.controls.enabled = true; refreshEditVisuals(); return; }
  if (!downAt || e.button !== 0) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y), held = performance.now() - downAt.t;
  downAt = null;
  if (moved > 6 || held > 400 || !params.clickToWalk) return; // a drag = orbit, not a walk
  const p = floorPoint(e.clientX, e.clientY);
  if (p) walkToGround(p.x, p.z);
});

// ---- GUI -------------------------------------------------------------------------------------------
const gui = new GUI({ title: "VO 3D — V2 (Design Room)" });
const refresh = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());
const cam = gui.addFolder("Camera");
const applyCam = () => { R.camParams = { pitch: params.pitch, yaw: params.yaw, zoom: params.zoom }; R.placeCamera(); };
cam.add(params, "pitch", 30, 90, 1).onChange(applyCam); cam.add(params, "yaw", -45, 45, 1).onChange(applyCam); cam.add(params, "zoom", 0.5, 3, 0.01).onChange(applyCam);
cam.add({ reset: () => { params.pitch = 52; params.yaw = 0; params.zoom = 1.32; refresh(); applyCam(); } }, "reset").name("reset view");
const light = gui.addFolder("Light");
const applyLight = () => { R.lightParams = { azimuth: params.lightAzimuth, elevation: params.lightElevation, keyIntensity: params.keyIntensity, ambientIntensity: params.ambientIntensity, envIntensity: params.envIntensity, exposure: params.exposure }; R.placeLight(); };
light.add(params, "lightAzimuth", -180, 180, 1).onChange(applyLight); light.add(params, "lightElevation", 15, 85, 1).onChange(applyLight);
light.add(params, "keyIntensity", 0, 5, 0.05).onChange(applyLight); light.add(params, "ambientIntensity", 0, 3, 0.05).onChange(applyLight);
light.add(params, "envIntensity", 0, 1.5, 0.05).onChange(applyLight); light.add(params, "exposure", 0.5, 1.6, 0.01).onChange(applyLight);
light.add(params, "shadows").onChange((v: boolean) => R.setShadows(v)); light.add(params, "ao").name("SSAO (off by default)").onChange((v: boolean) => (R.ssaoEnabled = v));
const geo = gui.addFolder("Geometry");
const rebuild = () => { seat.reset(); mirror.rebuildRoom(DESIGN_ROOM, { wallHeight: params.wallHeight, frontWall: params.frontWall }); seat = new SeatInteraction(avatar, stack, mirror.view(CHAIR_4_ID), chairSeat, (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed); };
geo.add(params, "wallHeight", 20, 110, 1).onFinishChange(rebuild); geo.add(params, "frontWall", ["low", "full", "hidden"]).onChange(rebuild);
geo.add(params, "sway").name("plant sway").onChange((v: boolean) => (mirror.sway.enabled = v));
const av = gui.addFolder("Character (production GLB)");
av.add(params, "avatar").name("show avatar").onChange((v: boolean) => (avatar.root.visible = v));
av.add(params, "avatarLod", [0, 1, 2]).name("LOD").onChange(loadAvatar);
av.add(params, "avatarLit").name("lit (off = production unlit)").onChange((v: boolean) => avatar.setLit(v));
av.add(params, "walkSpeed", 8, 70, 1).name("speed (units/s)").onChange((v: number) => (navCtl.speed = v));
av.add(avatarState, "status").disable().listen(); av.add(avatarState, "clip").disable().listen(); av.add(avatarState, "position").disable().listen(); av.add(avatarState, "owner").name("controller owner").disable().listen();
const sitGui = gui.addFolder("Chair interaction (design-member-chair-4)");
sitGui.add({ sit: () => { const r = seat.sit(); if (r && !r.ok) seatState.state = seat.status; } }, "sit").name("▶ Sit");
sitGui.add({ stand: () => seat.stand() }, "stand").name("▶ Stand");
sitGui.add({ reset: () => seat.reset() }, "reset").name("reset interaction");
sitGui.add(seatState, "state").disable().listen(); sitGui.add(seatState, "chairRestError").disable().listen();
const editGui = gui.addFolder("Room edit mode (hero plant only)");
editGui.add(params, "editMode").name("✎ edit mode").onChange((v: boolean) => { edit.setEditMode(v); if (v) edit.select(HERO_PLANT_ID); refreshEditVisuals(); });
editGui.add({ confirm: () => { const v = edit.confirm(); editState.placement = v.ok ? "committed" : `rejected: ${v.reason}`; refreshEditVisuals(); } }, "confirm").name("✔ confirm placement");
editGui.add({ cancel: () => { edit.cancel(); refreshEditVisuals(); } }, "cancel").name("✖ cancel (revert to committed)");
editGui.add({ reset: () => { edit.reset(); refreshEditVisuals(); } }, "reset").name("reset to original");
editGui.add(editState, "selected").disable().listen(); editGui.add(editState, "placement").disable().listen(); editGui.add(editState, "drift").disable().listen(); editGui.add(editState, "blockedCells").name("dynamic blocked cells").disable().listen();
const nav = gui.addFolder("Click-to-walk (V1 grid + composed walkability)");
nav.add(params, "clickToWalk").name("left-click floor → walk");
nav.add(params, "showGrid").name("show walkable grid").onChange((v: boolean) => (navDebug.showGrid = v));
nav.add(params, "showBlocked").name("show blocked cells").onChange((v: boolean) => (navDebug.showBlocked = v));
nav.add(params, "showPath").name("show path").onChange((v: boolean) => (navDebug.showPath = v));
nav.add(params, "showDestination").name("show destination").onChange((v: boolean) => (navDebug.showDestination = v));
nav.add(navState, "last").disable().listen(); nav.add(navState, "cells").disable(); nav.add(navState, "walkable").disable();
const bench = gui.addFolder("Benchmark");
function applyPreset(id: PresetId): void {
  const pr = PRESETS.find((x) => x.id === id)!;
  params.preset = id; params.shadows = pr.shadows; params.ao = pr.ao; params.sway = pr.sway;
  R.setShadows(pr.shadows); R.ssaoEnabled = pr.ao; mirror.sway.enabled = pr.sway; refresh();
}
function runCapture(seconds = params.captureSeconds): Promise<CaptureSummary> {
  capture = new Capture(seconds);
  benchState.status = `capturing ${seconds}s · preset ${params.preset}${params.motion ? " · motion" : " · idle"}`;
  return capture.done.then((r) => { lastCapture = r; capture = null; benchState.status = "idle"; benchState.result = `${params.preset}${params.motion ? "/motion" : "/idle"}: ${r.avgFps} fps · med ${r.medianFrameMs} ms · p95 ${r.p95FrameMs} ms · worst ${r.worstFrameMs} ms · calls ${r.avgDrawCalls}`; refresh(); return r; });
}
bench.add(params, "overlay").name("stats overlay").onChange((v: boolean) => (overlay.visible = v));
bench.add(params, "preset", PRESETS.map((p) => p.id)).name("preset (A full · B no SSAO · C no SSAO/shadows · D no SSAO/sway)").onChange(applyPreset);
bench.add(params, "motion").name("scripted camera motion"); bench.add(params, "captureSeconds", 5, 60, 5);
bench.add({ run: () => void runCapture() }, "run").name("▶ run capture");
bench.add(benchState, "status").disable().listen(); bench.add(benchState, "result").disable().listen();
function scriptedMotion(t: number): void {
  params.yaw = Math.sin(t * 0.45) * 22; params.pitch = 52 + Math.sin(t * 0.31 + 1) * 8; params.zoom = 1.45 + Math.sin(t * 0.23 + 2) * 0.45;
  R.target.x = DESIGN_ROOM.rect.x + DESIGN_ROOM.rect.w / 2 + Math.sin(t * 0.19) * 30; R.target.z = DESIGN_ROOM.rect.z + DESIGN_ROOM.rect.d / 2 - 6 + Math.cos(t * 0.17) * 22;
  applyCam();
}

// ---- loop --------------------------------------------------------------------------------------------
const clock = new THREE.Timer();
let lastFrame = performance.now();
let overlayTick = 0;
function loop(): void {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(250, now - lastFrame);
  lastFrame = now;
  const t = clock.update().getElapsed();
  if (params.motion) scriptedMotion(t);
  mirror.sway.update(t);
  if (params.avatar) {
    seat.update(dt / 1000);
    navCtl.update(dt / 1000);
    avatar.update(dt / 1000);
    seatState.state = seat.status;
    seatState.chairRestError = Math.round(seat.chairRestError() * 1000) / 1000;
    avatarState.clip = avatar.currentClip ?? "";
    avatarState.owner = stack.owner;
    const p = avatar.worldPosition();
    avatarState.position = `${p.x.toFixed(0)}, ${p.z.toFixed(0)}${navCtl.moving ? ` → ${navCtl.path.length} waypoint(s) left` : ""}`;
  }
  R.render();
  const sample = { dt, calls: R.renderer.info.render.calls, triangles: R.renderer.info.render.triangles };
  liveWindow.push(sample); capture?.push(sample);
  overlayTick += dt;
  if (overlayTick > 250 && params.overlay) {
    overlayTick = 0;
    overlay.update(liveWindow.summary(), snapshotRenderer(R.renderer), device, `V2 · avatar ${params.avatar ? `LOD${params.avatarLod} · ${avatarState.triangles.toLocaleString()} tris · ${avatarState.clip} · owner ${stack.owner}` : "off"}\n${benchState.status}${lastCapture ? "\nlast: " + benchState.result : ""}`);
  }
}
loop();

// dev console / test-driver surface (same shape as the prototype's __designRoom3d where it matters)
(window as unknown as { __vo3d: unknown }).__vo3d = {
  world, walkability, mirror, R, scene: R.scene, camera: R.camera, renderer: R.renderer, params, stack, avatar, avatarState, navCtl,
  placeCamera: applyCam, placeLight: applyLight,
  bench: { device, applyPreset, runCapture, snapshot: () => snapshotRenderer(R.renderer), live: () => liveWindow.summary(), summarize },
  nav: { walkToGround, navState, planWalk: (from: Vec2, to: Vec2) => planWalk(from, to, walkability, inBounds) },
  get seat() { return seat; }, seatState,
  edit: { session: edit, editState, movePlantTo: (x: number, z: number) => { edit.setEditMode(true); edit.select(HERO_PLANT_ID); const v = edit.preview({ x, z }); refreshEditVisuals(); return v; }, confirm: () => { const v = edit.confirm(); refreshEditVisuals(); return v; }, cancel: () => { edit.cancel(); refreshEditVisuals(); }, reset: () => { edit.reset(); refreshEditVisuals(); }, setEditMode: (v: boolean) => { params.editMode = v; edit.setEditMode(v); if (v) edit.select(HERO_PLANT_ID); refreshEditVisuals(); refresh(); } },
};
