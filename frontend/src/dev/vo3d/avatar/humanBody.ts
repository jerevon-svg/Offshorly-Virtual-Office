// vo3d avatar — WHICH EMPLOYEES WEAR A HUMANBASE BODY IN PRODUCTION, and with what appearance.
//
// IDENTITY ≠ APPEARANCE. The signed-in person (data/avatarIdentity → identity.avatarId) is who you are; this
// module only answers "what does that person's body look like" — an EmployeeAvatar appearance configuration
// on the shared HumanBase runtime (human/HumanAvatar: one rig, one clip library, sockets, behaviours). Adding
// another employee later is a line in HUMANBASE_ENABLED, never new avatar code.
//
// ROLLBACK. Two independent switches return the legacy production GLB body immediately:
//   · `?humanbase=0` on the page URL (per session, no deploy), and
//   · removing the id from HUMANBASE_ENABLED (config, one line).
// Anything not enabled — or a HumanBase load failure (avatar/Avatar falls back) — keeps the legacy body.
import * as THREE from "three";
import { CATALOGUE_BY_ID, BON_AVATAR, MICAH_AVATAR, ANGELO_AVATAR, CLANG_AVATAR, FRANCE_AVATAR, OFFSHORLY_UNIFORM } from "../human/humanCatalogue";
import { idleClip, type AppearanceAsset, type EmployeeAvatar, type HeadMount } from "../human/humanBaseContract";
import { HumanAvatar } from "../human/HumanAvatar";
import { CLIP_IDLE } from "../adapters/v1Avatar";

const BASE = `${import.meta.env?.BASE_URL ?? "/"}avatars/human-base-v1/`;

/** GROUP PROPORTION NORMALIZATION — each identity head's mount on the shared body, with BON AS THE CANONICAL reference
 *  (no mount). Measured on the anatomical face (chin → eye line, eye spacing, cheek and jaw width) against the body,
 *  never on the hair volume, which every hairstyle keeps as authored; Micah's head is also authored pitched forward. */
export const HEAD_MOUNT: Readonly<Record<string, HeadMount>> = {
  micah: { scale: 0.89, pitchDeg: 7 }, angelo: { scale: 0.95 }, clang: { scale: 0.91 }, france: { scale: 0.935 },
};

/** The approved V1.4 production appearance per cast id (identity head = the optimised production candidate). */
const APPEARANCE: Readonly<Record<string, EmployeeAvatar>> = {
  // Bon wears the Offshorly uniform like everyone else for now; his CRRN IVRSE hoodie, denim shorts and clogs stay in
  // the wardrobe catalogue (BON_AVATAR) for Profile → Edit Avatar. His hair is the identity's own layered hair (no
  // separate hair module); glasses off is canonical.
  bon: { ...BON_AVATAR, ...OFFSHORLY_UNIFORM, employeeId: "bon", idleProfile: "masculine", identity: { headAssetId: "humanbase:bon" }, hair: { assetId: null }, glasses: { assetId: null } },
  micah: { ...MICAH_AVATAR, identity: { headAssetId: "humanbase:micah", mount: HEAD_MOUNT.micah } },
  angelo: { ...ANGELO_AVATAR, identity: { headAssetId: "humanbase:angelo", mount: HEAD_MOUNT.angelo } },
  clang: { ...CLANG_AVATAR, identity: { headAssetId: "humanbase:clang", mount: HEAD_MOUNT.clang } },
  france: { ...FRANCE_AVATAR, identity: { headAssetId: "humanbase:france", mount: HEAD_MOUNT.france } },
};

/** PHASE 3: the five approved V1.4 employees. A further employee is an id here plus an APPEARANCE entry — nothing else. */
export const HUMANBASE_ENABLED: ReadonlySet<string> = new Set(["bon", "micah", "angelo", "clang", "france"]);

/** The production catalogue: every shared module plus each employee's approved optimised identity head. */
export const HUMANBASE_CATALOGUE: ReadonlyMap<string, AppearanceAsset> = (() => {
  const m = new Map<string, AppearanceAsset>(CATALOGUE_BY_ID);
  for (const id of Object.keys(APPEARANCE)) m.set(`humanbase:${id}`, { id: `humanbase:${id}`, slot: "identity", label: `${id} (HumanBase V1.4)`, url: `${BASE}production/${id}-v1.glb`, hides: [] });
  return m;
})();

/** Is the HumanBase body switched on for this page? (`?humanbase=0` turns it off for the session.) */
export function humanBaseOn(search: string = typeof location !== "undefined" ? location.search : ""): boolean {
  return new URLSearchParams(search).get("humanbase") !== "0";
}

/** The HumanBase appearance for a cast id, or null when that employee keeps the legacy body. */
export function humanBodyFor(castId: string | null | undefined, search?: string): EmployeeAvatar | null {
  if (!castId || !HUMANBASE_ENABLED.has(castId) || !humanBaseOn(search)) return null;
  const a = APPEARANCE[castId];
  return a ? structuredClone(a) : null;
}

/** ONE BUILT HUMANBASE BODY, already speaking VO's clip vocabulary — the single construction path both the
 *  local player (avatar/Avatar) and every remote coworker body (world/Coworkers) take. */
export type HumanBody = {
  readonly human: HumanAvatar;
  /** the shared library's clips plus the employee's idle profile aliased under VO's CLIP_IDLE — what the
   *  seat contract (interact/seatContact sceneRig) reads hip tracks from */
  readonly clips: THREE.AnimationClip[];
  /** VO clip name → library clip name (CLIP_IDLE → this employee's idle profile; every other name is 1:1) */
  clipName(voName: string): string;
  /** the mixer action bound to a VO clip name, or undefined when the library has no such clip */
  action(voName: string): THREE.AnimationAction | undefined;
};

/** Build a HumanBase body for an appearance. Every instance is its own skeleton clone + mixer (HumanAvatar
 *  parses each GLB once per page and shares geometry), so any number of bodies may be built from one config. */
export async function createHumanBody(config: EmployeeAvatar, catalogue: ReadonlyMap<string, AppearanceAsset> = HUMANBASE_CATALOGUE): Promise<HumanBody> {
  const human = await HumanAvatar.create(config, catalogue);
  human.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = m.castShadow !== false; m.frustumCulled = false; } });
  const idle = idleClip(human.config.idleProfile);
  const clips = [...human.clips];
  const idleSrc = clips.find((c) => c.name === idle);
  if (idleSrc) clips.push(Object.assign(idleSrc.clone(), { name: CLIP_IDLE }));
  const clipName = (n: string) => (n === CLIP_IDLE ? idle : n);
  return { human, clips, clipName, action: (n) => human.actionFor(clipName(n)) };
}
