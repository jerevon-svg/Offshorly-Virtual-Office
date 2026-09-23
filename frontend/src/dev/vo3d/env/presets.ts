// vo3d env — the DAY / SUNSET / NIGHT PRESENTATION TABLE.
//
// One flat data record per phase. Every global knob the environment owns lives here and nowhere else, so
// the presentation can be re-graded without touching a builder, a room or a light.
//
// DAY and Renderer's DEFAULT_LIGHT are ONE grade expressed twice (the renderer has to stand up before the
// environment exists). They move together or not at all; env.test asserts they are equal field for field.
//
// THE FULL GRAPHICS TARGET. The table was re-graded in one pass for depth rather than brightness. The
// single idea behind all three phases: A DIRECTIONAL KEY ONLY READS AS FAR AS THE AMBIENT LETS IT. The old
// grade lit rooms with a strong key AND a strong hemisphere, so every shadow was filled back in before it
// landed and the world read flat and creamy. Each phase now spends more of its budget on the DIRECTION and
// less on the FILL — key up, hemisphere/IBL down, exposure trimmed so the highlights stay clean rather
// than blowing — which is what buys architectural shadows, a lit side and a shadow side, and avatars that
// are modelled by the sun instead of floodlit from everywhere at once.
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
  /** CONTACT OCCLUSION, 0 = none … 1 = stock SSAOPass. Graded per phase for the same reason exposure is:
   *  AO is a darkening, and how much darkening a scene can absorb depends on how lit it already is. A hard
   *  midday key already carves its own creases, and a night interior has almost no light left to remove —
   *  so both sit lower than the raking, high-contrast sunset. Kept well under 1 throughout: past roughly
   *  0.7 the office's cream walls stop reading as occluded and start reading as dirty. */
  ao: number;
};

export const ENV_PRESETS: Record<EnvPhase, EnvPreset> = {
  // BRIGHT, RICH DAYLIGHT WITH SHADOWS IN IT. The sun is the loudest thing in the frame (2.3 -> 3.05) and
  // the hemisphere that used to fill its shadows straight back in is pulled down to match (1.25 -> 0.92),
  // so what lands on the floor is a real shadow rather than a tint. Exposure comes DOWN with the key going
  // up (1.12 -> 1.06): the same trade a camera makes, and what keeps cream architecture clean instead of
  // washed. The sun also drops 62 -> 54 degrees — a midday sun straight overhead casts almost nothing a
  // top-down camera can see, and eight degrees is worth about 40% more shadow length for no other change.
  day: {
    sky: 0xa8cde6,
    fog: { near: 1400, far: 5200 },
    skyGrade: { top: 0x77b4e4, horizon: 0xcfe6f2, stars: 0, moon: 0 },
    stage: 0xe7ded4,
    key: { color: 0xfff4e6, intensity: 3.05, azimuth: -48, elevation: 54 },
    // the shadow side is lit by SKY, and sky is blue. Cooler and slightly weaker than before, so the
    // unlit faces read as in-shadow rather than as a second, dimmer sun.
    fill: { color: 0xdbe7ff, intensity: 0.3 },
    hemi: { sky: 0xfff4ea, ground: 0xcdb9a6, intensity: 0.92 },
    envIntensity: 0.38,
    exposure: 1.06,
    exteriorTint: 1,
    practicals: 0,
    ao: 0.55,
  },
  // GOLDEN HOUR. The key swings round to the west and rakes at 15°, so shadows run roughly four times
  // their midday length, and it is the STRONGEST key of the three — a low sun is a bright one, and the
  // whole read is a hot lit side against a cool shadow side. Exposure comes DOWN from the old grade for
  // the same reason day's did: the brightness now lives in the direction, not in the exposure.
  sunset: {
    sky: 0xea8f56,
    fog: { near: 1100, far: 4400 },
    skyGrade: { top: 0xd9694e, horizon: 0xffc07a, stars: 0, moon: 0 },
    stage: 0xd8ad8c,
    // 15 deg, swung round to the west: shadows rake roughly four times their midday length while still
    // fitting the shadow frustum (below ~14 deg a lamp post's shadow runs off the end of the map).
    key: { color: 0xff9a3c, intensity: 3.2, azimuth: -112, elevation: 15 },
    // THE WARM/COOL SPLIT IS THE WHOLE POINT OF SUNSET, and the old fill was working against it: a warm
    // orange bounce opposite a warm orange sun leaves every face the same colour and the raking light with
    // nothing to rake against. The fill is now the COOL half of the sky, so a surface turned away from the
    // sun goes blue-shadowed while the sunlit face goes gold. Same one light, opposite colour.
    fill: { color: 0x8aa2d8, intensity: 0.42 },
    // the ambient comes down hard too: a low sun is a low-ambient condition, and holding the hemisphere at
    // day levels is what previously turned the golden hour into an orange filter over a flat room.
    hemi: { sky: 0xffc48c, ground: 0x6b5a54, intensity: 0.7 },
    envIntensity: 0.46,
    exposure: 1.14,
    exteriorTint: 0.9,
    practicals: 0.62,
    // the phase with the most contrast to work with, so it can carry the most contact occlusion
    ao: 0.66,
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
    // THE MOON IS NIGHT'S SUNSET SUN. Sunset has an unmistakable identity because its key is strong AND
    // strongly coloured; night needs the same treatment in the opposite direction, or it is just a scene
    // with the lights turned down. So the key is LIFTED hard (0.52 -> 1.25) and its colour saturated to a
    // real moon blue, which is what puts visible cool light on floors, worktops, planting and avatars, and
    // leaves everything it does not reach in a cool shadow. What still makes it read as NIGHT is the
    // AMBIENT and the EXPOSURE below being a fraction of day's — never a weak or absent key, which only
    // ever produces a flat, crushed image in which nothing is modelled and nothing is grounded.
    key: { color: 0x86b0ff, intensity: 1.25, azimuth: 26, elevation: 62 },
    fill: { color: 0x3f5aa8, intensity: 0.16 },
    // THE HEMISPHERE IS NOW COOL, AND THAT IS THE WHOLE FIX. Hemisphere `color` lights UP-FACING
    // surfaces, which from this camera is almost the entire image — every floor, every desk, every
    // worktop. Holding it WARM (which is what the grade used to do, to keep interiors feeling occupied)
    // meant night rendered as a slightly dimmer DAY: same cream floors, same warm cast, no read at all.
    // Cool moonlight on the broad surfaces is what finally separates the two times of day.
    //
    // The office does not go cold as a result, because the warmth was never the hemisphere's job to do:
    // every room already carries its own warm emissive fixtures — the Executive sconces and shelf coves,
    // the Project/Meeting cove walls, the Dev cove line, every screen and LED strip. None of them is
    // touched by any light in this table, so as the lit budget comes down they are what is left, which
    // is exactly what a warm interior at night looks like from outside it.
    hemi: { sky: 0x486cb4, ground: 0x0d1220, intensity: 0.26 },
    // The IBL is a WARM interior studio environment (RoomEnvironment), and it is KEPT — small. It is the
    // low warm bounce off furniture that stops a cool key over a cool hemisphere turning the whole floor
    // plate into one flat blue wash. It is no longer what carries night's brightness, though: leaning on
    // it was how the old grade kept the office readable, and that is precisely what stopped night being
    // dark. The exterior is pulled down separately by exteriorTint.
    envIntensity: 0.18,
    // BELOW DAY'S EXPOSURE, which is what finally makes night read as night. Everything emissive in the
    // world — screens, LED strips, the practicals, every Ambient channel in every room — is unaffected by
    // any of the four lights above, so pulling the LIT budget down is the entire mechanism by which they
    // become the brightest thing on screen. No emissive is touched, no interior light is added, and no
    // room is special-cased: the fixtures get prominent because everything around them stopped shouting.
    exposure: 0.74,
    exteriorTint: 0.2,
    practicals: 1.75,
    // least of the three: there is barely any lit surface left to take light off, and AO on an already
    // dark interior only ever reads as mud.
    ao: 0.42,
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
  // THE MOON'S COLOUR AND SIZE, which a season may set and the ordinary grades leave absent.
  //
  // THIS LINE IS WHY THE BLOOD MOON DID NOT APPEAR. Every preset travels through this function on
  // its way to the screen, and it copies skyGrade FIELD BY FIELD — so two fields added to the type
  // were silently dropped between the grade and the sky, and the moon kept drawing at its default
  // size and colour while the configured values looked perfectly correct in the source.
  //
  // Colour is interpolated like every other colour; SIZE SNAPS AT THE MIDPOINT rather than growing,
  // because a moon that swells while the light changes reads as a zoom, not as dusk.
  out.skyGrade.moonColor = a.skyGrade.moonColor !== undefined && b.skyGrade.moonColor !== undefined
    ? lerpHex(a.skyGrade.moonColor, b.skyGrade.moonColor, u)
    : (u < 0.5 ? a.skyGrade.moonColor : b.skyGrade.moonColor);
  out.skyGrade.moonScale = u < 0.5 ? a.skyGrade.moonScale : b.skyGrade.moonScale;
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
  out.ao = lerp(a.ao, b.ao, u);
  return out;
}
