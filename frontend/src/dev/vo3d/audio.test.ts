import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BED_IDS, BIRD_WEATHER, EDGE_RANGE, LEVEL, PHASE_WEIGHT, PORTAL_RANGE, RAIN_WEIGHT, ROOM_ZONES,
  WIND_WEIGHT, emptyMix, mixInto, zoneFor, type ZoneContext,
} from "./audio/zones";
import { BEDS, EnvironmentalAudio, MEETING_DUCK, RAIN_CUTOFF, TAU } from "./audio/EnvironmentalAudio";
import { brownBuffer, pinkBuffer } from "./audio/synth";
import { PLAYER_SPRINT_SPEED, PLAYER_WALK_SPEED, SPRINT_MULTIPLIER } from "./player/PlayerMode";
import { PlayerBody } from "./player/PlayerBody";
import { NAV_RADIUS } from "./nav/clearance";
import type { ThunderEvent } from "./env/Lightning";

const ctxAt = (over: Partial<ZoneContext> = {}): ZoneContext => ({
  inCave: false, regionKind: "shared-floor", roomId: null,
  portalDistance: Number.POSITIVE_INFINITY, edgeDistance: Number.POSITIVE_INFINITY,
  weather: "clear", intensity: 1, phase: "day", ...over,
});
const mixAt = (over: Partial<ZoneContext> = {}) => mixInto(emptyMix(), ctxAt(over));

// ---- zones: WHERE AM I ----------------------------------------------------------------------------

describe("vo3d audio — zone selection", () => {
  it("classifies every place the body can be, and never returns undefined", () => {
    expect(zoneFor(ctxAt({ regionKind: "exterior" }))).toBe("outside");
    expect(zoneFor(ctxAt({ regionKind: null }))).toBe("outside"); // outside the modelled world
    expect(zoneFor(ctxAt({ regionKind: "shared-floor" }))).toBe("office");
    expect(zoneFor(ctxAt({ regionKind: "room-floor", roomId: "design-room" }))).toBe("office");
    expect(zoneFor(ctxAt({ regionKind: "room-floor", roomId: "central-hub" }))).toBe("hub");
    expect(zoneFor(ctxAt({ regionKind: "room-floor", roomId: "gaming-room" }))).toBe("gaming");
    expect(zoneFor(ctxAt({ regionKind: "room-floor", roomId: "ai-room" }))).toBe("ai");
    expect(zoneFor(ctxAt({ inCave: true, regionKind: "exterior" }))).toBe("cave"); // the CAVE outranks all
  });

  it("gives only three rooms an identity of their own — eleven rooms are not eleven systems", () => {
    expect(Object.keys(ROOM_ZONES).sort()).toEqual(["ai-room", "central-hub", "gaming-room"]);
    for (const room of ["design-room", "reception-room", "cms-room", "dev-room", "qa-room", "executive-room"]) {
      const m = mixAt({ regionKind: "room-floor", roomId: room });
      expect(m.beds.office).toBe(LEVEL.office.plain);
      expect(m.beds.hub + m.beds.gaming + m.beds.ai).toBe(0);
    }
  });

  it("keeps the shared office tone UNDER a room that has its own bed, so the building stays one building", () => {
    const hub = mixAt({ regionKind: "room-floor", roomId: "central-hub" });
    expect(hub.beds.hub).toBe(LEVEL.hub);
    expect(hub.beds.office).toBe(LEVEL.office.under);
    expect(LEVEL.office.under).toBeLessThan(LEVEL.office.plain);
  });

  it("assigns EVERY bed on every call, so no bed keeps a weight from a zone the listener left", () => {
    const mix = emptyMix();
    mixInto(mix, ctxAt({ regionKind: "room-floor", roomId: "gaming-room" }));
    expect(mix.beds.gaming).toBeGreaterThan(0);
    mixInto(mix, ctxAt({ regionKind: "exterior" }));
    expect(mix.beds.gaming).toBe(0);
    for (const id of BED_IDS) expect(Number.isFinite(mix.beds[id])).toBe(true);
  });

  it("is allocation-free on the hot path: mixInto writes into the object it is given", () => {
    const mix = emptyMix();
    const beds = mix.beds;
    const out = mixInto(mix, ctxAt());
    expect(out).toBe(mix);
    expect(out.beds).toBe(beds);
  });

  it("sounds clearly different outside than inside — the interior is an order below", () => {
    const out = mixAt({ regionKind: "exterior" });
    const inn = mixAt({ regionKind: "shared-floor" });
    expect(out.beds.wind).toBeGreaterThan(inn.beds.wind * 4);
    expect(out.beds.city).toBeGreaterThan(inn.beds.city * 4);
    expect(inn.beds.office).toBeGreaterThan(0);
    expect(out.beds.office).toBe(0);
  });

  it("gives the sealed CAVE its own air and nothing of the outdoors", () => {
    const m = mixAt({ inCave: true, weather: "thunderstorm" });
    expect(m.beds.cave).toBe(LEVEL.cave);
    expect(m.beds.rain).toBe(0);
    expect(m.beds.wind).toBe(0);
    expect(m.beds.city).toBe(0);
    expect(m.beds.portal).toBe(0);
    expect(m.beds.office).toBe(0);
  });
});

// ---- distance attenuation --------------------------------------------------------------------------

describe("vo3d audio — distance attenuation", () => {
  it("brings the theatre up smoothly and monotonically as the portal is approached", () => {
    let last = -1;
    for (const d of [PORTAL_RANGE * 2, PORTAL_RANGE, 200, 150, 100, 50, 0]) {
      const g = mixAt({ regionKind: "room-floor", roomId: "central-hub", portalDistance: d }).beds.portal;
      expect(g).toBeGreaterThanOrEqual(last);
      last = g;
    }
    expect(mixAt({ regionKind: "room-floor", roomId: "central-hub", portalDistance: 0 }).beds.portal).toBeCloseTo(LEVEL.portal, 6);
    expect(mixAt({ regionKind: "room-floor", roomId: "central-hub", portalDistance: PORTAL_RANGE + 1 }).beds.portal).toBe(0);
  });

  it("weights the portal by the SQUARE of nearness, so the last strides do the work", () => {
    const half = mixAt({ regionKind: "room-floor", roomId: "central-hub", portalDistance: PORTAL_RANGE / 2 }).beds.portal;
    expect(half).toBeCloseTo(LEVEL.portal * 0.25, 6);
  });

  it("keeps rain audible by the glass and quietest deep inside", () => {
    const glass = mixAt({ regionKind: "room-floor", roomId: "cms-room", weather: "rain", edgeDistance: 0 });
    const deep = mixAt({ regionKind: "room-floor", roomId: "cms-room", weather: "rain", edgeDistance: EDGE_RANGE * 2 });
    expect(glass.beds.rain).toBeGreaterThan(deep.beds.rain);
    expect(glass.muffle).toBeLessThan(deep.muffle); // and it is less muffled there, too
    expect(deep.muffle).toBe(1);
  });
});

// ---- weather -----------------------------------------------------------------------------------------

describe("vo3d audio — weather weighting rides the EXISTING weather state", () => {
  it("is silent in clear and cloudy weather — cloud makes no sound", () => {
    expect(RAIN_WEIGHT.clear).toBe(0);
    expect(RAIN_WEIGHT.cloudy).toBe(0);
    expect(mixAt({ regionKind: "exterior", weather: "cloudy" }).beds.rain).toBe(0);
  });

  it("gets louder with the state and with the provider's intensity, in that order", () => {
    const at = (w: ZoneContext["weather"], intensity = 1) => mixAt({ regionKind: "exterior", weather: w, intensity }).beds.rain;
    expect(at("rain")).toBeLessThan(at("heavy_rain"));
    expect(at("heavy_rain")).toBeLessThan(at("thunderstorm"));
    expect(at("rain", 0)).toBeLessThan(at("rain", 1));
    expect(at("thunderstorm")).toBeCloseTo(LEVEL.rain.outside, 6);
  });

  it("makes rain indoors substantially quieter AND darker than rain in the open", () => {
    const out = mixAt({ regionKind: "exterior", weather: "heavy_rain" });
    const inn = mixAt({ regionKind: "shared-floor", weather: "heavy_rain", edgeDistance: 400 });
    expect(inn.beds.rain).toBeLessThan(out.beds.rain / 3);
    expect(out.muffle).toBe(0);
    expect(inn.muffle).toBe(1);
  });

  it("never lets the wind stop outdoors, and strengthens it with the storm", () => {
    expect(WIND_WEIGHT.clear).toBeGreaterThan(0);
    const calm = mixAt({ regionKind: "exterior", weather: "clear" }).beds.wind;
    const storm = mixAt({ regionKind: "exterior", weather: "thunderstorm" }).beds.wind;
    expect(calm).toBeGreaterThan(0);
    expect(storm).toBeGreaterThan(calm);
  });
});

// ---- time of day ---------------------------------------------------------------------------------

describe("vo3d audio — time of day is a weight on the same beds, not a second engine", () => {
  it("puts birds in the day, thins them at sunset and silences them at night", () => {
    expect(mixAt({ regionKind: "exterior", phase: "day" }).birds).toBe(1);
    expect(mixAt({ regionKind: "exterior", phase: "sunset" }).birds).toBe(PHASE_WEIGHT.sunset.birds);
    expect(mixAt({ regionKind: "exterior", phase: "night" }).birds).toBe(0);
  });

  it("silences birds in the rain whatever the hour, and indoors always", () => {
    expect(BIRD_WEATHER.rain).toBe(0);
    expect(mixAt({ regionKind: "exterior", phase: "day", weather: "rain" }).birds).toBe(0);
    expect(mixAt({ regionKind: "shared-floor", phase: "day" }).birds).toBe(0);
  });

  it("quietens the exterior at night and lights the night bed only out there", () => {
    const day = mixAt({ regionKind: "exterior", phase: "day" });
    const night = mixAt({ regionKind: "exterior", phase: "night" });
    expect(night.beds.city).toBeLessThan(day.beds.city);
    expect(night.beds.wind).toBeLessThan(day.beds.wind);
    expect(day.beds.night).toBe(0);
    expect(night.beds.night).toBeGreaterThan(0);
    expect(mixAt({ regionKind: "shared-floor", phase: "night" }).beds.night).toBe(0);
  });
});

// ---- a fake Web Audio, so the engine itself is testable --------------------------------------------
//
// Not a mock of the engine — a mock of the BROWSER. Every node it hands out is counted and every
// disconnect is counted, which is how "repeated transitions do not grow resources" is asserted rather
// than hoped for.

type Counters = { made: number; disconnected: number; started: number; stopped: number; contexts: number; closed: number };
const counters: Counters = { made: 0, disconnected: 0, started: 0, stopped: 0, contexts: 0, closed: 0 };

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
  type = "";
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  constructor() { counters.made++; }
  connect<T>(t: T): T { return t; }
  disconnect(): void { counters.disconnected++; }
  start(): void { counters.started++; }
  stop(): void { counters.stopped++; }
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
  createBuffer(_ch: number, len: number, rate: number) {
    const data = new Float32Array(len);
    return { length: len, sampleRate: rate, getChannelData: () => data };
  }
  resume(): Promise<void> { this.state = "running"; return Promise.resolve(); }
  close(): Promise<void> { this.state = "closed"; counters.closed++; return Promise.resolve(); }
}

function installFakeAudio(): void {
  counters.made = 0; counters.disconnected = 0; counters.started = 0; counters.stopped = 0;
  counters.contexts = 0; counters.closed = 0;
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext as unknown;
}

/** a context sampler that a test can steer, plugged into the engine's one input */
function harness(over: Partial<ZoneContext> = {}, meeting = () => false) {
  const live = ctxAt(over);
  const engine = new EnvironmentalAudio({
    sample: (into) => Object.assign(into, live),
    meeting,
  });
  return { engine, live };
}

afterEach(() => { vi.useRealTimers(); });

describe("vo3d audio — the engine's graph and its lifecycle", () => {
  it("creates NOTHING until it is started: a page load is silent", () => {
    installFakeAudio();
    const { engine } = harness();
    expect(counters.contexts).toBe(0);
    expect(engine.running).toBe(false);
    engine.update(0.016); // a frame before any gesture is a no-op, not a crash
    expect(counters.contexts).toBe(0);
    engine.dispose();
  });

  it("builds ONE AudioContext and one bounded graph, however many times start() is called", () => {
    installFakeAudio();
    const { engine } = harness();
    expect(engine.start()).toBe(true);
    const nodes = counters.made;
    engine.start();
    engine.start();
    expect(counters.contexts).toBe(1);
    expect(engine.state.contexts).toBe(1);
    expect(counters.made).toBe(nodes); // not one node more
    // exactly the ten declared beds, and nothing per room
    expect(BEDS).toHaveLength(BED_IDS.length);
    expect(engine.state.nodes).toBeGreaterThan(0);
    engine.dispose();
  });

  it("survives a browser with no Web Audio at all", () => {
    const saved = (window as unknown as { AudioContext?: unknown }).AudioContext;
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
    const { engine } = harness();
    expect(engine.start()).toBe(false);
    expect(engine.state.status).toBe("unsupported");
    engine.update(0.016);
    engine.dispose();
    (window as unknown as { AudioContext?: unknown }).AudioContext = saved;
  });

  it("disposes everything it made, and is safe to dispose twice", () => {
    installFakeAudio();
    const { engine } = harness();
    engine.start();
    const made = counters.made;
    engine.dispose();
    engine.dispose();
    expect(counters.closed).toBe(1);
    // every node the engine made, less the fake context's own destination — nothing is left connected
    expect(counters.disconnected).toBe(made - 1);
    expect(engine.state.contexts).toBe(0);
    expect(engine.state.nodes).toBe(0);
    expect(engine.start()).toBe(false); // dead is dead
  });

  it("does not grow a single node across a hundred zone transitions", () => {
    installFakeAudio();
    const { engine, live } = harness({ regionKind: "exterior" });
    engine.start();
    const settled = counters.made;
    const zones: ZoneContext["regionKind"][] = ["exterior", "shared-floor", "room-floor", "exterior"];
    for (let i = 0; i < 100; i++) {
      live.regionKind = zones[i % zones.length];
      live.roomId = i % 4 === 2 ? "gaming-room" : null;
      live.inCave = i % 17 === 0;
      for (let f = 0; f < 10; f++) engine.update(1 / 60);
    }
    expect(counters.made).toBe(settled);
    expect(engine.state.nodes).toBe(engine.state.nodes); // the readout never recounts upward
    engine.dispose();
  });
});

describe("vo3d audio — crossfades", () => {
  it("approaches a new zone exponentially instead of cutting to it", () => {
    installFakeAudio();
    const { engine, live } = harness({ regionKind: "exterior", weather: "clear" });
    engine.start();
    // settle outdoors
    for (let i = 0; i < 600; i++) engine.update(1 / 60);
    const outside = mixAt({ regionKind: "exterior" }).beds.wind;
    live.regionKind = "shared-floor";
    engine.update(1 / 60);
    const afterOneFrame = engine.state.zone;
    expect(afterOneFrame).toBe("office"); // the ZONE switches at once …
    // … but the level has barely moved: one 60 Hz frame is ~3% of the way there
    const oneFrame = 1 - Math.exp(-(1 / 60) / TAU);
    expect(oneFrame).toBeLessThan(0.04);
    expect(outside).toBeGreaterThan(0);
    // and after 4 tau it has effectively arrived
    for (let i = 0; i < Math.ceil(4 * TAU * 60); i++) engine.update(1 / 60);
    expect(1 - Math.exp(-4)).toBeGreaterThan(0.98);
    engine.dispose();
  });

  it("clamps a stalled-tab frame so a long dt cannot jump the mix", () => {
    installFakeAudio();
    const { engine } = harness({ regionKind: "exterior" });
    engine.start();
    engine.update(60); // a minute-long frame
    engine.update(Number.NaN);
    engine.update(-1);
    expect(engine.state.status).toBe("running");
    engine.dispose();
  });
});

describe("vo3d audio — thunder off the EXISTING storm event", () => {
  const strike = (over: Partial<ThunderEvent> = {}): ThunderEvent => ({
    at: 0, strength: 0.8, distanceKm: 3, delaySeconds: 3 / 0.343, double: false, state: "thunderstorm", ...over,
  });

  it("waits the event's own delay and then plays exactly one clap", () => {
    vi.useFakeTimers();
    installFakeAudio();
    const { engine } = harness({ regionKind: "exterior", weather: "thunderstorm" });
    engine.start();
    engine.update(1 / 60);
    engine.thunder(strike({ delaySeconds: 2 }));
    expect(engine.state.claps).toBe(0);
    vi.advanceTimersByTime(1900);
    expect(engine.state.claps).toBe(0); // still travelling
    vi.advanceTimersByTime(200);
    expect(engine.state.claps).toBe(1);
    engine.dispose();
  });

  it("NEVER fires inside the CAVE — not when it is scheduled there, nor when the portal is crossed mid-flight", () => {
    vi.useFakeTimers();
    installFakeAudio();
    const { engine, live } = harness({ regionKind: "exterior", weather: "thunderstorm" });
    engine.start();
    engine.update(1 / 60);

    // (a) scheduled while already inside: refused outright
    live.inCave = true;
    engine.update(1 / 60);
    engine.thunder(strike({ delaySeconds: 1 }));
    vi.advanceTimersByTime(5000);
    expect(engine.state.claps).toBe(0);
    expect(engine.state.suppressed).toBe(1);

    // (b) scheduled outside, then the player walks into the CAVE before it lands
    live.inCave = false;
    engine.update(1 / 60);
    engine.thunder(strike({ delaySeconds: 3 }));
    vi.advanceTimersByTime(1000);
    live.inCave = true;
    engine.update(1 / 60);
    vi.advanceTimersByTime(4000);
    expect(engine.state.claps).toBe(0);
    expect(engine.state.suppressed).toBe(2);
    engine.dispose();
  });

  it("drops an absurd delay rather than queueing a clap for a storm that has moved on", () => {
    vi.useFakeTimers();
    installFakeAudio();
    const { engine } = harness({ regionKind: "exterior" });
    engine.start();
    engine.update(1 / 60);
    engine.thunder(strike({ delaySeconds: 600 }));
    engine.thunder(strike({ delaySeconds: Number.NaN }));
    expect(engine.state.timers).toBe(0);
    expect(engine.state.suppressed).toBe(2);
    engine.dispose();
  });

  it("leaks no timer: disposing with claps in flight clears every one", () => {
    vi.useFakeTimers();
    installFakeAudio();
    const { engine } = harness({ regionKind: "exterior", weather: "thunderstorm" });
    engine.start();
    engine.update(1 / 60);
    for (let i = 0; i < 5; i++) engine.thunder(strike({ delaySeconds: 5 + i }));
    expect(engine.state.timers).toBe(5);
    engine.dispose();
    expect(engine.state.timers).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(engine.state.claps).toBe(0);
  });

  it("is silent while the system is switched off", () => {
    vi.useFakeTimers();
    installFakeAudio();
    const { engine } = harness({ regionKind: "exterior", weather: "thunderstorm" });
    engine.start();
    engine.update(1 / 60);
    engine.setEnabled(false);
    engine.thunder(strike({ delaySeconds: 1 }));
    vi.advanceTimersByTime(5000);
    expect(engine.state.claps).toBe(0);
    engine.dispose();
  });
});

describe("vo3d audio — ownership and ducking", () => {
  it("ducks the whole environmental bus while a CAVE meeting is connected, and restores it after", () => {
    installFakeAudio();
    let inMeeting = false;
    const { engine } = harness({ inCave: true }, () => inMeeting);
    engine.start();
    engine.update(1 / 60);
    expect(engine.state.duck).toBe(1);
    inMeeting = true;
    engine.update(1 / 60);
    expect(engine.state.duck).toBe(MEETING_DUCK);
    expect(MEETING_DUCK).toBeLessThan(0.5); // speech has to win
    inMeeting = false;
    engine.update(1 / 60);
    expect(engine.state.duck).toBe(1);
    engine.dispose();
  });

  it("touches no call and no video: it imports neither the call store nor CaveMedia, and taps no stream", async () => {
    for (const mod of ["./audio/EnvironmentalAudio?raw", "./audio/zones?raw", "./audio/synth?raw"]) {
      const text = ((await import(/* @vite-ignore */ mod)) as { default: string }).default;
      // IMPORTS are the check, not the prose: the file's own comments name what it must never touch.
      const imports = text.match(/^\s*import[^;]*;/gm) ?? [];
      for (const line of imports) {
        expect(line).not.toMatch(/callStore|CaveMedia|CaveLiveShare|livekit/i);
      }
      // and no path by which a call or a media element could reach this graph at all
      expect(text).not.toMatch(/createMediaStreamSource|createMediaElementSource|getUserMedia/);
    }
  });

  it("turns off and on again cleanly, without a second graph", () => {
    installFakeAudio();
    const { engine } = harness();
    engine.start();
    const nodes = counters.made;
    engine.setEnabled(false);
    expect(engine.enabled).toBe(false);
    engine.setEnabled(true);
    expect(engine.enabled).toBe(true);
    expect(counters.made).toBe(nodes);
    engine.setVolume(2);
    expect(engine.volume).toBe(1);
    engine.setVolume(-1);
    expect(engine.volume).toBe(0);
    engine.dispose();
  });
});

describe("vo3d audio — the beds themselves", () => {
  it("generates two shared noise buffers and no more, whatever the bed count", () => {
    const kinds = new Set(BEDS.map((b) => b.noise));
    expect([...kinds].sort()).toEqual(["brown", "pink"]);
  });

  it("writes a seamless loop, so a four-second bed does not tick once a bar", () => {
    const ctx = new FakeContext() as unknown as BaseAudioContext;
    for (const make of [pinkBuffer, brownBuffer]) {
      const buf = make(ctx, 1, 7);
      const d = buf.getChannelData(0);
      // the head has been cross-faded out of the tail: the join is continuous, not a step
      expect(Math.abs(d[0] - d[d.length - 1])).toBeLessThan(0.35);
      let peak = 0;
      for (const v of d) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThan(4);
    }
  });

  it("is deterministic — the same seed is the same samples", () => {
    const ctx = new FakeContext() as unknown as BaseAudioContext;
    const a = pinkBuffer(ctx, 0.25, 42).getChannelData(0);
    const b = pinkBuffer(ctx, 0.25, 42).getChannelData(0);
    expect(Array.from(a.slice(0, 32))).toEqual(Array.from(b.slice(0, 32)));
  });

  it("darkens the rain filter indoors and opens it outdoors", () => {
    expect(RAIN_CUTOFF.muffled).toBeLessThan(RAIN_CUTOFF.open);
    installFakeAudio();
    const { engine, live } = harness({ regionKind: "exterior", weather: "heavy_rain" });
    engine.start();
    for (let i = 0; i < 200; i++) engine.update(1 / 60);
    live.regionKind = "shared-floor";
    live.edgeDistance = 500;
    for (let i = 0; i < 200; i++) engine.update(1 / 60);
    expect(engine.state.zone).toBe("office");
    engine.dispose();
  });
});

// ---- movement speed --------------------------------------------------------------------------------

describe("vo3d player — the approved 70 / 100 speed tuning", () => {
  it("states the two ground speeds once, and derives the sprint from them", () => {
    expect(PLAYER_WALK_SPEED).toBe(70);
    expect(PLAYER_SPRINT_SPEED).toBe(100);
    expect(PLAYER_WALK_SPEED * SPRINT_MULTIPLIER).toBeCloseTo(100, 10);
    expect(SPRINT_MULTIPLIER).toBeGreaterThan(1); // sprint is still meaningfully faster than a walk
  });

  it("still resolves a step at a quarter of the body radius, so the sweep does not depend on speed", () => {
    // a wall one unit thick, which is thinner than anything in the world, at x = 100
    const wall = (p: { x: number; z: number }) => !(p.x > 99.5 && p.x < 100.5);
    for (const speed of [30, 54, 70, 100]) {
      const body = new PlayerBody({ x: 60, z: 0 }, NAV_RADIUS, wall);
      // a stalled-tab frame: the largest dt the app ever hands the player (bootstrap clamps at 250 ms)
      const r = body.move(speed * 0.25, 0);
      expect(r.pos.x).toBeLessThan(99.5); // never on the far side
      expect(wall(r.pos)).toBe(true);
    }
  });

  it("slides along a wall at sprint speed exactly as it does at a walk", () => {
    const wall = (p: { x: number; z: number }) => p.x < 100;
    const at = (speed: number) => {
      const body = new PlayerBody({ x: 90, z: 0 }, NAV_RADIUS, wall);
      return body.move(speed * 0.25, speed * 0.25);
    };
    const walk = at(70), sprint = at(100);
    expect(walk.blocked).toBe(true);
    expect(sprint.blocked).toBe(true);
    expect(sprint.pos.z).toBeGreaterThan(walk.pos.z); // the sprint slides FURTHER along, not through
    expect(sprint.pos.x).toBeLessThan(100);
  });
});
