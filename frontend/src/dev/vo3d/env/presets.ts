// vo3d env — the DAY / SUNSET / NIGHT PRESENTATION TABLE.
//
// One flat data record per phase. Every global knob the environment owns lives here and nowhere else, so
// the presentation can be re-graded without touching a builder, a room or a light.
//
// DAY is deliberately byte-for-byte the lighting V2's rooms were built and approved under (Renderer's
// DEFAULT_LIGHT), so switching the environment on does not re-grade a single interior at midday. Only the
// background changes, because there is now a world where the cream void used to be.
//
// FUTURE-COMPATIBILITY, stated so it is not re-litigated later:
//   • WEATHER (next phase) multiplies/overrides these fields rather than replacing the table — a
//     normalized CLEAR/CLOUDY/RAIN/HEAVY_RAIN/THUNDERSTORM state becomes an `EnvOverlay` composed onto
//     the phase preset by `overlay()`. Nothing weather-shaped is implemented here.
//   • CONTINUOUS 24h INTERPOLATION is likewise NOT implemented. `blendPreset` exists and is tested so the
//     data shape is provably interpolatable, but the environment only ever applies a discrete phase.
import type { SkyGrade } from "./Sky";
import type { EnvPhase } from "./timeOfDay";

export type EnvPreset = {
  /** scene background, and the colour distance haze resolves to */
  sky: number;
  /** linear fog, expressed as OFFSETS from the camera's orbit distance (see Renderer.CAM_DIST) so the
   *  office at the orbit target always sits in front of the haze regardless of zoom. null = no fog. */
  fog: { near: number; far: number } | null;
  /** the sun/moon: one directional key light */
  key: { color: number; intensity: number; azimuth: number; elevation: number };
  /** the cool bounce opposite the key */
  fill: { color: number; intensity: number };
  /** global hemisphere ambient */
  hemi: { sky: number; ground: number; intensity: number };
  envIntensity: number;
  exposure: number;
  /** Multiply applied to the EXTERIOR scenery's own base colours. This is how night gets dark GROUND
   *  while interiors stay readable: the global lights keep lighting the rooms, and the environment dims
   *  the surfaces it built itself. No room-specific hack, and no per-room light. */
  exteriorTint: number;
  /** exterior practical lights: 0 = dark … 1 = full … >1 pushes past nominal for a night that reads */
  practicals: number;
  /** the dome overhead: gradient, star field and moon (see env/Sky) */
  skyGrade: SkyGrade;
  /** OFFICE-MODE BACKDROP. In office presentation the exterior world is not drawn at all, so the margin
   *  around the building needs a ground tone of its own — V1's flat stage, graded by time of day. It is a
   *  backdrop, never a landscape: nothing about it hints that a world exists. */
  stage: number;
};

export const ENV_PRESETS: Record<EnvPhase, EnvPreset> = {
  // Clean natural daylight. Warm key high in the sky, soft shadows, practicals off, fresh landscape.
  day: {
    sky: 0xa8cde6,
    fog: { near: 1400, far: 5200 },
    skyGrade: { top: 0x77b4e4, horizon: 0xcfe6f2, stars: 0, moon: 0 },
    stage: 0xe7ded4,
    key: { color: 0xfff1e0, intensity: 2.3, azimuth: -48, elevation: 62 },
    fill: { color: 0xe4ecff, intensity: 0.35 },
    hemi: { sky: 0xfff4ea, ground: 0xcdb9a6, intensity: 1.25 },
    envIntensity: 0.45,
    exposure: 1.12,
    exteriorTint: 1,
    practicals: 0,
  },
  // Warm orange/pink atmosphere. The key drops to 18° — long raking shadows across the campus — swings
  // round to the west, and the exposure lifts slightly so glass picks up the sky instead of going flat.
  sunset: {
    sky: 0xea8f56,
    fog: { near: 1100, far: 4400 },
    skyGrade: { top: 0xd9694e, horizon: 0xffc07a, stars: 0, moon: 0 },
    stage: 0xd8ad8c,
    // 16 deg, swung round to the west: shadows rake roughly four times their midday length while still
    // fitting the shadow frustum (below ~14 deg a lamp post's shadow runs off the end of the map).
    key: { color: 0xff9436, intensity: 2.55, azimuth: -112, elevation: 16 },
    fill: { color: 0xffb98a, intensity: 0.34 },
    hemi: { sky: 0xffc48c, ground: 0x7f5f4c, intensity: 1.0 },
    envIntensity: 0.6,
    exposure: 1.22,
    exteriorTint: 0.9,
    practicals: 0.62,
  },
  // Cool blue moonlight. The ambient stays high enough that interiors and the landscape both read; the
  // EXTERIOR is darkened by exteriorTint rather than by pulling the lights down, which would take the
  // office interiors with it.
  night: {
    sky: 0x0b1330,
    fog: { near: 950, far: 3900 },
    skyGrade: { top: 0x070d24, horizon: 0x1d2c52, stars: 0.95, moon: 1 },
    stage: 0x27304a,
    // moonlight: cool, low, and from the opposite side to the day sun
    key: { color: 0x8fa8e0, intensity: 0.52, azimuth: 26, elevation: 62 },
    fill: { color: 0x6179bd, intensity: 0.14 },
    // A WARM hemisphere sky colour with the ambient pulled right down. Hemisphere `color` lights
    // UP-FACING surfaces, which indoors means every floor and desk — so this is what keeps the office
    // feeling occupied and lamp-lit rather than washed white, without one room-specific light. The
    // landscape gets the same warm term but is taken back down by exteriorTint below.
    hemi: { sky: 0x8a705a, ground: 0x222b40, intensity: 0.72 },
    // The IBL is a WARM interior studio environment (RoomEnvironment). Leaning on it at night is how the
    // office keeps a warm, readable inside while the street goes cold and dark: it is a global term, so no
    // room is special-cased, and the exterior is pulled back down by exteriorTint instead.
    // The IBL is a warm interior studio environment (RoomEnvironment); leaning on it is the other half
    // of a warm inside against a cold outside.
    envIntensity: 0.58,
    exposure: 1.14,
    exteriorTint: 0.22,
    practicals: 1.45,
  },
};

/** A partial re-grade of a preset. The shape WEATHER will arrive as; unused today. */
export type EnvOverlay = Partial<Omit<EnvPreset, "key" | "fill" | "hemi" | "fog" | "skyGrade">> & {
  key?: Partial<EnvPreset["key"]>;
  fill?: Partial<EnvPreset["fill"]>;
  hemi?: Partial<EnvPreset["hemi"]>;
  fog?: EnvPreset["fog"];
  skyGrade?: Partial<SkyGrade>;
};

/** Compose an overlay onto a preset. Pure; the environment does not call it yet. */
export function overlay(base: EnvPreset, mod: EnvOverlay): EnvPreset {
  return {
    ...base,
    ...mod,
    key: { ...base.key, ...mod.key },
    fill: { ...base.fill, ...mod.fill },
    hemi: { ...base.hemi, ...mod.hemi },
    fog: mod.fog !== undefined ? mod.fog : base.fog,
    skyGrade: { ...base.skyGrade, ...mod.skyGrade },
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Component-wise colour lerp on packed 0xRRGGBB ints. */
export function lerpHex(a: number, b: number, t: number): number {
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, t));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t));
  const bl = Math.round(lerp(a & 255, b & 255, t));
  return (r << 16) | (g << 8) | bl;
}

/** Interpolate two presets. Proof that the presentation data is smoothly blendable — and, since the
 *  weather/time TRANSITION landed, the thing the environment actually rides every frame while a grade is
 *  moving. V2 still only ever TARGETS a discrete phase × weather pair; the blend is how it gets there. */
export function blendPreset(a: EnvPreset, b: EnvPreset, t: number): EnvPreset {
  return blendPresetInto(clonePreset(a), a, b, t);
}

/** A deep, independently-mutable copy. The seed for a preset a caller intends to write into. */
export function clonePreset(p: EnvPreset): EnvPreset {
  return {
    ...p,
    skyGrade: { ...p.skyGrade },
    fog: p.fog ? { ...p.fog } : null,
    key: { ...p.key },
    fill: { ...p.fill },
    hemi: { ...p.hemi },
  };
}

/** THE ALLOCATION-FREE BLEND. Same maths as blendPreset, written into a preset the caller already owns.
 *
 *  This exists because a SMOOTH transition runs the blend once per frame, and a version that returns a
 *  fresh object (plus five fresh nested ones) would be six allocations per frame for the whole of every
 *  Clear→Rain fade — exactly the per-frame garbage the environment is otherwise careful never to make.
 *
 *  `out` MAY ALIAS `a` — that is the normal call, `blendPresetInto(shown, shown, target, u)`. Every field
 *  is therefore read from a/b and written to out exactly once, in that order, with no field read back
 *  after it has been written. */
export function blendPresetInto(out: EnvPreset, a: EnvPreset, b: EnvPreset, t: number): EnvPreset {
  const u = Math.max(0, Math.min(1, t));
  out.sky = lerpHex(a.sky, b.sky, u);
  out.stage = lerpHex(a.stage, b.stage, u);
  out.skyGrade.top = lerpHex(a.skyGrade.top, b.skyGrade.top, u);
  out.skyGrade.horizon = lerpHex(a.skyGrade.horizon, b.skyGrade.horizon, u);
  out.skyGrade.stars = lerp(a.skyGrade.stars, b.skyGrade.stars, u);
  out.skyGrade.moon = lerp(a.skyGrade.moon, b.skyGrade.moon, u);
  // Fog is the one field that can be absent. Two fogged presets interpolate; anything else snaps at the
  // midpoint rather than inventing a fog that neither end has.
  if (a.fog && b.fog) {
    const near = lerp(a.fog.near, b.fog.near, u), far = lerp(a.fog.far, b.fog.far, u);
    if (out.fog) { out.fog.near = near; out.fog.far = far; } else out.fog = { near, far };
  } else {
    const src = u < 0.5 ? a.fog : b.fog;
    out.fog = src ? (out.fog ? Object.assign(out.fog, src) : { ...src }) : null;
  }
  out.key.color = lerpHex(a.key.color, b.key.color, u);
  out.key.intensity = lerp(a.key.intensity, b.key.intensity, u);
  out.key.azimuth = lerp(a.key.azimuth, b.key.azimuth, u);
  out.key.elevation = lerp(a.key.elevation, b.key.elevation, u);
  out.fill.color = lerpHex(a.fill.color, b.fill.color, u);
  out.fill.intensity = lerp(a.fill.intensity, b.fill.intensity, u);
  out.hemi.sky = lerpHex(a.hemi.sky, b.hemi.sky, u);
  out.hemi.ground = lerpHex(a.hemi.ground, b.hemi.ground, u);
  out.hemi.intensity = lerp(a.hemi.intensity, b.hemi.intensity, u);
  out.envIntensity = lerp(a.envIntensity, b.envIntensity, u);
  out.exposure = lerp(a.exposure, b.exposure, u);
  out.exteriorTint = lerp(a.exteriorTint, b.exteriorTint, u);
  out.practicals = lerp(a.practicals, b.practicals, u);
  return out;
}
