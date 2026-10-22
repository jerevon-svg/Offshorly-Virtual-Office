#!/usr/bin/env python3
"""FILM RIG ONLY — cut narration excerpts from Bon's original walkthrough recording.

Word markers come from a LOCAL whisper.cpp run with DTW token alignment (dtw_words.json: [[t, word], …]).
Every cut is placed in the longest truly silent run (10 ms RMS envelope) BETWEEN two consecutive word
markers, so an excerpt can never start or end inside a word. Nothing leaves this machine.

  python3 vo.py <src16k.wav> <dtw_words.json> <plan.json> <out.json>
plan.json: [{"id": "V1", "first": ["working", 19.7], "last": ["common", 21.0], "text": "…"}, …]
"""
import json, sys, wave, array, math, re

wav, words_p, plan_p, out_p = sys.argv[1:5]
w = wave.open(wav); sr = w.getframerate(); pcm = array.array("h", w.readframes(w.getnframes())); w.close()
HOP = sr // 100
env = [10 * math.log10(sum(v * v for v in pcm[i:i + HOP]) / HOP + 1e-9) - 90.3 for i in range(0, len(pcm) - HOP, HOP)]
noise = sorted(env)[len(env) // 10]; THR = noise + 11
W = [(t, re.sub(r"[^a-z0-9']", "", x.lower())) for t, x in json.load(open(words_p))]
fi = lambda t: max(0, min(len(env) - 1, int(round(t * 100))))

def find(word, near):
    word = re.sub(r"[^a-z0-9']", "", word.lower())
    c = [i for i, (t, x) in enumerate(W) if x == word and abs(t - near) < 2.5]
    if not c: raise SystemExit(f"no '{word}' near {near}")
    return min(c, key=lambda i: abs(W[i][0] - near))

def boundary(t_a, t_b, prefer):
    """the cut between two word markers: centre of the longest quiet run, nudged toward `prefer`"""
    lo, hi = fi(t_a), fi(t_b)
    if hi <= lo: return t_a
    runs, cur = [], None
    for i in range(lo, hi + 1):
        if env[i] < THR:
            cur = [i, i] if cur is None else [cur[0], i]
        elif cur is not None: runs.append(cur); cur = None
    if cur is not None: runs.append(cur)
    if not runs: return min(range(lo, hi + 1), key=lambda i: env[i]) / 100
    a, b = max(runs, key=lambda r: (r[1] - r[0], -abs((r[0] + r[1]) / 2 - (lo if prefer == "early" else hi))))
    # keep a little air on the word's side: 60 ms after a word ends, 40 ms before one starts
    return (min(b, a + 6) if prefer == "early" else max(a, b - 4)) / 100

out = []
for p in json.load(open(plan_p)):
    i, j = find(*p["first"]), find(*p["last"])
    prev_t = W[i - 1][0] if i > 0 else W[i][0] - 1.0
    next_t = W[j + 1][0] if j + 1 < len(W) else W[j][0] + 1.0
    a = boundary(prev_t, W[i][0], "late")
    b = boundary(W[j][0], next_t, "early")
    out.append({**p, "in": round(a, 3), "out": round(b, 3), "dur": round(b - a, 3), "words": " ".join(x for _, x in W[i:j + 1])})
    print(f'{p["id"]:5} {a:8.3f} {b:8.3f} {b-a:5.2f}s  [{" ".join(x for _, x in W[i:j + 1])}]')
json.dump({"noise_db": round(noise, 1), "thr_db": round(THR, 1), "cuts": out}, open(out_p, "w"), indent=1)
