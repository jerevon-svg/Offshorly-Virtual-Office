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
import { RAIN_PARAMS, WEATHER_WEIGHT, WETNESS, isRaining, weatherGrade, weatherPreset } from "./env/weatherGrade";
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
