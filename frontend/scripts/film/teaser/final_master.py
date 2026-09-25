#!/usr/bin/env python3
# FILM RIG ONLY — FINAL-v2 MASTER (FINAL + the spatial video call on "Conversations."): the LOCKED Pass 2 picture (pass2c.py, unchanged shots/timing) with the finishing
# pass — sound rebuilt against the current picture, the ending re-shaped, polished captions, the reversed-logo card.
# From pass2c.py — PASS 2 (final sprint, picture-lock candidate): batch 2 + the human section, Cave and elevator
# rebuilt from High takes, every anchor (H cuts, CAVE, E2/VIRT, SLOW/DING, BLACK) held where it was.
# From pass2b.py — PASS 2 (batch 2): batch 1 + the feature montage rebuilt from four High Player-view takes (Search,
# Tasks = Quests→Missions in one shot, Toucan fly-in, Boards drag), cut on the old percussion grid (same 237 frames).
# From pass2.py — PASS 2 (batch 1): pass1b.py (locked) + the High 3D tour (TourV2, three rooms, hard cuts that carry
# one orbit direction) and one continuous High Player take (PlayerV2) for EXPERIENCE → RUN. EXP stays at 16.600.
# From pass1b.py — PASS 1b (pacing/continuity): pass1.py + a recaptured High ALIVE (AliveV2) continuing from the
# opening's end state, 0.75 s more breath before "But a workplace…" (the ALIVE shot carries it, so EXPERIENCE
# stays on its Player View cut).
# From pass1.py — PASS 1: the approved final-polish cut with ONLY the opening replaced (ReceptionV2, captured at the
# locked High standard), rendered at 30 fps through lossless intermediates and a single final encode.
# Derived from final_polish.py — final cinematic polish over the polish-v2 structure: one continuous narrator take
# (vo-final.mp3) placed phrase-by-phrase on picture anchors, the opening rebuilt from the real-timestamp
# capture frames (motion-interpolated to true 60 fps) with sub-pixel eased framing instead of integer zoompan,
# per-junction transitions, and a gap-free mix (every audio input padded to the full timeline).
import os, re, subprocess
# Tracked source lives in scripts/film/teaser/; every input and output stays in the ignored scripts/film/out/:
#   footage  out/pass1/clips, out/pass2/clips (High takes), out/clips (old MP4 refs)   audio  out/teaser/audio
#   logo     out/final/offshorly-logo-reversed.png (teaser/logo.mjs)                   master out/teaser/
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out", "teaser")
FF = os.environ.get("FILM_FFMPEG", "")
if not (FF and os.path.isfile(FF) and os.access(FF, os.X_OK)):
    raise SystemExit("FILM_FFMPEG must point at an ffmpeg binary with libx264, libass and drawtext, e.g.\n"
                     "  (cd <any scratch dir> && npm i ffmpeg-static) && export FILM_FFMPEG=<scratch>/node_modules/ffmpeg-static/ffmpeg")
CLIPS = os.path.join(HERE, "..", "clips"); A = os.path.join(HERE, "audio"); SEG = os.path.join(HERE, "segs-final-master"); PASS1 = os.path.join(HERE, "..", "pass1", "clips"); PASS2 = os.path.join(HERE, "..", "pass2", "clips")
FPS = 30

def ease(a, b, T=None):
    T = T or f"(on/{FPS})"  # smoothstep 0→1 between a and b seconds
    s = f"clip(({T}-{a})/({b}-{a}+0.0001),0,1)"
    return f"({s}*{s}*(3-2*{s}))"
def lerp(v0, v1, e): return f"({v0}+({v1}-{v0})*{e})"
def persp(z, cx, cy):  # sub-pixel crop-and-scale of the (z, cx, cy) window to the full frame
    w, h = f"(1920/{z})", f"(1080/{z})"
    x, y = f"clip({cx}-{w}/2,0,1920-{w})", f"clip({cy}-{h}/2,0,1080-{h})"
    c = dict(x0=x, y0=y, x1=f"{x}+{w}", y1=y, x2=x, y2=f"{y}+{h}", x3=f"{x}+{w}", y3=f"{y}+{h}")
    return "perspective=" + ":".join(f"{k}='{v}'" for k, v in c.items()) + ":interpolation=cubic:eval=frame"

# transitions: None = hard cut, ("fade", d) dissolve, ("fadeblack", d) dip through black
# opts: speed, interp, frames (rebuild from real-timestamp capture + motion interpolation), frame=(z, cx, cy) exprs
SHOTS = [
  # OPENING — refusal, kiosk, Check In, back through the green gates
  # OPENING (Pass 1) — one continuous High take, cut on its beats; in-app camera framing, no crop, no interpolation
  dict(k="R1", c="ReceptionV2", a=5.3, b=8.4, raw=True),                     # walk-in → the red refusal (red at 2.3 s)
  dict(k="R2", c="ReceptionV2", a=15.9, b=17.3, raw=True),                   # the kiosk card → Check In (click at +1.38 s)
  dict(k="R3", c="ReceptionV2", a=22.4, b=25.4, raw=True, t=("fade", 0.3)),  # back to the lane, green, through
  dict(k="OV", c="ReceptionV2", a=27.3, b=27.3 + 92 / 30, raw=True, t=("fade", 14 / 30)),  # the office opens up → ALIVE at 9.80
  # ALIVE — hard cut on the word into the 3D transformation, then the rooms
  dict(k="ALIVE", c="AliveV2", a=2.4, b=2.4 + 77 / 30, raw=True),          # same office, same cast → C, the tilt starts on "alive."
  # 3D TOUR (Pass 2) — three rooms, hard cuts; 43+42+42 frames = exactly the old tour's span, so EXP stays at 16.600
  dict(k="T1", c="TourV2", a=2.0, b=2.0 + 43 / 30, raw=True), dict(k="T2", c="TourV2", a=6.4, b=6.4 + 42 / 30, raw=True),
  dict(k="T3", c="TourV2", a=10.5, b=10.5 + 42 / 30, raw=True),
  # EXPERIENCE — hard cut on the word into Player View: walk → run → jump
  dict(k="EXP", c="PlayerV2", a=1.40, b=1.40 + 28 / 30, raw=True), dict(k="RUN", c="PlayerV2", a=1.40 + 28 / 30, b=1.40 + 100 / 30, raw=True),  # one take, back-to-back: sprint at RUN, jump at RUN+1.1
  # FEATURES — hard cuts on the percussion
  dict(k="F0", c="FeatSearch", a=2.0, b=2.0 + 36 / 30, raw=True),    # Search finds Micah — Alex and Jan behind
  dict(k="F1", c="FeatTasks", a=2.62, b=2.62 + 54 / 30, raw=True),    # Quests → the Missions tab on the old 22.03 beat
  dict(k="F2", c="FeatToucan", a=4.9, b=4.9 + 57 / 30, raw=True),     # the toucan flies out of the Hub to Bon
  dict(k="F3", c="FeatBoards", a=5.4, b=5.4 + 90 / 30, raw=True),     # the live board: Bon drags "Celebrate the win" into the row
  # HUMAN — cuts land on the narrator's words (durations derived from the take below)
  dict(k="H0", c="HumGather", a=2.0, b=None, raw=True, t=("fade", 0.4)),  # meetings — four coworkers converge into a circle
  dict(k="H1", c="HumConvo", a=5.9, b=None, raw=True),     # messages — Alex's spatial DM lands
  dict(k="H2", c="HumTasks", a=2.85, b=None, raw=True),    # tasks — a quest claimed, the reward flies to the HUD
  dict(k="H3", c="HumCards", a=4.75, b=None, raw=True),    # birthdays — Micah's card, the wish sent
  dict(k="H4", c="HumCards", a=9.7, b=None, raw=True),     # recognition — Kudos to Alex, given
  dict(k="H5", c="HumVideo", a=2.2, b=None, raw=True),     # conversations — a live spatial video call (FINAL-v2)
  dict(k="H6", c="HumTeam", a=0.95, b=None, raw=True),     # celebrating wins — the group cheers, staggered jumps
  dict(k="H7", c="HumTeam", a=0.95 + 50 / 30, b=0.95 + 134 / 30, raw=True),  # part of a team — Bon steps in among them (same take)
  dict(k="H8", c="HumTeam", a=0.95 + 134 / 30, b=0.95 + 185 / 30, raw=True), # the camera drifts round the group
  # CAVE — a short dip into the hidden world (0.3 s, not 0.8 s of black), then a hard cut to the lift
  dict(k="CAVE", c="CaveV2", a=1.5, b=4.0, raw=True, t=("fadeblack", 0.3)),
  # ELEVATOR — real frames only: walk + board (cut before the product's close-up snap), the wide 01→02 ride,
  # then arrival → doors opening at 0.626× (the take ran at 47.5 fps, so still ~30 real fps) → HARD BLACK
  dict(k="E1", c="ElevatorV2", a=2.45, b=6.95, raw=True), dict(k="E2", c="ElevatorV2", a=8.95, b=11.70, raw=True),
  dict(k="E3", c="ElevatorV2", a=11.72, b=11.72 + 14 / 30, raw=True),   # the lift's own close camera, real speed, straight on into SLOW
  dict(k="SLOW", c="ElevatorV2", a=11.72 + 14 / 30, b=14.9, raw=True, speed=(14.9 - 11.72 - 14 / 30) / 3.8333),
]
# the narrator take: (src_in, src_out, audible onset in the source)
TAKE = [(0.0, 2.02, 0.03), (2.42, 7.50, 2.48), (8.00, 8.70, 8.06), (9.77, 12.40, 9.83), (12.72, 13.73, 12.78), (14.08, 15.20, 14.14),
        (16.04, 19.80, 16.10), (20.26, 21.34, 20.32), (21.68, 22.58, 21.74), (22.96, 24.07, 23.02), (24.49, 25.79, 24.55),
        (26.15, 28.76, 26.21), (29.57, 31.97, 29.63), (32.37, 35.87, 32.43), (36.25, 37.10, 36.31), (37.91, 39.81, 37.97)]
LINES = ["Remote work gave us freedom.", "But somewhere along the way, we lost some of the little things that made an office feel…", "alive.",
  "But a workplace isn’t something you just look at.", "It’s something…", "you experience.", "Because work isn’t only meetings, messages and tasks.",
  "It’s birthdays.", "Recognition.", "Conversations.", "Celebrating wins.", "And feeling like you’re actually part of a team.",
  "We’re not just building a virtual office.", "We’re building the experience of working in a real office —", "virtually.", "And we’re only getting started."]
# human-section cut points relative to the "Because…" onset (t1), on the words: messages, tasks, birthdays, recognition, conversations, wins, team
LEAD = 0.6
HUMAN_CUTS = [1.95, 2.95, 4.12, 5.54, 6.82, 8.35, 10.01]
for i, k in enumerate(["H0", "H1", "H2", "H3", "H4", "H5", "H6"]):
    s = next(x for x in SHOTS if x["k"] == k); lo = -LEAD if i == 0 else HUMAN_CUTS[i - 1]; s["b"] = s["a"] + HUMAN_CUTS[i] - lo

def dur_of(c): return float(re.search(r"Duration: (\d+):(\d+):([\d.]+)", subprocess.run([FF, "-hide_banner", "-i", os.path.join(CLIPS, f"{c}.mp4")], capture_output=True, text=True).stderr).group(3))
# timeline: frame-exact durations, starts account for transition overlaps
t = 0.0
for s in SHOTS:
    if not s.get("raw"): assert s["b"] <= dur_of(s["c"]) + 0.01, (s["k"], s["b"])
    s["d"] = round((s["b"] - s["a"]) / s.get("speed", 1.0) * FPS) / FPS
    ov = s.get("t")[1] if s.get("t") else 0.0
    s["start"] = t - ov; t = s["start"] + s["d"]
PIC_END = t
S = {s["k"]: s["start"] for s in SHOTS}
ALIVE, EXP, FEAT, HUM, CAVE, E1, E2, SLOW, BLACK = S["ALIVE"], S["EXP"], S["F0"], S["H0"], S["CAVE"], S["E1"], S["E2"], S["SLOW"], PIC_END
t1 = HUM + LEAD; VIRT = E2 + 0.25; A1 = 1.0; A2 = A1 + (2.48 - 0.03) + 0.25
ON = [A1, A2, ALIVE, ALIVE + 2.0, EXP - 1.85, EXP, t1, t1 + 4.22, t1 + 5.64, t1 + 6.92, t1 + 8.45, t1 + 10.11,
      CAVE + 0.55, VIRT - (36.31 - 32.43), VIRT, BLACK + 0.95]
VO = [(a, b, on - (o - a)) for (a, b, o), on in zip(TAKE, ON)]  # (src_in, src_out, place_t)
CARD_IN = VO[-1][2] + (VO[-1][1] - VO[-1][0]) + 0.4; CARD_OUT = CARD_IN + 3.8; END = CARD_OUT + 0.6  # 0.4 s of real breath after the line
DING = SLOW - 0.3; ZZ = 3.6
FEATS = [S[f"F{i}"] for i in range(4)]

MUSIC = [  # (m_in, m_out, t, gain, fade_in, fade_out)
  (10.9 - ALIVE, 10.9 - ALIVE + FEAT + 0.15, 0.0, 0.45, 1.0, 0.4),       # opening build, lands on ALIVE
  (28.0, min(36.5, 28.0 + (HUM + 0.45) - (FEAT - 0.25)), FEAT - 0.25, 0.55, 0.4, 0.6),  # the drive under the features
  (12.0, 12.0 + (DING + 0.6) - (HUM + 0.05), HUM + 0.05, 0.42, 0.8, 1.4),  # warmth through human → Cave → the ride, into the swell
  (41.45, 47.6, BLACK - (45.0 - 41.45), 0.68, 0.3, 2.2),   # the swell with the doors: its hit (45.0) ON the blackout, then it DECAYS
  (45.4, 45.4 + END - (CARD_IN - 0.2), CARD_IN - 0.2, 0.38, 1.2, 1.8),  # the resolution under the card, faded in (no hit)
]
EXPS = S["RUN"] - EXP
SFX = [  # (file, t, gain, len, fade_in, fade_out, extra filter)
  # opening + ALIVE (the approved opening cues)
  ("office.mp3", 0.0, 0.11, ALIVE + 0.7, 0.8, 0.7), ("deny.mp3", 2.5, 0.55),
  ("click1.mp3", S["R2"] + 1.38, 0.45), ("confirm.mp3", S["R2"] + 1.68, 0.5), ("click2.mp3", S["R3"] + 1.8, 0.4),
  ("riser.mp3", ALIVE - 2.0, 0.4), ("impact.mp3", ALIVE, 0.4),
  ("office.mp3", ALIVE - 0.4, 0.09, EXP - 1.9 - (ALIVE - 0.4), 0.4, 0.8),          # the 3D world's air, under the tour
  # EXPERIENCE — no riser, no impact: the office muffled (heard from outside), then it OPENS on the cut, first steps
  ("office.mp3", EXP - 1.9, 0.10, 1.95, 0.8, 0.12, "lowpass=f=450"),
  ("office.mp3", EXP - 0.05, 0.17, FEAT + 0.8 - (EXP - 0.05), 0.12, 0.8),
  ("run.mp3", EXP + 0.33, 0.16, EXPS - 0.33, 0.1, 0.1), ("run.mp3", S["RUN"], 0.30, 2.4, 0.0, 0.5), ("jump.mp3", S["RUN"] + 1.05, 0.5),
  # feature montage — four soft accents on the cuts + one small cue per visible action
  *[(("hit1.mp3" if i % 2 == 0 else "hit2.mp3"), ft, 0.3) for i, ft in enumerate(FEATS)],
  ("click1.mp3", S["F0"] + 0.43, 0.18),                          # Search: typing "Mi"
  ("click2.mp3", S["F1"] + 0.90, 0.18),                          # Tasks: the Missions tab
  ("click1.mp3", S["F3"] + 0.80, 0.14), ("click2.mp3", S["F3"] + 2.24, 0.16),   # Boards: grab → drop the note
  # human / culture — the office bed carries it; one cue per visible action
  ("office.mp3", HUM - 0.3, 0.18, 12.0, 0.6, 0.5), ("office.mp3", HUM + 11.2, 0.18, CAVE + 0.5 - (HUM + 11.2), 0.4, 0.5),
  ("notif.mp3", S["H1"] + 0.43, 0.2),                            # messages: Alex's DM lands
  ("confirm.mp3", S["H2"] + 0.13, 0.28),                         # tasks: the claim
  ("click1.mp3", S["H3"] + 0.93, 0.22),                          # birthdays: the wish
  ("click2.mp3", S["H4"] + 1.11, 0.22),                          # recognition: Kudos given
  *[("jump.mp3", S["H6"] + 0.13 + d, g) for d, g in ((0.0, 0.12), (0.26, 0.09), (0.52, 0.11), (0.70, 0.08), (0.90, 0.10))],  # the staggered cheer-jumps
  ("run.mp3", S["H6"] + 0.2, 0.06, 1.6, 0.3, 0.5),               # someone jogging over to join in
  # Cave → elevator
  ("cave.mp3", CAVE - 0.2, 0.6, 2.9, 0.3, 0.7),
  ("elevator.mp3", E1 - 0.4, 0.2, E2 - (E1 - 0.4), 0.6, 0.6), ("elevator.mp3", E2 - 1.0, 0.36, 4.0, 0.5, 0.5),
  ("elevator.mp3", SLOW - 0.2, 0.24, BLACK + 0.25 - (SLOW - 0.2), 0.3, 0.45), ("ding.mp3", DING, 0.48),   # the hum lets go AROUND the black
  ("zzzp2.mp3", BLACK - ZZ, 0.8, ZZ + 0.4, 3.2, 0.4),          # the electrical build peaks on the black, then a 0.4 s decay
]

os.makedirs(SEG, exist_ok=True)
def render(s):
    c, a, b, sp = s["c"], s["a"], s["b"], s.get("speed", 1.0); out = os.path.join(SEG, f"{s['k']}.mp4")
    if os.environ.get("REUSE") and os.path.exists(out): return out
    if s.get("raw"):  # Pass 1: the High take's own frames at their real timestamps → 30 fps, nothing else
        src = ["-f", "concat", "-safe", "0", "-i", os.path.join(PASS2 if os.path.exists(os.path.join(PASS2, f"{c}.frames")) else PASS1, f"{c}.frames", "list.txt")]
        vf = [f"trim=start={a}:end={b}", f"setpts=(PTS-STARTPTS)/{s.get('speed', 1.0)}", f"fps={FPS}"]
    elif s.get("frames"):  # real on-screen timing → motion-compensated true 60 fps (removes the capture stalls)
        src = ["-f", "concat", "-safe", "0", "-i", os.path.join(CLIPS, f"{c}.frames", "list.txt")]
        vf = [f"trim=start={a}:end={b}", "setpts=PTS-STARTPTS", "scale=1920:1080:flags=lanczos", "format=yuv420p",
              "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=none"]
    else:
        src = ["-ss", f"{a}", "-t", f"{b-a}", "-i", os.path.join(CLIPS, f"{c}.mp4")]
        vf = [f"setpts=(PTS-STARTPTS)/{sp}", f"minterpolate=fps={FPS}:mi_mode=mci:mc_mode=aobmc:vsbmc=1" if s.get("interp") else f"fps={FPS}"]
    if "frame" in s: vf.append(persp(*s["frame"]))
    vf += ["format=yuv420p", f"trim=end_frame={int(round(s['d']*FPS))}", "tpad=stop_mode=clone:stop_duration=0.5", f"trim=end_frame={int(round(s['d']*FPS))}"]
    if s["k"] == "R1": vf.append("fade=in:st=0:d=0.6")
    subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", *src, "-vf", ",".join(vf), "-an", "-c:v", "libx264", "-preset", "veryfast",
                    "-qp", "0", "-r", str(FPS), out], check=True)
    return out
paths = []
for s in SHOTS:
    paths.append(render(s)); print(f"{s['start']:7.2f}-{s['start']+s['d']:7.2f} {s['k']:6s} {s['c']} {s.get('t') or 'cut'}", flush=True)
# join: hard cuts via concat, dissolves via xfade (offsets from the running length)
ins = sum([["-i", p] for p in paths], []); ch = [f"[{j}:v]settb=1/{FPS},setpts=N,trim=end_frame={int(round(SHOTS[j]['d']*FPS))},tpad=stop_mode=clone:stop=2,trim=end_frame={int(round(SHOTS[j]['d']*FPS))},setpts=N,format=yuv420p[v{j}]" for j in range(len(paths))]  # exact planned frame count per shot
last, run = "[v0]", SHOTS[0]["d"]
for j in range(1, len(SHOTS)):
    tr = SHOTS[j].get("t")
    if tr: ch.append(f"{last}[v{j}]xfade=transition={tr[0]}:duration={tr[1]}:offset={run - tr[1]:.4f},settb=1/{FPS},setpts=N[j{j}]"); run += SHOTS[j]["d"] - tr[1]
    else: ch.append(f"{last}[v{j}]concat=n=2:v=1:a=0,settb=1/{FPS},setpts=N[j{j}]"); run += SHOTS[j]["d"]
    last = f"[j{j}]"
picture = os.path.join(SEG, "picture.mp4")
subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", *ins, "-filter_complex", ";".join(ch), "-map", last, "-c:v", "libx264",
                "-preset", "veryfast", "-qp", "0", "-r", str(FPS), picture], check=True)

def ts(x): x = max(0.0, x); return f"{int(x//3600)}:{int(x%3600//60):02d}:{x%60:05.2f}"
ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 2", "", "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  "Style: Sub,Helvetica Neue Medium,47,&H00F6F6F6,&H00FFFFFF,&H78000000,&H88000000,0,0,0,0,100,100,1.2,0,1,1.6,1.8,2,170,170,150,1",
  "Style: Card,Helvetica Neue,108,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,22,0,1,0,0,5,0,0,0,1",
  "Style: CardSub,Helvetica Neue Medium,28,&H00BEBEBE,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,16,0,1,0,0,5,0,0,0,1",
  "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
for (a, b, pt), line in zip(VO, LINES):
    if line.startswith("But somewhere"):  # two readable lines for the long opening phrase
        mid = pt + 2.1; ass.append(f"Dialogue: 0,{ts(pt+0.05)},{ts(mid)},Sub,,0,0,0,,{{\\fad(220,200)\\blur2}}But somewhere along the way,")
        ass.append(f"Dialogue: 0,{ts(mid)},{ts(pt+b-a+0.1)},Sub,,0,0,0,,{{\\fad(150,260)\\blur2}}we lost some of the little things that made an office feel…"); continue
    ass.append(f"Dialogue: 0,{ts(pt+0.05)},{ts(pt+b-a+0.15)},Sub,,0,0,0,,{{\\fad(220,260)\\blur2}}{line}")
ass.append(f"Dialogue: 1,{ts(CARD_IN+0.35)},{ts(CARD_OUT)},CardSub,,0,0,0,,{{\\fad(900,700)\\pos(960,640)}}VIRTUAL OFFICE")
subs = os.path.join(HERE, "final-master-subs.ass"); open(subs, "w").write("\n".join(ass) + "\n")

inputs, filt = [], []
def add(p): inputs.extend(["-i", p]); return len(inputs) // 2
ms = lambda x: max(0, int(round(x * 1000)))
fmt = "aformat=sample_rates=48000:channel_layouts=stereo"
pad = f"apad=whole_dur={END:.3f},atrim=0:{END:.3f}"  # every layer spans the whole film → amix never drops out
vl, ml, fl = [], [], []
for k, (a, b, pt) in enumerate(VO):
    n = add(os.path.join(A, "vo-final.mp3"))
    filt.append(f"[{n}:a]{fmt},atrim={a}:{b},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st={b-a-0.06}:d=0.06,adelay={ms(pt)}|{ms(pt)},{pad}[vo{k}]"); vl.append(f"[vo{k}]")
filt.append(f"{''.join(vl)}amix=inputs={len(vl)}:normalize=0,highpass=f=70,acompressor=threshold=0.12:ratio=2.5:attack=8:release=160:makeup=1.3[vobus]")
filt.append("[vobus]asplit=2[vomix][vokey]")
for k, (a, b, tt, g, fi, fo) in enumerate(MUSIC):
    n = add(os.path.join(A, "music.mp3")); d = b - a
    fades = (f",afade=t=in:d={fi}" if fi else "") + (f",afade=t=out:st={d-fo:.3f}:d={fo}" if fo else "")
    filt.append(f"[{n}:a]{fmt},atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS{fades},volume={g},adelay={ms(tt)}|{ms(tt)},{pad}[m{k}]"); ml.append(f"[m{k}]")
filt.append(f"{''.join(ml)}amix=inputs={len(ml)}:normalize=0[mus]")
filt.append("[mus][vokey]sidechaincompress=threshold=0.03:ratio=4:attack=40:release=550:knee=4[musduck]")
for k, s in enumerate(SFX):
    f, tt, g = s[:3]; n = add(os.path.join(A, f)); ex = ""
    if len(s) > 3:
        ln, fi, fo = s[3], s[4], s[5]; ex += f",atrim=0:{ln:.3f}"
        if fi: ex += f",afade=t=in:d={fi}" + (":curve=qsin" if f.startswith("zzzp") else "")
        if fo: ex += f",afade=t=out:st={max(0, ln-fo):.3f}:d={fo}"
        if len(s) > 6: ex += "," + s[6]
    filt.append(f"[{n}:a]{fmt}{ex},volume={g},adelay={ms(tt)}|{ms(tt)},{pad}[fx{k}]"); fl.append(f"[fx{k}]")
filt.append(f"{''.join(fl)}amix=inputs={len(fl)}:normalize=0[fxbus]")
filt.append(f"[vomix][musduck][fxbus]amix=inputs=3:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=14,aresample=48000,atrim=0:{END:.3f}[aout]")
LG = add(os.path.join(HERE, "..", "final", "offshorly-logo-reversed.png")); inputs[-2:-1] = ["-loop", "1", "-t", f"{END:.3f}", "-i"]  # the film-only reversed logo (still image)
filt.append(f"[{LG}:v]scale=700:-1:flags=lanczos,format=rgba,fade=t=in:st={CARD_IN:.3f}:d=0.9:alpha=1,fade=t=out:st={CARD_OUT - 0.7:.3f}:d=0.7:alpha=1[logo]")
filt.append(f"[0:v]tpad=stop_duration={END - PIC_END + 0.5:.3f}:color=black,trim=duration={END:.3f},subtitles='{subs}':fontsdir=/System/Library/Fonts[base]")
filt.append("[base][logo]overlay=(W-w)/2:422:eof_action=pass,format=yuv420p[vout]")
out = os.path.join(HERE, "vo-linkedin-FINAL-v2-master.mp4")  # FINAL-v2; FINAL (v1) is kept as the fallback
open(os.path.join(HERE, "final-master-filter.txt"), "w").write(";\n".join(filt))
subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", "-i", picture, *inputs, "-filter_complex", ";".join(filt),
                "-map", "[vout]", "-map", "[aout]", "-t", f"{END:.3f}", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-r", str(FPS),
                "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", out], check=True)
print(f"ALIVE {ALIVE:.2f}  EXP {EXP:.2f}  BLACK {BLACK:.2f}  DING {DING:.2f}  CARD {CARD_IN:.2f}  END {END:.2f}")
print(out)
