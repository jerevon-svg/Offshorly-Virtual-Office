// vo3d audio — THE HALLOWEEN LAYER. A wind moan, a spectral shimmer and occasional creaks.
//
// ══ WHY IT IS SYNTHESISED AND NOT SAMPLED ══
//
// There are no audio FILES anywhere in this project: every sound the office makes is generated at
// runtime by audio/synth.ts (filtered noise buffers and short oscillator voices). This layer follows
// that, which also settles the licensing question by construction — nothing is downloaded, nothing
// is bundled, and there is no third-party asset to attribute or get wrong.
//
// ══ WHAT IT IS ALLOWED TO TOUCH ══
//
// It is handed a context and ONE gain node to hang off, and that node is a child of the environment's
// master. Everything the environment already guarantees therefore applies to it unchanged and without
// this file knowing about any of it:
//   · the context is created lazily on a real user gesture, so nothing autoplays;
//   · the Audio volume setting and the mute switch move the master it hangs under;
//   · a CAVE meeting ducks the master, so a call is never fought by a ghost;
//   · it never sees the microphone, remote participants or screen share — LiveKit owns those and
//     this graph does not reference the call store at all.
//
// ══ RESTRAINT ══
//
// No jump scares. The creaks are quiet, irregular and far apart (20–70s), the wind is a slow moan an
// order below speech, and nothing here is percussive. The brief asked for atmosphere, and atmosphere
// that can be picked out of a quiet room is already too loud.
import { brownBuffer, pinkBuffer } from "./synth";

/** Master level for the whole haunted layer, as a fraction of the environment's own master. */
const HAUNT_LEVEL = 0.4;
/** Seconds between creaks, randomised in this range. Far apart on purpose. */
const CREAK_GAP = { min: 20, max: 70 };

export class HauntAudio {
  private readonly ctx: AudioContext;
  private readonly out: GainNode;
  private readonly nodes: AudioNode[] = [];
  private creakTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** 0…1, ramped rather than switched so arriving in the season is a fade. */
  private wanted = 0;

  constructor(ctx: AudioContext, parent: GainNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(parent);

    // ---- the wind moan: brown noise through a narrow band-pass whose centre drifts --------------
    // A fixed band is a hiss; a drifting one is wind. The LFO is what does the whole job.
    const wind = ctx.createBufferSource();
    wind.buffer = brownBuffer(ctx, 6, 0x4a17);
    wind.loop = true;
    const windBand = ctx.createBiquadFilter();
    windBand.type = "bandpass";
    windBand.frequency.value = 220;
    windBand.Q.value = 3.2;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.55;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045; // one slow breath every ~22 seconds
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 120;
    lfo.connect(lfoDepth).connect(windBand.frequency);
    wind.connect(windBand).connect(windGain).connect(this.out);
    wind.start();
    lfo.start();
    this.nodes.push(wind, windBand, windGain, lfo, lfoDepth);

    // ---- the spectral shimmer: a very quiet high band, barely present --------------------------
    // What makes a room feel watched rather than merely windy. Deliberately near the noise floor.
    const shimmer = ctx.createBufferSource();
    shimmer.buffer = pinkBuffer(ctx, 5, 0x9e11);
    shimmer.loop = true;
    const shimmerBand = ctx.createBiquadFilter();
    shimmerBand.type = "bandpass";
    shimmerBand.frequency.value = 2600;
    shimmerBand.Q.value = 6;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0.05;
    shimmer.connect(shimmerBand).connect(shimmerGain).connect(this.out);
    shimmer.start();
    this.nodes.push(shimmer, shimmerBand, shimmerGain);

    this.scheduleCreak();
  }

  /** A CREAK: one short, low, resonant swell — a building settling, not a door slamming. */
  private creak(): void {
    if (this.disposed || this.wanted <= 0) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    const base = 58 + Math.random() * 40;
    osc.frequency.setValueAtTime(base, t);
    // The pitch SLIDES, which is what makes it read as timber under load rather than as a note.
    osc.frequency.exponentialRampToValueAtTime(base * (1.1 + Math.random() * 0.35), t + 0.7);
    const band = this.ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 320;
    band.Q.value = 9;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.16 + Math.random() * 0.1, t + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    osc.connect(band).connect(gain).connect(this.out);
    osc.start(t);
    osc.stop(t + 1.6);
    // Self-cleaning: the voice disconnects itself when it ends, so a long session cannot accumulate
    // dead nodes on the graph.
    osc.onended = () => { osc.disconnect(); band.disconnect(); gain.disconnect(); };
    this.scheduleCreak();
  }

  private scheduleCreak(): void {
    if (this.disposed) return;
    const gap = CREAK_GAP.min + Math.random() * (CREAK_GAP.max - CREAK_GAP.min);
    this.creakTimer = setTimeout(() => this.creak(), gap * 1000);
  }

  /** 0 = silent, 1 = the season's full (still quiet) level. Ramped, never switched. */
  setLevel(level: number): void {
    if (this.disposed) return;
    this.wanted = Math.max(0, Math.min(1, level));
    this.out.gain.setTargetAtTime(this.wanted * HAUNT_LEVEL, this.ctx.currentTime, 0.8);
  }

  /** Idempotent. Stops every source, cancels the creak timer and disconnects the subtree, so leaving
   *  Halloween leaves no node, no timer and no sound behind. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.creakTimer !== null) clearTimeout(this.creakTimer);
    this.creakTimer = null;
    for (const node of this.nodes) {
      const source = node as AudioBufferSourceNode & { stop?: () => void };
      try { source.stop?.(); } catch { /* already stopped; stopping twice is not an error worth raising */ }
      node.disconnect();
    }
    this.nodes.length = 0;
    this.out.disconnect();
  }
}
