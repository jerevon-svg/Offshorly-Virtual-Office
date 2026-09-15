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
 *  HEAVY_RAIN and THUNDERSTORM reuse RAIN's machinery at a higher density rather than each getting a
 *  field of their own. What separates them is no longer only density: WIND and LIGHTNING below are the
 *  two other axes a state moves along, and both are gains on machinery that already exists rather than
 *  new systems per state. There is still no gust/shear model — a streak falls the same way in all three. */
export type RainParams = { perMillion: number; opacity: number; speed: number; length: number };
export const RAIN_PARAMS: Record<WeatherState, RainParams> = {
  clear: { perMillion: 0, opacity: 0, speed: 0, length: 1 },
  cloudy: { perMillion: 0, opacity: 0, speed: 0, length: 1 },
  rain: { perMillion: 1500, opacity: 0.42, speed: 620, length: 1 },
  heavy_rain: { perMillion: 2200, opacity: 0.5, speed: 760, length: 1.22 },
  thunderstorm: { perMillion: 2600, opacity: 0.54, speed: 820, length: 1.34 },
};

/** HOW HARD THE AIR IS MOVING, per state. Drives the exterior foliage sway (build/exterior applyWind) and
 *  nothing else — it is a gain on an animation that already runs, not a wind simulation.
 *
 *  CLEAR IS NOT ZERO. A perfectly still world reads as a photograph; a fair-weather campus still has a
 *  breath of air in it. The jump that matters is CLEAR → RAIN, where the canopies visibly start working.
 *  Nothing above THUNDERSTORM's 1.0: past that the low-poly canopies stop reading as trees bending and
 *  start reading as trees melting, which was the ceiling found by eye. */
export const WIND: Record<WeatherState, number> = {
  clear: 0.16,
  cloudy: 0.3,
  rain: 0.7,
  heavy_rain: 0.9,
  thunderstorm: 1,
};

/** LIGHTNING, per state. null = this state never strikes, and the scheduler is not even running.
 *
 *  `minGap`/`maxGap` are seconds between strikes, drawn uniformly — the RANGE is what keeps it from
 *  reading as a metronome, and the minimum is what keeps it from ever reading as a strobe. Even
 *  THUNDERSTORM's floor of 9s is a long time on screen.
 *
 *  RAIN STRIKES TOO, rarely. A Manila shower with the occasional distant flash is the common case, and
 *  reserving lightning for the THUNDERSTORM code would mean almost never seeing it. */
export type LightningParams = {
  /** seconds — the shortest gap between strikes */
  minGap: number;
  /** seconds — the longest */
  maxGap: number;
  /** 0…1 chance a strike carries a second pulse a beat behind the first */
  doubleChance: number;
  /** 0…1 ceiling on how bright a strike of this state can be, before distance falloff */
  strength: number;
};
export const LIGHTNING: Record<WeatherState, LightningParams | null> = {
  clear: null,
  cloudy: null,
  rain: { minGap: 28, maxGap: 72, doubleChance: 0.3, strength: 0.55 },
  heavy_rain: { minGap: 17, maxGap: 46, doubleChance: 0.42, strength: 0.8 },
  thunderstorm: { minGap: 9, maxGap: 27, doubleChance: 0.55, strength: 1 },
};

/** HOW MUCH OF A STRIKE THE EYE ACTUALLY GETS, per phase. Not a second lightning table — one multiplier
 *  on the one envelope, because a flash is only as visible as the sky it has to out-shine. At noon a
 *  strike is a flicker at the edge of vision; at night it prints the whole campus on the retina. */
/** DAY WAS TOO FAR DOWN TO SEE. 0.34 of a flash against a lit sky is below the threshold at which a
 *  viewer registers that anything happened at all — the strike was firing correctly and simply could not
 *  be perceived. Night keeps the full flash (it never needed help); day and sunset are lifted to where
 *  the event reads, while staying obviously weaker than a night strike, which is the true relationship. */
export const LIGHTNING_PHASE_GAIN: Record<EnvPhase, number> = { day: 0.58, sunset: 0.8, night: 1 };

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
    // THESE ARE RELATIVE TO THE CLEAR-SKY BASE, and the base moved. The Full Graphics re-grade spends its
    // budget on the sun and holds ambient low; an overcast target left at its old absolute ambient would
    // now be BRIGHTER than a clear noon, which is the one thing a storm must never be. The relationship —
    // key cut to roughly a third, ambient lifted by about a sixth, exposure trimmed — is what is preserved.
    key: { color: 0xdfe6ef, intensity: 0.9 },
    fill: { color: 0xd7e2f0, intensity: 0.5 },
    hemi: { sky: 0xe9e2d7, ground: 0xa8a59d, intensity: 1.08 },
    envIntensity: 0.46,
    // EXPOSURE IS WHAT MAKES OVERCAST MOODY, not the ambient. The ambient has a job — it is lifted above
    // the clear-sky base precisely so interiors do not go dark when the key is cut, and weather.test holds
    // that contract. Exposure is the global that darkens everything without touching how the rooms are
    // lit, which is exactly the "flat, grey and a bit dimmer" a rainy day actually looks like.
    exposure: 0.96,
    exteriorTint: 0.74,
    practicals: 0.5, // street lamps come on in the gloom — the first read that something changed outside
    // OVERCAST IS THE LOW-CONTACT CONDITION. Cloud is one enormous soft light source, so real creases get
    // filled in and a screen-space darkening that stayed at clear-sky strength would be the one thing
    // announcing that the AO is a post effect rather than light.
    ao: 0.4,
  },
  // Rain at dusk. The warm band survives but goes bruised and hazy rather than golden.
  sunset: {
    sky: 0xa2867a,
    stage: 0xc7aa9a,
    skyGrade: { top: 0x8c6a63, horizon: 0xd4a58a, stars: 0, moon: 0 },
    fog: { near: 800, far: 2900 },
    key: { color: 0xe7a377, intensity: 1.0 },
    fill: { color: 0xe0c3b4, intensity: 0.46 },
    hemi: { sky: 0xe6c3a6, ground: 0x7e6a60, intensity: 0.84 },
    envIntensity: 0.56,
    exposure: 1.0,
    exteriorTint: 0.7,
    practicals: 1.0,
    ao: 0.44,
  },
  // A wet night. THE STARS GO OUT — cloud cover is the reason it is raining, so a full star field over a
  // downpour would be the one thing that gives the whole composition away.
  night: {
    sky: 0x121a2c,
    stage: 0x232a3a,
    skyGrade: { top: 0x0c1220, horizon: 0x232c3e, stars: 0, moon: 0.12 },
    fog: { near: 700, far: 2500 },
    key: { color: 0x8496b8, intensity: 0.3 }, // cloud over a moon: the last hard light in the world goes
    fill: { color: 0x5d6f9e, intensity: 0.16 },
    hemi: { sky: 0x55607a, ground: 0x171d2c, intensity: 0.3 },
    envIntensity: 0.2,
    // still BELOW a clear night's own exposure would be wrong the other way — cloud over a city glows a
    // little. A touch up from 0.92, nowhere near day.
    exposure: 0.64,
    exteriorTint: 0.19,
    // A WET STREET IS CARRIED BY ITS LAMPS, and it has to out-do a clear night, which now runs its own
    // fixtures at 1.75. This was 1.6 against a 1.45 clear night; the base moved, so this moves with it.
    practicals: 2.0,
    ao: 0.3,
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
export type WeatherGrade = { preset: EnvPreset; rain: RainParams; wetness: number; wind: number; lightning: LightningParams | null };
export function weatherGrade(state: WeatherState, phase: EnvPhase): WeatherGrade {
  return {
    preset: weatherPreset(state, phase),
    rain: RAIN_PARAMS[state],
    wetness: WETNESS[state],
    wind: WIND[state],
    lightning: LIGHTNING[state],
  };
}

/** Does this state draw a rain field at all? (CLEAR and CLOUDY do not.) */
export const isRaining = (s: WeatherState): boolean => RAIN_PARAMS[s].perMillion > 0;
