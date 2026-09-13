// vo3d app — wires world → nav → render → avatar → interactions → editor → devtools. Dev-only entry.
import * as THREE from "three";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { WorldState } from "../world/WorldState";
import { DESIGN_ROOM, DESIGN_SOLIDS, CHAIR_4_ID, DOOR_ID, HERO_PLANT_ID, SHELL as DESIGN_SHELL, designRoomEntities } from "../rooms/design-room";
import { RECEPTION_ROOM, COUNTER_INTERACTION_ID, ENTRY_DOOR_EAST_ID, ENTRY_DOOR_WEST_ID, ENTRY_SCANNER_ID, ENTRY_ZONE, GATE_SCANNER_IDS, GATE_ZONES, KIOSK_INTERACTION_ID, LOUNGE_SEAT_IDS, receptionEntities } from "../rooms/reception";
import { NORTH_STRIP as MEETING_NORTH_STRIP } from "../rooms/meeting";
import { NORTH_STRIP as PROJECT_NORTH_STRIP } from "../rooms/project";
import { GAMING_ROOM, NORTH_STRIP as GAMING_NORTH_STRIP, WEST_STRIP as GAMING_WEST_STRIP, gamingRoomEntities,
  BAG_SEAT_IDS, DARTS_INTERACTION_ID, DOOR_LEAF_ID as GAMING_DOOR_ID, FRIDGE_INTERACTION_ID, GAMING_CHAIR_IDS,
  POSTER_INTERACTION_ID, SOFA_SEAT_ID, TV_INTERACTION_ID as GAMING_TV_INTERACTION_ID } from "../rooms/gaming";
import { CENTRAL_HUB, OPEN_BANDS as HUB_OPEN_BANDS, centralHubEntities,
  CAFE_CHAIR_IDS, COUNTER_INTERACTION_ID as HUB_COUNTER_ID, HUB_LOUNGE_IDS,
  MONUMENT_INTERACTION_ID as HUB_MONUMENT_ID, SHELF_INTERACTION_ID as HUB_SHELF_ID, TOUCAN_PERCH } from "../rooms/central-hub";
import { loadBossStatues } from "../build/hub-monument";
import { openedCells, openedLayer, v2Static } from "../nav/v2Open";
import { MEETING_ROOM, MEETING_CHAIR_IDS, KIOSK_INTERACTION_ID as MEETING_KIOSK_INTERACTION_ID, KIOSK_SCANNER_ID as MEETING_KIOSK_SCANNER_ID, KIOSK_ZONE as MEETING_KIOSK_ZONE, meetingRoomEntities } from "../rooms/meeting";
import { PROJECT_ROOM, CONSOLE_INTERACTION_ID, SOFA_SEAT_IDS, TUB_SEAT_IDS, TV_INTERACTION_ID, projectRoomEntities } from "../rooms/project";
import { ApproachInteraction } from "../interact/Approach";
import { LoungeSeatInteraction } from "../interact/LoungeSeat";
import { Walkability, composeStatic } from "../nav/Walkability";
import { clearanceLayer, worldClearances } from "../nav/clearance";
import { SlidingDoor } from "../interact/Door";
import { registerGroundFloor } from "../rooms/ground-floor";
import { planWalk, type NavResult } from "../nav/planner";
import { v1Static } from "../adapters/v1Grid";
import { Renderer } from "../render/Renderer";
import { SceneMirror } from "../render/SceneMirror";
import { Avatar } from "../avatar/Avatar";
import { ControllerStack, NavigationController } from "../avatar/Controller";
import { SeatInteraction } from "../interact/Seat";
import { EditSession } from "../editor/EditSession";
import { NavDebug } from "../devtools/NavDebug";
import { Capture, FrameWindow, Overlay, PRESETS, describeDevice, sceneStats, snapshotRenderer, summarize, type CaptureSummary, type PresetId } from "../devtools/Bench";
import { BON_STANDING_HEIGHT, type AvatarLod } from "../adapters/v1Avatar";
import { pointInRect, type Rect, type Vec2 } from "../core/coords";

// ---- world -------------------------------------------------------------------------------------
const world = new WorldState();
world.addRoom(DESIGN_ROOM);
world.addRoom(RECEPTION_ROOM);
world.addRoom(MEETING_ROOM);
world.addRoom(PROJECT_ROOM);
world.addRoom(GAMING_ROOM);
world.addRoom(CENTRAL_HUB);
for (const e of designRoomEntities()) world.addEntity(e);
for (const e of receptionEntities()) world.addEntity(e);
for (const e of meetingRoomEntities()) world.addEntity(e);
for (const e of projectRoomEntities()) world.addEntity(e);
for (const e of gamingRoomEntities()) world.addEntity(e);
for (const e of centralHubEntities()) world.addEntity(e);
// baked decor solids (visual comes from the shell builder) participate in placement as footprint-only entities
DESIGN_SOLIDS.forEach((r, i) =>
  world.addEntity({ id: `${DESIGN_ROOM.id}/solid-${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {}, source: { baked: true } }),
);
// the ground floor: every V1 room footprint, shared floor, sidewalk, door openings (Design Room = the only reconstructed room)
const plan = registerGroundFloor(world);
const inBounds = (p: Vec2): boolean => world.walkableAt(p);

// ---- nav ---------------------------------------------------------------------------------------
// static = READ-ONLY V1 grid AND inside a walkable registered region AND clear of declared architecture (door jambs);
// dynamic footprints + reservations compose on top
// V2-LOCAL: the V1 grid PLUS the floor 4C's corrected north walls gave back (nav/v2Open.ts). The grid file
// itself is untouched; only the two declared bands can add a cell.
const openBands = [MEETING_NORTH_STRIP, PROJECT_NORTH_STRIP, GAMING_NORTH_STRIP, GAMING_WEST_STRIP, ...HUB_OPEN_BANDS];
const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer(openBands)), inBounds, clearanceLayer(worldClearances(world))));
walkability.syncFromWorld(world);

// ---- render ------------------------------------------------------------------------------------
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const params = {
  pitch: 52, yaw: 0, zoom: 1.32,
  lightAzimuth: -48, lightElevation: 62, keyIntensity: 2.3, ambientIntensity: 1.25, envIntensity: 0.45, exposure: 1.12,
  shadows: true, ao: false, sway: true, ambient: true, wallHeight: DESIGN_SHELL.wallHeight, frontWall: "low" as "low" | "full" | "hidden",
  overlay: true, motion: false, preset: "B" as PresetId, captureSeconds: 30,
  avatar: true, avatarLod: 1 as AvatarLod, avatarLit: true, walkSpeed: 30,
  clickToWalk: true, showGrid: false, showBlocked: false, showRegions: false, showPath: true, showDestination: true,
  editMode: false,
};
const R = new Renderer(canvas, DESIGN_ROOM.rect);
const mirror = new SceneMirror(world, R.scene);
mirror.buildGroundFloor(plan);
const shellOpts = () => ({ wallHeight: params.wallHeight, frontWall: params.frontWall, exterior: false });
mirror.buildRoom(DESIGN_ROOM, shellOpts());
mirror.buildRoom(RECEPTION_ROOM, shellOpts());
mirror.buildRoom(MEETING_ROOM, shellOpts()); // Phase 4B
mirror.buildRoom(PROJECT_ROOM, shellOpts());
mirror.buildRoom(GAMING_ROOM, shellOpts()); // Phase 5B
mirror.buildRoom(CENTRAL_HUB, shellOpts()); // Phase 6B — wall-less atrium: the builder owns its own floor plate
// The monument's two boss statues are sculpted GLBs; the ring ships with procedural placeholders standing
// in their anchors and swaps them the moment the assets arrive. Fire-and-forget: a missing file leaves the
// placeholders up and the hub otherwise untouched.
//
// The shadow map is only redrawn on demand (Renderer.invalidateShadows), and these land ASYNCHRONOUSLY —
// after the map was last drawn. Without this the statues stand in the scene casting nothing until some
// unrelated change happens to refresh it. Anything else added after startup needs the same call.
void loadBossStatues(mirror.root).then(() => R.invalidateShadows());
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
    R.invalidateShadows(); // a body just entered the scene; it has to enter the shadow map too
    avatarState.status = `LOD${params.avatarLod} loaded · native ${avatar.nativeHeight.toFixed(2)} → ${BON_STANDING_HEIGHT} units`;
    avatarState.triangles = Math.round(avatar.triangles);
  }).catch((e: unknown) => { avatarState.status = `load failed: ${String(e).slice(0, 80)}`; });
}
const chairSeat = world.get(CHAIR_4_ID).capabilities.seat!;
avatar.setPosition(chairSeat.approach);
avatar.setYaw(Math.PI / 2);
loadAvatar();

// ---- devtools: nav debug, overlay, bench -------------------------------------------------------
const navDebug = new NavDebug(R.scene, { bounds: plan.frame, walkable: walkability.staticLayer, v1: v1Static, regions: world.regions, openings: plan.openings, doors: worldClearances(world).length ? [world.get(DOOR_ID).capabilities.door!] : [] }, 8);
navDebug.refreshDynamic(walkability);
const navState = { last: "click the floor", cells: navDebug.cells, walkable: navDebug.walkable, unbuilt: navDebug.unbuilt };
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
    return { ok: false, reason: "outside-world", destination: null, cell: null };
  }
  const result = planWalk(avatar.position, { x, z }, walkability, inBounds);
  navDebug.showNav(avatar.position, result);
  const region = world.regionAt({ x, z });
  navState.last = result.ok ? `ok → cell ${result.cell.cx},${result.cell.cy} · ${result.path.length} waypoint(s) · ${region?.id ?? "?"}` : `rejected: ${result.reason}${region && !region.walkable ? ` (${region.id} not reconstructed)` : ""}`;
  if (result.ok) navCtl.setPath(result.path);
  return result;
}
// dev-only tour: walk the given world points in a loop (visual verification + benchmark driver)
let tour: { points: Vec2[]; i: number } | null = null;
function startTour(points: Vec2[]): void { tour = { points, i: 0 }; walkToGround(points[0].x, points[0].z); }
function stopTour(): void { tour = null; }
navCtl.onArrive = () => {
  navDebug.clearNav();
  approachCtl.onArrived();
  if (tour) { tour.i = (tour.i + 1) % tour.points.length; const p = tour.points[tour.i]; walkToGround(p.x, p.z); }
};
let seat = new SeatInteraction(avatar, stack, mirror.view(CHAIR_4_ID), chairSeat, (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
const seatState = { state: "idle", chairRestError: 0 };
// the automatic east door: reacts to Bon's route, owns only its own leaf (navigation keeps owning Bon)
const doorEntity = world.get(DOOR_ID);
let door = new SlidingDoor(mirror.view(DOOR_ID), doorEntity.capabilities.door!, doorEntity.transform.pos);
const doorState = { state: "closed", open: 0, drift: 0, cycles: 0 };
// the Reception entrance: the SAME SlidingDoor controller as the Design Room, bi-parting — the west panel
// drives and the east one is its `opposed` mirror, so both derive from one `t` and neither can drift
const entryWest = world.get(ENTRY_DOOR_WEST_ID);
let entryDoor = new SlidingDoor(mirror.view(ENTRY_DOOR_WEST_ID), entryWest.capabilities.door!, entryWest.transform.pos, {
  view: mirror.view(ENTRY_DOOR_EAST_ID),
  closed: world.get(ENTRY_DOOR_EAST_ID).transform.pos,
});
const entryState = { state: "closed", open: 0, drift: 0, cycles: 0, scanner: 0 };
// the Gaming Room's west entrance: a single glass leaf on the SAME SlidingDoor controller
const gamingDoorEntity = world.get(GAMING_DOOR_ID);
let gamingDoor = new SlidingDoor(mirror.view(GAMING_DOOR_ID), gamingDoorEntity.capabilities.door!, gamingDoorEntity.transform.pos);
const gamingDoorState = { state: "closed", open: 0, drift: 0, cycles: 0 };
// ---- Reception interactions (3E.3) ------------------------------------------------------------------
// One focused interaction at a time, driven by the SAME pieces the Design Room uses: ApproachInteraction
// for walk-up points, SeatInteraction for the lounge chairs, planWalk for every route.
const approachCtl = new ApproachInteraction(avatar, stack, (to) => planWalk(avatar.position, to, walkability, inBounds));
const receptionState = { focus: "none", status: "idle", seat: "idle" };
/** Every FIXED lounge seat in the world, flattened to one slot per entry: Reception's two tub chairs plus
 *  Project's two sofas (two cushions each) and two tub chairs. One list, one controller — no new system. */
const loungeSeats = [...LOUNGE_SEAT_IDS, ...SOFA_SEAT_IDS, ...TUB_SEAT_IDS, SOFA_SEAT_ID, ...BAG_SEAT_IDS, ...HUB_LOUNGE_IDS].flatMap((id) => {
  const e = world.get(id);
  return e.capabilities.lounge!.slots.map((slot) => ({ id, slot, view: mirror.view(id), label: slot.id }));
});
let loungeSeat: LoungeSeatInteraction | null = null;
/** The six Meeting conference chairs use the MOVABLE pattern — the same SeatInteraction the Design Room
 *  desk chair uses, one instance at a time. */
let gamingSeat: SeatInteraction | null = null;
const gamingState = { chair: "none", seat: "idle", chairRestError: 0, slot: "none", door: "closed" };
function startGamingSit(index: number): void {
  if (stack.owner === "Interaction") return;
  loungeSeat?.reset();
  loungeSeat = null;
  if (gamingSeat && gamingSeat.state !== "idle") gamingSeat.reset();
  const id = GAMING_CHAIR_IDS[index];
  const e = world.get(id);
  gamingSeat = new SeatInteraction(avatar, stack, mirror.view(id), e.capabilities.seat!, (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
  gamingState.chair = `station ${index}`;
  gamingSeat.sit();
}

let meetingSeat: SeatInteraction | null = null;
const meetingState = { chair: "none", seat: "idle", chairRestError: 0, kioskScanner: 0 };
/** The Central Hub's 24 café chairs are MOVABLE seating on the same one-at-a-time SeatInteraction. */
let hubSeat: SeatInteraction | null = null;
const hubState = { chair: "none", seat: "idle", chairRestError: 0, slot: "none" };
/** Only an ENGAGED interaction is reset. SeatInteraction.reset() teleports the avatar back to its own
 *  approach point, so resetting an already-idle controller would yank Bon across the building. */
function clearSeats(): void {
  if (loungeSeat && loungeSeat.state !== "idle") loungeSeat.reset();
  loungeSeat = null;
  if (meetingSeat && meetingSeat.state !== "idle") meetingSeat.reset();
  if (gamingSeat && gamingSeat.state !== "idle") gamingSeat.reset();
  if (hubSeat && hubSeat.state !== "idle") hubSeat.reset();
}
function startHubSit(index: number): void {
  approachCtl.cancel();
  clearSeats();
  const id = CAFE_CHAIR_IDS[index];
  const e = world.get(id);
  hubSeat = new SeatInteraction(avatar, stack, mirror.view(id), e.capabilities.seat!, (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
  hubState.chair = id.split("/")[1];
  hubSeat.sit();
}
function startMeetingSit(index: number): void {
  approachCtl.cancel();
  clearSeats();
  const id = MEETING_CHAIR_IDS[index];
  const e = world.get(id);
  meetingSeat = new SeatInteraction(avatar, stack, mirror.view(id), e.capabilities.seat!, (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
  meetingState.chair = id.split("/")[1];
  meetingSeat.sit();
}
function startApproach(entityId: string): void {
  clearSeats();
  meetingSeat = null;
  gamingSeat = null;
  const spec = world.get(entityId).capabilities.approach!;
  const r = approachCtl.begin(spec);
  receptionState.focus = spec.label;
  receptionState.status = approachCtl.status;
  if (r.ok) { navDebug.showNav(avatar.position, r); navCtl.setPath(r.path); }
}
function startLoungeSit(index: number): void {
  approachCtl.cancel();
  clearSeats();
  meetingSeat = null;
  gamingSeat = null;
  const s = loungeSeats[index];
  loungeSeat = new LoungeSeatInteraction(avatar, stack, s.view, s.slot, (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
  receptionState.focus = s.label;
  loungeSeat.sit();
}
/** Click resolution: raycast the built world, then walk up to the first group a Reception interaction
 *  declares as its pick target (a static group name, or a seat entity's own view). */
function pickInteraction(cx: number, cy: number): string | null {
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, R.camera);
  const hits = raycaster.intersectObject(mirror.root, true);
  if (!hits.length) return null;
  const byPick = new Map<string, string>();
  for (const e of world.entities.values()) {
    if (e.capabilities.approach && typeof e.props.pick === "string") byPick.set(e.props.pick, e.id);
    if (e.capabilities.seat || e.capabilities.lounge) byPick.set(e.id, e.id);
  }
  for (let n: THREE.Object3D | null = hits[0].object; n; n = n.parent) {
    const id = byPick.get(n.name);
    if (id) return id;
  }
  return null;
}
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
  const picked = pickInteraction(e.clientX, e.clientY);
  if (picked) {
    const ent = world.get(picked);
    if (ent.capabilities.lounge) startLoungeSit(LOUNGE_SEAT_IDS.indexOf(picked));
    else startApproach(picked);
    return;
  }
  approachCtl.cancel();
  const p = floorPoint(e.clientX, e.clientY);
  if (p) walkToGround(p.x, p.z);
});

// ---- GUI -------------------------------------------------------------------------------------------
const gui = new GUI({ title: "VO 3D — V2 (ground floor)" });
const refresh = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());
const cam = gui.addFolder("Camera");
const applyCam = () => { R.camParams = { pitch: params.pitch, yaw: params.yaw, zoom: params.zoom }; R.placeCamera(); };
cam.add(params, "pitch", 30, 90, 1).onChange(applyCam); cam.add(params, "yaw", -45, 45, 1).onChange(applyCam); cam.add(params, "zoom", 0.5, 3, 0.01).onChange(applyCam);
cam.add({ reset: () => { params.pitch = 52; params.yaw = 0; params.zoom = 1.32; R.setFocus(DESIGN_ROOM.rect); refresh(); applyCam(); } }, "reset").name("reset view");
const focusOn = (rect: Rect, fill = 0.9) => { params.zoom = R.focusOn(rect, fill); refresh(); applyCam(); };
cam.add({ f: () => focusOn(DESIGN_ROOM.rect, 0.78) }, "f").name("focus: Design Room");
cam.add({ f: () => focusOn(RECEPTION_ROOM.rect, 0.86) }, "f").name("focus: Reception");
cam.add({ f: () => focusOn(GAMING_ROOM.rect, 0.86) }, "f").name("focus: Gaming Room");
cam.add({ f: () => focusOn(CENTRAL_HUB.rect, 0.92) }, "f").name("focus: Central Hub");
cam.add({ f: () => focusOn({ x: 616, z: 480, w: 222, d: 222 }, 0.9) }, "f").name("focus: Hub island");
const ENTRANCE_VIEW: Rect = { x: 590, z: 1060, w: 260, d: 170 };
cam.add({ f: () => focusOn(ENTRANCE_VIEW, 0.9) }, "f").name("focus: Reception entrance");
// the bottom architectural bar: Meeting → Reception → Project must read as ONE continuous structure
const FRONT_BAR: Rect = { x: 8, z: 820, w: 1424, d: 425 };
cam.add({ f: () => focusOn(FRONT_BAR, 0.97) }, "f").name("focus: front bar (Meeting→Reception→Project)");
cam.add({ f: () => focusOn(plan.frame, 0.96) }, "f").name("focus: whole ground floor");
cam.add({ f: () => { const p = avatar.position; focusOn({ x: p.x - 130, z: p.z - 100, w: 260, d: 200 }, 0.9); } }, "f").name("focus: Bon");
const light = gui.addFolder("Light");
const applyLight = () => { R.lightParams = { azimuth: params.lightAzimuth, elevation: params.lightElevation, keyIntensity: params.keyIntensity, ambientIntensity: params.ambientIntensity, envIntensity: params.envIntensity, exposure: params.exposure }; R.placeLight(); };
light.add(params, "lightAzimuth", -180, 180, 1).onChange(applyLight); light.add(params, "lightElevation", 15, 85, 1).onChange(applyLight);
light.add(params, "keyIntensity", 0, 5, 0.05).onChange(applyLight); light.add(params, "ambientIntensity", 0, 3, 0.05).onChange(applyLight);
light.add(params, "envIntensity", 0, 1.5, 0.05).onChange(applyLight); light.add(params, "exposure", 0.5, 1.6, 0.01).onChange(applyLight);
light.add(params, "shadows").onChange((v: boolean) => R.setShadows(v)); light.add(params, "ao").name("SSAO (off by default)").onChange((v: boolean) => (R.ssaoEnabled = v));
const geo = gui.addFolder("Geometry");
const rebuild = () => { seat.reset(); mirror.rebuildRoom(DESIGN_ROOM, shellOpts()); door = new SlidingDoor(mirror.view(DOOR_ID), doorEntity.capabilities.door!, doorEntity.transform.pos); seat = new SeatInteraction(avatar, stack, mirror.view(CHAIR_4_ID), chairSeat, (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed); };
geo.add(params, "wallHeight", 20, 110, 1).onFinishChange(rebuild); geo.add(params, "frontWall", ["low", "full", "hidden"]).onChange(rebuild);
geo.add(params, "sway").name("plant sway").onChange((v: boolean) => (mirror.sway.enabled = v));
geo.add(params, "ambient").name("powered-electronics idle").onChange((v: boolean) => (mirror.ambient.enabled = v));
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
const doorGui = gui.addFolder("Sliding door (design-room/door-east · automatic)");
doorGui.add(doorState, "state").disable().listen(); doorGui.add(doorState, "open").name("open %").disable().listen(); doorGui.add(doorState, "drift").name("closed-transform drift").disable().listen(); doorGui.add(doorState, "cycles").disable().listen();
const entryGui = gui.addFolder("Reception entrance (automatic · bi-parting)");
entryGui.add(entryState, "state").disable().listen(); entryGui.add(entryState, "open").name("open %").disable().listen();
entryGui.add(entryState, "drift").name("closed-transform drift").disable().listen(); entryGui.add(entryState, "cycles").disable().listen();
entryGui.add(entryState, "scanner").name("entry scanner (0 blue → 1 green)").disable().listen();
const rec = gui.addFolder("Reception interactions");
rec.add({ f: () => startApproach(COUNTER_INTERACTION_ID) }, "f").name("▶ approach reception desk");
rec.add({ f: () => startApproach(KIOSK_INTERACTION_ID) }, "f").name("▶ use check-in kiosk");
rec.add({ f: () => startLoungeSit(0) }, "f").name("▶ sit: west lounge chair");
rec.add({ f: () => startLoungeSit(1) }, "f").name("▶ sit: east lounge chair");
rec.add({ f: () => { loungeSeat?.stand(); } }, "f").name("▶ stand up");
rec.add(receptionState, "focus").disable().listen();
rec.add(receptionState, "status").disable().listen();
rec.add(receptionState, "seat").disable().listen();
const meet = gui.addFolder("Meeting room (4C)");
["north 0", "north 1", "north 2", "south 0", "south 1", "south 2"].forEach((n, i) =>
  meet.add({ f: () => startMeetingSit(i) }, "f").name(`▶ sit: chair ${n}`));
meet.add({ f: () => meetingSeat?.stand() }, "f").name("▶ stand up");
meet.add({ f: () => startApproach(MEETING_KIOSK_INTERACTION_ID) }, "f").name("▶ use meeting terminal");
meet.add(meetingState, "chair").disable().listen();
meet.add(meetingState, "seat").disable().listen();
meet.add(meetingState, "chairRestError").name("chair rest drift").disable().listen();
meet.add(meetingState, "kioskScanner").name("terminal scanner (0 blue → 1 green)").disable().listen();
const proj = gui.addFolder("Project room (4C)");
const projState = { seat: "idle", slot: "none", drift: 0 };
loungeSeats.forEach((s2, i) => { if (s2.id.startsWith(PROJECT_ROOM.id)) proj.add({ f: () => { projState.slot = s2.label; startLoungeSit(i); } }, "f").name(`▶ sit: ${s2.label}`); });
proj.add({ f: () => loungeSeat?.stand() }, "f").name("▶ stand up");
proj.add({ f: () => startApproach(CONSOLE_INTERACTION_ID) }, "f").name("▶ approach coffee station");
proj.add({ f: () => startApproach(TV_INTERACTION_ID) }, "f").name("▶ view the project board");
proj.add(projState, "slot").disable().listen();
proj.add(projState, "seat").disable().listen();
proj.add(projState, "drift").name("furniture drift (always 0)").disable().listen();
const game = gui.addFolder("Gaming room (5C)");
["station 0", "station 1", "station 2", "station 3"].forEach((n, i) =>
  game.add({ f: () => startGamingSit(i) }, "f").name(`▶ sit: ${n}`));
loungeSeats.forEach((s2, i) => {
  if (!s2.id.startsWith(GAMING_ROOM.id)) return;
  game.add({ f: () => { gamingState.slot = s2.label; startLoungeSit(i); } }, "f").name(`▶ sit: ${s2.label}`);
});
game.add({ f: () => { gamingSeat?.stand(); loungeSeat?.stand(); } }, "f").name("▶ stand up (gaming)");
game.add({ f: () => startApproach(GAMING_TV_INTERACTION_ID) }, "f").name("▶ pick a game");

// ---- Central Hub (6C) --------------------------------------------------------------------------
const hub = gui.addFolder("Central Hub (6C)");
[0, 4, 8, 12, 16, 20].forEach((i) => hub.add({ f: () => startHubSit(i) }, "f").name(`▶ sit: ${CAFE_CHAIR_IDS[i].split("/")[1]}`));
loungeSeats.forEach((s3, i) => {
  if (!HUB_LOUNGE_IDS.includes(s3.id)) return;
  hub.add({ f: () => { hubState.slot = s3.label; startLoungeSit(i); } }, "f").name(`▶ sit: ${s3.label}`);
});
hub.add({ f: () => { hubSeat?.stand(); loungeSeat?.stand(); } }, "f").name("▶ stand up (hub)");
hub.add({ f: () => startApproach(HUB_COUNTER_ID) }, "f").name("▶ grab a coffee");
hub.add({ f: () => startApproach(HUB_SHELF_ID) }, "f").name("▶ browse the shelves");
hub.add({ f: () => startApproach(HUB_MONUMENT_ID) }, "f").name("▶ read the plaque");
hub.add(hubState, "chair").disable().listen();
hub.add(hubState, "slot").disable().listen();
hub.add(hubState, "seat").disable().listen();
hub.add(hubState, "chairRestError").name("chair rest drift").disable().listen();
hub.add({ toucan: `${TOUCAN_PERCH.x}, ${TOUCAN_PERCH.z} @ y${TOUCAN_PERCH.y}` }, "toucan").name("toucan perch").disable();
game.add({ f: () => startApproach(DARTS_INTERACTION_ID) }, "f").name("▶ throw darts");
game.add({ f: () => startApproach(FRIDGE_INTERACTION_ID) }, "f").name("▶ grab a drink");
game.add({ f: () => startApproach(POSTER_INTERACTION_ID) }, "f").name("▶ arcade print");
game.add(gamingState, "chair").disable().listen();
game.add(gamingState, "slot").disable().listen();
game.add(gamingState, "seat").disable().listen();
game.add(gamingState, "chairRestError").name("chair rest drift").disable().listen();
game.add(gamingDoorState, "state").name("west door").disable().listen();
game.add(gamingDoorState, "open").name("west door open %").disable().listen();
game.add(gamingDoorState, "drift").name("west door drift").disable().listen();

const editGui = gui.addFolder("Room edit mode (hero plant only)");
editGui.add(params, "editMode").name("✎ edit mode").onChange((v: boolean) => { edit.setEditMode(v); if (v) edit.select(HERO_PLANT_ID); refreshEditVisuals(); });
editGui.add({ confirm: () => { const v = edit.confirm(); editState.placement = v.ok ? "committed" : `rejected: ${v.reason}`; refreshEditVisuals(); } }, "confirm").name("✔ confirm placement");
editGui.add({ cancel: () => { edit.cancel(); refreshEditVisuals(); } }, "cancel").name("✖ cancel (revert to committed)");
editGui.add({ reset: () => { edit.reset(); refreshEditVisuals(); } }, "reset").name("reset to original");
editGui.add(editState, "selected").disable().listen(); editGui.add(editState, "placement").disable().listen(); editGui.add(editState, "drift").disable().listen(); editGui.add(editState, "blockedCells").name("dynamic blocked cells").disable().listen();
const nav = gui.addFolder("Click-to-walk (V1 grid ∧ world regions ∧ ¬dynamic)");
nav.add(params, "clickToWalk").name("left-click floor → walk");
nav.add(params, "showGrid").name("show grid (green walkable · grey unbuilt interior)").onChange((v: boolean) => (navDebug.showGrid = v));
nav.add(params, "showBlocked").name("show blocked cells").onChange((v: boolean) => (navDebug.showBlocked = v));
nav.add(params, "showRegions").name("show regions / footprints / doors / bounds").onChange((v: boolean) => (navDebug.showRegions = v));
const HALL_EXEC_DOOR: Vec2 = { x: 728, z: 312 }; // outside stand cell in front of the Executive door
/** the two ends of a Reception entrance crossing (both V1-walkable; verified by nav tests) */
const RECEPTION_INSIDE: Vec2 = { x: 600, z: 1096 };
const RECEPTION_STREET: Vec2 = { x: 720, z: 1216 };
function placeBonAtEntrance(): void {
  navCtl.setPath([]);
  avatar.setPosition(RECEPTION_INSIDE);
  avatar.setYaw(0);
}
nav.add({ go: () => startTour([HALL_EXEC_DOOR, chairSeat.approach]) }, "go").name("▶ tour: Design Room ↔ hall (exec door)");
// The Reception entrance needs the SAME affordance. Bon spawns in the Design Room, ~39 s of walking away,
// so without these the automatic entrance simply cannot be observed in the running app.
nav.add({ go: () => { placeBonAtEntrance(); startTour([RECEPTION_STREET, RECEPTION_INSIDE]); } }, "go").name("▶ tour: Reception entrance (in ↔ out)");
nav.add({ go: () => { stopTour(); placeBonAtEntrance(); focusOn(ENTRANCE_VIEW, 0.9); } }, "go").name("▶ put Bon at the Reception entrance");
nav.add({ stop: () => stopTour() }, "stop").name("■ stop tour");
nav.add(params, "showPath").name("show path").onChange((v: boolean) => (navDebug.showPath = v));
nav.add(params, "showDestination").name("show destination").onChange((v: boolean) => (navDebug.showDestination = v));
nav.add(navState, "last").disable().listen(); nav.add(navState, "cells").disable(); nav.add(navState, "walkable").disable(); nav.add(navState, "unbuilt").name("unbuilt interior cells").disable();
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

// ---- scanner proximity -------------------------------------------------------------------------------
// READ-ONLY: this reads the avatar position the loop already has and sets a VISUAL state (blue → green).
// It changes no navigation, no grid, no region and no geometry — the gates themselves do not move.
const scannerAt: Vec2 = { x: 0, z: 0 };
function updateScanners(p: Vec2): void {
  scannerAt.x = p.x;
  scannerAt.z = p.z;
  for (let i = 0; i < GATE_ZONES.length; i++) {
    let inside = false;
    for (const r of GATE_ZONES[i]) if (pointInRect(scannerAt, r)) { inside = true; break; }
    mirror.ambient.setScanner(GATE_SCANNER_IDS[i], inside);
  }
  // ONE system: the entrance sensor is green when a body is on the mat OR when the door's own approach test
  // says someone is coming through. Both are PRESENCE/intent tests — never the door's animation state, so
  // green leads the panels rather than following them.
  mirror.ambient.setScanner(ENTRY_SCANNER_ID, pointInRect(scannerAt, ENTRY_ZONE) || entryDoor.wantsOpen(scannerAt, entryPath));
  // the Meeting terminal speaks the same BLUE-idle / GREEN-detected language, driven by the same
  // read-only proximity test — no navigation, no grid, no geometry
  mirror.ambient.setScanner(MEETING_KIOSK_SCANNER_ID, pointInRect(scannerAt, MEETING_KIOSK_ZONE));
}
let entryPath: readonly Vec2[] = [];

// ---- loop --------------------------------------------------------------------------------------------
const clock = new THREE.Timer();
let lastFrame = performance.now();
let overlayTick = 0;
/** True while anything that casts a shadow is still moving. Compared against the last frame rather than
 *  asking each controller, so a new interaction can never forget to opt in. */
const lastShadowPose = new THREE.Vector3(Number.NaN, 0, 0);
let lastShadowClip = "";
function shadowsAreStale(): boolean {
  const p = avatar.worldPosition();
  const clip = avatar.currentClip ?? "";
  const moved = Math.abs(p.x - lastShadowPose.x) > 0.01 || Math.abs(p.z - lastShadowPose.z) > 0.01 || clip !== lastShadowClip;
  lastShadowPose.set(p.x, 0, p.z);
  lastShadowClip = clip;
  // a walking avatar animates continuously; doors and chairs report their own motion
  return moved || navCtl.moving || door.state !== "closed" || entryDoor.state !== "closed" || gamingDoor.state !== "closed"
    || seat.status !== "idle" || approachCtl.status !== "idle"
    || (meetingSeat?.status ?? "idle") !== "idle" || (gamingSeat?.status ?? "idle") !== "idle"
    || (hubSeat?.status ?? "idle") !== "idle" || (loungeSeat?.status ?? "idle") !== "idle";
}
function loop(): void {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(250, now - lastFrame);
  lastFrame = now;
  const t = clock.update().getElapsed();
  if (params.motion) scriptedMotion(t);
  mirror.sway.update(t);
  mirror.ambient.update(t, dt / 1000); // powered-surface idle animation (screens, sensors, status strips)
  if (params.avatar) {
    seat.update(dt / 1000);
    meetingSeat?.update(dt / 1000);
    gamingSeat?.update(dt / 1000);
    hubSeat?.update(dt / 1000);
    loungeSeat?.update(dt / 1000);
    approachCtl.update(dt / 1000);
    navCtl.update(dt / 1000);
    avatar.update(dt / 1000);
    const bp = avatar.worldPosition();
    door.update(dt / 1000, { x: bp.x, z: bp.z }, navCtl.path);
    entryPath = navCtl.path;
    entryDoor.update(dt / 1000, { x: bp.x, z: bp.z }, navCtl.path);
    gamingDoor.update(dt / 1000, { x: bp.x, z: bp.z }, navCtl.path);
    updateScanners({ x: bp.x, z: bp.z });
    entryState.state = entryDoor.state; entryState.open = Math.round(entryDoor.t * 100);
    entryState.drift = entryDoor.state === "closed" ? Math.round(entryDoor.driftError() * 1e6) / 1e6 : entryState.drift;
    entryState.cycles = entryDoor.cycles;
    entryState.scanner = Math.round(mirror.ambient.scannerActivation(ENTRY_SCANNER_ID) * 100) / 100;
    doorState.state = door.state; doorState.open = Math.round(door.t * 100); doorState.drift = door.state === "closed" ? Math.round(door.driftError() * 1e6) / 1e6 : doorState.drift; doorState.cycles = door.cycles;
    seatState.state = seat.status;
    receptionState.status = approachCtl.status;
    receptionState.seat = loungeSeat ? loungeSeat.status : "idle";
    meetingState.seat = meetingSeat ? meetingSeat.status : "idle";
    meetingState.chairRestError = meetingSeat ? Math.round(meetingSeat.chairRestError() * 1000) / 1000 : 0;
    meetingState.kioskScanner = Math.round(mirror.ambient.scannerActivation(MEETING_KIOSK_SCANNER_ID) * 100) / 100;
    hubState.seat = hubSeat ? hubSeat.status : loungeSeat ? loungeSeat.status : "idle";
    hubState.chairRestError = hubSeat ? Math.round(hubSeat.chairRestError() * 1000) / 1000 : 0;
    gamingState.seat = gamingSeat ? gamingSeat.status : loungeSeat ? loungeSeat.status : "idle";
    gamingState.chairRestError = gamingSeat ? Math.round(gamingSeat.chairRestError() * 1000) / 1000 : 0;
    gamingState.door = gamingDoor.state;
    gamingDoorState.state = gamingDoor.state;
    gamingDoorState.open = Math.round(gamingDoor.t * 100);
    gamingDoorState.drift = gamingDoor.state === "closed" ? Math.round(gamingDoor.driftError() * 1e6) / 1e6 : gamingDoorState.drift;
    gamingDoorState.cycles = gamingDoor.cycles;
    projState.seat = loungeSeat ? loungeSeat.status : "idle";
    projState.drift = loungeSeat ? Math.round(loungeSeat.furnitureDrift() * 1e6) / 1e6 : 0;
    seatState.chairRestError = Math.round(seat.chairRestError() * 1000) / 1000;
    avatarState.clip = avatar.currentClip ?? "";
    avatarState.owner = stack.owner;
    const p = avatar.worldPosition();
    avatarState.position = `${p.x.toFixed(0)}, ${p.z.toFixed(0)}${navCtl.moving ? ` → ${navCtl.path.length} waypoint(s) left` : ""}`;
  }
  // The shadow map is only redrawn when something that casts one has moved (Renderer.invalidateShadows).
  // Anything the avatar does counts: walking, sitting, and the doors/chairs its interactions drive. Plant
  // sway is deliberately NOT a trigger — a frozen leaf shadow is invisible and it would defeat the point.
  if (params.avatar && shadowsAreStale()) R.invalidateShadows();
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
  world, plan, walkability, mirror, R, scene: R.scene, camera: R.camera, renderer: R.renderer, params, stack, avatar, avatarState, navCtl,
  placeCamera: applyCam, placeLight: applyLight, focusOn,
  bench: { device, applyPreset, runCapture, snapshot: () => snapshotRenderer(R.renderer), live: () => liveWindow.summary(), summarize, sceneStats: () => sceneStats(R.scene) },
  scanners: {
    set: (id: string, on: boolean) => mirror.ambient.setScanner(id, on),
    state: () => Object.fromEntries(mirror.ambient.scannerIds.map((id) => [id, Math.round(mirror.ambient.scannerActivation(id) * 100) / 100])),
    zones: { gates: GATE_ZONES, entry: ENTRY_ZONE },
  },
  nav: { walkToGround, navState, startTour, stopTour,
    placeBonAtEntrance, entranceTour: () => { placeBonAtEntrance(); startTour([RECEPTION_STREET, RECEPTION_INSIDE]); },
    receptionInside: RECEPTION_INSIDE, receptionStreet: RECEPTION_STREET, entranceView: ENTRANCE_VIEW, planWalk: (from: Vec2, to: Vec2) => planWalk(from, to, walkability, inBounds), regionAt: (x: number, z: number) => world.regionAt({ x, z }) },
  get seat() { return seat; }, seatState,
  hub: { sit: startHubSit, chairIds: CAFE_CHAIR_IDS, loungeIds: HUB_LOUNGE_IDS, toucanPerch: TOUCAN_PERCH,
    loungeSlots: loungeSeats.map((l, i) => ({ i, id: l.id, label: l.label })).filter((l) => HUB_LOUNGE_IDS.includes(l.id)),
    sitLounge: startLoungeSit, stand: () => { hubSeat?.stand(); loungeSeat?.stand(); },
    approach: { counter: HUB_COUNTER_ID, shelf: HUB_SHELF_ID, monument: HUB_MONUMENT_ID },
    startApproach, clear: clearSeats,
    get seat() { return hubSeat; }, get lounge() { return loungeSeat; }, state: hubState },
  openBands, openedCells: () => openedCells(openBands),
  meeting: { state: meetingState, startSit: startMeetingSit, stand: () => meetingSeat?.stand(), seat: () => meetingSeat,
    chairIds: MEETING_CHAIR_IDS, kioskScanner: MEETING_KIOSK_SCANNER_ID, kioskZone: MEETING_KIOSK_ZONE },
  project: { state: projState, seats: loungeSeats.map((s2, i) => ({ i, id: s2.id, slot: s2.label })), startSit: startLoungeSit,
    stand: () => loungeSeat?.stand(), seat: () => loungeSeat },
  reception: { state: receptionState, approach: approachCtl, startApproach, startLoungeSit,
    get loungeSeat() { return loungeSeat; }, seats: loungeSeats.map((s) => s.id),
    counterId: COUNTER_INTERACTION_ID, kioskId: KIOSK_INTERACTION_ID, pick: pickInteraction },
  get door() { return door; }, doorState,
  get entryDoor() { return entryDoor; }, entryState,
  gaming: {
    state: gamingState, doorState: gamingDoorState, startSit: startGamingSit, startApproach,
    chairs: GAMING_CHAIR_IDS,
    seats: loungeSeats.map((s2, i) => ({ i, id: s2.id, slot: s2.label })).filter((r) => r.id.startsWith(GAMING_ROOM.id)),
    startLoungeSit,
    stand: () => { gamingSeat?.stand(); loungeSeat?.stand(); },
    get seat() { return gamingSeat; }, get lounge() { return loungeSeat; }, get door() { return gamingDoor; },
  },
  edit: { session: edit, editState, movePlantTo: (x: number, z: number) => { edit.setEditMode(true); edit.select(HERO_PLANT_ID); const v = edit.preview({ x, z }); refreshEditVisuals(); return v; }, confirm: () => { const v = edit.confirm(); refreshEditVisuals(); return v; }, cancel: () => { edit.cancel(); refreshEditVisuals(); }, reset: () => { edit.reset(); refreshEditVisuals(); }, setEditMode: (v: boolean) => { params.editMode = v; edit.setEditMode(v); if (v) edit.select(HERO_PLANT_ID); refreshEditVisuals(); refresh(); } },
};
