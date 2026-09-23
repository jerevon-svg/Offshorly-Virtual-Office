// vo3d app — wires world → nav → render → avatar → interactions → editor → devtools. Dev-only entry.
import * as THREE from "three";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import {
  getExperiencePreferences,
  subscribeExperience,
} from "../../../services/settings/experiencePreferences";
import {
  getEnvironmentPreferences,
  subscribeEnvironmentPreferences,
} from "../../../services/settings/environmentPreferences";
import { WorldState } from "../world/WorldState";
import { DESIGN_ROOM, DESIGN_SOLIDS, CHAIR_4_ID, DOOR_ID, HERO_PLANT_ID, SHELL as DESIGN_SHELL, designRoomEntities } from "../rooms/design-room";
import { RECEPTION_ROOM, COUNTER_INTERACTION_ID, FACADE as FACADE_SPEC, ENTRY_DOOR_EAST_ID, ENTRY_DOOR_WEST_ID, ENTRY_SCANNER_ID, ENTRY_ZONE, GATE, GATE_SCANNER_IDS, GATE_ZONES, KIOSK_INTERACTION_ID, KIOSK_SCANNER_ID, KIOSK_ZONE, LOUNGE_SEAT_IDS, RECEPTION_ROOM_ID, receptionEntities } from "../rooms/reception";
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
import { CELL, worldToCell, type Cell } from "../adapters/v1Grid";
import { NAV_RADIUS } from "../nav/clearance";
import { Connectivity } from "../nav/connectivity";
import { compareToV1, summariseReport, verdictFor } from "../nav/diagnostics";
import { MEETING_ROOM, MEETING_CHAIR_IDS, KIOSK_INTERACTION_ID as MEETING_KIOSK_INTERACTION_ID, KIOSK_SCANNER_ID as MEETING_KIOSK_SCANNER_ID, KIOSK_ZONE as MEETING_KIOSK_ZONE, meetingRoomEntities } from "../rooms/meeting";
import { PROJECT_ROOM, CONSOLE_INTERACTION_ID, SOFA_SEAT_IDS, TUB_SEAT_IDS, TV_INTERACTION_ID, projectRoomEntities } from "../rooms/project";
import { buildExterior } from "../build/exterior";
import { buildAiLab } from "../build/ailab";
import { MonkeyAvatar } from "../avatar/MonkeyAvatar";
import { aiLabStandTest, inAiLabZone } from "../world/ailab";
import { Environment } from "../env/Environment";
import { createSeasonLayer, type BuiltSeasonLayer } from "../season/SeasonLayer";
import type { SeasonTheme } from "../season/season";
import { ENV_TIME_MODES, TimeOfDay, type EnvPhase, type EnvTimeMode } from "../env/timeOfDay";
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
import type { ToucanSummonState } from "../../../components/OfficeMap/toucanSummon";
import { spatial } from "../audio/sfx";
import { makeStandTest } from "../player/standTest";
import type { PlayerView } from "../player/PlayerCamera";
import { ApproachInteraction } from "../interact/Approach";
import { LoungeSeatInteraction } from "../interact/LoungeSeat";
import { Walkability, composeStatic } from "../nav/Walkability";
import { clearanceLayer, worldClearances } from "../nav/clearance";
import { SlidingDoor, type DoorBody } from "../interact/Door";
import { CORRIDOR_BANDS, ROOM_WORLD_SHIFT_Z, registerGroundFloor } from "../rooms/ground-floor";
import { FACADE_Z, FRAME, v1Rooms } from "../adapters/v1Floor";
import { planWalk, type NavResult } from "../nav/planner";
import { RoomLockController, collectLockableDoors } from "./roomLocks";
import { v1Static } from "../adapters/v1Grid";
import { casterPoseMoved, DEFAULT_LIGHT, Renderer, type CasterPose } from "../render/Renderer";
import { SceneMirror } from "../render/SceneMirror";
import { setStaticBatching, staticBatchingEnabled } from "../render/StaticBatch";
import { setSSAODepthReuse, ssaoDepthReuseEnabled } from "../render/SSAOFromDepth";
import { createGraphicsEngine } from "../render/GraphicsEngine";
import { GraphicsController } from "../../../services/render/graphicsController";
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
import { Crowd } from "../devtools/Crowd";
import { STRESS_MATRIX, markdownTable, planPlacements, type ScenarioResult, type StressScenario } from "../devtools/Stress";
import { BON_STANDING_HEIGHT, castLods, CLIP_IDLE, CLIP_TALK_AGREE, CLIP_TALK_LISTEN, hasCastLods, type AvatarLod } from "../adapters/v1Avatar";
import type { Vo3dIdentity } from "./identity";
import { homeDeskWorldPoint, v1FramePoint, type Vo3dHomeDesk } from "./spawn";
import { plannedDurationMs, SelfMovementFeed, type Vo3dSelfMovementSink } from "./selfMovement";
import { gateRects, mayEnterOffice, routeEntersOffice, zoneAt, type AccessGeometry, type OfficeAccess, type Zone } from "./access";
import { Coworkers, facingTrace, type SeatAnchorPose } from "../world/Coworkers";
import type { Vo3dCoworker } from "./coworkers";
import { CAVE_PLACE_ID as CAVE_PLACE, coworkersInSameVolume } from "./coworkers";
import type { Vo3dCoworkerInteractions, Vo3dCoworkerSelection, Vo3dScreenAnchor } from "./interactions";
import { exploreFrameZoom, roomFrameMode, roomFrameRect, roomLabelRects, ROOM_FRAME_FILL } from "./roomFocus";
import type { Vo3dViewMode } from "./viewMode";
import { coworkerEmailOf, personCandidateId, REACH as TARGET_REACH, type Candidate } from "../player/PlayerTargeting";
import { standablePointNear } from "../player/PlayerBody";
import { markSeatFacingSaved, parseSeatAnchorId, SEAT_FACINGS, seatAnchorId, seatFacingFor, seatFacingTable, seatedYawFor, setSeatFacingOverride, subscribeSeatFacing, unsavedSeatFacingCount, type SeatFacing } from "./seats";
import type { LoungeSeatSlot, SeatCapability } from "../world/WorldState";
import { deskSeatContact } from "../interact/seatContact";
import { FACING_YAW, circleOverlapsRect, pointInRect, stepAngle, wrapAngle, type Facing, type Rect, type Vec2 } from "../core/coords";

/** PHASE 7C — THE CAVE MEETING, as the HUD sees it.
 *
 *  Every field is read from things that already existed: `inside` is CaveTransition's own state, and the
 *  rest is media/CaveLiveShare's state, which is itself a mirror of services/call/callStore — the app's
 *  ONE LiveKit call system. Nothing here is a second meeting model. */
export interface Vo3dCaveMeetingState {
  /** True while the viewer is standing inside the Championship Cave. */
  inside: boolean;
  status: "off" | "connecting" | "connected" | "error";
  /** The meeting (or spatial session) this page is connected to, or "". */
  session: string;
  kind: "—" | "meeting" | "spatial";
  mic: boolean;
  camera: boolean;
  sharing: boolean;
  /** Live cameras in the room, this client's included. */
  cameras: number;
  /** PHASE 7D. People in the room, this client's included — LiveKit's own membership. 0 until
   *  connected, because before that nothing tells this client who is in there (see Vo3dCaveMeeting). */
  people: number;
  /** PHASE 7D. Is a meeting already running, from the SERVER's broadcast — the one fact that can be
   *  known BEFORE joining, and therefore the one that decides Start versus Join. */
  live: boolean;
  /** Current host's email, or "". */
  host: string;
  /** True when the host is this viewer. */
  isHost: boolean;
  /** Who is sharing a screen right now, or "". */
  presenter: string;
  /** The last thing that went wrong, in the store's own words, or "". */
  note: string;
}

/** The verbs. Each one is a straight pass to CaveLiveShare, which is a straight pass to the app's call
 *  store — the same functions V1's own call controls call. */
export interface Vo3dCaveMeeting {
  subscribe(listener: (state: Vo3dCaveMeetingState) => void): () => void;
  /** Connect this page to the call store as `email`, then create-or-join the Cave meeting room. The
   *  SERVER decides which of the two it is; see routers/calls.py create_meeting_token. */
  start(email: string): Promise<void>;
  setMic(on: boolean): Promise<void>;
  setCamera(on: boolean): Promise<void>;
  setSharing(on: boolean): Promise<void>;
  leave(): void;
  /** PHASE 7D. Offer this meeting to one person — the MEETING invitation, not the spatial ring. */
  invite(email: string): void;
  /** PHASE 7D. Walk the viewer INTO the Cave, through the real portal transition the door and the dev
   *  driver already use — no teleport and no second entry path.
   *
   *  Accepting an invitation needs it: joining the meeting's media without moving the body left the
   *  accepter in a room they were not standing in, so they had no Cave panel, no screen and no way to
   *  leave. The meeting is a thing you do in a place, and this is that place. */
  enter(): boolean;
  /** PHASE 7D. WATCH the meeting without joining it: opens the call store's socket so this client
   *  hears `meeting_presence`, and NOTHING else. No token, no LiveKit room, no microphone, no camera.
   *
   *  It exists because the bridge is lazy by design (Phase 7C: opening the V2 page must cost no
   *  LiveKit SDK and no network), and that laziness made Start-vs-Join wrong for exactly the person it
   *  matters to — somebody walking into a Cave where a meeting is already running has, by definition,
   *  not pressed anything yet, so without this they are offered "Start" for a meeting that exists. */
  observe(email: string): Promise<void>;
}

/** What a mounted V2 world hands back. `dispose()` is idempotent and, once called, the world is dead:
 *  the canvas it was given has had its WebGL context force-lost and CANNOT be reused (see
 *  render/Renderer.dispose). A remount must be given a FRESH canvas element. */

export interface Vo3dWorld {
  dispose(): void;
  /** PHASE 4A — the roster's coworkers, pushed in from outside.
   *
   *  The world never fetches them: app/Vo3dHost.tsx owns the V1 subscriptions (React owns subscriptions,
   *  the world owns scene objects) and calls this whenever the roster changes. `missingAvatar` is carried
   *  alongside because the readout has to be able to say who V1 lists but V2 cannot draw, rather than
   *  quietly showing a smaller office. Never called by the standalone dev page, which therefore builds no
   *  coworker bodies at all and costs exactly what it always did. */
  setCoworkers(list: readonly Vo3dCoworker[], missingAvatar?: readonly string[]): void;
  /** PHASE 5 — STAND THE SIGNED-IN EMPLOYEE WHERE V1 LAST SAW THEM STOP.
   *
   *  `point` is in V1 FRAME UNITS (adapters/v1SelfMovement resolveV1SelfPosition); this world applies its
   *  own room shift, exactly as the home-desk spawn and the coworkers do, and then judges whether a body
   *  fits there with the same stand test every WASD step is judged by.
   *
   *  FIRES AT MOST ONCE, AND NEVER AFTER THE PLAYER HAS TAKEN CONTROL — the same rule V1's own spawn
   *  restore follows (OfficeMap.tsx's spawnMovedRef: "if they've already moved, the spawn point stopped
   *  being meaningful"). Returns true only when the body was actually moved. The host calls it whenever
   *  V1's movement snapshot resolves, which may be before or after this world finished building, so every
   *  refusal is silent and idempotent. */
  restoreSelf(point: Vec2, facing: Facing, seat?: string, place?: string): boolean;
  /** PHASE 6C — WHICH SEAT ANCHORS OTHER EMPLOYEES OCCUPY (app/seats.ts ids), pushed in from outside.
   *
   *  The world never decides occupancy: app/Vo3dHost.tsx derives it from V1's own movement feed and roster
   *  (the same two sources V1's OfficeMap.tsx occupiedCentroidKeys reads) through the validated seat
   *  mapping, and calls this whenever it changes. What the world does with it is ONE thing: refuse to start
   *  a sit in an occupied anchor. The backend remains the authority for a simultaneous attempt. */
  setOccupiedSeats(ids: readonly string[]): void;
  /** PHASE 6C — stand the signed-in employee up if seated (the backend rejected the seat claim, or any
   *  other outside reason). A no-op while standing. */
  standUp(): void;
  /** A PEER JUMPED — draw it. Pushed in from outside like every other fact about other people:
   *  app/Vo3dHost.tsx owns the subscription to V1's socket, the world owns the bodies. `ageMs` is how
   *  long ago the server relayed it, so a late one can be dropped rather than drawn as a phantom hop.
   *
   *  Cosmetic and vertical only — it cannot move anybody, open a door or reach a room. Returns whether
   *  a body actually took off, for the verification surface. */
  peerJumped(email: string, ageMs?: number): boolean;
  /** PHASE 5 — V1'S ANSWER ABOUT THIS EMPLOYEE'S WORK SESSION, pushed in from outside.
   *
   *  The world never asks: app/Vo3dHost.tsx owns the read (adapters/v1Attendance over V1's own
   *  services/attendance) and calls this whenever the answer changes. There is no second attendance
   *  authority here and no status is ever written back — see app/access.ts.
   *
   *  What it changes is ONE thing: whether Reception's speed gates are passable. Everything else about
   *  movement is untouched, so a denied employee still walks freely in Reception, on the street, along
   *  the campus and through the AI Lab. `denied` additionally stands a body that is already inside the
   *  working office back on Reception's public side, because the alternative is being sealed in.
   *  `unknown` shuts the gate but never moves anybody. Never called by the standalone dev page. */
  setOfficeAccess(access: OfficeAccess): void;
  /** PHASE 6D — WHO THE HOST HEARS FROM WHEN A COWORKER IS SELECTED, pushed in like every other write on
   *  this interface. Null unsubscribes. The world dispatches nothing itself: see app/interactions.ts.
   *  PHASE 7E — the same handlers also receive `onInteractionArrived`, the walk-up-to-a-fixture signal. */
  setCoworkerInteractions(handlers: Vo3dCoworkerInteractions | null): void;
  /** PHASE 7E — AUTHORISE THIS DEPARTURE, or take the authorisation back.
   *
   *  The exit is held shut for a CHECKED-IN employee and for nobody else: a checked-out one is exploring
   *  and was never stopped, and an employee V1 has not answered for is never trapped inside. Held by the
   *  SAME Walkability reservation the Reception gates use — so the router, click-to-walk, every approach
   *  and PLAYER mode all obey it at once, and the automatic doors stay shut because a body can no longer
   *  reach or route through their crossing.
   *
   *  `true` opens it for ONE departure and re-arms itself once the employee comes back inside. It is an
   *  answer about a door and says nothing about attendance: the host has either sent them to the AI Lab
   *  still checked in, or finished V1's own check-out. This never writes either. */
  setExitAuthorized(on: boolean): void;
  /** PHASE 7E — name where an authorised departure is heading, so peers see them arrive there rather than
   *  stop at the façade. A label on the movement wire and nothing else. */
  setDepartureDestination(place: "ai-lab" | null): void;
  /** DND ROOM LOCKS — WHICH MANIFEST ROOMS V1 SAYS ARE LOCKED, pushed in from outside (app/roomLocks.ts).
   *
   *  The host resolves V1's own rule (data/roomLock.ts over the room_presence and dnd_status feeds) and
   *  translates V1's flat ids through data/office-layout; the world decides nothing about locks. Each locked
   *  room's door is then held by the SAME Walkability reservation Reception's gates and the exit use — so the
   *  router, click-to-walk, every approach and PLAYER mode obey it at once — but only while this body is
   *  OUTSIDE that room: an occupant is never caged, and the hold returns once they have left. A walk aimed
   *  into a shut room goes to its door and stops; the host is told through onRoomLockIntercepted. */
  setLockedRooms(roomIds: readonly string[]): void;
  /** ONE authorised entry into a locked room — an accepted knock. Opens that room's doors for this body,
   *  resumes the walk the lock held (if any), and is SPENT the moment the body is inside; leaving again
   *  needs a fresh knock (V1: never a persistent whitelist). Null withdraws an unspent one. */
  authorizeRoomEntry(roomId: string | null): void;
  /** PHASE 6D — WHERE THAT PERSON IS ON SCREEN RIGHT NOW, for an anchored card. Recomputed from the live
   *  camera and the live body on every call (the host calls it per animation frame), because both move.
   *  Null for somebody this world has no body for. */
  coworkerAnchor(email: string): Vo3dScreenAnchor | null;
  /** PHASE 7B — the same answer for several people at once, for the overhead chat layer's frame loop. */
  coworkerAnchors(emails: readonly string[]): Record<string, Vo3dScreenAnchor>;
  /** PART 1 — the viewer's OWN head, so their "You" pill hangs where everybody else's does. Null while
   *  the body is not drawn (first person hides it). */
  selfAnchor(): Vo3dScreenAnchor | null;
  /** DISCOVERY — which access zone a V1-frame point falls in, read-only. The exterior cannot be read off
   *  the wire (a room id is only rewritten on a boundary crossing, so somebody on the street still carries
   *  the room they left), and this is the world's own existing answer — app/access.ts zoneAt over the same
   *  geometry the gate uses. Exposed, not computed anew: see app/employeeLocation.ts. */
  zoneAt(x: number, z: number): Zone;
  /** PHASE 7A — WHICH CAMERA IS DRIVING, pushed out to the host as it changes and once immediately, so a
   *  subscriber never has to guess the current mode. The branded HUD is hidden while PLAYER owns the
   *  pointer and shown over OFFICE and EXPLORE. Returns its own unsubscribe. */
  subscribeViewMode(listener: (mode: Vo3dViewMode) => void): () => void;
  /** SPATIAL CONVERSATION POSES, pushed in from outside.
   *
   *  `byEmail` names, for each coworker in a conversation, the clip their body should REST in — V1's own
   *  listening / agree gestures, which are already in the consolidated GLB. `self` is the same answer for
   *  the signed-in employee's own avatar. Anybody absent goes back to an ordinary idle.
   *
   *  THE WORLD DECIDES NOTHING HERE. Who is in a spatial conversation and who is typing into it are V1's
   *  session and typing feeds, read in app/Vo3dOverlay.tsx and resolved through V1's OWN
   *  render3d/characterAnimationState. Walking, sitting and facing all still outrank the pose, exactly as
   *  they do in V1's resolver. */
  setConversationPoses(byEmail: ReadonlyMap<string, string | null>, self: string | null): void;
  /** GLOBAL CHAT ACTIVITY POSES, pushed in from outside — V1's `isGlobalChatActive`.
   *
   *  `emails` is the set of lowercased coworker emails the presence socket says currently have at least
   *  one visible, non-minimized Global Chat (remote DM/group) window open; `self` is the same answer for
   *  the signed-in employee, derived locally so it works with no socket. A SEATED body in that set plays
   *  `sitting-answering`; everybody else plays the ordinary sit. Standing is never affected, exactly as
   *  render3d/characterAnimationState.ts orders it.
   *
   *  THE WORLD DECIDES NOTHING HERE and learns nothing about any conversation: the payload is a bare
   *  boolean per email — see services/presence/globalChatActivityClient.ts. */
  setGlobalChatActive(emails: ReadonlySet<string>, self: boolean): void;
  /** PART 6 — SHOW OR HIDE THE DEVELOPER INSPECTION RIG (the lil-gui panel and the frame-time overlay).
   *  Off by default in a signed-in session; the V1 Settings panel's Developer section owns the switch, and
   *  `?gui=1` opens it directly. Nothing is removed — every control stays exactly where it was. */
  setDevToolsVisible(on: boolean): void;
  /** Whether the rig is currently showing, so a checkbox can render the real state. */
  devToolsVisible(): boolean;
  /** PHASE 7C — the Championship Cave's meeting, for the HUD. */
  readonly caveMeeting: Vo3dCaveMeeting;
  /** PHASE 7C — told whenever that switch moves, and once immediately. The host's own diagnostic
   *  readouts ride it so they are developer-only exactly as the inspection panel is. */
  subscribeDevTools(listener: (visible: boolean) => void): () => void;
  /** PART 4 — SWITCH VIEW. The same entry point the dev GUI's mode dropdown uses, so a switcher in the
   *  HUD and the GUI can never disagree. Switching does NOT move the avatar, change attendance, presence
   *  or any conversation: OFFICE and 3D EXPLORE only reconfigure the orbit rig, and PLAYER is a camera
   *  handoff (see render/CameraModes). A refused PLAYER entry falls back to OFFICE. */
  setViewMode(mode: Vo3dViewMode): void;
  /** PHASE 7D — ASK FOR THE POINTER FROM THE CALLER'S OWN GESTURE. A pointer-lock request is only
   *  granted inside a user gesture, so entering PLAYER has to ask from the keypress that entered it
   *  rather than waiting for a click on the world. A no-op outside PLAYER. */
  requestPointerLock(): void;
  /** True while the browser refused our last request and unlocked mouse-look is carrying the mode. */
  subscribeLockState(listener: (locked: boolean, unlockedLook: boolean) => void): () => void;
  /** PART 4 — first- or third-person inside PLAYER. A no-op outside it. */
  setPlayerView(view: "first" | "third"): void;
  /** PART 4 — which of the two PLAYER cameras is live; told at once on subscribe. */
  subscribePlayerView(listener: (view: "first" | "third") => void): () => void;
  /** PHASE 7A — leave PLAYER mode and return to the OFFICE camera. The one verb the HUD needs, because a
   *  pointer-locked player cannot reach any DOM control to get out. Same entry point the GUI button uses. */
  exitPlayerMode(): void;
  /** PHASE 7E — hide PLAYER's centre-screen "[E] …" interaction line while a modal owns the screen.
   *  It is drawn at the middle of the viewport, which is where a modal's primary button sits. Presentation
   *  only: targeting, input, the crosshair and the floor ring all keep running underneath. */
  setInteractionPromptHidden(hidden: boolean): void;
  /** PHASE 7A — SELECT A PERSON THE HOST PICKED, rather than one the pointer hit: the branded HUD's
   *  Search locates somebody by name, and "locate" in a 3D world means the same thing a click on their
   *  body means. Returns false for anybody this world is not currently drawing — Search then simply
   *  selects nobody rather than opening a card over empty floor. */
  selectCoworkerByEmail(email: string): boolean;
  /** PHASE 6D — THE HOST DISMISSED THE MENU (Escape, an outside press, an action taken). Told to the
   *  world so the two agree on who is selected: without it the world would still hold the last person and
   *  a second click on the SAME body would be recognised as "already selected" and open nothing. */
  clearCoworkerSelection(): void;
  /** ROOM DISCOVERY — EVERY ROOM THAT CAN CARRY A LABEL, by V1 manifest room id, in a stable order.
   *  Read ONCE by the label layer to build its DOM; the positions come from roomLabelAnchors below. */
  roomLabelIds(): string[];
  /** ROOM DISCOVERY — WHERE EACH OF THOSE LABELS BELONGS ON SCREEN RIGHT NOW, the same per-frame answer
   *  coworkerAnchors gives for a body and measured through the same projection, so a label tracks a pan,
   *  an orbit and a zoom exactly as a nameplate does. `scale` is one world unit in CSS pixels at that
   *  room's depth, which is what lets the type read as painted on the floor rather than pinned to the UI. */
  roomLabelAnchors(): Record<string, Vo3dRoomLabelAnchor>;
  /** ROOM DISCOVERY — WASH THE FLOOR OF ONE ROOM, or none. The hover feedback for a label, and the only
   *  thing discovery draws INTO the scene: a single translucent quad, moved and resized to the hovered
   *  room. It casts no shadow, writes no depth and changes no material, so nothing about the office's
   *  lighting, navigation or picking is touched. Null clears it. */
  setRoomHighlight(roomId: string | null): void;
  /** ROOM DETAILS PARITY — WHICH ROOM THE SIGNED-IN BODY IS STANDING IN, as the V1 manifest room layer id
   *  (see Vo3dCoworkerInteractions.onRoomSelected for why that is the id). Null in the shared hall, on the
   *  street and anywhere outside the modelled world.
   *
   *  This is the PLAYER-view entry point: a pointer-locked player cannot click a floor region, so the
   *  HUD's Room tile asks "which room am I in" instead — the same question, answered from the same
   *  regions, with no second notion of location. Read on demand, never polled. */
  currentRoomId(): string | null;
  /** ROOM DETAILS PARITY — THE HOST OPENED OR CLOSED THE PANEL ITSELF (the dock's Room tile, Escape, the
   *  close button). Nothing is announced back, exactly as clearCoworkerSelection announces nothing:
   *  without it the world would still hold the last room and a click on that same floor would be deduped
   *  away as "already selected", opening nothing.
   *
   *  OPENING A ROOM THIS WAY ALSO FRAMES IT, so the tile and a floor click land on the same view rather
   *  than on two. Closing (null) frames nothing and moves nothing — the camera is left exactly where the
   *  employee has it, panned or zoomed. PLAYER is refused outright: the camera belongs to the body there. */
  setSelectedRoom(roomId: string | null): void;
  /** PHASE 7A PARITY — ease back to the view the employee had before a selection was framed. V1's
   *  closeCharacterMenu does this on dismiss; V1 deliberately does NOT do it when an action was taken
   *  (opening a chat panel must not yank the camera), so the host calls this only where V1 does. */
  restoreCameraView(): void;
  /** PHASE 6D — WALK THIS EMPLOYEE UP TO THAT PERSON AND TURN TO FACE THEM.
   *
   *  The ONE verb of Phase 6D the world owns, because moving this body is its job: it routes through the
   *  same planner, the same attendance boundary and the same Phase 5 movement sink every other walk goes
   *  through (walkToGround), so peers replay it exactly as they replay a click-to-walk. Returns false when
   *  the person has no body, or when no standable spot beside them exists, or when the walk was refused.
   *  `Vo3dCoworkerInteractions.onApproachArrived` fires once the turn finishes. */
  approachCoworker(email: string): boolean;
  /** PHASE 7G — THE TOUCAN, as the HUD reaches it. One bird, one mode switch; see world/Toucan.ts. */
  toucanSummon: Vo3dToucanSummon;
  /** Where the bird is on screen right now, for the world-space pill over it. Null while it is not being
   *  drawn (its ambient lap is hidden in the OFFICE presentation) or while it is behind the camera. */
  toucanAnchor(): Vo3dScreenAnchor | null;
}

/** PHASE 7G — CALLING THE BIRD.
 *
 *  V1's contract, in V2's world: `call()` is the intent ("come here"), the world flies the bird to this
 *  body, and the ARRIVAL is what the host waits for before opening the assistant — exactly as V1's office
 *  waits for its own `attending`. `release()` withdraws the intent and the bird goes home; it says nothing
 *  about the conversation, which lives on the server and is never touched from here. */
/** ROOM DISCOVERY — a label's anchor, plus THE ROOM'S OWN PROJECTED FOOTPRINT in CSS pixels.
 *
 *  The footprint is what the type is fitted to (see roomFocus's roomLabelFontPx): the name is set as
 *  large as it will comfortably sit inside its own floor, so a big room wears big type at the same zoom a
 *  small one wears small type — and a name that fits inside its own floor cannot reach into the room next
 *  door. Measured from the rect's four corners through the live camera, so it is honest in both the
 *  near-orthographic OFFICE view and the perspective of 3D EXPLORE. */
export interface Vo3dRoomLabelAnchor extends Vo3dScreenAnchor {
  widthPx: number;
  heightPx: number;
}

export interface Vo3dToucanSummon {
  /** Come here. Idempotent: calling an already-parked bird re-reports `attending` and moves nobody. */
  call(): void;
  /** Let it go. The bird flies to its perch and eventually rejoins its lap; nothing is deleted. */
  release(): void;
  /** V1's own coarse state. Pushed on every real change and once immediately on subscribe. */
  subscribe(listener: (state: ToucanSummonState) => void): () => void;
  state(): ToucanSummonState;
}

/** BUILD A V2 WORLD ON `canvas`. Everything below this line is the module body app/bootstrap.ts used to
 *  run as top-level side effects, wrapped verbatim and indented one level — no statement was reordered,
 *  renamed or rewritten. The only deletions are the `document.getElementById("stage")` lookup (the canvas
 *  is a parameter now) and nothing else; the additions are the disposal bookkeeping, each marked LIFECYCLE.
 *
 *  `identity` is the signed-in employee, ALREADY RESOLVED by the caller (app/Vo3dHost.tsx via
 *  adapters/v1Identity). It is optional, and omitting it is not a degraded mode: the standalone dev page
 *  (app/bootstrap.ts, dev/vo3d.html) passes nothing and gets byte-for-byte the behaviour it always had.
 *  This world never fetches it, never stores it and never re-reads it — it is a value, taken once.
 *
 *  `homeDesk` is the same kind of value for WHERE that employee's desk is (app/spawn.ts, resolved by
 *  adapters/v1HomeDesk). Omitting it keeps the default spawn below, byte for byte. It is a PREVIEW of a
 *  desk and nothing more: this world reads no attendance, restores no persisted position and writes
 *  nothing back, so it may never be presented as "checked in". */
export function createVo3dWorld(canvas: HTMLCanvasElement, identity?: Vo3dIdentity, homeDesk?: Vo3dHomeDesk, selfMovement?: Vo3dSelfMovementSink, season: SeasonTheme = "none"): Vo3dWorld {
  // ---- LIFECYCLE ---------------------------------------------------------------------------------
  // The three things a top-level module body never had to think about, because the document outlived it.
  //
  // `disposed` is the guard EVERY asynchronous continuation checks before it touches anything. The world
  // fires several fire-and-forget loads (the boss statues, the monkey, Bon's GLB, the toucan) whose
  // `.then()` runs whenever the network and the Draco decoder get round to it — which may be long after
  // a mount was thrown away. Without the guard those callbacks add meshes to a dead scene and call
  // invalidateShadows() on a renderer whose context has been force-lost.
  let disposed = false;
  /** The frame the render loop has already asked for, so dispose() can cancel it. */
  let rafHandle = 0;
  /** Teardown callbacks, run in REVERSE order of registration: a thing is torn down before anything it
   *  was built on top of, which is the only ordering that is safe without writing the order out by hand. */
  const disposers: (() => void)[] = [];
  /** addEventListener + its matching removeEventListener, registered in one place so the two can never
   *  drift apart. Every listener this body installs goes through one of these three. They are per-target
   *  rather than one generic helper so the handler's event type is still INFERRED exactly as
   *  addEventListener infers it — the handler bodies below are unchanged from when they were passed to
   *  addEventListener directly. */
  function onWindow<K extends keyof WindowEventMap>(type: K, handler: (e: WindowEventMap[K]) => void): void {
    window.addEventListener(type, handler as EventListener);
    disposers.push(() => window.removeEventListener(type, handler as EventListener));
  }
  function onDocument<K extends keyof DocumentEventMap>(type: K, handler: (e: DocumentEventMap[K]) => void): void {
    document.addEventListener(type, handler as EventListener);
    disposers.push(() => document.removeEventListener(type, handler as EventListener));
  }
  function onCanvas<K extends keyof HTMLElementEventMap>(type: K, handler: (e: HTMLElementEventMap[K]) => void): void {
    canvas.addEventListener(type, handler as EventListener);
    disposers.push(() => canvas.removeEventListener(type, handler as EventListener));
  }

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
  const params = {
    pitch: 52, yaw: 0, zoom: 1.32,
    lightAzimuth: DEFAULT_LIGHT.azimuth, lightElevation: DEFAULT_LIGHT.elevation, keyIntensity: DEFAULT_LIGHT.keyIntensity,
    ambientIntensity: DEFAULT_LIGHT.ambientIntensity, envIntensity: DEFAULT_LIGHT.envIntensity, exposure: DEFAULT_LIGHT.exposure,
    shadows: true, ao: true, sway: true, ambient: true, wallHeight: DESIGN_SHELL.wallHeight, frontWall: "low" as "low" | "full" | "hidden",
    overlay: true, motion: false, preset: "A" as PresetId, captureSeconds: 30, roomCulling: true,
    envTime: "auto" as EnvTimeMode, envScenery: true, envFog: true, envSky: true,
    envWeather: "auto" as WeatherMode, envRainInOffice: true, envTransitions: true, envLightning: true,
    cameraMode: "office" as CameraModeId, shadowCache: true,
    playerView: "third" as PlayerView,
    avatar: true, avatarLod: 1 as AvatarLod, avatarLit: true, walkSpeed: PLAYER_WALK_SPEED,
    envAudio: true, envAudioVolume: 0.7,
    clickToWalk: true, showGrid: false, showBlocked: false, showRegions: false, showPath: true, showDestination: true, showDiagnostic: false,
    editMode: false,
  };
  // STATIC BATCHING (V2 slice 3) — on by default; `?batch=0` builds the pre-slice-3 scene graph so the
  // whole-office A/B is two loads of the same page under identical conditions. Read BEFORE the mirror is
  // built, because the batching happens as each group is built and cannot be toggled after the fact.
  const flags = new URLSearchParams(location.search);
  setStaticBatching(flags.get("batch") !== "0");
  // SSAO DEPTH REUSE (V2 slice 4) — on by default; `?ao=legacy` rebuilds the stock SSAOPass, which draws
  // the whole scene a second time into a normal buffer. Read BEFORE the Renderer is built: the beauty
  // buffer's depth texture and the AO shader patch are both decided once, in its constructor.
  setSSAODepthReuse(flags.get("ao") !== "legacy");
  // SPLIT SHADOW UPDATE (shadow phase) — on by default; `?shadowcache=0` restores the single full redraw
  // per invalidation, which is what the before/after A/B is run against. Applied right after the Renderer
  // is built, below, because the flag has to be read before the first frame.
  const R = new Renderer(canvas, DESIGN_ROOM.rect);
  R.shadowCache = flags.get("shadowcache") !== "0";
  params.shadowCache = R.shadowCache;
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
  void loadBossStatues(mirror.root).then(() => {
    if (disposed) return; // LIFECYCLE: the world was unmounted while this was in flight
    R.invalidateShadows();
    // ...and so does room-level culling: the statues joined the Central Hub's subtree AFTER its bounds
    // were measured, so those bounds are re-taken. (They stand well inside the room, but a visibility
    // system that quietly runs on stale bounds is the kind that pops once, months later.)
    mirror.visibility.invalidate();
  });
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
  /** PHASE 7C — the Cave meeting, pushed to the HUD. Edge-triggered off a signature rather than sent
   *  every frame: the HUD renders React, and a meeting whose mic did not change is not news. */
  const caveMeetingListeners = new Set<(s: Vo3dCaveMeetingState) => void>();
  let lastCaveMeetingSignature = "";
  function readCaveMeeting(): Vo3dCaveMeetingState {
    const st = caveLiveShare.state;
    return {
      inside: caveTransition?.inside ?? false,
      status: st.status,
      session: st.session,
      kind: st.kind,
      mic: st.mic,
      camera: st.camera,
      sharing: st.sharing,
      cameras: st.cameras,
      people: st.people,
      live: st.live,
      host: st.host,
      isHost: st.isHost,
      presenter: st.presenter,
      note: st.note,
    };
  }
  function notifyCaveMeetingIfChanged(): void {
    if (caveMeetingListeners.size === 0) return;
    const next = readCaveMeeting();
    const signature = Object.values(next).join("|");
    if (signature === lastCaveMeetingSignature) return;
    lastCaveMeetingSignature = signature;
    for (const cb of caveMeetingListeners) cb(next);
  }

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

  // ---- THE AI LAB: a hidden R&D annexe on the north-east lawn --------------------------------------
  // SCENERY-SHAPED, exactly like the campus above it: one group added straight to the scene, never to the
  // world graph, the room mirror, the nav grid, the editor or the shadow-caster set. Its walkability is
  // its OWN geometry (world/ailab), composed into the player's stand test beside the office's and the
  // CAVE's — the same off-grid pattern, for the same reason: the V1 lattice does not reach out here.
  // It is hidden in OFFICE mode, which is the one framing whose cost is the product experience.
  const aiLab = buildAiLab();
  R.scene.add(aiLab.group);
  aiLab.group.visible = false;
  // THE AI LAB MONKEY — DEV-ONLY, OFF BY DEFAULT. `?monkey=1` constructs it; without
  // the flag nothing is created, nothing is fetched and the render loop's hook is a
  // null-guarded no-op, so the normal office is byte-for-byte the scene it was.
  // It follows the Lab's own visibility, so it is hidden in OFFICE framing too.
  const monkey = flags.get("monkey") === "1" ? new MonkeyAvatar() : null;
  if (monkey) {
    R.scene.add(monkey.root);
    void monkey.load().then((ok) => {
      if (disposed) return; // LIFECYCLE: the world was unmounted while this was in flight
      if (ok) {
        monkey.visible = aiLab.group.visible;
        // THE TOUCAN AI SCIENTIST OUTFIT — its own flag, so the bare approved
        // master stays one URL away: `?monkey=1` undressed, `&outfit=1` dressed.
        if (flags.get("outfit") === "1") monkey.dress();
        // warm-ivory sclera correction; `?eyes=0` keeps the shipped grey texture
        if (flags.get("eyes") !== "0") void monkey.warmEyes();
        R.invalidateShadows();
      }
    });
  }
  const timeOfDay = new TimeOfDay();
  /** Set by the season layer when it attaches; null in the ordinary office. See applyEnvPhase. */
  let seasonAutoPhase: EnvPhase | null = null;
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
    // A SEASON SETS WHAT "AUTO" MEANS, AND NOTHING ELSE. A Halloween office at midday fights its own
    // art direction, so while a season is on and the employee has made NO time choice, AUTO resolves to
    // the season's intended hour. The moment they pick a time in Settings, `timeOfDay.mode` is no longer
    // "auto" and this branch stops applying — their choice moves the world, within the season's grade.
    const phase = seasonAutoPhase !== null && timeOfDay.mode === "auto" ? seasonAutoPhase : timeOfDay.phase(now);
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
  // SETTINGS -> ENVIRONMENT -> THIS WORLD. The employee's own time-of-day and weather choice, read from
  // the SHARED store (services/settings/environmentPreferences) exactly as the ambient bed below reads
  // its own. That store is the ONE source of truth for the choice; this world does not remember it, it
  // applies it — which is why the choice survives a reload, a canvas remount and every view change,
  // none of which this object does.
  //
  // AUTO on either axis writes "auto" here, which is the value TimeOfDay/Weather already default to, so
  // the automatic behaviour underneath is reached by the same code path it always was.
  //
  // `params` is kept in step so the inspection rig's rows never disagree with what is on screen.
  const applyEnvironmentPreference = (): void => {
    const { time, weather: wx } = getEnvironmentPreferences();
    params.envTime = time;
    timeOfDay.mode = time;
    params.envWeather = wx;
    weather.mode = wx;
  };
  applyEnvironmentPreference();
  applyEnvPhase(true);

  // ══ THE SEASONAL DECORATION LAYER ══
  //
  // Attached over the world that has already been built, and it is the ONLY thing in this file a season
  // touches. It adds its own groups to the scene and hands the Environment one overlay table; it never
  // reads or writes WorldState, so navigation, collision, seating, doors, avatars and interactions are
  // the same objects they were a line earlier — not preserved by care here, but unreachable from there.
  //
  // `rooms` comes from WorldState rather than from the floor plan because that is where the authored
  // rect and the walkable floorRect live together, which is what the placement rules measure from.
  const seasonLayer: BuiltSeasonLayer | null = createSeasonLayer(season, {
    scene: R.scene,
    rooms: [...world.rooms.values()].map((r) => ({ id: r.id, rect: r.rect, floorRect: r.floorRect })),
    doors: plan.openings,
    // The two exterior rects, for the seasons that decorate outside the building. Both come straight
    // from the floor plan, so nothing here invents a coordinate.
    frame: plan.frame,
    sidewalk: plan.sidewalk,
    setEnvOverlay: (grade, autoPhase) => {
      env.season = grade;
      seasonAutoPhase = autoPhase;
      applyEnvPhase(true);
    },
    // A SEASON MAY CHANGE WHAT IS FALLING, AND NOTHING ELSE ABOUT THE WEATHER. env/Environment swaps
    // the existing precipitation field into snow mode; the employee's own manual weather and time
    // choices, the storm, the wetness and the wind are all still whatever they chose.
    setSnowfall: (spec) => { env.snowfall = spec; },
    invalidateShadows: () => R.invalidateShadows(),
  });

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
  // WHICH BODY THE PLAYER GETS. Three cases, and the third one is a deliberate ABSENCE:
  //   no identity          -> undefined -> Avatar's own BON_LODS default. The standalone page, unchanged.
  //   identity + avatarId  -> that employee's own three LOD urls, straight from the production registry.
  //   identity, no avatarId-> null. NOTHING IS LOADED. A real employee with no approved 3D asset set is
  //                           shown an explicit missing-avatar state, because the alternative — dressing
  //                           them in Bon's body — is the exact failure data/avatarIdentity.ts refuses to
  //                           make in V1 ("a real unmapped person has no character yet"). V2 has no 3D
  //                           placeholder to stand in, so the honest answer is an empty one.
  //
  //   The third case covers TWO different absences, and both resolve to the same honest answer: an
  //   employee with no avatar id at all, and one whose avatar id names a V1 SPRITE character that was
  //   never given a 3D body (data/avatarRegistry lists people V2's GLB registry does not — "lui" is one
  //   today). hasCastLods is what tells them apart from a real cast member; without it the second case
  //   threw inside castLods and took the whole world down instead of showing the missing-avatar state.
  const avatarLods: Record<AvatarLod, string> | null | undefined =
    identity === undefined ? undefined : identity.avatarId && hasCastLods(identity.avatarId) ? castLods(identity.avatarId) : null;
  /** True when this world knows WHO the player is but has no character to put them in. */
  const avatarMissing = avatarLods === null;
  const avatar = new Avatar({ height: BON_STANDING_HEIGHT, lit: params.avatarLit, lods: avatarLods ?? undefined });
  R.scene.add(avatar.root);
  // Bon is a DYNAMIC shadow caster: his body is composited over the cached static shadow depth every frame
  // he moves, instead of dragging the whole ground floor through the shadow pass with him. See Renderer.
  R.addDynamicCaster(avatar.root);
  const stack = new ControllerStack();
  const navCtl = new NavigationController(avatar, stack);
  // ONE SPEED, TWO CONSUMERS. The slider drives both the click-to-walk router and the direct-control player;
  // the controller's own class default is the figure the walk clip was authored for, and would otherwise
  // leave the panel reading 70 while a planned walk still ambled at 30.
  navCtl.speed = params.walkSpeed;
  /** The player label for the dev readout: who this world thinks you are, and which character it drew.
   *  Name and character id only — never the email, the id or anything from the session. */
  const who = identity
    ? `${identity.displayName} · ${identity.avatarId ?? "no 3D avatar"} (${identity.source})`
    : "standalone · default character";
  const avatarState = { who, spawn: homeDesk ? "resolving…" : "default (Design Room chair 4)", status: "loading…", clip: "", position: "", owner: "Idle", triangles: 0 };
  function loadAvatar(): void {
    if (avatarMissing) {
      // Not an error and not a retry: there is no asset to ask for. Stated once, and the LOD selector
      // below re-states it rather than firing a load that would 404.
      avatarState.status = `no 3D avatar registered for ${identity?.displayName ?? "this employee"} — nothing loaded`;
      return;
    }
    avatarState.status = `loading LOD${params.avatarLod}…`;
    avatar.load(params.avatarLod).then(() => {
      if (disposed) return; // LIFECYCLE: the world was unmounted while this was in flight
      R.markDynamicCaster(avatar.root); // the meshes only exist now — re-mark the subtree
      R.invalidateShadows(); // a body just entered the scene; it has to enter the shadow map too
      avatarState.status = `LOD${params.avatarLod} loaded · native ${avatar.nativeHeight.toFixed(2)} → ${BON_STANDING_HEIGHT} units`;
      avatarState.triangles = Math.round(avatar.triangles);
      // PHASE 6C — a seated RESTORE that landed before the GLB did was posed without the clip's hip data
      // (seatContact reads it from the loaded rig). Re-pose it now, in place, with the real numbers.
      if (restoredSeat?.state === "seated") restoredSeat.setSeatedYaw(restoredSeat.spec.seatedYaw);
      if (restoredLounge?.state === "seated") restoredLounge.setSeatedYaw(restoredLounge.slot.seatedYaw);
    }).catch((e: unknown) => { if (disposed) return; avatarState.status = `load failed: ${String(e).slice(0, 80)}`; });
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

  // ---- the self-movement feed (Phase 5) ------------------------------------------------------------
  // V2 DRIVES THE BODY; V1 CARRIES THE MOVEMENT. `selfMovement` is the sink the caller handed over
  // (app/Vo3dHost.tsx via adapters/v1SelfMovement) and is UNDEFINED for the standalone dev page, which
  // therefore builds no feed, publishes nothing and costs nothing — byte for byte the behaviour
  // dev/vo3d.html always had. See app/selfMovement.ts for what the feed decides and why.
  //
  // THE COORDINATE BOUNDARY IS HERE, ONCE. The feed and everything above it work in world units; the
  // sink speaks V1 frame units. "Where a V2 room actually stands" is V2's own fact about its own geometry
  // (ROOM_WORLD_SHIFT_Z, one table), so undoing it belongs on this side of the line — the same split the
  // home-desk spawn and the coworkers' `toWorld` already make, run in the opposite direction.
  //
  // `v1Rooms()` is resolved ONCE here rather than per call: this conversion now runs on every published
  // waypoint, and rebuilding an 11-room array inside a per-frame path was the kind of quiet cost Phase 4C
  // spent its time removing.
  const selfFrameRooms = v1Rooms();
  const toV1Frame = (p: Vec2): Vec2 => v1FramePoint(p, selfFrameRooms, ROOM_WORLD_SHIFT_Z);
  const selfFeed = selfMovement
    ? new SelfMovementFeed(
        {
          state: selfMovement.state,
          started: (origin, path, durationMs, pacing) => selfMovement.started(toV1Frame(origin), path.map(toV1Frame), durationMs, pacing),
          // PHASE 6C — `seat` MUST ride through here. Dropping it published every sit as a standing arrival
          // at the body position: the seated browser saw itself sitting and every other browser stood it
          // beside the chair (the observed A/B mismatch). world.seatWiring.test.ts pins this line.
          arrived: (at, facing, yaw, seat) => selfMovement.arrived(toV1Frame(at), facing, yaw, seat),
          // PHASE 7D — the named-place snap, converted through the SAME frame mapping as everything else.
          enteredPlace: (at, yaw, room, localAt) => selfMovement.enteredPlace(toV1Frame(at), yaw, room, localAt),
          // The ANCHOR goes through the V1 frame mapping like every other V1 coordinate; `from`/`to`
          // are world points in the place's own frame and are deliberately NOT converted.
          movedInPlace: (anchor, from, to, yaw, room) =>
            selfMovement.movedInPlace(toV1Frame(anchor), from, to, yaw, room),
        },
        // WHERE V1 CAN HOLD A POSITION AT ALL — the V1 frame, and nothing outside it. V2's world extends
        // well past it (the campus legs, the AI Lab at negative z, the CAVE at x 2600) and V1 has no
        // coordinate for any of that. The feed uses this to CLOSE a leg at the boundary instead of
        // accumulating across it, which is what fixes the return from outside: without it, a leg whose
        // origin was out there was refused whole by the adapter and every peer stayed at the last place
        // V2 managed to publish. Deliberately stricter than the adapter's own out-of-frame slack, so
        // anything the feed offers is something the adapter can express.
        (p) => pointInRect(toV1Frame(p), FRAME),
      )
    : null;
  /** Has the person at the keyboard moved themselves yet? Gates the one-shot V1 position restore below,
   *  the same way V1's own spawnMovedRef gates its: a restore that lands mid-walk would yank somebody out
   *  of a walk they started, and once they have moved, where they started stopped being meaningful. */
  let selfMovedByUser = false;
  /** The restore has already landed; it is a one-shot. */
  let selfRestored = false;

  // ---- the working-office boundary (Phase 5) -------------------------------------------------------
  // WHAT REQUIRES A CHECK-IN, AND WHAT DOES NOT. Attendance and world access are separate: being checked
  // out never logs anybody out of V2 and never stops them exploring. Reception, the street, the campus
  // legs and the AI Lab stay open at every attendance state — and they are all reachable without touching
  // the office, because the Lab is approached entirely OUTSIDE the V1 frame (world/ailab.ts's APRON →
  // LEG_N → PATH_W → PATH_IN, east then north of the frame). What requires a confirmed V1 check-in is the
  // WORKING OFFICE: everything past Reception's speed gates.
  //
  // V1 IS THE AUTHORITY AND THE ONLY ONE. The answer arrives through setOfficeAccess below, read by
  // app/Vo3dHost.tsx from V1's own services/attendance. This file decides no work session, writes none,
  // and holds no status — see app/access.ts for why the offline lineup is NOT the authority (it fails
  // open across a backend restart) and why `unknown` shuts the gate without moving anybody.
  const accessGeom: AccessGeometry = {
    frame: FRAME,
    facadeZ: FACADE_Z,
    receptionRect: v1Rooms().find((r) => r.id === RECEPTION_ROOM_ID)!.rect,
    gateZ: GATE.z,
  };
  /** Reception's PUBLIC side, a known-legal stand point south of the gates. The same point the entrance
   *  dev button has always used (RECEPTION_INSIDE below is now this constant), so "where a body goes when
   *  it may not be in the office" and "where the entrance tour starts" cannot drift apart. */
  const OFFICE_EXIT_STAND: Vec2 = { x: 600, z: 1096 };
  /** THE GATE, AS THE ONLY THING THAT ACTUALLY BLOCKS. Rasterised once from the three lane rects and
   *  handed to Walkability's OWN reservation mechanism — the same one seat interactions use — because
   *  every mover in this world already consults it: the router through `walkable`, and the body through
   *  the stand test's `walkability.walkable` (player/standTest.ts). Closing the lanes therefore closes
   *  walking, A* pathfinding and Player Mode in one place, with no new blocking mechanism and no second
   *  code path to keep in step. A teleport does not route, so those are guarded separately (mayPlaceAt).
   *
   *  It is ~35 cells: the three passages and nothing else. Every other walkable cell in the building
   *  stays walkable, which is what keeps this a boundary rather than a global movement block. */
  const gateCells = (() => {
    const out: Cell[] = [];
    for (const r of gateRects(GATE.lanes, { z0: GATE.bandZ0, z1: GATE.bandZ1 }))
      for (let cy = Math.floor(r.z / CELL); cy <= Math.floor((r.z + r.d - 0.001) / CELL); cy++)
        for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w - 0.001) / CELL); cx++)
          out.push({ cx, cy });
    return out;
  })();
  const GATE_RESERVATION = "office-access-gate";
  /** PHASE 7E — THE EXIT, held the same way and for the same reason the gate is.
   *
   *  THE DOORWAY, AND ONLY THE DOORWAY. This was first rasterised from the door's `clearance.band` — the
   *  V1 '+' span, which is FIVE cell rows deep (z 1120…1200) because that is what the leaves sweep and
   *  what the grid paints as openable. Reserving all of it walled off the doorway PLUS sixty-odd units of
   *  PUBLIC PAVEMENT in front of it, which is not this gate's to hold: an employee walking the sidewalk
   *  past their own entrance was stopped by it, and one coming back from the AI Lab could not reach the
   *  doors at all.
   *
   *  So it is the OPENING: the V1 door span, two cell rows deep from the façade plane. That covers the
   *  threshold and the leaf line — enough that a body (radius 10.5 in a 16-unit grid) cannot straddle it —
   *  and stops at the building line, where the street begins.
   *
   *  Reserving it stops the body, the router and PLAYER mode at once, and it keeps the doors SHUT without
   *  touching SlidingDoor at all: a door opens for a body in its crossing or a route through it, and a
   *  reservation makes both impossible. */
  const EXIT_RESERVATION = "office-exit-door";
  const FACADE_DOOR = FACADE_SPEC.door;
  const EXIT_BAND: Rect = { x: FACADE_DOOR.x0, z: FACADE_SPEC.z, w: FACADE_DOOR.x1 - FACADE_DOOR.x0, d: 2 * CELL };
  const exitCells = (() => {
    const out: Cell[] = [];
    for (let cy = Math.floor(EXIT_BAND.z / CELL); cy <= Math.floor((EXIT_BAND.z + EXIT_BAND.d - 0.001) / CELL); cy++)
      for (let cx = Math.floor(EXIT_BAND.x / CELL); cx <= Math.floor((EXIT_BAND.x + EXIT_BAND.w - 0.001) / CELL); cx++) out.push({ cx, cy });
    return out;
  })();
  let exitAuthorized = false;
  /** Set once an authorised body has actually left the frame, so the authorisation is spent on the way
   *  back in rather than lingering for the rest of the session. */
  let exitUsed = false;
  const exitState = { held: "no", authorized: "no", prompts: 0 };
  /** A position no door's trigger can reach, and an empty route. What the entrance doors are shown while
   *  the exit is held — see the frame loop. */
  const DOOR_SUPPRESSED: Vec2 = { x: -1e6, z: -1e6 };
  const NO_ROUTE: readonly Vec2[] = [];
  /** …and nobody at all, for the same suppression — see the entrance door in the frame loop. */
  const NO_BODIES: readonly DoorBody[] = [];
  let officeAccess: OfficeAccess = "unknown";
  const accessState = { access: "unknown", gate: "closed", zone: "—", ejections: 0, sensors: "refusing (red)" };
  /** A restore that arrived while the gate was shut and the target was inside the office. Held rather than
   *  discarded: the employee may be checked in and simply waiting on the read, and their persisted
   *  position is still the right answer once V1 confirms it. Retried from setOfficeAccess. */
  let pendingRestore: { point: Vec2; facing: Facing; seat?: string; place?: string } | null = null;

  const zoneOf = (p: Vec2): Zone => zoneAt(p, accessGeom);
  /** May a body be PUT at this point? The teleport/restore counterpart of the closed lanes — routing is
   *  already refused by the reservation, but nothing routes a placement, so the boundary is asked here
   *  directly. Covers the V1 position restore, the two dev placement buttons and the CAVE portal. */
  const mayPlaceAt = (p: Vec2): boolean => mayEnterOffice(officeAccess) || zoneOf(p) !== "office";

  // Closed until V1 says otherwise. The world is built before the attendance read resolves, so the gate
  // starts shut — the one direction where being wrong for half a second is harmless.
  walkability.reserve(GATE_RESERVATION, gateCells);

  function setOfficeAccess(next: OfficeAccess): void {
    if (disposed || next === officeAccess) return;
    officeAccess = next;
    accessState.access = next;
    if (mayEnterOffice(next)) {
      walkability.release(GATE_RESERVATION);
      accessState.gate = "open";
    } else {
      walkability.reserve(GATE_RESERVATION, gateCells);
      accessState.gate = "closed";
      // A WALK ALREADY QUEUED UNDER THE OLD ANSWER must not be honoured: the router cleared it when the
      // lanes were open, and the waypoints do not re-consult walkability as they are consumed. Stopping
      // it here is the same stop an interruption performs, so the self-movement feed resolves the
      // movement at the body's real position rather than leaving peers at a destination nobody reached.
      if (routeEntersOffice(navCtl.path, accessGeom)) navCtl.stop();
      // DENIED MOVES A BODY; UNKNOWN NEVER DOES. A confirmed checkout with the employee still inside
      // (the V2 route opened while checked out, or a checkout from another tab) would otherwise seal them
      // in behind their own closed gate. `unknown` is excluded deliberately: relocating a checked-in
      // employee for the half second before their check-in is confirmed is the worse failure.
      if (next === "denied") ejectFromOffice();
    }
    // NO LOCAL GRANT SURVIVES THE ANSWER THAT ENDED IT.
    //
    // `exitAuthorized` is a permission this session handed out — for an AI Lab trip, or for the walk out
    // after a confirmed check-out — and it belongs to the work session it was granted in. Once V1 says
    // anything other than CHECKED_IN, that session is over, so the grant is dropped rather than left to be
    // spent later by a body that has since checked in again. It costs a checked-out employee nothing: the
    // exit is only ever HELD for a confirmed check-in (see applyExitGate), so they still walk out freely.
    //
    // This is the one direction a stale flag could have mattered: without it, an employee who checked out
    // and checked straight back in at the kiosk without leaving would start their new session with the
    // doors already unheld — a grant nobody made for that session.
    if (!mayEnterOffice(next)) {
      exitAuthorized = false;
      exitUsed = false;
      exitPrompted = false;
      exitState.authorized = "no";
    }
    applyExitGate(avatar.worldPosition());
    navDebug.refreshDynamic(walkability);
    if (pendingRestore && mayEnterOffice(officeAccess)) {
      const r = pendingRestore;
      pendingRestore = null;
      restoreSelf(r.point, r.facing, r.seat, r.place);
    }
  }

  /** IS THE EXIT HOLDABLE FROM WHERE THE BODY ACTUALLY IS?
   *
   *  A reservation is a wall, and a wall is only a boundary if you are on one side of it. Two cases where
   *  holding this one would TRAP rather than stop:
   *
   *    • THE BODY IS OUTSIDE. Somebody on the street is coming HOME, and coming home is not a decision
   *      anybody needs to be asked about — they are still checked in, and the office behind Reception is
   *      guarded by its own gate regardless. Holding the doorway against them is how an employee ends up
   *      standing at their own front door unable to open it.
   *    • THE BODY OVERLAPS THE DOORWAY. The stand test refuses every point whose body circle touches a
   *      reserved cell, so a body standing IN the opening when the reservation lands cannot step out of it
   *      in any direction — including backwards. It is released until they are clear, and re-applied the
   *      moment they are, which is a beat later and inside the building.
   *
   *  Neither case can be reached while the exit is already held: a held doorway is unreachable, so a body
   *  can only be in or beyond it if it got there while the exit was open. */
  const exitHoldable = (at: Vec2): boolean =>
    zoneOf(at) !== "outside" && !circleOverlapsRect(at, NAV_RADIUS, EXIT_BAND);

  /** Hold or release the exit from the facts that decide it, and from nothing else. Called every frame
   *  with the body's real position; the walkability write happens only when the answer actually changes,
   *  so the per-frame cost is one zone test and one circle test. */
  let exitHeldNow = false;
  function applyExitGate(at: Vec2): void {
    const hold = mayEnterOffice(officeAccess) && !exitAuthorized && exitHoldable(at);
    exitState.authorized = exitAuthorized ? "yes" : "no";
    if (hold === exitHeldNow) return;
    exitHeldNow = hold;
    exitState.held = hold ? "yes" : "no";
    if (hold) {
      walkability.reserve(EXIT_RESERVATION, exitCells);
      // A WALK ALREADY QUEUED THROUGH THE DOORWAY must not be honoured — the same reason, and the same
      // stop, as the access gate above: waypoints do not re-consult walkability as they are consumed.
      if (navCtl.path.some((p) => pointInRect(p, EXIT_BAND))) navCtl.stop();
    } else {
      walkability.release(EXIT_RESERVATION);
    }
    navDebug.refreshDynamic(walkability);
  }
  function setExitAuthorized(on: boolean): void {
    if (disposed || on === exitAuthorized) return;
    exitAuthorized = on;
    exitUsed = false;
    exitPrompted = false;
    applyExitGate(avatar.worldPosition());
  }
  /** PHASE 7E — WHERE THIS DEPARTURE IS GOING, told to the feed BEFORE the body crosses V1's frame.
   *
   *  The boundary publish is the only chance to name the destination: app/selfMovement.ts closes the leg at
   *  the last in-frame sample and, if a place is set, says which place at that same point. Setting it after
   *  they are already out there is too late — peers would have watched them walk to the façade and stop.
   *
   *  Purely a LABEL on the movement wire. No attendance, no status, no access. A departure that is then
   *  cancelled clears it, and coming back inside clears it in the frame loop. */
  function setDepartureDestination(place: "ai-lab" | null): void {
    if (disposed) return;
    selfFeed?.entering(place === "ai-lab" ? AI_LAB_PLACE_ID : null);
  }
  // ---- DND ROOM LOCKS (app/roomLocks.ts) ---------------------------------------------------------------
  // V1's door-approach gate, as a doorway that is actually shut. Who is locked arrives through
  // setLockedRooms; everything below only applies it from the body's real position and reports the edges.
  const roomLocks = new RoomLockController(
    collectLockableDoors(world),
    walkability,
    (p) => world.regionAt(p)?.roomId ?? null,
    NAV_RADIUS,
  );
  const roomLockState = { locked: "—", held: "—", authorized: "no", prompts: 0 };
  /** The walk a lock stopped at the door, kept so an accepted knock (or the lock lifting) resumes EXACTLY
   *  it — V1's `resume` continuation. Dropped by any newer walk. */
  let roomLockHeldWalk: { roomId: string; destination: Vec2 } | null = null;
  /** The room whose held door the body is currently standing at, so the host is told once per approach. */
  let roomLockPrompted: string | null = null;
  function applyRoomLocks(at: Vec2): void {
    if (roomLocks.apply(at)) navDebug.refreshDynamic(walkability);
    // A WALK ALREADY QUEUED THROUGH A DOORWAY THAT HAS JUST BEEN HELD must not be honoured — the same stop,
    // for the same reason, as the access gate and the exit: waypoints do not re-consult walkability.
    if (navCtl.path.length > 0 && roomLocks.routeCrossesHeld(navCtl.path)) navCtl.stop();
    const snap = roomLocks.snapshot();
    roomLockState.locked = snap.locked.join(",") || "—";
    roomLockState.held = snap.held.join(",") || "—";
    roomLockState.authorized = snap.authorized ?? "no";
    const intercepted = roomLocks.interceptedAt(at);
    if (intercepted === roomLockPrompted) return;
    // Told on the edges only: once when they arrive at a shut door, once when they walk away from it.
    if (roomLockPrompted !== null) coworkerInteractions?.onRoomLockAbandoned?.(roomLockPrompted);
    roomLockPrompted = intercepted;
    if (intercepted !== null) {
      roomLockState.prompts++;
      coworkerInteractions?.onRoomLockIntercepted?.(intercepted);
    }
  }
  /** The held continuation goes ahead the moment its room no longer refuses this body — an accepted knock,
   *  or the lock lifting (V1's auto-cancel path re-checks the live lock and proceeds through the open door). */
  function resumeHeldWalkIfOpen(): void {
    const held = roomLockHeldWalk;
    if (!held || roomLocks.refuses(held.roomId, avatar.position)) return;
    roomLockHeldWalk = null;
    walkToGround(held.destination.x, held.destination.z);
  }
  function setLockedRooms(roomIds: readonly string[]): void {
    if (disposed) return;
    roomLocks.setLocked(roomIds);
    applyRoomLocks(avatar.worldPosition());
    resumeHeldWalkIfOpen();
  }
  function authorizeRoomEntry(roomId: string | null): void {
    if (disposed) return;
    roomLocks.authorize(roomId);
    applyRoomLocks(avatar.worldPosition());
    resumeHeldWalkIfOpen();
  }
  /** Has the exit prompt already been raised for this approach? Cleared when the body steps off the mat,
   *  so walking away and coming back asks again — and standing on it does not ask sixty times a second. */
  let exitPrompted = false;
  /** Is the signed-in body inside the AI Lab right now? Edge-detected in the frame loop below. */
  let selfInAiLab = false;
  const aiLabState = { inside: "no" };

  /** Stand a denied body back on Reception's public side. A PLACEMENT, not a movement — the feed is told
   *  so (Feed.placed), because this is V2 enforcing V1's own rule, not the employee walking anywhere. */
  function ejectFromOffice(): void {
    if (zoneOf(avatar.worldPosition()) !== "office") return;
    navCtl.stop();
    // PHASE 6C — A SEATED BODY IS STOOD UP FIRST. The interactions own the avatar while it sits (and have
    // it parented to the chair); resetting them returns the chair and the avatar before the body is moved.
    // The feed leaves its seated hold here and is NOT told `placed` below, so the jump to Reception is
    // published as the snap it is — that walk_started is what releases the seat on V1's side.
    const wasSeated = selfSeatedPublished;
    if (wasSeated) {
      const wp = avatar.worldPosition();
      selfFeed?.stood({ x: wp.x, z: wp.z }, avatar.yaw);
      selfSeatedPublished = false;
      currentSeatAnchor = null;
      clearSeats();
      if (seat.state !== "idle") seat.reset();
    }
    // RESOLVE THE WALK FIRST, WHERE THE BODY REALLY IS. Stopping the walker and moving the body in the
    // same tick never gives frame() its chance to resolve an interrupted walk, so without this the
    // walk_started that was in flight would never get its walk_arrived: peers keep replaying a route to a
    // destination nobody reached, and nothing durable is written for where they actually stopped. Observed
    // in a two-session run, not hypothesised.
    selfFeed?.interrupt(avatar.position, avatar.yaw);
    if (!playerMode.body.placeNear(OFFICE_EXIT_STAND)) return;
    const placed = playerMode.body.pos;
    avatar.setPosition(placed);
    if (!wasSeated) selfFeed?.placed(placed);
    if (playerMode.active) playerMode.camera.snap();
    accessState.ejections++;
    avatarState.spawn = `checked out — stood back on Reception's public side at ${placed.x.toFixed(1)}, ${placed.z.toFixed(1)}`;
    R.invalidateShadows();
  }

  // ---- interactions -------------------------------------------------------------------------------
  function walkToGround(x: number, z: number): NavResult {
    // PHASE 6D — a new walk supersedes an approach in flight: whatever this route is for, it is not
    // "stop in front of that person and turn to them" any more. approachCoworker re-arms it immediately
    // AFTER calling through here, which is why this cannot be conditional on where the walk is going.
    coworkerApproach = null;
    if (stack.owner === "Interaction" || stack.owner === "Editor") {
      // PHASE 6C — a floor click while SEATED stands the body up (the same stand the GUI button and
      // PLAYER mode's key perform); the destination itself is not honoured, because the stand sequence
      // walks the body back to the chair's approach cell and owns it until then. Standing is what
      // releases the seat on V1's side; the employee clicks again to walk on.
      const engaged = engagedSeat();
      if (stack.owner === "Interaction" && engaged) {
        engaged.stand();
        navState.last = "standing up — click again to walk";
        return { ok: false, reason: "outside-world", destination: null, cell: null };
      }
      navState.last = `ignored: avatar owned by ${stack.owner}`;
      return { ok: false, reason: "outside-world", destination: null, cell: null };
    }
    // A NEWER WALK SUPERSEDES A HELD ONE: whatever the lock was holding, this click is what they want now.
    roomLockHeldWalk = null;
    // THE BOUNDARY, STATED RATHER THAN IMPLIED. The closed lanes already make an office destination
    // unreachable, so this changes no outcome — it changes the REASON, from "unreachable" (which reads as
    // a pathfinding failure) to a refusal the readout can name. The router is still the thing that
    // enforces it; this is the honest message in front of it.
    if (!mayEnterOffice(officeAccess) && zoneOf({ x, z }) === "office") {
      navState.last = `refused: the working office needs a confirmed V1 check-in (attendance ${officeAccess})`;
      navDebug.showNav(avatar.position, { ok: false, reason: "unreachable", destination: { x, z }, cell: worldToCell({ x, z }) });
      return { ok: false, reason: "unreachable", destination: { x, z }, cell: worldToCell({ x, z }) };
    }
    // DND ROOM LOCK — V1's door-approach gate (feature spec sections 3/8). A destination inside a room that is
    // shut against this body never routes in: the body walks to that room's door and stops outside it, and
    // the destination is HELD so an accepted knock resumes exactly this walk. The reservation alone already
    // makes the interior unreachable; this turns "unreachable" into V1's "stop at the door and ask".
    const lockedTarget = world.regionAt({ x, z })?.roomId ?? null;
    if (lockedTarget !== null && roomLocks.refuses(lockedTarget, avatar.position)) {
      coworkerApproach = null;
      roomLockHeldWalk = { roomId: lockedTarget, destination: { x, z } };
      const door = roomLocks.nearestDoor(lockedTarget, { x, z });
      const refused: NavResult = { ok: false, reason: "unreachable", destination: { x, z }, cell: worldToCell({ x, z }) };
      if (!door) {
        navState.last = `held: ${lockedTarget} is DND-locked and has no door to wait at`;
        navDebug.showNav(avatar.position, refused);
        return refused;
      }
      const toDoor = planWalk(avatar.position, door.standPoint, walkability, inBounds);
      navDebug.showNav(avatar.position, toDoor);
      navState.last = toDoor.ok ? `held: ${lockedTarget} is DND-locked — walking to its door` : `held: ${lockedTarget} is DND-locked — door unreachable (${toDoor.reason})`;
      if (toDoor.ok) {
        const origin = avatar.position;
        if (navCtl.setPath(toDoor.path)) {
          selfMovedByUser = true;
          selfFeed?.planned(origin, toDoor.path, plannedDurationMs(origin, toDoor.path, navCtl.speed));
        }
      }
      return refused;
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
    if (result.ok) {
      // The ORIGIN is read before the walker touches anything (setPath only queues waypoints), so the
      // published movement starts exactly where the body stands. Published only when the walker actually
      // TOOK the path — setPath refuses while a higher-priority owner holds the avatar, and announcing a
      // walk that is not going to happen would leave every peer replaying a route nobody walked.
      const origin = avatar.position;
      if (navCtl.setPath(result.path)) {
        selfMovedByUser = true;
        selfFeed?.planned(origin, result.path, plannedDurationMs(origin, result.path, navCtl.speed));
      }
    }
    return result;
  }
  // dev-only tour: walk the given world points in a loop (visual verification + benchmark driver)
  let tour: { points: Vec2[]; i: number } | null = null;
  function startTour(points: Vec2[]): void { tour = { points, i: 0 }; walkToGround(points[0].x, points[0].z); }
  function stopTour(): void { tour = null; }
  navCtl.onArrive = () => {
    navDebug.clearNav();
    approachCtl.onArrived();
    // PHASE 6D — the walk part of an approach is done; the turn begins (see the frame loop), aimed from
    // where the body actually stopped at where that person actually is now.
    if (coworkerApproach) {
      resolveApproachYaw();
      coworkerApproach.turning = true;
    }
    if (tour) { tour.i = (tour.i + 1) % tour.points.length; const p = tour.points[tour.i]; walkToGround(p.x, p.z); }
  };
  // PHASE 6C — THE CONFIGURED FACING, applied at the ONE point each interaction is given its data: the
  // authored spec with `seatedYaw` replaced by data/seatFacing.json's word for that anchor (app/seats.ts
  // seatedYawFor). The world's own entity data is never written to; the peer pose and the published yaw
  // read the same function, so all three agree by construction.
  const seatSpecFor = (entityId: string): SeatCapability => {
    const spec = world.get(entityId).capabilities.seat!;
    return { ...spec, seatedYaw: seatedYawFor(entityId, spec.seatedYaw) };
  };
  const slotFor = (entityId: string, slot: LoungeSeatSlot): LoungeSeatSlot => ({ ...slot, seatedYaw: seatedYawFor(seatAnchorId(entityId, slot.id), slot.seatedYaw) });
  let seat = new SeatInteraction(avatar, stack, mirror.view(CHAIR_4_ID), seatSpecFor(CHAIR_4_ID), (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
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
  // PHASE 6C — EVERY piece of fixed seating in the world is sittable, not only the ones a room file
  // exported. The explicit list keeps its order (the GUI buttons index into it); anything with a lounge
  // capability it missed is appended, so a new sofa is sittable the day it is authored.
  const listedLoungeIds = new Set([...LOUNGE_SEAT_IDS, ...SOFA_SEAT_IDS, ...TUB_SEAT_IDS, SOFA_SEAT_ID, ...BAG_SEAT_IDS, ...HUB_LOUNGE_IDS, ...EXECUTIVE_LOUNGE_IDS, ...CMS_LOUNGE_IDS, ...DEV_LOUNGE_IDS, ...QA_LOUNGE_IDS]);
  const unlistedLoungeIds = [...world.entities.values()].filter((e) => e.capabilities.lounge && !listedLoungeIds.has(e.id)).map((e) => e.id);
  const loungeSeats = [...LOUNGE_SEAT_IDS, ...SOFA_SEAT_IDS, ...TUB_SEAT_IDS, SOFA_SEAT_ID, ...BAG_SEAT_IDS, ...HUB_LOUNGE_IDS, ...EXECUTIVE_LOUNGE_IDS, ...CMS_LOUNGE_IDS, ...DEV_LOUNGE_IDS, ...QA_LOUNGE_IDS, ...unlistedLoungeIds].flatMap((id) =>
    world.get(id).capabilities.lounge!.slots.map((s, i) => ({
      id, index: i, view: mirror.view(id), label: s.id,
      // THE SLOT IS READ WHEN A SIT STARTS, NEVER CACHED. The room editor may have moved this sofa since
      // boot, and a moved piece's slots are rewritten in the same world transaction as its transform
      // (editor/anchors.ts). Holding the slot OBJECT here would have walked Bon to where the sofa used to be.
      get slot() { return world.get(id).capabilities.lounge!.slots[i]; },
    })),
  );
  let loungeSeat: LoungeSeatInteraction | null = null;
  // ---- PHASE 6C — seat identity, occupancy and the seated hand-off to V1 ------------------------------
  /** The seat anchor (app/seats.ts id) the signed-in employee is sitting in or walking to sit in, or null.
   *  Set by every sit starter below and cleared when the body leaves the chair; it is what the feed's
   *  seated arrival names, and what a peer resolves back into the same chair. */
  let currentSeatAnchor: string | null = null;
  /** Has the feed been told the body is seated? Mirrors the interaction states below, one transition at a
   *  time, so seated() and stood() are each called exactly once per sit. */
  let selfSeatedPublished = false;
  /** Anchors other employees occupy right now — pushed by the host (Vo3dWorld.setOccupiedSeats). */
  let occupiedSeatIds = new Set<string>();
  const seatSyncState = { anchor: "none", seated: "no", occupied: 0, refusals: 0 };
  /** THE RESTORE SLOTS: a seat interaction constructed by restoreSelf for a chair V1 says this employee is
   *  already sitting in. One movable, one fixed; whichever kind the anchor is. Ticked in the frame loop
   *  and reset by clearSeats exactly like the per-room holders, so stand() and every later step are the
   *  ordinary sequence. */
  let restoredSeat: SeatInteraction | null = null;
  let restoredLounge: LoungeSeatInteraction | null = null;
  /** ANY OTHER movable chair: a seat-capability entity none of the per-room starters above lists. Same
   *  one-at-a-time controller, so every chair in the world is sittable by construction. */
  let otherSeat: SeatInteraction | null = null;
  function startOtherSit(id: string): void {
    approachCtl.cancel();
    clearSeats();
    currentSeatAnchor = id;
    otherSeat = new SeatInteraction(avatar, stack, mirror.view(id), seatSpecFor(id), (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
    otherSeat.sit();
  }
  /** The chair's own seated yaw for an anchor — what the seated arrival publishes, rather than the body's
   *  mid-turn yaw on the frame the glide begins. Null for an anchor this world has no chair for. */
  function seatedYawOf(anchor: string): number | null {
    const { entityId, slotId } = parseSeatAnchorId(anchor);
    if (!world.entities.has(entityId)) return null;
    const e = world.get(entityId);
    const authored = slotId === undefined ? e.capabilities.seat?.seatedYaw : e.capabilities.lounge?.slots.find((s2) => s2.id === slotId)?.seatedYaw;
    return authored === undefined ? null : seatedYawFor(anchor, authored);
  }
  /** The six Meeting conference chairs use the MOVABLE pattern — the same SeatInteraction the Design Room
   *  desk chair uses, one instance at a time. */
  let gamingSeat: SeatInteraction | null = null;
  const gamingState = { chair: "none", seat: "idle", chairRestError: 0, slot: "none", door: "closed" };
  function startGamingSit(index: number): void {
    if (stack.owner === "Interaction") return;
    loungeSeat?.reset();
    loungeSeat = null;
    if (gamingSeat && gamingSeat.state !== "idle") gamingSeat.reset();
    R.invalidateShadows(); // SEE clearSeats: a reset SNAPS a chair back and nothing else will report it
    const id = GAMING_CHAIR_IDS[index];
    currentSeatAnchor = id;
    gamingSeat = new SeatInteraction(avatar, stack, mirror.view(id), seatSpecFor(id), (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
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
    if (restoredSeat && restoredSeat.state !== "idle") restoredSeat.reset();
    restoredSeat = null;
    if (restoredLounge && restoredLounge.state !== "idle") restoredLounge.reset();
    restoredLounge = null;
    if (otherSeat && otherSeat.state !== "idle") otherSeat.reset();
    otherSeat = null;
    if (meetingSeat && meetingSeat.state !== "idle") meetingSeat.reset();
    if (gamingSeat && gamingSeat.state !== "idle") gamingSeat.reset();
    if (hubSeat && hubSeat.state !== "idle") hubSeat.reset();
    if (execSeat && execSeat.state !== "idle") execSeat.reset();
    if (cmsSeat && cmsSeat.state !== "idle") cmsSeat.reset();
    if (aiSeat && aiSeat.state !== "idle") aiSeat.reset();
    if (devSeat && devSeat.state !== "idle") devSeat.reset();
    if (qaSeat && qaSeat.state !== "idle") qaSeat.reset();
    // A RESET SNAPS ITS CHAIR back to the rest transform, and the interaction is usually discarded right
    // afterwards — so there is no later update() to report that move through SeatInteraction.moved, and
    // the chair would keep the shadow of the pose it was dragged to. Before stage 4b this was covered by
    // accident: the replacement interaction's non-idle status held the whole static world stale anyway.
    R.invalidateShadows();
  }
  function startHubSit(index: number): void {
    approachCtl.cancel();
    clearSeats();
    const id = CAFE_CHAIR_IDS[index];
    currentSeatAnchor = id;
    hubSeat = new SeatInteraction(avatar, stack, mirror.view(id), seatSpecFor(id), (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
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
    currentSeatAnchor = id;
    execSeat = new SeatInteraction(avatar, stack, mirror.view(id), seatSpecFor(id), (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
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
    currentSeatAnchor = id;
    cmsSeat = new SeatInteraction(avatar, stack, mirror.view(id), seatSpecFor(id), (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
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
    currentSeatAnchor = id;
    aiSeat = new SeatInteraction(avatar, stack, mirror.view(id), seatSpecFor(id), (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
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
    currentSeatAnchor = id;
    devSeat = new SeatInteraction(avatar, stack, mirror.view(id), seatSpecFor(id), (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
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
    currentSeatAnchor = id;
    qaSeat = new SeatInteraction(avatar, stack, mirror.view(id), seatSpecFor(id), (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
    qaState.chair = id.split("/")[1];
    qaSeat.sit();
  }
  function startMeetingSit(index: number): void {
    approachCtl.cancel();
    clearSeats();
    const id = MEETING_CHAIR_IDS[index];
    currentSeatAnchor = id;
    meetingSeat = new SeatInteraction(avatar, stack, mirror.view(id), seatSpecFor(id), (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
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
    // PHASE 7E — the id travels WITH the approach, so the arrival notification can name what was reached
    // rather than guessing from a label. The controller drops it on every cancel, so a stale id is
    // impossible (interact/Approach.ts).
    const r = approachCtl.begin(spec, entityId);
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
    currentSeatAnchor = seatAnchorId(s.id, s.slot.id);
    loungeSeat = new LoungeSeatInteraction(avatar, stack, s.view, slotFor(s.id, s.slot), (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
    receptionState.focus = s.label;
    loungeSeat.sit();
  }
  /** Click resolution: raycast the built world, then walk up to the first group a Reception interaction
   *  declares as its pick target (a static group name, or a seat entity's own view). */
  function pickInteraction(cx: number, cy: number): string | null {
    return pickInteractionHit(cx, cy)?.id ?? null;
  }
  /** The same pick, carrying HOW FAR AWAY the winning hit was — what Phase 6D weighs a coworker body
   *  against. Split out rather than changing pickInteraction's shape, so every existing caller is byte
   *  for byte unaffected. */
  function pickInteractionHit(cx: number, cy: number): { id: string; distance: number } | null {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, R.activeCamera);
    const hits = raycaster.intersectObject(mirror.root, true);
    if (!hits.length) return null;
    const byPick = new Map<string, string>();
    for (const e of world.entities.values()) {
      if (e.capabilities.approach && typeof e.props.pick === "string") byPick.set(e.props.pick, e.id);
      if (e.capabilities.seat || e.capabilities.lounge) byPick.set(e.id, e.id);
    }
    // THE FIRST HIT THAT IS INTERACTABLE, not the first hit. A seat is often seen past something that is
    // not one — the lead chair behind its desk's edge, the south tub chairs through the façade glazing —
    // and taking hits[0] alone made exactly those pieces unclickable (Phase 6C detection audit).
    for (const hit of hits) {
      for (let n: THREE.Object3D | null = hit.object; n; n = n.parent) {
        const id = byPick.get(n.name);
        if (id) return { id, distance: hit.distance };
      }
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
  /** PLAYER shadow-frame GRID, in world units — how far the player walks before the frustum re-centres,
   *  and therefore before every static caster in the building is redrawn into the shadow map.
   *
   *  WHY IT IS NOT THE ORBIT DEFAULT OF 8. OFFICE and EXPLORE move their focus in user-sized nudges; a
   *  player moves it CONTINUOUSLY, at PLAYER_WALK_SPEED (70 u/s) and PLAYER_SPRINT_SPEED (100). Swept over
   *  every heading, an 8 grid re-centres up to 11 times a second walking and 15 sprinting — a full static
   *  pass on 19% of walking frames and 26% of sprinting ones, for a building that has not moved. At 64 the
   *  same sweep gives 1.6/s and 2.3/s, i.e. 2.7% and 3.8% at 60 fps (shadowFocus.test.ts pins both).
   *
   *  WHY 64 AND NOT MORE. The frustum is a fixed 2 x PLAYER_SHADOW_RADIUS square around the snapped
   *  centre, so the grid spends COVERAGE: at 64 the body can sit up to 64 * 0.55 = 35.2 units off-centre
   *  per axis (49.8 on the diagonal), leaving at worst 250 of the 300 units of shadowed ground ahead of
   *  him instead of 294. 64 is the coarsest grid that still keeps that loss under a sixth. Shadow
   *  RESOLUTION is untouched — the frustum keeps its size, so a texel keeps covering the same floor. */
  const PLAYER_SHADOW_FOCUS_QUANTUM = 64;
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
  const playerStand = (p: Vec2): boolean =>
    inCave(p) ? caveStandTest(p, NAV_RADIUS)
    : inAiLabZone(p, NAV_RADIUS) ? aiLabStandTest(p, NAV_RADIUS)
    : officeStand(p);
  /** The third-person boom's probe. Same composition, a token radius: the camera must not end up inside a
   *  wall or over unbuilt floor, but it may perfectly well fly over a desk — and judging it at the BODY
   *  radius pulled the boom in to its minimum beside almost every piece of furniture in the building. */
  const officeCameraProbe = makeStandTest({ world, walkability, derived: derivedNav, radius: 2, allowExterior: true });
  const playerCameraProbe = (p: Vec2): boolean =>
    inCave(p) ? caveStandTest(p, 2)
    : inAiLabZone(p, 2) ? aiLabStandTest(p, 2)
    : officeCameraProbe(p);
  /** the one bridge from a targeted entity id to V2's existing interaction path. Nothing is reimplemented:
   *  each branch is the same call the GUI button and the click-to-walk handler already make. */
  /** Assigned just after PLAYER mode is constructed (it needs the body to place). Declared here because
   *  the interaction bridge below is handed to PlayerMode and therefore has to exist first. */
  let caveTransition: CaveTransition | null = null;
  function activateInteractable(id: string, kind: "seat" | "lounge" | "approach" | "person", near?: Vec2): boolean {
    // PHASE 6D — A PERSON. The one activation that starts nothing in this world: it SELECTS, and the host
    // decides what a selection means (app/interactions.ts). The pointer is handed back so the card that
    // opens can actually be used, and false is returned because no interaction took the avatar.
    if (kind === "person") {
      const email = coworkerEmailOf(id);
      const who = email ? coworkers.within(avatar.position, TARGET_REACH).find((c) => c.email === email) : null;
      if (!who) return false;
      if (playerMode.active) playerMode.releasePointer();
      selectCoworker({ email: who.email, displayName: who.displayName });
      return false;
    }
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
    if (kind === "lounge" || kind === "seat") {
      // PHASE 5's BOUNDARY, ASKED HERE TOO. A chair inside the working office is not a way past Reception's
      // gates for a checked-out employee: the approach route would be refused by the closed lanes anyway,
      // but this is the same explicit refusal walkToGround gives, so the readout names the reason.
      const at = world.entities.has(id) ? world.get(id).transform.pos : null;
      if (at && !mayEnterOffice(officeAccess) && zoneOf(at) === "office") {
        seatSyncState.refusals++;
        navState.last = `refused: the working office needs a confirmed V1 check-in (attendance ${officeAccess})`;
        return false;
      }
    }
    if (kind === "lounge") {
      // THE FIRST FREE CUSHION of this piece. A sofa is one entity with several anchors, and occupancy
      // (Phase 6C) is per anchor — so a sofa with somebody on one cushion still seats you on another.
      // ...and of those, the one NEAREST the point clicked (or the body, for the E key) — so a click on the
      // left end of a sofa seats you on the left cushion, not always the first one authored.
      const ref = near ?? avatar.position;
      const e = world.get(id);
      let i = -1, best = Infinity;
      loungeSeats.forEach((s2, k) => {
        if (s2.id !== id || occupiedSeatIds.has(seatAnchorId(s2.id, s2.slot.id))) return;
        const d = Math.hypot(e.transform.pos.x + s2.slot.contactLocal.x - ref.x, e.transform.pos.z + s2.slot.contactLocal.z - ref.z);
        if (d < best) { best = d; i = k; }
      });
      if (i < 0) {
        if (loungeSeats.some((s2) => s2.id === id)) { seatSyncState.refusals++; navState.last = `refused: ${id} is occupied`; }
        return false;
      }
      selfMovedByUser = true;
      startLoungeSit(i);
      return true;
    }
    if (kind === "seat") {
      // PHASE 6C — AN OCCUPIED CHAIR CANNOT BE SELECTED. V1's rule (an occupied seat gets no click-to-sit
      // marker), applied to the same fact through the seat mapping. The backend still arbitrates a
      // simultaneous attempt; this is the local refusal that keeps the common case from ever reaching it.
      if (occupiedSeatIds.has(id)) {
        seatSyncState.refusals++;
        navState.last = `refused: ${id} is occupied`;
        return false;
      }
      // Sitting down by choice counts as having moved yourself — a V1 restore landing afterwards must not
      // yank the body out of the chair (same rule as click-to-walk and PLAYER mode).
      selfMovedByUser = true;
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
      if (id === CHAIR_4_ID) { clearSeats(); currentSeatAnchor = CHAIR_4_ID; seat.sit(); return true; }
      if (world.entities.has(id) && world.get(id).capabilities.seat) { startOtherSit(id); return true; }
      return false;
    }
    startApproach(id);
    return true;
  }
  const engagedSeat = (): { stand: () => void } | null => {
    for (const s2 of [loungeSeat, hubSeat, meetingSeat, gamingSeat, execSeat, cmsSeat, aiSeat, devSeat, qaSeat, restoredSeat, restoredLounge, otherSeat] as ({ state: string; stand: () => void } | null)[])
      if (s2 && s2.state === "seated") return s2;
    return seat.status === "seated" ? seat : null;
  };
  /** PHASE 6C — is the signed-in body in a chair, by the interactions' own states? "sitting" and the
   *  tuck-in count: the body is committed to the chair from the glide on, and the seated arrival should
   *  go out then rather than a second and a half later when the chair finishes rolling in. */
  const seatedNow = (): boolean => {
    for (const s2 of [seat, hubSeat, meetingSeat, gamingSeat, execSeat, cmsSeat, aiSeat, devSeat, qaSeat, restoredSeat, otherSeat])
      if (s2 && (s2.state === "sitting" || s2.state === "slidingIn" || s2.state === "seated")) return true;
    for (const l of [loungeSeat, restoredLounge]) if (l && (l.state === "sitting" || l.state === "seated")) return true;
    return false;
  };
  /** Is ANY seat interaction under way (approaching, pulling the chair, sitting, leaving…)? While one is,
   *  `currentSeatAnchor` names the seat it is for and must not be cleared by the previous seat ending. */
  const seatEngaged = (): boolean => {
    for (const s2 of [seat, hubSeat, meetingSeat, gamingSeat, execSeat, cmsSeat, aiSeat, devSeat, qaSeat, restoredSeat, otherSeat, loungeSeat, restoredLounge])
      if (s2 && s2.state !== "idle") return true;
    return false;
  };
  /** PHASE 6C — a PEER's chair, for world/Coworkers. Resolves an anchor to the cushion point and yaw the
   *  body takes there, over the chair's live view. A movable chair a peer occupies is TUCKED IN to the same
   *  `seatedTuck` the local sit parks it at, so the peer sits where the local would and the chair reads as
   *  taken; the rest transform is kept and put back on release. Fixed seating is never written to. */
  const peerSeatRest = new Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion }>();
  function peerSeatAnchor(id: string): SeatAnchorPose | null {
    const { entityId, slotId } = parseSeatAnchorId(id);
    if (!world.entities.has(entityId) || !mirror.hasView(entityId)) return null;
    const e = world.get(entityId);
    const view = mirror.view(entityId);
    if (slotId === undefined) {
      const spec = e.capabilities.seat;
      if (!spec) return null;
      if (!peerSeatRest.has(id)) {
        peerSeatRest.set(id, { pos: view.position.clone(), quat: view.quaternion.clone() });
        view.position.addScaledVector(new THREE.Vector3(spec.pullDir.x, 0, spec.pullDir.z), spec.seatedTuck);
        R.invalidateShadows(); // a static caster moved
      }
      return { contact: deskSeatContact(view, spec), yaw: seatedYawFor(id, spec.seatedYaw), kind: "seat" };
    }
    const slot = e.capabilities.lounge?.slots.find((s2) => s2.id === slotId);
    if (!slot) return null;
    view.updateMatrixWorld(true);
    const contact = new THREE.Vector3(slot.contactLocal.x, slot.contactLocal.y, slot.contactLocal.z).applyMatrix4(view.matrixWorld);
    return { contact, yaw: seatedYawFor(id, slot.seatedYaw), kind: "lounge", ...(slot.sink !== undefined ? { sink: slot.sink } : {}) };
  }
  function releasePeerSeat(id: string): void {
    const rest = peerSeatRest.get(id);
    if (!rest) return;
    peerSeatRest.delete(id);
    const { entityId } = parseSeatAnchorId(id);
    if (!mirror.hasView(entityId)) return;
    const view = mirror.view(entityId);
    view.position.copy(rest.pos);
    view.quaternion.copy(rest.quat);
    R.invalidateShadows();
  }
  const playerMode = new PlayerMode({
    avatar, stack, world, canStand: playerStand, cameraProbe: playerCameraProbe,
    // the target marker hangs off the SCENE, not the office group: the CAVE hides the whole office while
    // you are inside it, and a marker parented to that group would vanish with it
    camera: R.playerCamera, canvas, overlayRoot: R.scene,
    radius: NAV_RADIUS, avatarHeight: BON_STANDING_HEIGHT,
    speed: () => params.walkSpeed,
    activate: activateInteractable,
    // PHASE 6D — the coworkers, re-read per frame because they move. Empty until a host subscribes, so
    // the standalone dev page targets exactly what it always did.
    dynamicCandidates: coworkerCandidates,
    canStandUp: () => engagedSeat() !== null,
    standUp: () => engagedSeat()?.stand(),
    // hand the avatar over cleanly: stop the walker, cancel a half-finished approach, leave engaged seats
    // alone (PlayerMode simply does not move Bon while Interaction owns him, and takes over when it ends)
    yieldAvatar: () => { stopTour(); navCtl.stop(); approachCtl.cancel(); },
  });
  // THE LOCAL TAKEOFF, STRAIGHT OUT TO THE OTHER BROWSERS. Not through SelfMovementFeed: that funnel
  // turns continuous motion into V1 movements, and a jump is neither continuous nor a movement — it
  // would have to be smuggled into a leg that may not exist (a standing jump publishes nothing at all)
  // or into one that started 300 ms ago. One call, one relay, no state. The standalone dev page's sink
  // is absent and one there stays local, exactly as everything else does.
  playerMode.onJumped = () => selfMovement?.jumped?.();

  // ---- the home-desk spawn (Phase 3) ---------------------------------------------------------------
  // WHERE THE SIGNED-IN EMPLOYEE STARTS: at their own desk, when V1 knows of one. Everything above this
  // line already ran the DEFAULT spawn (the Design Room chair's approach point, set beside the avatar's
  // construction), and that is what stays when `homeDesk` is undefined — the standalone dev page, and any
  // session whose desk could not be resolved, are untouched.
  //
  // IT RUNS HERE, and could not run earlier: the collision-safe placement below is PlayerBody.placeNear,
  // and the body only exists once PlayerMode has been built. Nothing between the default placement and
  // this point reads the avatar's position — every consumer of it (planWalk, the seat interactions, the
  // camera's "focus: Bon") is a closure called later — so moving the body here changes nothing but where
  // it stands.
  //
  // WHAT IS AND IS NOT DECIDED HERE:
  //   • V1 decided WHICH desk, in V1 coordinates (adapters/v1HomeDesk, over data/homeSeat).
  //   • V2 decides WHERE that is in the world it actually built — a room may stand away from its V1 art
  //     box (the Design Room is 16 south, rooms/design-room WORLD_SHIFT_Z), and homeDeskWorldPoint applies
  //     that from ROOM_WORLD_SHIFT_Z, the one table that holds it.
  //   • V2 decides whether a BODY FITS. A seat centroid is the point the chair is drawn at, so the
  //     player's 8-unit body usually does not fit on it; placeNear searches outward in rings for the
  //     nearest point its own stand test accepts, which is the same test every WASD step is judged by.
  //     A desk with nothing legal within six body radii is REFUSED, not forced — the default spawn stands
  //     and the readout says so, because dropping a body inside the furniture is worse than not moving it.
  //   • Nobody decides ATTENDANCE. This is a preview of a desk; no session is read, claimed or written.
  if (homeDesk) {
    const target = homeDeskWorldPoint(homeDesk.point, v1Rooms(), ROOM_WORLD_SHIFT_Z);
    const at = (p: Vec2): string => `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
    if (playerMode.body.placeNear(target)) {
      const placed = playerMode.body.pos;
      avatar.setPosition(placed);
      avatar.setYaw(FACING_YAW[homeDesk.facing]);
      const nudged = Math.hypot(placed.x - target.x, placed.z - target.z);
      avatarState.spawn = `${homeDesk.roomId} desk · ${at(placed)} facing ${homeDesk.facing}${nudged > 0.01 ? ` (${nudged.toFixed(1)} clear of the seat at ${at(target)})` : ""}`;
    } else {
      avatarState.spawn = `${homeDesk.roomId} desk at ${at(target)} has no standable point — kept the default spawn`;
      console.warn(`vo3d: no standable point near the ${homeDesk.roomId} desk; keeping the default spawn`);
    }
  }

  // ---- the roster's coworkers (Phase 4A) -----------------------------------------------------------
  // STATIC, READ-ONLY BODIES for the real employees V1's roster lists. Built here, after playerMode, for
  // the same reason the home-desk spawn above is: the placement search is judged by `playerStand`, the
  // world's own body test, and a coworker has to be refused exactly where the player would be.
  //
  // Empty until somebody pushes a roster in (setCoworkers below). The standalone dev page never does, so
  // dev/vo3d.html builds an empty group and pays nothing — no fetch, no GLB, no draw call.
  //
  // V1 DECIDED WHO AND WHERE, in V1 coordinates (adapters/v1Coworkers over data/rosterLayers). V2 decides
  // where that is in the world it actually built, through the SAME homeDeskWorldPoint the signed-in
  // employee's own desk goes through — one room-shift table, not two.
  const coworkers = new Coworkers({
    parent: R.scene,
    canStand: playerStand,
    radius: NAV_RADIUS,
    toWorld: (p) => homeDeskWorldPoint(p, v1Rooms(), ROOM_WORLD_SHIFT_Z),
    lod: 1,
    // PHASE 6C — seated peers sit on this world's own chairs; see peerSeatAnchor.
    seatAnchor: peerSeatAnchor,
    releaseSeat: releasePeerSeat,
    // Their idle animation moves them every frame, so they are dynamic casters like the stress crowd;
    // the shadow map is invalidated only when a sync actually changed something, not per frame.
    onChanged: (change) => {
      // THE MESHES ONLY EXIST NOW. addDynamicCaster below marks the group ONCE, while it is still empty —
      // every body is cloned in afterwards, so without this re-mark none of them ever joins
      // DYNAMIC_CASTER_LAYER and compositeDynamicShadows (which draws that layer and nothing else) skips
      // them entirely: coworkers stood in the office casting no shadow at all. The hero avatar and the
      // stress crowd already do exactly this re-mark for exactly this reason. Meshes only — markDynamicCaster
      // skips the nameplate Sprite, which must NOT be on the layer or it casts a rectangle on the floor.
      if (change === "population") R.markDynamicCaster(coworkers.group);
      // A COWORKER CANNOT STALE THE CACHED STATIC DEPTH. The static pass hides the whole dynamic-caster
      // group before it draws (Renderer.hideDynamicCasters), so no coworker is ever IN that depth — which
      // makes the full invalidateShadows() this used to call a redraw of ~2,800 static casters for a body
      // that is not in the pass. Only the composite is stale.
      R.invalidateDynamicShadows();
    },
  });
  R.addDynamicCaster(coworkers.group);

  // ---- PHASE 6D: EMPLOYEE INTERACTIONS -------------------------------------------------------------
  // SELECTING a coworker, ANCHORING a card to them, and WALKING UP TO THEM. Those three things and no
  // others: what a selection then MEANS — chat, call, ask to join, view profile — is V1's own code
  // running in app/Vo3dHost.tsx, through V1's own services, exactly as OfficeMap.tsx runs it. See
  // app/interactions.ts for why the line is drawn there.
  /** How far in front of somebody an approach stops, in world units. Two body radii plus a little: close
   *  enough to be talking, far enough that neither body is inside the other. */
  const APPROACH_GAP = NAV_RADIUS * 2 + 6;
  /** Close enough to the approach point that walking there would be a twitch, in world units. */
  const ARRIVED_EPSILON = 2;
  /** rad/s — the SAME unhurried turn interact/Approach.ts gives a walk-up to a desk or a kiosk. */
  const APPROACH_TURN_RATE = 4.2;
  let coworkerInteractions: Vo3dCoworkerInteractions | null = null;
  // PHASE 7E — A WALK-UP TO A FIXTURE, REPORTED THE SAME WAY A WALK-UP TO A PERSON IS. One line, because
  // the pieces were already here: interact/Approach.ts owns the arrival (and its fire-once guarantee) and
  // this contract is how the world tells the host anything at all. The world still decides nothing about
  // what a kiosk or a counter MEANS — see app/interactions.ts.
  approachCtl.onArrivedAtTarget = (entityId) => coworkerInteractions?.onInteractionArrived?.(entityId);
  /** Who is selected right now, so a repeat click on the same body is not republished as a new selection
   *  (the menu would re-mount and lose its own state) and a dismissal is only sent when there was one. */
  let selectedCoworker: string | null = null;
  /** The approach in flight: who it is aimed at, and the yaw to settle on.
   *
   *  `yaw` IS RESOLVED WHEN THE TURN BEGINS, NOT WHEN THE WALK IS DISPATCHED. The dispatch-time value is
   *  a bearing from the PLANNED stand point to where that person was THEN, and neither of those survives
   *  the walk: the planner stops the body near the requested cell rather than exactly on it, and the
   *  person is free to take a step (or several) while you cross the room. Facing the bearing computed at
   *  dispatch left the body looking a few degrees past them in a live two-browser run, and would leave it
   *  looking at empty floor if they had moved. The dispatch value is kept only as the fallback for
   *  somebody who is no longer rendered by the time the walk ends. */
  let coworkerApproach: { email: string; yaw: number; turning: boolean } | null = null;
  /** The clip the signed-in employee's own body should rest in while standing in a conversation, or null.
   *  Applied ONLY while the ControllerStack is idle — that is, nothing is walking, seating, editing or
   *  direct-controlling this body — so it can never fight the walker, a seat or PLAYER mode's own
   *  locomotion. `avatar.play` is guarded on the current clip, so re-applying it costs nothing. */
  let selfConversationClip: string | null = null;
  /** Re-aim at the person from where the body actually came to rest. Falls back to whatever the approach
   *  was dispatched with when they are no longer drawn. */
  function resolveApproachYaw(): void {
    if (!coworkerApproach) return;
    const at = coworkers.pointOf(coworkerApproach.email);
    if (at) coworkerApproach.yaw = yawToward(avatar.position, at);
  }

  /** PHASE 7A PARITY — SMOOTH OFFICE FOCUS ON A PERSON.
   *
   *  V1 frames the employee you clicked: OfficeMap.handleCharacterClick eases the map to that character at
   *  its maximum zoom over 500ms, and closing the card eases back to the whole-office view
   *  (resetToInitialView). V2 snapped instead, because the only focus verb it had — cameraModes.focus —
   *  writes the camera immediately; that is right for a GUI button and wrong for an interaction.
   *
   *  THE DESTINATION IS NOT RECOMPUTED HERE. It is read back OUT of cameraModes.focus: the destination is
   *  applied, the resulting target and dolly are captured, the camera is put straight back where it was,
   *  and the tween runs between the two. So the framing, the pitch/yaw policy and — crucially — the OFFICE
   *  fence are the existing ones, and no second copy of that arithmetic exists to drift from them.
   *
   *  OFFICE ONLY. PLAYER owns its own camera and EXPLORE is the inspection rig; neither is reframed. */
  const FOCUS_MS = 500;
  /** How much ground the focus frames around a person, in world units — a desk's worth of context, which
   *  at the office pitch reads as V1's tight character zoom rather than a face fill. */
  const FOCUS_HALF_EXTENT = 150;
  /** HOW A TWEENED FRAME IS APPLIED, and the two are not interchangeable:
   *
   *    "place"  OFFICE. Pitch and yaw are PINNED in this mode, so the camera may be rebuilt from
   *             camParams every frame: the renderer's own `target` is what moves, and placeCamera derives
   *             the position, the frustum and controls.target from it. The fence then gets the last word,
   *             exactly as it does after a manual drag.
   *    "pan"    3D EXPLORE. The orbit angle is the USER'S — this is the free inspection rig — so nothing
   *             may be rebuilt from camParams: placeCamera would snap their pitch and yaw back to
   *             whatever the policy last recorded. Instead the orbit target and the camera position are
   *             translated by the SAME delta, which is exactly how OrbitControls itself pans and how the
   *             fence moves the pair (CameraModes.clamp). The orbit is left untouched. */
  type CamTween = {
    t: number;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    fromZoom: number;
    toZoom: number;
    apply: "place" | "pan";
  };
  let camTween: CamTween | null = null;
  /** Scratch, so a per-frame tween allocates nothing. */
  const camTweenAt = new THREE.Vector3();
  /** Where the camera stood before the first focus of a selection, so closing the card can ease back to
   *  it — V1's resetToInitialView, except it restores the view the employee actually had rather than the
   *  canonical framing, which is the same promise and kinder to somebody who had panned somewhere. */
  let camBeforeFocus: { target: THREE.Vector3; zoom: number } | null = null;

  const easeOut = (k: number): number => 1 - Math.pow(1 - k, 3);

  /** Begin easing to a captured destination. Cancels whatever tween was running.
   *
   *  `from` is read off controls.target rather than off the renderer's own target, because controls.target
   *  is the one that is TRUE after a manual pan: OFFICE's fence moves it (and the camera) without writing
   *  the renderer's target, so the two diverge the moment somebody drags the map. Starting from the stale
   *  one is what a jump looks like. */
  function startCamTween(toTarget: THREE.Vector3, toZoom: number, apply: "place" | "pan"): void {
    camTween = {
      t: 0,
      fromTarget: R.controls.target.clone(),
      toTarget: toTarget.clone(),
      fromZoom: R.camera.zoom,
      toZoom,
      apply,
    };
  }
  /** ANY manual camera input abandons the tween immediately — a focus must never fight the wheel or a
   *  drag. Registered on the canvas beside the other pointer handlers. */
  function cancelCamTween(): void {
    camTween = null;
  }
  onCanvas("wheel", cancelCamTween);
  // …and so does GRABBING THE MAP. A left-drag pans in OFFICE and orbits in 3D EXPLORE, and in OFFICE the
  // tween rebuilds the camera every frame — so without this the pan is overwritten as fast as it is made
  // and the view feels stuck for half a second. Cancelling on the press (not the drag) means a manual
  // gesture always wins immediately. A plain click is unaffected: the selection it makes starts its own
  // tween on pointerup, after this has run.
  onCanvas("pointerdown", (e) => {
    if (e.button === 0) cancelCamTween();
  });

  /** OFFICE's framing, captured and re-run as a tween. The destination is READ BACK OUT of the existing
   *  cameraModes.focus — apply it, note where it landed (target, dolly and fence included), put the camera
   *  straight back, then ease between the two. So the framing policy, the dolly ceiling and the fence are
   *  the shipped ones and no second copy of that arithmetic exists to drift from them. */
  function easeOfficeFrame(rect: Rect, fill: number, remember: boolean): boolean {
    const beforeTarget = R.controls.target.clone();
    const beforeZoom = R.camera.zoom;
    cameraModes.focus(rect, fill);
    const toTarget = R.controls.target.clone();
    const toZoom = R.camera.zoom;
    R.target.copy(beforeTarget);
    R.camera.zoom = beforeZoom;
    R.placeCamera();
    if (remember && !camBeforeFocus) camBeforeFocus = { target: beforeTarget, zoom: beforeZoom };
    startCamTween(toTarget, toZoom, "place");
    return true;
  }

  /** 3D EXPLORE's framing. Deliberately NOT cameraModes.focus: that path ends in placeCamera, which
   *  rebuilds the camera from camParams and would therefore throw away the pitch and yaw the user has
   *  orbited to — in the one mode whose whole purpose is free orbit. Instead the orbit target eases to the
   *  room's centre and the DOLLY eases to whatever fits it, with the angle untouched.
   *
   *  The fit itself is app/roomFocus.ts's exploreFrameZoom. */
  function easeExploreFrame(rect: Rect, fill: number): void {
    const c = R.controls;
    const toZoom = exploreFrameZoom(rect, R.camera.top, fill, c.minZoom, c.maxZoom);
    startCamTween(new THREE.Vector3(rect.x + rect.w / 2, R.target.y, rect.z + rect.d / 2), toZoom, "pan");
  }

  function focusCameraOn(at: Vec2): boolean {
    // PERSON FOCUS IS UNCHANGED: OFFICE only, the same extent, the same fill, and it is the one focus that
    // records a view to come back to (closing the card eases there — V1's closeCharacterMenu).
    if (playerMode.active || params.cameraMode !== "office") return false;
    return easeOfficeFrame(
      { x: at.x - FOCUS_HALF_EXTENT, z: at.z - FOCUS_HALF_EXTENT, w: FOCUS_HALF_EXTENT * 2, d: FOCUS_HALF_EXTENT * 2 },
      0.9,
      true,
    );
  }

  /** ROOM FOCUS — V1's `focusRoom`, which centres and frames the room a click opened.
   *
   *  THREE DELIBERATE DIFFERENCES from the person focus above:
   *    • IT WORKS IN 3D EXPLORE TOO, through the pan-only path, because framing a room is exactly what
   *      that view is for. It never switches mode, and it never touches pitch or yaw.
   *    • IT IS REFUSED IN PLAYER, whole. The camera belongs to the body there; nothing is moved, zoomed or
   *      detached, and the Room tile simply opens the panel over the world it is already showing.
   *    • IT REMEMBERS NOTHING. `camBeforeFocus` is the SELECTION's memory — the view a dismissed employee
   *      card eases back to — and a room framing must not write it, or closing a person's card afterwards
   *      would yank the camera to a pre-room view nobody asked for. Closing the room panel therefore leaves
   *      the camera exactly where it is, including wherever the employee has panned it since.
   *
   *  A room with no rect of its own (nothing this world models) is simply not framed. */
  function frameRoom(roomId: string | null): void {
    const how = roomFrameMode(params.cameraMode, playerMode.active, roomId);
    if (how === "none" || !roomId) return;
    const rect = roomFrameRect({ floorRectOf: (id) => world.rooms.get(id)?.floorRect, regions: world.regions }, roomId);
    if (!rect) return;
    if (how === "office") easeOfficeFrame(rect, ROOM_FRAME_FILL, false);
    else easeExploreFrame(rect, ROOM_FRAME_FILL);
  }

  /** ROOM DISCOVERY — the rooms that can be labelled, resolved once from the world's own regions. */
  const roomFrameSource = { floorRectOf: (id: string) => world.rooms.get(id)?.floorRect, regions: world.regions };
  const labelRects = roomLabelRects(roomFrameSource);
  /** HOW HIGH A LABEL FLOATS above the floor it names, in world units. Low enough to read as painted on
   *  the court (the reference), high enough to clear desks and chairs rather than sitting among them. */
  const ROOM_LABEL_Y = 14;
  const labelPoints = new Map(
    labelRects.map((r) => [r.roomId, new THREE.Vector3(r.rect.x + r.rect.w / 2, ROOM_LABEL_Y, r.rect.z + r.rect.d / 2)]),
  );

  /** THE HOVER WASH. One quad, reused: a per-room mesh would be eleven more objects in the scene for a
   *  thing only ever shown one at a time. Unlit, unshadowed and depth-tested, so furniture still occludes
   *  it and it cannot alter a single light or material. */
  const roomHighlight = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xfdfcfa, transparent: true, opacity: 0.11, depthWrite: false }),
  );
  roomHighlight.rotation.x = -Math.PI / 2;
  roomHighlight.castShadow = false;
  roomHighlight.receiveShadow = false;
  roomHighlight.renderOrder = 2;
  roomHighlight.visible = false;
  roomHighlight.matrixAutoUpdate = true;
  R.scene.add(roomHighlight);
  disposers.push(() => {
    R.scene.remove(roomHighlight);
    roomHighlight.geometry.dispose();
    (roomHighlight.material as THREE.Material).dispose();
  });
  function setRoomHighlight(roomId: string | null): void {
    const rect = roomId ? labelRects.find((r) => r.roomId === roomId)?.rect : undefined;
    if (!rect) {
      roomHighlight.visible = false;
      return;
    }
    // A hair above the floor so it washes the surface instead of z-fighting with it.
    roomHighlight.position.set(rect.x + rect.w / 2, 0.35, rect.z + rect.d / 2);
    roomHighlight.scale.set(rect.w, rect.d, 1);
    roomHighlight.visible = true;
  }

  /** Ease back to wherever the camera was before the SELECTION was focused. V1's closeCharacterMenu. */
  function restoreCameraView(): void {
    const before = camBeforeFocus;
    camBeforeFocus = null;
    if (!before || playerMode.active || params.cameraMode !== "office") return;
    startCamTween(before.target, before.zoom, "place");
  }

  /** One frame of the tween. Called from the render loop, before OrbitControls is updated.
   *
   *  THE RECENTRE USED TO SNAP, and this is where. Writing the eased point into `controls.target` and then
   *  calling placeCamera undoes it in the same breath — placeCamera ends with `controls.target.copy(this
   *  .target)`, so every frame put the destination straight back. Only the zoom was ever easing. Each
   *  branch below writes the point the camera is actually built from for that mode. */
  function updateCamTween(dtMs: number): void {
    if (!camTween) return;
    camTween.t = Math.min(1, camTween.t + dtMs / FOCUS_MS);
    const k = easeOut(camTween.t);
    camTweenAt.lerpVectors(camTween.fromTarget, camTween.toTarget, k);
    R.camera.zoom = camTween.fromZoom + (camTween.toZoom - camTween.fromZoom) * k;
    if (camTween.apply === "place") {
      R.target.copy(camTweenAt);
      R.placeCamera(); // rebuilds position + frustum from camParams and copies R.target into controls.target
    } else {
      // Translate the pair, leaving the orbit direction exactly as the user left it.
      R.camera.position.add(camTweenAt).sub(R.controls.target);
      R.controls.target.copy(camTweenAt);
      R.camera.updateProjectionMatrix();
    }
    if (camTween.t >= 1) camTween = null;
  }

  /** Tell the host who is selected. Idempotent on the same person; `null` clears. */
  function selectCoworker(sel: Vo3dCoworkerSelection | null): void {
    if ((sel?.email ?? null) === selectedCoworker) return;
    selectedCoworker = sel?.email ?? null;
    // PHASE 7A PARITY — FRAME THE PERSON, as V1's own character click does. A no-op in PLAYER (which owns
    // its camera) and in EXPLORE (the inspection rig), and a no-op for somebody with no body.
    if (sel) {
      const at = coworkers.pointOf(sel.email);
      if (at) focusCameraOn(at);
    }
    coworkerInteractions?.onSelect(sel);
  }

  /** WHICH ROOM IS SELECTED, or null. Deduped for the same reason selectCoworker is: the host's panel is
   *  React state, and re-announcing the same room on every click would re-open a panel the viewer had
   *  just closed. Told to the host and nowhere else — the world keeps no notion of what a room "is". */
  let selectedRoom: string | null = null;
  function selectRoom(roomId: string | null): void {
    if (roomId === selectedRoom) return;
    selectedRoom = roomId;
    // FRAME IT, exactly as V1's room click does (OfficeMap's focusRoom, called right before it opens the
    // sidebar). Dropping a selection frames nothing — leaving is not a place to go.
    frameRoom(roomId);
    coworkerInteractions?.onRoomSelected?.(roomId);
  }

  /** WHO IS UNDER THE POINTER, with the distance the caller needs to weigh it against its own pick. */
  function pickCoworkerAt(cx: number, cy: number): { email: string; displayName: string; distance: number } | null {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, R.activeCamera);
    return coworkers.pick(raycaster);
  }

  /** PHASE 7G — is the pointer on the bird? Its own ray against its own group, using the ACTIVE camera
   *  so it works in OFFICE and in 3D EXPLORE alike. A generous sphere rather than the mesh: the model is
   *  13 units long and hovering, and asking somebody to hit a wing is not an interaction. */
  const TOUCAN_PICK = new THREE.Sphere(new THREE.Vector3(), 1);
  function pickToucanAt(cx: number, cy: number): boolean {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, R.activeCamera);
    TOUCAN_PICK.center.copy(toucan.worldPosition);
    // ASKED, not assumed: the bird owns its own size, so changing its scale cannot leave the click target
    // behind. Generous by design — the model is a hovering bird and asking somebody to hit a wing is not
    // an interaction.
    TOUCAN_PICK.radius = toucan.pickRadius;
    return raycaster.ray.intersectsSphere(TOUCAN_PICK);
  }

  const projected = new THREE.Vector3();
  const projectedUp = new THREE.Vector3();
  const SELF_HEAD = new THREE.Vector3();
  /** The same head height the coworker bodies hang their nameplates at, for the viewer's own avatar. */
  const HEAD_ANCHOR_Y_SELF = BON_STANDING_HEIGHT + 6;
  function coworkerAnchor(email: string): Vo3dScreenAnchor | null {
    const head = coworkers.headPoint(email);
    if (!head) return null;
    return anchorForWorldPoint(head);
  }
  /** ONE PROJECTION, for self and for every peer — see Vo3dScreenAnchor. */
  function anchorForWorldPoint(head: THREE.Vector3): Vo3dScreenAnchor {
    const r = canvas.getBoundingClientRect();
    // THE ACTIVE CAMERA, not the orthographic one: PLAYER mode walks a perspective camera and an
    // anchored card has to follow the body through it exactly as it does in OFFICE. `z` past 1 is behind
    // the near/far range — behind the viewer, in practice — and is reported as not visible rather than
    // projected to a mirrored point in front of them.
    projected.copy(head).project(R.activeCamera);
    const clientX = r.left + ((projected.x + 1) / 2) * r.width;
    const clientY = r.top + ((1 - projected.y) / 2) * r.height;
    const onScreen = projected.z <= 1 && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    // PHASE 7B — one world unit, in CSS pixels, AT THIS BODY'S DEPTH. Measured rather than assumed, so it
    // is right for both cameras and for a body near the camera versus one across the room.
    projectedUp.copy(head).setY(head.y + 1).project(R.activeCamera);
    const scale = Math.abs((projectedUp.y - projected.y) / 2) * r.height;
    return { clientX, clientY, visible: onScreen, scale };
  }

  /** PART 1 — THE SIGNED-IN EMPLOYEE'S OWN HEAD, in the same screen-space form as a coworker's.
   *
   *  V1 shows the viewer a "You" nameplate over their own avatar, with their own presence; V2 showed them
   *  nothing, because the overhead layer only ever knew about OTHER people's bodies. The head height is
   *  the same one the coworker anchors use, so self and peers hang their pills at an identical gap. */
  function selfAnchor(): Vo3dScreenAnchor | null {
    const p = avatar.worldPosition();
    return anchorForWorldPoint(SELF_HEAD.set(p.x, HEAD_ANCHOR_Y_SELF, p.z));
  }

  /** ROOM DISCOVERY — the label's anchor AND the room's projected footprint, in one pass.
   *
   *  The four corners are projected at the label's own height rather than the rect being scaled by the
   *  centre's `scale`: in 3D EXPLORE the far edge of a room is further from the camera than the near one,
   *  and a single depth would over-report the floor by exactly the amount that makes a name overrun its
   *  own walls. Reuses the corner vector, so this allocates nothing per frame. */
  const ROOM_CORNER = new THREE.Vector3();
  function roomLabelAnchor(roomId: string, point: THREE.Vector3): Vo3dRoomLabelAnchor {
    const base = anchorForWorldPoint(point);
    const rect = labelRects.find((r) => r.roomId === roomId)?.rect;
    if (!rect) return { ...base, widthPx: 0, heightPx: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [cx, cz] of [
      [rect.x, rect.z], [rect.x + rect.w, rect.z], [rect.x, rect.z + rect.d], [rect.x + rect.w, rect.z + rect.d],
    ] as const) {
      const corner = anchorForWorldPoint(ROOM_CORNER.set(cx, point.y, cz));
      minX = Math.min(minX, corner.clientX); maxX = Math.max(maxX, corner.clientX);
      minY = Math.min(minY, corner.clientY); maxY = Math.max(maxY, corner.clientY);
    }
    return { ...base, widthPx: maxX - minX, heightPx: maxY - minY };
  }

  /** PHASE 7G — THE BIRD'S OWN ANCHOR, for the world-space "Squawk squawk…" pill over it. A HAIR ABOVE
   *  the bird rather than at it, so the pill clears the wings; not visible while the bird is not being
   *  drawn, which is also how the pill disappears with it. */
  const TOUCAN_HEAD = new THREE.Vector3();
  function toucanAnchor(): Vo3dScreenAnchor | null {
    if (!toucan.flying) return null;
    const p = toucan.worldPosition;
    return anchorForWorldPoint(TOUCAN_HEAD.set(p.x, p.y + 9, p.z));
  }

  /** PHASE 7B — MANY ANCHORS IN ONE CALL. The overhead layer asks for every person it is drawing something
   *  over, once per animation frame; going through `coworkerAnchor` per person would re-read the canvas
   *  rect and re-derive the same camera state N times a frame. Somebody with no body is simply absent. */
  function coworkerAnchors(emails: readonly string[]): Record<string, Vo3dScreenAnchor> {
    const out: Record<string, Vo3dScreenAnchor> = {};
    for (const email of emails) {
      const a = coworkerAnchor(email);
      if (a) out[email] = a;
    }
    return out;
  }

  /** PLAYER mode's per-frame coworker candidates. Distance-filtered by this module (it holds the bodies),
   *  scored by PlayerTargeting (it holds the judgement) — see Coworkers.within. */
  function coworkerCandidates(): readonly Candidate[] {
    if (!coworkerInteractions) return [];
    const here = avatar.position;
    return coworkers.within(here, TARGET_REACH).map((c) => ({
      id: personCandidateId(c.email),
      kind: "person" as const,
      pos: c.pos,
      label: c.displayName,
      // People belong to no room bucket; PLAYER mode adds them to whichever bucket it is scoring, so this
      // is only ever read back as a label. The room the person is standing in is V1's question, not ours.
      roomId: "",
    }));
  }

  /** WALK UP TO A PERSON. The approach point is a standable spot APPROACH_GAP away from them, on the side
   *  the body is already coming from — walking round somebody to stand on their far side is not what
   *  "approach" means, and V1's own approachCharacter picks the near side too. */
  function approachCoworker(email: string): boolean {
    const at = coworkers.pointOf(email);
    if (!at) return false;
    const from = avatar.position;
    const away = Math.hypot(from.x - at.x, from.z - at.z);
    // Already there: no walk, just turn. A zero-length walk would publish a movement to where the body
    // already stands, which every peer would replay as a twitch.
    const dir = away > 1e-3 ? { x: (from.x - at.x) / away, z: (from.z - at.z) / away } : { x: 0, z: 1 };
    const wanted = { x: at.x + dir.x * APPROACH_GAP, z: at.z + dir.z * APPROACH_GAP };
    const spot = standablePointNear(wanted, NAV_RADIUS, playerStand);
    if (!spot) {
      navState.last = `approach refused: no standable point beside ${email}`;
      return false;
    }
    const yaw = yawToward(spot, at);
    if (Math.hypot(spot.x - from.x, spot.z - from.z) <= ARRIVED_EPSILON) {
      // Standing there already — turn on the spot and report the arrival on the next frame the turn ends.
      coworkerApproach = { email, yaw, turning: true };
      resolveApproachYaw();
      return true;
    }
    const result = walkToGround(spot.x, spot.z);
    if (!result.ok) return false;
    coworkerApproach = { email, yaw, turning: false };
    return true;
  }


  // ---- the Championship Cave: the portal ------------------------------------------------------------
  // PHASE 7D — the CAVE's name on the movement wire. A roomId is any string server-side (socket.py's
  // _is_room_id), so this needs no backend change and collides with no V1 room id.
  // The place name and the same-volume rule both live in app/coworkers, so the world that RESOLVES the
  // name and the rule that FILTERS on it cannot drift apart.
  const CAVE_PLACE_ID = CAVE_PLACE;
  /** PHASE 7E — THE AI LAB'S NAME ON THE MOVEMENT WIRE, on exactly the same terms as the CAVE's above: a
   *  roomId is any string server-side, so this needs no backend change and collides with no V1 room id.
   *
   *  The Lab is not a portal — you WALK there, out of the building and across the campus — so the name is
   *  attached the moment the departure is authorised rather than at a threshold. That is what lets the feed
   *  say where somebody went as they cross V1's frame boundary, instead of leaving peers with a body
   *  parked at the façade (app/selfMovement.ts). */
  const AI_LAB_PLACE_ID = "ai-lab";
  /** PHASE 7D — WHERE EACH PERSON IN THE CAVE IS, from what they actually published.
   *
   *  This replaces a hash-of-email slot table, and the difference is the whole point: that one was a
   *  MEMBERSHIP renderer — it could say "they are in the Cave" and never "where" — so a body pinned to
   *  its slot no matter how far its owner walked. The feed now publishes real Cave coordinates
   *  (app/selfMovement localLeg), so this only has to read them.
   *
   *  A peer inside the Cave whose local position has not arrived yet — a restart cleared it, or they
   *  have not moved since — keeps `point`, which puts them at the portal. Honest, and self-correcting
   *  the moment they take a step. */
  const placeWorldPoint = (c: Vo3dCoworker): Vo3dCoworker =>
    // PHASE 7E — the AI Lab joins it, for the identical reason and with an identical mapping: both places
    // are outside V1's frame, so a peer's `localPoint` IS their real world position out there.
    (c.place === CAVE_PLACE_ID || c.place === AI_LAB_PLACE_ID) && c.localPoint ? { ...c, worldPoint: c.localPoint } : c;
  /** PHASE 7D FOLLOW-UP — ONE VOLUME AT A TIME.
   *
   *  The CAVE is a separate interior volume standing 1,146 units east of the V1 frame, and its geometry
   *  is NEVER DRAWN while nobody is inside it (rooms/cave.ts states this as the contract). A peer who
   *  walks in keeps being drawn at their real Cave coordinates — so from the office they appeared as a
   *  body, with a nameplate, standing in an empty field beyond the campus, which is what the screenshot
   *  shows. The room they are in is invisible; the person in it was not.
   *
   *  The fix is the same rule the geometry already follows, applied to the bodies: draw the people who
   *  are in the volume you are in. The signal is the one the feed already publishes and this file already
   *  reads — `place` — so nothing new is computed, carried or networked.
   *
   *  THE AI LAB IS DELIBERATELY NOT INCLUDED. It is a real building on the drawn campus, so somebody
   *  standing in it is standing somewhere you can see. Only the Cave is invisible from outside. */
  let rosterList: readonly Vo3dCoworker[] = [];
  let rosterMissingAvatar: readonly string[] | undefined;
  let rosterInsideCave = false;
  function syncRoster(): void {
    rosterInsideCave = caveTransition?.inside ?? false;
    const sameVolume = coworkersInSameVolume(rosterList, rosterInsideCave);
    void coworkers.sync(sameVolume.map(placeWorldPoint), rosterMissingAvatar).then(refreshCoworkerState);
    refreshCoworkerState();
  }

  caveTransition = new CaveTransition({
    build: caveBuild,
    // PHASE 7D — MULTIPLAYER. The CAVE is outside V1's coordinate frame, so a body inside it has no
    // position the movement wire can carry and, before this, crossing the boundary published nothing:
    // every other browser left the employee standing at the portal, with their nameplate out in the hub
    // and no avatar in the room. Naming the place is what the feed publishes ALONGSIDE the last real
    // in-frame point, so peers can put the body where it actually is (adapters/v1CoworkerPositions).
    // Told BEFORE the swap so the boundary crossing in the next frame already knows where this is going.
    onWhere: (where) => selfFeed?.entering(where === "cave" ? CAVE_PLACE_ID : null),
    media: caveMedia,
    // the WHOLE office, hidden while you are inside: eleven rooms and a ground floor stop being drawn,
    // which is most of the reason the CAVE can afford a 270° video at all
    officeRoot: mirror.root,
    place: (p, look, pitch) => {
      // The CAVE itself is outside the frame, but the portal point it returns you to is in the hub.
      if (!mayPlaceAt(p)) return false;
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
  /** Set once the lil-gui panel is built, so a preference written from the Settings panel repaints the
   *  inspection rig's rows too. Null until then — the preference still applies, the GUI just does not
   *  exist to repaint. */
  let guiRefresh: (() => void) | null = null;
  const refreshGuiIfBuilt = (): void => guiRefresh?.();

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
  // THE SEASON'S OWN AMBIENCE. Synthesised, not sampled (audio/HauntAudio.ts), and it inherits every
  // guarantee the mixer already makes: lazy on a user gesture, under the Audio volume and mute, ducked
  // during a meeting, and never anywhere near LiveKit's streams. Zero in the ordinary office costs
  // nothing at all, and `dispose()` below takes the layer with it.
  if (season === "halloween") envAudio.setSeasonAmbience(1);

  // SETTINGS -> AUDIO -> OFFICE SOUND. The employee's own preference for the ambient bed, read from the
  // SHARED store (services/settings/experiencePreferences) exactly as the graphics controller reads its
  // own. The dev GUI's two rows below still drive envAudio directly and are still the inspection rig's;
  // this is the product control, and it wins at startup and whenever the panel writes.
  //
  // `params` is kept in step so the GUI's readouts do not disagree with what is actually playing.
  const applyAmbientPreference = (): void => {
    const { ambientAudio, ambientVolume } = getExperiencePreferences();
    params.envAudio = ambientAudio;
    params.envAudioVolume = ambientVolume;
    if (ambientAudio) envAudio.start();
    envAudio.setEnabled(ambientAudio);
    envAudio.setVolume(ambientVolume);
  };
  applyAmbientPreference();
  // Cancelled in dispose(): the store outlives this world, so a world that did not unsubscribe would
  // keep a disposed EnvironmentalAudio alive through the listener set.
  const unsubscribeAmbient = subscribeExperience(() => {
    applyAmbientPreference();
    refreshGuiIfBuilt();
  });
  // The same contract for the environment choice: the panel writes the store, the store tells this
  // world, and the world re-grades. Cancelled in dispose() for the same reason — the store outlives it.
  const unsubscribeEnvironment = subscribeEnvironmentPreferences(() => {
    applyEnvironmentPreference();
    applyEnvPhase(true);
    refreshGuiIfBuilt();
  });

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
  // THE PERCH IS THE HUB'S OWN, passed in rather than imported by the flyer: rooms/central-hub declares
  // TOUCAN_PERCH precisely so that "whatever integrates Toucan into V2 reads this", and a released bird
  // has somewhere to go that is real geometry instead of a coordinate invented here.
  // …AND THE ROOMS IT WANDERS THROUGH are the office's OWN, not a second list: `labelRects` is the same
  // set of room rects Room Discovery letters and the camera frames, so the bird's indoor stops cannot
  // drift from the building and nothing new has to be maintained when a room moves.
  const toucanStops = labelRects.map((r) => ({ x: r.rect.x + r.rect.w / 2, z: r.rect.z + r.rect.d / 2 }));
  const toucan = new Toucan(plan.frame, TOUCAN_PERCH, toucanStops);
  R.scene.add(toucan.root);
  void toucan.load().then((ok) => { if (disposed) return; if (ok) R.invalidateShadows(); }); // LIFECYCLE guard, as above
  // ---- PHASE 7G: CALLING THE TOUCAN -----------------------------------------------------------------
  // The whole of the world's part in it. The INTENT is a boolean; the flight, the park point, the arrival
  // radius, the way home and the wing rhythm are all world/Toucan.ts's (and, under that, V1's own summon
  // machine). What is published is V1's coarse state, so the host can do exactly what V1's office does:
  // open the assistant when the bird ARRIVES, not when the button is pressed.
  let toucanCalled = false;
  let toucanReported: ToucanSummonState = "roaming";
  const toucanListeners = new Set<(state: ToucanSummonState) => void>();
  function publishToucanState(): void {
    const next = toucan.summonState;
    if (next === toucanReported) return;
    toucanReported = next;
    for (const listener of toucanListeners) listener(next);
  }
  function callToucan(): void {
    toucanCalled = true;
    // Told at once rather than on the next frame, so a click that lands on an already-parked bird
    // re-reports `attending` immediately and the panel opens from the gesture that asked for it.
    toucan.setSummonTarget({ x: avatar.position.x, z: avatar.position.z });
    publishToucanState();
  }
  function releaseToucan(): void {
    toucanCalled = false;
    toucan.setSummonTarget(null);
  }
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
    // THE PARK ANCHOR, every frame while the bird is called — this body, wherever it has walked to. Null
    // is the release, and the bird reads both through the same one setter (world/Toucan setSummonTarget).
    toucan.setSummonTarget(toucanCalled ? { x: body.x, z: body.z } : null);
    const wantsCall = toucan.update(dt, env.weather, env.phase ?? "day", outdoors);
    // ARRIVAL IS AN EVENT THE HOST WAITS FOR. Published after the step that could have changed it, and
    // only on a real transition — this runs at 60 Hz.
    publishToucanState();
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
    // THE EDITOR MOVES STATIC WORLD GEOMETRY, so the cached static shadow depth is stale the moment it
    // touches anything. Before the split shadow update this was masked: every redraw was a full one, so an
    // edited prop's shadow caught up on the next frame Bon happened to move. It no longer does, and a
    // preview that leaves a plant's shadow behind is exactly the class of bug the cache must not introduce.
    R.invalidateShadows();
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
  onCanvas("pointerdown", (e) => {
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
    // A press is the start of a possible drag: abandon any focus tween so the camera never fights a pan.
    cancelCamTween();
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  // PART 3 — RIGHT-CLICK MOVES THE AVATAR, V1's own contract (OfficeMap's right-click-to-move, with
  // `allowRightClickPan: false` so the button is exclusively movement). OFFICE releases the right button
  // from OrbitControls for exactly this; 3D EXPLORE keeps it as pan and therefore never moves anybody,
  // which is the promise that mode makes.
  let rightDownAt: { x: number; y: number; t: number } | null = null;
  onCanvas("pointerdown", (e) => {
    if (e.button !== 2 || playerMode.active || edit.editMode) return;
    cancelCamTween();
    rightDownAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  onCanvas("contextmenu", (e) => {
    // The browser menu would swallow the gesture and leave the avatar standing there.
    if (!playerMode.active) e.preventDefault();
  });
  onCanvas("pointerup", (e) => {
    if (e.button !== 2) return;
    const down = rightDownAt;
    rightDownAt = null;
    if (!down || playerMode.active || edit.editMode || params.cameraMode !== "office") return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; // a drag is not a destination
    approachCtl.cancel();
    const p = floorPoint(e.clientX, e.clientY);
    if (p) walkToGround(p.x, p.z);
  });
  onCanvas("pointermove", (e) => {
    if (playerMode.active || !edit.editMode || editDrag === "none") return;
    const p = floorPoint(e.clientX, e.clientY);
    if (!p) return;
    if (editDrag === "move") edit.preview({ x: p.x + grabOffset.x, z: p.z + grabOffset.z });
    else { const c = edit.currentPos(); if (c) edit.previewYaw(yawToward(c, p)); } // position held: the pivot IS the transform
    refreshEditVisuals();
  });
  onCanvas("pointerup", (e) => {
    if (playerMode.active) return;
    if (editDrag !== "none") { editDrag = "none"; R.controls.enabled = true; refreshEditVisuals(); return; }
    if (!downAt || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y), held = performance.now() - downAt.t;
    downAt = null;
    if (moved > 6 || held > 400 || !params.clickToWalk) return; // a drag = orbit, not a walk
    // PHASE 6D — A BODY IS PICKED BEFORE THE FURNITURE IT IS STANDING AMONG, but only when it is actually
    // in FRONT of it: a colleague behind a desk must not steal the desk's own click, and one standing in
    // front of a chair must not lose to the chair. The two picks are weighed by hit distance, which is the
    // only honest comparison — both rays are the same ray.
    // PHASE 7G — THE BIRD IS PICKED FIRST. It is small, it is in the air and nothing else is ever where
    // it is, so there is no contest to weigh: a click on the toucan is a click on the toucan. And it
    // means the SAME thing the summon button means — come here — so there is one entry point into the
    // assistant and not a second one hiding on the model.
    if (toucan.flying && pickToucanAt(e.clientX, e.clientY)) {
      callToucan();
      return;
    }
    const person = pickCoworkerAt(e.clientX, e.clientY);
    const hit = pickInteractionHit(e.clientX, e.clientY);
    if (person && (!hit || person.distance <= hit.distance)) {
      // Selecting a PERSON drops the room selection, exactly as V1's handleCharacterClick clears its room
      // sidebar: one world selection at a time, and the card that opens is about them, not about the floor.
      selectRoom(null);
      selectCoworker({ email: person.email, displayName: person.displayName });
      return;
    }
    // Anything else is a dismissal: selecting a chair, a door or a patch of floor is not selecting a
    // person, and leaving the card up over a world that has moved on is how it ends up pointing at nobody.
    selectCoworker(null);
    const picked = hit?.id ?? null;
    if (picked) {
      // Same rule as a person: a chair, a door or the portal is its own interaction, and V1 closes the
      // room panel for every one of them (seat, reception and HR-desk clicks all setRoomSidebar(null)).
      selectRoom(null);
      const ent = world.get(picked);
      // the portal is a transition, not a walk-up: clicking it has to mean the same thing pressing E on
      // it means, or the one interaction in the world that moves you between volumes would behave
      // differently depending on which camera you happened to be in
      if (picked === CHAMPIONSHIP_ENTRANCE_ID || picked === CAVE_EXIT_ID || picked === CAVE_SCREEN_ID) activateInteractable(picked, "approach");
      // PHASE 6C — a chair click SITS, through the same bridge PLAYER mode's E key uses (occupancy refusal
      // included). Before this, Office View walked up to a desk chair and faced it, and a non-Reception
      // sofa indexed a list it was not in.
      else if (ent.capabilities.seat) activateInteractable(picked, "seat");
      else if (ent.capabilities.lounge) activateInteractable(picked, "lounge", floorPoint(e.clientX, e.clientY) ?? undefined);
      else startApproach(picked);
      return;
    }
    // PART 3 — A LEFT CLICK SELECTS; IT DOES NOT WALK. V1's left button picks a character, a seat or a
    // room and its right button is what moves the avatar, and OFFICE now matches that.
    //
    // ROOM DETAILS PARITY — …AND A ROOM IS THE THIRD THING IT PICKS. V1's left click on a room layer opens
    // that room's details panel; the V2 equivalent of "the room layer" is the floor region under the
    // pointer, so the click is resolved to a ground point and asked which region owns it. Landing on the
    // shared hall, the sidewalk or outside the world gives no roomId, which is a DESELECT — the same
    // outcome this branch already had.
    const ground = floorPoint(e.clientX, e.clientY);
    selectRoom(ground ? world.regionAt(ground)?.roomId ?? null : null);
  });

  // ---- GUI -------------------------------------------------------------------------------------------
  const gui = new GUI({ title: "VO 3D — V2 (ground floor)" });
  // PART 6 — DEVELOPER DIAGNOSTICS ARE OFF BY DEFAULT.
  //
  // This panel is an inspection rig: 330-odd controllers over seat facings, room editors, nav debugging,
  // shadow counters, stress harnesses and render internals. Every one of them is developer-only by
  // intent, and none of them should be sitting over an employee's office — which is what was happening,
  // because the panel and the frame-time overlay mounted visible and covered the HUD's right-hand side.
  //
  // They are not REMOVED (that would take functionality away) — they are hidden behind one switch, which
  // the V1 Settings panel owns (Settings -> Developer) and which `?gui=1` also opens for a direct link.
  // The standalone dev page keeps them on, because inspection is the whole reason that page exists.
  const guiForcedOn = new URLSearchParams(window.location.search).get("gui") === "1";
  let devToolsVisible = guiForcedOn || identity === undefined;
  function applyDevToolsVisible(): void {
    gui.domElement.style.display = devToolsVisible ? "" : "none";
    overlay.visible = devToolsVisible && params.overlay;
    // PHASE 7C — the host's own readouts follow the SAME switch. They are diagnostics too (see
    // Vo3dHost.tsx): a redacted identity line, a desk-preview line, coworker counts and a movement/access
    // line, all of which were sitting over an employee's office in the top-right corner. Told rather than
    // polled, so nothing is scanning for a boolean every frame.
    for (const cb of devToolsListeners) cb(devToolsVisible);
  }
  const devToolsListeners = new Set<(on: boolean) => void>();
  const refresh = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());
  // The ambient-preference subscriber above is installed before the GUI exists; this is how it repaints
  // the GUI's rows once it does, without reaching for a `refresh` that was not defined yet.
  guiRefresh = refresh;
  const cam = gui.addFolder("Camera");
  const applyCam = () => { R.camParams = { pitch: params.pitch, yaw: params.yaw, zoom: params.zoom }; R.placeCamera(); };
  /** mirror whatever the mode policy decided back into the GUI state */
  const syncCam = (p: { pitch: number; yaw: number; zoom: number }) => { params.pitch = p.pitch; params.yaw = p.yaw; params.zoom = p.zoom; refresh(); };
  // THE MODE SWITCH owns both halves of the illusion: the camera policy AND what the environment presents.
  // OFFICE draws no exterior at all (see EnvPresentation) — camera bounds alone cannot stop a 16:9 viewport
  // overflowing a near-square office sideways, and anything out there would spoil the reveal.
  /** PHASE 7A — view-mode subscribers. A Set so a StrictMode double-subscribe cannot double-notify. */
  const viewModeListeners = new Set<(mode: Vo3dViewMode) => void>();
  const playerViewListeners = new Set<(view: "first" | "third") => void>();
  // PHASE 7D — who wants to know whether the pointer is ours, and whether the unlocked fallback is
  // carrying PLAYER. Drives the recovery hint and nothing else.
  const lockStateListeners = new Set<(locked: boolean, unlockedLook: boolean) => void>();
  playerMode.onLockState = (locked, unlockedLook) => {
    for (const cb of lockStateListeners) cb(locked, unlockedLook);
  };
  const notifyPlayerView = (): void => {
    for (const l of playerViewListeners) l(params.playerView);
  };
  const notifyViewMode = (): void => {
    const mode = params.cameraMode as Vo3dViewMode;
    for (const l of viewModeListeners) l(mode);
  };
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
      R.shadowFocusQuantum = PLAYER_SHADOW_FOCUS_QUANTUM;
      params.cameraMode = "player";
      // Taking direct control counts as having moved yourself: a V1 position restore landing afterwards
      // would teleport a player mid-stride. Same rule as the click-to-walk path above.
      selfMovedByUser = true;
      aiLab.group.visible = true; // you can walk out to it, so it has to be there to walk to
      if (monkey) monkey.visible = true;
      if (env.setPresentation("world")) R.invalidateShadows();
      R.invalidateShadows();
      refresh();
      notifyViewMode();
      return;
    }
    params.cameraMode = m;
    // OFFICE is the product framing and its camera fence is the V1 frame, so the Lab is not merely
    // off-screen there — it is unreachable by that camera. Hiding it takes its whole subtree out of
    // projectObject, SSAO's normal pass and the shadow pass in one boolean, so the default experience
    // pays nothing at all for it. EXPLORE is where it is meant to be discovered.
    aiLab.group.visible = m === "explore";
    if (monkey) monkey.visible = aiLab.group.visible;
    if (env.setPresentation(m === "office" ? "office" : "world")) R.invalidateShadows();
    syncCam(cameraModes.set(m));
    R.invalidateShadows();
    notifyViewMode();
  };
  cam.add(params, "cameraMode", CAMERA_MODES).name("mode: OFFICE / 3D EXPLORE / PLAYER").onChange(setCameraMode);
  // The manual pitch/yaw sliders only bite in EXPLORE — OFFICE pins the orientation, and letting a slider
  // break that would defeat the point of having a fixed mode at all.
  cam.add(params, "pitch", 12, 90, 1).onChange(() => { if (params.cameraMode === "explore") applyCam(); else syncCam(cameraModes.officeParams); });
  cam.add(params, "yaw", -180, 180, 1).onChange(() => { if (params.cameraMode === "explore") applyCam(); else syncCam(cameraModes.officeParams); });
  const playerGui = gui.addFolder("Player (WASD · Shift sprint · mouse look · E interact)");
  playerGui.add({ go: () => setCameraMode("player") }, "go").name("▶ enter PLAYER");
  playerGui.add({ go: () => setCameraMode("office") }, "go").name("■ leave PLAYER (→ OFFICE)");
  playerGui.add(params, "playerView", ["third", "first"]).name("view: THIRD / FIRST").onChange((v: PlayerView) => { playerMode.setView(v); notifyPlayerView(); });
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
  //
  // IT IS A SESSION OVERRIDE, AND IT DOES NOT PERSIST. The employee-facing choice lives in
  // services/settings/environmentPreferences (Settings -> Environment) and this row deliberately does
  // NOT write to it: a developer poking at the rig must never silently rewrite what somebody saved.
  // So this moves the running world only — the next write from the panel, and the next reload, both
  // land back on the saved preference. The reverse direction IS wired: a panel write repaints this row
  // (refreshGuiIfBuilt), so the rig always shows what is actually on screen.
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
  // picking one value from each dropdown. Switching either is a re-grade, never a rebuild. Same
  // session-override rule as the time row above: nothing here writes the saved preference.
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
  toucanGui.add(toucan.state, "phase").name("summon phase").listen().disable();
  toucanGui.add({ f: () => callToucan() }, "f").name("▶ call it here");
  toucanGui.add({ f: () => releaseToucan() }, "f").name("▶ release it");
  toucanGui.add({ f: () => toucan.reset() }, "f").name("▶ restart its lap");

  // ---- the AI Lab monkey (dev-only; the folder only exists with ?monkey=1) ----
  if (monkey) {
    const mk = gui.addFolder("AI Lab monkey (dev, ?monkey=1)");
    mk.add(monkey.state, "status").name("status").listen().disable();
    mk.add(monkey.state, "clip").name("clip playing").listen().disable();
    mk.add(monkey.state, "triangles").name("triangles").listen().disable();
    mk.add(monkey.state, "joints").name("joints").listen().disable();
    mk.add(monkey.state, "nativeHeight").name("source height (units)").listen().disable();
    const moving = { walking: false };
    mk.add(moving, "walking").name("walking (else restpose)").onChange((v: boolean) => monkey.setMoving(v));
    mk.add(monkey.state, "outfitTriangles").name("outfit triangles").listen().disable();
    const eyes = { warm: flags.get("eyes") !== "0" };
    mk.add(eyes, "warm").name("warm ivory eyes").onChange((v: boolean) => {
      if (v) void monkey.warmEyes(); else monkey.restoreEyes();
      R.invalidateShadows();
    });
    const dressed = { on: flags.get("outfit") === "1" };
    mk.add(dressed, "on").name("Toucan AI Scientist outfit").onChange((v: boolean) => {
      if (v) monkey.dress(); else monkey.undress();
      R.invalidateShadows();
    });
  }
  const geo = gui.addFolder("Geometry");
  const rebuild = () => {
    seat.reset(); // the room is rebuilt (and re-shadowed) below, so the chair snap-back is covered
    mirror.rebuildRoom(DESIGN_ROOM, shellOpts());
    // the room's meshes are new objects, so its addressable surfaces and lights are re-collected with them
    const g = mirror.roomGroup(DESIGN_ROOM.id);
    if (g) { surfaces.collect(DESIGN_ROOM.id, g); leds.collect(DESIGN_ROOM.id, g); }
    if (edit.selectedSurface?.startsWith(DESIGN_ROOM.id)) edit.selectSurface(null);
    door = new SlidingDoor(mirror.view(DOOR_ID), doorEntity.capabilities.door!, doorEntity.transform.pos);
    seat = new SeatInteraction(avatar, stack, mirror.view(CHAIR_4_ID), seatSpecFor(CHAIR_4_ID), (to) => planWalk(avatar.position, to, walkability, inBounds), () => params.walkSpeed);
  };
  geo.add(params, "wallHeight", 20, 110, 1).onFinishChange(rebuild); geo.add(params, "frontWall", ["low", "full", "hidden"]).onChange(rebuild);
  geo.add(params, "sway").name("plant sway").onChange((v: boolean) => (mirror.sway.enabled = v));
  geo.add(params, "ambient").name("powered-electronics idle").onChange((v: boolean) => (mirror.ambient.enabled = v));
  const av = gui.addFolder("Character (production GLB)");
  av.add(params, "avatar").name("show avatar").onChange((v: boolean) => (avatar.root.visible = v));
  av.add(params, "avatarLod", [0, 1, 2]).name("LOD").onChange(loadAvatar);
  av.add(params, "avatarLit").name("lit (off = production unlit)").onChange((v: boolean) => avatar.setLit(v));
  av.add(params, "walkSpeed", 8, 120, 1).name(`speed (units/s) — sprint x${SPRINT_MULTIPLIER.toFixed(2)}`).onChange((v: number) => (navCtl.speed = v));
  // ---- the roster's coworkers, as the world actually built them (Phase 4A) -------------------------
  // The DOM readout in app/Vo3dHost.tsx reports what V1's ROSTER said; this one reports what the WORLD
  // did with it, and the two are not the same question. A person can be resolved and still not be
  // standing anywhere — no legal point near their desk — and that difference is invisible from outside.
  const cw = gui.addFolder("Coworkers (V1 roster, read-only)");
  const coworkerState = { rendered: 0, live: 0, unplaced: "—", missing: "—", triangles: 0, state: "none pushed" };
  function refreshCoworkerState(): void {
    const st = coworkers.getStats();
    coworkerState.rendered = st.rendered;
    coworkerState.live = st.live;
    coworkerState.unplaced = st.unplaced.length ? st.unplaced.join(", ") : "—";
    coworkerState.missing = st.missingAvatar.length ? st.missingAvatar.join(", ") : "—";
    coworkerState.triangles = st.triangles;
    coworkerState.state = st.loading ? "loading…" : st.rendered > 0 ? "live" : "none";
  }
  cw.add(coworkerState, "rendered").name("bodies in the world").disable().listen();
  cw.add(coworkerState, "live").name("on a live V1 position").disable().listen();
  cw.add(coworkerState, "state").name("coworker status").disable().listen();
  cw.add(coworkerState, "unplaced").name("no standable desk").disable().listen();
  cw.add(coworkerState, "missing").name("no 3D avatar").disable().listen();
  cw.add(coworkerState, "triangles").name("triangles").disable().listen();
  cw.add({ go: () => { for (const b of coworkers.group.children) console.log("coworker", b.name, b.position.x.toFixed(1), b.position.z.toFixed(1)); } }, "go").name("log every body to the console");

  av.add(avatarState, "who").name("player").disable().listen(); av.add(avatarState, "spawn").name("spawn").disable().listen(); av.add(avatarState, "status").disable().listen(); av.add(avatarState, "clip").disable().listen(); av.add(avatarState, "position").disable().listen(); av.add(avatarState, "owner").name("controller owner").disable().listen();
  // PHASE 5 readout: how much of this session's movement reached V1, and how much was refused because it
  // was not expressible as a V1 position (outside the frame — the campus, the Lab, the CAVE). Counts
  // only, never a coordinate: a panel that printed one would be publishing a location into the page.
  if (selfMovement) {
    const acc = av.addFolder("working-office access (V1 attendance)");
    acc.add(accessState, "access").name("V1 says").disable().listen();
    acc.add(accessState, "gate").name("Reception gates").disable().listen();
    acc.add(accessState, "zone").name("standing in").disable().listen();
    acc.add(accessState, "sensors").name("gate sensors").disable().listen();
    acc.add(exitState, "held").name("exit held").disable().listen();
    acc.add(exitState, "authorized").name("exit authorised").disable().listen();
    acc.add(exitState, "prompts").name("exit prompts").disable().listen();
    acc.add(roomLockState, "locked").name("dnd-locked rooms").disable().listen();
    acc.add(roomLockState, "held").name("dnd-held doors").disable().listen();
    acc.add(roomLockState, "authorized").name("dnd entry authorised").disable().listen();
    acc.add(roomLockState, "prompts").name("dnd door prompts").disable().listen();
    acc.add(aiLabState, "inside").name("in the AI Lab").disable().listen();
    acc.add(accessState, "ejections").name("ejections from office").disable().listen();
    const pub = av.addFolder("published to V1");
    pub.add(selfMovement.state, "started").name("walk_started").disable().listen();
    pub.add(selfMovement.state, "arrived").name("walk_arrived").disable().listen();
    pub.add(selfMovement.state, "refused").name("refused (outside V1 frame)").disable().listen();
  }
  // ---- PHASE 6C — SEAT FACING (dev tool) ---------------------------------------------------------------
  // Sit in a chair, pick a word, watch the body turn; every other browser turns their copy of you on the
  // next sync. "save to project" POSTs the whole table to the Vite dev server (vite.config.ts writes
  // src/dev/vo3d/data/seatFacing.json); "copy JSON" is the fallback when the dev server is not Vite's.
  const facingState = { anchor: "none (sit in a seat)", facing: "front" as SeatFacing, unsaved: 0, status: "" };
  const facingGui = gui.addFolder("Seat facing (front / back / left / right)");
  facingGui.add(facingState, "anchor").name("seat").disable().listen();
  const facingCtl = facingGui.add(facingState, "facing", [...SEAT_FACINGS]).name("faces").onChange((f: SeatFacing) => {
    if (!currentSeatAnchor || seatFacingFor(currentSeatAnchor) === f) return;
    setSeatFacingOverride(currentSeatAnchor, f);
  });
  facingGui.add(facingState, "unsaved").name("unsaved edits").disable().listen();
  facingGui.add(facingState, "status").name("status").disable().listen();
  facingGui.add({ save: () => {
    facingState.status = "saving…";
    fetch(`${import.meta.env.BASE_URL}__vo3d/seat-facing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(seatFacingTable()) })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); markSeatFacingSaved(); facingState.status = "saved to src/dev/vo3d/data/seatFacing.json"; })
      .catch((e: unknown) => { facingState.status = `save failed (${String(e).slice(0, 40)}) — use copy JSON`; });
  } }, "save").name("▶ save to project");
  facingGui.add({ copy: () => {
    void navigator.clipboard?.writeText(JSON.stringify(seatFacingTable(), null, 2) + "\n").then(() => { facingState.status = "table copied — paste into src/dev/vo3d/data/seatFacing.json"; });
  } }, "copy").name("▶ copy JSON");
  /** Apply a changed facing to whoever sits there: the local body's interaction and every peer body. */
  disposers.push(subscribeSeatFacing((id, f) => {
    const yaw = seatedYawFor(id, 0);
    for (const s2 of [seat, hubSeat, meetingSeat, gamingSeat, execSeat, cmsSeat, aiSeat, devSeat, qaSeat, restoredSeat, otherSeat]) if (s2 && currentSeatAnchor === id) s2.setSeatedYaw(yaw);
    for (const l of [loungeSeat, restoredLounge]) if (l && currentSeatAnchor === id) l.setSeatedYaw(yaw);
    coworkers.reposeSeated(id);
    // Tell every other browser: republish the seated arrival with the new yaw (Feed.reseated).
    if (currentSeatAnchor === id && selfSeatedPublished) { const wp = avatar.worldPosition(); selfFeed?.reseated({ x: wp.x, z: wp.z }, yaw, id); }
    facingState.status = `${id.split("/")[1]} → ${f}`;
    R.invalidateShadows();
  }));
  const sitGui = gui.addFolder("Chair interaction (design-member-chair-4)");
  sitGui.add({ sit: () => { clearSeats(); currentSeatAnchor = CHAIR_4_ID; const r = seat.sit(); if (r && !r.ok) seatState.state = seat.status; } }, "sit").name("▶ Sit");
  sitGui.add({ stand: () => seat.stand() }, "stand").name("▶ Stand");
  sitGui.add({ reset: () => { seat.reset(); R.invalidateShadows(); } }, "reset").name("reset interaction");
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
  onWindow("keydown", (e) => {
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
  const RECEPTION_INSIDE: Vec2 = OFFICE_EXIT_STAND;
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
    // The monument stands in the hub, which is working office. A placement does not route, so the closed
    // lanes cannot refuse it — the boundary is asked directly.
    if (!mayPlaceAt(p)) { navState.last = "refused: the monument is inside the working office"; return; }
    navCtl.setPath([]);
    if (playerMode.active) playerMode.body.placeNear(p);
    avatar.setPosition(playerMode.active ? playerMode.body.pos : p);
    facePlayer({ x: 0, z: 1 }); // looking south, at the monument's back and the portal cut into it
  }
  function placeBonAtEntrance(): void {
    // Reception's public side, so this is open at every attendance state — the guard is here for the same
    // reason the one above is: a placement is the one movement nothing routes.
    if (!mayPlaceAt(RECEPTION_INSIDE)) return;
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

  // ---- GRAPHICS & DISPLAY ------------------------------------------------------------------------
  // The user's Settings → Graphics & Display preference, applied to THIS renderer. The controller owns
  // the mode and (in Smooth only) the adaptive rung; render/GraphicsEngine owns what each setting does
  // here. Both live outside this file on purpose — the product's settings panel drives the same two
  // modules through the same persisted store, so there is one graphics system rather than a dev one and
  // a product one that drift.
  const graphics = new GraphicsController({
    engine: createGraphicsEngine(R, {
      sway: mirror.sway,
      env,
      // A USER-ONLY lever (Custom's "Character detail"). The adaptive ladder never calls this: reloading
      // a GLB is an asset swap, and Smooth is not allowed to reach into loaded world content.
      setAvatarLod: (lod) => {
        if (params.avatarLod === lod) return;
        params.avatarLod = lod;
        loadAvatar();
        refresh();
      },
    }),
    startedAtMs: performance.now(),
  });
  const graphicsState = { mode: "—", quality: "—", frame: "—", last: "—" };
  // A resize changes what a frame COSTS (a different drawing buffer, a different number of rooms in
  // view), and a backgrounded tab stops producing frames at all. Measuring across either boundary is
  // measuring nothing, so the window is thrown away — the current quality is kept, only the evidence is.
  onWindow("resize", () => graphics.resetMeasurement(performance.now()));
  onDocument("visibilitychange", () => graphics.resetMeasurement(performance.now()));

  // The dev READOUT for it. Read-only: the real control surface is the product's Settings → Graphics &
  // Display panel, which writes the same persisted preference this controller is already listening to.
  const graphicsGui = gui.addFolder("Graphics & Display");
  graphicsGui.add(graphicsState, "mode").name("mode (set in Settings)").disable().listen();
  graphicsGui.add(graphicsState, "quality").name("applied").disable().listen();
  graphicsGui.add(graphicsState, "frame").name("sustained frame").disable().listen();
  graphicsGui.add(graphicsState, "last").name("last adaptation").disable().listen();

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
  bench.add(params, "overlay").name("stats overlay").onChange((v: boolean) => { overlay.visible = devToolsVisible && v; });
  // The A/B switch for room-level culling. OFF restores every subtree on the very next frame, which is
  // what makes a BEFORE/AFTER capture a toggle rather than a rebuild.
  bench.add(params, "shadowCache").name("split shadow update (cached static depth)").onChange((v: boolean) => { R.shadowCache = v; R.invalidateShadows(); });
  bench.add(params, "roomCulling").name("room culling (visibility)").onChange(() => { if (!params.roomCulling) mirror.visibility.restoreAll(); R.invalidateShadows(); });
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
    // PHASE 7E — WHAT A GATE SAYS WHEN SOMEBODY ARRIVES AT IT. Blue is the resting state for everyone;
    // the access bar and lamp answer as a body enters the lane and ease back to blue behind them. This
    // only chooses WHICH answer — green once V1 has confirmed a check-in, red until then.
    //
    // IT DECIDES NOTHING. The lane is opened or closed by the Walkability reservation alone (setOfficeAccess
    // above), which is held from the same `officeAccess` read here every frame — so a blue gate is still a
    // shut gate, and no animation can ever let anybody through.
    //
    // The ENTRANCE sensor is deliberately NOT included: a checked-out employee is welcome through the
    // front door and into Reception — the doors are not what is refusing them. Only the gates are, and
    // even they refuse with a reservation rather than with a colour.
    const permitted = mayEnterOffice(officeAccess);
    for (const id of GATE_SCANNER_IDS) mirror.ambient.setScannerDenied(id, !permitted);
    // The kiosk answers the same way, on the same terms: BLUE at rest, and green or red only while
    // somebody is actually standing at it (KIOSK_ZONE, the same read-only proximity test as every other
    // scanner here). Which of the two it shows is V1's answer, never a click.
    mirror.ambient.setScannerDenied(KIOSK_SCANNER_ID, !permitted);
    mirror.ambient.setScanner(KIOSK_SCANNER_ID, pointInRect(scannerAt, KIOSK_ZONE));
    // PHASE 7E — THE EXIT PROMPT. Raised where every other proximity test here is raised, from the same
    // read-only position, and only while the exit is actually held: a checked-out employee walking out is
    // asked nothing, because nothing is stopping them. The world does not decide what leaving MEANS — it
    // reports that somebody is trying to (app/interactions.ts).
    const onMat = pointInRect(scannerAt, ENTRY_ZONE);
    if (!onMat) {
      // THEY WALKED AWAY. Told once, on the edge, so the card cannot follow them back across the room —
      // and `exitPrompted` clearing here is also what makes a second approach ask again.
      if (exitPrompted) coworkerInteractions?.onExitAbandoned?.();
      exitPrompted = false;
    } else if (!exitPrompted && exitState.held === "yes") {
      exitPrompted = true;
      exitState.prompts++;
      coworkerInteractions?.onExitIntercepted?.();
    }
  }
  let entryPath: readonly Vec2[] = [];

  // ---- room-level visibility ---------------------------------------------------------------------------
  // The POLICY half of render/RoomVisibility: which camera is authoritative, which room may never be
  // hidden, and whether the shadow frustum has to be consulted at all. The system itself holds no
  // knowledge of the world, the player or the camera modes — it is handed all three here, once a frame,
  // through the Renderer's `cull` hook (which runs after the shadow frame has settled).
  //
  // CAMERA VISIBILITY IS AUTHORITATIVE. `R.activeCamera` is whichever camera the modes selected: the
  // orthographic rig in OFFICE and EXPLORE, the perspective rig in PLAYER. Nothing here looks at the
  // player's position to decide what to draw — a user standing in Reception can look straight down the
  // hall, and the overhead framing shows the whole floor.
  //
  // THE ONE GAMEPLAY CONCESSION is `keep`: the room the avatar is standing in stays visible whatever the
  // frustum says. Its cost is at most one room; its value is that no camera bug, no bounds error and no
  // mid-threshold frame can ever make the floor under Bon's feet disappear.
  const avatarRoomProbe: Vec2 = { x: 0, z: 0 };
  function playerRoomId(): string | null {
    const p = avatar.worldPosition();
    avatarRoomProbe.x = p.x;
    avatarRoomProbe.z = p.z;
    return world.regionAt(avatarRoomProbe)?.roomId ?? null;
  }
  R.cull = () => {
    mirror.visibility.enabled = params.roomCulling;
    mirror.visibility.update(R.activeCamera, {
      light: R.key,
      // With shadows off nothing can be cast, so the light frustum stops widening the test and the
      // culling gets tighter — which is exactly right, and is why preset C sees more of it than preset A.
      shadows: R.renderer.shadowMap.enabled,
      keep: playerRoomId(),
    });
  };

  // ---- stress harness state (dev-only, measurement-only) -----------------------------------------
  // Everything here is inert until a stress scenario asks for it: the normal page pays two null checks a
  // frame and nothing else. The crowd itself lives in devtools/Crowd; the matrix in devtools/Stress.
  let crowd: Crowd | null = null;
  /** MEASUREMENT ONLY, and never left on. While true the loop still DECIDES that the shadow map is stale
   *  (so the rate keeps being counted) but does not ask for the redraw — which is the only way to price
   *  what that redraw costs at a given crowd size. The approved shadow behaviour is unchanged. */
  let stressFreezeShadows = false;
  /** frames on which something that casts a shadow had moved, i.e. frames the shadow map was updated */
  let shadowRedraws = 0;
  /** ...and the subset of those that needed the FULL static redraw rather than the cheap avatar composite */
  let shadowStaticRedraws = 0;
  let framesSeen = 0;
  /** page/runtime errors, collected for the stress report (the harness reads and clears per scenario) */
  const pageErrors: string[] = [];
  const noteError = (msg: string): void => { if (pageErrors.length < 50) pageErrors.push(msg.slice(0, 300)); };
  onWindow("error", (e) => noteError(`error: ${e.message}`));
  onWindow("unhandledrejection", (e) => noteError(`unhandledrejection: ${String(e.reason)}`));

  // ---- loop --------------------------------------------------------------------------------------------
  const clock = new THREE.Timer();
  let lastFrame = performance.now();
  let overlayTick = 0;
  /** True while anything that casts a shadow is still moving. Compared against the last frame rather than
   *  asking each controller, so a new interaction can never forget to opt in. */
  const lastShadowPose: CasterPose = { x: Number.NaN, z: 0, yaw: Number.NaN, clip: "" };
  /** Did any coworker's transform change this frame? Written by the loop's coworkers.update call and read
   *  by the dynamic-shadow gate below, in that order, so a walking body's shadow follows it. Kept as a
   *  frame variable rather than asked of the system twice: `coworkers.moving` would answer "is a walk in
   *  flight", which is nearly the same and not quite — a replay's last frame covers no ground. */
  let coworkersMoved = false;
  // THE SPLIT IS BY WHAT MOVED, not by how much. A DYNAMIC caster is a registered avatar body and nothing
  // else: it is drawn into the shadow map over a cached static depth, so it costs ~70 draws instead of the
  // whole ground floor (render/Renderer, updateShadowMaps). ANYTHING ELSE that casts a shadow — a door leaf,
  // a chair an interaction is dragging, a piece of furniture the editor moved — is part of the STATIC world
  // as far as the cache is concerned and must force a full redraw, or its shadow would sit still while it
  // moved. When in doubt the answer is worldMotion(): a needless full redraw costs milliseconds, a missed
  // one is a visible bug.
  function avatarShadowsAreStale(): boolean {
    const p = avatar.worldPosition();
    // POSITION, HEADING AND CLIP — casterPoseMoved is where that decision lives and is tested. Yaw joined
    // it in stage 4b: an approach ends by turning on the spot, and a seat sequence turns Bon into the
    // chair, both of which used to be covered only because the controller was holding the whole static
    // world stale. They now cost the cheap dynamic composite that the moving body always should have.
    const next: CasterPose = { x: p.x, z: p.z, yaw: avatar.yaw, clip: avatar.currentClip ?? "" };
    const moved = casterPoseMoved(lastShadowPose, next);
    lastShadowPose.x = next.x; lastShadowPose.z = next.z; lastShadowPose.yaw = next.yaw; lastShadowPose.clip = next.clip;
    // a walking avatar animates continuously — and so does a coworker replaying a movement V1 published
    return moved || navCtl.moving || (crowd?.moving ?? false) || coworkersMoved;
  }
  /** A/B SWITCH, MEASUREMENT ONLY, never left on. True restores the pre-stage-4 rule exactly — a door is
   *  stale for as long as it is not closed, the hold included — so the two rules can be captured inside
   *  ONE page session. Run-to-run frame-time drift on this machine is larger than what the fix is worth,
   *  so an A/B that spans two browser launches cannot see it; this is how the numbers in the report were
   *  produced. Nothing reads it in the product: it defaults to false and only the dev surface writes it. */
  let doorStaleLegacy = false;
  /** The same A/B switch for the INTERACTION half of the predicate (stage 4b): true restores the
   *  pre-fix rule — any seat or approach that is not idle holds the whole static world stale. */
  let interactionStaleLegacy = false;
  function doorsAreStale(): boolean {
    if (doorStaleLegacy) {
      return door.state !== "closed" || entryDoor.state !== "closed" || gamingDoor.state !== "closed" || execDoor.state !== "closed"
        || cmsDoor.state !== "closed" || aiDoor.state !== "closed" || devDoor.state !== "closed" || qaDoor.state !== "closed";
    }
    return door.moved || entryDoor.moved || gamingDoor.moved || execDoor.moved || cmsDoor.moved || aiDoor.moved || devDoor.moved || qaDoor.moved;
  }
  /** Something in the WORLD that casts a shadow is MOVING: a door leaf, and every interaction that drags
   *  a chair. These invalidate the cached static depth, exactly as they always have. */
  function worldShadowsAreStale(): boolean {
    // DOORS ARE ASKED WHAT MOVED, NOT WHAT STATE THEY ARE IN. `state !== "closed"` also covers the HOLD,
    // during which the leaf stands still and the redraw it asked for reproduced the previous shadow map
    // exactly. Worse, an unbroken streak of static invalidations trips Renderer's THRASH FALLBACK, so the
    // split shadow update stands down and every frame pays a full redraw of ~2,800 static casters: the
    // held-open door was making the cache it was supposed to benefit from give up. SlidingDoor.moved is
    // true on exactly the frames the leaf's transform changed, which is what a shadow map depends on —
    // a moving door still forces its full redraw, on every frame it moves, including the one it lands on.
    //
    // THE SEATS ANSWER THE SAME QUESTION, and two controllers have left this list entirely.
    // A SeatInteraction moves a CHAIR — a static caster — but only in four of its eleven states; for the
    // walk over, the glide onto the cushion, the whole SEATED hold and the walk away it writes nothing
    // static, and `status !== "idle"` was reporting all of it. APPROACH and LOUNGE-SEAT never touch
    // world geometry at all: approach walks the body and turns it, and LoungeSeatInteraction is built
    // around a sofa that by construction never moves (see its furnitureDrift invariant). Both used to
    // hold the static world stale FOREVER after they finished, because their terminal status is
    // "at <label>" / "seated", not "idle" — measured at 139 full redraws in 139 stationary frames.
    // What they do move is the avatar, which is a DYNAMIC caster with its own test above.
    // NOTE for the day this A/B switch goes: five room wiring tests (ai/cms/dev/qa/executive) assert the
    // `(xSeat?.status ?? "idle") !== "idle"` text below as their "this seat is wired into shadow
    // staleness" guard. Deleting the legacy branch means re-pointing those five regexes at `xSeat?.moved`.
    if (interactionStaleLegacy) {
      return doorsAreStale()
        || seat.status !== "idle" || approachCtl.status !== "idle"
        || (meetingSeat?.status ?? "idle") !== "idle" || (gamingSeat?.status ?? "idle") !== "idle"
        || (hubSeat?.status ?? "idle") !== "idle" || (loungeSeat?.status ?? "idle") !== "idle"
        || (execSeat?.status ?? "idle") !== "idle" || (cmsSeat?.status ?? "idle") !== "idle"
        || (aiSeat?.status ?? "idle") !== "idle" || (devSeat?.status ?? "idle") !== "idle" || (qaSeat?.status ?? "idle") !== "idle";
    }
    return doorsAreStale()
      || seat.moved
      || (meetingSeat?.moved ?? false) || (gamingSeat?.moved ?? false)
      || (hubSeat?.moved ?? false) || (execSeat?.moved ?? false) || (cmsSeat?.moved ?? false)
      || (aiSeat?.moved ?? false) || (devSeat?.moved ?? false) || (qaSeat?.moved ?? false);
  }
  // THE ONE FLUSH dispose() CANNOT DO. A reload, a tab close or a back navigation tears the document down
  // WITHOUT unmounting React, so app/Vo3dHost.tsx's cleanup — and therefore dispose() — never runs. The
  // leg in flight would then never be resolved, and the employee's durable position would stay one leg
  // behind where they actually stopped: V1 would restore them to it on the way back in.
  //
  // `pagehide` rather than `beforeunload`: it is the event that fires for a real navigation AND for a tab
  // being discarded, and it does not ask the browser for an unload prompt. The emit is best-effort — the
  // socket may already be going — which is why it is a flush of state that is otherwise correct, never the
  // only thing keeping it correct.
  onWindow("pagehide", () => selfFeed?.dispose());
  function loop(): void {
    // LIFECYCLE. The loop used to re-schedule itself unconditionally, which is correct for a page that
    // lives as long as the document and a leak for a world that can be unmounted: the callback keeps
    // firing against a force-lost context forever, once per mount ever made. The handle is kept so
    // dispose() can cancel the frame ALREADY scheduled, and the guard stops this one re-arming.
    if (disposed) return;
    rafHandle = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(250, now - lastFrame);
    lastFrame = now;
    // SMOOTH's measurement, AND THE ONE PLACE A RUNG CHANGE IS ALLOWED TO LAND. `dt` is the frame that
    // just finished, so sampling it here measures exactly what sampling it at the bottom did.
    //
    // IT HAS TO RUN BEFORE R.render(), NOT AFTER IT. A change of render scale calls Renderer.resize(),
    // and resizing the canvas REALLOCATES the WebGL drawing buffer, which discards whatever is in it.
    // Run from the bottom of the loop, that wipes the frame this callback had just drawn, and the
    // browser then composites an empty canvas — one white flash, exactly on a rung transition, which is
    // what this ordering was reported for. Adapting first and drawing afterwards means the new buffer is
    // always filled before the frame is presented. (The store-listener path — a user picking a setting
    // in Settings — resizes BETWEEN frames, like a window resize always has, and is unaffected either
    // way.) A no-op in Full and Custom: the controller does not even keep a window outside Smooth.
    graphics.frame(dt, now);
    updateCamTween(dt);
    const t = clock.update().getElapsed();
    if (params.motion) scriptedMotion(t);
    mirror.sway.update(t);
    mirror.foliage.update(); // blade batches follow the sway pivots; a no-op while sway is off
    mirror.ambient.update(t, dt / 1000); // powered-surface idle animation (screens, sensors, status strips)
    if (aiLab.group.visible) aiLab.tick(t); // the agents' status pulse — one sin() and six float writes
    monkey?.update(dt / 1000); // dev-only; a no-op while the monkey is hidden or absent
    // The season's upright glow haloes turn to face whichever camera is drawing. A handful of
    // quaternion copies; absent entirely in the ordinary office.
    seasonLayer?.update(R.activeCamera);
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
      restoredSeat?.update(dt / 1000);
      otherSeat?.update(dt / 1000);
      loungeSeat?.update(dt / 1000);
      restoredLounge?.update(dt / 1000);
      approachCtl.update(dt / 1000);
      navCtl.update(dt / 1000);
      avatar.update(dt / 1000);
      const bp = avatar.worldPosition();
      // PHASE 6C — THE SEATED HAND-OFF. One transition each way, read from the interactions' own states:
      // the frame the body commits to a chair the feed resolves the movement that brought it there as a
      // seated arrival in that chair (the chair's own yaw, not the body's mid-turn one); the frame it
      // leaves, the feed resumes publishing the ordinary legs that walk it away.
      const nowSeated = seatedNow();
      if (nowSeated !== selfSeatedPublished) {
        selfSeatedPublished = nowSeated;
        if (nowSeated && currentSeatAnchor) selfFeed?.seated({ x: bp.x, z: bp.z }, seatedYawOf(currentSeatAnchor) ?? avatar.yaw, currentSeatAnchor);
        else if (!nowSeated) {
          selfFeed?.stood({ x: bp.x, z: bp.z }, avatar.yaw);
          // CLEARED ONLY WHEN NO SIT IS UNDER WAY. Choosing another chair while seated resets the old
          // interaction and starts the new one in the same call — the frame after, the body is not
          // seated (it is approaching), and clearing here wiped the NEW anchor, so that sit was never
          // published as seated: every browser but this one saw the person standing at the chair.
          if (!seatEngaged()) currentSeatAnchor = null;
        }
      }
      seatSyncState.anchor = currentSeatAnchor ?? "none";
      seatSyncState.seated = nowSeated ? "yes" : "no";
      facingState.anchor = currentSeatAnchor ?? "none (sit in a seat)";
      facingState.unsaved = unsavedSeatFacingCount();
      if (currentSeatAnchor) { const f = seatFacingFor(currentSeatAnchor); if (f && f !== facingState.facing) { facingState.facing = f; facingCtl.updateDisplay(); } }
      // PHASE 5 — PUBLISH THE EMPLOYEE'S OWN MOVEMENT. Deliberately here: every controller that can move
      // Bon has already written this frame's transform, so the feed sees the body's real position whether
      // it was moved by the planner, by PLAYER mode's WASD, by a seat or by a portal — and needs to know
      // about none of them. `navCtl.path.length > 0` is the one extra signal: it separates a planned walk
      // (announced up front by walkToGround) from free movement, and is how a planned walk's end — or its
      // interruption — is detected. A no-op when no sink was handed over (the standalone dev page).
      // PHASE 6D — THE LAST BEAT OF AN APPROACH: turn onto the person you walked up to, at the same
      // unhurried rate every other interaction turns at. Done HERE, before the feed is told, for the
      // reason Phase 6B added an exact arrival yaw in the first place — a walk_arrived published
      // mid-turn tells every other browser this employee is facing a direction they are about to leave.
      // `turning` therefore also holds the planned walk open for those few hundred milliseconds: the feed
      // resolves a planned walk when the planner goes quiet, and quiet is not the same as finished.
      if (coworkerApproach?.turning) {
        const next = stepAngle(avatar.yaw, coworkerApproach.yaw, APPROACH_TURN_RATE * (dt / 1000));
        avatar.setYaw(next);
        if (Math.abs(wrapAngle(coworkerApproach.yaw - next)) < 0.02) {
          avatar.setYaw(coworkerApproach.yaw);
          const arrived = coworkerApproach.email;
          coworkerApproach = null;
          // Published FIRST (the line below sees `turning` false and resolves the walk with this exact
          // yaw), reported to the host after — V1's quest signal must never outrun the movement that
          // earned it.
          selfFeed?.frame(0, { x: bp.x, z: bp.z }, avatar.yaw, false);
          coworkerInteractions?.onApproachArrived(arrived);
        }
      }
      // THE CONVERSATION POSE, applied where every other clip decision has already been made this frame.
      // Gated on an idle ControllerStack so walking, seating, an interaction and PLAYER mode all outrank
      // it — the same ordering V1's own resolveCharacterAnimState uses.
      // ALWAYS ASSERT THE RESTING CLIP, not only when there is a pose. Applying the pose alone meant that
      // when it CLEARED — typing stopped, the conversation ended — nothing ever wrote the idle back, so
      // the body stayed frozen in the gesture it happened to be in. `avatar.play` is guarded on the
      // current clip, so re-asserting it every frame costs nothing.
      if (stack.owner === "Idle" && !seatedNow()) avatar.play(selfConversationClip ?? CLIP_IDLE);
      selfFeed?.frame(dt, { x: bp.x, z: bp.z }, avatar.yaw, navCtl.path.length > 0 || coworkerApproach?.turning === true);
      const zoneNow = zoneOf({ x: bp.x, z: bp.z });
      if (zoneNow !== accessState.zone) {
        accessState.zone = zoneNow;
        // PHASE 7E — one edge, for the one thing the host reads from it (app/interactions.ts).
        coworkerInteractions?.onZoneChanged?.(zoneNow);
      }
      // PHASE 7E — AN AUTHORISED DEPARTURE IS SPENT ON THE WAY BACK. The authorisation exists for one
      // trip; once the body has actually left the frame and come back inside, the exit re-arms itself, so
      // the next attempt to leave asks again. Nothing about attendance is touched either way.
      applyExitGate({ x: bp.x, z: bp.z });
      applyRoomLocks({ x: bp.x, z: bp.z });
      if (exitAuthorized) {
        if (accessState.zone === "outside") exitUsed = true;
        else if (exitUsed) setExitAuthorized(false); // they went, and they are back
        // …OR THEY CHANGED THEIR MIND. An authorisation that was never spent must not sit open for the
        // rest of the session: stepping off the mat and back into the building withdraws it, so the next
        // attempt to leave asks again. Measured off the mat AND the doorway band, or the authorisation
        // would be withdrawn from under somebody mid-stride through the doors.
        else if (!pointInRect({ x: bp.x, z: bp.z }, ENTRY_ZONE) && !pointInRect({ x: bp.x, z: bp.z }, EXIT_BAND)) setExitAuthorized(false);
      }
      // …AND THE LAB IS NAMED WHILE THEY ARE IN IT. `entering` only records the name; app/selfMovement.ts
      // is what publishes it, at the frame boundary and for every step taken out there. Set from the
      // body's real position, so a return clears it without anybody having to remember to.
      const inLab = inAiLabZone({ x: bp.x, z: bp.z }, NAV_RADIUS);
      if (inLab !== selfInAiLab) {
        selfInAiLab = inLab;
        aiLabState.inside = inLab ? "yes" : "no";
        // The CAVE owns `place` while you are inside it; the two volumes never overlap, so this can never
        // rename a Cave occupant.
        if (caveTransition?.state.where !== "cave") selfFeed?.entering(inLab || exitAuthorized ? AI_LAB_PLACE_ID : null);
      }
      accessState.sensors = mirror.ambient.scannerDenied(GATE_SCANNER_IDS[0]) ? "refusing (red)" : "clear (green)";
      // A direct-control player has no planned route, so the automatic doors would only react once his body
      // was already inside the sweep band. `doorIntent` is a one-segment synthetic route pointing a stride
      // ahead of him — the SAME input SlidingDoor already consumes, so no door logic changes at all.
      const route = navCtl.path.length ? navCtl.path : playerMode.doorIntent;
      // MULTIPLAYER DOORS. Every OTHER body the world is drawing, as the doors see them — read once per
      // frame and handed to all of them. The doors were driven by the local employee alone, which is why
      // the other browser could watch somebody walk through a shut leaf: their door had never been told
      // that anybody but its own viewer existed. Nothing new is on the wire and no door state is shared
      // — these bodies ARE V1's replicated positions and movements, already on the floor (see
      // Coworkers.doorBodies). Order matters only in that it is the PREVIOUS frame's coworker transforms
      // (coworkers.update runs later in the loop); one frame of lag against a door that takes ~600 ms to
      // open is not observable.
      const peerBodies = coworkers.doorBodies();
      door.update(dt / 1000, { x: bp.x, z: bp.z }, route, peerBodies);
      entryPath = route;
      // PHASE 7E — THE ENTRANCE DOORS STAY SHUT WHILE THE EXIT IS HELD. An employee standing on the mat
      // overlaps the doorway's own crossing rect, which is all SlidingDoor needs to open — so holding the
      // FLOOR was not enough on its own: the leaves slid back over a threshold nobody could cross.
      //
      // The door is fed a body that is nowhere near it, rather than frozen or reset: it then closes on its
      // own timing, reverses correctly if it was already opening, and SlidingDoor itself is untouched —
      // no new state, no new API, and every other door in the building behaves identically to before.
      const exitHeld = exitState.held === "yes";
      // THE SUPPRESSION IS THE WHOLE DOOR, coworkers included. Phase 7E holds the entrance SHUT while
      // the exit gate is held, and a leaf that slid back because a peer happened to be walking past
      // would defeat exactly the threshold that hold exists to keep closed. Every other door sees
      // everybody.
      entryDoor.update(dt / 1000, exitHeld ? DOOR_SUPPRESSED : { x: bp.x, z: bp.z }, exitHeld ? NO_ROUTE : route, exitHeld ? NO_BODIES : peerBodies);
      gamingDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route, peerBodies);
      execDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route, peerBodies);
      cmsDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route, peerBodies);
      aiDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route, peerBodies);
      devDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route, peerBodies);
      qaDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route, peerBodies);
      updateScanners({ x: bp.x, z: bp.z });
      caveTransition?.update(); // media readout; a no-op outside the CAVE
      notifyCaveMeetingIfChanged();
      // THE WORLD'S FOLEY, and the toucan's flight. Reads the state everything above just wrote — no
      // interaction, door or seat controller knows this exists.
      worldFoley(dt / 1000, { x: bp.x, z: bp.z });
      // PRESENTATION MODE, driven from the one place that sees every way in and out of the CAVE (the
      // portal, the GUI, the console driver). Both calls are idempotent early-returns: setActive
      // compares a boolean, sample() compares two numbers off the element, and the materials are only
      // touched when consumeChange says something really moved. No allocation on any frame.
      const insideCave = caveTransition?.inside ?? false;
      // CROSSING THE PORTAL CHANGES WHO IS VISIBLE, and it is not a roster event, so the edge is caught
      // here — beside the presentation switch that hides and shows the geometry for the same reason.
      // Edge-gated: this is a 60 Hz loop and a re-sync is a GLB pass.
      if (insideCave !== rosterInsideCave) syncRoster();
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
    crowd?.update(dt / 1000); // no-op until a stress scenario has spawned one
    // MIXERS, AND — Phase 6A — whatever walk each coworker is replaying. A room of standing people costs
    // exactly what it did before (their replay is null and the branch is not taken); a walking one costs a
    // segment lookup on a precomputed table per body. The return value says whether any transform changed,
    // and feeds the DYNAMIC shadow gate below — never the static redraw, because a coworker is a
    // registered dynamic caster and is hidden before the static pass draws.
    coworkersMoved = coworkers.update(dt / 1000);
    // The shadow map is only redrawn when something that casts one has moved (Renderer.invalidateShadows).
    // Anything the avatar does counts: walking, sitting, and the doors/chairs its interactions drive. Plant
    // sway is deliberately NOT a trigger — a frozen leaf shadow is invisible and it would defeat the point.
    framesSeen++;
    // The crowd casts shadows too, so a walking crowd invalidates the map exactly as the hero avatar does.
    // The counters are what the stress report's shadow-invalidation rate is read from.
    const worldStale = worldShadowsAreStale();
    // avatarShadowsAreStale() carries the pose bookkeeping, so it must run whether or not the world moved
    const avatarStale = params.avatar ? avatarShadowsAreStale() : false;
    if (worldStale || avatarStale) shadowRedraws++;
    if (worldStale) shadowStaticRedraws++;
    if (!stressFreezeShadows) {
      if (worldStale) R.invalidateShadows();
      else if (avatarStale) R.invalidateDynamicShadows();
    }
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
        caveState.liveCalls = caveLiveShare.state.broadcast || "—";
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
      const gs = graphics.status();
      graphicsState.mode = gs.mode;
      graphicsState.quality = gs.mode === "smooth" ? `rung ${gs.level}/3 · scale ${gs.settings.renderScale} · AO ${gs.settings.ambientOcclusion ? "on" : "off"} · shadows ${gs.settings.shadowMapSize}` : `scale ${gs.settings.renderScale} · AO ${gs.settings.ambientOcclusion ? "on" : "off"} · shadows ${gs.settings.shadows ? gs.settings.shadowMapSize : "off"}`;
      graphicsState.frame = gs.medianFrameMs === null ? "—" : `${gs.medianFrameMs.toFixed(1)} ms median`;
      graphicsState.last = gs.lastAdaptation ? `${gs.lastAdaptation.action} ${gs.lastAdaptation.from}→${gs.lastAdaptation.to} at ${gs.lastAdaptation.medianMs.toFixed(1)} ms` : "—";
      envState.clock = formatManila(timeOfDay.hourDecimal);
      envState.wind = env.wind.toFixed(2);
      envState.wetness = env.wetness.toFixed(2);
      envState.storm = env.storm.striking
        ? `${env.storm.nextIn.toFixed(0)}s (${env.storm.count} so far)`
        : "this weather does not strike";
      overlay.update(liveWindow.summary(), snapshotRenderer(R.renderer), device, `V2 · avatar ${params.avatar ? `LOD${params.avatarLod} · ${avatarState.triangles.toLocaleString()} tris · ${avatarState.clip} · owner ${stack.owner}` : "off"}\nrooms ${mirror.visibility.roomCount - mirror.visibility.culled}/${mirror.visibility.roomCount} drawn · ${mirror.visibility.culled} culled${params.roomCulling ? "" : " (culling off)"}\n${benchState.status}${lastCapture ? "\nlast: " + benchState.result : ""}`);
    }
  }
  loop();

  // ---- PERFORMANCE STRESS HARNESS (dev-only, measurement-only) -----------------------------------
  // Phase 1 measures; it does not optimise. Nothing below lowers a quality setting to make a number look
  // better: every scenario is forced back onto the approved FULL GRAPHICS state (preset A — SSAO on via
  // the approved depth reuse, shadows on, sway on — plus room culling, static batching and foliage
  // instancing, the approved DPR, and the environment/weather systems running) before it captures.
  //
  // The two A/B sub-captures each scenario takes exist to ATTRIBUTE cost, not to change it:
  //   • crowd hidden vs crowd visible  → what the avatars themselves cost, per body
  //   • shadow invalidation frozen vs live → what the movement → shadow-map-redraw path costs at scale
  // Both restore the approved state before the scenario result is written.
  const stressState = { status: "idle", scenario: "—", progress: "", lastResult: "" };
  let stressResults: ScenarioResult[] = [];

  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  /** two animation frames — long enough for a just-applied camera/visibility change to have been drawn */
  const nextFrames = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

  function stressCrowd(): Crowd {
    if (!crowd) { crowd = new Crowd(R.scene, playerStand); R.addDynamicCaster(crowd.group); }
    return crowd;
  }

  /** Every reconstructed room's floor rect, in a stable order. Rooms whose footprint is not walkable
   *  produce no candidates and drop out of the spread on their own. */
  const STRESS_ROOMS = [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB,
    EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM].map((r) => ({ id: r.id, rect: r.rect }));
  const stressPlacementDeps = () => ({ roomRects: STRESS_ROOMS, hubRect: CENTRAL_HUB.rect, caveRect: CAVE_FLOOR_RECT, canStand: playerStand });

  /** Put the world in (or out of) the CAVE, through the real portal transition rather than by teleporting
   *  the camera — the CAVE scenarios have to measure the same volume swap the product performs. */
  async function stressSetCave(inside: boolean): Promise<void> {
    const at = caveTransition?.inside ?? false;
    if (at === inside) {
      if (!inside && params.cameraMode !== "office") setCameraMode("office");
      return;
    }
    if (inside) {
      placeBonAtPortal();
      setCameraMode("player");
      placeBonAtPortal();
      caveTransition?.enter();
    } else {
      caveTransition?.exit();
    }
    await wait(900); // FADE_MS is 240 either side; 900 clears the whole state machine with margin
    if (!inside) setCameraMode("office");
  }

  /** FULL GRAPHICS, asserted rather than assumed. */
  function stressApplyFullGraphics(): void {
    // The capture has to happen at the approved benchmark whatever this machine's own preference says —
    // a number measured at an adapted rung measures the adaptation. The pin does NOT persist.
    graphics.pinMode("full");
    applyPreset("A");
    params.motion = false; // scripted camera motion off: the camera must not add variance to the capture
    if (!params.roomCulling) { params.roomCulling = true; refresh(); }
    if (!params.avatar) { params.avatar = true; avatar.root.visible = true; refresh(); }
    R.invalidateShadows();
  }

  function stressSceneSnapshot(): ScenarioResult["scene"] {
    const snap = snapshotRenderer(R.renderer);
    let visibleMeshes = 0;
    R.scene.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) visibleMeshes++; });
    return { visibleMeshes, drawCalls: snap.calls, triangles: snap.triangles, geometries: snap.geometries, textures: snap.textures, programs: snap.programs };
  }

  function stressMemory(): ScenarioResult["memory"] {
    const perf = performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } };
    const m = perf.memory;
    const mb = (v: number) => Math.round(v / 1048576);
    return m ? { jsHeapMb: mb(m.usedJSHeapSize), totalHeapMb: mb(m.totalJSHeapSize), limitMb: mb(m.jsHeapSizeLimit) } : { jsHeapMb: null, totalHeapMb: null, limitMb: null };
  }

  async function runStressScenario(sc: StressScenario, opts: { seconds?: number; attribution?: boolean } = {}): Promise<ScenarioResult> {
    const t0 = performance.now();
    const startedAt = new Date().toISOString();
    const seconds = opts.seconds ?? sc.seconds;
    const attribution = opts.attribution ?? true;
    const ab = Math.max(4, Math.round(seconds * 0.3)); // each A/B sub-capture, in seconds
    pageErrors.length = 0;
    stressState.status = "preparing";
    stressState.scenario = sc.label;
    refresh();

    stressApplyFullGraphics();
    await stressSetCave(sc.layout === "cave");
    if (sc.layout === "hub") focusOn(CENTRAL_HUB.rect, 0.92);
    else if (sc.layout === "distributed") setCameraMode("office");

    const c = stressCrowd();
    const spawns = planPlacements(sc.layout, sc.count, stressPlacementDeps());
    stressState.status = `loading ${sc.count} avatars…`;
    refresh();
    await c.spawn(spawns, { lod: params.avatarLod, labels: true, seed: 7 });
    R.markDynamicCaster(c.group); // the cloned bodies only exist now
    c.visible = true;
    c.roaming = sc.motion;
    R.invalidateShadows();
    await wait(1500); // let the GLB parse settle, the shadow map redraw, and the crossfades finish
    await nextFrames();

    shadowRedraws = 0; shadowStaticRedraws = 0; framesSeen = 0;
    R.shadowStats.staticPasses = 0; R.shadowStats.dynamicPasses = 0; R.shadowStats.fullPasses = 0; R.shadowStats.skipped = 0; R.shadowStats.frames = 0;
    stressState.status = `capturing ${seconds}s`;
    refresh();
    const frame = await runCapture(seconds);
    const scene = stressSceneSnapshot();
    const memory = stressMemory();
    const invalidationRate = framesSeen ? Math.round((shadowRedraws / framesSeen) * 1000) / 1000 : 0;
    const staticRedrawRate = framesSeen ? Math.round((shadowStaticRedraws / framesSeen) * 1000) / 1000 : 0;
    const shadowPasses = { ...R.shadowStats, cache: R.shadowCacheActive };

    // ---- attribution A: what do the avatars themselves cost? -------------------------------------
    let avatarCost: ScenarioResult["avatarCost"] = null;
    if (attribution && sc.count > 0) {
      c.visible = false;
      R.invalidateShadows();
      await wait(400);
      stressState.status = `A/B: crowd hidden (${ab}s)`;
      refresh();
      const hidden = await runCapture(ab);
      const hiddenSnap = stressSceneSnapshot();
      c.visible = true;
      R.invalidateShadows();
      await wait(400);
      stressState.status = `A/B: crowd visible (${ab}s)`;
      refresh();
      const withCrowd = await runCapture(ab);
      const withSnap = stressSceneSnapshot();
      const delta = Math.round((withCrowd.avgFrameMs - hidden.avgFrameMs) * 100) / 100;
      avatarCost = {
        hiddenFrameMs: hidden.avgFrameMs,
        crowdFrameMs: withCrowd.avgFrameMs,
        deltaMs: delta,
        perAvatarMs: Math.round((delta / sc.count) * 1000) / 1000,
        deltaCalls: withSnap.drawCalls - hiddenSnap.drawCalls,
        deltaTriangles: withSnap.triangles - hiddenSnap.triangles,
      };
    }

    // ---- attribution B: what does the movement → shadow-map invalidation path cost? ---------------
    let shadowCost: ScenarioResult["shadowCost"] = null;
    if (attribution) {
      stressFreezeShadows = true;
      await wait(300);
      stressState.status = `A/B: shadow redraw frozen (${ab}s)`;
      refresh();
      const frozen = await runCapture(ab);
      const frozenSnap = stressSceneSnapshot();
      stressFreezeShadows = false;
      R.invalidateShadows();
      await wait(300);
      stressState.status = `A/B: shadow redraw live (${ab}s)`;
      refresh();
      const live = await runCapture(ab);
      const liveSnap = stressSceneSnapshot();
      // THE SPLIT. The crowd keeps moving and keeps drawing; it only stops CASTING. What is left is the
      // static world being re-shadowed because an avatar moved — the half a static shadow cache could win.
      let staticOnly: CaptureSummary | null = null;
      if (sc.count > 0) {
        c.setCastShadow(false);
        R.invalidateShadows();
        await wait(300);
        stressState.status = `A/B: shadow redraw, static casters only (${ab}s)`;
        refresh();
        staticOnly = await runCapture(ab);
        c.setCastShadow(true);
        R.invalidateShadows();
        await wait(300);
      }
      const delta = Math.round((live.avgFrameMs - frozen.avgFrameMs) * 100) / 100;
      shadowCost = {
        invalidationRate,
        frozenFrameMs: frozen.avgFrameMs,
        liveFrameMs: live.avgFrameMs,
        deltaMs: delta,
        sharePct: live.avgFrameMs > 0 ? Math.round((delta / live.avgFrameMs) * 1000) / 10 : 0,
        staticOnlyFrameMs: staticOnly ? staticOnly.avgFrameMs : null,
        staticShareMs: staticOnly ? Math.round((staticOnly.avgFrameMs - frozen.avgFrameMs) * 100) / 100 : null,
        dynamicShareMs: staticOnly ? Math.round((live.avgFrameMs - staticOnly.avgFrameMs) * 100) / 100 : null,
        liveCalls: liveSnap.drawCalls, frozenCalls: frozenSnap.drawCalls,
        liveTriangles: liveSnap.triangles, frozenTriangles: frozenSnap.triangles,
        staticRedrawRate, cacheActive: shadowPasses.cache,
        staticPasses: shadowPasses.staticPasses, dynamicPasses: shadowPasses.dynamicPasses, fullPasses: shadowPasses.fullPasses, passFrames: shadowPasses.frames,
      };
    }
    stressFreezeShadows = false;

    const snap = snapshotRenderer(R.renderer);
    const result: ScenarioResult = {
      config: {
        id: sc.id, label: sc.label, avatars: sc.count + 1, layout: sc.layout, motion: sc.motion, seconds,
        lod: params.avatarLod, labels: true, preset: params.preset, ssao: params.ao, ssaoDepthReuse: R.ssaoReusesDepth,
        shadows: params.shadows, roomCulling: params.roomCulling, staticBatching: staticBatchingEnabled(),
        pixelRatio: snap.pixelRatio, drawingBuffer: snap.drawingBuffer,
        camera: `${params.cameraMode}${caveTransition?.inside ? " · inside CAVE" : ""}`,
        placed: c.size,
      },
      frame, scene, memory, avatarCost, shadowCost,
      errors: [...pageErrors],
      startedAt,
      durationMs: Math.round(performance.now() - t0),
    };
    stressState.status = "idle";
    stressState.lastResult = `${sc.label}: ${frame.avgFps} fps · 1% low ${frame.onePercentLowFps} · p95 ${frame.p95FrameMs} ms · calls ${frame.avgDrawCalls}`;
    refresh();
    return result;
  }

  async function runStressMatrix(opts: { seconds?: number; attribution?: boolean; only?: string[] } = {}): Promise<{ device: typeof device; results: ScenarioResult[]; markdown: string }> {
    const list = opts.only ? STRESS_MATRIX.filter((s) => opts.only!.includes(s.id)) : STRESS_MATRIX;
    stressResults = [];
    for (let i = 0; i < list.length; i++) {
      stressState.progress = `${i + 1}/${list.length}`;
      refresh();
      stressResults.push(await runStressScenario(list[i], opts));
    }
    await stressStop();
    stressState.progress = "done";
    refresh();
    return { device, results: stressResults, markdown: markdownTable(stressResults) };
  }

  /** Put the page back exactly as the product leaves it: no crowd, no frozen shadows, OFFICE camera. */
  async function stressStop(): Promise<void> {
    if (crowd) { R.removeDynamicCaster(crowd.group); crowd.clear(); crowd.group.removeFromParent(); }
    crowd = null;
    stressFreezeShadows = false;
    await stressSetCave(false);
    stressApplyFullGraphics();
    R.invalidateShadows();
    stressState.status = "idle";
    stressState.scenario = "—";
    refresh();
  }

  const stressGui = gui.addFolder("Stress (dev-only · measurement)");
  stressGui.add({ go: () => void runStressScenario(STRESS_MATRIX[4]) }, "go").name("▶ 70 distributed");
  stressGui.add({ go: () => void runStressScenario(STRESS_MATRIX[5]) }, "go").name("▶ 70 Central Hub");
  stressGui.add({ go: () => void runStressScenario(STRESS_MATRIX[6]) }, "go").name("▶ 70 CAVE");
  stressGui.add({ go: () => void runStressScenario(STRESS_MATRIX[7]) }, "go").name("▶ 70 CAVE + motion");
  stressGui.add({ go: () => void runStressMatrix() }, "go").name("▶▶ run the whole matrix");
  stressGui.add({ go: () => void stressStop() }, "go").name("■ stop + restore");
  stressGui.add(stressState, "status").disable().listen();
  stressGui.add(stressState, "scenario").disable().listen();
  stressGui.add(stressState, "progress").disable().listen();
  stressGui.add(stressState, "lastResult").name("last").disable().listen();
  stressGui.close();

  // dev console / test-driver surface (same shape as the prototype's __designRoom3d where it matters)
  (window as unknown as { __vo3d: unknown }).__vo3d = {
    world, plan, walkability, mirror, R, scene: R.scene, camera: R.camera, renderer: R.renderer, params, stack, avatar, avatarState, navCtl,
    placeCamera: applyCam, placeLight: applyLight, focusOn,
    /** ROOM-LEVEL CULLING, for the console and the A/B rig. `setEnabled(false)` is the BEFORE state. */
    visibility: {
      system: mirror.visibility,
      setEnabled: (on: boolean) => { params.roomCulling = on; if (!on) mirror.visibility.restoreAll(); R.invalidateShadows(); refresh(); },
      enabled: () => params.roomCulling,
      culled: () => mirror.visibility.culled,
      rooms: () => mirror.visibility.roomCount,
      states: () => mirror.visibility.states(),
      hidden: () => mirror.visibility.hiddenIds(),
      /** meshes actually submitted this frame — what culling is supposed to move */
      visibleMeshes: () => { let n = 0; R.scene.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) n++; }); return n; },
    },
    /** STATIC BATCHING, for the console and the A/B rig. Build-time, so the switch is `?batch=0` + reload. */
    batching: { enabled: staticBatchingEnabled, stats: () => mirror.batching },
    /** SSAO DEPTH REUSE (slice 4), same shape: construction-time, so the switch is `?ao=legacy` + reload.
     *  Reported here so an A/B capture can record WHICH path produced it rather than trusting the URL. */
    ssaoDepthReuse: { enabled: ssaoDepthReuseEnabled, live: () => R.ssaoReusesDepth },
    bench: { device, applyPreset, runCapture, snapshot: () => snapshotRenderer(R.renderer), live: () => liveWindow.summary(), summarize, sceneStats: () => sceneStats(R.scene) },
    /** PHASE 4B VERIFICATION SURFACE — read-only, and the one place a multi-tab check reads coworker
     *  geometry from. `positions()` gives each rendered body's DISPLAY NAME, world x/z, the yaw it is
     *  looking along (Phase 6B: whether a diagonal walk kept its heading is a question about rotation)
     *  and whether that spot came from V1's live persisted position or from the derived desk. No email,
     *  no roster row, nothing derived from the session; the DOM readout in app/Vo3dHost.tsx stays
     *  counts-only for the same reason. Nothing here can write: there is no setter, and the world itself never emits. */
    coworkers: {
      stats: () => coworkers.getStats(),
      positions: () => coworkers.positions(),
      count: () => coworkers.size,
      /** PHASE 6A — is anybody replaying a walk right now, and how many. Counts only, like everything
       *  else on this surface; `positions()` already reports where each body IS, live, as it walks. */
      walking: () => coworkers.getStats().walking,
      /** how many peer bodies are mid-jump right now — the two-browser check's readout */
      airborne: () => coworkers.airborneCount,
      /** DEV: drive a peer jump locally, without a second browser. Same entry point the relay uses. */
      jump: (email: string) => coworkers.jump(email),
      moving: () => coworkers.moving,
      /** PHASE 6C — how many peers sit in a chair this world identified; `positions()` names the anchor. */
      seated: () => coworkers.getStats().seated,
      /** PHASE 6B DIAGNOSTIC — the last few arrival facing decisions: the route's own final heading, what
       *  that quantises to, what V1 published, whether the two agreed and the yaw the body was given.
       *  Bounded to the last 8, anonymous (angles and compass points only) and read-only. This is what a
       *  two-session check reads to tell "the gate refused" apart from "the gate never ran". */
      facingTrace: () => facingTrace(),
      /** PHASE 6D VERIFICATION SURFACE — the PRODUCTION entry points, not a test-only copy of them.
       *  `select` is what a click and PLAYER mode's interact key both call, `anchor` is what the host's
       *  own card reads every frame, and `approach` is the world's one Phase 6D verb. A scripted check
       *  drives these so it exercises the real path instead of guessing where a raycast will land. */
      interact: {
        select: (email: string) => {
          const who = coworkers.within(avatar.position, Number.POSITIVE_INFINITY).find((c) => c.email === email);
          if (!who) return false;
          selectCoworker({ email: who.email, displayName: who.displayName });
          return true;
        },
        clear: () => selectCoworker(null),
        selected: () => selectedCoworker,
        anchor: (email: string) => coworkerAnchor(email),
        approach: (email: string) => approachCoworker(email),
        /** whether an approach is in flight, and whether it has reached the turn */
        approaching: () => (coworkerApproach ? { email: coworkerApproach.email, turning: coworkerApproach.turning } : null),
        /** DIAGNOSTIC DRIVER — put self into a named conversation pose through the PRODUCTION entry point,
       *  so a clip can be looked at without arranging a two-browser session first. Read the result back
       *  with `clips()`. Null returns the body to its ordinary idle. */
      pose: (clip: string | null) => {
        selfConversationClip = clip;
        playerMode.setConversationClip(clip);
      },
      /** THE CONVERSATION POSES, live: what clip each rendered body is actually playing, plus self's.
       *  Read-only, and the one way to tell "the gesture clip is missing from this GLB" apart from
       *  "nobody is in a conversation". */
      clips: () => ({
        peers: coworkers.restingClips(),
        self: avatar.currentClip ?? "",
        selfWanted: selfConversationClip,
        selfOwner: stack.owner,
        selfListen: avatar.clipDebug(CLIP_TALK_LISTEN),
        selfAgree: avatar.clipDebug(CLIP_TALK_AGREE),
      }),
      /** PART 1 — how many baked 3D nameplate sprites are still visible. Must be 0 whenever a host owns
       *  the overheads, or a character carries two labels. Read-only. */
      spriteLabels: () => coworkers.visibleLabelCount(),
      /** PHASE 7A PARITY — the office camera's live framing, for a focus check. Read-only. */
      camera: () => ({ zoom: R.camera.zoom, target: { x: R.controls.target.x, z: R.controls.target.z }, tweening: camTween !== null }),
      /** what PLAYER mode would score this frame — ids and labels only */
        candidates: () => coworkerCandidates().map((c) => ({ id: c.id, label: c.label })),
      },
    },
    /** PHASE 5 VERIFICATION SURFACE — the counters, and the ONE driver a two-session check needs.
     *
     *  `walkTo` is the PRODUCTION click-to-walk entry point: the very same walkToGround the canvas's
     *  pointerup handler calls, with the same planner, the same ownership rules and the same publishing.
     *  It exists here so a V1↔V2 check can drive a real planned walk to a known cell deterministically
     *  instead of guessing where a raycast will land — there is no test-only movement path, and adding one
     *  is exactly what "do not create a competing movement system" rules out.
     *
     *  Everything else is read-only. `v1Position` is the same conversion the sink publishes through, so a
     *  check can compare what V2 believes against what V1's own store received. */
    selfMovement: {
      publishing: selfMovement !== undefined,
      state: () => (selfMovement ? { ...selfMovement.state, wire: [...selfMovement.state.wire] } : null),
      /** What actually went on the wire, newest last — shapes only, never a coordinate. */
      wire: () => (selfMovement ? [...selfMovement.state.wire] : []),
      restored: () => selfRestored,
      walkTo: (x: number, z: number) => walkToGround(x, z),
      /** PHASE 6C — the PRODUCTION sit entry point (the same bridge a chair click and the E key use), and
       *  what the feed currently holds: the anchor the body is in or heading for, whether the seated
       *  arrival has gone out, and how many sits were refused as occupied. */
      sit: (anchorId: string) => {
        const { entityId } = parseSeatAnchorId(anchorId);
        if (!world.entities.has(entityId)) return false;
        const e = world.get(entityId);
        return activateInteractable(entityId, e.capabilities.seat ? "seat" : e.capabilities.lounge ? "lounge" : "approach");
      },
      standUp: () => engagedSeat()?.stand(),
      seat: () => ({ ...seatSyncState, feedSeated: selfFeed?.isSeated ?? false, otherSeat: otherSeat?.state ?? "none", facing: currentSeatAnchor ? seatFacingFor(currentSeatAnchor) : null }),
      /** PHASE 6C — the dev tool's verbs, for a scripted check: set a seat's facing and read the table. */
      setSeatFacing: (anchorId: string, facing: SeatFacing) => setSeatFacingOverride(anchorId, facing),
      seatFacingTable: () => seatFacingTable(),
      position: () => ({ ...avatar.position }),
      v1Position: () => toV1Frame(avatar.position),
      /** PHASE 6B DIAGNOSTICS — the signed-in employee's OWN body, for comparison with how a peer's
       *  `coworkers.positions()` row for the same person reads: exact yaw, the movement id last
       *  published (first 8 chars, as the wire log prints it) and the clip playing. Read-only. */
      yaw: () => avatar.yaw,
      movementId: () => selfMovement?.state.movementId?.slice(0, 8) ?? null,
      clip: () => avatar.currentClip ?? "",
    },
    /** PHASE 5 ACCESS SURFACE — read-only, plus the one setter a two-session check needs in order to
     *  exercise the boundary without a real check-out. `setAccess` is the SAME entry point app/Vo3dHost
     *  pushes V1's answer through: it does not decide attendance, it delivers an answer, so a test driving
     *  it is driving the production path rather than a test-only one. V1's own service stays the only
     *  thing that can produce that answer in a real session. */
    access: {
      state: () => ({ ...accessState }),
      zoneAt: (x: number, z: number) => zoneOf({ x, z }),
      gateCells: () => gateCells.map((c) => ({ ...c })),
      mayPlaceAt: (x: number, z: number) => mayPlaceAt({ x, z }),
      setAccess: (a: OfficeAccess) => setOfficeAccess(a),
      exit: () => ({ ...exitState }),
    setExitAuthorized,
      exitCells: () => exitCells.map((c) => ({ ...c })),
      aiLab: () => ({ ...aiLabState }),
    },
    /** PERFORMANCE STRESS PHASE 1 — the dev-only client/render load harness and its scenario matrix.
     *  Everything here is inert until called: no crowd exists, and nothing about the product page changes.
     *  Driven from the console or from scripts/vo3d/stress.mjs. Measurement only — see the block above
     *  `runStressScenario` for why each sub-capture exists and what it restores. */
    stress: {
      matrix: STRESS_MATRIX,
      state: stressState,
      run: (id: string, opts?: { seconds?: number; attribution?: boolean }) => {
        const sc = STRESS_MATRIX.find((s) => s.id === id);
        return sc ? runStressScenario(sc, opts) : Promise.reject(new Error(`no stress scenario "${id}"`));
      },
      runAll: (opts?: { seconds?: number; attribution?: boolean; only?: string[] }) => runStressMatrix(opts),
      results: () => stressResults,
      markdown: () => markdownTable(stressResults),
      stop: () => stressStop(),
      /** spawn a crowd without capturing — for eyeballing a layout before trusting its numbers */
      spawn: async (layout: "distributed" | "hub" | "cave", count: number, motion = false) => {
        stressApplyFullGraphics();
        await stressSetCave(layout === "cave");
        const c = stressCrowd();
        await c.spawn(planPlacements(layout, count, stressPlacementDeps()), { lod: params.avatarLod, labels: true, seed: 7 });
        R.markDynamicCaster(c.group);
        c.roaming = motion;
        R.invalidateShadows();
        return c.stats();
      },
      crowd: () => crowd,
      stats: () => crowd?.stats() ?? null,
      members: () => crowd?.info() ?? [],
      placements: (layout: "distributed" | "hub" | "cave", count: number) => planPlacements(layout, count, stressPlacementDeps()),
      setLabels: (on: boolean) => crowd?.setLabels(on),
      /** the live shadow-map invalidation rate since the counters were last reset */
      shadows: () => ({ frames: framesSeen, redraws: shadowRedraws, staticRedraws: shadowStaticRedraws, rate: framesSeen ? shadowRedraws / framesSeen : 0, frozen: stressFreezeShadows }),
      /** THE SPLIT SHADOW UPDATE, for the A/B rig: `setCache(false)` is the BEFORE state, live. */
      shadowCache: {
        enabled: () => R.shadowCache, active: () => R.shadowCacheActive,
        setCache: (on: boolean) => { R.shadowCache = on; params.shadowCache = on; R.invalidateShadows(); refresh(); },
        stats: () => ({ ...R.shadowStats }),
        resetStats: () => { R.shadowStats.staticPasses = 0; R.shadowStats.dynamicPasses = 0; R.shadowStats.fullPasses = 0; R.shadowStats.skipped = 0; R.shadowStats.frames = 0; },
      },
      resetShadowCounters: () => { framesSeen = 0; shadowRedraws = 0; shadowStaticRedraws = 0; },
      /** THE DOOR STALENESS RULE, for the A/B rig: `setLegacy(true)` is the BEFORE state (a door is
       *  stale for its whole open hold), live and reversible. Measurement only — see doorStaleLegacy. */
      doorStale: {
        legacy: () => doorStaleLegacy,
        setLegacy: (on: boolean) => { doorStaleLegacy = on; R.invalidateShadows(); },
        moving: () => [door, entryDoor, gamingDoor, execDoor, cmsDoor, aiDoor, devDoor, qaDoor].filter((d) => d.moved).length,
      },
      /** THE SEAT/APPROACH STALENESS RULE, same rig, same meaning: `setLegacy(true)` is the BEFORE
       *  state, in which any non-idle seat or approach holds the whole static world stale. */
      interactionStale: {
        legacy: () => interactionStaleLegacy,
        setLegacy: (on: boolean) => { interactionStaleLegacy = on; R.invalidateShadows(); },
        movingChairs: () => [seat, meetingSeat, gamingSeat, hubSeat, execSeat, cmsSeat, aiSeat, devSeat, qaSeat].filter((c) => c?.moved).length,
      },
      errors: () => [...pageErrors],
      device,
      visibleMeshes: () => stressSceneSnapshot().visibleMeshes,
      memory: () => stressMemory(),
    },
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
    // dev-only; null unless ?monkey=1
    monkey: monkey ? {
      avatar: monkey, state: monkey.state, root: monkey.root,
      visible: () => monkey.visible,
      setMoving: (v: boolean) => monkey.setMoving(v),
      hasClip: (n: string) => monkey.hasClip(n),
      dress: () => monkey.dress(), undress: () => monkey.undress(), dressed: () => monkey.dressed,
      warmEyes: () => monkey.warmEyes(), restoreEyes: () => monkey.restoreEyes(),
      position: () => ({ x: monkey.root.position.x, y: monkey.root.position.y, z: monkey.root.position.z }),
    } : null,
    setCameraMode,
    /** dev-only camera helper: frame an arbitrary world rect (used to look at the Lab) */
    focusRect: (rect: { x: number; z: number; w: number; d: number }, fill = 0.9) => focusOn(rect, fill),
    toucan: {
      bird: toucan, state: toucan.state, root: toucan.root,
      position: () => toucan.position, flying: () => toucan.flying,
      reset: (u?: number) => toucan.reset(u),
      /** step the flight deterministically from a test/console, bypassing the render loop */
      step: (dt: number) => toucan.update(dt, env.weather, env.phase ?? "day", env.presentation === "world" && !(caveTransition?.inside ?? false)),
      // PHASE 7G — drive the summon from a test or the console. `call`/`release` are the real handlers the
      // button and the model click use, so there is nothing test-only about the path being exercised.
      call: callToucan, release: releaseToucan, summonState: () => toucan.summonState,
      summoned: () => toucan.summonActive,
      /** the park anchor the loop would write this frame, for stepping a summon without a render loop */
      aim: (at: Vec2 | null) => toucan.setSummonTarget(at),
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

  // ---- LIFECYCLE: teardown -----------------------------------------------------------------------
  /** Tear the world down. Idempotent — the second call and every one after it is a no-op.
   *
   *  ORDER. Consumers first, resources they consume last, and the RENDERER DEAD LAST: its dispose()
   *  force-loses the WebGL context, and anything released afterwards would be releasing objects belonging
   *  to a context that no longer exists. The generic `disposers` stack (listeners registered through
   *  onWindow/onDocument/onCanvas) unwinds in reverse registration order for the same reason.
   *
   *  WHAT IS DELIBERATELY NOT TOUCHED. The scene is never walked. V2's geometries, materials and textures
   *  come from process-lifetime module caches that hand the SAME objects to every world ever built
   *  (render/Materials' materials map, render/detail's texture cache, build/helpers' sphereGeo/unitCyl,
   *  build/plants' leafGeo, build/exterior's puddleAlpha, the module-level GLTFLoaders). Freeing them here
   *  would leave the NEXT mount rendering with dead materials; they are meant to outlive any one world and
   *  their cost is bounded at one cache total, not one per mount. See render/Renderer.dispose. */
  function dispose(): void {
    if (disposed) return;
    disposed = true;               // every async continuation above checks this before touching anything
    roomLocks.clear();
    cancelAnimationFrame(rafHandle); // the frame already asked for; the guard in loop() stops it re-arming

    // PHASE 5 FIRST, and before anything is torn down: the movement socket is V1's module-level singleton
    // and OUTLIVES this world, so this is the last chance to resolve a movement still in flight. Without
    // it, leaving the route would leave the previous leg's arrival unsent and the employee's durable
    // position one leg stale — a position V1 would then restore them to. Touches no scene object.
    selfFeed?.dispose();

    // PLAYER first: it owns window/document key + pointer-lock listeners and a document.body HUD, none of
    // which belong to the canvas and so none of which die with the context.
    playerMode.dispose();
    // The editor's panel is another document.body child, and the gizmo is scene-side.
    editPanel?.dispose();
    editPanel = null;
    editGizmo.dispose();
    // The season's own groups, geometry and materials. It owns everything it made and nothing it did
    // not, so this is a removal rather than a restore — see season/SeasonLayer.dispose.
    seasonLayer?.dispose();
    // Dev-only bodies, present only when a stress scenario or `?monkey=1` asked for them.
    crowd?.clear(); // Crowd's teardown is clear(): it disposes every member's clone, textures included
    R.removeDynamicCaster(coworkers.group);
    coworkers.dispose(); // bodies, mixers and nameplate canvases; the shared prototypes outlive the world
    monkey?.dispose();
    avatar.dispose();
    toucan.dispose();
    // CAVE media: <video> elements parked on document.body, a LiveKit subscription, and their textures.
    caveTransition?.dispose();
    caveGallery.dispose();
    cavePresentation.dispose();
    caveLiveShare.dispose();
    caveMedia.dispose();
    // Audio: stops every source, disconnects every node, closes the AudioContext and unbinds the
    // document-level gesture listeners it armed itself with.
    unsubscribeAmbient();
    unsubscribeEnvironment();
    envAudio.dispose();
    // The graphics controller is subscribed to the SHARED preferences store (services/render) — that
    // subscription outlives this world unless it is cancelled.
    graphics.dispose();
    // DOM chrome this world put on the page.
    overlay.dispose();
    gui.destroy();
    // Everything registered through onWindow/onDocument/onCanvas, newest first.
    for (let i = disposers.length - 1; i >= 0; i--) disposers[i]();
    disposers.length = 0;
    // LAST. Frees the composer, the shadow targets, the PMREM environment, OrbitControls and the WebGL
    // context itself. The canvas cannot be reused afterwards — a remount needs a fresh one.
    R.dispose();
  }

  /** THE ONE-SHOT V1 POSITION RESTORE — see Vo3dWorld.restoreSelf for the contract.
   *
   *  Modelled on the home-desk spawn above and refusing for the same reasons: V1 decided WHERE (in V1
   *  coordinates), V2 decides where that is in the world it actually built (one room-shift table) and
   *  whether a BODY FITS there (placeNear, judged by the same stand test as every WASD step). A position
   *  with nothing legal within six body radii is refused rather than forced, and the home desk stands.
   *
   *  It also CLEARS ANY QUEUED WALK. Restoring a body while the planner still holds waypoints would have
   *  the walker immediately drag it back toward a route planned from the old position. */
  function restoreSelf(point: Vec2, facing: Facing, seatAnchor?: string, place?: string): boolean {
    if (disposed || selfRestored || selfMovedByUser) return false;
    const target = homeDeskWorldPoint(point, selfFrameRooms, ROOM_WORLD_SHIFT_Z);
    // A PERSISTED POSITION IS NOT A PERMISSION. V1 keeps employee_positions whatever attendance says, so
    // an employee who checked out at their desk still has an office position on file — restoring it would
    // be the one bypass that needs no walking at all. Refused while the gate is shut, and HELD rather
    // than spent when the answer is merely `unknown`: the read usually resolves to a confirmed check-in a
    // moment later, and that employee's own desk is then exactly where they belong.
    if (!mayPlaceAt(target)) {
      if (officeAccess === "unknown") pendingRestore = { point, facing, ...(seatAnchor ? { seat: seatAnchor } : {}), ...(place ? { place } : {}) };
      avatarState.spawn = `${avatarState.spawn} · V1 position is inside the working office (attendance ${officeAccess})`;
      return false;
    }
    // PHASE 6C — SEATED RESTORE. V1 says this employee is sitting in a chair the mapping identified: land
    // in it already seated (SeatInteraction.restoreSeated / LoungeSeatInteraction.restoreSeated), behind
    // the SAME access gate the standing restore just passed — a persisted seat is no more a permission
    // than a persisted position. Silent to the feed (placed, seated) exactly as the standing restore is.
    // A chair this world cannot seat the body in falls through to the standing restore at the centroid.
    // PHASE 7D — RESTORED INTO THE CAVE. V1 holds a named place beside the position for this employee,
    // and peers already read it (adapters/v1CoworkerPositions) — so before this, a reload put the person
    // back at the portal while every other browser correctly drew them inside, and the two views
    // disagreed about a fact that was on the wire all along.
    //
    // `point` is still the real in-frame position V1 holds, so the ACCESS GATE above has already run
    // against it: a persisted place is no more a permission than a persisted position, and an employee
    // who may not be in the office may not be restored into its Cave either.
    //
    // NOTHING ELSE IS RESUMED. Being in the Cave and being in a meeting are separate facts and only the
    // first is persisted, so this starts no meeting, joins no call, publishes no media and changes no
    // attendance. An UNKNOWN place name falls through to the ordinary restore below, which is exactly
    // what happened before any of this existed.
    if (place === CAVE_PLACE_ID && caveTransition) {
      // Seed the feed with the IN-FRAME point first, silently. The body is about to be somewhere V1
      // cannot describe, and the feed's boundary publish re-states the place FROM its last in-frame
      // sample — which has to be this portal, not the Cave position it is about to hold.
      selfFeed?.placed(target);
      if (caveTransition.restoreInside()) {
        selfRestored = true;
        navCtl.setPath([]);
        if (playerMode.active) playerMode.camera.snap();
        avatarState.spawn = "restored from V1 · inside the Championship Cave";
        R.invalidateShadows();
        return true;
      }
      // Could not land in there: fall through and restore in the office, which is still true of them.
    }
    if (seatAnchor && restoreIntoSeat(seatAnchor)) {
      selfRestored = true;
      navCtl.setPath([]);
      currentSeatAnchor = seatAnchor;
      selfSeatedPublished = true;
      const wp = avatar.worldPosition();
      selfFeed?.placed({ x: wp.x, z: wp.z }, true);
      if (playerMode.active) playerMode.camera.snap();
      avatarState.spawn = `restored from V1 · seated in ${seatAnchor}`;
      R.invalidateShadows();
      return true;
    }
    if (!playerMode.body.placeNear(target)) {
      avatarState.spawn = `${avatarState.spawn} · V1 position at ${target.x.toFixed(1)}, ${target.z.toFixed(1)} has no standable point`;
      return false;
    }
    selfRestored = true;
    navCtl.setPath([]);
    const placed = playerMode.body.pos;
    avatar.setPosition(placed);
    // A PLACEMENT, NOT A MOVEMENT — and the feed has to be told, or the jump from the desk preview to
    // here is published as a walk to the position V1 already holds (a revision bump and a DB write for
    // no new fact, with placeNear's clearance nudge overwriting V1's own number). See Feed.placed.
    selfFeed?.placed(placed);
    avatar.setYaw(FACING_YAW[facing]);
    if (playerMode.active) playerMode.camera.snap();
    avatarState.spawn = `restored from V1 · ${placed.x.toFixed(1)}, ${placed.z.toFixed(1)} facing ${facing}`;
    R.invalidateShadows(); // a body moved; the cached depth has it in the old place
    return true;
  }

  /** Construct the right interaction for `anchor` and put the body in it seated. False when this world
   *  has no such chair or the avatar could not be acquired. */
  function restoreIntoSeat(anchor: string): boolean {
    const { entityId, slotId } = parseSeatAnchorId(anchor);
    if (!world.entities.has(entityId) || !mirror.hasView(entityId)) return false;
    const e = world.get(entityId);
    const planner = (to: Vec2): NavResult => planWalk(avatar.position, to, walkability, inBounds);
    clearSeats();
    if (slotId === undefined) {
      const spec = e.capabilities.seat;
      if (!spec) return false;
      const si = new SeatInteraction(avatar, stack, mirror.view(entityId), seatSpecFor(entityId), planner, () => params.walkSpeed);
      if (!si.restoreSeated()) return false;
      restoredSeat = si;
      return true;
    }
    const slot = e.capabilities.lounge?.slots.find((s2) => s2.id === slotId);
    if (!slot) return false;
    const li = new LoungeSeatInteraction(avatar, stack, mirror.view(entityId), slotFor(entityId, slot), planner, () => params.walkSpeed);
    if (!li.restoreSeated()) return false;
    restoredLounge = li;
    return true;
  }

  // PART 6 — applied once, after every folder above has been added, so hiding the rig hides all of it.
  applyDevToolsVisible();

  return {
    dispose,
    restoreSelf,
    setInteractionPromptHidden: (hidden: boolean) => playerMode.setPromptHidden(hidden),
    setOfficeAccess,
    setExitAuthorized,
    setDepartureDestination,
    setLockedRooms,
    authorizeRoomEntry,
    setOccupiedSeats: (ids) => {
      occupiedSeatIds = new Set(ids);
      seatSyncState.occupied = occupiedSeatIds.size;
    },
    standUp: () => engagedSeat()?.stand(),
    // Fire-and-forget: sync() loads GLBs, and a caller in a React effect has nothing useful to await.
    // Its own generation guard drops a load that lands after a newer roster, and its disposed guard drops
    // one that lands after the world is gone.
    setCoworkers: (list, missingAvatar) => {
      // PHASE 7D — PEOPLE WHO ARE IN THE CAVE. The feed says so by NAME (`place`), because the CAVE is
      // outside V1's coordinate frame and no `point` can mean "in there". This is the one place that
      // knows what the name refers to — it owns the geometry — so it resolves the name to a real world
      // position here and hands the placer a `worldPoint` it can use directly.
      //
      // …AND ONLY THE ONES IN THIS VOLUME are handed on — see syncRoster. The list is remembered rather
      // than consumed, because the answer also changes when the VIEWER crosses the portal, which is not
      // a roster event.
      rosterList = list;
      rosterMissingAvatar = missingAvatar;
      syncRoster();
    },
    setCoworkerInteractions: (handlers) => {
      coworkerInteractions = handlers;
      // A HOST OWNS THE NAMEPLATES. Its DOM overhead layer draws V1's presence pill — dot, short name,
      // detail label — and replaces it with a bubble or typing dots; a baked sprite can do none of that.
      // Unsubscribing hands them straight back, so the standalone dev page is untouched.
      coworkers.setLabelsVisible(handlers === null);
      // Unsubscribing drops any selection with it: the host that would have been told about it is gone.
      if (!handlers) selectedCoworker = null;
    },
    peerJumped: (email, ageMs = 0) => coworkers.jump(email, ageMs),
    setConversationPoses: (byEmail, self) => {
      coworkers.setConversationClips(byEmail);
      selfConversationClip = self;
      // PLAYER MODE drives its own clips every frame, so it cannot be told through the idle-gated line in
      // the render loop — it is handed the pose and picks it as its own resting clip instead. Walking and
      // sprinting still outrank it there, exactly as they do everywhere else.
      playerMode.setConversationClip(self);
    },
    setGlobalChatActive: (emails, self) => {
      coworkers.setGlobalChatActive(emails);
      // The signed-in employee's own body. Held on the Avatar rather than in the seat interactions
      // because it is a fact about the PERSON: every seat already asks for CLIP_SIT and gets the right
      // clip back without knowing this exists (avatar/Avatar.ts's resolveClip).
      avatar.setGlobalChatActive(self);
    },
    setDevToolsVisible: (on) => {
      devToolsVisible = on;
      applyDevToolsVisible();
    },
    devToolsVisible: () => devToolsVisible,
    caveMeeting: {
      subscribe: (listener) => {
        caveMeetingListeners.add(listener);
        listener(readCaveMeeting());
        return () => caveMeetingListeners.delete(listener);
      },
      // ONE ENTRY POINT, and it is create-or-join because that is what the server does: everybody who
      // asks for CAVE_MEETING_ID gets the same room, and the first arrival mints it. The client is not
      // told whether it created or joined — see the Phase 7C notes.
      start: async (email: string) => {
        await caveLiveShare.connect(email);
        await caveLiveShare.startMeeting();
        notifyCaveMeetingIfChanged();
      },
      setMic: async (on: boolean) => { await caveLiveShare.setMic(on); notifyCaveMeetingIfChanged(); },
      setCamera: async (on: boolean) => { await caveLiveShare.setCamera(on); notifyCaveMeetingIfChanged(); },
      setSharing: async (on: boolean) => { await caveLiveShare.setSharing(on); notifyCaveMeetingIfChanged(); },
      leave: () => { caveLiveShare.leave(); notifyCaveMeetingIfChanged(); },
      invite: (email: string) => { caveLiveShare.invite(email); },
      enter: () => caveTransition?.enter() ?? false,
      observe: async (email: string) => {
        await caveLiveShare.connect(email);
        notifyCaveMeetingIfChanged();
      },
    },
    subscribeDevTools: (listener) => {
      devToolsListeners.add(listener);
      listener(devToolsVisible);
      return () => devToolsListeners.delete(listener);
    },
    requestPointerLock: () => { if (playerMode.active) playerMode.requestPointerLock(); },
    subscribeLockState: (listener) => {
      lockStateListeners.add(listener);
      listener(playerMode.pointerLocked, playerMode.unlockedLook);
      return () => lockStateListeners.delete(listener);
    },
    setViewMode: (mode) => {
      if (params.cameraMode === mode) return;
      setCameraMode(mode);
      refresh();
    },
    setPlayerView: (view) => {
      if (!playerMode.active || params.playerView === view) return;
      params.playerView = view;
      playerMode.setView(view);
      notifyPlayerView();
      refresh();
    },
    subscribePlayerView: (listener) => {
      playerViewListeners.add(listener);
      listener(params.playerView);
      return () => playerViewListeners.delete(listener);
    },
    subscribeViewMode: (listener) => {
      viewModeListeners.add(listener);
      // Told at once: a host that subscribes after the world was built would otherwise sit on its own
      // default until the next mode change, which may never come.
      listener(params.cameraMode as Vo3dViewMode);
      return () => viewModeListeners.delete(listener);
    },
    exitPlayerMode: () => {
      if (playerMode.active) setCameraMode("office");
    },
    selectCoworkerByEmail: (email) => {
      // The same `within` read the pointer path and PLAYER targeting use, unbounded — Search is a
      // name lookup across the whole office, not a reach check.
      const who = coworkers.within(avatar.position, Number.POSITIVE_INFINITY).find((c) => c.email === email);
      if (!who) return false;
      // A host-driven selection is still a selection, so it drops the room the same way a click on a body
      // does — one world selection at a time, whichever surface made it.
      selectRoom(null);
      selectCoworker({ email: who.email, displayName: who.displayName });
      return true;
    },
    restoreCameraView,
    coworkerAnchor,
    coworkerAnchors,
    selfAnchor: () => (avatar.root.visible ? selfAnchor() : null),
    zoneAt: (x, z) => zoneOf({ x, z }),
    toucanAnchor,
    // PHASE 7G. The intent, and V1's own coarse state pushed out as it changes — the host opens the
    // assistant on ARRIVAL, exactly as V1's office does.
    toucanSummon: {
      call: callToucan,
      release: releaseToucan,
      state: () => toucan.summonState,
      subscribe: (listener: (state: ToucanSummonState) => void) => {
        toucanListeners.add(listener);
        listener(toucan.summonState); // once immediately, so a subscriber never has to guess
        return () => { toucanListeners.delete(listener); };
      },
    },
    roomLabelIds: () => labelRects.map((r) => r.roomId),
    roomLabelAnchors: () => {
      const out: Record<string, Vo3dRoomLabelAnchor> = {};
      for (const [roomId, point] of labelPoints) out[roomId] = roomLabelAnchor(roomId, point);
      return out;
    },
    setRoomHighlight,
    currentRoomId: () => playerRoomId(),
    setSelectedRoom: (roomId) => {
      if (roomId === selectedRoom) return;
      selectedRoom = roomId;
      frameRoom(roomId);
    },
    clearCoworkerSelection: () => {
      // The host already closed its card, so it is not told again — this only resyncs the world's idea of
      // what is selected. Same one-way shape as every other host->world write on this interface.
      selectedCoworker = null;
    },
    approachCoworker,
  };
}
