// vo3d world — THE AI LAB MONKEY, as data. DEV-ONLY, OFF BY DEFAULT (`?monkey=1`).
//
// WHY THIS FILE EXISTS SEPARATELY FROM adapters/v1Avatar.ts. The shipped employee
// cast is a 24-joint Meshy skeleton with seven fixed clip names (`idle-9`,
// `walking`, … — see lod-policy.mjs's REQUIRED_CLIP_NAMES). This monkey master is
// a 28-joint **Mixamo-named** skeleton carrying three clips (`Walking`,
// `Running`, `restpose`). Renaming its joints into the employee contract would
// mean re-binding a rig that is measurably correct — Head above the shoulders,
// arm bone 8.3° off horizontal, thigh 21.2°, ears bound Head 99% — so it is
// deliberately NOT forced into that contract. It keeps its own skeleton, its own
// clip names, and its own loader. Nothing in the employee path is touched.
export const MONKEY_GLB_URL = `${import.meta.env.BASE_URL}avatars/monkey-base-v1/monkey-master.glb`;

/** WARM-IVORY EYE CORRECTION. The master's own baked texture paints the sclera a
 *  flat neutral grey (~120,120,120) — confirmed by rendering the face with the
 *  glasses REMOVED, where the grey is still there, so it is neither the lens
 *  material nor overlapping geometry. This is that same texture with only those
 *  sclera pixels remapped to a warm ivory, each keeping its original shading
 *  ramp. Applied at RUNTIME as a material map swap; the GLB is never rewritten,
 *  and clearing the swap restores the shipped texture exactly. */
export const MONKEY_EYE_TEXTURE_URL = `${import.meta.env.BASE_URL}avatars/monkey-base-v1/monkey-master-eyes-ivory.png`;

/** the clips this GLB actually ships. There is no idle and no wave — do not
 *  reference names that are not in this list. */
export const MONKEY_CLIPS = {
  walk: "Walking",
  run: "Running",
  /** the export's own neutral pose. Used as the STATIONARY pose so nothing has
   *  to be invented; it is a real clip in the file, not a fabricated idle. */
  rest: "restpose",
} as const;

/** every clip name present in the master, for validation */
export const MONKEY_CLIP_NAMES: readonly string[] = ["Running", "Walking", "restpose"];

/** the 28 joints the master carries (Mixamo naming, `headfront` unprefixed) */
export const MONKEY_JOINT_COUNT = 28;

/** Visible standing height in world units. Matches the employee avatar scale
 *  (adapters/v1Avatar BON_STANDING_HEIGHT = 36) so the monkey reads at the same
 *  size as a person in the same room. The reference sheet's own scale strip puts
 *  a chibi monkey at ~70 cm against a 180 cm human, which would be ~14 units —
 *  that is a separate design decision, deliberately NOT taken here. */
export const MONKEY_STANDING_HEIGHT = 36;

/** Where the one monkey stands: the open floor of the AI Lab hall, south of the
 *  planted hub (HUB is (740, -600) r88, so this is 115 clear of it) and north of
 *  the entrance throat. No agent slot is occupied and no SOLIDS rect is touched,
 *  so the room's collision model is unchanged. Yaw 0 = facing north, toward the
 *  hub, matching the zone slots' own `N`. */
export const MONKEY_SLOT = { x: 740, z: -485, yaw: 0 } as const;

/** the AI Lab deck the feet stand on (world/ailab DECK_Y) */
export const MONKEY_DECK_Y = 0.2;
