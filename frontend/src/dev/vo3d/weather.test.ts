import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { phaseForHour } from "../../data/officePhase";
import { ENV_PRESETS } from "./env/presets";
import { TimeOfDay, type EnvPhase } from "./env/timeOfDay";
import {
  WEATHER_MODES, WEATHER_STATES, Weather, intensityForRate, stateForWmoCode,
  type WeatherObservation, type WeatherProvider, type WeatherState,
} from "./env/weather";
import { ManualWeatherProvider } from "./env/providers/manual";
import {
  LIGHTNING, LIGHTNING_PHASE_GAIN, RAIN_PARAMS, WEATHER_WEIGHT, WETNESS, WIND,
  isRaining, weatherGrade, weatherPreset,
} from "./env/weatherGrade";
import { Lightning, envelope, type ThunderEvent } from "./env/Lightning";
import { RAIN_POOL, Rain } from "./env/Rain";
import { buildExterior } from "./build/exterior";
import { FRAME } from "./adapters/v1Floor";
import { GRADE } from "./world/campus";

const PHASES: EnvPhase[] = ["day", "sunset", "night"];

describe("vo3d weather — the model is the app's, not a provider's", () => {
  it("normalizes every WMO present-weather code into our five states and nothing else", () => {
    for (let code = 0; code <= 120; code++) expect(WEATHER_STATES).toContain(stateForWmoCode(code));
    // the anchors a real provider actually reports
    expect(stateForWmoCode(0)).toBe("clear");
    expect(stateForWmoCode(1)).toBe("clear");
    expect(stateForWmoCode(3)).toBe("cloudy");
    expect(stateForWmoCode(48)).toBe("cloudy"); // fog — overcast is the honest read
    expect(stateForWmoCode(53)).toBe("rain"); // drizzle
    expect(stateForWmoCode(63)).toBe("rain");
    expect(stateForWmoCode(65)).toBe("heavy_rain");
    expect(stateForWmoCode(81)).toBe("rain"); // showers
    expect(stateForWmoCode(82)).toBe("heavy_rain"); // violent showers
    expect(stateForWmoCode(73)).toBe("cloudy"); // snow: not modelled, normalized rather than invented
    expect(stateForWmoCode(95)).toBe("thunderstorm");
    expect(stateForWmoCode(99)).toBe("thunderstorm");
    expect(stateForWmoCode(-4)).toBe("clear"); // garbage in, a state out — never undefined
  });

  it("saturates a precipitation rate into a 0..1 intensity", () => {
    expect(intensityForRate(0)).toBe(0);
    expect(intensityForRate(Number.NaN)).toBe(0);
    expect(intensityForRate(4)).toBeCloseTo(0.5, 6);
    expect(intensityForRate(400)).toBe(1);
  });

  it("AUTO follows the provider; a dev override changes only what V2 reads", async () => {
    const p = new ManualWeatherProvider("rain");
    const w = new Weather(p, 0);
    w.state(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(w.observed).toBe("rain");
    expect(w.state(1)).toBe("rain");
    expect(w.overridden).toBe(false);

    w.mode = "clear";
    expect(w.state(2)).toBe("clear");
    expect(w.overridden).toBe(true);
    expect(w.observed).toBe("rain"); // the provider kept running underneath and was not written to

    w.mode = "auto";
    expect(w.state(3)).toBe("rain");
    expect(WEATHER_MODES[0]).toBe("auto");
  });

  it("with no provider configured, AUTO falls back cleanly and never fetches", () => {
    const w = new Weather(null);
    expect(w.state(0)).toBe("clear");
    expect(w.source).toContain("none configured");
    w.mode = "heavy_rain";
    expect(w.state(0)).toBe("heavy_rain"); // the dev override still works with no source at all
  });

  it("throttles the provider read and keeps the last good value when one fails", async () => {
    let reads = 0;
    let fail = false;
    const flaky: WeatherProvider = {
      id: "flaky", label: "flaky",
      read: (): Promise<WeatherObservation> => {
        reads++;
        return fail ? Promise.reject(new Error("down")) : Promise.resolve({ state: "rain", intensity: 1, label: "x", observedAt: 1 });
      },
    };
    const w = new Weather(flaky, 600_000);
    for (let f = 0; f < 600; f++) w.state(f * 16);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toBe(1); // 9.6s of frames, one poll window
    expect(w.state(1000)).toBe("rain");

    fail = true;
    w.invalidate();
    w.state(2000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toBe(2);
    expect(w.state(2001)).toBe("rain"); // a rejected fetch must not flicker the sky
  });

  it("is a genuinely separate axis from the clock — neither reads the other", () => {
    let hour = 21;
    const t = new TimeOfDay(() => hour, 0);
    const w = new Weather(null);
    w.mode = "thunderstorm";
    expect(t.phase(0)).toBe("night");
    expect(w.state(0)).toBe("thunderstorm");
    hour = 12;
    expect(t.phase(1)).toBe("day");
    expect(w.state(1)).toBe("thunderstorm"); // changing the clock changed no weather
    w.mode = "clear";
    expect(t.phase(2)).toBe("day"); // ...and changing the weather changed no time
    expect(phaseForHour(12)).toBe("day"); // V1's own rules, untouched
  });
});

describe("vo3d weather — composition with day / sunset / night", () => {
  it("leaves the approved CLEAR presentation byte-for-byte alone", () => {
    for (const p of PHASES) {
      expect(weatherPreset("clear", p)).toBe(ENV_PRESETS[p]); // the same object: nothing is even copied
      expect(WEATHER_WEIGHT.clear).toBe(0);
      expect(RAIN_PARAMS.clear.perMillion).toBe(0);
      expect(WETNESS.clear).toBe(0);
      expect(isRaining("clear")).toBe(false);
    }
  });

  it("reaches all six DAY/SUNSET/NIGHT × CLEAR/RAIN combinations, each distinct", () => {
    const seen = new Set<string>();
    for (const p of PHASES) for (const w of ["clear", "rain"] as WeatherState[]) seen.add(JSON.stringify(weatherPreset(w, p)));
    expect(seen.size).toBe(6);
  });

  it("darkens and cools the EXTERIOR under rain without taking the interiors with it", () => {
    for (const p of PHASES) {
      const clear = ENV_PRESETS[p];
      const rain = weatherPreset("rain", p);
      // exteriorTint and practicals touch only the exterior's own surfaces and fixtures
      expect(rain.exteriorTint, p).toBeLessThan(clear.exteriorTint);
      expect(rain.practicals, p).toBeGreaterThan(clear.practicals);
      // the haze closes in
      expect(rain.fog!.far, p).toBeLessThan(clear.fog!.far);
      // the hard sun goes...
      expect(rain.key.intensity, p).toBeLessThan(clear.key.intensity);
      // ...but the sun does NOT MOVE: the shadow frustum was sized for these angles
      expect(rain.key.azimuth, p).toBe(clear.key.azimuth);
      expect(rain.key.elevation, p).toBe(clear.key.elevation);
      // INTERIOR READABILITY: ambient and the warm interior IBL are lifted to pay for the lost key
      expect(rain.hemi.intensity, p).toBeGreaterThanOrEqual(clear.hemi.intensity);
      expect(rain.envIntensity, p).toBeGreaterThan(clear.envIntensity);
    }
  });

  it("puts out the stars when it rains at night — the cloud is why it is raining", () => {
    expect(ENV_PRESETS.night.skyGrade.stars).toBeGreaterThan(0.5);
    expect(weatherPreset("rain", "night").skyGrade.stars).toBeLessThan(0.2);
    expect(weatherPreset("clear", "night").skyGrade.stars).toBe(ENV_PRESETS.night.skyGrade.stars);
  });

  it("orders the states monotonically, so unimplemented ones normalize rather than misbehave", () => {
    for (const p of PHASES) {
      const t = (w: WeatherState) => weatherPreset(w, p).exteriorTint;
      expect(t("clear")).toBeGreaterThan(t("cloudy"));
      expect(t("cloudy")).toBeGreaterThan(t("rain"));
      expect(t("rain")).toBeGreaterThanOrEqual(t("heavy_rain"));
    }
    // CLOUDY is graded but draws no rain; HEAVY_RAIN and THUNDERSTORM reuse RAIN's field, denser
    expect(isRaining("cloudy")).toBe(false);
    expect(RAIN_PARAMS.rain.perMillion).toBeLessThan(RAIN_PARAMS.heavy_rain.perMillion);
    expect(RAIN_PARAMS.heavy_rain.perMillion).toBeLessThanOrEqual(RAIN_PARAMS.thunderstorm.perMillion);
    for (const w of WEATHER_STATES) {
      const g = weatherGrade(w, "day");
      expect(g.wetness).toBeGreaterThanOrEqual(0);
      expect(g.wetness).toBeLessThanOrEqual(1);
      expect(g.rain.opacity).toBeLessThanOrEqual(1);
    }
  });
});

describe("vo3d weather — the rain field", () => {
  const dry = FRAME;
  const centre = new THREE.Vector3(FRAME.x + FRAME.w / 2, 8, FRAME.z + FRAME.d / 2);
  const uni = (r: Rain) => (r.mesh.material as THREE.ShaderMaterial).uniforms;

  /** Replay the vertex shader's placement on the CPU for one seed, so the strip decomposition can be
   *  checked against the office rather than taken on trust. */
  function place(r: Rain, sx: number, sy: number): { x: number; z: number } {
    const u = uni(r);
    const cdf = u.uCdf.value as THREE.Vector4;
    const regs = [u.uRegA.value, u.uRegB.value, u.uRegC.value, u.uRegD.value] as THREE.Vector4[];
    const bounds = [0, cdf.x, cdf.y, cdf.z, 1];
    let i = 0;
    while (i < 3 && sx >= bounds[i + 1]) i++;
    const R = regs[i], lo = bounds[i], hi = bounds[i + 1];
    const t = (sx - lo) / Math.max(hi - lo, 1e-6);
    return { x: R.x + (R.z - R.x) * t, z: R.y + (R.w - R.y) * sy };
  }

  it("is one draw call and holds its pool, spending streaks by area rather than rebuilding buffers", () => {
    const r = new Rain(dry, GRADE);
    const geo = r.mesh.geometry as THREE.InstancedBufferGeometry;
    const seeds = geo.getAttribute("aSeed");
    expect(seeds.count).toBe(RAIN_POOL);
    expect(r.stats.draws).toBe(0); // clear by default: nothing drawn at all

    r.visible = true;
    r.setParams(RAIN_PARAMS.rain);
    r.follow(centre, 1000);
    expect(r.stats.draws).toBe(1);
    expect(r.stats.instances).toBeGreaterThan(0);
    expect(r.stats.triangles).toBe(r.stats.instances * 2); // two triangles per streak, and that is all
    const atRain = r.stats.instances;

    r.setParams(RAIN_PARAMS.heavy_rain);
    expect(r.stats.instances).toBeGreaterThan(atRain);
    expect(geo.getAttribute("aSeed")).toBe(seeds); // SAME buffer: no rebuild, no reupload

    r.setParams(RAIN_PARAMS.clear);
    expect(r.stats.draws).toBe(0);
    r.dispose();
  });

  it("keeps areal density constant as the field grows, instead of thinning to drizzle", () => {
    const r = new Rain(dry, GRADE);
    r.visible = true;
    r.setParams(RAIN_PARAMS.rain);
    r.follow(centre, 1100);
    const small = r.stats.instances;
    r.follow(centre, 2200);
    const big = r.stats.instances;
    expect(big).toBeGreaterThan(small); // four times the area asks for roughly four times the streaks
    expect(big).toBeLessThanOrEqual(RAIN_POOL); // ...and the pool is still the ceiling
    r.dispose();
  });

  it("NEVER PLACES A STREAK OVER THE OFFICE — at any framing, from any angle", () => {
    const r = new Rain(dry, GRADE);
    r.visible = true;
    r.setParams(RAIN_PARAMS.heavy_rain);
    const pad = 12;
    const corners: THREE.Vector3[] = [
      centre,
      new THREE.Vector3(FRAME.x, 8, FRAME.z), // camera parked on a corner of the building
      new THREE.Vector3(FRAME.x + FRAME.w, 8, FRAME.z + FRAME.d),
      new THREE.Vector3(-1400, 8, 2400), // right out on the campus
    ];
    for (const c of corners) {
      for (const half of [120, 400, 900, 1800, 4000]) { // including asks far smaller than the building
        r.follow(c, half);
        expect(r.stats.instances, `${c.x},${c.z} @ ${half}`).toBeGreaterThan(0); // it always rains somewhere
        for (let i = 0; i <= 40; i++) {
          for (let j = 0; j <= 4; j++) {
            const p = place(r, Math.min(0.99999, i / 40), j / 4);
            const insideX = p.x > FRAME.x - pad && p.x < FRAME.x + FRAME.w + pad;
            const insideZ = p.z > FRAME.z - pad && p.z < FRAME.z + FRAME.d + pad;
            expect(insideX && insideZ, `streak at ${Math.round(p.x)},${Math.round(p.z)} is over the office`).toBe(false);
          }
        }
      }
    }
    r.dispose();
  });

  it("grows the field until there is somewhere to rain, however tight the camera is", () => {
    const r = new Rain(dry, GRADE);
    // a camera framed on the middle of the building asks for a box smaller than the building itself
    expect(r.minHalf(centre)).toBeGreaterThan(FRAME.w / 2);
    r.visible = true;
    r.setParams(RAIN_PARAMS.rain);
    r.follow(centre, 10); // an absurd ask
    expect(r.stats.instances).toBeGreaterThan(0); // ...and it still rains, rather than rendering nothing
    r.dispose();
  });

  it("never casts, receives or invalidates a shadow", () => {
    const r = new Rain(dry, GRADE);
    expect(r.mesh.castShadow).toBe(false);
    expect(r.mesh.receiveShadow).toBe(false);
    const m = r.mesh.material as THREE.ShaderMaterial;
    expect(m.depthWrite).toBe(false); // rain occludes nothing...
    expect(m.depthTest).toBe(true); //  ...but a wall in front of it still occludes the rain
    expect(m.transparent).toBe(true);
    r.dispose();
  });

  it("holds a streak above the pixel floor, because a world unit is not a fixed size under ortho", () => {
    const r = new Rain(dry, GRADE);
    r.follow(centre, 1000, 0); // perspective: sizes itself by depth, needs no floor
    const narrow = uni(r).uWidth.value as number;
    r.follow(centre, 1000, 4); // ortho zoomed out: a world unit is worth far less than a pixel
    expect(uni(r).uWidth.value as number).toBeGreaterThan(narrow);
    r.dispose();
  });

  it("rides the camera with uniform writes only — no attribute touched per frame", () => {
    const r = new Rain(dry, GRADE);
    r.visible = true;
    r.setParams(RAIN_PARAMS.rain);
    const geo = r.mesh.geometry as THREE.InstancedBufferGeometry;
    const seeds = geo.getAttribute("aSeed") as THREE.InstancedBufferAttribute;
    const version = seeds.version;
    const u = uni(r);

    r.follow(new THREE.Vector3(400, 8, -200), 900);
    for (let f = 0; f < 240; f++) r.update(1 / 60);

    expect(u.uTime.value).toBeCloseTo(4, 3);
    expect(u.uTop.value).toBeGreaterThan(GRADE); // the column stands above the ground it lands on
    expect(u.uGround.value).toBe(GRADE);
    expect(seeds.version).toBe(version); // the seed buffer was never re-uploaded
    r.dispose();
  });

  it("stops the clock entirely while it is not drawn", () => {
    const r = new Rain(dry, GRADE);
    r.setParams(RAIN_PARAMS.rain); // raining, but no presentation has asked for it
    r.follow(centre, 900);
    const u = uni(r);
    for (let f = 0; f < 600; f++) r.update(1 / 60);
    expect(u.uTime.value).toBe(0);
    r.dispose();
  });
});

describe("vo3d weather — the exterior's wet response", () => {
  it("changes roughness and environment response, and never colour", () => {
    const sc = buildExterior();
    const wet: THREE.MeshStandardMaterial[] = [];
    sc.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && (m as THREE.Material).type === "MeshStandardMaterial" && !wet.includes(m)) wet.push(m);
    });
    sc.applyTint(1);
    sc.applyWetness(0);
    const dryR = wet.map((m) => m.roughness);
    const dryC = wet.map((m) => m.color.getHex());

    sc.applyWetness(1);
    const wetR = wet.map((m) => m.roughness);
    const wetC = wet.map((m) => m.color.getHex());

    expect(wetC).toEqual(dryC); // COLOUR IS exteriorTint's CHANNEL — wetness must never write it
    expect(wetR.some((r, i) => r !== dryR[i])).toBe(true); // something actually got wet
    // ground goes glossier (roughness DOWN) everywhere except the pond, which ripples (roughness UP)
    const smoother = wetR.filter((r, i) => r < dryR[i]).length;
    const rougher = wetR.filter((r, i) => r > dryR[i]).length;
    expect(smoother).toBeGreaterThan(0);
    expect(rougher).toBeGreaterThan(0);

    sc.applyWetness(0);
    expect(wet.map((m) => m.roughness)).toEqual(dryR); // and it goes all the way back
  });

  it("clamps out-of-range and non-finite input rather than poisoning a material", () => {
    const sc = buildExterior();
    const mats: THREE.MeshStandardMaterial[] = [];
    sc.root.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.isMeshStandardMaterial && !mats.includes(m)) mats.push(m); });
    sc.applyWetness(0);
    const dry = mats.map((m) => m.roughness);
    sc.applyWetness(1);
    const soaked = mats.map((m) => m.roughness);

    sc.applyWetness(-5);
    expect(mats.map((m) => m.roughness)).toEqual(dry);
    sc.applyWetness(12);
    expect(mats.map((m) => m.roughness)).toEqual(soaked);
    sc.applyWetness(Number.NaN); // NaN is not "somewhere between": it must land on dry, not on NaN
    expect(mats.every((m) => Number.isFinite(m.roughness))).toBe(true);
    expect(mats.map((m) => m.roughness)).toEqual(dry);
  });
});

describe("vo3d weather — switching costs nothing structural", () => {
  it("never rebuilds the world: no geometry, material or mesh count moves with the weather", () => {
    const sc = buildExterior();
    const before = { draws: sc.stats.draws, trees: sc.stats.trees, instances: sc.stats.instances };
    const spy = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    for (const w of WEATHER_STATES) { sc.applyWetness(WETNESS[w]); sc.applyTint(weatherPreset(w, "day").exteriorTint); }
    expect(sc.stats).toEqual(expect.objectContaining(before));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT REACTIONS: wind, standing water, the storm, and the fact that a grade now TRAVELS.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

describe("vo3d weather — the reaction tables", () => {
  it("gives every state a wind, rising with the weather and never still", () => {
    for (const s of WEATHER_STATES) {
      expect(WIND[s], s).toBeGreaterThan(0); // a perfectly static world reads as a photograph
      expect(WIND[s], s).toBeLessThanOrEqual(1);
    }
    // the jump that has to be visible is clear → raining
    expect(WIND.rain).toBeGreaterThan(WIND.cloudy * 2);
    expect(WIND.clear).toBeLessThan(WIND.rain);
    expect(WIND.thunderstorm).toBeGreaterThanOrEqual(WIND.heavy_rain);
  });

  it("schedules lightning only where there is rain to hang it on, and never at strobe rate", () => {
    expect(LIGHTNING.clear).toBeNull();
    expect(LIGHTNING.cloudy).toBeNull();
    for (const s of ["rain", "heavy_rain", "thunderstorm"] as const) {
      const p = LIGHTNING[s]!;
      expect(p, s).not.toBeNull();
      expect(p.minGap, s).toBeGreaterThanOrEqual(8); // the no-strobe floor
      expect(p.maxGap, s).toBeGreaterThan(p.minGap); // a RANGE, or it is a metronome
      expect(p.strength, s).toBeGreaterThan(0);
      expect(p.strength, s).toBeLessThanOrEqual(1);
    }
    // a thunderstorm strikes more often and harder than a shower does
    expect(LIGHTNING.thunderstorm!.minGap).toBeLessThan(LIGHTNING.rain!.minGap);
    expect(LIGHTNING.thunderstorm!.strength).toBeGreaterThan(LIGHTNING.rain!.strength);
  });

  it("makes a strike worth most at night and least at noon, without a second lightning table", () => {
    expect(LIGHTNING_PHASE_GAIN.day).toBeLessThan(LIGHTNING_PHASE_GAIN.sunset);
    expect(LIGHTNING_PHASE_GAIN.sunset).toBeLessThan(LIGHTNING_PHASE_GAIN.night);
    expect(LIGHTNING_PHASE_GAIN.night).toBe(1);
    expect(LIGHTNING_PHASE_GAIN.day).toBeGreaterThan(0); // subtle, not absent
  });

  it("hands wind and lightning out through the same one-pull grade as rain and wetness", () => {
    for (const phase of PHASES) {
      for (const s of WEATHER_STATES) {
        const g = weatherGrade(s, phase);
        expect(g.wind).toBe(WIND[s]);
        expect(g.lightning).toBe(LIGHTNING[s]);
      }
    }
  });
});

describe("vo3d weather — lightning is a number, not a light", () => {
  it("rises fast, falls fast, and is gone well inside half a second", () => {
    expect(envelope(-1)).toBe(0);
    expect(envelope(0)).toBe(0);
    expect(envelope(0.035)).toBeCloseTo(1, 5); // the peak, 35ms in
    expect(envelope(0.02)).toBeGreaterThan(0.4); // still climbing
    expect(envelope(0.2)).toBeLessThan(0.3); // most of the way down
    expect(envelope(0.6)).toBeLessThan(0.02); // effectively out
    // monotonic decay after the peak
    for (let a = 0.04; a < 0.5; a += 0.02) expect(envelope(a + 0.02)).toBeLessThan(envelope(a));
  });

  it("never strikes faster than its own floor, and the gaps are not a metronome", () => {
    const L = new Lightning(12345);
    L.setParams(LIGHTNING.thunderstorm, "thunderstorm");
    const at: number[] = [];
    L.onStrike = (e) => at.push(e.at);
    for (let i = 0; i < 60_000; i++) L.update(1 / 60); // ~16 minutes of storm
    expect(at.length).toBeGreaterThan(20); // it did actually storm
    const gaps: number[] = [];
    for (let i = 1; i < at.length; i++) gaps.push(at[i] - at[i - 1]);
    const P = LIGHTNING.thunderstorm!;
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(P.minGap - 0.02);
      expect(g).toBeLessThanOrEqual(P.maxGap + 0.02);
    }
    // NOT REPETITIVE: the gaps have to actually spread across the range, or this is a strobe with a
    // long period. Anything under a couple of seconds of spread would be one.
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const spread = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
    expect(spread).toBeGreaterThan(2);
  });

  it("flashes and returns to exactly nothing between strikes", () => {
    const L = new Lightning(777);
    L.setParams(LIGHTNING.thunderstorm, "thunderstorm");
    const e = L.strike()!;
    expect(e).not.toBeNull();
    L.update(0.035);
    expect(L.flash).toBeGreaterThan(0.1); // the sky is lit
    expect(L.flash).toBeLessThanOrEqual(1); // and never over-lit
    for (let i = 0; i < 120; i++) L.update(1 / 60); // two seconds later
    expect(L.flash).toBe(0); // exactly nothing — not a floor it creeps toward
  });

  it("emits a thunder event carrying everything a delayed clap needs — and plays nothing", () => {
    const L = new Lightning(4242);
    L.setParams(LIGHTNING.heavy_rain, "heavy_rain");
    const heard: ThunderEvent[] = [];
    L.onStrike = (e) => heard.push(e);
    for (let i = 0; i < 30_000; i++) L.update(1 / 60);
    expect(heard.length).toBeGreaterThan(3);
    for (const e of heard) {
      expect(e.state).toBe("heavy_rain");
      expect(e.distanceKm).toBeGreaterThan(0);
      expect(e.strength).toBeGreaterThan(0);
      expect(e.strength).toBeLessThanOrEqual(1);
      // the real figure: 343 m/s, so the clap lands distance/0.343 seconds after the flash
      expect(e.delaySeconds).toBeCloseTo(e.distanceKm / 0.343, 5);
      expect(e.delaySeconds).toBeGreaterThan(1); // a storm has a size; nothing is on top of you
      expect(typeof e.double).toBe("boolean");
    }
    // a near strike is brighter than a far one — the falloff is real, not decoration
    const near = heard.reduce((a, b) => (a.distanceKm <= b.distanceKm ? a : b));
    const far = heard.reduce((a, b) => (a.distanceKm >= b.distanceKm ? a : b));
    expect(near.strength).toBeGreaterThan(far.strength);
  });

  it("stops dead where a state does not strike, and when the dev panel mutes it", () => {
    const L = new Lightning(9);
    L.setParams(LIGHTNING.clear, "clear");
    expect(L.striking).toBe(false);
    for (let i = 0; i < 20_000; i++) L.update(1 / 60);
    expect(L.count).toBe(0);
    expect(L.flash).toBe(0);
    expect(L.strike()).toBeNull(); // not even on demand: there is no storm to strike from

    L.setParams(LIGHTNING.thunderstorm, "thunderstorm");
    L.enabled = false;
    for (let i = 0; i < 20_000; i++) L.update(1 / 60);
    expect(L.count).toBe(0);
  });

  it("gives a double strike a second pulse that re-lights the sky", () => {
    // drive it with a params object that ALWAYS doubles, so the branch is exercised deterministically
    const L = new Lightning(31337);
    L.setParams({ minGap: 999, maxGap: 1000, doubleChance: 1, strength: 1 }, "thunderstorm");
    const e = L.strike()!;
    expect(e.double).toBe(true);
    L.update(0.035);
    const first = L.flash;
    for (let i = 0; i < 6; i++) L.update(1 / 60); // ~100ms: the first pulse is falling
    const trough = L.flash;
    let peak = 0;
    for (let i = 0; i < 12; i++) { L.update(1 / 60); peak = Math.max(peak, L.flash); }
    expect(first).toBeGreaterThan(0.3);
    expect(peak).toBeGreaterThan(trough); // the sky lit a second time rather than simply decaying
  });
});

describe("vo3d weather — a grade travels instead of popping", () => {
  function fakeRenderer() {
    return {
      scene: { background: null as unknown, fog: null as unknown, add() {}, environmentIntensity: 1 },
      camera: {}, target: new THREE.Vector3(), camDist: 6000,
      key: new THREE.DirectionalLight(), fill: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(),
      lightParams: {} as never,
      placeLight() { this.placed++; },
      applyLightLevels() { this.levels++; },
      placed: 0, levels: 0,
    };
  }

  it("does not land a weather change on the frame it is asked for, and does land on the target", async () => {
    const { Environment } = await import("./env/Environment");
    const R = fakeRenderer();
    const env = new Environment(R as never);
    env.apply("day"); // the first grade of a session has nothing to fade from: instant
    expect(env.travelling).toBe(false);
    expect(env.wetness).toBe(WETNESS.clear);

    env.setWeather("heavy_rain");
    expect(env.travelling).toBe(true);
    expect(env.wetness).toBeLessThan(WETNESS.heavy_rain); // still on its way — this is the anti-pop
    env.tick(0.2);
    const partway = env.wetness;
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(WETNESS.heavy_rain);
    for (let i = 0; i < 600; i++) env.tick(1 / 60); // ten seconds: comfortably past 4 tau
    expect(env.travelling).toBe(false);
    expect(env.wetness).toBeCloseTo(WETNESS.heavy_rain, 6);
    expect(env.wind).toBeCloseTo(WIND.heavy_rain, 6);
  });

  it("arrives EXACTLY on CLEAR, so a fair day is byte-for-byte the approved presentation", async () => {
    const { Environment } = await import("./env/Environment");
    const R = fakeRenderer();
    const env = new Environment(R as never);
    env.apply("night");
    env.setWeather("thunderstorm");
    env.settle();
    env.setWeather("clear");
    for (let i = 0; i < 900; i++) env.tick(1 / 60);
    expect(env.travelling).toBe(false);
    expect(env.wetness).toBe(WETNESS.clear);
    expect(env.wind).toBe(WIND.clear);
    // the approved night sky, not something 0.4% away from it
    expect((R.scene.background as THREE.Color).getHex()).toBe(ENV_PRESETS.night.sky);
  });

  it("never asks for a shadow redraw while only the WEATHER is travelling", async () => {
    const { Environment } = await import("./env/Environment");
    const R = fakeRenderer();
    const env = new Environment(R as never);
    env.apply("day");
    const placedAfterFirstGrade = R.placed;
    env.setWeather("thunderstorm");
    for (let i = 0; i < 600; i++) env.tick(1 / 60);
    // the overcast targets deliberately carry no azimuth/elevation, so the sun cannot have moved and the
    // ~5s of per-frame re-grading must have gone down the levels-only path every single time
    expect(R.placed).toBe(placedAfterFirstGrade);
    expect(R.levels).toBeGreaterThan(100);
  });

  it("cuts rather than fades when the PRESENTATION changes", async () => {
    const { Environment } = await import("./env/Environment");
    const R = fakeRenderer();
    const env = new Environment(R as never);
    env.apply("day");
    env.setWeather("rain");
    env.settle();
    expect(env.setPresentation("office")).toBe(true);
    expect(env.travelling).toBe(false); // a wall does not dissolve
    expect((R.scene.background as THREE.Color).getHex()).not.toBe(ENV_PRESETS.day.sky);
  });

  it("turns transitions off for a rig that wants the target on the frame it asked", async () => {
    const { Environment } = await import("./env/Environment");
    const env = new Environment(fakeRenderer() as never);
    env.apply("day");
    env.transitions = false;
    env.setWeather("heavy_rain");
    expect(env.travelling).toBe(false);
    expect(env.wetness).toBe(WETNESS.heavy_rain);
  });
});

describe("vo3d weather — the Cave is sealed against the storm", () => {
  function fakeRenderer() {
    return {
      scene: { background: null as unknown, fog: null as unknown, add() {}, environmentIntensity: 1 },
      camera: {}, target: new THREE.Vector3(), camDist: 6000,
      key: new THREE.DirectionalLight(), fill: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(),
      lightParams: {} as never, placeLight() {}, applyLightLevels() {},
    };
  }

  it("runs no storm at all inside a sealed interior, and restarts it on the way out", async () => {
    const { Environment } = await import("./env/Environment");
    const env = new Environment(fakeRenderer() as never);
    env.apply("night");
    env.setWeather("thunderstorm");
    env.settle();
    expect(env.storm.striking).toBe(true); // outside: a storm

    env.setPresentation("interior");
    expect(env.storm.striking).toBe(false); // inside: not a dimmer storm — NO storm
    expect(env.storm.strike()).toBeNull();
    for (let i = 0; i < 30_000; i++) env.tick(1 / 60); // eight minutes in the Cave
    expect(env.storm.count).toBe(0);
    expect(env.flash).toBe(0); // the outdoors is not observable from a windowless theatre

    env.setPresentation("world");
    expect(env.storm.striking).toBe(true); // and the weather was still happening the whole time
  });

  it("keeps a lightning flash out of the interior grade even if one were somehow live", async () => {
    const { Environment } = await import("./env/Environment");
    const R = fakeRenderer();
    const env = new Environment(R as never);
    env.apply("night");
    env.setWeather("thunderstorm");
    env.setPresentation("interior");
    env.tick(1 / 60);
    // the sealed rig's own fixed background, unlit by any sky
    const bg = (R.scene.background as THREE.Color).getHex();
    expect(bg).toBe(0x04050a);
    expect(R.scene.fog).toBeNull();
  });
});
