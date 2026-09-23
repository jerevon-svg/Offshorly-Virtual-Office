// vo3d season/christmas — THE ENVIRONMENT GRADE. One EnvOverlay per time-of-day phase, plus the
// snowfall the season asks the precipitation channel for.
//
// THIS IS THE LARGEST SINGLE LEVER IN THE WHOLE SEASON, and it costs nothing: no geometry, no draw
// calls, no textures. Composed onto the resolved weather × phase preset with env/presets' existing
// `overlay()` — the same seam weather already uses, so a season and a snow shower compose rather than
// fight.
//
// ══ WHAT A WHITE CHRISTMAS IS, IN LIGHTING TERMS ══
//
// It is NOT "the office, bluer", and it is emphatically not "the office, darker". Three measurements
// off the reference drive everything below, and the third is the one that is easy to miss:
//
//   · THE GROUND IS A LIGHT SOURCE. Snow throws almost everything back up. So the hemisphere's GROUND
//     colour — which in every ordinary preset is the dark half of the ambient — is lifted to a pale
//     blue-white in all three phases. That single value is what makes an interior read as "lit from a
//     snowfield outside" rather than as an interior with a cold filter over it.
//   · THE HIGHLIGHTS ARE WHITE AND THE SHADOWS ARE BLUE, never the reverse. The key stays a clean
//     near-white at every hour and the FILL carries the ice, so a lit face is snow-white and the face
//     turned away goes icy — which is the entire read of the reference image.
//   · IT IS BRIGHT — BUT THE BRIGHTNESS COMES FROM THE SNOW, NOT FROM THE EXPOSURE. The office is a
//     CREAM MINIATURE whose ordinary day grade already sits close to clipping, so there is very little
//     headroom to spend: a season that simply turned everything up would flatten the architecture it
//     is decorating. The lit budget therefore sits AT OR JUST BELOW the ordinary preset for day and
//     sunset, and the whiteness is carried by the SNOW MATERIALS — near-white, faintly emissive, and
//     the brightest things in the frame precisely because everything around them was not raised. That
//     is the relationship Halloween trades on with its pumpkins, in the opposite direction.
//
//     NIGHT IS THE ONE PHASE THAT SPENDS MORE than the office normally does, and it earns it:
//     moonlight on a snowfield is one of the brightest natural night conditions there is.
//
//     A CORRECTION WORTH RECORDING, because it nearly got written into this table as a lighting rule:
//     during this pass the whole office appeared as a flat white rectangle and the grade was the first
//     suspect. It was not the grade. It was a CSS rule in styles/christmasTheme.css that painted the
//     full-screen DOM overlay opaque (see the note there). `gl.readPixels` showed a correctly lit
//     office the entire time. Nothing in this file caused it, and nothing in this file should be
//     darkened to compensate for it.
//
// ══ AUTO IS DELIBERATELY NOT OVERRIDDEN, AND THAT IS A DIFFERENCE FROM HALLOWEEN ══
//
// Halloween forces AUTO to dusk, because a haunted office at midday fights its own art direction. A
// white Christmas has no such hour: the brief asks for day, sunset and night to each be beautiful, and
// all three are graded here to be. So `CHRISTMAS_AUTO_PHASE` is null — AUTO keeps resolving from V1's
// real clock exactly as it does in the ordinary office, and an employee who has *chosen* a time keeps
// that too. Nothing about time-of-day behaviour changes when this season is on.
//
// ══ EVERY FIELD HERE SURVIVES THE TRIP TO THE RENDERER, AND THAT WAS CHECKED ══
//
// The Halloween lesson: `blendPresetInto` copies `skyGrade` FIELD BY FIELD, so two fields added to the
// type (`moonColor`, `moonScale`) were silently dropped between the grade and the sky and the blood
// moon never appeared. This grade therefore introduces NO NEW PRESET FIELD — every key below is one
// `overlay()` composes and `blendPresetInto` copies today, and season/christmas/grade.test.ts asserts
// exactly that by walking the table against the blend rather than by trusting this paragraph.
import type { EnvOverlay } from "../../env/presets";
import type { EnvPhase } from "../../env/timeOfDay";

/** WHAT AUTO MEANS DURING CHRISTMAS: exactly what it means in the ordinary office. See the header. */
export const CHRISTMAS_AUTO_PHASE: EnvPhase | null = null;

export const CHRISTMAS_GRADE: Record<EnvPhase, EnvOverlay> = {
  // ══ DAY — BRIGHT, LUMINOUS WINTER DAYLIGHT ══
  //
  // The phase the brief leads with, and the easiest to get wrong in the direction of "cold". The sun is
  // clean and near-white rather than warm, it sits LOW (a winter sun does), and the ambient's GROUND
  // half is recoloured from day's warm brown bounce to a pale blue-white — a snowfield throws light
  // back up where grass swallows it. What does NOT happen is the whole budget going up; see the
  // header's third measurement for the render that settled that.
  day: {
    sky: 0xcfe4f5,
    // A LIGHT HAZE, not a fog. Enough to give the far scenery the cold-air softness a snow day has,
    // nowhere near enough to make the office sit in murk.
    fog: { near: 1300, far: 5000 },
    skyGrade: { top: 0x9dc8ea, horizon: 0xeaf4fb, stars: 0, moon: 0 },
    // THE OFFICE-MODE BACKDROP IS SNOW. In office presentation the exterior world is not drawn at all,
    // so this flat tone IS the ground around the building — and making it snow-white is the cheapest
    // and most complete "snow-covered surroundings" there is.
    stage: 0xe9f2fa,
    // A LOW, CLEAN, ALMOST WHITE SUN. Low for the long raking shadows a winter noon actually casts;
    // white so that a lit surface goes snow-white rather than cream.
    key: { color: 0xf2f8ff, intensity: 2.8, azimuth: -52, elevation: 34 },
    // THE SHADOWS ARE THE ICE. The whole icy-blue identity lives in this one value, which is why the
    // key above can stay neutral without the scene going grey.
    fill: { color: 0xbcd8ff, intensity: 0.36 },
    // COOLER THAN THE ORDINARY DAY, AND NOT BRIGHTER. The ground half is still lifted relative to
    // day's warm brown bounce — that is the snow throwing light back up — but the INTENSITY comes
    // down, because the sum of the two is what clipped the building white on the first render.
    hemi: { sky: 0xdfeeff, ground: 0xb4cbe2, intensity: 0.82 },
    envIntensity: 0.3,
    // BELOW the ordinary day preset's 1.06. The cream architecture has to keep its form, and the
    // snow materials are what carry the brightness.
    exposure: 0.98,
    exteriorTint: 1,
    // A few practicals lit even at midday: the reference's lanterns are on in daylight, and it is what
    // stops a bright scene reading as empty.
    practicals: 0.22,
    // KEPT AT THE ORDINARY DAY'S LEVEL. AO is the only thing putting creases into a near-monochrome
    // white scene, and the first render proved that a white office with no occlusion is not "clean",
    // it is shapeless.
    ao: 0.55,
  },
  // ══ SUNSET — A PALE WINTER SUNSET, NOT A GOLDEN ONE ══
  //
  // The trap is the ordinary sunset preset's saturated orange, which over a white season reads as a
  // warm filter and throws the palette away. This one is CHAMPAGNE AND BLUSH on the lit side and
  // unapologetically ICY in the shadows — the warm/cool split at low saturation, which is what a
  // real winter afternoon looks like at four o'clock.
  //
  // The moon is already up, small and pale. It is a real winter sky detail and it also exercises the
  // `moonColor` / `moonScale` path that the Halloween pass found broken.
  sunset: {
    sky: 0xf0cfc2,
    fog: { near: 1150, far: 4400 },
    skyGrade: {
      top: 0xa9a3c6, horizon: 0xffd6bf, stars: 0.12,
      moon: 0.45, moonColor: 0xf4f8ff, moonScale: 1.25,
    },
    // Snow takes the sunset without becoming orange: a blush-white, still obviously snow.
    stage: 0xf2e3dc,
    key: { color: 0xffd3ac, intensity: 2.4, azimuth: -108, elevation: 13 },
    // THE COOL HALF, AND IT IS STRONGER THAN THE ORDINARY SUNSET'S. Blue shadows on snow under a warm
    // sun is the single most recognisable image in winter photography.
    fill: { color: 0x8fb6e8, intensity: 0.5 },
    hemi: { sky: 0xf7d8c8, ground: 0xb8c8e0, intensity: 0.72 },
    envIntensity: 0.34,
    exposure: 1.0,
    exteriorTint: 0.95,
    practicals: 0.78,
    ao: 0.6,
  },
  // ══ NIGHT — MAGICAL, NOT GLOOMY ══
  //
  // THE CORRECTION HALLOWEEN PAID FOR, APPLIED IN ADVANCE. That season's first night grade took the
  // general light almost to zero and the office stopped being usable; the fix was to give the darkness
  // a colour and a direction. Here the same principle has an easier job, because SNOW AT NIGHT IS
  // GENUINELY BRIGHT — moonlight on a snowfield is one of the brightest natural night conditions
  // there is, and rendering it dark would be wrong as well as ugly.
  //
  // So: a strong cool moon as a real directional key, a hemisphere well above the ordinary night's
  // (the snow bounce again), an exposure much closer to daylight than to Halloween's, and AO kept low
  // so the lift buys softness rather than mud. The trees, lanterns and fairy lights then read as WARM
  // points inside a COOL luminous blue — which is the contrast the brief is describing.
  night: {
    sky: 0x11223f,
    fog: { near: 950, far: 3900 },
    // A LARGE, PALE, SILVER MOON — the night's own hero element, and the reason the snow is lit at all.
    skyGrade: { top: 0x0a1730, horizon: 0x36527f, stars: 1, moon: 1, moonColor: 0xeef4ff, moonScale: 1.7 },
    // A LUMINOUS blue-grey, not a dark one: this is moonlit snow around the building.
    stage: 0x55688d,
    key: { color: 0xbcd2ff, intensity: 1.35, azimuth: 26, elevation: 55 },
    fill: { color: 0x4a6bb5, intensity: 0.24 },
    // MORE THAN DOUBLE the ordinary night's hemisphere, and the ground half is lifted hardest. Snow
    // under a moon throws light back up; an office standing in it is lit from below as well as above.
    hemi: { sky: 0x6f92d8, ground: 0x2e4269, intensity: 0.54 },
    envIntensity: 0.18,
    // ABOVE the ordinary night's 0.74 and well above Halloween's 0.7 — the one phase where this season
    // genuinely spends more light than the office normally does. "Peaceful", not "dark office", and
    // the first fixed capture of night still read grey-blue at 0.80, so it is up again.
    exposure: 0.88,
    // Snow holds light: the exterior is dimmed far less at night than the ordinary preset dims it.
    exteriorTint: 0.55,
    practicals: 1.4,
    ao: 0.5,
  },
};

/** WHAT THE PRECIPITATION CHANNEL IS ASKED FOR WHILE THIS SEASON IS ON.
 *
 *  The same four numbers weather already speaks in (env/weatherGrade's RainParams), so the season needs
 *  no new field, no new transition and no second particle system — env/Environment swaps the field into
 *  SNOW mode and the existing budget, fade, office-presentation gate and outdoor-only placement all
 *  apply unchanged. See env/Rain.ts: no flake is ever PLACED over the building, so "no snow indoors"
 *  is a property of the geometry rather than a test done per fragment.
 *
 *  RESTRAINED ON PURPOSE. 380 flakes per million square units is roughly a third of what HEAVY_RAIN
 *  spends, because a flake is a wide soft quad rather than a thin streak and the same count reads as a
 *  blizzard. `speed` is a quarter of rain's and `length` is 1 — a flake drifts, it does not fall. */
export const CHRISTMAS_SNOWFALL = { perMillion: 380, opacity: 0.85, speed: 26, length: 1 } as const;
