// vo3d world — THE MONKEYAGENT PRODUCTION CONTRACT (P0). Pure data, no THREE, no import.meta, so the
// asset build script (scripts/avatar-pipeline/monkey-agent/build-monkey-proof.mjs, run by Node with type
// stripping), the runtime and the tests all read ONE copy.
//
// WHAT IS LOCKED HERE, and why each part exists:
//   · PROPORTIONS — the current approved monkey master (public/avatars/monkey-base-v1) IS the visual and
//     dimensional reference. Every landmark below was measured off that file in bind space (native units,
//     the export is 1.700 tall, +z is the face, y up). A rebuilt base must land on these within tolerance;
//     the rebuild is technical (topology, weights, face, texture masks), never a redesign.
//   · HEIGHT — 36 world units, the same as an employee (adapters/v1Avatar BON_STANDING_HEIGHT). LOCKED
//     2026-10-01. The reference sheet's ~14-unit "70 cm monkey" reading is rejected.
//   · SKELETON — the EMPLOYEE 24-joint contract (names, order, hierarchy), so a monkey is just another
//     character to CastPrototypes / SkeletonUtils / CHARACTER_ANIM_STATES. Bone AXES are not part of the
//     contract — every employee has its own bind — which is why clips are retargeted onto the monkey's own
//     bind, once, offline, and then shared by every monkey identity.
//   · REGIONS + SOCKETS — the two seams modular appearance needs: garments declare which body regions they
//     hide, rigid accessories hang off named sockets authored once in bind space.
//   · IDENTITY ≠ ASSIGNMENT ≠ EXECUTION STATE — three records with three owners. Animation is a DERIVED
//     presentation of execution state, never a source of truth for it.

// ---- proportions -----------------------------------------------------------------------------------

/** Visible standing height in world units. LOCKED: equal to an employee. */
export const MONKEY_AGENT_STANDING_HEIGHT = 36;
/** Native (bind-space) height of the reference master and of every derivative. */
export const MONKEY_NATIVE_HEIGHT = 1.7;

export type Landmark = { at: readonly [number, number, number]; tol: number; note: string };

/** Bind-space joint positions of the reference master, under CONTRACT names. Tolerance 0.01 native
 *  (~0.2 world units): a rebuilt base that drifts further has changed the character. */
export const MONKEY_JOINT_LANDMARKS: Readonly<Record<string, Landmark>> = {
  Hips: { at: [-0.007, 0.445, -0.007], tol: 0.01, note: "pelvis — low, chibi" },
  Spine02: { at: [-0.007, 0.534, -0.016], tol: 0.01, note: "lowest spine" },
  Spine01: { at: [-0.007, 0.624, -0.025], tol: 0.01, note: "mid spine" },
  Spine: { at: [-0.007, 0.716, -0.034], tol: 0.01, note: "chest" },
  neck: { at: [-0.007, 0.773, -0.04], tol: 0.01, note: "neck root" },
  Head: { at: [-0.007, 0.841, -0.047], tol: 0.01, note: "head pivot — head is ~54% of height" },
  LeftArm: { at: [0.154, 0.733, -0.036], tol: 0.01, note: "shoulder" },
  RightArm: { at: [-0.165, 0.744, -0.035], tol: 0.01, note: "shoulder" },
  LeftForeArm: { at: [0.356, 0.703, -0.036], tol: 0.01, note: "elbow" },
  LeftHand: { at: [0.55, 0.7, -0.032], tol: 0.01, note: "wrist — short chibi arm" },
  LeftUpLeg: { at: [0.085, 0.399, -0.007], tol: 0.01, note: "hip joint, INSIDE the belly" },
  LeftLeg: { at: [0.147, 0.216, 0.028], tol: 0.01, note: "knee ≈ crotch height" },
  LeftFoot: { at: [0.161, 0.095, 0.019], tol: 0.01, note: "ankle" },
};

/** Surface landmarks (bind space) the face, garments and sockets are fitted against. */
export const MONKEY_SURFACE_LANDMARKS = {
  /** total height incl. the head tuft */
  height: 1.7,
  /** legs separate below this — the visible leg is almost all shin */
  crotchY: 0.24,
  /** head shell bottom (chin) at the body axis */
  chinY: 0.79,
  /** painted+sculpted eye ellipse, per eye (x mirrored), projected on the xy plane */
  eye: { cx: 0.18, cy: 1.112, rx: 0.102, ry: 0.11, frontZ: 0.334 },
  /** painted smile, centre and half-width */
  mouth: { cx: 0, cy: 0.958, halfWidth: 0.083, frontZ: 0.4 },
  /** ears are part of the head (Head-bound), not a swappable piece */
  ears: { xMin: 0.42, xMax: 0.662, yMin: 0.87, yMax: 1.278 },
  /** the head tuft — what hats hide */
  tuftY: 1.45,
  /** face front plane at eye height, muzzle peak */
  faceZ: 0.346,
  muzzleZ: 0.42,
  /** the tail lives behind this plane, or outboard of tailX on the +x side */
  tailZ: -0.185,
  tailX: 0.235,
} as const;

/** Head-to-height ratio, measured from the neck joint to the crown. Chibi: ~0.54 (Bon ~0.55). */
export const MONKEY_HEAD_RATIO = { value: (1.7 - 0.773) / 1.7, tol: 0.02 } as const;

// ---- skeleton ----------------------------------------------------------------------------------------

/** The EMPLOYEE 24-joint contract, in the employee skin's own joint order (bon-v3 LOD GLBs). */
export const MONKEY_SKELETON_JOINTS = [
  "Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot",
  "RightToeBase", "Spine02", "Spine01", "Spine", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand", "neck", "Head", "head_end", "headfront",
] as const;
export type MonkeyJoint = (typeof MONKEY_SKELETON_JOINTS)[number];

/** Parent of every contract joint (null = skeleton root). Same tree as the employees. */
export const MONKEY_SKELETON_PARENTS: Readonly<Record<MonkeyJoint, MonkeyJoint | null>> = {
  Hips: null, LeftUpLeg: "Hips", LeftLeg: "LeftUpLeg", LeftFoot: "LeftLeg", LeftToeBase: "LeftFoot",
  RightUpLeg: "Hips", RightLeg: "RightUpLeg", RightFoot: "RightLeg", RightToeBase: "RightFoot",
  Spine02: "Hips", Spine01: "Spine02", Spine: "Spine01", LeftShoulder: "Spine", LeftArm: "LeftShoulder",
  LeftForeArm: "LeftArm", LeftHand: "LeftForeArm", RightShoulder: "Spine", RightArm: "RightShoulder",
  RightForeArm: "RightArm", RightHand: "RightForeArm", neck: "Spine", Head: "neck", head_end: "Head",
  headfront: "Head",
};

/** The reference master's Mixamo names → contract names. NOTE the spine runs the other way round:
 *  Meshy's employee Spine02 is the LOWEST spine bone and Spine the chest. */
export const MASTER_TO_CONTRACT_JOINT: Readonly<Record<string, MonkeyJoint>> = {
  "mixamorig:Hips": "Hips", "mixamorig:Spine": "Spine02", "mixamorig:Spine1": "Spine01",
  "mixamorig:Spine2": "Spine", "mixamorig:Neck": "neck", "mixamorig:Head": "Head",
  "mixamorig:HeadTop_End": "head_end", headfront: "headfront",
  "mixamorig:LeftShoulder": "LeftShoulder", "mixamorig:LeftArm": "LeftArm",
  "mixamorig:LeftForeArm": "LeftForeArm", "mixamorig:LeftHand": "LeftHand",
  "mixamorig:RightShoulder": "RightShoulder", "mixamorig:RightArm": "RightArm",
  "mixamorig:RightForeArm": "RightForeArm", "mixamorig:RightHand": "RightHand",
  "mixamorig:LeftUpLeg": "LeftUpLeg", "mixamorig:LeftLeg": "LeftLeg", "mixamorig:LeftFoot": "LeftFoot",
  "mixamorig:LeftToeBase": "LeftToeBase", "mixamorig:RightUpLeg": "RightUpLeg",
  "mixamorig:RightLeg": "RightLeg", "mixamorig:RightFoot": "RightFoot",
  "mixamorig:RightToeBase": "RightToeBase",
};
/** End joints the master carries beyond the contract, and the contract joint their weight folds into. */
export const MASTER_DROPPED_JOINTS: Readonly<Record<string, MonkeyJoint>> = {
  "mixamorig:LeftHandMiddle4": "LeftHand", "mixamorig:RightHandMiddle4": "RightHand",
  "mixamorig:LeftToe_End": "LeftToeBase", "mixamorig:RightToe_End": "RightToeBase",
};

/** The clip contract: every MonkeyAgent base carries exactly the employee clip names
 *  (render3d/characterAnimationState CHARACTER_ANIM_STATES — a test locks the two lists together). */
export const MONKEY_CLIP_CONTRACT = [
  "idle-9", "walking", "running", "agree-gesture", "listening-gesture", "sit-on-chair-arms",
  "sitting-answering",
] as const;

// ---- body regions (clothing hiding) -------------------------------------------------------------------

/** One id per body vertex, baked as the `_REGION` vertex attribute. A garment declares the regions it
 *  covers; the body discards exactly those, so nothing underneath can poke through. The eye/mouth/tuft
 *  ids exist so the face shells and hats can find their geometry; for hiding they are part of the head. */
export const BODY_REGIONS = {
  HEAD: 0, TUFT: 1, EARS: 2, EYE_L: 3, EYE_R: 4, MOUTH: 5, NECK: 6, CHEST: 7, BELLY: 8, PELVIS: 9,
  TAIL: 10, UPPERARM_L: 11, UPPERARM_R: 12, FOREARM_L: 13, FOREARM_R: 14, HAND_L: 15, HAND_R: 16,
  LEG_L: 17, LEG_R: 18, FOOT_L: 19, FOOT_R: 20,
} as const;
export type BodyRegion = keyof typeof BODY_REGIONS;

/** WHERE THE REGIONS END — clean analytic cut lines in bind space (the arms are horizontal in bind, so
 *  arm cuts are |x| planes). Garments are authored to cover whole regions PLUS a margin past these lines
 *  (GARMENT_COVER_MARGIN), which is what guarantees the discarded body is always under cloth. */
export const REGION_CUTS = {
  /** BELLY above, PELVIS below */
  waistY: 0.42,
  /** CHEST above, BELLY below */
  chestY: 0.58,
  /** UPPERARM inboard, FOREARM outboard (elbow is 0.356) */
  upperArmX: 0.29,
  /** FOREARM inboard, HAND outboard (wrist is 0.55) */
  wristX: 0.535,
  /** NECK: inside this ellipse, above y */
  neck: { y: 0.72, rx: 0.17, rz: 0.15, cz: -0.03 },
} as const;
export const GARMENT_COVER_MARGIN = 0.02;

/** A 32-bit hide mask for the body shader. */
export function regionMask(regions: readonly BodyRegion[]): number {
  let m = 0;
  for (const r of regions) m |= 1 << BODY_REGIONS[r];
  return m >>> 0;
}

// ---- accessory sockets -------------------------------------------------------------------------------

/** A rigid attach point, authored ONCE in bind space against the locked base. `position`/`rotation`
 *  (XYZ euler, radians) are in native model units; the runtime converts them into the bone's local frame
 *  through the bone's own inverse bind matrix, so an accessory sits right whatever pose it is attached in. */
export type Socket = { bone: MonkeyJoint; position: readonly [number, number, number]; rotation: readonly [number, number, number] };

export const MONKEY_SOCKETS = {
  /** centre between the ears at ear height — headphones */
  ears: { bone: "Head", position: [0, 1.08, -0.03], rotation: [0, 0, 0] },
  /** crown, just in front of the tuft — caps, beanies */
  headTop: { bone: "Head", position: [0, 1.42, 0], rotation: [0, 0, 0] },
  /** between the eyes on the face plane — glasses */
  face: { bone: "Head", position: [0, 1.112, 0.36], rotation: [0, 0, 0] },
  /** chest front — badges */
  chest: { bone: "Spine", position: [0.08, 0.66, 0.17], rotation: [0, 0, 0] },
  /** between the shoulder blades — backpacks */
  back: { bone: "Spine", position: [0, 0.6, -0.19], rotation: [0, 0, 0] },
  /** the floating work screen a working agent types on / reads (shown only by the work layers) */
  screen: { bone: "Spine", position: [0, 0.6, 0.44], rotation: [-0.95, 0, 0] },
  /** palm centres — tablets, tools */
  handL: { bone: "LeftHand", position: [0.63, 0.69, -0.03], rotation: [0, 0, 0] },
  handR: { bone: "RightHand", position: [-0.63, 0.69, -0.03], rotation: [0, 0, 0] },
} as const satisfies Record<string, Socket>;
export type SocketName = keyof typeof MONKEY_SOCKETS;

// ---- budgets -----------------------------------------------------------------------------------------

/** Production budgets for MonkeyAgent_Base_V1 and its parts (triangles; textures in px). `face` is per
 *  LOD (eyes + mouth shells) — the sculpted eye bulges need ~700 triangles to stay above the body. */
export const MONKEY_BUDGETS = {
  body: { lod0: 35_000, lod1: 12_000, lod2: 4_000 },
  garmentPerAgent: 6_000,
  accessoriesPerAgent: 2_000,
  face: 1_100,
  bodyTexture: 2048,
  garmentTexture: 1024,
  /** body + face + ≤2 garments + ≤2 accessories */
  drawsPerAgent: 6,
} as const;

// ---- the production base (P2) -----------------------------------------------------------------------

/** MonkeyAgent_Base_V1's LODs: triangle targets and the MAXIMUM surface deviation from the untouched
 *  reference master each may show (native units; 0.01 ≈ 0.2 world units). Every LOD vertex is an
 *  original master vertex, so bind, UVs and weights carry over exactly. LOD2 is held to the safest
 *  range the UV seams allow rather than forced to 4k. */
export const MONKEY_BASE_LODS = [
  { name: "lod0", triangles: 35_000, maxDeviation: 0.01, face: true },
  // LOD1 keeps every UV seam (collapsing across them speckled the face plate with fur texels); the
  // master's seams floor it near 15k inside its deviation budget, so that is its honest target
  { name: "lod1", triangles: 15_000, maxDeviation: 0.05, face: true },
  { name: "lod2", triangles: 6_500, maxDeviation: 0.08, face: false },
] as const;
/** LOD by ON-SCREEN body height in CSS px (works for the ortho and the perspective camera alike). */
export const MONKEY_LOD_SCREEN_PX = { lod0Above: 260, lod1Above: 110 } as const;
/** Per-vertex marking channels (`_MARKS` vec3), soft 0..1: two painted by identity colours at runtime,
 *  plus `keep` — the painted face details (nose, brows, mouth line) that no fur tint may touch. */
export const MONKEY_MARKS = ["crown", "muzzle", "keep"] as const;
/** Mask texture channels (masks.png): fur weight, skin weight (face/belly/ears/palms/soles), dark detail. */
export const MONKEY_MASK_CHANNELS = { fur: "r", skin: "g", dark: "b" } as const;
/** The albedo's own reference colours (sRGB), measured: recolouring maps these onto an identity's tints
 *  and keeps every painted variation around them. An identity with no tint renders the master exactly. */
export const MONKEY_ALBEDO_REF = { fur: 0x914c25, skin: 0xf9d6bb } as const;

// ---- identity / assignment / execution state -----------------------------------------------------------

/** WHO the monkey is. Permanent; survives every project and role. Appearance is data on top of the ONE
 *  shared base — nothing here is a mesh. */
export type MonkeyIdentity = {
  id: string;
  /** what the pill says on its first line, e.g. "MILO" */
  name: string;
  look: {
    /** fur/face tints (sRGB hex); undefined = the base texture's own colour */
    fur?: number;
    face?: number;
    /** marking colours (MONKEY_MARKS); undefined = no marking */
    marks?: { crown?: number; muzzle?: number };
    iris: number;
    /** accessory accent colour (headset cups, etc.) */
    accent?: number;
    garments: readonly string[];
    accessories: readonly { item: string; socket: SocketName }[];
  };
};

/** WHAT the monkey is doing for whom right now. Changes per project; owned by the orchestrator. */
export type AgentAssignment = { agentId: string; role: string; projectId?: string; taskTitle?: string };

/** THE EXECUTION STATE — reported by the backend (Agent Harness; mocked for the demo). The ONLY source
 *  of truth for whether a monkey is working. */
export type AgentExecState =
  | "idle" | "assigned" | "working" | "reviewing" | "awaiting-approval" | "changes-requested" | "done"
  | "blocked";

export const EXEC_STATE_LABEL: Readonly<Record<AgentExecState, string>> = {
  idle: "IDLE", assigned: "ASSIGNED", working: "WORKING", reviewing: "REVIEWING",
  "awaiting-approval": "AWAITING APPROVAL", "changes-requested": "CHANGES REQUESTED", done: "DONE",
  blocked: "BLOCKED",
};

/** pill dot colour per execution state (the Lab's own palette where it has one) */
export const EXEC_STATE_COLOR: Readonly<Record<AgentExecState, string>> = {
  idle: "#8a96a8", assigned: "#5b8def", working: "#2376e5", reviewing: "#e5a43a",
  "awaiting-approval": "#9b6bdf", "changes-requested": "#e5793a", done: "#3cae6b", blocked: "#d9534f",
};

export type FaceExpression = "neutral" | "happy" | "focused" | "surprised" | "sleepy";

export type AgentPosture = "standing" | "seated";

const FACE_FOR: Readonly<Record<AgentExecState, FaceExpression>> = {
  idle: "neutral", assigned: "happy", working: "focused", reviewing: "focused", "awaiting-approval": "neutral",
  "changes-requested": "surprised", done: "happy", blocked: "surprised",
};

/** PRESENTATION, DERIVED from execution state (plus where the body physically is) — one way only.
 *  Nothing reads this back as state. Clips are contract clip names; dedicated typing/thinking clips
 *  arrive with the production base (P2) and slot in here without touching the state model. */
export function presentationFor(
  exec: AgentExecState,
  posture: AgentPosture = "standing",
): { clip: (typeof MONKEY_CLIP_CONTRACT)[number]; face: FaceExpression; overlay?: "typing" | "reviewing" } {
  const face = FACE_FOR[exec];
  if (posture === "seated") {
    if (exec === "working") return { clip: "sitting-answering", face, overlay: "typing" };
    if (exec === "reviewing") return { clip: "sitting-answering", face, overlay: "reviewing" };
    return { clip: "sit-on-chair-arms", face };
  }
  // WORKING = the free procedural typing layer over the idle (P2 decision: no paid clips)
  if (exec === "working") return { clip: "idle-9", face, overlay: "typing" };
  if (exec === "done" || exec === "assigned") return { clip: "agree-gesture", face };
  // REVIEWING = the procedural review layer (reading a work screen, scrolling) over the idle
  if (exec === "reviewing") return { clip: "idle-9", face, overlay: "reviewing" };
  return { clip: "idle-9", face };
}

// ---- the floating name pill ------------------------------------------------------------------------------

/** Agents ride the EXISTING employee overhead pill (app/Vo3dOverheads). Their rows are keyed with this
 *  prefix — never an email, never the self/toucan keys — and anchored to the monkey's own head. */
export const AGENT_OVERHEAD_PREFIX = "__agent__:";
export const agentOverheadKey = (agentId: string): string => `${AGENT_OVERHEAD_PREFIX}${agentId}`;
export const isAgentOverheadKey = (key: string): boolean => key.startsWith(AGENT_OVERHEAD_PREFIX);

/** The pill's status payload (Vo3dOverhead.status): line one the identity, line two role · state.
 *  Task text is deliberately absent — that belongs to the click interaction, not the pill. */
export function agentPillStatus(
  identity: Pick<MonkeyIdentity, "name">,
  assignment: Pick<AgentAssignment, "role"> | null,
  exec: AgentExecState,
): { color: string; shortName: string; detail: string } {
  const state = EXEC_STATE_LABEL[exec];
  return {
    color: EXEC_STATE_COLOR[exec],
    shortName: identity.name.toUpperCase(),
    detail: assignment?.role ? `${assignment.role.toUpperCase()} · ${state}` : state,
  };
}
