// vo3d env — WHERE WEATHER AND TIME OF DAY COMPOSE.
//
// THE COMPOSITION RULE, in one line:
//
//     presentation = blendPreset( ENV_PRESETS[phase] , overlay(ENV_PRESETS[phase], OVERCAST[phase]) , weight )
//
// The day/sunset/night table is the BASE and is never edited, replaced or branched on. Each phase gets one
// OVERCAST TARGET expressed as a partial re-grade of itself, and a weather state is a WEIGHT along that
// line. So DAY+RAIN is day's own lighting pulled toward day's own overcast — not a fourth preset, and not
// a weather table that has to be re-authored every time the clock table is re-graded. Both seams
// (`overlay`, `blendPreset`) already existed in env/presets and were written for exactly this.
//
// V1's officePhase rules are not touched, read or re-derived anywhere in this file.
//
// WHY INTERIORS STAY WARM UNDER RAIN. The knobs split cleanly:
//   • exteriorTint and practicals touch ONLY the exterior scenery's own surfaces and fixtures. They do the
//     heavy lifting — "the outside got darker and colder" is almost entirely these two.
//   • key/fill/hemi/envIntensity are global and DO reach the rooms, so the overcast targets drop the KEY
//     (a rainy sky has no hard sun) while LIFTING hemisphere ambient and the warm RoomEnvironment IBL to
//     compensate. Net effect indoors: shadows soften, brightness holds, warmth holds. This is the same
//     mechanism the night preset already uses, not a new one.
import { ENV_PRESETS, blendPreset, overlay, type EnvOverlay, type EnvPreset } from "./presets";
import type { EnvPhase } from "./timeOfDay";
import type { WeatherState } from "./weather";

/** How far along the base → overcast line each state sits. CLEAR is 0 by definition: a clear sky must be
 *  byte-for-byte the approved day/sunset/night presentation, so the weather layer is provably invisible
 *  when it is not raining. */
export const WEATHER_WEIGHT: Record<WeatherState, number> = {
  clear: 0,
  cloudy: 0.52,
  rain: 0.84,
  heavy_rain: 1,
  thunderstorm: 1,
};

/** The rain FIELD's parameters per state (see env/Rain).
 *
 *  `perMillion` is streaks per million square world units of ground it is actually raining on — an AREAL
 *  density, not a pool fraction. That is what keeps a downpour looking like the same downpour whether the
 *  camera is standing in the lobby or framing the whole campus: the field box changes size constantly with
 *  zoom and pitch, and a fixed streak count would thin out to drizzle every time it grew.
 *
 *  HEAVY_RAIN and THUNDERSTORM deliberately reuse RAIN's machinery at a higher density rather than
 *  pretending to a treatment they do not have yet: no lightning, no wind shear, no gust. That is the
 *  "normalize cleanly rather than receive full effects" contract, made explicit. */
export type RainParams = { perMillion: number; opacity: number; speed: number; length: number };
export const RAIN_PARAMS: Record<WeatherState, RainParams> = {
  clear: { perMillion: 0, opacity: 0, speed: 0, length: 1 },
  cloudy: { perMillion: 0, opacity: 0, speed: 0, length: 1 },
  rain: { perMillion: 1500, opacity: 0.42, speed: 620, length: 1 },
  heavy_rain: { perMillion: 2200, opacity: 0.5, speed: 760, length: 1.22 },
  thunderstorm: { perMillion: 2600, opacity: 0.54, speed: 820, length: 1.34 },
};

/** How wet the exterior GROUND reads. Drives roughness only (see build/exterior applyWetness) — colour is
 *  left to exteriorTint so the two levers can never fight over the same channel. */
export const WETNESS: Record<WeatherState, number> = {
  clear: 0,
  cloudy: 0.1,
  rain: 0.82,
  heavy_rain: 1,
  thunderstorm: 1,
};

/** THE OVERCAST TARGETS. One partial re-grade per phase — only the fields weather actually changes.
 *
 *  The sun's AZIMUTH and ELEVATION are absent from every one of these on purpose: weather must not move
 *  the sun. Sunset's 16° rake is inside the shadow frustum by exactly as much as it was, and the shadow
 *  map is invalidated once per weather change rather than needing a new frame budget. */
const OVERCAST: Record<EnvPhase, EnvOverlay> = {
  // A grey Manila afternoon: the sun becomes a bright patch behind cloud rather than a light source.
  day: {
    sky: 0x9dabb4,
    stage: 0xd5d2ce,
    skyGrade: { top: 0x8e9ea9, horizon: 0xc0c7c9, stars: 0, moon: 0 },
    fog: { near: 900, far: 3400 }, // the murk closes in; the far landscape goes first
    key: { color: 0xdfe6ef, intensity: 1.15 },
    fill: { color: 0xd7e2f0, intensity: 0.5 },
    hemi: { sky: 0xe9e2d7, ground: 0xa8a59d, intensity: 1.45 },
    envIntensity: 0.62,
    exposure: 1.14,
    exteriorTint: 0.74,
    practicals: 0.5, // street lamps come on in the gloom — the first read that something changed outside
  },
  // Rain at dusk. The warm band survives but goes bruised and hazy rather than golden.
  sunset: {
    sky: 0xa2867a,
    stage: 0xc7aa9a,
    skyGrade: { top: 0x8c6a63, horizon: 0xd4a58a, stars: 0, moon: 0 },
    fog: { near: 800, far: 2900 },
    key: { color: 0xe7a377, intensity: 1.2 },
    fill: { color: 0xe0c3b4, intensity: 0.46 },
    hemi: { sky: 0xe6c3a6, ground: 0x7e6a60, intensity: 1.2 },
    envIntensity: 0.68,
    exposure: 1.18,
    exteriorTint: 0.7,
    practicals: 1.0,
  },
  // A wet night. THE STARS GO OUT — cloud cover is the reason it is raining, so a full star field over a
  // downpour would be the one thing that gives the whole composition away.
  night: {
    sky: 0x121a2c,
    stage: 0x232a3a,
    skyGrade: { top: 0x0c1220, horizon: 0x232c3e, stars: 0, moon: 0.12 },
    fog: { near: 700, far: 2500 },
    key: { color: 0x8496b8, intensity: 0.34 },
    fill: { color: 0x5d6f9e, intensity: 0.16 },
    hemi: { sky: 0x7d6a5e, ground: 0x1e2432, intensity: 0.8 },
    envIntensity: 0.64,
    exposure: 1.12,
    exteriorTint: 0.19,
    practicals: 1.6, // a wet street is carried by its lamps
  },
};

/** The presentation for a (weather × phase) pair. Pure; allocates one preset. */
export function weatherPreset(state: WeatherState, phase: EnvPhase): EnvPreset {
  const base = ENV_PRESETS[phase];
  const w = WEATHER_WEIGHT[state];
  if (w <= 0) return base; // CLEAR is the approved presentation, untouched and not even copied
  return blendPreset(base, overlay(base, OVERCAST[phase]), w);
}

/** Everything the renderer needs for a state, in one pull. */
export type WeatherGrade = { preset: EnvPreset; rain: RainParams; wetness: number };
export function weatherGrade(state: WeatherState, phase: EnvPhase): WeatherGrade {
  return { preset: weatherPreset(state, phase), rain: RAIN_PARAMS[state], wetness: WETNESS[state] };
}

/** Does this state draw a rain field at all? (CLEAR and CLOUDY do not.) */
export const isRaining = (s: WeatherState): boolean => RAIN_PARAMS[s].perMillion > 0;
