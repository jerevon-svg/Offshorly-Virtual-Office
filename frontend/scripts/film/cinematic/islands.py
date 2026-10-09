#!/usr/bin/env python3
"""FILM RIG ONLY — split the narration into speech ISLANDS at real silences, then transcribe each island
locally (whisper.cpp) so every excerpt boundary is a true pause, never a guess inside a word.
  python3 islands.py <src16k.wav> <t0> <t1> <out.json> <ffmpeg> <whisper-cli> <model> [min_gap_s=0.12]
"""
import json, sys, wave, array, math, subprocess, os
src, t0, t1, out_p, FF, WCLI, MODEL = sys.argv[1:8]; t0, t1 = float(t0), float(t1)
GAP = float(sys.argv[8]) if len(sys.argv) > 8 else 0.12
w = wave.open(src); sr = w.getframerate(); w.setpos(int(t0 * sr))
pcm = array.array("h", w.readframes(int((t1 - t0) * sr))); w.close()
HOP = sr // 100
env = [10 * math.log10(sum(v * v for v in pcm[i:i + HOP]) / HOP + 1e-9) - 90.3 for i in range(0, len(pcm) - HOP, HOP)]
noise = sorted(env)[len(env) // 10]; THR = noise + 11
isl, cur, quiet = [], None, 0
for i, e in enumerate(env):
    if e >= THR:
        if cur is None: cur = [i, i]
        cur[1] = i; quiet = 0
    elif cur is not None:
        quiet += 1
        if quiet * 0.01 >= GAP:
            if (cur[1] - cur[0]) >= 12: isl.append(cur)
            cur, quiet = None, 0
if cur and cur[1] - cur[0] >= 12: isl.append(cur)
# pad each island a little into its own silence (never past the midpoint to the next island)
spans = []
for k, (a, b) in enumerate(isl):
    pa = isl[k - 1][1] if k else a - 40; nb = isl[k + 1][0] if k + 1 < len(isl) else b + 40
    s = max(a - 6, (pa + a) // 2); e = min(b + 9, (b + nb) // 2)
    spans.append((t0 + s / 100, t0 + e / 100))
# transcribe: every island alone, separated by 1.6 s of silence, segment-level output
tmp = out_p + ".tmp"; filt = []; pos = []; t = 0.0
for k, (a, b) in enumerate(spans):
    filt.append(f"[0:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS,apad=pad_dur=1.6[a{k}]"); pos.append((t, t + b - a)); t += b - a + 1.6
filt.append("".join(f"[a{k}]" for k in range(len(spans))) + f"concat=n={len(spans)}:v=0:a=1[o]")
subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-filter_complex", ";".join(filt), "-map", "[o]", tmp + ".wav"], check=True)
subprocess.run([WCLI, "-m", MODEL, "-f", tmp + ".wav", "-oj", "-of", tmp, "-t", "8", "-l", "en", "-ml", "1", "-sow", "-mc", "0"], check=True, capture_output=True)
words = [((x["offsets"]["from"] + x["offsets"]["to"]) / 2000, x["text"].strip()) for x in json.load(open(tmp + ".json"))["transcription"] if x["text"].strip()]
res = []
for k, ((a, b), (pa, pb)) in enumerate(zip(spans, pos)):
    txt = " ".join(wd for tt, wd in words if pa - 0.3 <= tt <= pb + 0.3)
    res.append({"k": k, "in": round(a, 3), "out": round(b, 3), "text": txt}); print(f"{k:3} {a:8.2f} {b:8.2f}  {txt}")
json.dump(res, open(out_p, "w"), indent=1)
for f in (tmp + ".wav", tmp + ".json"): os.remove(f)
