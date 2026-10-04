// vo3d human — THE HUMANBASE_V1 CONTRACT: what every modular VO employee is built on.
//
// DEV-ONLY PROOF (`human-base.html?humanbase=1`). Nothing in production reads this yet.
//
// ONE BASE, MANY PEOPLE. HumanBase_V1 is the physical/animation/interaction capability; an employee's look is
// a configuration of slots worn over it (identity head, hair, top, bottom, shoes, glasses, accessories). The
// base is built ONCE from Alex v2 (scripts/avatar-pipeline/human-base/build-human-base.mjs): Alex's approved
// proportions, scale, reach and standing idle, with his identity (head, beard, glasses) removed.
//
// Every number here is in NATIVE units (1.70 tall, y up, +z is the face, +x is the body's LEFT), the bind is
// the contract's T-pose, and the build scripts import this module so the asset and the runtime cannot drift.
// Node imports this file directly (type stripping), so it imports nothing and touches no `import.meta`.
//
// WHY ONE SKELETON IS ENOUGH (measured 2026-10-02): all 7 approved Alex clips carry translation tracks that
// equal the rest offsets (≤ 6e-5) and unit scale on every bone but Hips, so the shared library is
// rotation-only + Hips translation, and joint offsets can be standardised without touching a single key.

export const HUMAN_BASE_VERSION = "human-base-v1" as const;
export const HUMAN_NATIVE_HEIGHT = 1.7;
/** world units, the same as every employee (adapters/v1Avatar BON_STANDING_HEIGHT) */
export const HUMAN_STANDING_HEIGHT = 36;
export const HUMAN_WORLD_SCALE = HUMAN_STANDING_HEIGHT / HUMAN_NATIVE_HEIGHT;

// ---- skeleton --------------------------------------------------------------------------------------------

/** The 24 Meshy joints, in order — the shared clip library targets these names and only these. */
export const HUMAN_CORE_JOINTS = [
  "Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot",
  "RightToeBase", "Spine02", "Spine01", "Spine", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand", "neck", "Head", "head_end", "headfront",
] as const;

/** HAND ARTICULATION, appended after the core so no clip index moves: two segments each for the thumb, the
 *  index finger and the joined middle/ring/little fingers. No clip carries a track for them, so every shared
 *  clip still plays exactly as before (they rest straight); only the procedural hand layer curls them. */
export const HUMAN_HAND_JOINTS = [
  "LeftThumb1", "LeftThumb2", "LeftIndex1", "LeftIndex2", "LeftFingers1", "LeftFingers2",
  "RightThumb1", "RightThumb2", "RightIndex1", "RightIndex2", "RightFingers1", "RightFingers2",
] as const;

export const HUMAN_SKELETON_JOINTS = [...HUMAN_CORE_JOINTS, ...HUMAN_HAND_JOINTS] as const;
export type HumanJoint = (typeof HUMAN_SKELETON_JOINTS)[number];

export const HUMAN_SKELETON_PARENTS: Readonly<Record<HumanJoint, HumanJoint | null>> = {
  Hips: null, LeftUpLeg: "Hips", LeftLeg: "LeftUpLeg", LeftFoot: "LeftLeg", LeftToeBase: "LeftFoot",
  RightUpLeg: "Hips", RightLeg: "RightUpLeg", RightFoot: "RightLeg", RightToeBase: "RightFoot",
  Spine02: "Hips", Spine01: "Spine02", Spine: "Spine01", LeftShoulder: "Spine", LeftArm: "LeftShoulder",
  LeftForeArm: "LeftArm", LeftHand: "LeftForeArm", RightShoulder: "Spine", RightArm: "RightShoulder",
  RightForeArm: "RightArm", RightHand: "RightForeArm", neck: "Spine", Head: "neck", head_end: "Head",
  headfront: "Head",
  LeftThumb1: "LeftHand", LeftThumb2: "LeftThumb1", LeftIndex1: "LeftHand", LeftIndex2: "LeftIndex1",
  LeftFingers1: "LeftHand", LeftFingers2: "LeftFingers1",
  RightThumb1: "RightHand", RightThumb2: "RightThumb1", RightIndex1: "RightHand", RightIndex2: "RightIndex1",
  RightFingers1: "RightHand", RightFingers2: "RightFingers1",
};

export type Side = "L" | "R";
export const SIDE_PREFIX: Readonly<Record<Side, "Left" | "Right">> = { L: "Left", R: "Right" };
export type Digit = "Thumb" | "Index" | "Fingers";
export const DIGITS: readonly Digit[] = ["Thumb", "Index", "Fingers"];

/** the mirror partner of a joint name (centre joints map to themselves) */
export function mirrorJoint(j: string): string {
  if (j.startsWith("Left")) return `Right${j.slice(4)}`;
  if (j.startsWith("Right")) return `Left${j.slice(5)}`;
  return j;
}

// ---- body regions ----------------------------------------------------------------------------------------

/** The base body's surface regions. A worn garment HIDES whole regions (the fragment shader discards them),
 *  so nothing under clothing can poke through in any pose. The base has no head: identity always supplies it. */
export const BODY_REGIONS = {
  NECK: 0, CHEST: 1, BELLY: 2, PELVIS: 3, UPPERARM_L: 4, UPPERARM_R: 5, FOREARM_L: 6, FOREARM_R: 7,
  HAND_L: 8, HAND_R: 9, THIGH_L: 10, THIGH_R: 11, SHIN_L: 12, SHIN_R: 13, FOOT_L: 14, FOOT_R: 15,
} as const;
export type BodyRegion = keyof typeof BODY_REGIONS;

export function regionMask(regions: readonly BodyRegion[]): number {
  let m = 0;
  for (const r of regions) m |= 1 << BODY_REGIONS[r];
  return m >>> 0;
}

/** Where regions end, in bind space. Arms are horizontal in bind, so arm cuts are |x| planes. Garments cover
 *  whole regions plus GARMENT_COVER_MARGIN past these lines. */
export const REGION_CUTS = {
  /** torso ↔ upper arm (the shoulder joint is at |x| 0.20) */
  shoulderX: 0.215,
  /** upper arm ↔ forearm (elbow 0.375) */
  elbowX: 0.375,
  /** forearm ↔ hand (wrist 0.57) */
  wristX: 0.565,
  /** neck ↔ chest */
  neckY: 0.735,
  /** chest ↔ belly */
  chestY: 0.6,
  /** belly ↔ pelvis */
  waistY: 0.5,
  /** pelvis ↔ thigh */
  crotchY: 0.36,
  /** thigh ↔ shin: the shin is a clean procedural limb below this line (Alex's trouser legs are not skin) */
  thighY: 0.24,
  /** shin ↔ foot: everything below lives inside a shoe */
  ankleY: 0.1,
} as const;
export const GARMENT_COVER_MARGIN = 0.03;

/** V1 dress code: these slots are mandatory, so the regions under them never need real anatomy. */
export const MANDATORY_SLOTS = ["top", "bottom", "shoes"] as const;

// ---- sockets ---------------------------------------------------------------------------------------------

/** A rigid attach point authored ONCE in bind space. The runtime turns it into bone-local through the bone's
 *  inverse bind matrix, so attaching mid-animation is exact. `rotation` is XYZ euler (radians). */
export type Socket = { bone: HumanJoint; position: readonly [number, number, number]; rotation: readonly [number, number, number] };

/** Hand frames are measured from the base's own hand vertices (build-human-base prints them; a test checks
 *  the built GLB against these). In bind the palm faces DOWN (−y) and the fingers point outward (±x). */
export const HAND_FRAMES = {
  /** centre of a closed fist's channel — a handle, a mug, a phone body sits here */
  grip: { bone: "Hand", position: [0.635, 0.703, 0.008] },
  /** centre of the palm surface — flat contact: a high five, a pat, a tray, the packet's underside */
  palm: { bone: "Hand", position: [0.628, 0.693, 0.005] },
  /** between the thumb tip and the index tip — a card, a cup handle, a dart */
  pinch: { bone: "Index2", position: [0.69, 0.705, 0.07] },
  /** the index fingertip — keys, buttons, touch screens */
  tip: { bone: "Index2", position: [0.735, 0.712, 0.031] },
} as const satisfies Record<string, { bone: string; position: readonly [number, number, number] }>;
export type HandFrame = keyof typeof HAND_FRAMES;

/** a hand frame's joint for one side (`Hand` → `LeftHand`, `Index2` → `LeftIndex2`) */
export const handJoint = (side: Side, bone: string): HumanJoint => `${SIDE_PREFIX[side]}${bone}` as HumanJoint;
/** a hand frame's bind position for one side (the contract stores the LEFT hand; the right mirrors x) */
export function handFramePosition(side: Side, f: HandFrame): [number, number, number] {
  const [x, y, z] = HAND_FRAMES[f].position;
  return [side === "L" ? x : -x, y, z];
}

export const HUMAN_SOCKETS = {
  /** glasses: the bridge of the nose — identities publish their own (see IdentityLandmarks); this is the base's
   *  default when an identity does not */
  face: { bone: "Head", position: [0, 1.1, 0.4], rotation: [0, 0, 0] },
  /** headphones: centre between the ears at ear height */
  ears: { bone: "Head", position: [0, 1.08, 0], rotation: [0, 0, 0] },
  /** caps: the crown */
  headTop: { bone: "Head", position: [0, 1.6, 0], rotation: [0, 0, 0] },
  /** badges */
  chest: { bone: "Spine", position: [0.09, 0.66, 0.16], rotation: [0, 0, 0] },
  /** backpacks */
  back: { bone: "Spine", position: [0, 0.62, -0.17], rotation: [0, 0, 0] },
  /** the future Toucan perch on the left forearm (documented; the proportions do not allow a full-size bird yet) */
  perchL: { bone: "LeftForeArm", position: [0.47, 0.77, 0], rotation: [0, 0, 0] },
} as const satisfies Record<string, Socket>;
export type SocketName = keyof typeof HUMAN_SOCKETS;

// ---- identity --------------------------------------------------------------------------------------------

/** What an identity head publishes about itself, in base bind space (written into the head GLB's extras by its
 *  build). Face shells, glasses and look-at all read these, so a future employee inherits facial life without
 *  per-person animation. */
export type IdentityLandmarks = {
  /** eye centres (left first), the half-size of each eye opening, and the eye plane's outward normal */
  eyes: { l: [number, number, number]; r: [number, number, number]; halfW: number; halfH: number; lashTop?: number };
  mouth: { c: [number, number, number]; halfW: number };
  /** glasses bridge */
  bridge: [number, number, number];
  /** a point in front of the face the head looks along at rest */
  forward: [number, number, number];
  /** sampled skin tone (sRGB hex) — the body takes this unless the configuration overrides it */
  skin: string;
  iris: string;
};

/** The envelope every identity head must sit in (base bind space). Checked by the identity build and tests. */
export const HEAD_ENVELOPE = {
  /** the head is rigid on Head above this line; below it the neck stub hides inside the base neck */
  neckCutY: 0.755,
  /** eye line band — production Alex's eyes sit at 1.178 (the canonical skull, alex-neutral-head-v1) */
  eyeY: [0.98, 1.22] as const,
  eyeFrontZ: [0.25, 0.5] as const,
  maxHalfWidth: 0.47,
} as const;

// ---- shared animation ------------------------------------------------------------------------------------

/** ONE shared clip library, baked into the base GLB once. An employee never carries clips. */
export const HUMAN_CLIPS = [
  "idle-masculine", "idle-feminine", "walking", "running", "agree-gesture", "listening-gesture",
  "sit-on-chair-arms", "sitting-answering",
] as const;
export type HumanClip = (typeof HUMAN_CLIPS)[number];
export type IdleProfile = "masculine" | "feminine";
export const idleClip = (p: IdleProfile): HumanClip => (p === "feminine" ? "idle-feminine" : "idle-masculine");

// ---- the reach envelope ----------------------------------------------------------------------------------

/** Measured on the base (Phase 1, Alex): what a chibi arm can and cannot reach. Behaviours are authored inside
 *  these; anything outside is a design problem, not an IK problem. */
export const REACH = {
  /** shoulder → palm centre, arm straight */
  arm: 0.46,
  /** shoulder → mouth: 0.10 beyond reach — drinking is a stylised beat (cup at the chin, head dips) */
  mouth: 0.56,
  /** shoulder → own crown: unreachable — a head pat is a future interaction design problem */
  crown: 0.98,
  /** forearm perch needs the mid-forearm 0.33 outside the head silhouette; the base gives 0.05 */
  perchClearanceNeeded: 0.33,
  perchClearance: 0.05,
} as const;

// ---- editable appearance ---------------------------------------------------------------------------------

export type AppearanceSlot = "identity" | "hair" | "top" | "bottom" | "shoes" | "glasses" | "accessory";

/** One catalogue entry. `hides` is the base regions it covers; `socket` places a rigid item. */
export type AppearanceAsset = {
  id: string;
  slot: AppearanceSlot;
  label: string;
  url: string;
  hides?: readonly BodyRegion[];
  socket?: SocketName | "identity-face";
  /** named colourways the asset's material understands (a swap that needs no new file) */
  colorways?: Readonly<Record<string, { main: string; trim?: string; accent?: string }>>;
  /** how far a garment stands off the skin of the regions it hides (native units) — the body-clearance envelopes grow
   *  by it, so a hand resting at the side clears the HOODIE, not just the skin under it */
  thickness?: number;
  /** identity heads belong to ONE employee and are never offered to anyone else */
  ownerEmployeeId?: string;
};

/** THE AVATAR CONFIGURATION — appearance only. The employee's identity/profile record (name, email, role)
 *  lives elsewhere and is referenced by `employeeId`; changing any slot here never touches it, the rig or the
 *  animation library. This is what a future Profile → Edit Avatar writes. */
export type BodyPreset = "standard" | "feminine";
export type EmployeeAvatar = {
  employeeId: string;
  base: typeof HUMAN_BASE_VERSION;
  /** bumped on every saved change (optimistic concurrency for the future editor) */
  version: number;
  /** the head (the shared canonical head for every new employee) + this employee's identity parameters on it */
  identity: { headAssetId: string; skinTone?: string; params?: IdentityParams };
  hair: { assetId: string | null; color?: string };
  idleProfile: IdleProfile;
  /** the HumanBase BODY PRESET (same skeleton, clips, sockets and contract — only the body surface differs) */
  bodyPreset?: BodyPreset;
  top: { assetId: string; colorway?: string };
  bottom: { assetId: string; colorway?: string };
  shoes: { assetId: string; colorway?: string };
  glasses: { assetId: string | null };
  accessories: readonly { assetId: string }[];
};

// ---- identity parameters (the canonical head) ---------------------------------------------------------------

/** The canonical head's bounded shape controls (glTF morph targets, each −1…+1). Every module fitted to the head
 *  (face shells, hair, glasses) carries the same morphs, so the whole head follows. */
export const SHAPE_CONTROLS = ["faceWidth", "jawWidth", "chinLength", "cheekFull", "noseSize", "noseWidth", "noseLength", "forehead", "earSize", "lipFull"] as const;
export type ShapeControl = (typeof SHAPE_CONTROLS)[number];

/** IDENTITY = PARAMETERS on the shared head. Everything is bounded; nothing here is geometry or a texture. */
export type IdentityParams = {
  shape: Record<ShapeControl, number>;
  /** eyes, drawn by the shared face layer. spacing/tilt/size in eye units (a fraction of the eye's half width) */
  eyes: { scale: number; spacing: number; openness: number; lidRest: number; tilt: number; iris: string; irisSize: number; crease: number };
  brows: { height: number; thickness: number; arch: number; tilt: number; length: number; gap: number; color: string };
  /** offset: the mouth's height (−1 lower … +1 higher, ±0.025 native); smile: corner lift; line: 0 = filled lips … 1 =
   *  a drawn smile line (illustrated faces); under: a short lower-lip mark beneath it */
  lips: { width: number; upper: number; lower: number; bow: number; color: string; offset?: number; smile?: number; line?: number; under?: number };
  nose: { nostril: number };
  cheeks: { blush: number };
  facialHair: { stubble: number; mustache: number; chin: number; color: string };
  skin: string;
};
export const PARAM_RANGES = {
  shape: [-1, 1], eyes: { scale: [0.8, 1.15], spacing: [-0.35, 0.6], openness: [0.45, 1.15], lidRest: [0, 0.45], tilt: [-0.25, 0.25], irisSize: [0.8, 1.15], crease: [0, 1] },
  brows: { height: [-1, 1], thickness: [0.4, 1.6], arch: [-0.5, 1], tilt: [-1, 1], length: [0.7, 1.4], gap: [-2.5, 1] },
  lips: { width: [0.75, 2], upper: [0.3, 1.5], lower: [0.3, 1.6], bow: [0, 1], offset: [-1, 1], smile: [-0.5, 1], line: [0, 1], under: [0, 1] }, nose: { nostril: [0, 1] }, cheeks: { blush: [0, 1] },
  facialHair: { stubble: [0, 1], mustache: [0, 1], chin: [0, 1] },
} as const;
export const NEUTRAL_IDENTITY: IdentityParams = {
  shape: Object.fromEntries(SHAPE_CONTROLS.map((k) => [k, 0])) as Record<ShapeControl, number>,
  eyes: { scale: 1, spacing: 0, openness: 1, lidRest: 0.05, tilt: 0, iris: "#3a2a22", irisSize: 1, crease: 0.3 },
  brows: { height: 0, thickness: 1, arch: 0.3, tilt: 0, length: 1, gap: 0, color: "#2a2120" },
  lips: { width: 1, upper: 1, lower: 1, bow: 0.5, color: "#d98f8a" },
  nose: { nostril: 0.6 }, cheeks: { blush: 0.35 },
  facialHair: { stubble: 0, mustache: 0, chin: 0, color: "#1c1818" },
  skin: "#efb38c",
};
const clampR = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
/** keep every parameter inside its contract range (a stored or edited value can never break the family) */
export function clampIdentity(p: IdentityParams): IdentityParams {
  const R = PARAM_RANGES;
  const pick = <T extends Record<string, unknown>>(o: T, r: Record<string, readonly [number, number]>): T =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" && r[k] ? clampR(v, r[k]) : v])) as T;
  return {
    shape: Object.fromEntries(SHAPE_CONTROLS.map((k) => [k, clampR(p.shape[k] ?? 0, R.shape)])) as Record<ShapeControl, number>,
    eyes: pick(p.eyes, R.eyes), brows: pick(p.brows, R.brows), lips: pick(p.lips, R.lips), nose: pick(p.nose, R.nose),
    cheeks: pick(p.cheeks, R.cheeks), facialHair: pick(p.facialHair, R.facialHair), skin: p.skin,
  };
}

export type AvatarProblem = { slot: AppearanceSlot; problem: string };

/** Validate a configuration against a catalogue: every referenced asset exists, sits in the right slot, is
 *  owned by this employee when it is an identity, and the mandatory slots are filled. */
export function validateAvatar(cfg: EmployeeAvatar, catalogue: ReadonlyMap<string, AppearanceAsset>): AvatarProblem[] {
  const out: AvatarProblem[] = [];
  const check = (slot: AppearanceSlot, id: string | null | undefined, required: boolean) => {
    if (!id) { if (required) out.push({ slot, problem: "missing" }); return; }
    const a = catalogue.get(id);
    if (!a) { out.push({ slot, problem: `unknown asset ${id}` }); return; }
    if (a.slot !== slot) out.push({ slot, problem: `${id} is a ${a.slot}, not a ${slot}` });
    if (a.ownerEmployeeId && a.ownerEmployeeId !== cfg.employeeId) out.push({ slot, problem: `${id} belongs to another employee` });
  };
  if (cfg.base !== HUMAN_BASE_VERSION) out.push({ slot: "identity", problem: `base ${cfg.base} is not ${HUMAN_BASE_VERSION}` });
  check("identity", cfg.identity.headAssetId, true);
  check("hair", cfg.hair.assetId, false);
  check("top", cfg.top.assetId, true);
  check("bottom", cfg.bottom.assetId, true);
  check("shoes", cfg.shoes.assetId, true);
  check("glasses", cfg.glasses.assetId, false);
  for (const a of cfg.accessories) check("accessory", a.assetId, true);
  return out;
}

/** The slots that differ between two configurations — what a runtime must re-equip (and nothing else). */
export function changedSlots(a: EmployeeAvatar, b: EmployeeAvatar): AppearanceSlot[] {
  const out: AppearanceSlot[] = [];
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  if (!same(a.identity, b.identity)) out.push("identity");
  if (!same(a.hair, b.hair)) out.push("hair");
  if (!same(a.top, b.top)) out.push("top");
  if (!same(a.bottom, b.bottom)) out.push("bottom");
  if (!same(a.shoes, b.shoes)) out.push("shoes");
  if (!same(a.glasses, b.glasses)) out.push("glasses");
  if (!same(a.accessories, b.accessories)) out.push("accessory");
  return out;
}

// ---- budgets ---------------------------------------------------------------------------------------------

/** Production targets (triangles, texture px). The proof reports against these. */
export const HUMAN_BUDGETS = {
  body: 45_000,
  identityHead: 60_000,
  hair: 25_000,
  garmentEach: 12_000,
  shoesPair: 8_000,
  accessoryEach: 3_000,
  bodyTexture: 1024,
  headTexture: 2048,
} as const;
