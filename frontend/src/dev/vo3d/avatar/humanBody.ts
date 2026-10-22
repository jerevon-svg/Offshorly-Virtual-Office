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
import { CATALOGUE_BY_ID, BON_AVATAR, MICAH_AVATAR, ANGELO_AVATAR, CLANG_AVATAR, FRANCE_AVATAR, JONA_AVATAR, KAEL_AVATAR, NICOLE_AVATAR, LUI_AVATAR, OFFSHORLY_UNIFORM, newEmployeeAvatar } from "../human/humanCatalogue";
import { idleClip, type AppearanceAsset, type EmployeeAvatar, type HeadMount } from "../human/humanBaseContract";
import { HumanAvatar } from "../human/HumanAvatar";
import { CLIP_IDLE } from "../adapters/v1Avatar";
import { HUMANBASE_ENABLED, humanBaseOn, VALIDATED_HEADS, type ValidatedHead } from "./humanBodyRoster";

export { HUMANBASE_ENABLED, humanBaseOn, hasHumanBody, VALIDATED_HEADS, type ValidatedHead } from "./humanBodyRoster";
import { characterRuntimeVersion, outfitFor, runtimeAvatar, runtimeAvatars, wearOutfit } from "./characterRuntime";

const BASE = `${import.meta.env?.BASE_URL ?? "/"}avatars/human-base-v1/`;

/** GROUP PROPORTION NORMALIZATION — each identity head's mount on the shared body, with BON AS THE CANONICAL reference
 *  (no mount). Measured on the anatomical face (chin → eye line, eye spacing, cheek and jaw width) against the body,
 *  never on the hair volume, which every hairstyle keeps as authored; Micah's head is also authored pitched forward. */
export const HEAD_MOUNT: Readonly<Record<string, HeadMount>> = {
  micah: { scale: 0.89, pitchDeg: 7 }, angelo: { scale: 0.95 }, clang: { scale: 0.91 }, france: { scale: 0.935 },
  // the FROZEN approved five only. Every later identity's mount is PIPELINE OUTPUT (VALIDATED_HEADS, written by the gate's
  // promotion with the artifact it was measured on) — there are no per-employee mount constants for them.
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
  // batch 2 — same recipe, data only; NO mount here (it comes from the validated head, see appearanceFor)
  jona: { ...JONA_AVATAR, identity: { headAssetId: "humanbase:jona" } },
  kael: { ...KAEL_AVATAR, identity: { headAssetId: "humanbase:kael" } },
  nicole: { ...NICOLE_AVATAR, identity: { headAssetId: "humanbase:nicole" } },
  lui: { ...LUI_AVATAR, identity: { headAssetId: "humanbase:lui" } },
};


/** The production catalogue: every shared module plus each employee's approved optimised identity head. */
export const HUMANBASE_CATALOGUE: ReadonlyMap<string, AppearanceAsset> = (() => {
  const m = new Map<string, AppearanceAsset>(CATALOGUE_BY_ID);
  for (const id of Object.keys(APPEARANCE)) m.set(`humanbase:${id}`, { id: `humanbase:${id}`, slot: "identity", label: `${id} (HumanBase V1.4)`, url: `${BASE}production/${id}-v1.glb`, hides: [] });
  for (const id of Object.keys(VALIDATED_HEADS)) if (!APPEARANCE[id]) m.set(`humanbase:${id}`, { id: `humanbase:${id}`, slot: "identity", label: `${id} (HumanBase, promoted)`, url: `${BASE}production/${id}-v1.glb`, hides: [] });   // a promoted NEW employee
  return m;
})();


/** The production APPEARANCE recipe for a cast id regardless of enablement (preset, uniform, accessories, mount) — what the
 *  fail-closed build's mounted gate and candidate review wear a candidate identity with. Never used to decide what renders. */
/** THE ONE PLACE a runtime appearance gets its head mount: a frozen approved identity keeps its approved HEAD_MOUNT; any
 *  other identity wears the mount its validated head record carries (production: VALIDATED_HEADS; the gate's parity check
 *  passes the record it is about to promote) — and NO mount at all without one (then it is not enabled either). */
export function appearanceFor(castId: string, validated: Readonly<Record<string, ValidatedHead>> = VALIDATED_HEADS): EmployeeAvatar | null {
  // a promoted NEW employee (a validated head, no hand-written appearance) wears the generic recipe with the preset its record carries
  const r = validated[castId], a = APPEARANCE[castId] ?? (r ? newEmployeeAvatar(castId, r.bodyPreset === "feminine" ? "feminine" : "standard") : undefined); if (!a) return null; const c = structuredClone(a) as EmployeeAvatar;
  const v = HEAD_MOUNT[castId] ? null : validated[castId]; if (v) c.identity = { ...c.identity, mount: { scale: v.mount.scale, pitchDeg: v.mount.pitchDeg } };
  return c;
}

/** CANDIDATE REVIEW ONLY (the build's mounted gate and the candidate preview — never what renders: enablement stays
 *  HUMANBASE_ENABLED): an approved employee keeps their production appearance exactly; a NEW employee (no production
 *  appearance yet) wears the generic recipe (newEmployeeAvatar: body preset from their pipeline recipe, the uniform), with the
 *  validated mount when one is given. Without this every newly uploaded person failed the mounted gate closed. */
export function candidateAppearance(castId: string, validated?: Readonly<Record<string, ValidatedHead>>, bodyPreset: "standard" | "feminine" = "standard"): EmployeeAvatar {
  return appearanceFor(castId, validated ?? VALIDATED_HEADS) ?? newEmployeeAvatar(castId, bodyPreset);
}

/** The catalogue entry for a cast id's identity head served from `url` (a candidate file) — also for a new employee, whose
 *  head is not in the production catalogue yet */
export function identityHeadAsset(castId: string, url: string): AppearanceAsset {
  const known = HUMANBASE_CATALOGUE.get(`humanbase:${castId}`);
  return known ? { ...known, url } : { id: `humanbase:${castId}`, slot: "identity", label: `${castId} (HumanBase candidate)`, url, hides: [] };
}

/** The HumanBase appearance for a cast id, or null when that employee keeps the legacy body. A production (frozen or promoted)
 *  appearance always wins; otherwise an approved head Character Studio delivered at runtime (dev-only, avatar/characterRuntime)
 *  is worn with the mount its record carries. Either way the employee's OWN saved outfit (if any) is worn over it — garments
 *  only, checked against the catalogue; the head is never touched. */
export function humanBodyFor(castId: string | null | undefined, search?: string): EmployeeAvatar | null {
  if (!castId || !humanBaseOn(search)) return null;
  const rt = HUMANBASE_ENABLED.has(castId) ? null : runtimeAvatar(castId);
  const a = HUMANBASE_ENABLED.has(castId) ? appearanceFor(castId) : rt ? appearanceFor(castId, { [castId]: rt.head }) : null;
  return a ? wearOutfit(a, outfitFor(castId)) : null;
}

/** The catalogue a body is built from: the production one, plus — only for runtime-delivered heads — their identity asset at the
 *  served file (a static entry for the same id, e.g. an older untracked production GLB, is NOT what was approved). */
let runtimeCatalogue: { v: number; m: ReadonlyMap<string, AppearanceAsset> } | null = null;
export function humanCatalogue(): ReadonlyMap<string, AppearanceAsset> {
  const list = runtimeAvatars(); if (!list.length) return HUMANBASE_CATALOGUE;
  if (runtimeCatalogue?.v === characterRuntimeVersion()) return runtimeCatalogue.m;
  const m = new Map(HUMANBASE_CATALOGUE);
  for (const a of list) if (!HUMANBASE_ENABLED.has(a.castId)) m.set(`humanbase:${a.castId}`, identityHeadAsset(a.castId, a.url));
  runtimeCatalogue = { v: characterRuntimeVersion(), m };
  return m;
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
export async function createHumanBody(config: EmployeeAvatar, catalogue: ReadonlyMap<string, AppearanceAsset> = humanCatalogue()): Promise<HumanBody> {
  const human = await HumanAvatar.create(config, catalogue);
  human.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = m.castShadow !== false; m.frustumCulled = false; } });
  const idle = idleClip(human.config.idleProfile);
  const clips = [...human.clips];
  const idleSrc = clips.find((c) => c.name === idle);
  if (idleSrc) clips.push(Object.assign(idleSrc.clone(), { name: CLIP_IDLE }));
  const clipName = (n: string) => (n === CLIP_IDLE ? idle : n);
  return { human, clips, clipName, action: (n) => human.actionFor(clipName(n)) };
}
