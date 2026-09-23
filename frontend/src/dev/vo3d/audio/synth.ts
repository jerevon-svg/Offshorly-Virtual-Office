// vo3d audio — THE SOUND ITSELF, SYNTHESISED. No files, no fetch, no decode.
//
// WHY PROCEDURAL. The repo carries exactly one audio asset (a music bed for V1) and nothing that could
// honestly stand in for wind, rain, a room tone or a thunderclap. The choices were: ship bad repetitive
// loops, ship paid/licensed material, or synthesise. Filtered noise is what an ambience bed IS — a rain
// recording and a band-passed noise source are the same signal to within a room's reverb — so this is not
// a placeholder standing in for an asset; for beds it is the right implementation.
//
// TWO BUFFERS FOR THE WHOLE WORLD. One pink and one brown noise buffer, four seconds each, generated once
// and SHARED by every bed. Ten beds cost two buffers, not ten. Both are seeded, so a test gets the same
// samples twice and nothing here depends on Math.random.
//
// A LOOPING NOISE BUFFER IS NOT AUDIBLY PERIODIC at four seconds through a narrow filter — but the seam
// would tick if the buffer did not join to itself, so both generators cross-fade their own tail into
// their own head. That is the one non-obvious line in this file.

/** LCG. Deterministic on purpose — see env/Lightning for the same reasoning. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 * 2 - 1;
  };
}

/** how much overrun is folded back over the head so a loop cannot tick, in seconds */
const SEAM = 0.25;

/** THE LOOP JOIN. Generate SEAM seconds MORE than the buffer holds, then cross-fade that overrun into
 *  the head. The last sample of the buffer is then the generator's own sample L-1, and the first is its
 *  sample L — so playing the end straight into the start is exactly as continuous as the middle is, and
 *  there is no step for the ear to latch onto as a period. Folding the tail back over the head WITHOUT
 *  the overrun (the obvious version) does not achieve this: it makes the first sample equal to one from
 *  the middle of the tail, which is a discontinuity in a different place. */
function fold(raw: Float32Array, out: Float32Array, n: number): void {
  const L = out.length;
  out.set(raw.subarray(0, L));
  for (let i = 0; i < n; i++) {
    const w = i / n;
    out[i] = raw[i] * w + raw[L + i] * (1 - w);
  }
}

/** PINK-ish noise (Voss-McCartney, 5 rows). The hiss of rain and of air. */
export function pinkBuffer(ctx: BaseAudioContext, seconds = 4, seed = 0xa11ce): AudioBuffer {
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(seconds * rate), rate);
  const d = buf.getChannelData(0);
  const n = Math.min(d.length >> 1, Math.floor(SEAM * rate));
  const raw = new Float32Array(d.length + n);
  const rand = rng(seed);
  const rows = [0, 0, 0, 0, 0];
  for (let i = 0; i < raw.length; i++) {
    // each row updates half as often as the one before it, which is what makes the spectrum 1/f
    for (let r = 0; r < rows.length; r++) if (i % (1 << r) === 0) rows[r] = rand();
    raw[i] = (rows[0] + rows[1] + rows[2] + rows[3] + rows[4]) * 0.18;
  }
  fold(raw, d, n);
  return buf;
}

/** BROWN noise (integrated white, leaky). The body of wind, of a room and of distance. */
export function brownBuffer(ctx: BaseAudioContext, seconds = 4, seed = 0xb0b): AudioBuffer {
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(seconds * rate), rate);
  const d = buf.getChannelData(0);
  const n = Math.min(d.length >> 1, Math.floor(SEAM * rate));
  const raw = new Float32Array(d.length + n);
  const rand = rng(seed);
  let last = 0;
  for (let i = 0; i < raw.length; i++) {
    last = (last + rand() * 0.035) * 0.996;
    raw[i] = last * 3.2;
  }
  fold(raw, d, n);
  return buf;
}

/** THE THUNDER VOICE. Two nodes plus a gain, built per clap and disposed on its own `ended` — a clap is
 *  a handful a minute at worst, and nothing here is created per frame.
 *
 *  DISTANCE IS THE WHOLE CHARACTER. A near strike is a crack: bright, short, a hard transient. A far one
 *  is a roll: nothing above a few hundred hertz survives ten kilometres of air, and the sound smears out
 *  over seconds. Both fall out of ONE low-pass whose cutoff and whose envelope are read off distanceKm,
 *  which is why no two claps in a storm sound alike — Lightning already varies the distance.
 *
 *  Returns the nodes it made so the caller can count and tear them down. */
export function thunderVoice(
  ctx: AudioContext, dest: AudioNode, noise: AudioBuffer,
  opts: { strength: number; distanceKm: number; double: boolean },
): { stop: () => void } {
  const now = ctx.currentTime;
  const far = Math.min(1, Math.max(0, (opts.distanceKm - 0.8) / 11));
  // 1.6 kHz overhead down to 120 Hz at the far edge — the air's own low-pass, stated as one number
  const cutoff = 1600 - 1480 * far;
  // a crack lasts under a second; a roll runs for five
  const attack = 0.006 + 0.09 * far;
  const body = 0.5 + 4.5 * far;
  const peak = Math.min(0.85, opts.strength * (0.55 + 0.45 * (1 - far)));

  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  // playbackRate under 1 drags the noise DOWN in pitch, which is most of what makes distance read
  src.playbackRate.value = 0.55 - 0.25 * far;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = cutoff;
  lp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(peak, now + attack);
  // the roll: exponential decay, plus a second swell for a double stroke so it rolls rather than repeats
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.35), now + attack + body * 0.35);
  if (opts.double) g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.5), now + attack + body * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, now + attack + body);

  src.connect(lp).connect(g).connect(dest);
  src.start(now);
  src.stop(now + attack + body + 0.05);
  const stop = (): void => {
    try { src.stop(); } catch { /* already stopped — stopping twice is not an error worth propagating */ }
    src.disconnect();
    lp.disconnect();
    g.disconnect();
  };
  src.onended = () => { src.disconnect(); lp.disconnect(); g.disconnect(); };
  return { stop };
}

/** A BIRD. One oscillator swept over ~120 ms, twice. Three nodes, alive for a fifth of a second.
 *  Deliberately thin and deliberately rare: this is a suggestion of a garden, not a dawn chorus. */
export function birdVoice(
  ctx: AudioContext, dest: AudioNode, opts: { pitch: number; level: number },
): { stop: () => void } {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  const g = ctx.createGain();
  const chirp = (at: number, from: number, to: number, len: number, level: number): void => {
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + len);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + len * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  };
  chirp(now, opts.pitch, opts.pitch * 1.5, 0.09, opts.level);
  chirp(now + 0.13, opts.pitch * 1.2, opts.pitch * 0.85, 0.07, opts.level * 0.7);
  osc.connect(g).connect(dest);
  osc.start(now);
  osc.stop(now + 0.24);
  const stop = (): void => {
    try { osc.stop(); } catch { /* already stopped */ }
    osc.disconnect();
    g.disconnect();
  };
  osc.onended = () => { osc.disconnect(); g.disconnect(); };
  return { stop };
}
