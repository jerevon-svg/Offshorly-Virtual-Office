// vo3d audio — THE FOLEY VOICES. One-shot sounds for things that HAPPEN, as opposed to the beds in
// audio/synth.ts, which are how a place sounds when nothing is happening.
//
// SAME RULES AS THE BEDS, and for the same reasons: procedural (the repo has no foley library and none
// was bought or downloaded), built out of the SHARED noise buffers the mixer already owns, and every
// voice disposes itself on `ended` so a thousand footsteps leave nothing behind.
//
// WHY THESE ARE ONE-SHOTS AND NOT SAMPLES. A door servo is a band of noise whose centre frequency slides;
// a footstep is a short burst through a resonant filter; a scanner chirp is two sines. Written as
// synthesis they are three to five nodes each, alive for a fraction of a second, and — crucially —
// PARAMETERISABLE: a footstep can be pitched and levelled per step, which is the whole difference between
// "footsteps" and "the same click sixty times".
import type { Vec2 } from "../core/coords";

/** what every voice hands back: enough to stop it early, and nothing else */
export type Voice = { stop: () => void };

/** the foley families. Adding a sound means adding a case here, not a subsystem. */
export type SfxKind =
  | "doorOpen" | "doorClose" | "scanner" | "footstep" | "chairMove" | "chairSit" | "chairStand"
  | "click" | "portal" | "toucanCall";

export type SfxOptions = {
  /** 0…1 level before the bus gain */
  gain?: number;
  /** multiplies every frequency in the voice — the cheapest natural variation there is */
  pitch?: number;
  /** −1 left … +1 right. Omitted or 0 costs no panner node at all. */
  pan?: number;
  /** true for the sprint variant of a footstep */
  hard?: boolean;
};

/** WORLD POSITION → what a one-shot should sound like from where the listener is standing.
 *  Deliberately arithmetic rather than a PannerNode: a HRTF panner per footstep is a spatialiser's worth
 *  of work for a sound that lasts 90 ms, and a pan plus a distance curve is what actually reads. */
export function spatial(from: Vec2, listener: Vec2, facingYaw: number, range: number): { gain: number; pan: number } {
  const dx = from.x - listener.x, dz = from.z - listener.z;
  const d = Math.hypot(dx, dz);
  // inverse-ish falloff with a soft knee, floored at 0 past `range` so nothing is ever inaudibly summed
  const gain = d >= range ? 0 : (1 - d / range) ** 1.6;
  if (d < 1e-3) return { gain, pan: 0 };
  // the component of the source direction along the listener's RIGHT vector. facingYaw is this world's
  // compass yaw (0 = north = −z), so right is (cos yaw, sin yaw).
  const rx = Math.cos(facingYaw), rz = Math.sin(facingYaw);
  const pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d));
  return { gain, pan };
}

/** Route a voice's tail through a panner only when it is actually off-centre. */
function sink(ctx: AudioContext, dest: AudioNode, pan: number | undefined): { node: AudioNode; extra: AudioNode | null } {
  if (!pan || Math.abs(pan) < 0.02 || typeof ctx.createStereoPanner !== "function") return { node: dest, extra: null };
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(dest);
  return { node: p, extra: p };
}

/** THE ONE CONSTRUCTOR. Every family is a short recipe over the same three primitives — a noise source,
 *  a filter and a gain envelope — so there is exactly one teardown path and one place voices can leak. */
export function sfxVoice(
  ctx: AudioContext, dest: AudioNode, noise: { pink: AudioBuffer; brown: AudioBuffer },
  kind: SfxKind, opts: SfxOptions = {},
): Voice {
  const now = ctx.currentTime;
  const g0 = opts.gain ?? 1;
  const k = opts.pitch ?? 1;
  const { node: out, extra } = sink(ctx, dest, opts.pan);
  const made: AudioNode[] = extra ? [extra] : [];
  let endsAt = now + 0.3;

  /** a filtered burst of one of the shared buffers */
  const burst = (
    buf: AudioBuffer, rate: number, type: BiquadFilterType, f0: number, f1: number, q: number,
    attack: number, hold: number, release: number, level: number,
  ): void => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0 * k, now);
    if (f1 !== f0) filt.frequency.linearRampToValueAtTime(f1 * k, now + attack + hold);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, level * g0), now + attack);
    if (hold > 0) g.gain.setValueAtTime(Math.max(0.0002, level * g0), now + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, now + attack + hold + release);
    src.connect(filt).connect(g).connect(out);
    src.start(now);
    const off = now + attack + hold + release + 0.02;
    src.stop(off);
    endsAt = Math.max(endsAt, off);
    made.push(src, filt, g);
    src.onended = () => { src.disconnect(); filt.disconnect(); g.disconnect(); };
  };

  /** a tone with a swept frequency — chirps, clicks, squawks, the portal's sub */
  const tone = (
    type: OscillatorType, f0: number, f1: number, at: number, len: number, level: number,
  ): void => {
    const osc = ctx.createOscillator();
    osc.type = type;
    const g = ctx.createGain();
    const t = now + at;
    osc.frequency.setValueAtTime(f0 * k, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * k), t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * g0), t + len * 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g).connect(out);
    osc.start(t);
    const off = t + len + 0.02;
    osc.stop(off);
    endsAt = Math.max(endsAt, off);
    made.push(osc, g);
    osc.onended = () => { osc.disconnect(); g.disconnect(); };
  };

  switch (kind) {
    // A SERVO AND A STOP. The slide is a band of noise whose centre climbs as the leaf accelerates; the
    // stop is the short dull knock of a leaf reaching its travel. Closing is the same run backwards,
    // which is exactly what the mechanism does.
    case "doorOpen":
      burst(noise.pink, 0.9, "bandpass", 320, 1150, 4.5, 0.05, 0.2, 0.22, 0.1);
      burst(noise.brown, 0.6, "lowpass", 180, 180, 0.8, 0.004, 0.0, 0.13, 0.075);
      break;
    case "doorClose":
      burst(noise.pink, 0.9, "bandpass", 1050, 300, 4.5, 0.05, 0.2, 0.2, 0.09);
      burst(noise.brown, 0.5, "lowpass", 130, 130, 0.8, 0.004, 0.0, 0.19, 0.11);
      break;
    // TWO BLIPS, RISING. Premium means quiet and short: a reader acknowledging you, not a supermarket till.
    case "scanner":
      tone("sine", 1240, 1240, 0, 0.05, 0.05);
      tone("sine", 1860, 1860, 0.07, 0.07, 0.042);
      break;
    // A HEEL AND A SOLE. Two bursts 18 ms apart — that offset is most of what separates a footstep from
    // a click. `hard` is the sprint variant: brighter, louder, slightly snappier.
    case "footstep": {
      const hard = opts.hard === true;
      burst(noise.brown, 0.85, "lowpass", hard ? 320 : 240, hard ? 320 : 240, 0.9, 0.003, 0, hard ? 0.075 : 0.09, hard ? 0.085 : 0.055);
      burst(noise.pink, 1, "bandpass", hard ? 2400 : 1800, hard ? 2400 : 1800, 1.6, 0.002, 0, hard ? 0.05 : 0.04, hard ? 0.03 : 0.018);
      break;
    }
    // CASTORS ON CARPET — a long, soft, low scrape rather than an event.
    case "chairMove":
      burst(noise.brown, 0.7, "bandpass", 210, 320, 2.2, 0.09, 0.22, 0.3, 0.05);
      break;
    case "chairSit":
      burst(noise.pink, 0.8, "lowpass", 900, 420, 1, 0.02, 0.05, 0.22, 0.06);
      break;
    case "chairStand":
      burst(noise.pink, 0.8, "lowpass", 520, 1000, 1, 0.02, 0.04, 0.16, 0.045);
      break;
    // A TACTILE CLICK, not a beep: a tiny impulse with one short resonance under it.
    case "click":
      burst(noise.pink, 1, "bandpass", 2600, 2600, 7, 0.001, 0, 0.03, 0.05);
      tone("sine", 640, 470, 0.004, 0.06, 0.035);
      break;
    // THE PORTAL. A slow sub-bass fall with a swell of air over it — felt more than heard, which is what
    // "significant without becoming loud" has to mean for a threshold you cross on foot.
    case "portal":
      tone("sine", 74, 27, 0, 1.15, 0.16);
      burst(noise.brown, 0.4, "lowpass", 260, 90, 0.8, 0.35, 0.1, 0.6, 0.07);
      break;
    // THE TOUCAN. A ramphastos call is a hoarse two-note croak, not a songbird's whistle — a sawtooth
    // through a narrow band gets the rasp, and the second note falling is what makes it read as a bird
    // rather than as a siren.
    case "toucanCall":
      tone("sawtooth", 780, 700, 0, 0.16, 0.055);
      tone("sawtooth", 700, 560, 0.19, 0.2, 0.045);
      burst(noise.pink, 1, "bandpass", 1500, 1200, 3.5, 0.02, 0.1, 0.16, 0.02);
      break;
  }

  const stop = (): void => {
    for (const n of made) {
      const s = n as AudioScheduledSourceNode;
      if (typeof s.stop === "function") { try { s.stop(); } catch { /* already stopped */ } }
      n.disconnect();
    }
    made.length = 0;
  };
  return { stop, ...( { endsAt } as object) } as Voice & { endsAt: number };
}

/** how long the longest voice of each family can live, in ms — the sweep that returns a slot to the pool */
export const SFX_LIFETIME_MS: Record<SfxKind, number> = {
  doorOpen: 700, doorClose: 700, scanner: 300, footstep: 250, chairMove: 800,
  chairSit: 500, chairStand: 400, click: 200, portal: 1600, toucanCall: 600,
};
