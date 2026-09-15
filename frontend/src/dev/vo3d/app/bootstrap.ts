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
  MONUMENT_INTERACTION_ID as HUB_MONUMENT_ID, SHELF_INTERACTION_ID as HUB_SHELF_ID, TOUCAN_PERCH,
  CHAMPIONSHIP_ENTRANCE_ID } from "../rooms/central-hub";
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
import { CAVE_ROOM, CAVE_ID, EXIT_INTERACTION_ID as CAVE_EXIT_ID, SCREEN_INTERACTION_ID as CAVE_SCREEN_ID,
  FLOOR_RECT as CAVE_FLOOR_RECT, OUTER_RECT as CAVE_OUTER_RECT, SPAWN as CAVE_SPAWN, VESTIBULE_RECT as CAVE_VESTIBULE_RECT,
  caveEntities, caveStandTest, inCave } from "../rooms/cave";
import { buildCave, CAVE_METRICS, attachCaveVideo, setCavePresentation, setCaveWrapAmbient } from "../build/cave";
import { CaveMedia } from "../media/CaveMedia";
import { CavePresentation } from "../media/CavePresentation";
import { CaveLiveShare, CAVE_MEETING_ID } from "../media/CaveLiveShare";
import { CaveGallery } from "../media/CaveGallery";
import { CaveTransition } from "../interact/CaveTransition";
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
import type { ThunderEvent } from "../env/Lightning";
import { ManualWeatherProvider } from "../env/providers/manual";
import { WEATHER_ATTRIBUTION, officeWeatherProvider } from "../env/providers/office";
import { GRADE } from "../world/campus";
import { CAMERA_MODES, CameraModes, type CameraModeId } from "../render/CameraModes";
import { PlayerMode, PLAYER_SPRINT_SPEED, PLAYER_WALK_SPEED, SPRINT_MULTIPLIER } from "../player/PlayerMode";
import { EnvironmentalAudio } from "../audio/EnvironmentalAudio";
import { EdgeTracker, Footsteps } from "../audio/events";
import { CALL_RANGE, Toucan } from "../world/Toucan";
import { spatial } from "../audio/sfx";
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
import { DEFAULT_LIGHT, Renderer } from "../render/Renderer";
import { SceneMirror } from "../render/SceneMirror";
import { Avatar } from "../avatar/Avatar";
import { ControllerStack, NavigationController } from "../avatar/Controller";
import { SeatInteraction } from "../interact/Seat";
import { EditSession, SNAP_DEGREES, SNAP_STEP } from "../editor/EditSession";
import { applyEditablePolicy, lockLabel, lockReason, type LockReason } from "../editor/editable";
import { EditorGizmo, yawToward } from "../editor/EditorGizmo";
import { EditorPanel, type PanelMode } from "../editor/EditorPanel";
import { ASSET_LIBRARY, findAsset } from "../editor/library";
import { SurfaceRegistry, surfaceTagOf, type SurfaceSpec } from "../editor/surfaces";
import { LedRegistry, ledTagOf, type EmissiveSpec } from "../editor/emissive";
import { LayoutStore, layoutIsEmpty } from "../editor/persistence";
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
// ---- the Championship Cave: a SECOND INTERIOR VOLUME, outside the V1 frame ----------------------
// The immersive theatre you reach through the hub monument's portal. It is registered as a real room
// with a real walkable region, and it is EAST OF THE OFFICE — 1,146 units clear of the V1 frame — so
// it cannot touch a cell of the read-only V1 grid or a square unit of the eleven reconstructed rooms.
// rooms/cave.ts carries the full reasoning; the three lines here are the whole integration.
//
// The world's BOUNDS have to grow to cover it, or WorldState.regionAt refuses every point out there
// before it even looks at a region. Growing them changes nothing inside the office: a point beyond the
// frame still belongs to no region and is still not walkable — it is now merely asked.
world.addRoom(CAVE_ROOM);
for (const e of caveEntities()) world.addEntity(e);
world.addRegion({ id: `floor:${CAVE_ID}`, kind: "room-floor", rect: CAVE_FLOOR_RECT, walkable: true, roomId: CAVE_ID });
// the threshold pocket is south of the floor rect and is its own region: PlayerMode scopes interaction
// candidates by the region's roomId, so a body standing in an unclaimed recess targets nothing — and the
// way out lives in that recess (rooms/cave.ts VESTIBULE_RECT)
world.addRegion({ id: `threshold:${CAVE_ID}`, kind: "room-floor", rect: CAVE_VESTIBULE_RECT, walkable: true, roomId: CAVE_ID });
world.bounds = {
  x: Math.min(plan.frame.x, CAVE_OUTER_RECT.x), z: Math.min(plan.frame.z, CAVE_OUTER_RECT.z),
  w: Math.max(plan.frame.x + plan.frame.w, CAVE_OUTER_RECT.x + CAVE_OUTER_RECT.w) - Math.min(plan.frame.x, CAVE_OUTER_RECT.x),
  d: Math.max(plan.frame.z + plan.frame.d, CAVE_OUTER_RECT.z + CAVE_OUTER_RECT.d) - Math.min(plan.frame.z, CAVE_OUTER_RECT.z),
};
const inBounds = (p: Vec2): boolean => world.walkableAt(p);

// ROOM EDITOR V2 — which pieces the editor may arrange. A read-only classification of data the rooms
// already author (editor/editable.ts), applied once here so no room file carries editor knowledge.
// Architecture and world-anchored functional furniture are excluded by the rule, not by a list.
const EDITABLE_IDS = applyEditablePolicy(world);

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
  lightAzimuth: DEFAULT_LIGHT.azimuth, lightElevation: DEFAULT_LIGHT.elevation, keyIntensity: DEFAULT_LIGHT.keyIntensity,
  ambientIntensity: DEFAULT_LIGHT.ambientIntensity, envIntensity: DEFAULT_LIGHT.envIntensity, exposure: DEFAULT_LIGHT.exposure,
  shadows: true, ao: true, sway: true, ambient: true, wallHeight: DESIGN_SHELL.wallHeight, frontWall: "low" as "low" | "full" | "hidden",
  overlay: true, motion: false, preset: "A" as PresetId, captureSeconds: 30,
  envTime: "auto" as EnvTimeMode, envScenery: true, envFog: true, envSky: true,
  envWeather: "auto" as WeatherMode, envRainInOffice: true, envTransitions: true, envLightning: true,
  cameraMode: "office" as CameraModeId,
  playerView: "third" as PlayerView,
  avatar: true, avatarLod: 1 as AvatarLod, avatarLit: true, walkSpeed: PLAYER_WALK_SPEED,
  envAudio: true, envAudioVolume: 0.7,
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
// THE CAVE'S SCENE GRAPH, built once and added to the SCENE rather than to the office mirror: the two
// volumes are never drawn at the same time, and keeping them as siblings is what lets one visibility
// flag turn each of them off whole. It comes back hidden — nothing in here is drawn, and no video is
// fetched or decoded, until somebody walks through the monument's portal.
const caveBuild = buildCave();
R.scene.add(caveBuild.group);
const caveMedia = new CaveMedia();
// PRESENTATION MODE (a live LiveKit screen share on the front panel). Both objects are inert until
// somebody explicitly connects: the bridge's LiveKit import is dynamic, and the adapter holds no
// element and no texture until it has BOTH a share and a body in the CAVE. Nothing below runs, or
// allocates, in an ordinary session.
const cavePresentation = new CavePresentation();
const caveGallery = new CaveGallery(caveBuild);
const caveLiveShare = new CaveLiveShare({
  onShare: (source, presenter) => cavePresentation.setSource(source, presenter),
  onCameras: (cameras) => caveGallery.setCameras(cameras),
});

/** THE ONE PLACE THE CAVE DECIDES WHAT IT IS SHOWING. Called only when something actually changed
 *  (a share, a camera set, a shape, entering or leaving), never per frame.
 *
 *  Four states, in strict priority order:
 *
 *    1. A SCREEN SHARE      the front panel carries it at true aspect and stays readable; the
 *                           cameras move to the two wings; the wrap goes dark behind them. A share
 *                           is presentation content and outranks every face in the room.
 *    2. ONE CAMERA          the immersive speaker view: the true-aspect copy on the same front
 *                           panel, and the 270° wrap carrying a DIMMED continuation of it. The
 *                           room fills with the speaker without the speaker being stretched.
 *    3. TWO OR MORE         the gallery owns the whole wrap: tiles across the chord, the corners
 *                           and the wings, reflowing as people come and go.
 *    4. NOTHING             SUNTOUCAN, exactly as before — the CAVE with no meeting in it.
 *
 *  Every meeting state PAUSES the boxing video, which stops its decode and its audio dead: the room
 *  never decodes a stream it is not showing, and never plays two soundtracks. Leaving the meeting
 *  resumes it where it stopped. */
function applyCaveMode(): void {
  const inside = caveTransition?.inside ?? false;
  const share = cavePresentation.texture;
  const solo = caveGallery.solo;

  if (share) {
    setCavePresentation(caveBuild, share, cavePresentation.aspect);
    caveGallery.setMode("wings");
    caveMedia.pause();
    return;
  }
  if (solo) {
    // Panel first (it also darkens the wrap), then the wrap is given the dimmed continuation.
    setCavePresentation(caveBuild, solo.texture, solo.aspect);
    setCaveWrapAmbient(caveBuild, solo.texture);
    caveGallery.setMode("full");
    caveMedia.pause();
    return;
  }
  if (caveGallery.count > 0) {
    setCavePresentation(caveBuild, null);
    setCaveWrapAmbient(caveBuild, null);
    caveGallery.setMode("full");
    caveMedia.pause();
    return;
  }
  caveGallery.setMode("off");
  setCavePresentation(caveBuild, null);
  const video = caveMedia.texture;
  if (video) attachCaveVideo(caveBuild, video);
  // Resuming is only right if somebody is actually standing in here; the transition owns play/pause
  // in every other case.
  if (inside) caveMedia.play();
}

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
const envState = {
  phase: "—", realPhase: "—", clock: "—", source: "V1 real clock (Asia/Manila)", weather: "—", observed: "—",
  provider: "—", attribution: WEATHER_ATTRIBUTION, wind: "—", wetness: "—", storm: "—", thunder: "none yet",
};
// THE THUNDER SEAM, SUBSCRIBED BUT NOT PLAYED.
//
// Lightning emits a ThunderEvent the instant the sky lights, carrying the strike's strength, how far away
// the fiction put it and how many seconds later the clap should be heard. NOTHING HERE PLAYS A SOUND and
// no audio API is touched: the spatial ambient-audio system is a later phase, and a half-built player
// waiting for it here would be a competing architecture, not a head start. All this does is print the
// event on the dev panel and keep the last one where that phase (and a test) can read it.
let lastThunder: ThunderEvent | null = null;
/** forward reference to the environmental mixer, which is built after the environment it listens to */
let envAudioRef: EnvironmentalAudio | null = null;
/** whoever the dev API / a later audio phase hooked up. Kept BESIDE the readout rather than replacing it,
 *  so subscribing cannot silently switch the dev panel off. */
let thunderListener: ((e: ThunderEvent) => void) | null = null;
env.onThunder = (e) => {
  lastThunder = e;
  // THE AUDIO PHASE'S CONSUMER, at last. No second scheduler: the delay, the strength and the distance are
  // all the event's, and the mixer only waits and plays. Declared lazily because the mixer is constructed
  // further down this file than the environment is.
  envAudioRef?.thunder(e);
  envState.thunder = `${e.strength.toFixed(2)} @ ${e.distanceKm.toFixed(1)}km — clap in ${e.delaySeconds.toFixed(1)}s${e.double ? " (double)" : ""}`;
  thunderListener?.(e);
};
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
// ONE SPEED, TWO CONSUMERS. The slider drives both the click-to-walk router and the direct-control player;
// the controller's own class default is the figure the walk clip was authored for, and would otherwise
// leave the panel reading 70 while a planned walk still ambled at 30.
navCtl.speed = params.walkSpeed;
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
const loungeSeats = [...LOUNGE_SEAT_IDS, ...SOFA_SEAT_IDS, ...TUB_SEAT_IDS, SOFA_SEAT_ID, ...BAG_SEAT_IDS, ...HUB_LOUNGE_IDS, ...EXECUTIVE_LOUNGE_IDS, ...CMS_LOUNGE_IDS, ...DEV_LOUNGE_IDS, ...QA_LOUNGE_IDS].flatMap((id) =>
  world.get(id).capabilities.lounge!.slots.map((s, i) => ({
    id, index: i, view: mirror.view(id), label: s.id,
    // THE SLOT IS READ WHEN A SIT STARTS, NEVER CACHED. The room editor may have moved this sofa since
    // boot, and a moved piece's slots are rewritten in the same world transaction as its transform
    // (editor/anchors.ts). Holding the slot OBJECT here would have walked Bon to where the sofa used to be.
    get slot() { return world.get(id).capabilities.lounge!.slots[i]; },
  })),
);
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
// EXTERIOR IS OPEN TO THE PLAYER. `allowExterior` was authored false for V0 with the note that the flag
// "will open it later"; later is now. Nothing about the test relaxes — the sidewalk still has to pass the
// V1 grid, the rim samples and the region check like every other cell. What it opens is EXACTLY the one
// registered exterior region (exterior:sidewalk), because that is the only walkable exterior region there
// is: the campus, its roads, the pond and the future lots are SCENERY, added straight to the scene and
// never to the world graph, so they answer "not floor" by never having been floor. `world.bounds` is the
// V1 frame, and regionAt returns null outside it, so there is no unbuilt space to escape into either.
//
// PLAYER ONLY. officeStand feeds nothing but playerStand; click-to-walk and A* route on `walkability`
// and `inBounds`, which are untouched, so navigation behaves exactly as it did.
const officeStand = makeStandTest({ world, walkability, derived: derivedNav, radius: NAV_RADIUS, allowExterior: true });
/** THE ONE STAND TEST, over BOTH volumes.
 *
 *  Inside the CAVE the V1 lattice has nothing to say — the room is outside it — so the question is put
 *  to the only geometry that describes that room: its shell, its screen ring and its threshold
 *  (rooms/cave.ts caveStandTest). Everywhere else this is byte-for-byte the office's own test. It is a
 *  ROUTING of the question, not a relaxation of it: the CAVE's walls stop a body exactly as the
 *  office's do, and there is no point in either volume where both tests are consulted or neither is. */
const playerStand = (p: Vec2): boolean => (inCave(p) ? caveStandTest(p, NAV_RADIUS) : officeStand(p));
/** The third-person boom's probe. Same composition, a token radius: the camera must not end up inside a
 *  wall or over unbuilt floor, but it may perfectly well fly over a desk — and judging it at the BODY
 *  radius pulled the boom in to its minimum beside almost every piece of furniture in the building. */
const officeCameraProbe = makeStandTest({ world, walkability, derived: derivedNav, radius: 2, allowExterior: true });
const playerCameraProbe = (p: Vec2): boolean => (inCave(p) ? caveStandTest(p, 2) : officeCameraProbe(p));
/** the one bridge from a targeted entity id to V2's existing interaction path. Nothing is reimplemented:
 *  each branch is the same call the GUI button and the click-to-walk handler already make. */
/** Assigned just after PLAYER mode is constructed (it needs the body to place). Declared here because
 *  the interaction bridge below is handed to PlayerMode and therefore has to exist first. */
let caveTransition: CaveTransition | null = null;
function activateInteractable(id: string, kind: "seat" | "lounge" | "approach"): boolean {
  // THE PORTAL, both ways, and the screen's own controls. These are the only three interactions in the
  // world that are not a seat or a walk-up, so they are branched HERE — in the same bridge every other
  // verb goes through — rather than given a parallel activation path of their own.
  //
  // enter/exit return TRUE: PlayerMode has already released the avatar, the swap happens at black, and
  // PLAYER takes it back on the next idle frame exactly as it does after a finished seat. The screen
  // toggle returns FALSE on purpose — pausing a video is not an interaction that should own a body, and
  // false is what makes PlayerMode re-acquire immediately instead of standing Bon down.
  if (id === CHAMPIONSHIP_ENTRANCE_ID) return caveTransition?.enter() ?? false;
  if (id === CAVE_EXIT_ID) return caveTransition?.exit() ?? false;
  if (id === CAVE_SCREEN_ID) { caveMedia.toggle(); return false; }
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
  // the target marker hangs off the SCENE, not the office group: the CAVE hides the whole office while
  // you are inside it, and a marker parented to that group would vanish with it
  camera: R.playerCamera, canvas, overlayRoot: R.scene,
  radius: NAV_RADIUS, avatarHeight: BON_STANDING_HEIGHT,
  speed: () => params.walkSpeed,
  activate: activateInteractable,
  canStandUp: () => engagedSeat() !== null,
  standUp: () => engagedSeat()?.stand(),
  // hand the avatar over cleanly: stop the walker, cancel a half-finished approach, leave engaged seats
  // alone (PlayerMode simply does not move Bon while Interaction owns him, and takes over when it ends)
  yieldAvatar: () => { stopTour(); navCtl.stop(); approachCtl.cancel(); },
});

// ---- the Championship Cave: the portal ------------------------------------------------------------
caveTransition = new CaveTransition({
  build: caveBuild,
  media: caveMedia,
  // the WHOLE office, hidden while you are inside: eleven rooms and a ground floor stop being drawn,
  // which is most of the reason the CAVE can afford a 270° video at all
  officeRoot: mirror.root,
  place: (p, look, pitch) => {
    if (!playerMode.body.placeNear(p)) return false;
    avatar.setPosition(playerMode.body.pos);
    facePlayer(look, pitch); // body AND view, in both of this world's yaw conventions — see facePlayer
    return true;
  },
  portalPoint: () => ({ ...world.get(CHAMPIONSHIP_ENTRANCE_ID).capabilities.approach!.point }),
  portalLook: { x: 0, z: -1 }, // stepping back out of the monument, looking north into the hub
  setInterior: (on) => {
    if (env.setPresentation(on ? "interior" : params.cameraMode === "office" ? "office" : "world")) R.invalidateShadows();
  },
  invalidateShadows: () => R.invalidateShadows(),
  // The portal works from any camera mode: OFFICE hands over to PLAYER first, because a body that is
  // about to be teleported into a sealed volume has to be the thing driving.
  requirePlayer: () => {
    if (!playerMode.active) setCameraMode("player");
    return playerMode.active;
  },
});

// ---- environmental audio ------------------------------------------------------------------------
// THE WORLD'S OWN SOUND: wind, rain, room tone, the theatre's air, and thunder off the storm's existing
// event. It owns nothing else — LiveKit still owns every call track and CaveMedia still owns SUNTOUCAN,
// and this file hands the mixer neither. See audio/EnvironmentalAudio for the full ownership statement.
//
// THE LISTENER IS BON, not the camera: the OFFICE and EXPLORE rigs are a director's view of a world Bon
// is standing in, and pinning the ambience to a camera that can be zoomed out over the whole campus would
// make the mix a function of the UI. In PLAYER mode the two are the same point anyway.
/** Read LIVE, never cached: the monument is an editable piece, and its approach point rides its transform. */
const portalPoint = (): Vec2 => world.get(CHAMPIONSHIP_ENTRANCE_ID).capabilities.approach!.point;
const envAudio = new EnvironmentalAudio({
  sample: (into) => {
    const a = avatar.worldPosition();
    const p = { x: a.x, z: a.z };
    const inside = caveTransition?.inside ?? false;
    const region = inside ? null : world.regionAt(p);
    into.inCave = inside;
    into.regionKind = region?.kind ?? null;
    into.roomId = region?.roomId ?? null;
    into.portalDistance = inside ? Number.POSITIVE_INFINITY : (() => { const q = portalPoint(); return Math.hypot(p.x - q.x, p.z - q.z); })();
    // how far from the nearest outer wall of the building — small means "by the glass", which is the one
    // place an interior is allowed to hear the weather properly. Meaningless outdoors, hence Infinity.
    const f = plan.frame;
    into.edgeDistance = region && region.kind !== "exterior"
      ? Math.min(p.x - f.x, f.x + f.w - p.x, p.z - f.z, f.z + f.d - p.z)
      : Number.POSITIVE_INFINITY;
    into.weather = env.weather;
    into.intensity = weather.intensity;
    into.phase = env.phase ?? "day";
  },
  // THE ONLY THING A CALL IS EVER ASKED. A connected CAVE meeting pulls the whole environmental bus down
  // so speech sits on top of it; nothing is routed, published, subscribed or muted on the LiveKit side.
  meeting: () => caveLiveShare.state.status === "connected",
});
envAudio.arm(); // nothing is created or played until a real user gesture — see EnvironmentalAudio.arm

// ---- world foley -----------------------------------------------------------------------------------
// THE WHOLE FOLEY LAYER IS TWO OBJECTS AND ONE FUNCTION. Every sound below is played off a TRANSITION
// that the world was already reporting — a door's own `state`, a scanner's own activation, a seat's own
// status — so nothing new is tracked, nothing is polled that was not already on screen in the dev panel,
// and no interaction code is touched at all. `edges` answers "is this new?" (audio/events) and the mixer
// answers "play it" (audio/EnvironmentalAudio.play). That is the entire architecture.
const edges = new EdgeTracker();
const steps = new Footsteps();
/** where the listener is and which way he is facing — one object, rewritten, never allocated per event */
const ear = { pos: { x: 0, z: 0 }, yaw: 0 };
/** Play a world event AT a place: attenuated by how far away it is and panned by which side it is on. */
function playAt(kind: Parameters<typeof envAudio.play>[0], at: Vec2, range: number, gain = 1): void {
  const s2 = spatial(at, ear.pos, ear.yaw, range);
  if (s2.gain <= 0) return;
  envAudio.play(kind, { gain: gain * s2.gain, pan: s2.pan });
}
/** Every automatic door in the building, paired with the point its sound comes from. Built once. */
const doorSources: { id: string; door: () => { state: string }; at: Vec2 }[] = [];
const registerDoorSfx = (id: string, get: () => { state: string } | null | undefined): void => {
  const e = world.entities.get(id);
  if (!e) return;
  doorSources.push({ id, door: () => get() ?? { state: "closed" }, at: { ...e.transform.pos } });
};

// ---- the toucan ------------------------------------------------------------------------------------
// An exterior ambient creature, built on the GLB the app already ships (public/toucan/toucan.glb — the
// same asset V1's 2D ToucanFlyer uses). It is SCENERY: added to the scene, never to the world graph, so
// it has no footprint, is in no stand test and cannot be collided with.
const toucan = new Toucan(plan.frame);
R.scene.add(toucan.root);
void toucan.load().then((ok) => { if (ok) R.invalidateShadows(); });
// Every automatic door the building has. Registered by ENTITY ID, so the sound comes from where the door
// actually is and a door that is rebuilt (the Design Room's, under the geometry sliders) is still found.
registerDoorSfx(DOOR_ID, () => door);
registerDoorSfx(ENTRY_DOOR_WEST_ID, () => entryDoor);
registerDoorSfx(GAMING_DOOR_ID, () => gamingDoor);
registerDoorSfx(EXEC_DOOR_WEST_ID, () => execDoor);
registerDoorSfx(CMS_DOOR_NORTH_ID, () => cmsDoor);
registerDoorSfx(AI_DOOR_ID, () => aiDoor);
registerDoorSfx(DEV_DOOR_ID, () => devDoor);
registerDoorSfx(QA_DOOR_NORTH_ID, () => qaDoor);

/** THE ONE FOLEY TICK. Reads state the world was already publishing and plays the transitions.
 *
 *  Everything here is edge-gated (audio/events EdgeTracker): a door that is open plays nothing, a
 *  scanner that is still lit plays nothing, a seated avatar plays nothing. That is what keeps a foley
 *  layer from becoming a stuck buzzer, and it is why this can safely run at 60 Hz. */
function worldFoley(dt: number, body: Vec2): void {
  // THE BIRD FLIES WHETHER OR NOT ANYBODY IS LISTENING. Its update is the flight; the call it returns is
  // the only part that needs a mixer, so this runs before the audio guard rather than behind it.
  const outdoors = env.presentation === "world" && !(caveTransition?.inside ?? false);
  const wantsCall = toucan.update(dt, env.weather, env.phase ?? "day", outdoors);
  if (!envAudio.running) return;
  ear.pos.x = body.x;
  ear.pos.z = body.z;
  ear.yaw = playerMode.active ? playerMode.camera.yaw : avatar.yaw;

  // DOORS — the servo on the way open, the servo and its stop on the way closed. One sound per real
  // transition, whatever the frame rate, and nothing at all while a door sits open.
  for (const d of doorSources) {
    const st = d.door().state;
    if (!edges.changed(`door:${d.id}`, st)) continue;
    if (st === "opening") playAt("doorOpen", d.at, 620);
    else if (st === "closing") playAt("doorClose", d.at, 620);
  }

  // SENSORS — a Schmitt trigger, not a threshold: an activation hovering on a single level is exactly
  // how a detection chirp turns into a stutter.
  for (const id of mirror.ambient.scannerIds) {
    if (edges.crossed(`scan:${id}`, mirror.ambient.scannerActivation(id))) envAudio.play("scanner", { gain: 0.7 });
  }

  // SEATS — the chair being pulled out, the sitter landing, the sitter standing. Every movable-seat
  // controller in the building publishes the same status vocabulary (interact/Seat SeatState), so one
  // loop covers all of them and a lounge seat's simpler sit/stand falls out of the same table.
  for (const [key, st] of seatStatuses()) {
    if (!edges.changed(`seat:${key}`, st)) continue;
    if (st === "pullingOut" || st === "returningChair") envAudio.play("chairMove", { gain: 0.8, pitch: 0.95 + Math.random() * 0.1 });
    else if (st === "sitting") envAudio.play("chairSit", { gain: 0.9 });
    else if (st === "standing" || st === "slidingOut") envAudio.play("chairStand", { gain: 0.8 });
  }

  // WALK-UP ACTIVATIONS — the contextual "use the terminal / read the board" interactions. A state
  // CHANGE is the click; hovering something is not an event and gets no sound.
  if (edges.changed("approach", approachCtl.status) && approachCtl.status.startsWith("at ")) envAudio.play("click", { gain: 0.8 });

  // FOOTSTEPS — cadence from ground ACTUALLY covered (audio/events Footsteps), so they follow 70 and 100
  // for free, stop dead when the body stops, and never fire while an interaction is driving the avatar.
  if (playerMode.active && playerMode.state.owner === "Player") {
    const moved = playerMode.state.travelled;
    if (steps.advance(moved, playerMode.state.sprinting)) {
      envAudio.play("footstep", {
        hard: playerMode.state.sprinting,
        gain: playerMode.state.sprinting ? 0.9 : 0.7,
        // left and right are pitched apart, and each step is jittered, so no two are the same click
        pitch: (steps.left ? 1.06 : 0.94) * (0.96 + Math.random() * 0.08),
        pan: steps.left ? -0.12 : 0.12,
      });
    }
  } else steps.reset();

  // THE CAVE PORTAL — the hidden entrance being activated, and the threshold itself. `busy` goes true
  // exactly once per transition and covers both directions.
  if (edges.changed("cave", `${caveTransition?.state.where ?? "office"}:${caveTransition?.busy ?? false}`)) {
    if (caveTransition?.busy) envAudio.play("portal", { gain: 1 });
  }

  // THE TOUCAN'S CALL — played HERE rather than in the flyer, which owns timing and knows nothing about
  // audio. Panned and attenuated from where the bird actually is, so a pass overhead is heard to move.
  if (wantsCall) playAt("toucanCall", toucan.position, CALL_RANGE, 1);
}

/** Every movable/lounge seat's status, as (key, status) pairs. Rebuilt per frame from references that
 *  already exist — no controller is registered anywhere and none had to change. */
function seatStatuses(): [string, string][] {
  const out: [string, string][] = [["design", seat.status]];
  const named: [string, { status: string } | null][] = [
    ["meeting", meetingSeat], ["gaming", gamingSeat], ["hub", hubSeat], ["exec", execSeat],
    ["cms", cmsSeat], ["ai", aiSeat], ["dev", devSeat], ["qa", qaSeat], ["lounge", loungeSeat],
  ];
  for (const [k, c] of named) if (c) out.push([k, c.status]);
  return out;
}
envAudioRef = envAudio;

// ROOM EDITOR V2 — SLICE 2. The two addressable registries. They are populated from the room groups the
// mirror has ALREADY built (builders tag their meshes; nothing here knows a room), and both are handed the
// ambient system's retarget hook so a copy-on-write material swap never orphans a pulse or a power-down.
const surfaces = new SurfaceRegistry();
const leds = new LedRegistry();
surfaces.retarget = (from, to) => { mirror.ambient.retarget(from, to); };
leds.retarget = (from, to) => { mirror.ambient.retarget(from, to); };

// PERSISTENCE. The store takes the AUTHORED baseline here — after applyEditablePolicy, before a single
// saved edit is replayed — which is what makes "Reset to Authored Layout" a restore rather than a guess.
const layout = new LayoutStore({ world, mirror, walkability, surfaces, leds });
const savedLayout = layout.load();
// ENTITIES BEFORE COLLECT: a restored LED strip has to be in its room group before the registries walk it,
// or the piece would come back without being addressable in the Lighting tab.
const restored = savedLayout ? layout.restoreEntities(savedLayout) : null;
for (const room of world.rooms.values()) {
  const g = mirror.roomGroup(room.id);
  if (!g) continue;
  surfaces.collect(room.id, g);
  leds.collect(room.id, g);
}
const restoredTreatments = savedLayout ? layout.restoreTreatments(savedLayout) : null;
let layoutNote = restored && restoredTreatments
  ? `restored ${restored.moved} moved · ${restored.added} added · ${restored.deleted} deleted · ${restoredTreatments.surfaces + restoredTreatments.leds} treatments`
  : "no saved layout";
if (restored && restoredTreatments && restored.skipped + restoredTreatments.skipped > 0)
  layoutNote += ` · ${restored.skipped + restoredTreatments.skipped} stale entries dropped`;

const edit = new EditSession(world, mirror, walkability, stack, { surfaces, leds });
const editGizmo = new EditorGizmo(R.scene);
let editMode2: PanelMode = "object";
/** the library item the Assets tab has armed: the next floor click places it */
let armedAsset: string | null = null;
const editState = { selected: "none", placement: "—", drift: 0, yawDrift: 0, editable: EDITABLE_IDS.length, history: 0, blockedCells: walkability.dynamicBlockedKeys.length };
let editPanel: EditorPanel | null = null;
let editHint = "";

/** ONE refresh for every editor surface: ring + outline, floor marker, lil-gui readouts, the panel. */
function refreshEditVisuals(): void {
  const pos = edit.currentPos();
  const v = edit.validateCurrent();
  const on = edit.editMode && edit.selected !== null;
  navDebug.showSelection(on ? pos : null, v.ok);
  if (on && pos) { editGizmo.attachIfNeeded(edit.selected!, edit.view()); editGizmo.sync(pos, edit.currentYaw(), v.ok); }
  else editGizmo.hide();
  editState.selected = edit.selected ?? "none";
  editState.placement = !edit.selected ? "—" : v.ok ? (edit.previewing ? "valid (unconfirmed)" : "committed") : `invalid: ${v.reason}`;
  editState.drift = Math.round(edit.drift() * 1000) / 1000;
  editState.yawDrift = edit.yawDrift();
  editState.history = edit.history.depth;
  editState.blockedCells = navDebug.refreshDynamic(walkability);
  const surf = edit.selectedSurface ? surfaces.get(edit.selectedSurface) : null;
  const led = edit.selectedLed ? leds.get(edit.selectedLed) : null;
  editPanel?.render({
    mode: editMode2,
    name: edit.selected ?? surf?.tag.label ?? led?.tag.label ?? null,
    room: edit.selected ? world.get(edit.selected).roomId : (surf?.tag.roomId ?? led?.tag.roomId ?? ""),
    x: pos?.x ?? 0, z: pos?.z ?? 0, yaw: edit.currentYawDegrees(),
    snap: edit.snap.enabled, snapStep: edit.snap.step, snapDegrees: edit.snap.degrees,
    status: editStatus(v, surf !== null || led !== null),
    valid: v.ok || edit.selected === null, pending: edit.hasPending, canUndo: edit.canUndo, canRedo: edit.canRedo,
    deleteBlocked: edit.selected ? deleteHint(edit.selected) : "nothing selected",
    assetKey: armedAsset,
    surfaces: surfaces.all().map((e) => ({ id: e.id, label: e.tag.label, kind: e.tag.kind })),
    surfaceId: edit.selectedSurface, surfaceSpec: surf ? { ...surf.preview } : null,
    leds: leds.all().map((e) => ({ id: e.id, label: `${e.tag.label}` })),
    ledId: edit.selectedLed, ledSpec: led ? { ...led.preview } : null,
    layoutDirty: !layoutIsEmpty(layout.counts(edit.pending)),
    layoutNote,
    hint: editMode2 === "assets" ? "pick an asset · click the floor to place · ⏎ confirm · esc cancel"
      : editMode2 === "object" ? "drag piece · drag ring to rotate · ⏎ confirm · esc cancel · ⌘Z undo"
      : "click a surface or light in the scene · ⏎ apply · esc cancel",
  });
}
/** THE MODE SWITCH — one focused tool at a time, and one implementation of what that means, so the dev
 *  handle and the panel button can never drift apart. */
function setEditorMode(m: PanelMode): PanelMode {
  editMode2 = m;
  if (m !== "assets") armedAsset = null;
  if (m === "object" || m === "assets") { edit.selectSurface(null); edit.selectLed(null); }
  else edit.select(null);
  refreshEditVisuals();
  return editMode2;
}

/** One status line for four modes. */
function editStatus(v: ReturnType<typeof edit.validateCurrent>, treatment: boolean): string {
  if (edit.selected) return v.ok ? (edit.previewing ? (edit.pending ? "new piece — unconfirmed" : "valid — unconfirmed") : "placed") : `blocked: ${v.reason}`;
  if (treatment) return edit.hasPending ? "treatment — unapplied" : "applied";
  if (editMode2 === "assets") return armedAsset ? "click the floor to place" : "pick an asset";
  return editHint || `${EDITABLE_IDS.length} editable pieces · ${surfaces.size} surfaces · ${leds.size} lights`;
}
function deleteHint(id: string): string | null {
  const why = edit.deleteBlockedBecause(id);
  return why === null ? null : why === "system" ? "gameplay piece — movable, but protected from deletion" : "not an editable piece";
}

/** EDIT mode owns a panel for as long as it is on, and nothing when it is off. */
function setEditMode(on: boolean): void {
  params.editMode = on;
  edit.setEditMode(on);
  if (on && !editPanel) {
    editPanel = new EditorPanel(document.body, {
      setMode: setEditorMode,
      duplicate: () => { edit.duplicate(); refreshEditVisuals(); },
      remove: () => { edit.remove(); refreshEditVisuals(); },
      pickAsset: (key) => { armedAsset = key; refreshEditVisuals(); },
      pickSurface: (id) => { edit.selectSurface(id); refreshEditVisuals(); },
      setSurface: (spec: SurfaceSpec) => { edit.previewSurface(spec); refreshEditVisuals(); },
      pickLed: (id) => { edit.selectLed(id); refreshEditVisuals(); },
      setLed: (spec: EmissiveSpec) => { edit.previewLed(spec); refreshEditVisuals(); },
      setAxis: (axis, value) => { edit.setAxis(axis, value); refreshEditVisuals(); },
      setYaw: (deg) => { edit.setYawDegrees(deg); refreshEditVisuals(); },
      nudgeYaw: (deg) => { edit.nudgeYawDegrees(deg); refreshEditVisuals(); },
      setSnap: (v) => { edit.snap.enabled = v; refreshEditVisuals(); },
      undo: () => { edit.undo(); refreshEditVisuals(); },
      redo: () => { edit.redo(); refreshEditVisuals(); },
      confirm: () => { edit.confirm(); refreshEditVisuals(); },
      cancel: () => { edit.cancel(); refreshEditVisuals(); },
      reset: () => { edit.reset(); refreshEditVisuals(); },
      // SAVE IS EXPLICIT and excludes the unconfirmed placement, so a piece still under the cursor is
      // never written. Cancel has no path here at all: nothing but this button persists anything.
      save: () => {
        const doc = layout.save(edit.pending);
        layoutNote = doc
          ? `saved ${doc.moved.length} moved · ${doc.added.length} added · ${doc.deleted.length} deleted · ${doc.surfaces.length + doc.leds.length} treatments`
          : "local storage unavailable — nothing saved";
        refreshEditVisuals();
      },
      resetLayout: () => {
        const r = layout.resetToAuthored();
        edit.history.clear();
        edit.select(null);
        layoutNote = `reset to authored · ${r.moved} moved · ${r.added} added · ${r.deleted} deleted reverted`;
        refreshEditVisuals();
      },
      close: () => { setEditMode(false); refresh(); },
    });
  }
  if (!on) { editPanel?.dispose(); editPanel = null; editHint = ""; armedAsset = null; editMode2 = "object"; }
  refreshEditVisuals();
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
/** what a live editor drag means: nothing, sliding the piece on the floor, or turning it around Y */
let editDrag: "none" | "move" | "rotate" = "none";
/** pointer→piece offset captured on grab, so a piece does not jump its centre under the cursor */
let grabOffset: Vec2 = { x: 0, z: 0 };

/** The FIRST editable piece under the pointer. Architecture and locked functional furniture are not in
 *  `editable()` at all, so they can never be picked by accident; a click on one reports WHY. */
function pickEditable(cx: number, cy: number): { id: string } | null {
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, R.camera);
  let best: { id: string; d: number } | null = null;
  for (const en of edit.editable()) {
    const h = raycaster.intersectObject(mirror.view(en.id), true)[0];
    if (h && (!best || h.distance < best.d)) best = { id: en.id, d: h.distance };
  }
  return best ? { id: best.id } : null;
}
/** What the pointer hit when it hit nothing editable — used only to explain the refusal, never to edit. */
function pickLocked(cx: number, cy: number): { id: string; reason: LockReason } | null {
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, R.camera);
  for (const h of raycaster.intersectObject(mirror.root, true)) {
    for (let o: THREE.Object3D | null = h.object; o; o = o.parent) {
      const e = world.entities.get(o.name);
      if (!e) continue;
      const why = lockReason(e);
      return why ? { id: e.id, reason: why } : null;
    }
  }
  return null;
}
/** The first addressable SURFACE or LED channel under the pointer — how Surface and Lighting mode select.
 *  Deliberately the same raycast the object picker uses; only the tag it looks for differs. */
function pickTagged(cx: number, cy: number): { surface?: string; led?: string } | null {
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, R.camera);
  for (const h of raycaster.intersectObject(mirror.root, true)) {
    if (editMode2 === "lighting") { const t = ledTagOf(h.object); if (t) return { led: t.id }; }
    else { const t = surfaceTagOf(h.object); if (t) return { surface: t.id }; }
  }
  return null;
}
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || playerMode.active) return; // PLAYER owns the canvas: see player/PlayerInput
  if (edit.editMode && (editMode2 === "surface" || editMode2 === "lighting")) {
    // SURFACE / LIGHTING mode retargets the click entirely: a floor is a surface here, not a place to
    // drop something, and the orbit camera keeps the drag.
    const t = pickTagged(e.clientX, e.clientY);
    if (t?.surface) edit.selectSurface(t.surface);
    else if (t?.led) edit.selectLed(t.led);
    refreshEditVisuals();
    return;
  }
  if (edit.editMode && editMode2 === "assets" && armedAsset) {
    const p = floorPoint(e.clientX, e.clientY);
    const item = findAsset(armedAsset);
    if (p && item) {
      const r = edit.placeAsset(item, p);
      editHint = r.id ? "" : `cannot place here: ${r.check.ok ? "" : r.check.reason}`;
      if (r.id) { editDrag = "move"; grabOffset = { x: 0, z: 0 }; R.controls.enabled = false; e.preventDefault(); }
      refreshEditVisuals();
      return;
    }
  }
  if (edit.editMode) {
    const floor = floorPoint(e.clientX, e.clientY);
    const centre = edit.currentPos();
    // THE RING WINS. It is drawn outside the piece, so testing it first is what makes a turn a turn and
    // not a move — exactly the priority a level editor's gizmo has over the object it surrounds.
    if (centre && floor && edit.selected && editGizmo.onRing(floor, centre)) {
      editDrag = "rotate"; R.controls.enabled = false; e.preventDefault(); refreshEditVisuals(); return;
    }
    const picked = pickEditable(e.clientX, e.clientY);
    if (picked) {
      edit.select(picked.id);
      const p = edit.currentPos()!;
      grabOffset = floor ? { x: p.x - floor.x, z: p.z - floor.z } : { x: 0, z: 0 };
      editDrag = "move"; R.controls.enabled = false; editHint = ""; e.preventDefault();
    } else if (!edit.previewing) {
      // clicking empty space deselects; clicking a LOCKED piece says so instead of failing silently
      const blocked = pickLocked(e.clientX, e.clientY);
      editHint = blocked ? `${blocked.id} — ${lockLabel[blocked.reason]}` : "";
      edit.select(null);
      editGizmo.hide();
    }
    refreshEditVisuals();
    return;
  }
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener("pointermove", (e) => {
  if (playerMode.active || !edit.editMode || editDrag === "none") return;
  const p = floorPoint(e.clientX, e.clientY);
  if (!p) return;
  if (editDrag === "move") edit.preview({ x: p.x + grabOffset.x, z: p.z + grabOffset.z });
  else { const c = edit.currentPos(); if (c) edit.previewYaw(yawToward(c, p)); } // position held: the pivot IS the transform
  refreshEditVisuals();
});
canvas.addEventListener("pointerup", (e) => {
  if (playerMode.active) return;
  if (editDrag !== "none") { editDrag = "none"; R.controls.enabled = true; refreshEditVisuals(); return; }
  if (!downAt || e.button !== 0) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y), held = performance.now() - downAt.t;
  downAt = null;
  if (moved > 6 || held > 400 || !params.clickToWalk) return; // a drag = orbit, not a walk
  const picked = pickInteraction(e.clientX, e.clientY);
  if (picked) {
    const ent = world.get(picked);
    // the portal is a transition, not a walk-up: clicking it has to mean the same thing pressing E on
    // it means, or the one interaction in the world that moves you between volumes would behave
    // differently depending on which camera you happened to be in
    if (picked === CHAMPIONSHIP_ENTRANCE_ID || picked === CAVE_EXIT_ID || picked === CAVE_SCREEN_ID) activateInteractable(picked, "approach");
    else if (ent.capabilities.lounge) startLoungeSit(LOUNGE_SEAT_IDS.indexOf(picked));
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
light.add(params, "keyIntensity", 0, 6, 0.05).onChange(applyLight); light.add(params, "ambientIntensity", 0, 3, 0.05).onChange(applyLight);
light.add(params, "envIntensity", 0, 1.5, 0.05).onChange(applyLight); light.add(params, "exposure", 0.5, 1.6, 0.01).onChange(applyLight);
light.add(params, "shadows").onChange((v: boolean) => R.setShadows(v)); light.add(params, "ao").name("SSAO (Full Graphics baseline — off for A/B)").onChange((v: boolean) => (R.ssaoEnabled = v));
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
wxGui.add(envState, "wind").name("wind on foliage").listen().disable();
wxGui.add(envState, "wetness").name("ground wetness").listen().disable();
// SMOOTH TRANSITIONS, and the switch that turns them off. A screenshot rig wants the target grade on the
// frame it asks for it, not a second and a half later; everything else wants the fade.
wxGui.add(params, "envTransitions").name("smooth transitions").onChange((v: boolean) => (env.transitions = v));
// THE STORM. Lightning only ever schedules itself under RAIN / HEAVY_RAIN / THUNDERSTORM (env/weatherGrade
// LIGHTNING), so this switch is a dev mute, not the thing that decides whether it strikes.
wxGui.add(params, "envLightning").name("lightning").onChange((v: boolean) => (env.storm.enabled = v));
wxGui.add(envState, "storm").name("next strike").listen().disable();
// ⚡ THE DETERMINISTIC QA PATH. This is the EXISTING strike path — env.storm.strike() is the same method
// the scheduler itself calls — so a click produces a real ThunderEvent with a real distance, the real
// speed-of-sound delay, the real flash and the real bolt. There is no second lightning implementation.
wxGui.add({ strike: () => env.storm.strike() }, "strike").name("⚡ Trigger Lightning (→ delay → thunder)");
// The event the ambient-audio phase will consume. Printed here so the seam is visibly live before
// anything can play it.
wxGui.add(envState, "thunder").name("last thunder event").listen().disable();
// ATTRIBUTION. WeatherAPI's terms require visible credit wherever their data is shown. It belongs on
// the panel that shows the reading, not in the 3D scene — the office is the product, not a billboard.
wxGui.add(envState, "attribution").name("data").listen().disable();
// ---- environmental audio -------------------------------------------------------------------------
// ONE SWITCH AND ONE LEVEL, deliberately. This is not a settings system: it is the dev control that
// proves the mixer starts on a gesture, stops cleanly, and never grows a node. Everything the mix
// actually does is decided by where Bon is standing, what the weather is and what time it is.
const audGui = gui.addFolder("Environment audio (world · weather · thunder)");
audGui.add(params, "envAudio").name("🔊 environment audio").onChange((v: boolean) => { if (v) envAudio.start(); envAudio.setEnabled(v); });
audGui.add(params, "envAudioVolume", 0, 1, 0.01).name("master volume").onChange((v: number) => envAudio.setVolume(v));
audGui.add(envAudio.state, "status").name("audio context").listen().disable();
audGui.add(envAudio.state, "enabled").name("enabled").listen().disable();
audGui.add(envAudio.state, "zone").name("zone in force").listen().disable();
audGui.add(envAudio.state, "nodes").name("live audio nodes").listen().disable();
audGui.add(envAudio.state, "voices").name("one-shot voices").listen().disable();
audGui.add(envAudio.state, "timers").name("pending timers").listen().disable();
audGui.add(envAudio.state, "contexts").name("AudioContexts").listen().disable();
audGui.add(envAudio.state, "claps").name("thunderclaps heard").listen().disable();
audGui.add(envAudio.state, "suppressed").name("claps suppressed (CAVE)").listen().disable();
audGui.add(envAudio.state, "duck").name("meeting duck").listen().disable();
audGui.add(envAudio.state, "sfx").name("foley events played").listen().disable();
audGui.add(envAudio.state, "dropped").name("foley dropped (pool full)").listen().disable();

// ---- the toucan ----------------------------------------------------------------------------------
const toucanGui = gui.addFolder("Toucan (exterior ambient life)");
toucanGui.add(toucan.state, "status").name("status").listen().disable();
toucanGui.add(toucan.state, "pos").name("position").listen().disable();
toucanGui.add(toucan.state, "activity").name("weather activity (0 = grounded)").listen().disable();
toucanGui.add(toucan.state, "calls").name("calls made").listen().disable();
toucanGui.add(toucan.state, "nextCall").name("next call in (s)").listen().disable();
toucanGui.add({ f: () => toucan.reset() }, "f").name("▶ restart its lap");
const geo = gui.addFolder("Geometry");
const rebuild = () => {
  seat.reset();
  mirror.rebuildRoom(DESIGN_ROOM, shellOpts());
  // the room's meshes are new objects, so its addressable surfaces and lights are re-collected with them
  const g = mirror.roomGroup(DESIGN_ROOM.id);
  if (g) { surfaces.collect(DESIGN_ROOM.id, g); leds.collect(DESIGN_ROOM.id, g); }
  if (edit.selectedSurface?.startsWith(DESIGN_ROOM.id)) edit.selectSurface(null);
  door = new SlidingDoor(mirror.view(DOOR_ID), doorEntity.capabilities.door!, doorEntity.transform.pos);
  seat = new SeatInteraction(avatar, stack, mirror.view(CHAIR_4_ID), chairSeat, (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
};
geo.add(params, "wallHeight", 20, 110, 1).onFinishChange(rebuild); geo.add(params, "frontWall", ["low", "full", "hidden"]).onChange(rebuild);
geo.add(params, "sway").name("plant sway").onChange((v: boolean) => (mirror.sway.enabled = v));
geo.add(params, "ambient").name("powered-electronics idle").onChange((v: boolean) => (mirror.ambient.enabled = v));
const av = gui.addFolder("Character (production GLB)");
av.add(params, "avatar").name("show avatar").onChange((v: boolean) => (avatar.root.visible = v));
av.add(params, "avatarLod", [0, 1, 2]).name("LOD").onChange(loadAvatar);
av.add(params, "avatarLit").name("lit (off = production unlit)").onChange((v: boolean) => avatar.setLit(v));
av.add(params, "walkSpeed", 8, 120, 1).name(`speed (units/s) — sprint x${SPRINT_MULTIPLIER.toFixed(2)}`).onChange((v: number) => (navCtl.speed = v));
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

const editGui = gui.addFolder("Room editor (select → move / rotate → confirm)");
editGui.add(params, "editMode").name("✎ edit mode").onChange((v: boolean) => { setEditMode(v); });
editGui.add(edit.snap, "enabled").name(`grid snap (${SNAP_STEP}u · ${SNAP_DEGREES}°)`).listen().onChange(() => refreshEditVisuals());
editGui.add({ confirm: () => { const v = edit.confirm(); editState.placement = v.ok ? "committed" : `rejected: ${v.reason}`; refreshEditVisuals(); } }, "confirm").name("✔ confirm placement");
editGui.add({ cancel: () => { edit.cancel(); refreshEditVisuals(); } }, "cancel").name("✖ cancel (revert to committed)");
editGui.add({ reset: () => { edit.reset(); refreshEditVisuals(); } }, "reset").name("reset to original");
editGui.add({ duplicate: () => { edit.duplicate(); refreshEditVisuals(); } }, "duplicate").name("⧉ duplicate selection");
editGui.add({ remove: () => { const r = edit.remove(); if (!r.ok) editHint = `delete refused: ${r.reason}`; refreshEditVisuals(); } }, "remove").name("🗑 delete selection");
editGui.add({ undo: () => { edit.undo(); refreshEditVisuals(); } }, "undo").name("↶ undo");
editGui.add({ redo: () => { edit.redo(); refreshEditVisuals(); } }, "redo").name("↷ redo");
editGui.add(editState, "selected").disable().listen(); editGui.add(editState, "placement").disable().listen(); editGui.add(editState, "drift").disable().listen();
editGui.add(editState, "yawDrift").name("yaw drift °").disable().listen();
editGui.add(editState, "editable").name("editable pieces").disable().listen(); editGui.add(editState, "history").name("undo depth").disable().listen();
editGui.add(editState, "blockedCells").name("dynamic blocked cells").disable().listen();

// EDITOR KEYS. Capture-phase, scoped to edit mode, and never while a panel field has focus — typing a
// coordinate must not confirm the placement being typed.
window.addEventListener("keydown", (e) => {
  if (!edit.editMode) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) edit.redo(); else edit.undo(); }
  else if (e.key === "Enter") { e.preventDefault(); edit.confirm(); }
  else if (e.key === "Escape") { e.preventDefault(); if (edit.hasPending) edit.cancel(); else { edit.select(null); editGizmo.hide(); } }
  else if (e.key.toLowerCase() === "g") { edit.snap.enabled = !edit.snap.enabled; }
  else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); edit.remove(); }
  else if (meta && e.key.toLowerCase() === "d") { e.preventDefault(); editMode2 = "object"; edit.duplicate(); }
  else if (e.key === "[") { edit.nudgeYawDegrees(-SNAP_DEGREES); }
  else if (e.key === "]") { edit.nudgeYawDegrees(SNAP_DEGREES); }
  else return;
  refreshEditVisuals();
});
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
/** Drop Bon on the monument portal's own walk-up point. The CAVE is on the far side of the office from
 *  the Design Room spawn, so without this the entrance simply cannot be reached in a dev session. */
/** POINT THE PLAYER ALONG A WORLD DIRECTION.
 *
 *  This world carries TWO yaw conventions that differ by π, and both have to be written or the body and
 *  the view disagree: an avatar's heading is `atan2(dx, dz)` (core/coords headingFor, which is what
 *  FACING_YAW and every walk animation speak), while PlayerCamera's is `atan2(dx, −dz)` (its `forward`
 *  is `(sin y, −cos y)`). Writing only the first is how a teleport lands a player facing the thing he
 *  just walked out of; writing only the second turns the camera and leaves the body pointing away.
 *
 *  So callers hand over a DIRECTION and this converts, once, here. */
function facePlayer(look: Vec2, pitch?: number): void {
  avatar.setYaw(Math.atan2(look.x, look.z));
  playerMode.camera.yaw = Math.atan2(look.x, -look.z);
  if (pitch !== undefined) playerMode.camera.pitch = pitch;
  playerMode.camera.snap();
}
/** Drop Bon on the monument portal's own walk-up point, facing the monument.
 *
 *  Moves whichever thing is actually DRIVING him. PLAYER rewrites the avatar transform from its own
 *  `body.pos` every frame, so setting the avatar alone while PLAYER is active is undone on the next
 *  tick — which is how a "go to the portal" button silently leaves you standing in the Design Room. */
function placeBonAtPortal(): void {
  const p = world.get(CHAMPIONSHIP_ENTRANCE_ID).capabilities.approach!.point;
  navCtl.setPath([]);
  if (playerMode.active) playerMode.body.placeNear(p);
  avatar.setPosition(playerMode.active ? playerMode.body.pos : p);
  facePlayer({ x: 0, z: 1 }); // looking south, at the monument's back and the portal cut into it
}
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
// ---- Championship Cave -------------------------------------------------------------------------------
const caveGui = gui.addFolder("Championship Cave (through the hub monument's portal)");
const caveState = {
  where: "office", busy: false, transitions: 0, last: "—",
  video: "absent", muted: false, blocked: "", time: "0 / 0",
  share: "off", presenter: "—", shareSize: "—", liveCalls: "—", shareNote: "",
  meeting: "—", sharing: false, myMedia: "—", gallery: "—", participants: "—",
  interior: `${CAVE_METRICS.interior} units  ·  wrap ${Math.round(CAVE_METRICS.wrapLength())}  ·  video ${CAVE_METRICS.videoWidth} wide on a ${CAVE_METRICS.frontChord} chord`,
};
caveGui.add({ go: () => caveTransition?.enter() }, "go").name("▶ enter the CAVE (spawns PLAYER at the portal)");
caveGui.add({ go: () => caveTransition?.exit() }, "go").name("■ leave the CAVE (→ Central Hub)");
caveGui.add({ go: () => { placeBonAtPortal(); setCameraMode("player"); placeBonAtPortal(); } }, "go").name("▶ put Bon at the monument portal + enter PLAYER");
caveGui.add({ go: () => caveMedia.toggle() }, "go").name("⏯ play / pause the video");
caveGui.add({ go: () => caveMedia.setMuted(!caveMedia.state.muted) }, "go").name("🔈 mute / unmute");
caveGui.add(caveState, "interior").name("interior").disable();
caveGui.add(caveState, "where").name("volume").disable().listen();
caveGui.add(caveState, "busy").name("transition running").disable().listen();
caveGui.add(caveState, "transitions").name("enter/exit count").disable().listen();
caveGui.add(caveState, "last").name("last transition").disable().listen();
caveGui.add(caveState, "video").name("video").disable().listen();
caveGui.add(caveState, "muted").disable().listen();
caveGui.add(caveState, "time").name("position (s)").disable().listen();
caveGui.add(caveState, "blocked").name("playback note").disable().listen();
// ---- presentation mode: the EXISTING call's screen share, on the front panel ------------------------
// Watching the live call is opt-in and costs nothing until clicked: the LiveKit import is dynamic.
const shareParams = { email: "bon@offshorly.com" };
const shareGui = caveGui.addFolder("meeting + screen share (the app's existing LiveKit stack)");
shareGui.add(shareParams, "email").name("join as (dev identity)");
shareGui.add({ go: () => void caveLiveShare.connect(shareParams.email) }, "go").name("① connect to the call store");
// THE MEETING PATH — a host may press these two alone; people who join later get the same room
// and the same share.
shareGui.add({ go: () => void caveLiveShare.connect(shareParams.email).then(() => caveLiveShare.startMeeting()) }, "go")
  .name(`▶ Start / Join Meeting (${CAVE_MEETING_ID})`);
shareGui.add({ go: () => void caveLiveShare.setMic(!caveLiveShare.state.mic) }, "go").name("🎤 Mic On / Off");
shareGui.add({ go: () => void caveLiveShare.setCamera(!caveLiveShare.state.camera) }, "go").name("📹 Camera On / Off");
shareGui.add({ go: () => void caveLiveShare.setSharing(true) }, "go").name("🖥 Share Screen");
shareGui.add({ go: () => void caveLiveShare.setSharing(false) }, "go").name("■ Stop Sharing");
shareGui.add({ go: () => caveLiveShare.leave() }, "go").name("■ leave the meeting / call");
// A/B testing against the app's own SPATIAL conversation calls stays available, unchanged.
shareGui.add({ go: () => void caveLiveShare.join() }, "go").name("② join a live SPATIAL call (A/B testing)");
shareGui.add(caveState, "meeting").name("connected to").disable().listen();
shareGui.add(caveState, "sharing").name("this browser is sharing").disable().listen();
shareGui.add(caveState, "myMedia").name("my mic / camera").disable().listen();
shareGui.add(caveState, "gallery").name("gallery").disable().listen();
shareGui.add(caveState, "participants").name("cameras on").disable().listen();
shareGui.add(caveState, "share").name("presentation").disable().listen();
shareGui.add(caveState, "presenter").name("presenter").disable().listen();
shareGui.add(caveState, "shareSize").name("source").disable().listen();
shareGui.add(caveState, "liveCalls").name("calls broadcast").disable().listen();
shareGui.add(caveState, "shareNote").name("note").disable().listen();

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
  // THE ENVIRONMENT'S OWN CLOCK: a travelling grade (Clear→Rain, Day→Sunset), the storm scheduler and the
  // foliage wind. Idle cost is three comparisons; it writes to the renderer only on frames where the
  // world actually moved. applyEnvPhase above RETARGETS, this is what travels.
  env.tick(dt / 1000);
  env.follow(dt / 1000); // the sky dome rides the orbit target; the rain field rides the active camera
  // THE ENVIRONMENTAL MIXER. A no-op until a gesture has started it; after that it is one pure mix
  // calculation and up to ten float writes — no node is created, connected or looked up on a frame.
  envAudio.update(dt / 1000);
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
    caveTransition?.update(); // media readout; a no-op outside the CAVE
    // THE WORLD'S FOLEY, and the toucan's flight. Reads the state everything above just wrote — no
    // interaction, door or seat controller knows this exists.
    worldFoley(dt / 1000, { x: bp.x, z: bp.z });
    // PRESENTATION MODE, driven from the one place that sees every way in and out of the CAVE (the
    // portal, the GUI, the console driver). Both calls are idempotent early-returns: setActive
    // compares a boolean, sample() compares two numbers off the element, and the materials are only
    // touched when consumeChange says something really moved. No allocation on any frame.
    const insideCave = caveTransition?.inside ?? false;
    cavePresentation.setActive(insideCave);
    cavePresentation.sample();
    caveGallery.setActive(insideCave);
    caveGallery.sample();
    if (cavePresentation.consumeChange() || caveGallery.consumeChange()) applyCaveMode();
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
    if (caveTransition) {
      caveState.where = caveTransition.state.where;
      caveState.busy = caveTransition.state.busy;
      caveState.transitions = caveTransition.state.transitions;
      caveState.last = caveTransition.state.last;
      caveState.video = caveMedia.state.status;
      caveState.muted = caveMedia.state.muted;
      caveState.blocked = caveMedia.state.blocked;
      caveState.time = `${caveMedia.state.time} / ${caveMedia.state.duration}`;
      caveState.share = `${cavePresentation.state.status} · link ${caveLiveShare.state.status}`;
      caveState.presenter = cavePresentation.state.presenter || caveLiveShare.state.presenter || "—";
      caveState.shareSize = cavePresentation.state.width
        ? `${cavePresentation.state.width} × ${cavePresentation.state.height} (${Math.round(cavePresentation.aspect * 100) / 100}:1)`
        : "—";
      caveState.liveCalls = caveLiveShare.state.live || "—";
      caveState.meeting = caveLiveShare.state.session
        ? `${caveLiveShare.state.kind}: ${caveLiveShare.state.session}`
        : "—";
      caveState.sharing = caveLiveShare.state.sharing;
      caveState.myMedia = `mic ${caveLiveShare.state.mic ? "on" : "off"} · camera ${caveLiveShare.state.camera ? "on" : "off"}`;
      caveState.gallery = `${caveGallery.state.mode} · ${caveGallery.state.drawn} drawn${caveGallery.state.hidden ? ` · ${caveGallery.state.hidden} not decoded` : ""}`;
      caveState.participants = caveGallery.state.cameras
        ? `${caveGallery.state.cameras}${caveGallery.state.names ? ` · ${caveGallery.state.names}` : ""}`
        : "—";
      caveState.shareNote = cavePresentation.state.note || caveLiveShare.state.note || "";
    }
    if (params.playerView !== playerMode.view) { params.playerView = playerMode.view; refresh(); }
    envState.clock = formatManila(timeOfDay.hourDecimal);
    envState.wind = env.wind.toFixed(2);
    envState.wetness = env.wetness.toFixed(2);
    envState.storm = env.storm.striking
      ? `${env.storm.nextIn.toFixed(0)}s (${env.storm.count} so far)`
      : "this weather does not strike";
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
    bolt: () => env.lightningBolt,
    boltVisible: () => env.lightningBolt.object.visible,
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
    // THE REACTION LAYER, for live QA and for the audio phase that comes next.
    storm: env.storm,
    strike: () => env.storm.strike(),
    lastThunder: () => lastThunder,
    onThunder: (fn: ((e: ThunderEvent) => void) | null) => { thunderListener = fn; },
    wind: () => env.wind, wetness: () => env.wetness, flash: () => env.flash,
    setTransitions: (on: boolean) => { params.envTransitions = on; env.transitions = on; refresh(); },
    settle: () => env.settle(),
    travelling: () => env.travelling,
    setRainInOffice: (on: boolean) => { params.envRainInOffice = on; env.rainInOffice = on; refresh(); },
  },
  toucan: {
    bird: toucan, state: toucan.state, root: toucan.root,
    position: () => toucan.position, flying: () => toucan.flying,
    reset: (u?: number) => toucan.reset(u),
    /** step the flight deterministically from a test/console, bypassing the render loop */
    step: (dt: number) => toucan.update(dt, env.weather, env.phase ?? "day", env.presentation === "world" && !(caveTransition?.inside ?? false)),
  },
  audio: {
    engine: envAudio, state: envAudio.state,
    /** fire a foley one-shot straight from the console, for listening to a family in isolation */
    play: (kind: Parameters<typeof envAudio.play>[0], opts?: Parameters<typeof envAudio.play>[1]) => envAudio.play(kind, opts),
    edges, steps,
    start: () => envAudio.start(),
    setEnabled: (on: boolean) => { params.envAudio = on; if (on) envAudio.start(); envAudio.setEnabled(on); refresh(); },
    setVolume: (v: number) => { params.envAudioVolume = v; envAudio.setVolume(v); refresh(); },
    zone: () => envAudio.state.zone,
    dispose: () => envAudio.dispose(),
  },
  cave: {
    get transition() { return caveTransition; }, state: caveState, media: caveMedia, mediaState: caveMedia.state,
    build: caveBuild, group: caveBuild.group, metrics: CAVE_METRICS,
    enter: () => caveTransition?.enter() ?? false,
    exit: () => caveTransition?.exit() ?? false,
    toggle: () => caveTransition?.toggle() ?? false,
    inside: () => caveTransition?.inside ?? false,
    play: () => caveMedia.play(), pause: () => caveMedia.pause(), togglePlay: () => caveMedia.toggle(),
    /** PRESENTATION MODE, for the console and the Playwright rig. `share.source(track)` takes any
     *  object with LiveKit's attach/detach surface — which is what lets the whole CAVE half be
     *  driven with a canvas capture stream, with no LiveKit server in the loop. */
    presentation: cavePresentation, presentationState: cavePresentation.state,
    /** The 270° meeting gallery — layout state and the tile meshes, for the console and the rig. */
    gallery: caveGallery, galleryState: caveGallery.state,
    share: {
      link: caveLiveShare, state: caveLiveShare.state,
      connect: (email: string) => caveLiveShare.connect(email),
      /** Start (or join) the CAVE's standalone meeting — a host may be alone in it. */
      startMeeting: (meetingId?: string) => caveLiveShare.startMeeting(meetingId),
      setSharing: (on: boolean) => caveLiveShare.setSharing(on),
      setMic: (on: boolean) => caveLiveShare.setMic(on),
      setCamera: (on: boolean) => caveLiveShare.setCamera(on),
      meetingId: CAVE_MEETING_ID,
      join: (sessionId?: string) => caveLiveShare.join(sessionId),
      leave: () => caveLiveShare.leave(),
      source: (src: Parameters<typeof cavePresentation.setSource>[0], who = "dev") => {
        cavePresentation.setSource(src, who);
      },
      panel: () => caveBuild.presentation.mesh,
      live: () => cavePresentation.live,
    },
    setMuted: (m: boolean) => caveMedia.setMuted(m),
    /** put Bon on the portal's stand point, facing it (the CAVE is nowhere near the default spawn) */
    atPortal: placeBonAtPortal,
    /** point the player along a world direction, writing BOTH yaw conventions (see facePlayer) */
    look: (dx: number, dz: number, pitch?: number) => facePlayer({ x: dx, z: dz }, pitch),
    spawn: CAVE_SPAWN, floorRect: CAVE_FLOOR_RECT, outerRect: CAVE_OUTER_RECT,
    ids: { portal: CHAMPIONSHIP_ENTRANCE_ID, exit: CAVE_EXIT_ID, screen: CAVE_SCREEN_ID, room: CAVE_ID },
    canStand: (x: number, z: number) => playerStand({ x, z }),
  },
  player: {
    mode: playerMode, state: playerMode.state,
    /** the approved ground speeds, for the console and the movement QA rig */
    speeds: { walk: PLAYER_WALK_SPEED, sprint: PLAYER_SPRINT_SPEED, multiplier: SPRINT_MULTIPLIER, inForce: () => params.walkSpeed },
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
  edit: {
    session: edit, editState, gizmo: editGizmo, editableIds: EDITABLE_IDS,
    movePlantTo: (x: number, z: number) => { edit.setEditMode(true); edit.select(HERO_PLANT_ID); const v = edit.preview({ x, z }); refreshEditVisuals(); return v; },
    select: (id: string | null) => { edit.select(id); refreshEditVisuals(); return edit.selected; },
    move: (x: number, z: number) => { const v = edit.preview({ x, z }); refreshEditVisuals(); return v; },
    rotate: (deg: number) => { const v = edit.setYawDegrees(deg); refreshEditVisuals(); return v; },
    setSnap: (on: boolean) => { edit.snap.enabled = on; refreshEditVisuals(); return edit.snap; },
    confirm: () => { const v = edit.confirm(); refreshEditVisuals(); return v; },
    cancel: () => { edit.cancel(); refreshEditVisuals(); },
    reset: () => { edit.reset(); refreshEditVisuals(); },
    undo: () => { const r = edit.undo(); refreshEditVisuals(); return r; },
    redo: () => { const r = edit.redo(); refreshEditVisuals(); return r; },
    setEditMode: (v: boolean) => { setEditMode(v); if (v) edit.select(HERO_PLANT_ID); refreshEditVisuals(); refresh(); },
    // ---- SLICE 2 ---------------------------------------------------------------------------------
    setMode: setEditorMode,
    library: () => ASSET_LIBRARY.map((i) => ({ key: `${i.kind}:${i.label}`, category: i.category, label: i.label, kind: i.kind })),
    place: (key: string, x: number, z: number) => { const item = findAsset(key); if (!item) return { id: null, check: { ok: false, reason: "no-room" } }; const r = edit.placeAsset(item, { x, z }); refreshEditVisuals(); return r; },
    duplicate: () => { const r = edit.duplicate(); refreshEditVisuals(); return r; },
    remove: () => { const r = edit.remove(); refreshEditVisuals(); return r; },
    anchors: (id: string) => world.get(id).capabilities,
    surfaces: () => surfaces.all().map((e) => ({ id: e.id, label: e.tag.label, kind: e.tag.kind, spec: e.preview, pending: e.pending })),
    selectSurface: (id: string | null) => { edit.selectSurface(id); refreshEditVisuals(); return edit.selectedSurface; },
    setSurface: (spec: SurfaceSpec) => { edit.previewSurface(spec); refreshEditVisuals(); return edit.selectedSurface ? surfaces.get(edit.selectedSurface)!.preview : null; },
    leds: () => leds.all().map((e) => ({ id: e.id, label: e.tag.label, room: e.tag.roomId, spec: e.preview, pending: e.pending })),
    selectLed: (id: string | null) => { edit.selectLed(id); refreshEditVisuals(); return edit.selectedLed; },
    setLed: (spec: EmissiveSpec) => { edit.previewLed(spec); refreshEditVisuals(); return edit.selectedLed ? leds.get(edit.selectedLed)!.preview : null; },
    materialOf: (surfaceId: string) => { const e = surfaces.get(surfaceId); const m = e?.meshes[0]?.mesh.material as THREE.MeshStandardMaterial | undefined; return m ? { uuid: m.uuid, color: m.color.getHex(), roughness: m.roughness } : null; },
  },
};
