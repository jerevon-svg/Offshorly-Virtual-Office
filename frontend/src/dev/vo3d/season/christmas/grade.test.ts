import { describe, expect, it } from "vitest";
import { ENV_PRESETS, blendPreset, overlay, type EnvPreset } from "../../env/presets";
import { CHRISTMAS_AUTO_PHASE, CHRISTMAS_GRADE, CHRISTMAS_SNOWFALL } from "./grade";
import type { EnvPhase } from "../../env/timeOfDay";

// ══ THE TEST THE HALLOWEEN PASS PAID FOR ══
//
// `blendPresetInto` copies `skyGrade` FIELD BY FIELD, and EVERY preset travels through it on its way
// to the screen (env/Environment.apply → blendPresetInto → write). So when `moonColor` and `moonScale`
// were added to the type, the blend silently dropped them: the blood moon never appeared, while the
// configured values looked perfectly correct in the source.
//
// The lesson is not "remember to update the blend". It is that A GRADE'S FIELDS MUST BE PROVED TO
// REACH THE RENDERER, because the failure mode is invisible in the source. So this walks the actual
// Christmas table, composes it exactly as the environment does, pushes the result through the actual
// blend, and asserts the value that comes out is the value that was written down.

const PHASES: EnvPhase[] = ["day", "sunset", "night"];

/** What the environment actually does on its way to the screen, in one function: compose the season's
 *  overlay onto the phase preset, then ride it through the blend that writes the renderer. */
function asShipped(phase: EnvPhase): EnvPreset {
  const composed = overlay(ENV_PRESETS[phase], CHRISTMAS_GRADE[phase]);
  return blendPreset(composed, composed, 1);
}

describe("every configured Christmas value survives the trip to the renderer", () => {
  it.each(PHASES)("%s — no field is dropped between the grade and the screen", (phase) => {
    const wanted = CHRISTMAS_GRADE[phase];
    const shipped = asShipped(phase) as unknown as Record<string, unknown>;

    for (const [key, value] of Object.entries(wanted)) {
      if (value === null || typeof value !== "object") {
        expect(shipped[key], `${phase}.${key}`).toBe(value);
        continue;
      }
      // Nested groups (key/fill/hemi/fog/skyGrade) are PARTIAL overlays, so only the keys the season
      // actually set are checked — the rest legitimately come from the phase preset underneath.
      const got = shipped[key] as Record<string, unknown>;
      expect(got, `${phase}.${key}`).toBeTruthy();
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) {
        expect(got[inner], `${phase}.${key}.${inner}`).toBe(innerValue);
      }
    }
  });

  it("states the moon's colour and size, which is the exact pair the blend used to drop", () => {
    // Not a redundant case: the general walk above would pass if the season simply never set them.
    // This pins that Christmas DOES exercise the repaired path, so the repair stays tested.
    expect(CHRISTMAS_GRADE.night.skyGrade?.moonColor).toBeDefined();
    expect(CHRISTMAS_GRADE.night.skyGrade?.moonScale).toBeDefined();
    expect(asShipped("night").skyGrade.moonColor).toBe(CHRISTMAS_GRADE.night.skyGrade?.moonColor);
    expect(asShipped("night").skyGrade.moonScale).toBe(CHRISTMAS_GRADE.night.skyGrade?.moonScale);
  });
});

describe("what kind of season this is, in numbers", () => {
  it("is BRIGHT in every phase — a dim white Christmas is a grey one", () => {
    // The brief's sharpest note: this is not "the office, darker". Night is the case that matters,
    // because it is the one a seasonal grade is always tempted to crush.
    for (const phase of PHASES) {
      expect(asShipped(phase).exposure, phase).toBeGreaterThan(0.85);
    }
    expect(asShipped("night").exposure).toBeGreaterThan(ENV_PRESETS.night.exposure);
  });

  it("lifts the GROUND half of the ambient in every phase — this is the snow bounce", () => {
    // The defining lighting fact of the season, and the one thing that separates it from a blue
    // filter: snow throws light back UP, so the hemisphere's ground colour cannot stay dark.
    for (const phase of PHASES) {
      const ours = asShipped(phase).hemi.ground;
      const ordinary = ENV_PRESETS[phase].hemi.ground;
      const luma = (c: number) => ((c >> 16) & 255) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114;
      expect(luma(ours), phase).toBeGreaterThan(luma(ordinary));
    }
  });

  it("does not override AUTO, unlike Halloween — the real clock still decides", () => {
    expect(CHRISTMAS_AUTO_PHASE).toBeNull();
  });

  it("asks for a restrained snowfall, in the four numbers weather already speaks in", () => {
    expect(Object.keys(CHRISTMAS_SNOWFALL).sort()).toEqual(["length", "opacity", "perMillion", "speed"]);
    expect(CHRISTMAS_SNOWFALL.perMillion).toBeGreaterThan(0);
    // A flake is a wide soft quad rather than a thin streak, so the same count as heavy rain reads as
    // a blizzard. This is the ceiling the brief's "restrained particle counts" sets.
    expect(CHRISTMAS_SNOWFALL.perMillion).toBeLessThan(600);
  });
});
