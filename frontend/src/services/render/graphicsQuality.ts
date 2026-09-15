// V2 GRAPHICS & DISPLAY — the quality MODEL. Pure data and pure functions: no DOM, no three.js, no
// storage. Everything that decides WHAT a quality level means lives here, so the renderer-side applier
// (dev/vo3d/render/GraphicsApplier), the adaptive controller (adaptiveQuality) and the settings UI all
// read one definition instead of three copies that drift.
//
// THE THREE MODES ARE NOT THREE PRESETS. "Full Graphics" is one fixed settings object — the approved
// visual benchmark, spelled out below and asserted by test. "Smooth" is a LADDER of internal profiles
// the adaptive controller walks; its top rung IS Full Graphics, byte for byte. "Custom" is Full
// Graphics with the user's own overrides applied on top.
//
// WHICH LEVERS THE LADDER USES, and in what order, comes from the measured bottlenecks recorded in
// render/Renderer.ts and devtools/Stress.ts rather than from guesswork:
//
//   • SSAO is the single largest remaining per-frame cost, and the one that scales with avatar count
//     (16.7 ms → 34.3 ms with the pre-slice-4 pass; still the top line after depth reuse).
//   • The shadow map's redraw was 8.21 ms of a 35.45 ms office frame before the split static/dynamic
//     path; what is left of it scales with shadow RESOLUTION, not with the caster set.
//   • Rendering resolution is the cheapest lever of all and the only one that removes work without
//     removing anything from the picture — nothing disappears, it is drawn at fewer samples.
//
// So the ladder spends resolution first, shadow resolution second, and only gives up SSAO at the very
// bottom rung. Room culling, static batching, foliage instancing and the split shadow update are NEVER
// levers: they are unconditional wins that are always on, at every level and in every mode.

/** What the user picks. Exactly three; there is no hidden fourth. */
export type GraphicsMode = "smooth" | "full" | "custom";

/** Environment/weather effect budget. Grades density, never the grade/lighting itself. */
export type EffectsDetail = "full" | "reduced" | "minimal";

/** Live-3D character mesh detail. NEVER moved by the adaptive controller — see SMOOTH_LADDER. */
export type AvatarDetail = "high" | "standard";

/** The complete renderer-facing graphics state. Every field is a switch some existing V2 system
 *  already had; nothing here is a new art parameter. */
export interface GraphicsSettings {
  /** Multiplier on the renderer's device-pixel-ratio cap. 1 = the approved Full baseline. */
  renderScale: number;
  /** SSAO on/off (Renderer.ssaoEnabled). The depth-reuse path is used either way. */
  ambientOcclusion: boolean;
  /** Resolution the AO is computed at, as a fraction of the drawing buffer (Renderer's AO_SCALE). */
  aoResolutionScale: number;
  /** Shadow casting on/off (Renderer.setShadows). */
  shadows: boolean;
  /** Shadow map edge, in texels. 2048 is the approved Full baseline. */
  shadowMapSize: number;
  /** Weather PARTICLES (the rain field). The weather GRADE — wetness, wind, sky, lightning flash —
   *  is lighting, is part of the approved look, and is not touched by this. */
  weatherEffects: boolean;
  /** Density budget for environment effects that have one (rain streaks, storm bolts). */
  effectsDetail: EffectsDetail;
  /** Foliage sway animation (SwaySystem.enabled). The plants stay; only the motion stops. */
  foliageSway: boolean;
  /** Character mesh LOD band. */
  avatarDetail: AvatarDetail;
}

/**
 * FULL GRAPHICS — the approved visual benchmark, as one object.
 *
 * These values are the state the V2 world was approved and benchmarked in (preset A in devtools/Bench:
 * SSAO on through the depth-reuse path, the split static/dynamic shadow path at 2048, sway on, weather
 * running, the approved DPR). Nothing adapts them. graphicsQuality.test.ts pins every field so a later
 * "optimisation" cannot quietly lower the benchmark it is being measured against.
 */
export const FULL_GRAPHICS: Readonly<GraphicsSettings> = Object.freeze({
  renderScale: 1,
  ambientOcclusion: true,
  aoResolutionScale: 0.5,
  shadows: true,
  shadowMapSize: 2048,
  weatherEffects: true,
  effectsDetail: "full",
  foliageSway: true,
  avatarDetail: "high",
});

/** Internal ladder rungs. DELIBERATELY NOT NAMED low/medium/high/ultra: they are an implementation
 *  detail of Smooth and are never shown to an employee, who sees "Smooth" and nothing else. */
export type QualityLevel = 0 | 1 | 2 | 3;
export const MIN_QUALITY_LEVEL: QualityLevel = 0;
export const MAX_QUALITY_LEVEL: QualityLevel = 3;

/**
 * The Smooth ladder, worst (0) to best (3). Rung 3 IS Full Graphics.
 *
 * Read it as a spending order rather than four presets:
 *   3 → the approved benchmark.
 *   2 → resolution only. Every system is still running and every effect is still on screen; the frame
 *       is simply drawn at 85% and the AO buffer at 35% instead of 50%. Nothing leaves the picture.
 *   1 → resolution again (75%), plus the shadow map halves to 1024 and rain thins out. Shadows,
 *       SSAO, sway, weather and the grade all remain — the office still looks like the office.
 *   0 → the floor. SSAO is given up (the largest single cost), rain particles stop and sway stops.
 *       SHADOWS STAY ON at 1024: after the split static/dynamic update they are comparatively cheap,
 *       and they carry more of the office's visual identity than any other single system. A mode that
 *       is meant to keep an employee playing is allowed to lose ambient occlusion; it is not allowed
 *       to turn the architecture flat.
 *
 * avatarDetail is "high" on EVERY rung on purpose. Changing a character's LOD is an asset reload, not
 * a render switch, and Smooth must never reach into loaded world content. It is a Custom-only control.
 */
export const SMOOTH_LADDER: readonly Readonly<GraphicsSettings>[] = Object.freeze([
  Object.freeze({
    renderScale: 0.65,
    ambientOcclusion: false,
    aoResolutionScale: 0.35,
    shadows: true,
    shadowMapSize: 1024,
    weatherEffects: false,
    effectsDetail: "minimal" as EffectsDetail,
    foliageSway: false,
    avatarDetail: "high" as AvatarDetail,
  }),
  Object.freeze({
    renderScale: 0.75,
    ambientOcclusion: true,
    aoResolutionScale: 0.35,
    shadows: true,
    shadowMapSize: 1024,
    weatherEffects: true,
    effectsDetail: "reduced" as EffectsDetail,
    foliageSway: true,
    avatarDetail: "high" as AvatarDetail,
  }),
  Object.freeze({
    renderScale: 0.85,
    ambientOcclusion: true,
    aoResolutionScale: 0.35,
    shadows: true,
    shadowMapSize: 2048,
    weatherEffects: true,
    effectsDetail: "full" as EffectsDetail,
    foliageSway: true,
    avatarDetail: "high" as AvatarDetail,
  }),
  FULL_GRAPHICS,
]);

/** Density multiplier applied to the rain field's streak budget at each effects level. */
export const EFFECTS_DENSITY: Readonly<Record<EffectsDetail, number>> = Object.freeze({
  full: 1,
  reduced: 0.55,
  minimal: 0,
});

/** The character LOD index each detail band resolves to (adapters/v1Avatar BON_LODS). */
export const AVATAR_LOD_FOR_DETAIL: Readonly<Record<AvatarDetail, 0 | 1 | 2>> = Object.freeze({
  high: 1,
  standard: 2,
});

// ---- CUSTOM ------------------------------------------------------------------------------------
//
// ONLY SAFE, ALREADY-EXISTING SWITCHES ARE EXPOSED. Authored art and debug parameters — key/sun
// intensity and warmth, moon colour, exposure, SSAO kernel radius / min / max distance, shadow bias and
// normalBias, fog offsets, the depth-reuse and static-batching A/B flags — are NOT user settings. They
// are the approved grade and the measurement rig, and a slider on any of them would let a user break
// the look and then report it as a bug.

/** The user-visible overrides Custom may set. Every key is a subset of GraphicsSettings. */
export type CustomGraphics = Partial<
  Pick<
    GraphicsSettings,
    "renderScale" | "ambientOcclusion" | "shadows" | "effectsDetail" | "weatherEffects" | "foliageSway" | "avatarDetail"
  >
>;

export type CustomControlId = keyof CustomGraphics;

/** Shadow quality is exposed as one control; it drives two fields (on/off and map size). */
export const SHADOW_MAP_SIZE_FOR_SCALE: Readonly<Record<string, number>> = Object.freeze({
  "1": 2048,
  "0.85": 2048,
  "0.75": 1024,
  "0.65": 1024,
});

/** One row in Settings → Graphics & Display → Custom. `options` are what the select offers. */
export interface CustomControl<T = string | number | boolean> {
  id: CustomControlId;
  label: string;
  hint: string;
  options: readonly { value: T; label: string }[];
}

/** The exposed control set, in the order the panel renders it. */
export const CUSTOM_CONTROLS: readonly CustomControl[] = Object.freeze([
  {
    id: "renderScale",
    label: "Render quality",
    hint: "How many pixels the office is drawn at",
    options: [
      { value: 1, label: "Full" },
      { value: 0.85, label: "High" },
      { value: 0.75, label: "Balanced" },
      { value: 0.65, label: "Performance" },
    ],
  },
  {
    id: "shadows",
    label: "Shadows",
    hint: "Sunlight and contact shadows",
    options: [
      { value: true, label: "On" },
      { value: false, label: "Off" },
    ],
  },
  {
    id: "ambientOcclusion",
    label: "Ambient occlusion",
    hint: "Soft shading where surfaces meet",
    options: [
      { value: true, label: "On" },
      { value: false, label: "Off" },
    ],
  },
  {
    id: "effectsDetail",
    label: "Environment detail",
    hint: "Density of rain, storm and outdoor effects",
    options: [
      { value: "full", label: "Full" },
      { value: "reduced", label: "Reduced" },
      { value: "minimal", label: "Minimal" },
    ],
  },
  {
    id: "weatherEffects",
    label: "Weather effects",
    hint: "Falling rain in and around the office",
    options: [
      { value: true, label: "On" },
      { value: false, label: "Off" },
    ],
  },
  {
    id: "foliageSway",
    label: "Foliage movement",
    hint: "Plants sway in the wind",
    options: [
      { value: true, label: "On" },
      { value: false, label: "Off" },
    ],
  },
  {
    id: "avatarDetail",
    label: "Character detail",
    hint: "Mesh detail on people in the office",
    options: [
      { value: "high", label: "High" },
      { value: "standard", label: "Standard" },
    ],
  },
] as const) as readonly CustomControl[];

/** Every id Custom is allowed to write. Anything else is rejected by the store. */
export const CUSTOM_CONTROL_IDS: readonly CustomControlId[] = CUSTOM_CONTROLS.map((c) => c.id);

/** Whether `value` is one this control actually offers — the store's guard against a stale or hand-
 *  edited localStorage payload putting the renderer into a state no UI could have produced. */
export function isValidCustomValue(id: CustomControlId, value: unknown): boolean {
  const control = CUSTOM_CONTROLS.find((c) => c.id === id);
  if (!control) return false;
  return control.options.some((o) => o.value === value);
}

/**
 * Resolve the settings the renderer should run at.
 *
 * `level` is only consulted for "smooth" — it is the adaptive controller's current rung. "full" ignores
 * it entirely (that is the no-secret-adaptation guarantee, in one line) and "custom" layers the user's
 * overrides on the Full baseline so anything they have NOT touched stays at the approved value.
 */
export function resolveGraphics(mode: GraphicsMode, level: QualityLevel, custom: CustomGraphics): GraphicsSettings {
  if (mode === "full") return { ...FULL_GRAPHICS };
  if (mode === "smooth") return { ...SMOOTH_LADDER[level] };
  const base: GraphicsSettings = { ...FULL_GRAPHICS };
  for (const id of CUSTOM_CONTROL_IDS) {
    const v = custom[id];
    if (v === undefined || !isValidCustomValue(id, v)) continue;
    Object.assign(base, { [id]: v });
  }
  // Shadow map size is not its own control: it follows render quality, so "Performance" does not leave
  // a 2048 map being sampled into a 65%-scale buffer.
  base.shadowMapSize = SHADOW_MAP_SIZE_FOR_SCALE[String(base.renderScale)] ?? FULL_GRAPHICS.shadowMapSize;
  // AO resolution is not its own control either — a user who wants cheaper AO turns AO off.
  base.aoResolutionScale = base.renderScale >= 1 ? FULL_GRAPHICS.aoResolutionScale : 0.35;
  return base;
}

/** True when `a` and `b` ask the renderer for exactly the same thing. */
export function sameGraphics(a: GraphicsSettings, b: GraphicsSettings): boolean {
  return (
    a.renderScale === b.renderScale &&
    a.ambientOcclusion === b.ambientOcclusion &&
    a.aoResolutionScale === b.aoResolutionScale &&
    a.shadows === b.shadows &&
    a.shadowMapSize === b.shadowMapSize &&
    a.weatherEffects === b.weatherEffects &&
    a.effectsDetail === b.effectsDetail &&
    a.foliageSway === b.foliageSway &&
    a.avatarDetail === b.avatarDetail
  );
}
