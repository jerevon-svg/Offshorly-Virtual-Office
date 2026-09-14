// vo3d audio — WHERE THE LISTENER IS, AND WHAT THAT SHOULD SOUND LIKE. Pure arithmetic: no Web Audio,
// no THREE, no DOM. Everything the environmental mixer does about place, weather and time of day is
// decided here and nowhere else, which is what makes it testable without an AudioContext.
//
// ONE MIX, NOT ELEVEN ROOM SYSTEMS. There is a small, FIXED set of beds (see BED_IDS) and every zone in
// the world is expressed as a set of weights across that set. A room does not get an audio system; it
// gets a number. That is the whole reason eleven reconstructed rooms cost the same as one.
//
// NOTHING HERE FADES. These are TARGETS. The engine approaches them exponentially (audio/EnvironmentalAudio
// TAU), so crossing a doorway is a crossfade rather than a cut, and this file never has to know about time.
import type { RegionKind } from "../world/WorldState";
import type { WeatherState } from "../env/weather";
import type { EnvPhase } from "../env/timeOfDay";

/** THE BEDS. Bounded, fixed, and allocated once for the life of the engine. Adding a twelfth room does
 *  not add a bed; it adds a weight. */
export type BedId = "wind" | "city" | "night" | "office" | "hub" | "gaming" | "ai" | "cave" | "portal" | "rain";
export const BED_IDS: BedId[] = ["wind", "city", "night", "office", "hub", "gaming", "ai", "cave", "portal", "rain"];

/** THE ZONES. Five places the world can sound like, plus the sealed theatre. Every room that is not the
 *  Hub, the Gaming room or the AI room is "office" — a shared interior tone, by design. */
export type ZoneId = "outside" | "office" | "hub" | "gaming" | "ai" | "cave";

/** The only rooms whose identity earns a bed of its own. Everything else shares the office tone. */
export const ROOM_ZONES: Record<string, ZoneId> = {
  "central-hub": "hub",
  "gaming-room": "gaming",
  "ai-room": "ai",
};

export type ZoneContext = {
  /** the CAVE outranks every other signal: it is a sealed volume in its own world space */
  inCave: boolean;
  /** what WorldState.regionAt said the body is standing on; null = outside the modelled world */
  regionKind: RegionKind | null;
  roomId: string | null;
  /** world units from the body to the CAVE portal's stand point; Infinity when it is not known */
  portalDistance: number;
  /** world units from the body to the nearest edge of the office frame. Small = next to the glass, which
   *  is where rain should still be audible indoors. Infinity when outdoors (it means nothing there). */
  edgeDistance: number;
  weather: WeatherState;
  /** 0…1 within the weather state, straight off the provider */
  intensity: number;
  phase: EnvPhase;
};

/** What the engine is asked to sound like this frame. Written INTO — never returned freshly built, so the
 *  per-frame path allocates nothing. */
export type ZoneMix = {
  beds: Record<BedId, number>;
  /** 0…1 chance-weight that a bird is worth scheduling at all (day + fair weather + outdoors) */
  birds: number;
  /** 0 = rain heard in the open · 1 = rain heard through a wall. Drives the rain bed's low-pass. */
  muffle: number;
};

export const emptyMix = (): ZoneMix => ({
  beds: { wind: 0, city: 0, night: 0, office: 0, hub: 0, gaming: 0, ai: 0, cave: 0, portal: 0, rain: 0 },
  birds: 0,
  muffle: 0,
});

/** RESTRAINT LIVES HERE. These are the loudest any bed is ever asked to be, as a fraction of master. The
 *  interior numbers are deliberately an order below the exterior ones: a room tone that can be picked out
 *  of a quiet room is already too loud. */
export const LEVEL = {
  wind: { outside: 0.3, inside: 0.045, cave: 0 },
  city: { outside: 0.15, inside: 0.028, cave: 0 },
  night: { outside: 0.1 },
  /** the shared interior tone, under every indoor zone. A room with its own bed keeps a thinner bed of it. */
  office: { plain: 0.055, under: 0.032 },
  hub: 0.07,
  gaming: 0.07,
  ai: 0.08,
  cave: 0.1,
  portal: 0.085,
  rain: { outside: 0.42, inside: 0.095, cave: 0 },
};

/** HOW MUCH RAIN EACH STATE IS, before intensity. Clear and cloudy are silent — cloud makes no sound. */
export const RAIN_WEIGHT: Record<WeatherState, number> = {
  clear: 0, cloudy: 0, rain: 0.55, heavy_rain: 0.85, thunderstorm: 1,
};
/** HOW MUCH WIND EACH STATE IS. Never zero: still air outdoors reads as a broken audio system. */
export const WIND_WEIGHT: Record<WeatherState, number> = {
  clear: 0.35, cloudy: 0.5, rain: 0.65, heavy_rain: 0.85, thunderstorm: 1,
};

/** TIME OF DAY IS A WEIGHT, NOT A SECOND ENGINE. The same beds, turned down. */
export const PHASE_WEIGHT: Record<EnvPhase, { outdoor: number; city: number; birds: number; night: number }> = {
  day: { outdoor: 1, city: 1, birds: 1, night: 0 },
  sunset: { outdoor: 0.85, city: 0.7, birds: 0.35, night: 0.25 },
  night: { outdoor: 0.6, city: 0.35, birds: 0, night: 1 },
};

/** how close to the portal the theatre starts bleeding through, in world units */
export const PORTAL_RANGE = 260;
/** how close to the building's edge counts as "by the glass", in world units */
export const EDGE_RANGE = 180;
/** birds need fair weather as well as daylight; rain of any kind silences them */
export const BIRD_WEATHER: Record<WeatherState, number> = {
  clear: 1, cloudy: 0.35, rain: 0, heavy_rain: 0, thunderstorm: 0,
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** WHERE AM I? The one classification, used by the mix and by the readout. */
export function zoneFor(ctx: ZoneContext): ZoneId {
  if (ctx.inCave) return "cave";
  if (ctx.regionKind === null || ctx.regionKind === "exterior") return "outside";
  const room = ctx.roomId ? ROOM_ZONES[ctx.roomId] : undefined;
  return room ?? "office";
}

/** THE MIX, written into `out`. Allocation-free and total: every bed is assigned on every call, so no
 *  bed can be left holding a weight from a zone the listener has left. */
export function mixInto(out: ZoneMix, ctx: ZoneContext): ZoneMix {
  const zone = zoneFor(ctx);
  const b = out.beds;
  const phase = PHASE_WEIGHT[ctx.phase];
  const outside = zone === "outside";
  const cave = zone === "cave";

  // ---- exterior air ------------------------------------------------------------------------------
  // A sealed theatre hears none of it. An interior hears a trace, which is what makes stepping outside
  // read as stepping outside rather than as a bed switching on.
  const windSite = cave ? LEVEL.wind.cave : outside ? LEVEL.wind.outside : LEVEL.wind.inside;
  b.wind = windSite * WIND_WEIGHT[ctx.weather] * (outside ? phase.outdoor : 1);
  b.city = (cave ? LEVEL.city.cave : outside ? LEVEL.city.outside : LEVEL.city.inside) * phase.city;
  b.night = outside ? LEVEL.night.outside * phase.night : 0;

  // ---- interiors ---------------------------------------------------------------------------------
  // The shared office tone plays under EVERY indoor zone; a room with its own character keeps a thinner
  // bed of it rather than replacing it, so the building still sounds like one building.
  const identity = zone === "hub" || zone === "gaming" || zone === "ai";
  b.office = cave || outside ? 0 : identity ? LEVEL.office.under : LEVEL.office.plain;
  b.hub = zone === "hub" ? LEVEL.hub : 0;
  b.gaming = zone === "gaming" ? LEVEL.gaming : 0;
  b.ai = zone === "ai" ? LEVEL.ai : 0;
  b.cave = cave ? LEVEL.cave : 0;

  // ---- the portal --------------------------------------------------------------------------------
  // A DISTANCE, not a zone: the theatre is felt before it is entered. Squared so the last few strides do
  // most of the work, which is what makes it read as discovery rather than as a fade.
  const near = cave ? 0 : clamp01(1 - ctx.portalDistance / PORTAL_RANGE);
  b.portal = LEVEL.portal * near * near;

  // ---- rain --------------------------------------------------------------------------------------
  // Indoors rain is quiet AND muffled, and it comes back toward the glass — which is the only place an
  // interior is allowed to hear the weather clearly.
  const rain = RAIN_WEIGHT[ctx.weather] * (0.55 + 0.45 * clamp01(ctx.intensity));
  const edgeNear = Number.isFinite(ctx.edgeDistance) ? clamp01(1 - ctx.edgeDistance / EDGE_RANGE) : 0;
  const rainSite = cave ? LEVEL.rain.cave : outside ? LEVEL.rain.outside : LEVEL.rain.inside * (0.55 + 0.45 * edgeNear);
  b.rain = rainSite * rain;
  out.muffle = outside || cave ? 0 : 1 - 0.45 * edgeNear;

  // ---- birds -------------------------------------------------------------------------------------
  out.birds = outside ? phase.birds * BIRD_WEATHER[ctx.weather] : 0;
  return out;
}
