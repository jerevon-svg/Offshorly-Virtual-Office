// vo3d audio — THE ENVIRONMENTAL MIXER. One AudioContext, ten beds, and nothing per frame but floats.
//
// WHAT IT OWNS, EXACTLY: world ambience, weather ambience and thunder. That is the entire list.
//
// WHAT IT DOES NOT OWN, AND MUST NEVER TOUCH:
//   · the microphone, remote participant audio and screen-share audio — LiveKit owns all three, through
//     services/call/callStore. Not one sample of a call ever enters this graph, and this file does not
//     import, read or reference the call store at all.
//   · SUNTOUCAN — media/CaveMedia owns the boxing video and its soundtrack on its own HTMLVideoElement.
//     The CAVE's theatre bed here is ROOM TONE: the air of a large dark room, not its programme.
//   Ducking is therefore the ONLY interaction with a meeting, it is one number multiplied into this
//   graph's own master gain, and it changes nothing on the LiveKit side.
//
// WHY ONE CONTEXT. A browser allows a handful of AudioContexts per page and each one costs a real audio
// thread; a second one here would also be a second clock to keep the first in sync with. So: one context,
// created LAZILY on the first user gesture (see `arm`), and everything hangs off its master gain.
//
// THE PER-FRAME PATH, in full: one mixInto() (pure arithmetic, no allocation), ten exponential approaches,
// and a float write per bed that actually moved. No node is created, connected, disconnected or looked up
// on a frame, and nothing is allocated. A settled world costs ten comparisons.
import type { ThunderEvent } from "../env/Lightning";
import { BED_IDS, emptyMix, mixInto, zoneFor, type BedId, type ZoneContext, type ZoneId, type ZoneMix } from "./zones";
import { birdVoice, brownBuffer, pinkBuffer, thunderVoice } from "./synth";
import { SFX_LIFETIME_MS, sfxVoice, type SfxKind, type SfxOptions } from "./sfx";
import { HauntAudio } from "./HauntAudio";

/** HOW FAST A BED TRAVELS to its target, as the time constant of an exponential approach, in seconds.
 *  Long enough that a doorway is a crossfade and not a switch; short enough that stepping outside into a
 *  storm is not still arriving three strides later. */
export const TAU = 0.55;
/** master level the whole system sits under. Ambience that can be noticed on purpose is too loud. */
export const DEFAULT_VOLUME = 0.7;
/** what the environment is multiplied by while a CAVE meeting is connected. Speech wins; the room stays. */
export const MEETING_DUCK = 0.35;
/** ceiling on simultaneous one-shot voices — claps, birds and every piece of foley share it. A storm
 *  cannot outgrow it, and neither can a player sprinting through a room full of doors. */
export const MAX_VOICES = 14;
/** the foley bus sits under master at this level, so world events can be balanced against the beds
 *  without touching either. */
export const SFX_BUS = 0.85;
/** a clap further in the future than this is a storm that has already moved on — dropped, not queued */
export const MAX_THUNDER_DELAY_S = 30;

type BedSpec = {
  id: BedId;
  noise: "pink" | "brown";
  filter: BiquadFilterType;
  freq: number;
  q: number;
  /** buffer playback rate — the cheapest way to move a noise bed's whole character */
  rate: number;
  /** optional high-pass ahead of the main filter (rain is a band, not a roll-off) */
  hp?: number;
  /** optional electrical/machine tone mixed under the noise, in Hz */
  tone?: number;
};

/** THE TEN BEDS. Every room in the world is one of these at some weight (audio/zones LEVEL). */
export const BEDS: BedSpec[] = [
  { id: "wind", noise: "brown", filter: "bandpass", freq: 380, q: 0.55, rate: 1 },
  { id: "city", noise: "brown", filter: "lowpass", freq: 200, q: 0.7, rate: 0.8 },
  { id: "night", noise: "pink", filter: "bandpass", freq: 2800, q: 1.4, rate: 1 },
  { id: "office", noise: "brown", filter: "lowpass", freq: 150, q: 0.5, rate: 0.9 },
  { id: "hub", noise: "pink", filter: "bandpass", freq: 520, q: 0.8, rate: 0.85 },
  { id: "gaming", noise: "pink", filter: "bandpass", freq: 1500, q: 2.6, rate: 1.1, tone: 78 },
  { id: "ai", noise: "brown", filter: "lowpass", freq: 110, q: 0.6, rate: 0.7, tone: 102 },
  { id: "cave", noise: "brown", filter: "lowpass", freq: 85, q: 0.5, rate: 0.6 },
  { id: "portal", noise: "brown", filter: "lowpass", freq: 160, q: 0.6, rate: 0.7 },
  { id: "rain", noise: "pink", filter: "lowpass", freq: 6000, q: 0.5, rate: 1, hp: 700 },
];

/** the rain low-pass, open and fully muffled. One number interpolated between them by `mix.muffle`. */
export const RAIN_CUTOFF = { open: 6000, muffled: 700 };

type Bed = {
  spec: BedSpec;
  src: AudioBufferSourceNode;
  hp: BiquadFilterNode | null;
  filter: BiquadFilterNode;
  tone: OscillatorNode | null;
  /** the tone's own trim gain — held so dispose can disconnect it too, not just the oscillator */
  toneGain: GainNode | null;
  gain: GainNode;
  shown: number;
};

export type EnvAudioState = {
  status: "idle" | "running" | "suspended" | "unsupported";
  /** the switch, distinct from `status`: the context can be running while the system is muted */
  enabled: boolean;
  zone: ZoneId | "—";
  /** live node count, so a leak shows up as a number that grows */
  nodes: number;
  voices: number;
  timers: number;
  contexts: number;
  claps: number;
  suppressed: number;
  birds: number;
  /** one-shot foley events played since start (dev readout; a stuck sensor shows up as a racing number) */
  sfx: number;
  /** foley events refused because the pool was full — should stay 0 in normal play */
  dropped: number;
  duck: number;
};

export type EnvAudioDeps = {
  /** the world/weather/time/cave sample for this frame. Called once per update; must not allocate. */
  sample: (into: ZoneContext) => void;
  /** true while a CAVE meeting is connected — the ONLY thing a call is ever asked for */
  meeting?: () => boolean;
};

export class EnvironmentalAudio {
  private readonly d: EnvAudioDeps;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** THE SEASONAL LAYER. Null in the ordinary office and it costs nothing there — not a node, not a
   *  timer. Built when a season asks for it and only once the context exists, so it inherits the
   *  lazy-on-user-gesture rule rather than restating it. */
  private haunt: HauntAudio | null = null;
  private hauntWanted = 0;
  /** the foley sub-bus. One node for the life of the engine; every one-shot connects to THIS, never to
   *  the destination, so ducking and the master switch reach world events exactly as they reach beds. */
  private sfxBus: GainNode | null = null;
  private readonly beds = new Map<BedId, Bed>();
  private readonly voices = new Set<{ stop: () => void }>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private pink: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private armed = false;
  private disposed = false;
  private _enabled = true;
  private _volume = DEFAULT_VOLUME;
  private duck = 1;
  private shownMuffle = -1;
  private birdIn = 4;
  private seed = 0x51de5;
  /** preallocated: the per-frame path allocates nothing */
  private readonly mix: ZoneMix = emptyMix();
  private readonly ctxIn: ZoneContext = {
    inCave: false, regionKind: null, roomId: null, portalDistance: Number.POSITIVE_INFINITY,
    edgeDistance: Number.POSITIVE_INFINITY, weather: "clear", intensity: 1, phase: "day",
  };
  readonly state: EnvAudioState = {
    status: "idle", enabled: true, zone: "—", nodes: 0, voices: 0, timers: 0, contexts: 0,
    claps: 0, suppressed: 0, birds: 0, sfx: 0, dropped: 0, duck: 1,
  };

  constructor(deps: EnvAudioDeps) {
    this.d = deps;
  }

  get running(): boolean {
    return this.ctx !== null && !this.disposed;
  }
  get enabled(): boolean {
    return this._enabled;
  }
  get volume(): number {
    return this._volume;
  }

  /** BROWSER AUTOPLAY, RESPECTED. Nothing is created, fetched or played until a real gesture happens —
   *  so a page load is silent, always, and the first sound the user hears is one they asked for by
   *  clicking into the world. Entering PLAYER mode, clicking the canvas or pressing a key all qualify. */
  /** SEASONAL AMBIENCE, 0 = off. Safe to call before the context is armed — the level is remembered
   *  and the layer is built when audio starts. Setting 0 disposes it outright, so switching out of a
   *  season leaves no node and no timer behind. */
  setSeasonAmbience(level: number): void {
    this.hauntWanted = Math.max(0, Math.min(1, level));
    if (this.hauntWanted === 0) {
      this.haunt?.dispose();
      this.haunt = null;
      return;
    }
    if (!this.haunt && this.ctx && this.master) this.haunt = new HauntAudio(this.ctx, this.master);
    this.haunt?.setLevel(this.hauntWanted);
  }

  arm(): void {
    if (this.armed || this.disposed || typeof document === "undefined") return;
    this.armed = true;
    const go = (): void => { this.start(); };
    document.addEventListener("pointerdown", go, { once: false });
    document.addEventListener("keydown", go, { once: false });
    this.disarm = () => {
      document.removeEventListener("pointerdown", go);
      document.removeEventListener("keydown", go);
    };
  }
  private disarm: (() => void) | null = null;

  /** Build the graph (idempotent). Safe to call from a gesture handler, and safe to call without one —
   *  the context simply stays suspended until a gesture resumes it. */
  start(): boolean {
    if (this.disposed) return false;
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      this.state.status = this.ctx.state === "running" ? "running" : "suspended";
      return true;
    }
    const Ctor = typeof window === "undefined"
      ? undefined
      : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) { this.state.status = "unsupported"; return false; }
    const ctx = new Ctor();
    this.ctx = ctx;
    this.state.contexts = 1;
    this.pink = pinkBuffer(ctx);
    this.brown = brownBuffer(ctx);
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.master = master;
    const bus = ctx.createGain();
    bus.gain.value = SFX_BUS;
    bus.connect(master);
    this.sfxBus = bus;
    for (const spec of BEDS) this.beds.set(spec.id, this.buildBed(ctx, master, spec));
    // A season asked for its layer before the context existed (the ordinary case: the world is built
    // long before the first gesture arms audio). Build it now, at the level it asked for.
    if (this.hauntWanted > 0) {
      this.haunt = new HauntAudio(ctx, master);
      this.haunt.setLevel(this.hauntWanted);
    }
    this.writeMaster();
    if (ctx.state === "suspended") void ctx.resume();
    this.state.status = ctx.state === "running" ? "running" : "suspended";
    this.state.nodes = this.countNodes();
    this.disarm?.();
    this.disarm = null;
    return true;
  }

  private buildBed(ctx: AudioContext, master: GainNode, spec: BedSpec): Bed {
    const src = ctx.createBufferSource();
    src.buffer = spec.noise === "pink" ? this.pink : this.brown;
    src.loop = true;
    src.playbackRate.value = spec.rate;
    const filter = ctx.createBiquadFilter();
    filter.type = spec.filter;
    filter.frequency.value = spec.freq;
    filter.Q.value = spec.q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    let hp: BiquadFilterNode | null = null;
    if (spec.hp !== undefined) {
      hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = spec.hp;
      src.connect(hp).connect(filter);
    } else src.connect(filter);
    filter.connect(gain).connect(master);
    let tone: OscillatorNode | null = null;
    let toneGain: GainNode | null = null;
    if (spec.tone !== undefined) {
      tone = ctx.createOscillator();
      tone.type = "sine";
      tone.frequency.value = spec.tone;
      toneGain = ctx.createGain();
      toneGain.gain.value = 0.09; // a trace under the noise: machinery, not a test tone
      tone.connect(toneGain).connect(gain);
      tone.start();
    }
    src.start();
    return { spec, src, hp, filter, tone, toneGain, gain, shown: 0 };
  }

  /** ON / OFF. Off leaves the graph standing but silent and stops the schedulers, so flipping it back on
   *  costs nothing and cannot double up. */
  setEnabled(on: boolean): void {
    this._enabled = on;
    this.state.enabled = on;
    this.writeMaster();
    if (!on) this.stopVoices();
  }
  setVolume(v: number): void {
    this._volume = v < 0 ? 0 : v > 1 ? 1 : v;
    this.writeMaster();
  }

  private writeMaster(): void {
    if (!this.master || !this.ctx) return;
    const want = this._enabled ? this._volume * this.duck : 0;
    // a short ramp, not a jump: muting on a frame boundary clicks
    this.master.gain.setTargetAtTime(want, this.ctx.currentTime, 0.05);
    this.state.duck = Math.round(this.duck * 100) / 100;
  }

  /** THE PER-FRAME CALL. Allocation-free, node-free. */
  update(dtSeconds: number): void {
    if (!this.ctx || this.disposed) return;
    const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? Math.min(0.25, dtSeconds) : 0;
    this.d.sample(this.ctxIn);
    mixInto(this.mix, this.ctxIn);
    this.state.zone = zoneFor(this.ctxIn);

    const duck = this.d.meeting?.() ? MEETING_DUCK : 1;
    if (duck !== this.duck) { this.duck = duck; this.writeMaster(); }

    const u = dt > 0 ? 1 - Math.exp(-dt / TAU) : 0;
    for (const id of BED_IDS) {
      const bed = this.beds.get(id);
      if (!bed) continue;
      const target = this.mix.beds[id];
      if (u > 0) bed.shown += (target - bed.shown) * u;
      // written ONLY when it moved: a settled world writes nothing at all
      if (Math.abs(bed.gain.gain.value - bed.shown) > 1e-4) bed.gain.gain.value = bed.shown;
    }
    // rain through a wall is quieter AND darker; the cutoff is one write, and only when it moved
    if (Math.abs(this.mix.muffle - this.shownMuffle) > 0.01) {
      this.shownMuffle = this.mix.muffle;
      const rain = this.beds.get("rain");
      if (rain) rain.filter.frequency.value = RAIN_CUTOFF.open + (RAIN_CUTOFF.muffled - RAIN_CUTOFF.open) * this.shownMuffle;
    }
    this.tickBirds(dt);
    this.state.voices = this.voices.size;
    this.state.timers = this.timers.size;
    this.state.status = this.ctx.state === "running" ? "running" : "suspended";
  }

  /** THE FOLEY ENTRY POINT. One call per real world EVENT — a door that started opening, a foot that
   *  landed, a chair that was pulled out. Callers never ask whether the event is new: audio/events
   *  EdgeTracker answers that, and this plays whatever it is handed.
   *
   *  Refuses silently when the pool is full rather than stealing a voice, and counts the refusal: a foley
   *  layer that steals is a foley layer whose door sound gets cut off by a footstep. Returns whether it
   *  played, so a test can assert the bound. */
  play(kind: SfxKind, opts: SfxOptions = {}): boolean {
    const ctx = this.ctx;
    if (!ctx || this.disposed || !this._enabled || !this.sfxBus) return false;
    if (!this.pink || !this.brown) return false;
    if ((opts.gain ?? 1) <= 0.0008) return false; // inaudible at this distance: not worth a voice
    if (this.voices.size >= MAX_VOICES) { this.state.dropped++; return false; }
    const v = sfxVoice(ctx, this.sfxBus, { pink: this.pink, brown: this.brown }, kind, opts);
    this.voices.add(v);
    this.state.sfx++;
    // the sweep is the ONLY thing that returns a slot: each voice has already stopped and disconnected
    // itself on `ended` by the time it runs, so this frees bookkeeping, never audio.
    const sweep = setTimeout(() => { this.voices.delete(v); this.timers.delete(sweep); }, SFX_LIFETIME_MS[kind]);
    this.timers.add(sweep);
    return true;
  }

  /** THUNDER, off env/Environment's EXISTING seam. No scheduler is invented here: Lightning decides when
   *  the sky lights, how hard, how far away and therefore how many seconds later the clap is heard, and
   *  this only waits that long and plays it.
   *
   *  CAVE ISOLATION IS ENFORCED TWICE. Environment stops the lightning scheduler outright in the sealed
   *  interior, so no strike can even be emitted in there — but a clap scheduled in the open a few seconds
   *  before the portal is entered would still be in flight. It is dropped at FIRING time if the listener
   *  is inside, which is the only place that check can be correct. */
  thunder(e: ThunderEvent): void {
    if (!this.ctx || this.disposed || !this._enabled) return;
    if (this.ctxIn.inCave) { this.state.suppressed++; return; }
    if (!(e.delaySeconds >= 0) || e.delaySeconds > MAX_THUNDER_DELAY_S) { this.state.suppressed++; return; }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      const ctx = this.ctx;
      if (!ctx || this.disposed || !this._enabled) return;
      if (this.ctxIn.inCave) { this.state.suppressed++; return; } // walked inside while it was travelling
      if (this.voices.size >= MAX_VOICES) { this.state.suppressed++; return; }
      const noise = this.brown;
      if (!this.master || !noise) return;
      const v = thunderVoice(ctx, this.master, noise, { strength: e.strength, distanceKm: e.distanceKm, double: e.double });
      this.voices.add(v);
      this.state.claps++;
      const sweep = setTimeout(() => { this.voices.delete(v); this.timers.delete(sweep); }, 8000);
      this.timers.add(sweep);
    }, e.delaySeconds * 1000);
    this.timers.add(timer);
    this.state.timers = this.timers.size;
  }

  /** Birds are SPARSE and weather/phase-gated (audio/zones). A chirp is three nodes for a fifth of a
   *  second; the countdown is one subtraction on the frames where none is due. */
  private tickBirds(dt: number): void {
    if (!this._enabled || this.mix.birds <= 0.01) { this.birdIn = 3 + this.rand() * 6; return; }
    this.birdIn -= dt * this.mix.birds;
    if (this.birdIn > 0) return;
    this.birdIn = 4 + this.rand() * 9;
    const ctx = this.ctx;
    if (!ctx || !this.master || this.voices.size >= MAX_VOICES) return;
    const v = birdVoice(ctx, this.master, { pitch: 2100 + this.rand() * 1500, level: 0.03 * this.mix.birds });
    this.voices.add(v);
    this.state.birds++;
    const sweep = setTimeout(() => { this.voices.delete(v); this.timers.delete(sweep); }, 600);
    this.timers.add(sweep);
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }

  private stopVoices(): void {
    for (const v of this.voices) v.stop();
    this.voices.clear();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.state.voices = 0;
    this.state.timers = 0;
  }

  /** live node count — beds (source + filters + gain + tone) plus one master. The readout a leak shows in. */
  private countNodes(): number {
    let n = 2; // master + the foley bus
    for (const b of this.beds.values()) n += 3 + (b.hp ? 1 : 0) + (b.tone ? 2 : 0);
    return n;
  }

  /** EVERYTHING GOES. Sources stopped, oscillators stopped, nodes disconnected, timers cleared, context
   *  closed. Called twice is a no-op; the object is dead afterwards and `start()` refuses. */
  dispose(): void {
    this.haunt?.dispose();
    this.haunt = null;
    if (this.disposed) return;
    this.disposed = true;
    this.disarm?.();
    this.disarm = null;
    this.stopVoices();
    for (const b of this.beds.values()) {
      try { b.src.stop(); } catch { /* never started (no context): nothing to stop */ }
      try { b.tone?.stop(); } catch { /* as above */ }
      b.src.disconnect();
      b.hp?.disconnect();
      b.filter.disconnect();
      b.tone?.disconnect();
      b.toneGain?.disconnect();
      b.gain.disconnect();
    }
    this.beds.clear();
    this.sfxBus?.disconnect();
    this.sfxBus = null;
    this.master?.disconnect();
    this.master = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.pink = null;
    this.brown = null;
    this.state.contexts = 0;
    this.state.nodes = 0;
    this.state.status = "idle";
    void ctx?.close().catch(() => { /* already closed by the page going away */ });
  }
}
