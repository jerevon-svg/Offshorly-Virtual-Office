#!/usr/bin/env python3
"""FILM RIG ONLY — Offshorly Virtual Office TEASER 2 (sequel to the approved 1:04 teaser): the LOW-COST PROOF edit.

Covers (1) the opening's ALIVE / EXPERIENCE camera sync, (2) one montage transition, (3) the AI Lab finale's
orchestration language. Picture: out/cinematic/takes_t2 (today's cast; every take logs the body each person wore).
Narration: the APPROVED teaser-1 narrator take for the opening's approved words; a watermarked LOCAL scratch voice
(macOS `say`) for the new lines. Music + effects: the owned teaser-1 library, as temp. No new credits.

  FILM_FFMPEG=… python3 teaser2_proof.py <takes_t2> <scratch_vo_dir> <work_dir> <out_dir>
"""
import array, json, math, os, subprocess, sys, wave

FF = os.environ["FILM_FFMPEG"]
TAKES, SVO, WORK, OUT = (os.path.abspath(p) for p in sys.argv[1:5])
os.makedirs(WORK, exist_ok=True); os.makedirs(OUT, exist_ok=True)
FILM = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
AUD = os.path.join(FILM, "out/teaser/audio")
LOGO = os.path.join(FILM, "out/final/offshorly-logo-reversed.png")
FPS = 30
run = lambda *a: subprocess.run([FF, "-nostdin", "-y", "-hide_banner", "-loglevel", "error", *a], check=True)

# ---- framing: an eased sub-pixel window (zoom z around cx, cy) pulled to the full frame (as the approved master) ----
def ease(a, b, T="(on/30)"):
    s = f"clip(({T}-{a})/({b}-{a}+0.0001),0,1)"
    return f"({s}*{s}*(3-2*{s}))"
def persp(z0, z1, c0, c1, d):
    e = ease(0, d)
    z = f"({z0}+({z1}-{z0})*{e})"; cx = f"({c0[0]}+({c1[0]}-{c0[0]})*{e})"; cy = f"({c0[1]}+({c1[1]}-{c0[1]})*{e})"
    w, h = f"(1920/{z})", f"(1080/{z})"
    x, y = f"clip({cx}-{w}/2,0,1920-{w})", f"clip({cy}-{h}/2,0,1080-{h})"
    c = dict(x0=x, y0=y, x1=f"{x}+{w}", y1=y, x2=x, y2=f"{y}+{h}", x3=f"{x}+{w}", y3=f"{y}+{h}")
    return "perspective=" + ":".join(f"{k}='{v}'" for k, v in c.items()) + ":interpolation=cubic:eval=frame"

WORLD = "eq=contrast=1.05:saturation=1.06,colorbalance=rh=0.018:bh=-0.012,vignette=a=PI/6.5"
UI = "eq=contrast=1.02"
LAB = (1.28, 1.34, (790, 520), (790, 520))            # the Lab beats: drop the Toucan Assistant panel + dock, keep the status card + task chat

# (key, take, in, out, grade, frame=(z0, z1, c0, c1) | None, transition into it: None | ("fade", s))
P1 = [
    ("P1a", "T2Opening", 3.60, 9.60, WORLD, None, None),                   # walk in → the lane turns red
    ("P1b", "T2Opening", 14.40, 17.95, WORLD, None, ("fade", 0.3)),         # the kiosk card → Check In
    ("P1c", "T2Opening", 22.60, 26.80, WORLD, None, ("fade", 0.3)),         # back through the green lane
    ("P1d", "T2Opening", 31.60, 33.80, WORLD, None, ("fade", 0.4)),         # the office opens around him
    ("P1e", "T2Alive", 1.317, 14.83, WORLD, None, None),                    # same frame → the real C press on "alive" → the drop + fly-through
    ("P1f", "T2Experience", 1.00, 7.40, WORLD, None, ("fade", 0.5)),        # push in → the real C press on "experience" → run, jump
    ("P1g", "T2Hub", 1.45, 3.05, UI, (1.0, 1.55, (960, 600), (960, 545)), None),   # cut on the landing: the dock's Hub opens
    ("P1h", "T2Hub", 5.10, 6.20, UI, (1.6, 1.66, (960, 545), (960, 545)), None),   # Kudos to Alex
    ("P1i", "T2Hub", 9.62, 10.75, UI, (1.6, 1.66, (960, 545), (960, 545)), None),  # Friday Town Hall
    ("P1j", "T2Hub", 11.15, 12.30, UI, (1.6, 1.66, (960, 545), (960, 545)), None), # Happy Birthday, Micah
    ("P1k", "T2Hub", 17.95, 21.60, UI, (1.5, 1.62, (960, 545), (960, 545)), None), # the city search → the forecast
]
P2 = [
    ("Q0", "T2AiLab", 8.40, 14.917, WORLD, (1.0, 1.42, (960, 540), (1330, 520)), None),  # Toucan arrives; "Preview a sample task"
    ("Q1", "T2AiLab", 14.917, 19.00, WORLD, (1.25, 1.25, (790, 520), (790, 520)), None), # the product's own cut: Watch in Lab, the flight
    ("Q2", "T2AiLab", 25.50, 28.50, WORLD, LAB, ("fade", 0.4)),              # Toucan at the Lab, the brief
    ("Q3", "T2AiLab", 60.60, 62.60, WORLD, LAB, None),                       # Nova working
    ("Q4", "T2AiLab", 66.00, 68.00, WORLD, LAB, None),                       # Nova → Milo
    ("Q5", "T2AiLab", 95.50, 97.50, WORLD, LAB, None),                       # Milo working
    ("Q6", "T2AiLab", 124.50, 126.60, WORLD, LAB, None),                     # Pip reviewing
    ("Q7", "T2AiLab", 126.60, 128.60, "pip", None, None),                    # the agents' own conversation, magnified (real panel)
    ("Q8", "T2AiLab", 148.50, 150.50, WORLD, (1.25, 1.25, (790, 520), (790, 520)), None),  # Toucan brings it back
    ("Q9", "T2AiLab", 158.75, 161.30, WORLD, (1.0, 1.08, (900, 540), (880, 520)), ("fade", 0.3)),  # "Here's your landing page." + View Result
    ("Q10", "T2AiLab", 168.20, 172.00, UI, (1.0, 1.38, (960, 540), (880, 540)), None),     # the result: Approve / Request Changes → Approve
    ("Q11", "T2AiLab", 172.00, 176.10, WORLD, (1.0, 1.12, (920, 560), (900, 540)), None),  # back in the office
]
SLATE, CARD = 1.6, 5.95

# ---- 1 · segments → high-quality intermediates (one small ffmpeg at a time: this machine has 8 GB) ----
def seg_file(k): return os.path.join(WORK, f"{k}.mp4")
def render(seg):
    k, take, a, b, grade, frame, _ = seg
    d = b - a; n = int(round(d * FPS)); src = os.path.join(TAKES, f"{take}.mp4")
    if os.environ.get("REUSE") and os.path.exists(seg_file(k)): return
    base = f"fps={FPS},setpts=PTS-STARTPTS,format=yuv420p"
    if grade == "pip":
        fc = (f"[0:v]{base},split[a][b];[a]{persp(*LAB, d)},boxblur=14:2,eq=brightness=-0.24:saturation=0.75[bg];"
              f"[b]crop=324:440:1250:536,scale=598:812:flags=lanczos,format=rgba,split[f][s];"
              f"[s]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.55,boxblur=18:2[sh];[bg][sh]overlay=(W-w)/2+16:(H-h)/2+22[t];"
              f"[t][f]overlay=(W-w)/2:(H-h)/2,trim=end_frame={n},format=yuv420p[v]")
    else:
        chain = [base] + ([persp(*frame, d)] if frame else []) + [grade, f"trim=end_frame={n}", "format=yuv420p"]
        fc = f"[0:v]{','.join(chain)}[v]"
    run("-threads", "4", "-ss", f"{a:.3f}", "-t", f"{d + 0.4:.3f}", "-i", src, "-filter_complex", fc, "-map", "[v]",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "15", "-r", str(FPS), seg_file(k))

# ---- 2 · the timeline (frame-exact durations; a dissolve overlaps its predecessor) ----
def lay(segs, t0):
    t = t0
    for s in segs:
        d = round((s[3] - s[2]) * FPS) / FPS; ov = s[6][1] if s[6] else 0.0
        st = t - ov; yield s, st, d; t = st + d
L1 = list(lay(P1, 0.0)); P1_END = L1[-1][1] + L1[-1][2]
P2_START = P1_END + SLATE
L2 = list(lay(P2, P2_START)); P2_PIC_END = L2[-1][1] + L2[-1][2]
END = P2_PIC_END + CARD
S = {s[0]: (st, d, s) for s, st, d in L1 + L2}
at = lambda k, take_t: S[k][0] + (take_t - S[k][2][2])     # a moment of a take → film time

ALIVE = at("P1e", 2.367)          # the measured first frame of the real Office → 3D switch (the drop starts on it)
EXP = at("P1f", 4.200)            # the measured first frame of the real 3D → Player switch
APPROVE = at("Q10", 171.167)      # the measured "Approved" state change
DELIVERED = at("Q9", 159.03)
SB2 = 220.0 - (END - P2_START)    # Part 2's storyboard offset: its last frame is 03:40.0

# ---- 3 · narration: the approved take (word-safe cuts) + the scratch lines ----
TK = os.path.join(AUD, "vo-final.mp3")
w16 = os.path.join(WORK, "vo16k.wav"); run("-i", TK, "-ac", "1", "-ar", "16000", w16)
wv = wave.open(w16); pcm = array.array("h", wv.readframes(wv.getnframes())); wv.close()
def quietest(lo, hi):            # the 10 ms frame of least energy between lo and hi (s)
    best, bt = 1e18, lo
    for i in range(int(lo * 100), int(hi * 100)):
        e = sum(v * v for v in pcm[i * 160:(i + 1) * 160])
        if e < best: best, bt = e, i / 100
    return bt
SPLIT = quietest(4.15, 4.95)     # "But somewhere along the way, | we lost some of the little things …"
TAKE = {  # id: (src_in, src_out, onset-in-source, caption)
    "L1": (0.00, 2.02, 0.03, "Remote work gave us freedom."),
    "L2a": (2.42, SPLIT, 2.48, "But somewhere along the way,"),
    "L2b": (SPLIT, 7.50, SPLIT + 0.02, "we lost some of the little things that made an office feel…"),
    "L3": (8.00, 8.70, 8.06, "alive."),
    "L4": (9.77, 12.40, 9.83, "But a workplace isn’t something you just look at."),
    "L5": (12.72, 13.73, 12.78, "It’s something…"),
    "L6": (14.08, 15.20, 14.14, "you experience."),
}
L2B_LEN = 7.50 - SPLIT
ONSET = {"L1": 1.8, "L2a": 4.75, "L2b": ALIVE - 1.15 - L2B_LEN, "L3": ALIVE, "L4": ALIVE + 3.4, "L5": EXP - 2.35, "L6": EXP}
def dur(p):
    r = subprocess.run([FF, "-hide_banner", "-i", p], capture_output=True, text=True).stderr
    h, m, s = r.split("Duration: ")[1].split(",")[0].split(":"); return int(h) * 3600 + int(m) * 60 + float(s)
SCR = {"S1": (P2_START + 1.0, "Imagine a workplace where an idea doesn’t just begin…"),
       "S2": (S["Q1"][0] + 0.22, "…it begins to move."),
       "S3": (S["Q11"][0] + 0.35, "Because the future of work isn’t just about where we are…"),
       "S4": (S["Q11"][0] + 4.5, "…it’s about what we can create.")}
CREATE = SCR["S4"][0] + 1.2      # "create" inside S4 (scratch timing)

# ---- 4 · music (the owned teaser cue, re-cut) + effects ----
M = os.path.join(AUD, "music.mp3")
MUSIC = [  # (m_in, m_out, t, gain, fade_in, fade_out)
    (12.0 - (ALIVE - 4.0), 12.0, 4.0, 0.42, 2.5, 0.0),                      # the build lands its hit ON "alive"
    (12.0, 12.0 + (EXP - 1.85 - ALIVE), ALIVE, 0.45, 0.0, 1.6),             # the drive through the 3D world, let go under "It's something…"
    (41.45, 45.8, EXP - 3.55, 0.62, 0.0, 0.6),                              # the dropout swells back: its hit ON "experience"
    (26.0, 26.0 + (P1_END - (EXP + 0.4)), EXP + 0.4, 0.50, 0.4, 0.8),        # the montage drive; its peak under the forecast
    (12.0 - (S["Q1"][0] - P2_START), 12.0, P2_START, 0.40, 1.0, 0.0),        # Part 2: the build lands on the Lab cut
    (12.0, 36.0 + 1.5, S["Q1"][0], 0.47, 0.0, 1.2),                          # the drive through the Lab (re-timed below so 36.0 = Approve)
    (41.45, 49.0, CREATE - 3.55, 0.62, 0.0, 1.5),                            # the final swell: its hit ON "create", then the card
]
# land the Lab drive's peak (music 36.0) exactly on the Approve: start it that much earlier in the cue
lab_in = 36.0 - (APPROVE - S["Q1"][0]); MUSIC[5] = (lab_in, 37.5, S["Q1"][0], 0.47, 0.25, 1.2)
SFX = [  # (file, t, gain, len, fade_in, fade_out, extra)
    ("office.mp3", 0.0, 0.10, ALIVE + 0.6, 0.8, 0.7), ("deny.mp3", at("P1a", 7.75), 0.5),
    ("click1.mp3", at("P1b", 17.42), 0.42), ("confirm.mp3", at("P1b", 17.72), 0.45), ("click2.mp3", at("P1c", 23.6), 0.35),
    ("riser.mp3", ALIVE - 2.0, 0.40), ("impact.mp3", ALIVE, 0.42),
    ("office.mp3", ALIVE - 0.4, 0.08, EXP - 1.9 - (ALIVE - 0.4), 0.4, 0.8),
    ("office.mp3", EXP - 1.9, 0.10, 1.95, 0.8, 0.12, "lowpass=f=450"), ("office.mp3", EXP - 0.05, 0.16, 3.6, 0.12, 0.8),
    ("run.mp3", at("P1f", 4.48), 0.16, 0.6, 0.1, 0.1), ("run.mp3", at("P1f", 5.03), 0.30, 1.9, 0.0, 0.5), ("jump.mp3", at("P1f", 6.18), 0.5),
    *[(("hit1.mp3" if i % 2 == 0 else "hit2.mp3"), S[k][0], 0.26) for i, k in enumerate(["P1g", "P1h", "P1i", "P1j", "P1k"])],
    ("click1.mp3", at("P1g", 1.70), 0.2), ("click2.mp3", at("P1k", 18.95), 0.2),
    ("office.mp3", P2_START, 0.10, S["Q1"][0] - P2_START + 0.3, 0.6, 0.4), ("click1.mp3", at("Q0", 12.77), 0.42),
    ("notif.mp3", DELIVERED, 0.30), ("office.mp3", S["Q9"][0], 0.10, P2_PIC_END - S["Q9"][0], 0.4, 0.6),
    ("confirm.mp3", APPROVE, 0.42),
]

def ts(x): x = max(0.0, x); return f"{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}"
def mmss(x): return f"{int(x // 60):02d}:{x % 60:04.1f}"

if __name__ == "__main__":
    for s in P1 + P2: render(s); print("seg", s[0], flush=True)

    # ---- captions + labels (one ASS) ----
    ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 2", "", "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Sub,Helvetica Neue Medium,47,&H00F6F6F6,&H00FFFFFF,&H78000000,&H88000000,0,0,0,0,100,100,1.2,0,1,1.6,1.8,2,170,170,150,1",
        "Style: Tag,Helvetica Neue,21,&H40FFFFFF,&H00FFFFFF,&H90000000,&H90000000,0,0,0,0,100,100,1,0,1,1.2,0,7,36,36,30,1",
        "Style: Scratch,Helvetica Neue Medium,22,&H2066E0FF,&H00FFFFFF,&H90000000,&H90000000,0,0,0,0,100,100,2,0,1,1.4,0,9,36,36,30,1",
        "Style: Lab,Helvetica Neue Medium,25,&H18FFFFFF,&H00FFFFFF,&H70000000,&H80000000,0,0,0,0,100,100,5,0,1,1.4,1.2,1,64,64,58,1",
        "Style: Slate,Helvetica Neue,34,&H30FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,7,0,1,0,0,5,0,0,0,1",
        "Style: CardSub,Helvetica Neue Medium,28,&H00BEBEBE,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,16,0,1,0,0,5,0,0,0,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    vo_parts = []
    for k, (a, b, o, cap) in TAKE.items():
        place = ONSET[k] - (o - a); vo_parts.append((TK, a, b, place))
        ass.append(f"Dialogue: 0,{ts(ONSET[k] - 0.02)},{ts(place + b - a + 0.15)},Sub,,0,0,0,,{{\\fad(200,240)\\blur2}}{cap}")
    for k, (t, cap) in SCR.items():
        p = os.path.join(SVO, f"{k}.wav"); d = dur(p); vo_parts.append((p, 0.0, d, t))
        ass.append(f"Dialogue: 0,{ts(t - 0.02)},{ts(t + d + 0.2)},Sub,,0,0,0,,{{\\fad(200,260)\\blur2}}{cap}")
        ass.append(f"Dialogue: 2,{ts(t - 0.1)},{ts(t + d + 0.3)},Scratch,,0,0,0,,{{\\fad(150,150)}}SCRATCH VO · local voice · timing only")
    ass.append(f"Dialogue: 1,{ts(0.6)},{ts(P1_END - 0.3)},Tag,,0,0,0,,{{\\fad(400,300)}}TEASER 2 · PROOF · storyboard 00:00–{mmss(P1_END)} · VO: approved teaser-1 take · temp music: teaser-1 score")
    ass.append(f"Dialogue: 1,{ts(P2_START + 0.3)},{ts(P2_PIC_END - 0.2)},Tag,,0,0,0,,{{\\fad(400,300)}}TEASER 2 · PROOF · storyboard {mmss(SB2)}–03:40.0 · temp music: teaser-1 score")
    ass.append(f"Dialogue: 1,{ts(P1_END + 0.15)},{ts(P2_START - 0.1)},Slate,,0,0,0,,{{\\fad(250,250)}}AI LAB FINALE   ·   {mmss(SB2)} → 03:40")
    ass.append(f"Dialogue: 1,{ts(S['Q1'][0] + 0.4)},{ts(S['Q10'][0] + 3.6)},Lab,,0,0,0,,{{\\fad(500,400)}}AI LAB  ·  SCRIPTED PREVIEW")
    card_in = CREATE - 0.35; card_out = END - 0.75
    ass.append(f"Dialogue: 1,{ts(card_in + 0.35)},{ts(card_out)},CardSub,,0,0,0,,{{\\fad(900,700)\\pos(960,640)}}VIRTUAL OFFICE")
    subs = os.path.join(WORK, "proof-subs.ass"); open(subs, "w").write("\n".join(ass) + "\n")

    # ---- audio mix ----
    ins, fl = [], []
    def add(p): ins.extend(["-i", p]); return len(ins) // 2 - 1
    fmt = "aformat=sample_rates=48000:channel_layouts=stereo"; pad = f"apad=whole_dur={END:.3f},atrim=0:{END:.3f}"
    ms = lambda x: max(0, int(round(x * 1000)))
    vl, ml, xl = [], [], []
    for i, (p, a, b, t) in enumerate(vo_parts):
        n = add(p); fl.append(f"[{n}:a]{fmt},atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st={b - a - 0.06:.3f}:d=0.06,adelay={ms(t)}|{ms(t)},{pad}[vo{i}]"); vl.append(f"[vo{i}]")
    fl.append(f"{''.join(vl)}amix=inputs={len(vl)}:normalize=0,highpass=f=70,acompressor=threshold=0.12:ratio=2.5:attack=8:release=160:makeup=1.3,asplit=2[vomix][vokey]")
    for i, (a, b, t, g, fi, fo) in enumerate(MUSIC):
        n = add(M); d = b - a
        fades = (f",afade=t=in:d={fi}" if fi else "") + (f",afade=t=out:st={d - fo:.3f}:d={fo}" if fo else "")
        fl.append(f"[{n}:a]{fmt},atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS{fades},volume={g},adelay={ms(t)}|{ms(t)},{pad}[m{i}]"); ml.append(f"[m{i}]")
    fl.append(f"{''.join(ml)}amix=inputs={len(ml)}:normalize=0[mus]")
    fl.append("[mus][vokey]sidechaincompress=threshold=0.03:ratio=4:attack=40:release=550:knee=4[musduck]")
    for i, s in enumerate(SFX):
        f, t, g = s[:3]; n = add(os.path.join(AUD, f)); ex = ""
        if len(s) > 3:
            ln, fi, fo = s[3], s[4], s[5]; ex += f",atrim=0:{ln:.3f}"
            if fi: ex += f",afade=t=in:d={fi}"
            if fo: ex += f",afade=t=out:st={max(0, ln - fo):.3f}:d={fo}"
            if len(s) > 6: ex += "," + s[6]
        fl.append(f"[{n}:a]{fmt}{ex},volume={g},adelay={ms(t)}|{ms(t)},{pad}[x{i}]"); xl.append(f"[x{i}]")
    fl.append(f"{''.join(xl)}amix=inputs={len(xl)}:normalize=0[fx]")
    fl.append(f"[vomix][musduck][fx]amix=inputs=3:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=14,volume=2.6dB,alimiter=limit=0.84:level=disabled,aresample=48000,atrim=0:{END:.3f}[a]")
    mix = os.path.join(WORK, "proof-mix.wav")
    run(*ins, "-filter_complex", ";".join(fl), "-map", "[a]", "-c:a", "pcm_s16le", mix); print("mix", flush=True)

    # ---- picture: join (cuts / dissolves), slate + card as black, then captions, running storyboard TC, logo ----
    vins, ch = [], []
    order = [s for s, _, _ in L1] + [None] + [s for s, _, _ in L2]
    for s in order:
        if s: vins += ["-threads", "2", "-i", seg_file(s[0])]
    j = 0; parts = []
    for s in order:
        if s is None: parts.append(("slate", None)); continue
        n = int(round((s[3] - s[2]) * FPS))
        ch.append(f"[{j}:v]settb=1/{FPS},setpts=N,trim=end_frame={n},tpad=stop_mode=clone:stop=3,trim=end_frame={n},setpts=N,format=yuv420p[v{j}]")
        parts.append((s, f"[v{j}]")); j += 1
    def chain(items, tag):
        last, runlen = items[0][1], (items[0][0][3] - items[0][0][2])
        if items[0][0][0] == "P1a": ch.append(f"{last}fade=t=in:st=0:d=0.8[fa]"); last = "[fa]"
        if items[0][0][0] == "Q0": ch.append(f"{last}fade=t=in:st=0:d=0.4[fq]"); last = "[fq]"
        for i, (s, lab) in enumerate(items[1:], 1):
            d = round((s[3] - s[2]) * FPS) / FPS
            if s[6]: ch.append(f"{last}{lab}xfade=transition=fade:duration={s[6][1]}:offset={runlen - s[6][1]:.4f},settb=1/{FPS},setpts=N[{tag}{i}]"); runlen += d - s[6][1]
            else: ch.append(f"{last}{lab}concat=n=2:v=1:a=0,settb=1/{FPS},setpts=N[{tag}{i}]"); runlen += d
            last = f"[{tag}{i}]"
        return last, runlen
    i1 = parts.index(("slate", None))
    a_last, a_len = chain(parts[:i1], "a"); b_last, b_len = chain(parts[i1 + 1:], "b")
    ch.append(f"{a_last}fade=t=out:st={a_len - 0.5:.3f}:d=0.5[A]")
    ch.append(f"{b_last}fade=t=out:st={b_len - 0.6:.3f}:d=0.6[B]")
    ch.append(f"color=c=black:s=1920x1080:r={FPS}:d={SLATE},format=yuv420p[SL]")
    ch.append(f"color=c=black:s=1920x1080:r={FPS}:d={CARD},format=yuv420p[CD]")
    ch.append("[A][SL][B][CD]concat=n=4:v=1:a=0,settb=1/30,setpts=N[pic]")
    lg = j                                   # the logo is the input after the j segment files; the mix follows it
    vins += ["-loop", "1", "-t", f"{END:.3f}", "-i", LOGO]
    tc = "fontfile=/System/Library/Fonts/HelveticaNeue.ttc:fontsize=21:fontcolor=white@0.55:x=36:y=58"
    ch.append(f"[{lg}:v]scale=700:-1:flags=lanczos,format=rgba,fade=t=in:st={card_in:.3f}:d=0.9:alpha=1,fade=t=out:st={card_out - 0.7:.3f}:d=0.7:alpha=1[logo]")
    ch.append(f"[pic]subtitles='{subs}':fontsdir=/System/Library/Fonts,"
              f"drawtext={tc}:text='SB %{{pts\\:hms}}':enable='between(t,0.6,{P1_END - 0.3:.3f})',"
              f"drawtext={tc}:text='SB %{{pts\\:hms\\:{SB2 - P2_START:.3f}}}':enable='between(t,{P2_START + 0.3:.3f},{P2_PIC_END - 0.2:.3f})'[base]")
    ch.append("[base][logo]overlay=(W-w)/2:422:eof_action=pass,format=yuv420p[vout]")
    out = os.path.join(OUT, "offshorly-vo-teaser2_proof.mp4")
    run(*vins, "-i", mix, "-filter_complex", ";".join(ch), "-map", "[vout]", "-map", f"{lg + 1}:a", "-t", f"{END:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-r", str(FPS), "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", out)
    marks = dict(ALIVE=ALIVE, EXP=EXP, P1_END=P1_END, P2_START=P2_START, APPROVE=APPROVE, DELIVERED=DELIVERED, CREATE=CREATE, END=END,
                 SB2=SB2, SPLIT=SPLIT, onsets={**ONSET, **{k: v[0] for k, v in SCR.items()}},
                 segments={k: dict(start=round(v[0], 3), dur=round(v[1], 3), take=v[2][1], src=[v[2][2], v[2][3]]) for k, v in S.items()})
    json.dump(marks, open(os.path.join(OUT, "offshorly-vo-teaser2_proof.timeline.json"), "w"), indent=1)
    print(json.dumps({k: round(v, 3) for k, v in marks.items() if isinstance(v, float)}))
    print(out)
