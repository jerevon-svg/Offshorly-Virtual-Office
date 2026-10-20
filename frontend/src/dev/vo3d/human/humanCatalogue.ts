// vo3d human — THE PROOF CATALOGUE + BON'S AVATAR CONFIGURATION (Phase 2, dev-only).
//
// A catalogue entry says what an asset IS (slot, file, what it hides, the colourways its material understands).
// An EmployeeAvatar says what one employee WEARS. The employee's identity/profile record (name, email, role) is
// not here at all — `employeeId` only references it — so editing an appearance can never touch it.
// `hides` is duplicated from each GLB's own extras on purpose: a test checks they agree, so the runtime can trust
// the file and a future backend can validate a configuration without downloading anything.
import type { AppearanceAsset, EmployeeAvatar, IdentityParams } from "./humanBaseContract";
import { HUMAN_BASE_VERSION } from "./humanBaseContract";

const BASE = `${import.meta.env?.BASE_URL ?? "/"}avatars/human-base-v1/`;
export const HUMAN_BASE_URL = `${BASE}human-base.glb`;
/** body presets: one file each, identical skeleton / clips / weights — see build-body-preset-feminine.mjs */
export const HUMAN_BODY_PRESET_URLS = { standard: HUMAN_BASE_URL, feminine: `${BASE}human-base-feminine.glb` } as const;

/** THE OFFSHORLY EMPLOYEE TEE — a curated palette (tasteful, readable with the logo; the logo's mint mark is kept, its
 *  wordmark switches dark/light automatically by fabric luminance). Mint is excluded from the random set (it hides the
 *  mint mark). */
export const TEE_COLORWAYS = {
  white: { main: "#f3f0e9", trim: "#e7e3da" }, ink: { main: "#1c1c22", trim: "#141418" }, sand: { main: "#e3d3b8", trim: "#d3c2a5" },
  sky: { main: "#9cc0e6", trim: "#89aed6" }, sage: { main: "#a7b9a0", trim: "#95a88e" }, coral: { main: "#e8907a", trim: "#d67f6a" },
  butter: { main: "#f1dc8a", trim: "#e2cb76" }, navy: { main: "#27324d", trim: "#1e2840" }, forest: { main: "#2f4a3a", trim: "#263d30" },
  plum: { main: "#5b3b5e", trim: "#4c304f" }, charcoal: { main: "#3a3d44", trim: "#2f3238" }, rose: { main: "#e9b7bf", trim: "#dba5ae" },
} as const;
export type TeeColorway = keyof typeof TEE_COLORWAYS;
/** deterministic per employee (FNV-1a of the id) — the same colour on every load, a spread across the office */
export function teeColorwayFor(employeeId: string): TeeColorway {
  let h = 0x811c9dc5; for (let i = 0; i < employeeId.length; i++) { h ^= employeeId.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  const keys = Object.keys(TEE_COLORWAYS) as TeeColorway[]; return keys[h % keys.length];
}

export const PROOF_CATALOGUE: readonly AppearanceAsset[] = [
  // the ONE shared head every new employee is built on (identity = parameters on it, not a mesh per person)
  { id: "canonical-head-v1", slot: "identity", label: "Canonical head", url: `${BASE}identity/canonical-head-v1.glb`, hides: [] },
  // THE CANONICAL SKULL ENVELOPE: production Alex's real head with his identity removed (glasses, face features,
  // texture) — the physical head/attachment standard every identity head is normalised to (no face of its own)
  { id: "alex-neutral-head-v1", slot: "identity", label: "Neutral head · Alex skull envelope", url: `${BASE}identity/alex-neutral-head-v1.glb`, hides: [] },
  // AUTOMATIC PIPELINE PROOF: the raw Meshy head run through chibify.mjs (no manual sculpting; hair fused)
  { id: "bon-meshy-chibi-v1", slot: "identity", label: "Bon · Meshy auto-chibi", url: `${BASE}identity/bon-meshy-chibi-v1.glb`, hides: [], ownerEmployeeId: "bon" },
  // EMPLOYEE #2 (cross-employee validation): Micah's raw Meshy head through the unchanged universal chibify pipeline
  { id: "micah-meshy-chibi-v1", slot: "identity", label: "Micah · Meshy auto-chibi", url: `${BASE}identity/micah-meshy-chibi-v1.glb`, hides: [], ownerEmployeeId: "micah" },
  // BON AS A SOFT-3D CHIBI ON THE ALEX SKULL: Bon's illustrated face re-drawn as soft-3D parts (no Meshy face anatomy)
  { id: "bon-chibi-head-v1", slot: "identity", label: "Bon · chibi on Alex skull", url: `${BASE}identity/bon-chibi-head-v1.glb`, hides: [], ownerEmployeeId: "bon" },
  // Phase 2's decomposed head (kept only for comparison)
  { id: "bon-head", slot: "identity", label: "Bon · Phase 2", url: `${BASE}identity/bon/head.glb`, hides: ["NECK"], ownerEmployeeId: "bon" },
  // Bon's Meshy-generated hair, extracted from the fused raw mesh and fitted around the Alex skull (modular hair slot)
  { id: "bon-meshy-hair-v1", slot: "hair", label: "Bon · Meshy hair", url: `${BASE}hair/bon-meshy-hair-v1.glb` },
  { id: "medium-curtain", slot: "hair", label: "Medium curtain · middle part", url: `${BASE}hair/medium-curtain.glb` },
  // GLASSES (V1.1 accessory contract): every style is a FIT-SPACE module — one approved style, refitted to whichever identity
  // wears it from that identity's own anchors (humanGlasses.ts / humanAccessoryFit.ts); never a per-employee copy.
  // Micah's large round light frames (style measured from her approved illustration)
  { id: "micah-glasses", slot: "glasses", label: "Micah · round light frames", url: `${BASE}accessories/micah-glasses.glb`, socket: "identity-face" },
  { id: "glasses-classic", slot: "glasses", label: "Classic frames", url: `${BASE}accessories/glasses-classic.glb`, socket: "identity-face" },
  { id: "glasses-rect", slot: "glasses", label: "Rectangular frames", url: `${BASE}accessories/glasses-rect.glb`, socket: "identity-face" },
  { id: "bon-long", slot: "hair", label: "Bon · longer", url: `${BASE}hair/bon-long.glb` },
  { id: "bon-short", slot: "hair", label: "Bon · original", url: `${BASE}hair/bon-short.glb` },
  // Bon's frames: the style measured from his approved V1 frames (glasses-styles/bon-frames.json), fit space like every style
  { id: "bon-glasses", slot: "glasses", label: "Bon's frames", url: `${BASE}accessories/bon-glasses.glb`, socket: "identity-face" },
  {
    id: "hoodie-crrn", slot: "top", label: "CRRN IVRSE hoodie", url: `${BASE}garments/hoodie-crrn.glb`, thickness: 0.036,
    hides: ["CHEST", "BELLY", "UPPERARM_L", "UPPERARM_R", "FOREARM_L", "FOREARM_R"],
    colorways: { black: { main: "#17171a", trim: "#101012", accent: "#efebe2" }, heather: { main: "#5b5d63", trim: "#4a4c51", accent: "#efebe2" }, bone: { main: "#e6e0d3", trim: "#d7d0c1", accent: "#1c1c20" } },
  },
  {
    id: "tee-offshorly", slot: "top", label: "Offshorly tee", url: `${BASE}garments/tee-offshorly.glb`, thickness: 0.022,
    hides: ["CHEST", "BELLY", "UPPERARM_L", "UPPERARM_R"],
    colorways: { mint: { main: "#5dd9b3", trim: "#4cc4a0" }, ...TEE_COLORWAYS },
  },
  {
    id: "shorts-denim", slot: "bottom", label: "Denim shorts", url: `${BASE}garments/shorts-denim.glb`, thickness: 0.03, hides: ["PELVIS", "THIGH_L", "THIGH_R"],
    colorways: { mid: { main: "#3d5a86", trim: "#c88a3c", accent: "#9fb4d1" }, light: { main: "#7b97bf", trim: "#c88a3c", accent: "#b9c9df" }, black: { main: "#2a2c33", trim: "#8a8a8a", accent: "#4a4d56" } },
  },
  {
    // the default employee uniform's bottom (V1.1): relaxed fleece joggers, gathered ankle cuff, rib waistband
    id: "joggers-offshorly", slot: "bottom", label: "Offshorly joggers", url: `${BASE}garments/joggers-offshorly.glb`, thickness: 0.04, hides: ["PELVIS", "THIGH_L", "THIGH_R", "SHIN_L", "SHIN_R"],
    colorways: { black: { main: "#1f1f24", trim: "#16161a", accent: "#5dd9b3" }, charcoal: { main: "#3a3b41", trim: "#2c2d32", accent: "#5dd9b3" }, navy: { main: "#232c42", trim: "#1a2234", accent: "#5dd9b3" } },
  },
  {
    id: "clogs", slot: "shoes", label: "Clogs", url: `${BASE}garments/clogs.glb`, hides: ["FOOT_L", "FOOT_R"],
    colorways: { chalk: { main: "#ece7dc", trim: "#d9d3c5", accent: "#bdb6a6" }, black: { main: "#232327", trim: "#18181b", accent: "#3a3a40" }, sage: { main: "#9fb39a", trim: "#879b82", accent: "#e9e5da" } },
  },
  { id: "sneakers", slot: "shoes", label: "Sneakers", url: `${BASE}garments/sneakers.glb`, hides: ["FOOT_L", "FOOT_R"],
    colorways: { white: { main: "#f4f3ef", trim: "#ebe8e1", accent: "#f7f6f2" }, black: { main: "#26262b", trim: "#efede7", accent: "#26262b" }, grey: { main: "#b9bbc0", trim: "#efede7", accent: "#f7f6f2" } } },
  // generalisation batch: identity heads from the unchanged universal pipeline, plus Clang's modular hair flower
  { id: "angelo-meshy-chibi-v1", slot: "identity", label: "Angelo · Meshy auto-chibi", url: `${BASE}identity/angelo-meshy-chibi-v1.glb`, hides: [], ownerEmployeeId: "angelo" },
  { id: "clang-meshy-chibi-v1", slot: "identity", label: "Clang · Meshy auto-chibi", url: `${BASE}identity/clang-meshy-chibi-v1.glb`, hides: [], ownerEmployeeId: "clang" },
  { id: "france-meshy-chibi-v1", slot: "identity", label: "France · Meshy auto-chibi", url: `${BASE}identity/france-meshy-chibi-v1.glb`, hides: [], ownerEmployeeId: "france" },
  { id: "france-hair-tail", slot: "accessory", label: "France · tied-back hair (low ponytail)", url: `${BASE}accessories/france-hair-tail.glb`, socket: "headTop" },
  { id: "clang-flower", slot: "accessory", label: "Clang · hair flower", url: `${BASE}accessories/clang-flower.glb`, socket: "headTop" },
  // batch 2: identity heads from the unchanged universal pipeline, plus Alex's frames (style measured from his vector master;
  // his identity head is pending — the Meshy candidate was rejected, his own legacy head is being adapted)
  { id: "jona-meshy-chibi-v1", slot: "identity", label: "Jona · Meshy auto-chibi", url: `${BASE}identity/jona-meshy-chibi-v1.glb`, hides: [], ownerEmployeeId: "jona" },
  { id: "kael-meshy-chibi-v1", slot: "identity", label: "Kael · Meshy auto-chibi", url: `${BASE}identity/kael-meshy-chibi-v1.glb`, hides: [], ownerEmployeeId: "kael" },
  { id: "nicole-meshy-chibi-v1", slot: "identity", label: "Nicole · Meshy auto-chibi", url: `${BASE}identity/nicole-meshy-chibi-v1.glb`, hides: [], ownerEmployeeId: "nicole" },
  { id: "lui-meshy-chibi-v1", slot: "identity", label: "Lui · Meshy auto-chibi", url: `${BASE}identity/lui-meshy-chibi-v1.glb`, hides: [], ownerEmployeeId: "lui" },
  { id: "alex-glasses", slot: "glasses", label: "Alex · black rectangular frames", url: `${BASE}accessories/alex-glasses.glb`, socket: "identity-face" },
  { id: "offshorly-badge", slot: "accessory", label: "Offshorly badge", url: "procedural:badge", socket: "chest" },
];
export const CATALOGUE_BY_ID: ReadonlyMap<string, AppearanceAsset> = new Map(PROOF_CATALOGUE.map((a) => [a.id, a]));

/** BON V2 — read from ONE current front photo (scripts/avatar-pipeline/human-base/bon-photo-traits.md), translated
 *  into the VO style on the canonical head. Selfie wide-angle corrected: the face is broader, the nose smaller than
 *  the photo shows. */
export const BON_IDENTITY_V2: IdentityParams = {
  // a broad, soft, round face and a BROAD, low-bridged rounded nose (wide, not projecting) — translated inside the family proportions, not exaggerated
  shape: { faceWidth: 0.3, jawWidth: 0.25, chinLength: -0.1, cheekFull: 0.45, noseSize: -0.15, noseWidth: 1, noseLength: -0.1, forehead: 0.1, earSize: 0, lipFull: 0.5 },
  // family-size open eyes, Bon's character in the lids: a little heavy, slightly downturned; dark brown iris
  eyes: { scale: 1.06, spacing: 0, openness: 0.95, lidRest: 0.14, tilt: -0.06, iris: "#2a1d18", irisSize: 1, crease: 0.55 },
  // low, fairly straight, medium brows
  brows: { height: -0.4, thickness: 1.05, arch: 0.25, tilt: -0.15, length: 1.05, gap: 0.15, color: "#1d1716" },
  // full lips, the lower fuller
  lips: { width: 1.05, upper: 1, lower: 1.25, bow: 0.35, color: "#c88480" },
  nose: { nostril: 0.7 }, cheeks: { blush: 0.22 },
  // a light moustache at the corners, sparse chin
  facialHair: { stubble: 0.5, mustache: 0.85, chin: 0.4, color: "#1a1616" },
  skin: "#f0b98f",
};

/** BON V3 — FROM HIS APPROVED ILLUSTRATED AVATAR (the identity blueprint), translated onto the canonical head by
 *  scripts/avatar-pipeline/human-base/{illustration-traits,fit-identity}.mjs: widths 1:1, vertical distances by the
 *  family face length, the jaw/cheek outline fitted with the bounded shape controls. Zero credits, no generation. */
export const BON_IDENTITY_ILLUSTRATED: IdentityParams = {"shape": {"faceWidth": -0.4, "jawWidth": -1, "chinLength": 0, "cheekFull": 1, "noseSize": 0.3, "noseWidth": 1, "noseLength": -0.848, "forehead": 0, "earSize": 0, "lipFull": -0.4}, "eyes": {"scale": 1.15, "spacing": 0.239, "openness": 0.512, "lidRest": 0.24, "tilt": -0.04, "iris": "#1f1714", "irisSize": 1, "crease": 0.35}, "brows": {"height": 0.1, "thickness": 1.473, "arch": 0.1, "tilt": -0.1, "length": 1.249, "gap": -1.88, "color": "#1c1513"}, "lips": {"width": 2, "upper": 0.55, "lower": 0.6, "bow": 0.2, "color": "#c4836f", "offset": 0.911, "smile": 0.45, "line": 1, "under": 1}, "nose": {"nostril": 1}, "cheeks": {"blush": 0.2}, "facialHair": {"stubble": 0, "mustache": 0, "chin": 0, "color": "#1a1616"}, "skin": "#fbbd92"};

/** Bon, the first modular employee — identity from his illustrated avatar, appearance (hair) from his current photo. */
export const BON_AVATAR: EmployeeAvatar = {
  employeeId: "bon",
  base: HUMAN_BASE_VERSION,
  version: 1,
  identity: { headAssetId: "canonical-head-v1", params: BON_IDENTITY_ILLUSTRATED },
  hair: { assetId: "medium-curtain", color: "#2a2325" },
  idleProfile: "masculine",
  top: { assetId: "hoodie-crrn", colorway: "black" },
  bottom: { assetId: "shorts-denim", colorway: "mid" },
  shoes: { assetId: "clogs", colorway: "chalk" },
  glasses: { assetId: null },
  accessories: [],
};

/** Phase 2's modular Bon (decomposed from the old fused GLB) — for side-by-side comparison only */
export const BON_PHASE2_AVATAR: EmployeeAvatar = {
  ...BON_AVATAR,
  identity: { headAssetId: "bon-head" },
  hair: { assetId: "bon-long" },
  glasses: { assetId: "bon-glasses" },
};

/** THE DEFAULT EMPLOYEE UNIFORM (V1.1): black Offshorly tee + black baggy Offshorly joggers + clean white sneakers. A default, not
 *  a lock — every slot stays editable and the whole wardrobe stays in the catalogue (Bon keeps his approved outfit). */
export const OFFSHORLY_UNIFORM = {
  top: { assetId: "tee-offshorly", colorway: "ink" }, bottom: { assetId: "joggers-offshorly", colorway: "black" }, shoes: { assetId: "sneakers", colorway: "white" },
} as const satisfies Pick<EmployeeAvatar, "top" | "bottom" | "shoes">;

/** Micah — employee #2: Meshy identity through the universal pipeline, feminine body preset, her own glasses */
export const MICAH_AVATAR: EmployeeAvatar = {
  employeeId: "micah", base: HUMAN_BASE_VERSION, version: 1, bodyPreset: "feminine",
  identity: { headAssetId: "micah-meshy-chibi-v1" }, hair: { assetId: null }, idleProfile: "feminine",
  ...OFFSHORLY_UNIFORM,
  glasses: { assetId: "micah-glasses" }, accessories: [],
};

/** the generalisation batch (body preset from each person's production idle profile, deterministic tee) */
const batchAvatar = (id: string, bodyPreset: "standard" | "feminine", accessories: { assetId: string }[] = []): EmployeeAvatar => ({
  employeeId: id, base: HUMAN_BASE_VERSION, version: 1, bodyPreset, identity: { headAssetId: `${id}-meshy-chibi-v1` }, hair: { assetId: null },
  idleProfile: bodyPreset === "feminine" ? "feminine" : "masculine", ...OFFSHORLY_UNIFORM, glasses: { assetId: null }, accessories,
});
export const ANGELO_AVATAR = batchAvatar("angelo", "standard");
export const CLANG_AVATAR = batchAvatar("clang", "feminine", [{ assetId: "clang-flower" }]);
export const FRANCE_AVATAR = batchAvatar("france", "feminine", [{ assetId: "france-hair-tail" }]);
/** batch 2 (same recipe: body preset by person, the Offshorly uniform, each person's own extras) */
export const JONA_AVATAR = batchAvatar("jona", "feminine");
export const KAEL_AVATAR = batchAvatar("kael", "standard");
export const NICOLE_AVATAR = batchAvatar("nicole", "feminine");
export const LUI_AVATAR = batchAvatar("lui", "standard");
/** a NEW employee (no hand-written appearance yet): the same generic recipe — body preset from the person's pipeline recipe, the
 *  Offshorly uniform, no extras — wearing their own HumanBase identity head (asset id humanbase:<id>) */
export const newEmployeeAvatar = (id: string, bodyPreset: "standard" | "feminine" = "standard"): EmployeeAvatar => ({ ...batchAvatar(id, bodyPreset), identity: { headAssetId: `humanbase:${id}` } });
