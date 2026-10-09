#!/usr/bin/env python3
"""FILM RIG ONLY — Offshorly VO TEASER 2: the REVISED PROOF (Bon's review of 2026-10-09).

Part 1  the opening with continuous narration → "alive" on the real Office→3D switch → an escalating montage of real
        rooms shot with a film-only PERSPECTIVE camera (the cast at work in their own seats) → "experience" on the real
        3D→Player switch → a tool montage: five tools in five places, every panel whole (no crop, no digital zoom).
Part 2  the question-led AI Lab: Bon asks Toucan (UI) → takeoff (exterior wide three-quarter, a dolly onto the bird) →
        the flight (a chase rig at the bird's height) → the discovery (rise + pull back over the Lab) → meet the team →
        the scripted job as a working system → the result reaches Bon in-app → Approve → the closing line → the logo.

Every picture frame comes from the real engine. The only film-side tools are: cuts/dissolves, captions, the
"AI LAB · SCRIPTED PREVIEW" disclosure, proof tags, and the logo card. Narration: the approved teaser-1 take for the
opening's approved words; a watermarked local scratch voice for the new lines. Music/effects: the owned teaser-1 library.

  FILM_FFMPEG=… python3 teaser2_proof2.py <takes_t2> <scratch_vo_dir> <work_dir> <out_dir>
"""
import json, os, subprocess, sys

FF = os.environ["FILM_FFMPEG"]
TAKES, SVO, WORK, OUT = (os.path.abspath(p) for p in sys.argv[1:5])
os.makedirs(WORK, exist_ok=True); os.makedirs(OUT, exist_ok=True)
FILM = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
AUD = os.path.join(FILM, "out/teaser/audio"); LOGO = os.path.join(FILM, "out/final/offshorly-logo-reversed.png")
FPS = 30
run = lambda *a: subprocess.run([FF, "-nostdin", "-y", "-hide_banner", "-loglevel", "error", *a], check=True)

def marks(take):
    d = json.load(open(os.path.join(TAKES, f"{take}.json"))); t0 = (d.get("clip") or {}).get("t0") or 0
    out = {}
    for x in d.get("ran") or []:
        out.setdefault(x["what"], x["t"] - t0)
    return out
TL, L1, L1b, L2c, L4, L6b = marks("T2Tools"), marks("T2Lab1"), marks("T2Lab1b"), marks("T2Lab2c"), marks("T2Lab4"), marks("T2Lab6b")

WORLD = "eq=contrast=1.05:saturation=1.06,colorbalance=rh=0.016:bh=-0.01,vignette=a=PI/6.5"
UI = "eq=contrast=1.02"
# (key, take, in, out, grade, transition-in: None | seconds of dissolve)
P1 = [
    ("O1", "T2Opening", 3.90, 8.50, WORLD, None),     # walk in → the lane turns red
    ("O2", "T2Opening", 15.00, 17.90, WORLD, 0.25),   # the kiosk card → Check In
    ("O3", "T2Opening", 23.00, 25.10, WORLD, 0.25),   # through the green lane
    ("O4", "T2Opening", 32.40, 33.80, WORLD, 0.30),   # the office opens around him
    ("A1", "T2Alive", 2.167, 3.567, WORLD, None),     # the same frame → the REAL Office→3D switch on "alive" + the drop
    ("M0", "T2Rooms", 1.20, 2.80, WORLD, None),       # ALIVE MONTAGE · the whole office from the air
    ("M1", "T2Rooms", 4.30, 5.60, WORLD, None),       # the Design Room: Micah and Angelo at work
    ("M2", "T2Rooms", 7.40, 8.60, WORLD, None),       # the Dev room: Alex and Jan
    ("M3", "T2Rooms", 10.40, 11.50, WORLD, None),     # the Gaming room: Clang and France
    ("M4", "T2Rooms", 13.60, 14.60, WORLD, None),     # the Executive room: Kael and Nicole
    ("M5", "T2Rooms", 16.60, 17.50, WORLD, None),     # the AI room: Jona
    ("M6", "T2Rooms", 19.60, 21.20, WORLD, None),     # the Hub, the breath before…
    ("X1", "T2Experience", 1.60, 7.10, WORLD, 0.40),  # …the push-in → the REAL 3D→Player switch on "experience" → run, jump
    ("K1", "T2Tools", TL["hub-open"] - 0.08, TL["hub-card2"] - 0.05, UI, None),        # the Hub, at the café
    ("K2", "T2Tools", TL["search-open"] - 0.05, TL["search-typed"] + 1.45, UI, None),   # Search: "Mi" → Micah, who is right there
    ("K3", "T2Tools", TL["tasks-open"] - 0.05, TL["missions"] + 1.05, UI, None),         # Tasks in the Gaming room: Quests → Missions
    ("K5", "T2Hub", 18.60, 21.20, UI, None),                                            # the weather card's city forecast
]
P2 = [
    ("U1", "T2Lab1", L1["request"] - 1.25, L1["A"], UI, None),          # Bon asks Toucan (the real AI Workforce entry + task chat)
    ("SA", "T2Lab1", L1["A"], L1["B"], WORLD, None),                     # SHOT A — takeoff: the exterior wide, the dolly onto the bird
    ("SB", "T2Lab1", L1["B"] + 0.14, L1["B"] + 1.44, WORLD, None),        # SHOT B — the flight, at the bird's height, over the concourse
    ("SB2", "T2Lab1", L1["B"] + 2.14, L1["C"] - 0.26, WORLD, None),       #   hidden cut on the motion (skips the statue pass): over the Executive room
    ("SC", "T2Lab1", L1["C"] + 1.34, L1["C2"], WORLD, None),              # SHOT C — hidden cut once the rise clears the canopy: the discovery
    ("SC2", "T2Lab1", L1["C2"], L1["C2"] + 1.45, WORLD, None),           #   …its inhabitants on the treehouse
    ("D1", "T2Lab1b", L1b["D-milo"] + 0.05, L1b["D-milo"] + 1.55, WORLD, None),   # SHOT D — Milo
    ("D2", "T2Lab1b", L1b["D-nova"] + 0.05, L1b["D-nova"] + 1.55, WORLD, None),   #   Nova
    ("D3", "T2Lab1b", L1b["D-pip"] + 0.05, L1b["D-pip"] + 1.55, WORLD, None),     #   Pip
    ("BR", "T2Lab1b", L1b["brief"] + 0.05, L1b["brief"] + 1.45, WORLD, None),     # the brief at the perch
    ("W1", "T2Lab2a", 0.70, 2.40, WORLD, None),                          # Nova designs
    ("W2", "T2Lab2b", 0.70, 2.10, WORLD, None),                          # Nova carries the work to Milo
    ("W3", "T2Lab2c", L2c["milo-has"] - 0.90, L2c["milo-has"] + 0.80, WORLD, None),   # the handoff
    ("W4", "T2Lab3", 0.80, 2.40, WORLD, None),                           # Milo builds
    ("W5", "T2Lab4", L4["pip-has"] - 0.90, L4["pip-has"] + 0.70, WORLD, None),        # Milo → Pip
    ("W6", "T2Lab5", 0.70, 2.40, WORLD, None),                           # Pip reviews
    ("W7", "T2Lab6a", 0.80, 2.30, WORLD, None),                          # Toucan carries the result home
    ("Y1", "T2Lab6b", L6b["delivered"] - 0.30, L6b["delivered"] + 2.00, UI, 0.30),    # in-app: "Here's your landing page." · View Result
    ("Y2", "T2Lab6b", L6b["result"] - 0.10, L6b["approved"] + 1.20, UI, None),        # the result → Approve → Approved
    ("FIN", "T2Rooms", 0.72, 3.68, WORLD, 0.40),                         # where we are: the whole office from the air
]
SLATE, CARD = 1.2, 6.0

def seg_file(k): return os.path.join(WORK, f"{k}.mp4")
def frames(a, b): return int(round((b - a) * FPS))
def render(seg):
    k, take, a, b, grade, _ = seg
    if os.environ.get("REUSE") and os.path.exists(seg_file(k)): return
    n = frames(a, b)
    run("-threads", "4", "-ss", f"{a:.3f}", "-t", f"{b - a + 0.4:.3f}", "-i", os.path.join(TAKES, f"{take}.mp4"),
        "-vf", f"fps={FPS},setpts=PTS-STARTPTS,format=yuv420p,{grade},trim=end_frame={n},format=yuv420p",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-r", str(FPS), seg_file(k))

def lay(segs, t0):
    out, t = [], t0
    for s in segs:
        d = frames(s[2], s[3]) / FPS; ov = s[5] or 0.0; st = t - ov; out.append((s, st, d)); t = st + d
    return out, t
L_1, P1_END = lay(P1, 0.0)
P2_START = P1_END + SLATE
L_2, P2_PIC_END = lay(P2, P2_START)
END = P2_PIC_END + CARD
S = {s[0]: (st, d, s) for s, st, d in L_1 + L_2}
at = lambda k, take_t: S[k][0] + (take_t - S[k][2][2])
ALIVE = at("A1", 2.367); EXP = at("X1", 4.200)
LIFTOFF = at("SA", L1["liftoff"]); REVEAL = S["SC"][0] + S["SC"][1]
APPROVE = at("Y2", L6b["approved"]); DELIVERED = at("Y1", L6b["delivered"])
SB2 = 220.5 - (END - P2_START)                         # Part 2's place in the revised 3:40.5 storyboard

TK = os.path.join(AUD, "vo-final.mp3")
TAKE = {  # the approved teaser-1 narration, phrase-exact (src_in, src_out, onset in source, caption)
    "L1": (0.00, 2.02, 0.03, "Remote work gave us freedom."),
    "L2": (2.42, 7.50, 2.48, "But somewhere along the way, we lost some of the little things that made an office feel…"),
    "L3": (8.00, 8.70, 8.06, "alive."),
    "L4": (9.77, 12.40, 9.83, "But a workplace isn’t something you just look at."),
    "L5": (12.72, 13.73, 12.78, "It’s something…"),
    "L6": (14.08, 15.20, 14.14, "you experience."),
}
ONSET = {"L1": 0.9, "L2": 3.3, "L3": ALIVE, "L4": ALIVE + 2.0, "L5": EXP - 1.9, "L6": EXP}
def dur(p):
    r = subprocess.run([FF, "-hide_banner", "-i", p], capture_output=True, text=True).stderr
    h, m, s = r.split("Duration: ")[1].split(",")[0].split(":"); return int(h) * 3600 + int(m) * 60 + float(s)
SCR = {  # the question, as one continuous thought; each answer is on screen as its line lands
    "N1": (S["U1"][0] + 0.40, "But what if an idea didn’t have to wait…"),
    "N2": (S["SA"][0] + 0.30, "…for someone to bring it to life?"),
    "N3": (S["SB"][0] + 0.40, "What if the next chapter of work…"),
    "N4": (None, "…was already taking shape?"),          # placed below: after N3, landing on the reveal
    "S3": (S["FIN"][0] + 0.25, "Because the future of work isn’t just about where we are…"),
    "S4": (S["FIN"][0] + S["FIN"][1] + 0.45, "…it’s about what we can create."),
}
_n3_end = SCR["N3"][0] + dur(os.path.join(SVO, "N3.wav"))
SCR["N4"] = (max(REVEAL - 2.9, _n3_end + 0.25), SCR["N4"][1])   # one continuous thought: never over N3, "shape?" on the reveal
CREATE = SCR["S4"][0] + 1.2

M = os.path.join(AUD, "music.mp3")
MUSIC = [  # (m_in, m_out, t, gain, fade_in, fade_out)
    (12.0 - ALIVE, 12.0, 0.0, 0.42, 1.2, 0.0),                       # the build: its hit ON "alive"
    (12.0, 12.0 + (EXP - 2.5 - ALIVE), ALIVE, 0.48, 0.0, 0.6),        # the montage drive; let go just before "It's something…"
    (41.45, 45.8, EXP - 3.55, 0.62, 0.0, 0.6),                        # the dropout swells back: its hit ON "experience"
    (36.0 - (P1_END - 1.2 - (EXP + 0.6)), 37.2, EXP + 0.6, 0.50, 0.4, 0.8),   # the tool drive; its peak on the forecast
    (0.0, 12.0, REVEAL - 12.0, 0.40, 1.5, 0.0),                       # Part 2: the questions build; the hit ON the Lab reveal
    (12.0, 37.5, REVEAL, 0.47, 0.0, 1.2),                             # the Lab at work; re-timed below so 36.0 = Approve
    (41.45, 49.0, CREATE - 3.55, 0.62, 0.0, 1.5),                     # the final swell: its hit ON "create"
]
lab_in = 36.0 - (APPROVE - REVEAL); MUSIC[5] = (lab_in, 37.5, REVEAL, 0.47, 0.0, 1.2)
if MUSIC[4][2] < P2_START: MUSIC[4] = (P2_START - (REVEAL - 12.0), 12.0, P2_START, 0.40, 1.5, 0.0)
CUTS1 = [S[k][0] for k in ("M0", "M1", "M2", "M3", "M4", "M5", "M6")]
CUTS2 = [S[k][0] for k in ("D1", "D2", "D3", "BR", "W1", "W2", "W3", "W4", "W5", "W6", "W7")]
SFX = [  # (file, t, gain, len, fade_in, fade_out, extra)
    ("office.mp3", 0.0, 0.10, ALIVE + 0.5, 0.6, 0.6), ("deny.mp3", at("O1", 7.75), 0.5),
    ("click1.mp3", at("O2", 17.42), 0.42), ("confirm.mp3", at("O2", 17.72), 0.45), ("click2.mp3", at("O3", 23.6), 0.35),
    ("riser.mp3", ALIVE - 2.0, 0.42), ("impact.mp3", ALIVE, 0.45),
    *[(("hit1.mp3" if i % 2 == 0 else "hit2.mp3"), t, 0.20 + 0.02 * i) for i, t in enumerate(CUTS1)],   # the escalating cuts
    ("office.mp3", EXP - 1.9, 0.10, 1.95, 0.8, 0.12, "lowpass=f=450"), ("office.mp3", EXP - 0.05, 0.16, 3.4, 0.12, 0.8),
    ("run.mp3", at("X1", 4.48), 0.16, 0.6, 0.1, 0.1), ("run.mp3", at("X1", 5.03), 0.30, 1.9, 0.0, 0.5), ("jump.mp3", at("X1", 6.18), 0.5),
    *[(("hit2.mp3" if i % 2 == 0 else "hit1.mp3"), S[k][0], 0.24) for i, k in enumerate(["K1", "K2", "K3", "K5"])],
    ("click1.mp3", at("K1", TL["hub-open"] + 0.12), 0.2), ("click2.mp3", at("K2", TL["search-open"] + 0.1), 0.2),
    ("click1.mp3", at("K3", TL["missions"] + 0.05), 0.2), ("click2.mp3", at("K5", 18.95), 0.2),
    ("office.mp3", P2_START, 0.10, S["SA"][0] - P2_START + 0.3, 0.5, 0.4), ("click1.mp3", at("U1", L1["request"]), 0.42),
    *[(("hit1.mp3" if i % 2 == 0 else "hit2.mp3"), t, 0.18) for i, t in enumerate(CUTS2)],
    ("office.mp3", S["Y1"][0], 0.10, S["FIN"][0] - S["Y1"][0], 0.4, 0.6), ("notif.mp3", DELIVERED, 0.30),
    ("click2.mp3", at("Y2", L6b["result"]) - 0.05, 0.22), ("confirm.mp3", APPROVE, 0.42),
]

def ts(x): x = max(0.0, x); return f"{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}"
def mmss(x): return f"{int(x // 60)}:{x % 60:04.1f}"

if __name__ == "__main__":
    for s in P1 + P2: render(s); print("seg", s[0], flush=True)

    ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 2", "", "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Sub,Helvetica Neue Medium,47,&H00F6F6F6,&H00FFFFFF,&H78000000,&H88000000,0,0,0,0,100,100,1.2,0,1,1.6,1.8,2,170,170,150,1",
        "Style: Tag,Helvetica Neue,21,&H40FFFFFF,&H00FFFFFF,&H90000000,&H90000000,0,0,0,0,100,100,1,0,1,1.2,0,7,36,36,30,1",
        "Style: Scratch,Helvetica Neue Medium,22,&H2066E0FF,&H00FFFFFF,&H90000000,&H90000000,0,0,0,0,100,100,2,0,1,1.4,0,9,36,36,30,1",
        "Style: Lab,Helvetica Neue Medium,25,&H18FFFFFF,&H00FFFFFF,&H70000000,&H80000000,0,0,0,0,100,100,5,0,1,1.4,1.2,1,64,64,58,1",
        "Style: Slate,Helvetica Neue,34,&H30FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,7,0,1,0,0,5,0,0,0,1",
        "Style: CardSub,Helvetica Neue Medium,28,&H00BEBEBE,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,16,0,1,0,0,5,0,0,0,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    vo = []
    for k, (a, b, o, cap) in TAKE.items():
        place = ONSET[k] - (o - a); vo.append((TK, a, b, place))
        if k == "L2":  # two readable caption lines, split at the take's own pause after "way,"
            mid = ONSET[k] + 1.62
            ass.append(f"Dialogue: 0,{ts(ONSET[k] - 0.02)},{ts(mid)},Sub,,0,0,0,,{{\\fad(180,120)\\blur2}}But somewhere along the way,")
            ass.append(f"Dialogue: 0,{ts(mid)},{ts(place + b - a + 0.15)},Sub,,0,0,0,,{{\\fad(120,240)\\blur2}}we lost some of the little things that made an office feel…")
            continue
        ass.append(f"Dialogue: 0,{ts(ONSET[k] - 0.02)},{ts(place + b - a + 0.15)},Sub,,0,0,0,,{{\\fad(180,240)\\blur2}}{cap}")
    for k, (t, cap) in SCR.items():
        p = os.path.join(SVO, f"{k}.wav"); d = dur(p); vo.append((p, 0.0, d, t))
        ass.append(f"Dialogue: 0,{ts(t - 0.02)},{ts(t + d + 0.2)},Sub,,0,0,0,,{{\\fad(180,240)\\blur2}}{cap}")
        ass.append(f"Dialogue: 2,{ts(t - 0.1)},{ts(t + d + 0.3)},Scratch,,0,0,0,,{{\\fad(150,150)}}SCRATCH VO · local voice · timing only")
    ass.append(f"Dialogue: 1,{ts(0.5)},{ts(P1_END - 0.3)},Tag,,0,0,0,,{{\\fad(400,300)}}TEASER 2 · REVISED PROOF · storyboard 0:00–{mmss(P1_END)} · VO: approved teaser-1 take · temp music")
    ass.append(f"Dialogue: 1,{ts(P2_START + 0.3)},{ts(P2_PIC_END - 0.2)},Tag,,0,0,0,,{{\\fad(400,300)}}TEASER 2 · REVISED PROOF · storyboard {mmss(SB2)}–3:40.5 · temp music")
    ass.append(f"Dialogue: 1,{ts(P1_END + 0.1)},{ts(P2_START - 0.05)},Slate,,0,0,0,,{{\\fad(200,200)}}AI LAB   ·   {mmss(SB2)}")
    ass.append(f"Dialogue: 1,{ts(S['U1'][0] + 0.3)},{ts(S['Y2'][0] + S['Y2'][1] - 0.1)},Lab,,0,0,0,,{{\\fad(500,400)}}AI LAB  ·  SCRIPTED PREVIEW")
    card_in = CREATE - 0.35; card_out = END - 0.75
    ass.append(f"Dialogue: 1,{ts(card_in + 0.35)},{ts(card_out)},CardSub,,0,0,0,,{{\\fad(900,700)\\pos(960,640)}}VIRTUAL OFFICE")
    subs = os.path.join(WORK, "proof2-subs.ass"); open(subs, "w").write("\n".join(ass) + "\n")

    ins, fl = [], []
    def add(p): ins.extend(["-i", p]); return len(ins) // 2 - 1
    fmt = "aformat=sample_rates=48000:channel_layouts=stereo"; pad = f"apad=whole_dur={END:.3f},atrim=0:{END:.3f}"
    ms = lambda x: max(0, int(round(x * 1000)))
    vl, ml, xl = [], [], []
    for i, (p, a, b, t) in enumerate(vo):
        n = add(p); fl.append(f"[{n}:a]{fmt},atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st={b - a - 0.06:.3f}:d=0.06,adelay={ms(t)}|{ms(t)},{pad}[vo{i}]"); vl.append(f"[vo{i}]")
    fl.append(f"{''.join(vl)}amix=inputs={len(vl)}:normalize=0,highpass=f=70,acompressor=threshold=0.12:ratio=2.5:attack=8:release=160:makeup=1.3,asplit=2[vomix][vokey]")
    for i, (a, b, t, g, fi, fo) in enumerate(MUSIC):
        n = add(M); d = b - a; a = max(0.0, a)
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
    mix = os.path.join(WORK, "proof2-mix.wav")
    run(*ins, "-filter_complex", ";".join(fl), "-map", "[a]", "-c:a", "pcm_s16le", mix); print("mix", flush=True)

    def assemble(layout, name, fade_in):  # one part: cuts and dissolves → a single high-quality file
        vin, ch, last, runlen = [], [], None, 0.0
        for j, (s, st, d) in enumerate(layout):
            vin += ["-threads", "2", "-i", seg_file(s[0])]; n = frames(s[2], s[3])
            ch.append(f"[{j}:v]settb=1/{FPS},setpts=N,trim=end_frame={n},tpad=stop_mode=clone:stop=3,trim=end_frame={n},setpts=N,format=yuv420p[v{j}]")
            if j == 0:
                last = f"[v{j}]"; runlen = d
                if fade_in: ch.append(f"{last}fade=t=in:st=0:d={fade_in}[f0]"); last = "[f0]"
                continue
            if s[5]: ch.append(f"{last}[v{j}]xfade=transition=fade:duration={s[5]}:offset={runlen - s[5]:.4f},settb=1/{FPS},setpts=N[c{j}]"); runlen += d - s[5]
            else: ch.append(f"{last}[v{j}]concat=n=2:v=1:a=0,settb=1/{FPS},setpts=N[c{j}]"); runlen += d
            last = f"[c{j}]"
        ch.append(f"{last}fade=t=out:st={runlen - 0.5:.3f}:d=0.5[o]")
        out = os.path.join(WORK, f"{name}.mp4")
        run(*vin, "-filter_complex", ";".join(ch), "-map", "[o]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "15", "-r", str(FPS), out)
        return out
    p1 = assemble(L_1, "part1", 0.6); p2 = assemble(L_2, "part2", 0.4); print("parts", flush=True)
    tc = "fontfile=/System/Library/Fonts/HelveticaNeue.ttc:fontsize=21:fontcolor=white@0.55:x=36:y=58"
    ch = [f"color=c=black:s=1920x1080:r={FPS}:d={SLATE},format=yuv420p[SL]", f"color=c=black:s=1920x1080:r={FPS}:d={CARD},format=yuv420p[CD]",
          "[0:v][SL][1:v][CD]concat=n=4:v=1:a=0,settb=1/30,setpts=N[pic]",
          f"[2:v]scale=700:-1:flags=lanczos,format=rgba,fade=t=in:st={card_in:.3f}:d=0.9:alpha=1,fade=t=out:st={card_out - 0.7:.3f}:d=0.7:alpha=1[logo]",
          f"[pic]subtitles='{subs}':fontsdir=/System/Library/Fonts,"
          f"drawtext={tc}:text='SB %{{pts\\:hms}}':enable='between(t,0.5,{P1_END - 0.3:.3f})',"
          f"drawtext={tc}:text='SB %{{pts\\:hms\\:{SB2 - P2_START:.3f}}}':enable='between(t,{P2_START + 0.3:.3f},{P2_PIC_END - 0.2:.3f})'[base]",
          "[base][logo]overlay=(W-w)/2:422:eof_action=pass,format=yuv420p[vout]"]
    out = os.path.join(OUT, "offshorly-vo-teaser2_proof2.mp4")
    run("-i", p1, "-i", p2, "-loop", "1", "-t", f"{END:.3f}", "-i", LOGO, "-i", mix, "-filter_complex", ";".join(ch),
        "-map", "[vout]", "-map", "3:a", "-t", f"{END:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", out)
    marks_out = dict(ALIVE=ALIVE, EXP=EXP, P1_END=P1_END, P2_START=P2_START, LIFTOFF=LIFTOFF, REVEAL=REVEAL, DELIVERED=DELIVERED,
                     APPROVE=APPROVE, CREATE=CREATE, END=END, SB2=SB2, onsets={**ONSET, **{k: v[0] for k, v in SCR.items()}},
                     segments={k: dict(start=round(v[0], 3), dur=round(v[1], 3), take=v[2][1], src=[round(v[2][2], 3), round(v[2][3], 3)]) for k, v in S.items()})
    json.dump(marks_out, open(os.path.join(OUT, "offshorly-vo-teaser2_proof2.timeline.json"), "w"), indent=1)
    print(json.dumps({k: round(v, 3) for k, v in marks_out.items() if isinstance(v, float)}))
    print(out)
