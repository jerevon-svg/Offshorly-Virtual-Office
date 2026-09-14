import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALL_COOLDOWN, CALL_PHASE, CALL_WEATHER, EdgeTracker, Footsteps, SPRINT_STRIDE, STRIDE,
  callActivity, flightActivity,
} from "./audio/events";
import { SFX_LIFETIME_MS, spatial, type SfxKind } from "./audio/sfx";
import { EnvironmentalAudio, MAX_VOICES } from "./audio/EnvironmentalAudio";
import { Lightning, OPENING_GAP } from "./env/Lightning";
import { LIGHTNING, LIGHTNING_PHASE_GAIN } from "./env/weatherGrade";
import { flightPath } from "./world/Toucan";
import { PLAYER_SPRINT_SPEED, PLAYER_WALK_SPEED } from "./player/PlayerMode";
import { FRAME } from "./adapters/v1Floor";
import type { ZoneContext } from "./audio/zones";

// ---- edge detection: the whole reason foley does not become a stuck buzzer -------------------------

describe("vo3d foley — events fire on TRANSITIONS, never on states", () => {
  it("does not fire on the first sighting, and fires exactly once per change", () => {
    const e = new EdgeTracker();
    expect(e.changed("door", "closed")).toBe(false); // a door already closed has not just closed
    expect(e.changed("door", "closed")).toBe(false);
    expect(e.changed("door", "opening")).toBe(true);
    for (let i = 0; i < 100; i++) expect(e.changed("door", "opening")).toBe(false); // held open: silent
    expect(e.changed("door", "open")).toBe(true);
    expect(e.changed("door", "closing")).toBe(true);
  });

  it("keys are independent — one door cannot swallow another's event", () => {
    const e = new EdgeTracker();
    e.changed("a", "closed");
    e.changed("b", "closed");
    expect(e.changed("a", "opening")).toBe(true);
    expect(e.changed("b", "opening")).toBe(true);
  });

  it("uses hysteresis for a continuous sensor, so a hovering activation cannot stutter", () => {
    const e = new EdgeTracker();
    expect(e.crossed("s", 0.2)).toBe(false);
    expect(e.crossed("s", 0.6)).toBe(true); // rose through the ON threshold
    // sit right on the boundary for a hundred frames: silence
    for (const v of [0.56, 0.54, 0.58, 0.55, 0.3, 0.4, 0.56]) expect(e.crossed("s", v)).toBe(false);
    expect(e.crossed("s", 0.1)).toBe(false); // fell below OFF — armed again, but not a sound
    expect(e.crossed("s", 0.9)).toBe(true);
  });

  it("a hundred door cycles produce exactly two hundred events, not twelve thousand frames of them", () => {
    const e = new EdgeTracker();
    let sounds = 0;
    e.changed("d", "closed");
    for (let c = 0; c < 100; c++) {
      for (const st of ["opening", "open", "closing", "closed"]) {
        for (let f = 0; f < 30; f++) if (e.changed("d", st) && (st === "opening" || st === "closing")) sounds++;
      }
    }
    expect(sounds).toBe(200);
  });
});

// ---- footsteps ------------------------------------------------------------------------------------

describe("vo3d foley — footsteps are paced by ground covered, not by a clock", () => {
  const walkFrame = PLAYER_WALK_SPEED / 60;
  const sprintFrame = PLAYER_SPRINT_SPEED / 60;

  it("takes a step every STRIDE units, so cadence follows 70 and 100 without knowing either", () => {
    const f = new Footsteps();
    let steps = 0;
    for (let i = 0; i < 60; i++) if (f.advance(walkFrame, false)) steps++;
    // one second at 70 u/s is 70 units, which is 70/16 footfalls
    expect(steps).toBe(Math.floor(PLAYER_WALK_SPEED / STRIDE));
    const g = new Footsteps();
    steps = 0;
    for (let i = 0; i < 60; i++) if (g.advance(sprintFrame, true)) steps++;
    expect(steps).toBe(Math.floor(PLAYER_SPRINT_SPEED / SPRINT_STRIDE));
    expect(SPRINT_STRIDE).toBeGreaterThan(STRIDE); // a sprint's stride is longer as well as faster
  });

  it("sprinting is audibly faster than walking, and both are plausible cadences", () => {
    const rate = (perFrame: number, sprint: boolean) => {
      const f = new Footsteps();
      let n = 0;
      for (let i = 0; i < 600; i++) if (f.advance(perFrame, sprint)) n++;
      return n / 10; // steps per second
    };
    const w = rate(walkFrame, false), s = rate(sprintFrame, true);
    // AUDIBLY faster, not marginally: a sprint whose cadence matches a walk's is a walk with a wider gait
    expect(s).toBeGreaterThan(w * 1.2);
    expect(w).toBeGreaterThan(3);
    expect(s).toBeLessThan(7); // never a machine gun
  });

  it("stops DEAD when the body stops, and a blocked body takes no steps at all", () => {
    const f = new Footsteps();
    for (let i = 0; i < 30; i++) f.advance(walkFrame, false);
    expect(f.advance(0, false)).toBe(false);
    for (let i = 0; i < 300; i++) expect(f.advance(0, false)).toBe(false);
    // pinned against a wall: travelled is ~0 every frame
    for (let i = 0; i < 300; i++) expect(f.advance(1e-6, false)).toBe(false);
  });

  it("cannot machine-gun on a pathological frame", () => {
    const f = new Footsteps();
    // a 250 ms stalled frame at sprint speed, over and over
    let steps = 0;
    for (let i = 0; i < 20; i++) if (f.advance(PLAYER_SPRINT_SPEED * 0.25, true)) steps++;
    expect(steps).toBe(20); // at most ONE per call, never two
  });

  it("alternates feet so consecutive steps can be pitched apart", () => {
    const f = new Footsteps();
    const feet: boolean[] = [];
    for (let i = 0; i < 600 && feet.length < 6; i++) if (f.advance(walkFrame, false)) feet.push(f.left);
    for (let i = 1; i < feet.length; i++) expect(feet[i]).toBe(!feet[i - 1]);
  });
});

// ---- spatial placement ----------------------------------------------------------------------------

describe("vo3d foley — a world event is heard from where it happened", () => {
  const ear = { x: 0, z: 0 };
  it("falls off with distance and is silent past its range", () => {
    const at = (d: number) => spatial({ x: d, z: 0 }, ear, 0, 500).gain;
    expect(at(0)).toBeCloseTo(1, 6);
    expect(at(100)).toBeGreaterThan(at(300));
    expect(at(300)).toBeGreaterThan(at(490));
    expect(at(500)).toBe(0);
    expect(at(5000)).toBe(0);
  });
  it("pans to the side the source is actually on, for the direction the listener faces", () => {
    // facing north (yaw 0): right is +x
    expect(spatial({ x: 100, z: 0 }, ear, 0, 500).pan).toBeCloseTo(1, 5);
    expect(spatial({ x: -100, z: 0 }, ear, 0, 500).pan).toBeCloseTo(-1, 5);
    expect(spatial({ x: 0, z: -100 }, ear, 0, 500).pan).toBeCloseTo(0, 5); // dead ahead
    // turn the listener a quarter turn: the same source is now dead ahead instead of hard right
    expect(Math.abs(spatial({ x: 100, z: 0 }, ear, Math.PI / 2, 500).pan)).toBeLessThan(1e-6);
  });
  it("never returns a pan outside −1…1 or a negative gain", () => {
    for (const [x, z, yaw] of [[9e9, -9e9, 3], [-1, 1, -7], [0, 0, 0], [1e-9, 1e-9, 1]]) {
      const s = spatial({ x, z }, ear, yaw, 500);
      expect(s.pan).toBeGreaterThanOrEqual(-1);
      expect(s.pan).toBeLessThanOrEqual(1);
      expect(s.gain).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---- the SFX pool, against a fake browser ----------------------------------------------------------

type Counters = { made: number; disconnected: number; contexts: number };
const counters: Counters = { made: 0, disconnected: 0, contexts: 0 };
class FakeParam {
  value = 0;
  setValueAtTime(v: number): this { this.value = v; return this; }
  setTargetAtTime(v: number): this { this.value = v; return this; }
  linearRampToValueAtTime(v: number): this { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number): this { this.value = v; return this; }
}
class FakeNode {
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
  readonly playbackRate = new FakeParam();
  readonly pan = new FakeParam();
  type = "";
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  constructor() { counters.made++; }
  connect<T>(t: T): T { return t; }
  disconnect(): void { counters.disconnected++; }
  start(): void {}
  stop(): void {}
}
class FakeContext {
  state: "running" | "suspended" | "closed" = "running";
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  constructor() { counters.contexts++; }
  createGain(): FakeNode { return new FakeNode(); }
  createBiquadFilter(): FakeNode { return new FakeNode(); }
  createBufferSource(): FakeNode { return new FakeNode(); }
  createOscillator(): FakeNode { return new FakeNode(); }
  createStereoPanner(): FakeNode { return new FakeNode(); }
  createBuffer(_c: number, len: number, rate: number) {
    const d = new Float32Array(len);
    return { length: len, sampleRate: rate, getChannelData: () => d };
  }
  resume(): Promise<void> { return Promise.resolve(); }
  close(): Promise<void> { this.state = "closed"; return Promise.resolve(); }
}
function fakeAudio(): void {
  counters.made = 0; counters.disconnected = 0; counters.contexts = 0;
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext as unknown;
}
const ctxAt = (over: Partial<ZoneContext> = {}): ZoneContext => ({
  inCave: false, regionKind: "shared-floor", roomId: null, portalDistance: Number.POSITIVE_INFINITY,
  edgeDistance: Number.POSITIVE_INFINITY, weather: "clear", intensity: 1, phase: "day", ...over,
});
function engine(over: Partial<ZoneContext> = {}) {
  const live = ctxAt(over);
  const e = new EnvironmentalAudio({ sample: (into) => Object.assign(into, live), meeting: () => false });
  return { e, live };
}
const ALL: SfxKind[] = ["doorOpen", "doorClose", "scanner", "footstep", "chairMove", "chairSit", "chairStand", "click", "portal", "toucanCall"];

afterEach(() => { vi.useRealTimers(); });

describe("vo3d foley — the one-shot pool", () => {
  it("plays every family without a second AudioContext", () => {
    vi.useFakeTimers();
    fakeAudio();
    const { e } = engine();
    e.start();
    for (const k of ALL) expect(e.play(k, { gain: 0.8 })).toBe(true);
    expect(counters.contexts).toBe(1);
    expect(e.state.sfx).toBe(ALL.length);
    e.dispose();
  });

  it("is bounded: a flood is refused rather than allowed to steal voices", () => {
    vi.useFakeTimers();
    fakeAudio();
    const { e } = engine();
    e.start();
    let played = 0;
    for (let i = 0; i < 200; i++) if (e.play("footstep")) played++;
    expect(played).toBe(MAX_VOICES);
    expect(e.state.dropped).toBe(200 - MAX_VOICES);
    // and the pool DRAINS: once the lifetimes elapse it is usable again
    vi.advanceTimersByTime(Math.max(...Object.values(SFX_LIFETIME_MS)) + 50);
    expect(e.play("footstep")).toBe(true);
    e.dispose();
  });

  it("does not grow a node across two thousand footsteps and two hundred door cycles", () => {
    vi.useFakeTimers();
    fakeAudio();
    const { e } = engine();
    e.start();
    const bedNodes = e.state.nodes;
    for (let i = 0; i < 2000; i++) {
      e.play("footstep", { pitch: 0.95 + (i % 7) / 70 });
      if (i % 10 === 0) { e.play("doorOpen"); e.play("doorClose"); }
      vi.advanceTimersByTime(120); // let the pool drain as it would in real time
    }
    vi.advanceTimersByTime(4000);
    expect(e.state.voices).toBe(0); // every one-shot returned its slot
    expect(e.state.timers).toBe(0);  // and left no timer behind
    // the BEDS are what must not grow; the one-shots are created and destroyed by design
    expect(e.state.nodes).toBe(bedNodes);
    expect(counters.contexts).toBe(1);
    e.dispose();
    expect(counters.disconnected).toBeGreaterThan(0);
  });

  it("plays nothing while the system is off, and nothing before it is started", () => {
    fakeAudio();
    const { e } = engine();
    expect(e.play("click")).toBe(false); // no context yet
    e.start();
    e.setEnabled(false);
    expect(e.play("click")).toBe(false);
    e.setEnabled(true);
    expect(e.play("click")).toBe(true);
    e.dispose();
    expect(e.play("click")).toBe(false);
  });

  it("refuses an event that is inaudibly far away rather than spending a voice on it", () => {
    fakeAudio();
    const { e } = engine();
    e.start();
    expect(e.play("doorOpen", { gain: 0 })).toBe(false);
    expect(e.play("doorOpen", { gain: 0.0001 })).toBe(false);
    expect(e.state.sfx).toBe(0);
    e.dispose();
  });
});

// ---- storm presentation ---------------------------------------------------------------------------

describe("vo3d storm — the first strike arrives while you are still looking at the sky", () => {
  it("opens with a 2–5 s gap instead of the authored 9–27, on every arm", () => {
    expect(OPENING_GAP.min).toBeGreaterThanOrEqual(2);
    expect(OPENING_GAP.max).toBeLessThanOrEqual(5);
    for (let seed = 1; seed < 40; seed++) {
      const L = new Lightning(seed * 7919);
      L.setParams(LIGHTNING.thunderstorm, "thunderstorm");
      expect(L.nextIn).toBeGreaterThanOrEqual(OPENING_GAP.min);
      expect(L.nextIn).toBeLessThanOrEqual(OPENING_GAP.max);
    }
  });

  it("guarantees a strike inside five seconds of selecting the storm", () => {
    for (let seed = 1; seed < 25; seed++) {
      const L = new Lightning(seed * 104729);
      L.setParams(LIGHTNING.thunderstorm, "thunderstorm");
      let struck = false;
      L.onStrike = () => { struck = true; };
      for (let t = 0; t < 5 / (1 / 60); t++) L.update(1 / 60);
      expect(struck, `seed ${seed}`).toBe(true);
    }
  });

  it("returns to the AUTHORED rhythm from the second strike onward — it is not a faster scheduler", () => {
    const L = new Lightning(0xbeef);
    L.setParams(LIGHTNING.thunderstorm, "thunderstorm");
    const gaps: number[] = [];
    let last = 0;
    L.onStrike = (e) => { gaps.push(e.at - last); last = e.at; };
    for (let t = 0; t < 300 * 60; t++) L.update(1 / 60);
    expect(gaps.length).toBeGreaterThan(5);
    expect(gaps[0]).toBeLessThanOrEqual(OPENING_GAP.max + 0.05); // the opening one is short …
    for (const g of gaps.slice(1)) {
      expect(g).toBeGreaterThanOrEqual(LIGHTNING.thunderstorm!.minGap - 0.05); // … every later one is not
      expect(g).toBeLessThanOrEqual(LIGHTNING.thunderstorm!.maxGap + 0.05);
    }
  });

  it("still never schedules anything for a state that does not strike", () => {
    const L = new Lightning();
    L.setParams(null, "clear");
    expect(L.nextIn).toBe(Number.POSITIVE_INFINITY);
    let struck = false;
    L.onStrike = () => { struck = true; };
    for (let t = 0; t < 60 * 600; t++) L.update(1 / 60);
    expect(struck).toBe(false);
  });

  it("the manual trigger IS the scheduler's own path — same event, same delay, same distance law", () => {
    const L = new Lightning(0x1234);
    L.setParams(LIGHTNING.thunderstorm, "thunderstorm");
    const e = L.strike();
    expect(e).not.toBeNull();
    expect(e!.delaySeconds).toBeCloseTo(e!.distanceKm / 0.343, 6); // the real speed of sound, not a constant
    expect(e!.delaySeconds).toBeGreaterThan(2); // and never simultaneous with the flash
    expect(L.count).toBe(1);
    // it also re-arms the normal countdown, so a manual strike does not stall the storm
    expect(L.nextIn).toBeGreaterThanOrEqual(LIGHTNING.thunderstorm!.minGap);
  });

  it("is visible in daylight now, while a night strike is still the strongest", () => {
    expect(LIGHTNING_PHASE_GAIN.day).toBeGreaterThan(0.5);
    expect(LIGHTNING_PHASE_GAIN.day).toBeLessThan(LIGHTNING_PHASE_GAIN.sunset);
    expect(LIGHTNING_PHASE_GAIN.sunset).toBeLessThan(LIGHTNING_PHASE_GAIN.night);
    expect(LIGHTNING_PHASE_GAIN.night).toBe(1);
  });
});

// ---- the toucan ------------------------------------------------------------------------------------

describe("vo3d toucan — one bird on one path", () => {
  const path = flightPath(FRAME);

  it("flies a closed loop that never enters the building and clears every wall", () => {
    const WALL = 46; // the tallest authored wall in the world
    let inside = 0;
    for (let i = 0; i <= 400; i++) {
      const p = path.getPointAt(i / 400);
      expect(p.y).toBeGreaterThan(WALL * 2); // "clearly above ground/buildings", by construction
      const over = p.x > FRAME.x && p.x < FRAME.x + FRAME.w && p.z > FRAME.z && p.z < FRAME.z + FRAME.d;
      if (over) inside++;
    }
    // it does pass over the campus, which is the point — but it is never IN a room, because it is 90+
    // units up and rooms have floors and walls, not ceilings it could descend through
    expect(inside).toBeGreaterThan(0);
  });

  it("stays within sensible campus bounds — it cannot wander off into unbuilt space", () => {
    const limit = { x: FRAME.w * 1.2, z: FRAME.d * 1.2 };
    const cx = FRAME.x + FRAME.w / 2, cz = FRAME.z + FRAME.d / 2;
    for (let i = 0; i <= 400; i++) {
      const p = path.getPointAt(i / 400);
      expect(Math.abs(p.x - cx)).toBeLessThan(limit.x);
      expect(Math.abs(p.z - cz)).toBeLessThan(limit.z);
      expect(p.y).toBeLessThan(400);
    }
  });

  it("is a smooth loop, not a ping-pong: no waypoint is a corner", () => {
    let worst = 0;
    let prev = path.getTangentAt(0);
    for (let i = 1; i <= 400; i++) {
      const t = path.getTangentAt(i / 400);
      worst = Math.max(worst, prev.angleTo(t));
      prev = t;
    }
    expect(worst).toBeLessThan(0.2); // radians between consecutive samples — a curve, not a polyline
    // and it closes on itself
    expect(path.getPointAt(0).distanceTo(path.getPointAt(1))).toBeLessThan(1e-6);
  });

  it("grounds itself in a severe storm and at night, and flies normally otherwise", () => {
    expect(flightActivity("clear", "day")).toBe(1);
    expect(flightActivity("cloudy", "day")).toBe(1);
    expect(flightActivity("rain", "day")).toBeLessThan(1);
    expect(flightActivity("heavy_rain", "day")).toBeLessThan(flightActivity("rain", "day"));
    expect(flightActivity("thunderstorm", "day")).toBe(0); // put away, not merely slowed
    // NIGHT grounds it whatever the sky is doing — a toucan is diurnal
    for (const w of ["clear", "cloudy", "rain", "heavy_rain", "thunderstorm"] as const)
      expect(flightActivity(w, "night")).toBe(0);
    // sunset is the transition: still flying, more slowly
    expect(flightActivity("clear", "sunset")).toBeGreaterThan(0);
    expect(flightActivity("clear", "sunset")).toBeLessThan(flightActivity("clear", "day"));
  });

  it("calls in the day, rarely at sunset, never at night and never in a storm", () => {
    expect(callActivity("day", "clear")).toBe(1);
    expect(callActivity("sunset", "clear")).toBe(CALL_PHASE.sunset);
    expect(callActivity("night", "clear")).toBe(0);
    expect(callActivity("day", "rain")).toBeLessThan(callActivity("day", "cloudy"));
    expect(callActivity("day", "thunderstorm")).toBe(0);
    for (const p of ["day", "sunset", "night"] as const)
      expect(callActivity(p, "thunderstorm")).toBe(0);
  });

  it("has a real cooldown, so it cannot spam even on its most active day", () => {
    expect(CALL_COOLDOWN.min).toBeGreaterThanOrEqual(8);
    expect(CALL_COOLDOWN.max).toBeGreaterThan(CALL_COOLDOWN.min);
    expect(CALL_WEATHER.thunderstorm).toBe(0);
    expect(CALL_PHASE.night).toBe(0);
  });
});
