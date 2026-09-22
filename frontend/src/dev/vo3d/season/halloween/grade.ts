// vo3d season/halloween — THE ENVIRONMENT GRADE. One EnvOverlay per time-of-day phase.
//
// THIS IS THE LARGEST SINGLE LEVER IN THE WHOLE SEASON, and it costs nothing: no geometry, no draw
// calls, no textures. Composed onto the resolved weather × phase preset with env/presets' existing
// `overlay()` — the same seam weather already uses, so a season and a thunderstorm compose rather than
// fight.
//
// ══ WHAT THE REFERENCE ACTUALLY IS, IN LIGHTING TERMS ══
//
// It is not "the office, darker". It is a room with the GENERAL LIGHT ALMOST SWITCHED OFF and a dozen
// small warm sources doing all the work. Three measurements drive everything below:
//
//   · the ambient is violet-charcoal and very low — the walls read ~#3a3340, not grey;
//   · there is one weak, low, warm key raking across, not a sun overhead;
//   · the ONLY bright things in frame are the pumpkins and candles, which are emissive geometry in our
//     build and therefore survive a low exposure untouched.
//
// So: hemisphere down hard and tinted violet, key down and warmed and dropped low in the sky, exposure
// down, fog pulled in to violet, `practicals` up (the exterior's own lamps are part of the mood), and
// `ao` up because a dim room is where contact occlusion does the most work. The emissive decorations
// then read as the brightest things in the frame without being turned up at all — which is exactly the
// relationship the reference has.
//
// ══ AUTO GIVES THE INTENDED MOOD; MANUAL CONTROLS ARE PRESERVED ══
//
// An employee on AUTO gets the season's intended atmosphere because the season's own DEFAULT PHASE
// (below) is what AUTO resolves to while Halloween is on. An employee who has *chosen* a time of day or
// a weather state keeps it — the overlay is applied to whatever phase they picked, so their choice
// still moves the world, it just moves it within the season. Nothing here overrides a manual control;
// see season/SeasonLayer.ts, which is what reads DEFAULT_PHASE and only for the AUTO case.
import type { EnvOverlay } from "../../env/presets";
import type { EnvPhase } from "../../env/timeOfDay";

/** WHAT AUTO MEANS DURING HALLOWEEN. A Halloween office at midday fights its own reference, so AUTO —
 *  and only AUTO — resolves to dusk. A manual time selection is never touched. */
export const HALLOWEEN_AUTO_PHASE: EnvPhase = "night";

/** The violet-charcoal the whole season is graded toward. Everything else is stated relative to it. */
const VIOLET_DEEP = 0x1a1622;

/** the warm light the pumpkins throw back into the room. Kept as the palette note the grade is reasoned
 *  against even though the night bounce is now cool — see the sepia correction in the night entry. */
const EMBER_LIGHT = 0xffa055;

export const HALLOWEEN_GRADE: Record<EnvPhase, EnvOverlay> = {
  // ══ DAY MUST BE HAUNTED TOO, AND NOT BY BEING DARK ══
  //
  // The brief's sharpest note: spooky does not mean darker. A Halloween office that is only eerie
  // after sunset is an office that is ordinary for most of the working day.
  //
  // So morning and afternoon are lit — genuinely readable, brighter than night — and unsettling by
  // OTHER means: a sickly desaturated sky with a green-grey cast, a cold overcast key with almost no
  // warmth in it, fog pulled close so the building sits in haze rather than clear air, and a raised
  // AO that puts hard grime into every crease. It is the light of a bad afternoon before a storm,
  // not the light of a nice one. The decorations then read against it rather than glowing in it,
  // which is the right relationship for daylight.
  day: {
    sky: 0x5f6560,
    // FOG PULLED HARD IN. The single biggest daytime lever: the building sitting in haze rather than
    // clear air is what stops a lit scene reading as a nice day.
    fog: { near: 300, far: 1250 },
    skyGrade: { top: 0x4d5450, horizon: 0x8a8a76, stars: 0, moon: 0 },
    stage: 0x55564a,
    // A WEAK, COLD, HIGH SUN. Overcast light with the warmth taken out of it.
    key: { color: 0xbfc4a8, intensity: 1.05, azimuth: -62, elevation: 30 },
    // The bounce is SICKLY GREEN-GREY, which is what makes cream walls look unwell rather than
    // simply lit. This one value is most of the daytime unease.
    // SICKLY GREEN-GREY, and much stronger than the first attempt, which was so close to neutral
    // that the day read as an ordinary overcast afternoon with pumpkins in it.
    fill: { color: 0x79895f, intensity: 0.5 },
    hemi: { sky: 0x7f8a6a, ground: 0x3f4038, intensity: 0.5 },
    envIntensity: 0.12,
    exposure: 0.78,
    exteriorTint: 0.52,
    practicals: 0.35,
    // High for a lit scene on purpose: grime in every crease is what separates "overcast" from
    // "neglected", and it costs nothing.
    ao: 0.62,
  },
  // ══ SUNSET IS THE BLOOD MOON ══
  //
  // The most theatrical of the three, and the one the brief singles out: a huge red moon low over a
  // crimson sky, the whole office raked by red-orange light with deep shadows between. The moon is
  // drawn at 2.4x and recoloured outright, so it is the hero element of the frame rather than a
  // normal moon with a tint on it.
  sunset: {
    sky: 0x4a1d24,
    fog: { near: 520, far: 2000 },
    skyGrade: {
      top: 0x2a1020, horizon: 0xb8362a, stars: 0.35,
      moon: 1, moonColor: 0xff2f1e, moonScale: 2.4,
    },
    stage: 0x4a2a2a,
    // A LOW, RED, RAKING KEY. Long shadows across every floor is what makes it theatrical rather
    // than merely orange.
    key: { color: 0xff5a2a, intensity: 1.35, azimuth: -78, elevation: 7 },
    fill: { color: 0x7a3a5e, intensity: 0.3 },
    hemi: { sky: 0x8e3b44, ground: 0x2a1626, intensity: 0.42 },
    envIntensity: 0.1,
    exposure: 0.8,
    exteriorTint: 0.6,
    practicals: 0.85,
    ao: 0.62,
  },
  // NIGHT is the target the season is designed around, and what AUTO resolves to.
  //
  // ══ THE CORRECTION THAT MATTERS MOST HERE ══
  //
  // The first cut of this grade took the general light almost to zero on the theory that the pumpkins
  // should own the room. On screen that was not atmospheric, it was unreadable: rooms, furniture,
  // walkways and avatars all disappeared into near-black and the office stopped being usable.
  //
  // The fix is not "turn the lights back on" — it is to give the darkness a COLOUR and a DIRECTION.
  // MOONLIGHT IS THE PRIMARY AMBIENT FILL: a genuinely bright cool-violet hemisphere that lifts every
  // surface to a readable deep purple, with the moon itself as a real directional key so there is a lit
  // side and a shadow side. The pumpkins then read as WARM against that COOL, which is the contrast the
  // reference actually trades on — orange focal light against violet gloom, not orange against black.
  //
  // So: hemisphere up hard and violet (this is the moonlight), key up and cold from a low angle,
  // exposure back to near-normal, and `ao` kept high so the lift buys depth rather than flatness.
  night: {
    sky: VIOLET_DEEP,
    fog: { near: 620, far: 2400 },
    // A LARGE, COLD, UNMISTAKABLE MOON — the night's own hero element.
    skyGrade: { top: 0x150f22, horizon: 0x453257, stars: 1, moon: 1, moonColor: 0xdfd6ff, moonScale: 1.9 },
    stage: 0x342c44,
    // THE MOON, and it is a real key: cold, low, and strong enough to model a face and cast a shadow.
    key: { color: 0x9f93d8, intensity: 0.55, azimuth: -88, elevation: 22 },
    // The warm bounce stays, but as the MINOR half of the contrast — this is pumpkin light filling
    // the shadow side, and it is what stops the violet reading as a cold blue-grey wash.
    fill: { color: EMBER_LIGHT, intensity: 0.26 },
    // THE MOONLIGHT ITSELF. The single most important number in the season: it is what makes rooms,
    // furniture and avatars readable, and its COLOUR is what makes the readable version still feel
    // haunted rather than merely dim.
    // SATURATED violet at MODERATE strength, not pale violet at full strength. The difference decides
    // whether cream walls are TINTED purple (haunted, readable) or merely LIT (a normal office at
    // night). The first correction overshot to the second and had to come back.
    hemi: { sky: 0x6a51b5, ground: 0x241c38, intensity: 0.34 },
    envIntensity: 0.06,
    exposure: 0.7,
    exteriorTint: 0.5,
    practicals: 1.15,
    // Held high deliberately: a lifted ambient flattens contact shadows, and AO is what puts the
    // depth back without taking the readability away again.
    ao: 0.66,
  },
};
