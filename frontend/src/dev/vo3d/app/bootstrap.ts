// vo3d app — wires world → nav → render → avatar → interactions → editor → devtools. Dev-only entry.
import * as THREE from "three";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { WorldState } from "../world/WorldState";
import { DESIGN_ROOM, DESIGN_SOLIDS, CHAIR_4_ID, DOOR_ID, HERO_PLANT_ID, SHELL as DESIGN_SHELL, designRoomEntities } from "../rooms/design-room";
import { RECEPTION_ROOM, COUNTER_INTERACTION_ID, ENTRY_DOOR_EAST_ID, ENTRY_DOOR_WEST_ID, ENTRY_SCANNER_ID, ENTRY_ZONE, GATE_SCANNER_IDS, GATE_ZONES, KIOSK_INTERACTION_ID, LOUNGE_SEAT_IDS, receptionEntities } from "../rooms/reception";
import { GAMING_ROOM, gamingRoomEntities,
  BAG_SEAT_IDS, DARTS_INTERACTION_ID, DOOR_LEAF_ID as GAMING_DOOR_ID, FRIDGE_INTERACTION_ID, GAMING_CHAIR_IDS,
  POSTER_INTERACTION_ID, SOFA_SEAT_ID, TV_INTERACTION_ID as GAMING_TV_INTERACTION_ID } from "../rooms/gaming";
import { CENTRAL_HUB, OPEN_BANDS as HUB_OPEN_BANDS, centralHubEntities,
  CAFE_CHAIR_IDS, COUNTER_INTERACTION_ID as HUB_COUNTER_ID, HUB_LOUNGE_IDS,
  MONUMENT_INTERACTION_ID as HUB_MONUMENT_ID, SHELF_INTERACTION_ID as HUB_SHELF_ID, TOUCAN_PERCH } from "../rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities,
  CABINET_L_INTERACTION_ID, CABINET_R_INTERACTION_ID, CREDENZA_INTERACTION_ID, DOOR_EAST_ID as EXEC_DOOR_EAST_ID,
  DOOR_WEST_ID as EXEC_DOOR_WEST_ID, EXECUTIVE_LOUNGE_IDS, EXECUTIVE_SEAT_IDS, MEDIA_INTERACTION_ID } from "../rooms/executive";
import { CMS_ROOM, cmsRoomEntities,
  BOARD_INTERACTION_ID as CMS_BOARD_ID, CMS_LOUNGE_IDS, CMS_SEAT_IDS,
  COUNTER_INTERACTION_ID as CMS_COUNTER_ID, DOOR_NORTH_ID as CMS_DOOR_NORTH_ID,
  DOOR_SOUTH_ID as CMS_DOOR_SOUTH_ID, LIBRARY_INTERACTION_ID as CMS_LIBRARY_ID,
  PRINTER_INTERACTION_ID as CMS_PRINTER_ID, STICKY_INTERACTION_ID as CMS_STICKY_ID } from "../rooms/cms";
import { AI_ROOM, aiRoomEntities,
  AI_SEAT_IDS, ARCHITECTURE_INTERACTION_ID as AI_ARCH_ID, COUNTER_INTERACTION_ID as AI_COUNTER_ID,
  DOOR_LEAF_ID as AI_DOOR_ID, MISSION_INTERACTION_ID as AI_MISSION_ID,
  PRINTER_INTERACTION_ID as AI_PRINTER_ID, RACKS_INTERACTION_ID as AI_RACKS_ID,
  ROBOT_INTERACTION_ID as AI_ROBOT_ID } from "../rooms/ai";
import { DEV_ROOM, devRoomEntities,
  BOARD_INTERACTION_ID as DEV_BOARD_ID, BOOKCASE_INTERACTION_ID as DEV_BOOKCASE_ID,
  DEV_LOUNGE_IDS, DEV_SEAT_IDS, DOOR_LEAF_ID as DEV_DOOR_ID,
  PANTRY_INTERACTION_ID as DEV_PANTRY_ID, SCHEMATIC_INTERACTION_ID as DEV_SCHEMATIC_ID,
  SERVERS_INTERACTION_ID as DEV_SERVERS_ID, TEA_INTERACTION_ID as DEV_TEA_ID,
  TOOL_INTERACTION_ID as DEV_TOOL_ID } from "../rooms/dev";
import { QA_ROOM, qaRoomEntities,
  DOOR_NORTH_ID as QA_DOOR_NORTH_ID,
  QA_LOUNGE_IDS, QA_SEAT_IDS, SHELF_INTERACTION_ID as QA_SHELF_ID,
  STORAGE_INTERACTION_ID as QA_STORAGE_ID, SUPPLY_INTERACTION_ID as QA_SUPPLY_ID,
  DOOR_SOUTH_ID as QA_DOOR_SOUTH_ID, WINDOW_INTERACTION_ID as QA_WINDOW_ID } from "../rooms/qa";
import { loadBossStatues } from "../build/hub-monument";
import { openedCells, openedLayer, v2Static } from "../nav/v2Open";
import { DerivedNav } from "../nav/derived";
import { worldToCell } from "../adapters/v1Grid";
import { NAV_RADIUS } from "../nav/clearance";
import { Connectivity } from "../nav/connectivity";
import { compareToV1, summariseReport, verdictFor } from "../nav/diagnostics";
import { MEETING_ROOM, MEETING_CHAIR_IDS, KIOSK_INTERACTION_ID as MEETING_KIOSK_INTERACTION_ID, KIOSK_SCANNER_ID as MEETING_KIOSK_SCANNER_ID, KIOSK_ZONE as MEETING_KIOSK_ZONE, meetingRoomEntities } from "../rooms/meeting";
import { PROJECT_ROOM, CONSOLE_INTERACTION_ID, SOFA_SEAT_IDS, TUB_SEAT_IDS, TV_INTERACTION_ID, projectRoomEntities } from "../rooms/project";
import { buildExterior } from "../build/exterior";
import { Environment } from "../env/Environment";
import { ENV_TIME_MODES, TimeOfDay, type EnvTimeMode } from "../env/timeOfDay";
import { WEATHER_MODES, Weather, type WeatherMode, type WeatherState } from "../env/weather";
import { ManualWeatherProvider } from "../env/providers/manual";
import { WEATHER_ATTRIBUTION, officeWeatherProvider } from "../env/providers/office";
import { GRADE } from "../world/campus";
import { CAMERA_MODES, CameraModes, type CameraModeId } from "../render/CameraModes";
import { PlayerMode } from "../player/PlayerMode";
import { makeStandTest } from "../player/standTest";
import type { PlayerView } from "../player/PlayerCamera";
import { ApproachInteraction } from "../interact/Approach";
import { LoungeSeatInteraction } from "../interact/LoungeSeat";
import { Walkability, composeStatic } from "../nav/Walkability";
import { clearanceLayer, worldClearances } from "../nav/clearance";
import { SlidingDoor } from "../interact/Door";
import { CORRIDOR_BANDS, registerGroundFloor } from "../rooms/ground-floor";
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
world.addRoom(EXECUTIVE_ROOM);
world.addRoom(CMS_ROOM);
world.addRoom(AI_ROOM);
world.addRoom(DEV_ROOM);
world.addRoom(QA_ROOM);
for (const e of designRoomEntities()) world.addEntity(e);
for (const e of receptionEntities()) world.addEntity(e);
for (const e of meetingRoomEntities()) world.addEntity(e);
for (const e of projectRoomEntities()) world.addEntity(e);
for (const e of gamingRoomEntities()) world.addEntity(e);
for (const e of centralHubEntities()) world.addEntity(e);
for (const e of executiveRoomEntities()) world.addEntity(e);
for (const e of cmsRoomEntities()) world.addEntity(e);
for (const e of aiRoomEntities()) world.addEntity(e);
for (const e of devRoomEntities()) world.addEntity(e);
for (const e of qaRoomEntities()) world.addEntity(e);
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
// 7C — OPENBAND RETIREMENT. A band was always a stopgap: a room declaring, by hand, a patch of floor the
// 2D painting over-blocked. Now that the room's own geometry answers the question, four of them are
// RETIRED — Meeting's and Project's north strips and Gaming's north and west strips. Each was measured
// first: every cell each one opened lies inside derived-governed space AND is reproduced as open by the
// room's geometry, so removing them changes no cell anywhere (derived-nav.test.ts locks that).
//
// The Central Hub's six bands are RETAINED. `hub-apron-south` is NOT fully reproduced — derived navigation
// blocks one of its cells, correctly, because a body does not fit that close to the monument — and the six
// are the single 6A record of the island decision. They are inert (every cell they touch is derived-
// governed), so keeping them costs nothing and retiring them would be deleting evidence for tidiness.
// Phase 8 adds ONE band: the two cell rows the Dev room's clamped placeholder gives back, so the
// corridor between it and the CMS room is walkable in the grid exactly where it is open in the geometry
// (rooms/ground-floor PLACEHOLDER_SOUTH_CLAMP). It retires with that room's own reconstruction.
const openBands = [...HUB_OPEN_BANDS, ...CORRIDOR_BANDS];
const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer(openBands)), inBounds, clearanceLayer(worldClearances(world))));
// 7C: GEOMETRY-DERIVED NAVIGATION for EVERY RECONSTRUCTED ROOM. Inside these six the V1 grid is not
// consulted at all — the floor, the walls, the furniture footprints and the avatar's routing clearance are
// the authority. The hall, the sidewalk and the five unreconstructed rooms stay exactly as V1 painted them.
const DERIVED_ROOM_IDS = new Set([DESIGN_ROOM.id, RECEPTION_ROOM.id, MEETING_ROOM.id, PROJECT_ROOM.id, GAMING_ROOM.id, CENTRAL_HUB.id, EXECUTIVE_ROOM.id, CMS_ROOM.id, AI_ROOM.id, DEV_ROOM.id, QA_ROOM.id]);
const derivedNav = new DerivedNav(world, { roomIds: DERIVED_ROOM_IDS });
walkability.attachDerived(derivedNav, world);

// ---- render ------------------------------------------------------------------------------------
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const params = {
  pitch: 52, yaw: 0, zoom: 1.32,
  lightAzimuth: -48, lightElevation: 62, keyIntensity: 2.3, ambientIntensity: 1.25, envIntensity: 0.45, exposure: 1.12,
  shadows: true, ao: false, sway: true, ambient: true, wallHeight: DESIGN_SHELL.wallHeight, frontWall: "low" as "low" | "full" | "hidden",
  overlay: true, motion: false, preset: "B" as PresetId, captureSeconds: 30,
  envTime: "auto" as EnvTimeMode, envScenery: true, envFog: true, envSky: true,
  envWeather: "auto" as WeatherMode, envRainInOffice: true,
  cameraMode: "office" as CameraModeId,
  playerView: "third" as PlayerView,
  avatar: true, avatarLod: 1 as AvatarLod, avatarLit: true, walkSpeed: 30,
  clickToWalk: true, showGrid: false, showBlocked: false, showRegions: false, showPath: true, showDestination: true, showDiagnostic: false,
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
mirror.buildRoom(EXECUTIVE_ROOM, shellOpts()); // Phase 7
mirror.buildRoom(CMS_ROOM, shellOpts()); // Phase 8
mirror.buildRoom(AI_ROOM, shellOpts()); // Phase 9
mirror.buildRoom(DEV_ROOM, shellOpts()); // Phase 10
mirror.buildRoom(QA_ROOM, shellOpts()); // Phase 11
// The monument's two boss statues are sculpted GLBs; the ring ships with procedural placeholders standing
// in their anchors and swaps them the moment the assets arrive. Fire-and-forget: a missing file leaves the
// placeholders up and the hub otherwise untouched.
//
// The shadow map is only redrawn on demand (Renderer.invalidateShadows), and these land ASYNCHRONOUSLY —
// after the map was last drawn. Without this the statues stand in the scene casting nothing until some
// unrelated change happens to refresh it. Anything else added after startup needs the same call.
void loadBossStatues(mirror.root).then(() => R.invalidateShadows());

// ---- environment -------------------------------------------------------------------------------
// The world OUTSIDE the office (build/exterior) plus the global day/sunset/night presentation that owns
// sky, sun, ambient, haze and the exterior practical lights. The phase itself comes from V1's real clock
// through env/timeOfDay — V1 keeps the clock and the boundaries; this only presents them.
// SCENERY ONLY: the exterior group is added straight to the scene, never to the world/nav graph.
const scenery = buildExterior();
// The office footprint is handed to the environment as the DRY RECTANGLE: rain is never PLACED over it,
// so a doll-house building with no drawn roof stays dry inside at every camera angle without the rain ever
// inspecting the scene. GRADE is where rain lands. Neither is a layout change — both are read from data
// that already existed.
const env = new Environment(R, scenery, plan.frame, GRADE);
const timeOfDay = new TimeOfDay();
// WEATHER: a second, INDEPENDENT axis.
//
// AUTO now reads REAL weather for the office, from OUR backend (GET /weather/office), which holds the
// WeatherAPI key in its own environment and caches one reading for the whole office. The browser never
// sees a key. When no backend is configured (VITE_API_URL unset — the bare dev rig), the manual dev
// provider stands in and AUTO simply reports CLEAR. This was the one-line swap env/providers/README
// promised: nothing downstream of the WeatherProvider seam moved.
//
// THE MANUAL OVERRIDES ARE UNAFFECTED EITHER WAY. Weather.state() consults a provider only while the
// mode is AUTO; picking CLEAR/CLOUDY/RAIN/HEAVY_RAIN/THUNDERSTORM bypasses it entirely, so a missing
// key, a dead network or a slow endpoint cannot touch them.
const manualWeather = new ManualWeatherProvider("clear");
const liveWeather = officeWeatherProvider();
const weatherProvider = liveWeather ?? manualWeather;
const weather = new Weather(weatherProvider);
const envState = { phase: "—", realPhase: "—", clock: "—", source: "V1 real clock (Asia/Manila)", weather: "—", observed: "—", provider: "—", attribution: WEATHER_ATTRIBUTION };
function applyEnvPhase(force = false): void {
  const now = performance.now();
  const phase = timeOfDay.phase(now);
  const w = weather.state(now);
  envState.phase = phase;
  envState.realPhase = timeOfDay.realPhase;
  envState.weather = w;
  envState.observed = weather.observed;
  envState.provider = weather.source;
  if (liveWeather) envState.attribution = liveWeather.attribution;
  // Both axes are re-read every frame and BOTH are cheap no-ops when nothing changed: apply() returns
  // false unless the composed presentation actually differs, so a steady state costs two comparisons.
  const weatherChanged = env.setWeather(w, force);
  if (!env.apply(phase, force) && !weatherChanged) return;
  R.invalidateShadows(); // the sun (or the cloud in front of it) moved: static shadows must be redrawn
}
/** decimal hour -> "HH:MM", for the dev readout only */
function formatManila(h: number): string {
  const hh = Math.floor(h) % 24, mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
applyEnvPhase(true);

// ---- camera modes ------------------------------------------------------------------------------
// OFFICE is the default and the product experience: the ground floor framed automatically, fixed pitch
// and yaw, no orbit, no pan. 3D EXPLORE unlocks the full rig for inspecting the campus. See CameraModes.
// The fence is the V1 FRAME: the office footprint plus exactly the edge context V1 showed — which
// includes the exterior sidewalk under Reception, so panning south stops there and the road never
// appears. See render/CameraModes for why the clamp is viewport-aware rather than target-aware.
const cameraModes = new CameraModes(R, plan.frame);
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
// the overlay must show the layer the avatar ACTUALLY walks on — derived inside the six reconstructed
// rooms, V1 everywhere else — not the V1 static layer it used to draw
const navDebug = new NavDebug(R.scene, { bounds: plan.frame, walkable: walkability.walkable, v1: v1Static, regions: world.regions, openings: plan.openings, doors: worldClearances(world).length ? [world.get(DOOR_ID).capabilities.door!] : [] }, 8);
navDebug.refreshDynamic(walkability);
const navState = { last: "click the floor", cells: navDebug.cells, walkable: navDebug.walkable, unbuilt: navDebug.unbuilt,
  derived: "", disagreement: "", stranded: 0, clearance: "hover a cell", radius: NAV_RADIUS, updates: "0 invalidations / 0 cells" };
/** Recompute the V1 ↔ derived comparison and repaint it. Cheap enough to run on demand (a plant move, a
 *  door cycle), never per frame. */
function refreshDiagnostic(): void {
  const connected = new Connectivity(walkability.walkable, undefined, walkability.edgeOk);
  const report = compareToV1(derivedNav, v1Static, walkability.navRadius, world, connected);
  const verdicts = derivedNav.governedCells().map((c) => verdictFor(derivedNav, v1Static, walkability.navRadius, world, c, connected));
  navDebug.setDiagnostic(report, verdicts);
  navState.derived = `${report.governed} cells · ${[...DERIVED_ROOM_IDS].join(" + ")}`;
  navState.disagreement = `legacy-open ${report.counts["legacy-open"]} · v2-obstruction ${report.counts["v2-obstruction"]}`;
  navState.stranded = report.strandedCells.length;
  navState.updates = `${walkability.stats.invalidations} invalidations / ${walkability.stats.cellsInvalidated} cells`;
  console.info(summariseReport(report));
}
refreshDiagnostic();
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
  const clicked = worldToCell({ x, z });
  if (derivedNav.governs(clicked.cx, clicked.cy)) {
    const near = derivedNav.nearestSolid(clicked.cx, clicked.cy);
    navState.clearance = `${derivedNav.clearanceAt(clicked.cx, clicked.cy).toFixed(1)} / ${walkability.navRadius} needed · nearest ${near?.solid.id ?? "—"} (${near?.solid.from ?? ""})`;
  } else navState.clearance = `cell ${clicked.cx},${clicked.cy} is V1-governed`;
  navState.updates = `${walkability.stats.invalidations} invalidations / ${walkability.stats.cellsInvalidated} cells`;
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
// the Executive Room's south entrance: bi-parting, on the SAME controller Reception's entrance uses
const execDoorWest = world.get(EXEC_DOOR_WEST_ID);
let execDoor = new SlidingDoor(mirror.view(EXEC_DOOR_WEST_ID), execDoorWest.capabilities.door!, execDoorWest.transform.pos, {
  view: mirror.view(EXEC_DOOR_EAST_ID),
  closed: world.get(EXEC_DOOR_EAST_ID).transform.pos,
});
const execDoorState = { state: "closed", open: 0, drift: 0, cycles: 0 };
// the CMS Room's west entrance: bi-parting, on the SAME controller Reception's and Executive's run on —
// the north panel drives and the south one is its `opposed` mirror
const cmsDoorNorth = world.get(CMS_DOOR_NORTH_ID);
let cmsDoor = new SlidingDoor(mirror.view(CMS_DOOR_NORTH_ID), cmsDoorNorth.capabilities.door!, cmsDoorNorth.transform.pos, {
  view: mirror.view(CMS_DOOR_SOUTH_ID),
  closed: world.get(CMS_DOOR_SOUTH_ID).transform.pos,
});
const cmsDoorState = { state: "closed", open: 0, drift: 0, cycles: 0 };
// the AI Room's south entrance: a SINGLE leaf, on the same controller the Gaming Room's west door runs on
const aiDoorEntity = world.get(AI_DOOR_ID);
let aiDoor = new SlidingDoor(mirror.view(AI_DOOR_ID), aiDoorEntity.capabilities.door!, aiDoorEntity.transform.pos);
const aiDoorState = { state: "closed", open: 0, drift: 0, cycles: 0 };
// the Dev Room's south entrance: a SINGLE leaf, on the same controller the AI Room's south door runs on
const devDoorEntity = world.get(DEV_DOOR_ID);
let devDoor = new SlidingDoor(mirror.view(DEV_DOOR_ID), devDoorEntity.capabilities.door!, devDoorEntity.transform.pos);
const devDoorState = { state: "closed", open: 0, drift: 0, cycles: 0 };
// the QA Room's east entrance: BI-PARTING, on the same controller Reception, Executive and CMS run on
const qaDoorEntity = world.get(QA_DOOR_NORTH_ID);
let qaDoor = new SlidingDoor(mirror.view(QA_DOOR_NORTH_ID), qaDoorEntity.capabilities.door!, qaDoorEntity.transform.pos,
  { view: mirror.view(QA_DOOR_SOUTH_ID), closed: world.get(QA_DOOR_SOUTH_ID).transform.pos });
const qaDoorState = { state: "closed", open: 0, drift: 0, cycles: 0 };
// ---- Reception interactions (3E.3) ------------------------------------------------------------------
// One focused interaction at a time, driven by the SAME pieces the Design Room uses: ApproachInteraction
// for walk-up points, SeatInteraction for the lounge chairs, planWalk for every route.
const approachCtl = new ApproachInteraction(avatar, stack, (to) => planWalk(avatar.position, to, walkability, inBounds));
const receptionState = { focus: "none", status: "idle", seat: "idle" };
/** Every FIXED lounge seat in the world, flattened to one slot per entry: Reception's two tub chairs plus
 *  Project's two sofas (two cushions each) and two tub chairs. One list, one controller — no new system. */
const loungeSeats = [...LOUNGE_SEAT_IDS, ...SOFA_SEAT_IDS, ...TUB_SEAT_IDS, SOFA_SEAT_ID, ...BAG_SEAT_IDS, ...HUB_LOUNGE_IDS, ...EXECUTIVE_LOUNGE_IDS, ...CMS_LOUNGE_IDS, ...DEV_LOUNGE_IDS, ...QA_LOUNGE_IDS].flatMap((id) => {
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
  if (execSeat && execSeat.state !== "idle") execSeat.reset();
  if (cmsSeat && cmsSeat.state !== "idle") cmsSeat.reset();
  if (aiSeat && aiSeat.state !== "idle") aiSeat.reset();
  if (devSeat && devSeat.state !== "idle") devSeat.reset();
  if (qaSeat && qaSeat.state !== "idle") qaSeat.reset();
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
/** The Executive Room's three MOVABLE chairs (two executive, one workstation) on the same controller. */
let execSeat: SeatInteraction | null = null;
const execState = { chair: "none", seat: "idle", chairRestError: 0, slot: "none", door: "closed" };
function startExecutiveSit(index: number): void {
  approachCtl.cancel();
  clearSeats();
  const id = EXECUTIVE_SEAT_IDS[index];
  const e = world.get(id);
  execSeat = new SeatInteraction(avatar, stack, mirror.view(id), e.capabilities.seat!, (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
  execState.chair = id.split("/")[1];
  execSeat.sit();
}
/** The CMS Room's nine MOVABLE chairs (two lead, seven member) on the same one-at-a-time controller. */
let cmsSeat: SeatInteraction | null = null;
const cmsState = { chair: "none", seat: "idle", chairRestError: 0, slot: "none", door: "closed" };
function startCmsSit(index: number): void {
  approachCtl.cancel();
  clearSeats();
  const id = CMS_SEAT_IDS[index];
  const e = world.get(id);
  cmsSeat = new SeatInteraction(avatar, stack, mirror.view(id), e.capabilities.seat!, (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
  cmsState.chair = id.split("/")[1];
  cmsSeat.sit();
}
/** The AI Room's twenty-one MOVABLE chairs (one lead, two visitor, eighteen member) on the same
 *  one-at-a-time controller. */
let aiSeat: SeatInteraction | null = null;
const aiState = { chair: "none", seat: "idle", chairRestError: 0, door: "closed" };
function startAiSit(index: number): void {
  approachCtl.cancel();
  clearSeats();
  const id = AI_SEAT_IDS[index];
  const e = world.get(id);
  aiSeat = new SeatInteraction(avatar, stack, mirror.view(id), e.capabilities.seat!, (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
  aiState.chair = id.split("/")[1];
  aiSeat.sit();
}
/** The Dev Room's twenty-two MOVABLE chairs (two lead, four visitor, sixteen bay) on the same
 *  one-at-a-time controller. */
let devSeat: SeatInteraction | null = null;
const devState = { chair: "none", seat: "idle", chairRestError: 0, door: "closed" };
function startDevSit(index: number): void {
  approachCtl.cancel();
  clearSeats();
  const id = DEV_SEAT_IDS[index];
  const e = world.get(id);
  devSeat = new SeatInteraction(avatar, stack, mirror.view(id), e.capabilities.seat!, (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
  devState.chair = id.split("/")[1];
  devSeat.sit();
}
/** The QA Room's seven MOVABLE chairs (one lead, two visitor, four bench) on the same one-at-a-time
 *  controller. */
let qaSeat: SeatInteraction | null = null;
const qaState = { chair: "none", seat: "idle", chairRestError: 0, door: "closed" };
function startQaSit(index: number): void {
  approachCtl.cancel();
  clearSeats();
  const id = QA_SEAT_IDS[index];
  const e = world.get(id);
  qaSeat = new SeatInteraction(avatar, stack, mirror.view(id), e.capabilities.seat!, (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
  qaState.chair = id.split("/")[1];
  qaSeat.sit();
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
  execSeat = null;
  cmsSeat = null;
  aiSeat = null;
  devSeat = null;
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
  execSeat = null;
  cmsSeat = null;
  aiSeat = null;
  devSeat = null;
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
// ---- PLAYER MODE (V0) ---------------------------------------------------------------------------
// A third camera mode that walks Bon directly. It owns nothing of the world: collision is the SAME derived
// clearance + V1 walkability that click-to-walk routes on (player/standTest), and every interaction it can
// invoke is one of the starters above, reached through `activate` below. Entering and leaving is a pure
// ownership handoff — see player/PlayerMode.
/** PLAYER shadow frustum half-size. The default frame is sized from the ORTHOGRAPHIC viewport, which means
 *  nothing once a perspective camera is walking the building; this keeps the 2048 map on the few hundred
 *  units the player can actually see, which is what makes contact shadows read at eye level. */
const PLAYER_SHADOW_RADIUS = 300;
const playerStand = makeStandTest({ world, walkability, derived: derivedNav, radius: NAV_RADIUS });
/** The third-person boom's probe. Same composition, a token radius: the camera must not end up inside a
 *  wall or over unbuilt floor, but it may perfectly well fly over a desk — and judging it at the BODY
 *  radius pulled the boom in to its minimum beside almost every piece of furniture in the building. */
const playerCameraProbe = makeStandTest({ world, walkability, derived: derivedNav, radius: 2 });
/** the one bridge from a targeted entity id to V2's existing interaction path. Nothing is reimplemented:
 *  each branch is the same call the GUI button and the click-to-walk handler already make. */
function activateInteractable(id: string, kind: "seat" | "lounge" | "approach"): boolean {
  if (kind === "lounge") {
    const i = loungeSeats.findIndex((s2) => s2.id === id);
    if (i < 0) return false;
    startLoungeSit(i);
    return true;
  }
  if (kind === "seat") {
    const hub = CAFE_CHAIR_IDS.indexOf(id);
    if (hub >= 0) { startHubSit(hub); return true; }
    const meet = MEETING_CHAIR_IDS.indexOf(id);
    if (meet >= 0) { startMeetingSit(meet); return true; }
    const game = GAMING_CHAIR_IDS.indexOf(id);
    if (game >= 0) { startGamingSit(game); return true; }
    const exec = EXECUTIVE_SEAT_IDS.indexOf(id);
    if (exec >= 0) { startExecutiveSit(exec); return true; }
    const cms = CMS_SEAT_IDS.indexOf(id);
    if (cms >= 0) { startCmsSit(cms); return true; }
    const ai = AI_SEAT_IDS.indexOf(id);
    if (ai >= 0) { startAiSit(ai); return true; }
    const dev = DEV_SEAT_IDS.indexOf(id);
    if (dev >= 0) { startDevSit(dev); return true; }
    const qa = QA_SEAT_IDS.indexOf(id);
    if (qa >= 0) { startQaSit(qa); return true; }
    if (id === CHAIR_4_ID) { seat.sit(); return true; }
    return false;
  }
  startApproach(id);
  return true;
}
const engagedSeat = (): { stand: () => void } | null => {
  for (const s2 of [loungeSeat, hubSeat, meetingSeat, gamingSeat, execSeat, cmsSeat, aiSeat, devSeat, qaSeat] as ({ state: string; stand: () => void } | null)[])
    if (s2 && s2.state === "seated") return s2;
  return seat.status === "seated" ? seat : null;
};
const playerMode = new PlayerMode({
  avatar, stack, world, canStand: playerStand, cameraProbe: playerCameraProbe,
  camera: R.playerCamera, canvas, overlayRoot: mirror.root,
  radius: NAV_RADIUS, avatarHeight: BON_STANDING_HEIGHT,
  speed: () => params.walkSpeed,
  activate: activateInteractable,
  canStandUp: () => engagedSeat() !== null,
  standUp: () => engagedSeat()?.stand(),
  // hand the avatar over cleanly: stop the walker, cancel a half-finished approach, leave engaged seats
  // alone (PlayerMode simply does not move Bon while Interaction owns him, and takes over when it ends)
  yieldAvatar: () => { stopTour(); navCtl.stop(); approachCtl.cancel(); },
});

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
  if (e.button !== 0 || playerMode.active) return; // PLAYER owns the canvas: see player/PlayerInput
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
  if (playerMode.active || !edit.editMode || !dragging) return;
  const p = floorPoint(e.clientX, e.clientY);
  if (p) edit.preview(p);
  refreshEditVisuals();
});
canvas.addEventListener("pointerup", (e) => {
  if (playerMode.active) return;
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
/** mirror whatever the mode policy decided back into the GUI state */
const syncCam = (p: { pitch: number; yaw: number; zoom: number }) => { params.pitch = p.pitch; params.yaw = p.yaw; params.zoom = p.zoom; refresh(); };
// THE MODE SWITCH owns both halves of the illusion: the camera policy AND what the environment presents.
// OFFICE draws no exterior at all (see EnvPresentation) — camera bounds alone cannot stop a 16:9 viewport
// overflowing a near-square office sideways, and anything out there would spoil the reveal.
const setCameraMode = (m: CameraModeId) => {
  // PLAYER is a handoff, not a framing: the orthographic rig is left exactly as it was (CameraModes
  // disables OrbitControls rather than reconfiguring it), so whichever of OFFICE/EXPLORE we came from is
  // resumed on its own view when we come back. A refused entry (nowhere legal to stand) falls back to
  // OFFICE rather than leaving a mode selected that nothing is driving.
  if (playerMode.active && m !== "player") playerMode.exit();
  if (m === "player") {
    syncCam(cameraModes.set("player"));
    if (!playerMode.enter()) { params.cameraMode = "office"; setCameraMode("office"); refresh(); return; }
    R.setActiveCamera(R.playerCamera);
    // ONLY the perspective aspect. Calling R.resize() here would also re-place the orthographic camera
    // from camParams, which would silently discard a hand-orbited EXPLORE view on the way in.
    R.playerCamera.aspect = window.innerWidth / window.innerHeight;
    R.playerCamera.updateProjectionMatrix();
    R.shadowRadius = PLAYER_SHADOW_RADIUS;
    params.cameraMode = "player";
    if (env.setPresentation("world")) R.invalidateShadows();
    R.invalidateShadows();
    refresh();
    return;
  }
  params.cameraMode = m;
  if (env.setPresentation(m === "office" ? "office" : "world")) R.invalidateShadows();
  syncCam(cameraModes.set(m));
  R.invalidateShadows();
};
cam.add(params, "cameraMode", CAMERA_MODES).name("mode: OFFICE / 3D EXPLORE / PLAYER").onChange(setCameraMode);
// The manual pitch/yaw sliders only bite in EXPLORE — OFFICE pins the orientation, and letting a slider
// break that would defeat the point of having a fixed mode at all.
cam.add(params, "pitch", 12, 90, 1).onChange(() => { if (params.cameraMode === "explore") applyCam(); else syncCam(cameraModes.officeParams); });
cam.add(params, "yaw", -180, 180, 1).onChange(() => { if (params.cameraMode === "explore") applyCam(); else syncCam(cameraModes.officeParams); });
const playerGui = gui.addFolder("Player (WASD · Shift sprint · mouse look · E interact)");
playerGui.add({ go: () => setCameraMode("player") }, "go").name("▶ enter PLAYER");
playerGui.add({ go: () => setCameraMode("office") }, "go").name("■ leave PLAYER (→ OFFICE)");
playerGui.add(params, "playerView", ["third", "first"]).name("view: THIRD / FIRST").onChange((v: PlayerView) => playerMode.setView(v));
playerGui.add({ go: () => { placeBonAtEntrance(); setCameraMode("player"); } }, "go").name("▶ spawn at Reception + enter");
playerGui.add(playerMode.state, "active").disable().listen();
playerGui.add(playerMode.state, "locked").name("pointer locked").disable().listen();
playerGui.add(playerMode.state, "sprinting").name("sprinting (hold Shift)").disable().listen();
playerGui.add(playerMode.state, "owner").name("avatar owner").disable().listen();
playerGui.add(playerMode.state, "pos").name("position").disable().listen();
playerGui.add(playerMode.state, "target").name("targeting").disable().listen();
playerGui.add(playerMode.state, "blocked").name("collided this frame").disable().listen();
// In OFFICE the slider IS the wheel: it drives OrbitControls' dolly, whose floor of 1 is the canonical
// whole-office framing. In EXPLORE it resizes the frustum as before.
cam.add(params, "zoom", 0.05, 6, 0.01).onChange((v: number) => {
  if (params.cameraMode === "explore") applyCam();
  else { R.camera.zoom = Math.max(1, Math.min(6, v)); R.camera.updateProjectionMatrix(); }
});
cam.add({ reset: () => setCameraMode(params.cameraMode) }, "reset").name("reset view");
const focusOn = (rect: Rect, fill = 0.9) => syncCam(cameraModes.focus(rect, fill));
setCameraMode("office"); // the app opens in the product experience, not in the inspection rig
cam.add({ f: () => focusOn(DESIGN_ROOM.rect, 0.78) }, "f").name("focus: Design Room");
cam.add({ f: () => focusOn(RECEPTION_ROOM.rect, 0.86) }, "f").name("focus: Reception");
cam.add({ f: () => focusOn(GAMING_ROOM.rect, 0.86) }, "f").name("focus: Gaming Room");
cam.add({ f: () => focusOn(CENTRAL_HUB.rect, 0.92) }, "f").name("focus: Central Hub");
cam.add({ f: () => focusOn(EXECUTIVE_ROOM.rect, 0.9) }, "f").name("focus: Executive Room");
cam.add({ f: () => focusOn(CMS_ROOM.rect, 0.9) }, "f").name("focus: CMS Room");
cam.add({ f: () => focusOn(AI_ROOM.rect, 0.9) }, "f").name("focus: AI Room");
cam.add({ f: () => focusOn(DEV_ROOM.rect, 0.9) }, "f").name("focus: Dev Room");
cam.add({ f: () => focusOn(QA_ROOM.rect, 0.9) }, "f").name("focus: QA Room");
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
// The environment's phase is READ from V1, never written to it. The dropdown is a dev-only VIEW override:
// AUTO follows the real Manila clock exactly as the 2D office does; the three explicit values are for
// visual testing and change nothing outside this renderer.
const envGui = gui.addFolder("Environment (day / sunset / night)");
envGui.add(params, "envTime", ENV_TIME_MODES).name("time (AUTO = V1 clock)").onChange((v: EnvTimeMode) => { timeOfDay.mode = v; applyEnvPhase(true); refresh(); });
envGui.add(envState, "phase").name("phase in force").listen().disable();
envGui.add(envState, "realPhase").name("V1 real clock says").listen().disable();
envGui.add(envState, "clock").name("Manila time").listen().disable();
envGui.add(params, "envScenery").name("exterior world").onChange((v: boolean) => { env.sceneryVisible = v; R.invalidateShadows(); });
envGui.add(params, "envFog").name("distance haze").onChange((v: boolean) => (env.fogEnabled = v));
envGui.add(params, "envSky").name("sky dome + stars").onChange((v: boolean) => (env.skyVisible = v));
// WEATHER is its own axis and its own folder on purpose: it composes WITH the time above rather than
// replacing it, so every one of the six DAY/SUNSET/NIGHT × CLEAR/RAIN combinations is reachable by
// picking one value from each dropdown. Switching either is a re-grade, never a rebuild.
const wxGui = gui.addFolder("Weather (independent of time of day)");
function setWeatherMode(m: WeatherMode): void {
  params.envWeather = m;
  weather.mode = m;
  applyEnvPhase(true);
  refresh();
}
wxGui.add(params, "envWeather", WEATHER_MODES).name("state (AUTO = provider)").onChange(setWeatherMode);
wxGui.add(envState, "weather").name("in force").listen().disable();
wxGui.add(envState, "observed").name("provider says").listen().disable();
wxGui.add(envState, "provider").name("source").listen().disable();
wxGui.add(params, "envRainInOffice").name("rain in OFFICE mode").onChange((v: boolean) => (env.rainInOffice = v));
// ATTRIBUTION. WeatherAPI's terms require visible credit wherever their data is shown. It belongs on
// the panel that shows the reading, not in the 3D scene — the office is the product, not a billboard.
wxGui.add(envState, "attribution").name("data").listen().disable();
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

// ---- Executive Room (7) ------------------------------------------------------------------------
const exec = gui.addFolder("Executive Room (7)");
EXECUTIVE_SEAT_IDS.forEach((id, i) => exec.add({ f: () => startExecutiveSit(i) }, "f").name(`▶ sit: ${id.split("/")[1]}`));
loungeSeats.forEach((s4, i) => {
  if (!EXECUTIVE_LOUNGE_IDS.includes(s4.id)) return;
  exec.add({ f: () => { execState.slot = s4.label; startLoungeSit(i); } }, "f").name(`▶ sit: ${s4.label}`);
});
exec.add({ f: () => { execSeat?.stand(); loungeSeat?.stand(); } }, "f").name("▶ stand up (executive)");
exec.add({ f: () => startApproach(CABINET_L_INTERACTION_ID) }, "f").name("▶ read the awards (west)");
exec.add({ f: () => startApproach(CABINET_R_INTERACTION_ID) }, "f").name("▶ read the awards (east)");
exec.add({ f: () => startApproach(MEDIA_INTERACTION_ID) }, "f").name("▶ view the display");
exec.add({ f: () => startApproach(CREDENZA_INTERACTION_ID) }, "f").name("▶ display credenza");
exec.add(execState, "chair").disable().listen();
exec.add(execState, "slot").disable().listen();
exec.add(execState, "seat").disable().listen();
exec.add(execState, "chairRestError").name("chair rest drift").disable().listen();
exec.add(execDoorState, "state").name("south door").disable().listen();
exec.add(execDoorState, "open").name("south door open %").disable().listen();
exec.add(execDoorState, "drift").name("south door drift").disable().listen();
// ---- CMS Room (8) ------------------------------------------------------------------------------
const cms = gui.addFolder("CMS Room (8)");
CMS_SEAT_IDS.forEach((id, i) => cms.add({ f: () => startCmsSit(i) }, "f").name(`▶ sit: ${id.split("/")[1]}`));
loungeSeats.forEach((s7, i) => {
  if (!CMS_LOUNGE_IDS.includes(s7.id)) return;
  cms.add({ f: () => { cmsState.slot = s7.label; startLoungeSit(i); } }, "f").name(`▶ sit: ${s7.label}`);
});
cms.add({ f: () => { cmsSeat?.stand(); loungeSeat?.stand(); } }, "f").name("▶ stand up (CMS)");
cms.add({ f: () => startApproach(CMS_BOARD_ID) }, "f").name("▶ read the content plan");
cms.add({ f: () => startApproach(CMS_COUNTER_ID) }, "f").name("▶ make a coffee");
cms.add({ f: () => startApproach(CMS_LIBRARY_ID) }, "f").name("▶ browse the shelf");
cms.add({ f: () => startApproach(CMS_STICKY_ID) }, "f").name("▶ read the sticky wall");
cms.add({ f: () => startApproach(CMS_PRINTER_ID) }, "f").name("▶ collect a printout");
cms.add(cmsState, "chair").disable().listen();
cms.add(cmsState, "slot").disable().listen();
cms.add(cmsState, "seat").disable().listen();
cms.add(cmsState, "chairRestError").name("chair rest drift").disable().listen();
cms.add(cmsDoorState, "state").name("west door").disable().listen();
cms.add(cmsDoorState, "open").name("west door open %").disable().listen();
cms.add(cmsDoorState, "drift").name("west door drift").disable().listen();

// ---- AI Room (9) -------------------------------------------------------------------------------
const aiRoom = gui.addFolder("AI Room (9)");
AI_SEAT_IDS.forEach((id, i) => aiRoom.add({ f: () => startAiSit(i) }, "f").name(`▶ sit: ${id.split("/")[1]}`));
aiRoom.add({ f: () => aiSeat?.stand() }, "f").name("▶ stand up (AI)");
aiRoom.add({ f: () => startApproach(AI_ROBOT_ID) }, "f").name("▶ wake the robot");
aiRoom.add({ f: () => startApproach(AI_RACKS_ID) }, "f").name("▶ check the racks");
aiRoom.add({ f: () => startApproach(AI_MISSION_ID) }, "f").name("▶ read the mission");
aiRoom.add({ f: () => startApproach(AI_ARCH_ID) }, "f").name("▶ study the diagram");
aiRoom.add({ f: () => startApproach(AI_COUNTER_ID) }, "f").name("▶ make a coffee");
aiRoom.add({ f: () => startApproach(AI_PRINTER_ID) }, "f").name("▶ collect a print");
aiRoom.add(aiState, "chair").disable().listen();
aiRoom.add(aiState, "seat").disable().listen();
aiRoom.add(aiState, "chairRestError").name("chair rest drift").disable().listen();
aiRoom.add(aiDoorState, "state").name("south door").disable().listen();
aiRoom.add(aiDoorState, "open").name("south door open %").disable().listen();
aiRoom.add(aiDoorState, "drift").name("south door drift").disable().listen();

// ---- Dev Room (10) -----------------------------------------------------------------------------
const devRoom = gui.addFolder("Dev Room (10)");
DEV_SEAT_IDS.forEach((id, i) => devRoom.add({ f: () => startDevSit(i) }, "f").name(`▶ sit: ${id.split("/")[1]}`));
devRoom.add({ f: () => devSeat?.stand() }, "f").name("▶ stand up (Dev)");
[0, 1, 2].forEach((k) => {
  const base = loungeSeats.findIndex((s2) => s2.id === DEV_LOUNGE_IDS[0]);
  devRoom.add({ f: () => startLoungeSit(base + k) }, "f").name(`▶ sit: dev sofa ${k + 1}`);
});
devRoom.add({ f: () => startApproach(DEV_BOOKCASE_ID) }, "f").name("▶ browse the shelf");
devRoom.add({ f: () => startApproach(DEV_BOARD_ID) }, "f").name("▶ read the build board");
devRoom.add({ f: () => startApproach(DEV_SERVERS_ID) }, "f").name("▶ check the build");
devRoom.add({ f: () => startApproach(DEV_TOOL_ID) }, "f").name("▶ grab a cable");
devRoom.add({ f: () => startApproach(DEV_TEA_ID) }, "f").name("▶ make a coffee (Dev)");
devRoom.add({ f: () => startApproach(DEV_SCHEMATIC_ID) }, "f").name("▶ study the schematic");
devRoom.add({ f: () => startApproach(DEV_PANTRY_ID) }, "f").name("▶ grab a snack");
devRoom.add(devState, "chair").disable().listen();
devRoom.add(devState, "seat").disable().listen();
devRoom.add(devState, "chairRestError").name("chair rest drift").disable().listen();
devRoom.add(devDoorState, "state").name("south door").disable().listen();
devRoom.add(devDoorState, "open").name("south door open %").disable().listen();
devRoom.add(devDoorState, "drift").name("south door drift").disable().listen();

// ---- QA Room (11) ------------------------------------------------------------------------------
const qaRoom = gui.addFolder("QA Room (11)");
QA_SEAT_IDS.forEach((id, i) => qaRoom.add({ f: () => startQaSit(i) }, "f").name(`▶ sit: ${id.split("/")[1]}`));
qaRoom.add({ f: () => qaSeat?.stand() }, "f").name("▶ stand up (QA)");
QA_LOUNGE_IDS.forEach((id) => {
  const base = loungeSeats.findIndex((s2) => s2.id === id);
  const n = world.get(id).capabilities.lounge!.slots.length;
  for (let k = 0; k < n; k++) qaRoom.add({ f: () => startLoungeSit(base + k) }, "f").name(`▶ sit: ${loungeSeats[base + k].label}`);
});
qaRoom.add({ f: () => startApproach(QA_STORAGE_ID) }, "f").name("▶ open a box file");
qaRoom.add({ f: () => startApproach(QA_SUPPLY_ID) }, "f").name("▶ collect a report");
qaRoom.add({ f: () => startApproach(QA_SHELF_ID) }, "f").name("▶ pick up a book");
qaRoom.add({ f: () => startApproach(QA_WINDOW_ID) }, "f").name("▶ look outside");
qaRoom.add(qaState, "chair").disable().listen();
qaRoom.add(qaState, "seat").disable().listen();
qaRoom.add(qaState, "chairRestError").name("chair rest drift").disable().listen();
qaRoom.add(qaDoorState, "state").name("east door").disable().listen();
qaRoom.add(qaDoorState, "open").name("east door open %").disable().listen();
qaRoom.add(qaDoorState, "drift").name("east door drift").disable().listen();
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
nav.add(params, "showDiagnostic").name("V1 ↔ derived V2 (amber = legacy over-block · red = real obstruction · magenta = stranded)").onChange((v: boolean) => (navDebug.showDiagnostic = v));
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
nav.add(navState, "radius").name("NAV_RADIUS (routing)").disable();
nav.add(navState, "derived").name("derived-governed").disable().listen();
nav.add(navState, "disagreement").name("V1 ↔ V2").disable().listen();
nav.add(navState, "stranded").name("walkable but unreachable").disable().listen();
nav.add(navState, "clearance").name("clearance at last click").disable().listen();
nav.add(navState, "updates").name("incremental updates").disable().listen();
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
  return moved || navCtl.moving || door.state !== "closed" || entryDoor.state !== "closed" || gamingDoor.state !== "closed" || execDoor.state !== "closed" || cmsDoor.state !== "closed" || aiDoor.state !== "closed" || devDoor.state !== "closed" || qaDoor.state !== "closed"
    || seat.status !== "idle" || approachCtl.status !== "idle"
    || (meetingSeat?.status ?? "idle") !== "idle" || (gamingSeat?.status ?? "idle") !== "idle"
    || (hubSeat?.status ?? "idle") !== "idle" || (loungeSeat?.status ?? "idle") !== "idle"
    || (execSeat?.status ?? "idle") !== "idle" || (cmsSeat?.status ?? "idle") !== "idle"
    || (aiSeat?.status ?? "idle") !== "idle" || (devSeat?.status ?? "idle") !== "idle" || (qaSeat?.status ?? "idle") !== "idle";
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
  applyEnvPhase(); // V1's clock is re-read at most twice a minute and only writes when the phase changes
  env.follow(dt / 1000); // the sky dome rides the orbit target; the rain field rides the active camera
  if (params.avatar) {
    // PLAYER steps FIRST: it writes the avatar transform for this frame and yields silently whenever an
    // interaction owns Bon, so the controllers below still run exactly as they always have.
    if (playerMode.active) playerMode.update(dt / 1000);
    seat.update(dt / 1000);
    meetingSeat?.update(dt / 1000);
    gamingSeat?.update(dt / 1000);
    hubSeat?.update(dt / 1000);
    // EVERY movable-seat controller has to be ticked here. One that is constructed, acquires the
    // "Interaction" stack lock in sit(), and is then never updated leaves the avatar owned forever: the
    // sequence stops in "approaching", Player movement stays locked and only a reload recovers. There is
    // no self-healing path — SeatInteraction advances on nothing but this call. executive.test.ts asserts
    // that every SeatInteraction declared in this file appears in this block.
    execSeat?.update(dt / 1000);
    cmsSeat?.update(dt / 1000);
    aiSeat?.update(dt / 1000);
    devSeat?.update(dt / 1000);
    qaSeat?.update(dt / 1000);
    loungeSeat?.update(dt / 1000);
    approachCtl.update(dt / 1000);
    navCtl.update(dt / 1000);
    avatar.update(dt / 1000);
    const bp = avatar.worldPosition();
    // A direct-control player has no planned route, so the automatic doors would only react once his body
    // was already inside the sweep band. `doorIntent` is a one-segment synthetic route pointing a stride
    // ahead of him — the SAME input SlidingDoor already consumes, so no door logic changes at all.
    const route = navCtl.path.length ? navCtl.path : playerMode.doorIntent;
    door.update(dt / 1000, { x: bp.x, z: bp.z }, route);
    entryPath = route;
    entryDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route);
    gamingDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route);
    execDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route);
    cmsDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route);
    aiDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route);
    devDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route);
    qaDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route);
    updateScanners({ x: bp.x, z: bp.z });
    entryState.state = entryDoor.state; entryState.open = Math.round(entryDoor.t * 100);
    entryState.drift = entryDoor.state === "closed" ? Math.round(entryDoor.driftError() * 1e6) / 1e6 : entryState.drift;
    entryState.cycles = entryDoor.cycles;
    entryState.scanner = Math.round(mirror.ambient.scannerActivation(ENTRY_SCANNER_ID) * 100) / 100;
    // 7B: the leaf is a LIVE SOLID. Its open fraction feeds derived navigation, which repaints only the
    // cells the leaf can reach — so a closed door genuinely blocks its doorway and an open one genuinely
    // does not, without a per-frame rebuild (setDoorOpenFraction returns early when nothing moved).
    walkability.setDoorOpenFraction(world, DOOR_ID, door.offset / door.spec.slideDistance);
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
    execState.seat = execSeat ? execSeat.status : loungeSeat ? loungeSeat.status : "idle";
    execState.chairRestError = execSeat ? Math.round(execSeat.chairRestError() * 1000) / 1000 : 0;
    execState.door = execDoor.state;
    execDoorState.state = execDoor.state;
    execDoorState.open = Math.round(execDoor.t * 100);
    execDoorState.drift = execDoor.state === "closed" ? Math.round(execDoor.driftError() * 1e6) / 1e6 : execDoorState.drift;
    execDoorState.cycles = execDoor.cycles;
    cmsState.seat = cmsSeat ? cmsSeat.status : loungeSeat ? loungeSeat.status : "idle";
    cmsState.chairRestError = cmsSeat ? Math.round(cmsSeat.chairRestError() * 1000) / 1000 : 0;
    cmsState.door = cmsDoor.state;
    cmsDoorState.state = cmsDoor.state;
    cmsDoorState.open = Math.round(cmsDoor.t * 100);
    cmsDoorState.drift = cmsDoor.state === "closed" ? Math.round(cmsDoor.driftError() * 1e6) / 1e6 : cmsDoorState.drift;
    cmsDoorState.cycles = cmsDoor.cycles;
    aiState.seat = aiSeat ? aiSeat.status : "idle";
    aiState.chairRestError = aiSeat ? Math.round(aiSeat.chairRestError() * 1000) / 1000 : 0;
    aiState.door = aiDoor.state;
    aiDoorState.state = aiDoor.state;
    aiDoorState.open = Math.round(aiDoor.t * 100);
    aiDoorState.drift = aiDoor.state === "closed" ? Math.round(aiDoor.driftError() * 1e6) / 1e6 : aiDoorState.drift;
    aiDoorState.cycles = aiDoor.cycles;
    devState.seat = devSeat ? devSeat.status : "idle";
    devState.chairRestError = devSeat ? Math.round(devSeat.chairRestError() * 1000) / 1000 : 0;
    devState.door = devDoor.state;
    devDoorState.state = devDoor.state;
    devDoorState.open = Math.round(devDoor.t * 100);
    devDoorState.drift = devDoor.state === "closed" ? Math.round(devDoor.driftError() * 1e6) / 1e6 : devDoorState.drift;
    devDoorState.cycles = devDoor.cycles;
    qaState.seat = qaSeat ? qaSeat.status : "idle";
    qaState.chairRestError = qaSeat ? Math.round(qaSeat.chairRestError() * 1000) / 1000 : 0;
    qaState.door = qaDoor.state;
    qaDoorState.state = qaDoor.state;
    qaDoorState.open = Math.round(qaDoor.t * 100);
    qaDoorState.drift = qaDoor.state === "closed" ? Math.round(qaDoor.driftError() * 1e6) / 1e6 : qaDoorState.drift;
    qaDoorState.cycles = qaDoor.cycles;
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
  // the shadow frame follows whoever is looking: the orbit target normally, the player when he is walking
  R.shadowFocus = playerMode.active ? playerMode.body.pos : null;
  R.render();
  const sample = { dt, calls: R.renderer.info.render.calls, triangles: R.renderer.info.render.triangles };
  liveWindow.push(sample); capture?.push(sample);
  overlayTick += dt;
  if (overlayTick > 250 && params.overlay) {
    overlayTick = 0;
    if (params.playerView !== playerMode.view) { params.playerView = playerMode.view; refresh(); }
    envState.clock = formatManila(timeOfDay.hourDecimal);
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
  env: {
    environment: env, scenery, timeOfDay, state: envState,
    setTime: (m: EnvTimeMode) => { params.envTime = m; timeOfDay.mode = m; applyEnvPhase(true); refresh(); },
    phase: () => env.phase, realPhase: () => timeOfDay.realPhase, hour: () => timeOfDay.hourDecimal,
    stats: scenery.stats,
    setScenery: (on: boolean) => { params.envScenery = on; env.sceneryVisible = on; R.invalidateShadows(); refresh(); },
    setFog: (on: boolean) => { params.envFog = on; env.fogEnabled = on; refresh(); },
    setSky: (on: boolean) => { params.envSky = on; env.skyVisible = on; refresh(); },
    presentation: () => env.presentation,
  },
  weather: {
    weather, provider: weatherProvider, live: liveWeather, manual: manualWeather,
    setWeather: setWeatherMode,
    /** Force a re-read of the live endpoint (the dev panel's refresh). */
    refetch: () => { weather.invalidate(); applyEnvPhase(true); refresh(); },
    /** Drive what the MANUAL provider reports, independent of the dev override. Only meaningful
     *  when no backend is configured and the manual provider is the one AUTO is reading. */
    setProvider: (s2: WeatherState) => { manualWeather.state = s2; weather.invalidate(); applyEnvPhase(true); refresh(); },
    state: () => env.weather, mode: () => weather.mode, source: () => weather.source,
    rainStats: () => env.rainStats,
    setRainInOffice: (on: boolean) => { params.envRainInOffice = on; env.rainInOffice = on; refresh(); },
  },
  player: {
    mode: playerMode, state: playerMode.state,
    enter: () => setCameraMode("player"), exit: () => setCameraMode("office"),
    setView: (v: PlayerView) => { params.playerView = v; playerMode.setView(v); refresh(); },
    view: () => playerMode.view,
    camera: R.playerCamera,
    canStand: playerStand,
    /** drive the body straight from a test/console, bypassing the keyboard */
    move: (dx: number, dz: number) => playerMode.body.move(dx, dz),
    position: () => ({ ...playerMode.body.pos }),
    teleport: (x: number, z: number) => { const ok = playerMode.body.placeNear({ x, z }); avatar.setPosition(playerMode.body.pos); playerMode.camera.snap(); return ok; },
    look: (dx: number, dy: number) => playerMode.camera.look(dx, dy),
    interact: () => playerMode.interact(),
    target: () => playerMode.state.target,
  },
  cameraModes: {
    get mode() { return cameraModes.mode; }, set: setCameraMode, officeParams: () => cameraModes.officeParams,
    focus: (rect: Rect, fill = 0.9) => syncCam(cameraModes.focus(rect, fill)),
    /** EXPLORE only: free orientation, for driving inspection views */
    orbit: (pitch: number, yaw: number, zoom?: number) => {
      if (cameraModes.mode !== "explore") return false; // OFFICE pins the orientation; this is the reveal rig
      params.pitch = pitch; params.yaw = yaw; if (zoom !== undefined) params.zoom = zoom;
      applyCam(); refresh(); return true;
    },
    /** OFFICE: dolly in (1 = the canonical whole-office framing, the furthest out the mode allows) */
    dolly: (z: number) => { R.camera.zoom = Math.max(1, Math.min(6, z)); R.camera.updateProjectionMatrix(); },
    /** OFFICE: drag the view by a world-space delta, exactly as a mouse pan would */
    pan: (dx: number, dz: number) => { R.controls.target.x += dx; R.controls.target.z += dz; R.camera.position.x += dx; R.camera.position.z += dz; },
    bounds: () => cameraModes.officeBounds, viewport: () => cameraModes.viewportGroundRect(),
  },
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
  executive: {
    state: execState, doorState: execDoorState, startSit: startExecutiveSit, startApproach, startLoungeSit,
    chairs: EXECUTIVE_SEAT_IDS,
    seats: loungeSeats.map((s5, i) => ({ i, id: s5.id, slot: s5.label })).filter((r) => r.id.startsWith(EXECUTIVE_ROOM.id)),
    approaches: { cabinetWest: CABINET_L_INTERACTION_ID, cabinetEast: CABINET_R_INTERACTION_ID, media: MEDIA_INTERACTION_ID, credenza: CREDENZA_INTERACTION_ID },
    stand: () => { execSeat?.stand(); loungeSeat?.stand(); },
    get seat() { return execSeat; }, get lounge() { return loungeSeat; }, get door() { return execDoor; },
  },
  cms: {
    state: cmsState, doorState: cmsDoorState, startSit: startCmsSit, startApproach, startLoungeSit,
    chairs: CMS_SEAT_IDS,
    seats: loungeSeats.map((s6, i) => ({ i, id: s6.id, slot: s6.label })).filter((r) => r.id.startsWith(CMS_ROOM.id)),
    approaches: { board: CMS_BOARD_ID, counter: CMS_COUNTER_ID, library: CMS_LIBRARY_ID, sticky: CMS_STICKY_ID, printer: CMS_PRINTER_ID },
    stand: () => { cmsSeat?.stand(); loungeSeat?.stand(); },
    get seat() { return cmsSeat; }, get lounge() { return loungeSeat; }, get door() { return cmsDoor; },
  },
  // Phases 9–11 rooms, on the same console shape the earlier rooms use, so a live rig can drive them
  ai: {
    state: aiState, doorState: aiDoorState, startSit: startAiSit, startApproach,
    chairs: AI_SEAT_IDS,
    approaches: { robot: AI_ROBOT_ID, racks: AI_RACKS_ID, mission: AI_MISSION_ID, architecture: AI_ARCH_ID, counter: AI_COUNTER_ID, printer: AI_PRINTER_ID },
    stand: () => { aiSeat?.stand(); },
    get seat() { return aiSeat; }, get door() { return aiDoor; },
  },
  dev: {
    state: devState, doorState: devDoorState, startSit: startDevSit, startApproach, startLoungeSit,
    chairs: DEV_SEAT_IDS,
    seats: loungeSeats.map((s7, i) => ({ i, id: s7.id, slot: s7.label })).filter((r) => r.id.startsWith(DEV_ROOM.id)),
    approaches: { bookcase: DEV_BOOKCASE_ID, board: DEV_BOARD_ID, servers: DEV_SERVERS_ID, tools: DEV_TOOL_ID, tea: DEV_TEA_ID, schematic: DEV_SCHEMATIC_ID, pantry: DEV_PANTRY_ID },
    stand: () => { devSeat?.stand(); loungeSeat?.stand(); },
    get seat() { return devSeat; }, get lounge() { return loungeSeat; }, get door() { return devDoor; },
  },
  qa: {
    state: qaState, doorState: qaDoorState, startSit: startQaSit, startApproach, startLoungeSit,
    chairs: QA_SEAT_IDS,
    seats: loungeSeats.map((s8, i) => ({ i, id: s8.id, slot: s8.label })).filter((r) => r.id.startsWith(QA_ROOM.id)),
    approaches: { storage: QA_STORAGE_ID, supply: QA_SUPPLY_ID, shelf: QA_SHELF_ID, window: QA_WINDOW_ID },
    stand: () => { qaSeat?.stand(); loungeSeat?.stand(); },
    get seat() { return qaSeat; }, get lounge() { return loungeSeat; }, get door() { return qaDoor; },
  },
  edit: { session: edit, editState, movePlantTo: (x: number, z: number) => { edit.setEditMode(true); edit.select(HERO_PLANT_ID); const v = edit.preview({ x, z }); refreshEditVisuals(); return v; }, confirm: () => { const v = edit.confirm(); refreshEditVisuals(); return v; }, cancel: () => { edit.cancel(); refreshEditVisuals(); }, reset: () => { edit.reset(); refreshEditVisuals(); }, setEditMode: (v: boolean) => { params.editMode = v; edit.setEditMode(v); if (v) edit.select(HERO_PLANT_ID); refreshEditVisuals(); refresh(); } },
};
