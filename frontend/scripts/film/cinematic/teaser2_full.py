#!/usr/bin/env python3
"""FILM RIG ONLY — Offshorly VO TEASER 2: THE COMPLETE REVIEW CUT (~3:53).

Every picture frame comes from the real engine (takes in out/cinematic/takes_t2). The only film-side tools are cuts and
dissolves, captions, the "AI LAB · SCRIPTED PREVIEW" disclosure, the scratch-VO tags, a review timecode and the logo card.
Narration: the approved teaser-1 take for the opening's approved words; a labelled local scratch voice for every new line
(Bon's own voice is not synthesised: no convincing local tool). Music and effects: the owned teaser-1 library (temp score).

  FILM_FFMPEG=… python3 teaser2_full.py <takes_t2> <scratch_vo_dir> <work_dir> <out_dir>
"""
import json, os, subprocess, sys

FF = os.environ["FILM_FFMPEG"]
TAKES, SVO, WORK, OUT = (os.path.abspath(p) for p in sys.argv[1:5])
os.makedirs(WORK, exist_ok=True); os.makedirs(OUT, exist_ok=True)
FILM = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
AUD = os.path.join(FILM, "out/teaser/audio"); LOGO = os.path.join(FILM, "out/final/offshorly-logo-reversed.png")
FPS = 30
NAME = "offshorly-vo-teaser2_review-cut"
run = lambda *a: subprocess.run([FF, "-nostdin", "-y", "-hide_banner", "-loglevel", "error", *a], check=True)

def marks(take):
    d = json.load(open(os.path.join(TAKES, f"{take}.json"))); t0 = (d.get("clip") or {}).get("t0") or 0
    out = {}
    for x in (d.get("ran") or []):
        if isinstance(x, dict) and "t" in x: out.setdefault(x["what"], x["t"] - t0)
    return out
TL, H4, UI_, MEM, L4A, L3B, L3E, L3G, L3J = (marks(k) for k in ("T2Tools", "T2Hub", "T2UI", "T2Memory", "T2Lab4a", "T2Lab3b", "T2Lab3e", "T2Lab3g", "T2Lab3j"))
PA, PB, PC, PD, PE = (marks(f"T2Party4{x}") for x in "ABCDE")
ORB, CLO, EXI, SCO, TOU, CAV = (marks(k) for k in ("T2Orbit", "T2Close", "T2Exit", "T2Scooter", "T2Toucan2", "T2Cave"))

WORLD = "eq=contrast=1.05:saturation=1.06,colorbalance=rh=0.016:bh=-0.01,vignette=a=PI/6.5"
UI = "eq=contrast=1.02"
NIGHT = "eq=contrast=1.04:saturation=1.04"
# (key, take, in, out, grade, dissolve-in)
SEGS = [
    # A · OFFICE VIEW — walk in → refused → kiosk → check in → the office opens
    ("O1", "T2Opening", 3.90, 8.50, WORLD, None), ("O2", "T2Opening", 15.00, 17.90, WORLD, 0.25),
    ("O3", "T2Opening", 23.00, 25.10, WORLD, 0.25), ("O4", "T2Opening", 32.40, 33.80, WORLD, 0.30),
    # B · "alive." on the real Office→3D switch → the cast at work, room by room
    ("A1", "T2Alive", 2.167, 3.567, WORLD, None),
    ("M0", "T2Rooms", 1.20, 2.80, WORLD, None), ("M1", "T2Rooms", 4.30, 5.60, WORLD, None), ("M2", "T2Rooms", 7.40, 8.60, WORLD, None),
    ("M3", "T2Rooms", 10.40, 11.50, WORLD, None), ("M4", "T2Rooms", 13.60, 14.60, WORLD, None), ("M5", "T2Rooms", 16.60, 17.50, WORLD, None),
    ("M6", "T2Rooms", 19.60, 21.20, WORLD, None),
    # C · "you experience." on the real 3D→Player switch → run, jump
    ("X1", "T2Experience", 1.60, 7.10, WORLD, 0.40),
    # D · TOOLS (music) — each panel whole, each in its own place
    ("D1", "T2Tools", TL["hub-open"] - 0.08, TL["hub-card2"] - 0.05, UI, None),
    ("D2", "T2Hub", 18.60, 21.00, UI, None),
    ("D3", "T2UI", 2.90, 3.90, UI, None), ("D4", "T2UI", 4.70, 6.80, UI, None),
    ("D5", "T2Tools", TL["search-open"] - 0.05, TL["search-typed"] + 1.35, UI, None),
    ("D6", "T2UI", 11.20, 13.40, UI, None),
    ("D7", "T2Tools", TL["tasks-open"] - 0.05, TL["missions"] + 1.00, UI, None),
    ("D8", "HumTasks", 2.40, 4.40, UI, None),
    ("D9", "T2UI", 18.20, 19.90, UI, None),
    # E · PEOPLE — "Because the heart of a workplace was never the space… It was always the people."
    ("E1", "PVConversation", 7.30, 11.50, WORLD, 0.30), ("E2", "CoworkerInteraction", 0.50, 2.70, UI, None),
    ("E3", "SpatialIndicators", 1.00, 3.80, UI, None), ("E4", "Chat", 0.80, 3.50, UI, None),
    # F · TOGETHER, FROM ANYWHERE (music) — the call, the board, the map
    ("F1", "PVSpatialVideo", 15.40, 19.40, WORLD, None), ("F2", "FeatBoards", 6.80, 10.20, UI, None), ("F3", "Map", 0.60, 4.20, UI, None),
    # G · GO TOGETHER × 4 — "And some ideas deserve more than a conversation."
    ("G1", "T2Party4A", PA["invite"] + 0.10, PA["room"] + 0.40, UI, 0.30),
    ("G2", "T2Party4B", PB["go-together"] + 0.30, PB["accepted"] - 0.10, UI, None),
    ("G3", "T2Party4B", PB["start"] - 0.40, PB["start"] + 3.60, WORLD, None),
    ("G4", "T2Party4C", PC["front"] + 0.40, PC["front"] + 3.70, WORLD, None),
    ("G5", "T2Party4D", PD["lobby"] + 2.10, PD["doors"] + 3.60, WORLD, None),
    ("G6", "T2Party4D", PD["reveal"] - 2.70, PD["reveal"] - 0.10, WORLD, None),
    ("G7", "T2Party4D", PD["reveal"] + 0.20, PD["reveal"] + 3.80, WORLD, None),
    # H · ECHO — across the Meeting Floor; four seats paired across the table; the meeting starts
    ("H1", "T2Party4E", PE["walk"] + 0.40, PE["walk"] + 3.60, WORLD, None),
    ("H2", "T2Party4E", PE["arrive"] + 3.60, PE["arrive"] + 6.80, WORLD, 0.30),
    ("H3", "T2Party4E", PE["seats"] + 2.40, PE["start"] + 3.40, WORLD, None),
    # I · MEETING MEMORY — "Because a meeting may end… but its best ideas shouldn't."
    ("I1", "T2Memory", MEM["memory"] - 0.20, MEM["scroll"] + 1.20, UI, 0.30),
    ("I2", "T2Memory", MEM["question"] - 0.10, MEM["end"], UI, None),
    # J · LEAVING — down in the lift; "Leaving?" → Go to the AI Lab → out the door
    ("J1", "T2Down", 21.60, 24.60, WORLD, 0.30),
    ("J2", "T2Exit", EXI["walk"] + 0.20, EXI["out"] + 4.30, WORLD, None),
    # K · BEYOND THE WALLS (music) — traffic and the kalesa, the company lot, the crew, a scooter, the rewards
    ("K1", "T2Traffic", 0.80, 5.40, WORLD, None), ("K2", "T2Street", 9.40, 12.90, WORLD, None),
    ("K3", "T2Street", 13.70, 17.30, WORLD, None),
    ("K4", "T2Scooter", SCO["mount"] + 0.20, SCO["hud"] + 0.40, WORLD, None),
    ("K5", "T2UI", 27.40, 29.10, UI, None), ("K6", "T2UI", 31.00, 32.50, UI, None),
    # L · THE WORLD AROUND US — Settings (whole), then the one continuous 360° orbit: day → sunset → night → rain
    ("L1", "T2UI", 35.50, 36.70, UI, None), ("L2", "T2UI", 37.10, 37.90, UI, None), ("L3", "T2UI", 39.40, 40.20, UI, None),
    ("L4", "T2UI", 40.50, 41.60, UI, None),
    ("L5", "T2Orbit", ORB["orbit"] + 0.02, ORB["orbit"] + 12.62, WORLD, 0.35),
    # THE WORKDAY CLOSE — night: "Leaving?" → Check Out → wrap up → the log → checked out → out into the night
    ("Z1", "T2Close", CLO["walk"] + 0.30, CLO["start"] + 0.10, NIGHT, 0.40),
    ("Z2", "T2Close", CLO["log"] + 0.60, CLO["log"] + 1.90, UI, None),
    ("Z3", "T2Close", CLO["submit"] + 1.30, CLO["done"] + 0.10, UI, None),
    ("Z4", "T2Close", CLO["walk-out"] + 0.60, CLO["walk-out"] + 3.80, NIGHT, None),
    # M · CAVE — "We may be miles apart… but some moments bring us all together."
    ("C1", "T2Cave", CAV["go"] - 0.10, CAV["look"] + 3.00, WORLD, 0.40),
    # N · TOUCAN — the bird comes when called; Bon turns to it; "What did I miss?"
    ("T1", "T2Toucan2", TOU["call"] + 0.40, TOU["face"] + 0.80, WORLD, 0.30),
    ("T2", "T2Toucan2", TOU["ask"] + 0.60, TOU["ask"] + 6.20, UI, None),
    # O · AI LAB · SCRIPTED PREVIEW — the request face to face, takeoff, the flight, the Lab, the work, Approve
    ("U1", "T2Lab4a", L4A["face"] - 0.70, L4A["liftoff"] + 0.20, UI, 0.30),
    ("SA", "T2Lab4a", L4A["A"] + 0.05, L4A["A"] + 1.60, WORLD, None),
    ("SB", "T2Lab4a", L4A["B"] + 0.10, L4A["C"], WORLD, None),
    ("SC", "T2Lab4a", L4A["C"], L4A["C2"], WORLD, None), ("SC2", "T2Lab4a", L4A["C2"], L4A["C2"] + 1.40, WORLD, None),
    ("D1L", "T2Lab3b", L3B["D-milo"] + 0.05, L3B["D-milo"] + 1.45, WORLD, None),
    ("D2L", "T2Lab3b", L3B["D-nova"] + 0.05, L3B["D-nova"] + 1.45, WORLD, None),
    ("D3L", "T2Lab3b", L3B["D-pip"] + 0.05, L3B["D-pip"] + 1.45, WORLD, None),
    ("BR", "T2Lab3b", L3B["brief"] + 0.05, L3B["brief"] + 1.35, WORLD, None),
    ("W1", "T2Lab3c", 0.70, 2.30, WORLD, None), ("W2", "T2Lab3d", 0.70, 2.00, WORLD, None),
    ("W3", "T2Lab3e", L3E["milo-has"] - 0.90, L3E["milo-has"] + 0.70, WORLD, None), ("W4", "T2Lab3f", 0.80, 2.30, WORLD, None),
    ("W5", "T2Lab3g", L3G["pip-has"] - 0.90, L3G["pip-has"] + 0.60, WORLD, None), ("W6", "T2Lab3h", 0.70, 2.30, WORLD, None),
    ("W7", "T2Lab3i", 0.80, 2.20, WORLD, None),
    ("Y1", "T2Lab3j", L3J["delivered"] - 0.30, L3J["delivered"] + 1.90, UI, 0.30),
    ("Y2", "T2Lab3j", L3J["result"] - 0.10, L3J["approved"] + 1.20, UI, None),
    # P · FINALE — the office from the air → the logo
    ("FIN", "T2Rooms", 0.72, 3.68, WORLD, 0.40),
]
CARD = 6.0

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
LAYOUT, PIC_END = lay(SEGS, 0.0)
END = PIC_END + CARD
S = {s[0]: (st, d, s) for s, st, d in LAYOUT}
at = lambda k, take_t: S[k][0] + (take_t - S[k][2][2])
start = lambda k: S[k][0]
endof = lambda k: S[k][0] + S[k][1]
ALIVE = at("A1", 2.367); EXP = at("X1", 4.200)
LIFTOFF = at("U1", L4A["liftoff"]); REVEAL = endof("SC")
APPROVE = at("Y2", L3J["approved"]); DELIVERED = at("Y1", L3J["delivered"])
SUNSET, NIGHTT, RAIN = at("L5", ORB["sunset"]), at("L5", ORB["night"]), at("L5", ORB["rain"])
DOORS02 = start("G7"); CAVE_IN = at("C1", CAV["enter"]) + 1.0

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
SCR = [  # (file key, wished onset, caption) — scratch voice; a global pass below forbids any overlap
    ("E1", start("E1") + 0.45, "Because the heart of a workplace was never the space…"),
    ("E2", None, "It was always the people."),
    ("G1", start("G1") + 0.40, "And some ideas deserve more than a conversation."),
    ("I1", start("I1") + 0.50, "Because a meeting may end…"),
    ("I2", None, "but its best ideas shouldn’t."),
    ("J1", start("J2") + 0.20, "And why should possibility stop at the office door?"),
    ("L0", start("L5") + 0.50, "And what if your workplace could change… with the world around you?"),
    ("M1", start("C1") + 0.45, "We may be miles apart…"),
    ("M2", None, "but some moments bring us all together."),
    ("N1", start("U1") + 0.40, "But what if an idea didn’t have to wait…"),
    ("N2", LIFTOFF - 0.30, "…for someone to bring it to life?"),
    ("N3", start("SB") - 0.40, "What if the next chapter of work…"),
    ("N4", "reveal", "…was already taking shape?"),
    ("P1", start("FIN") + 0.25, "Because the future of work isn’t just about where we are…"),
    ("P2", None, "…it’s about what we can create."),
]
GAP = {"E2": 0.35, "I2": 0.30, "M2": 0.30, "P2": 0.50}
LINES, prev_end = [], 0.0
for k, wish, cap in SCR:
    d = dur(os.path.join(SVO, f"{k}.wav"))
    if wish == "reveal": wish = max(REVEAL - d + 0.15, prev_end + 0.25)        # "shape?" lands on the reveal
    t = (prev_end + GAP.get(k, 0.3)) if wish is None else max(wish, prev_end + 0.25)   # NEVER over the line before
    LINES.append((k, t, d, cap)); prev_end = t + d
CREATE = [t for k, t, d, c in LINES if k == "P2"][0] + 1.25
END = max(END, CREATE + 4.8)

M = os.path.join(AUD, "music.mp3")
def drive(t0, t1, peak_at=None, gain=0.46, fi=0.6, fo=0.8):   # the drive (music 12→36); its 36.0 peak lands on peak_at
    d = t1 - t0
    if peak_at is not None: a = 36.0 - (peak_at - t0)
    else: a = 12.0
    a = max(12.0, min(a, 36.4 - d)); return (a, a + d, t0, gain, fi, fo)
def build(t0, t1, hit_at=None, gain=0.36, fi=1.0, fo=0.8):     # the build (music 0→12); its 12.0 hit lands on hit_at
    d = t1 - t0; a = 12.0 - ((hit_at if hit_at is not None else t1) - t0)
    a = max(0.0, a); return (a, a + d, t0, gain, fi, fo)
def swell(hit_at, tail=5.0, gain=0.60, fo=1.2):                  # the swell (music 41.45→); its 45.0 hit lands on hit_at
    t0 = hit_at - 3.55; return (41.45, 45.0 + tail, t0, gain, 0.0, fo)
MUSIC = [
    build(0.0, ALIVE, ALIVE, 0.42, 1.2, 0.0),                     # the opening build: its hit ON "alive"
    (12.0, 12.0 + (EXP - 2.5 - ALIVE), ALIVE, 0.48, 0.0, 0.6),   # the room montage drive
    (41.45, 45.8, EXP - 3.55, 0.62, 0.0, 0.6),                    # the dropout swells back: its hit ON "experience"
    drive(EXP + 0.6, start("E1") + 0.6, start("E1"), 0.50, 0.4, 1.0),   # the tool drive; its peak at the turn to the people
    build(start("E1"), start("F1") + 0.3, start("F1"), 0.30, 1.4, 0.4),  # the people: warm and sparse; a lift into…
    drive(start("F1"), DOORS02 - 11.2, None, 0.44, 0.0, 1.2),           # …the drive: call, board, map — carrying into Go Together
    build(DOORS02 - 12.0, DOORS02 + 0.2, DOORS02, 0.36, 1.2, 0.0),      # Go Together builds; its hit ON the doors opening (02)
    drive(DOORS02, start("I1") + 0.6, start("I1"), 0.46, 0.0, 1.2),     # the Meeting Floor → Echo
    (49.0, 49.0 + (start("K1") - 12.0 - start("I1") + 0.8), start("I1"), 0.26, 1.4, 1.2),   # Memory: a sparse bed (the cue's settle)
    build(start("K1") - 12.0, start("K1") + 0.2, start("K1"), 0.32, 1.2, 0.0),  # out of the office: the build; its hit ON the street
    drive(start("K1"), start("L5") + 0.4, start("L5") - 0.3, 0.48, 0.0, 1.0),   # beyond the walls; its peak into the orbit
    swell(SUNSET, tail=(start("Z1") - SUNSET) + 0.6, gain=0.58, fo=1.6),        # the orbit: the swell ON sunset, carrying the night
    (56.0, 64.0, start("Z1") - 0.2, 0.30, 0.8, 1.6),                    # the workday closes: the cue's settle
    swell(CAVE_IN, tail=4.0, gain=0.62, fo=1.4),                        # the CAVE: the biggest swell before the finale
    (49.0, 49.0 + (REVEAL - 12.0 - start("T1") + 0.8), start("T1"), 0.28, 1.0, 1.2),   # Toucan: a quiet bed
    build(REVEAL - 12.0, REVEAL + 0.1, REVEAL, 0.40, 1.2, 0.0),         # the questions build; the hit ON the Lab reveal
    (36.0 - (APPROVE - REVEAL), 37.5, REVEAL, 0.47, 0.0, 1.2),          # the Lab at work, re-timed so 36.0 = Approve
    swell(CREATE, tail=4.0, gain=0.62, fo=1.5),                         # the final swell: its hit ON "create"
]
CUTS_M = [start(k) for k in ("M0", "M1", "M2", "M3", "M4", "M5", "M6")]
CUTS_D = [start(k) for k in ("D1", "D2", "D3", "D5", "D6", "D7", "D9")]
CUTS_K = [start(k) for k in ("K2", "K3", "K4", "K5")]
CUTS_O = [start(k) for k in ("D1L", "D2L", "D3L", "BR", "W1", "W2", "W3", "W4", "W5", "W6", "W7")]
SFX = [  # (file, t, gain[, len, fade_in, fade_out, extra])
    ("office.mp3", 0.0, 0.10, ALIVE + 0.5, 0.6, 0.6), ("deny.mp3", at("O1", 7.75), 0.5),
    ("click1.mp3", at("O2", 17.42), 0.42), ("confirm.mp3", at("O2", 17.72), 0.45), ("click2.mp3", at("O3", 23.6), 0.35),
    ("riser.mp3", ALIVE - 2.0, 0.42), ("impact.mp3", ALIVE, 0.45),
    *[(("hit1.mp3" if i % 2 == 0 else "hit2.mp3"), t, 0.20 + 0.02 * i) for i, t in enumerate(CUTS_M)],
    ("office.mp3", EXP - 1.9, 0.10, 1.95, 0.8, 0.12, "lowpass=f=450"), ("office.mp3", EXP - 0.05, 0.16, 3.4, 0.12, 0.8),
    ("run.mp3", at("X1", 4.48), 0.16, 0.6, 0.1, 0.1), ("run.mp3", at("X1", 5.03), 0.30, 1.9, 0.0, 0.5), ("jump.mp3", at("X1", 6.18), 0.5),
    *[(("hit2.mp3" if i % 2 == 0 else "hit1.mp3"), t, 0.20) for i, t in enumerate(CUTS_D)],
    ("click1.mp3", at("D1", TL["hub-open"] + 0.12), 0.2), ("click2.mp3", at("D5", TL["search-open"] + 0.1), 0.2),
    ("click1.mp3", at("D7", TL["missions"] + 0.05), 0.2), ("confirm.mp3", start("D8") + 0.9, 0.22),
    ("office.mp3", start("E1"), 0.12, start("F1") - start("E1"), 0.6, 0.6),
    ("notif.mp3", start("E4") + 0.4, 0.16),
    ("click1.mp3", start("G1") + 0.5, 0.25), ("click2.mp3", start("G2") + 0.6, 0.25), ("confirm.mp3", start("G3") + 0.45, 0.30),
    ("office.mp3", start("G3"), 0.12, start("G6") - start("G3"), 0.6, 0.6),
    ("elevator.mp3", start("G6") - 0.4, 0.30, 3.2, 0.3, 0.8), ("ding.mp3", DOORS02 - 0.15, 0.42),
    ("office.mp3", start("H1"), 0.10, start("I1") - start("H1"), 0.6, 0.6), ("click1.mp3", at("H3", PE["start"]) + 0.05, 0.25),
    ("click2.mp3", at("I1", MEM["session"]), 0.2), ("click1.mp3", at("I2", MEM["question"] + 2.9), 0.2),
    ("elevator.mp3", start("J1"), 0.22, S["J1"][1], 0.3, 0.6), ("click1.mp3", at("J2", EXI["ai-lab"]) + 0.05, 0.3),
    ("office.mp3", start("J2"), 0.10, S["J2"][1], 0.4, 0.4),
    *[(("hit1.mp3" if i % 2 == 0 else "hit2.mp3"), t, 0.18) for i, t in enumerate(CUTS_K)],
    ("run.mp3", at("K4", SCO["boost"]), 0.14, 2.0, 0.2, 0.6),
    ("hit2.mp3", SUNSET, 0.30), ("impact.mp3", NIGHTT, 0.30), ("hit1.mp3", RAIN, 0.34),     # the orbit's three accents
    ("click1.mp3", at("Z1", CLO["checkout"]) + 0.05, 0.28), ("click2.mp3", at("Z1", CLO["start"]) - 0.1, 0.22),
    ("confirm.mp3", start("Z3") + 0.15, 0.30),
    ("cave.mp3", at("C1", CAV["enter"]), 0.32, 6.0, 0.5, 1.5),
    ("click1.mp3", at("T1", TOU["call"]) + 0.05, 0.25), ("notif.mp3", at("T2", TOU["ask"] + 3.4), 0.22),
    ("click1.mp3", at("U1", L4A["request"]), 0.42),
    *[(("hit1.mp3" if i % 2 == 0 else "hit2.mp3"), t, 0.18) for i, t in enumerate(CUTS_O)],
    ("notif.mp3", DELIVERED, 0.30), ("click2.mp3", at("Y2", L3J["result"]) - 0.05, 0.22), ("confirm.mp3", APPROVE, 0.42),
]

def ts(x): x = max(0.0, x); return f"{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}"
def mmss(x): return f"{int(x // 60)}:{x % 60:04.1f}"

if __name__ == "__main__":
    for s in SEGS: render(s)
    print("segments", len(SEGS), flush=True)

    ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 2", "", "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Sub,Helvetica Neue Medium,47,&H00F6F6F6,&H00FFFFFF,&H78000000,&H88000000,0,0,0,0,100,100,1.2,0,1,1.6,1.8,2,170,170,150,1",
        "Style: Tag,Helvetica Neue,21,&H40FFFFFF,&H00FFFFFF,&H90000000,&H90000000,0,0,0,0,100,100,1,0,1,1.2,0,7,36,36,30,1",
        "Style: Scratch,Helvetica Neue Medium,22,&H2066E0FF,&H00FFFFFF,&H90000000,&H90000000,0,0,0,0,100,100,2,0,1,1.4,0,9,36,36,30,1",
        "Style: Lab,Helvetica Neue Medium,25,&H18FFFFFF,&H00FFFFFF,&H70000000,&H80000000,0,0,0,0,100,100,5,0,1,1.4,1.2,1,64,64,58,1",
        "Style: CardSub,Helvetica Neue Medium,28,&H00BEBEBE,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,16,0,1,0,0,5,0,0,0,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    vo, script = [], []
    for k, (a, b, o, cap) in TAKE.items():
        place = ONSET[k] - (o - a); vo.append((TK, a, b, place)); script.append((ONSET[k], ONSET[k] + (b - o), "teaser-1 take", cap))
        if k == "L2":
            mid = ONSET[k] + 1.62
            ass.append(f"Dialogue: 0,{ts(ONSET[k] - 0.02)},{ts(mid)},Sub,,0,0,0,,{{\\fad(180,120)\\blur2}}But somewhere along the way,")
            ass.append(f"Dialogue: 0,{ts(mid)},{ts(place + b - a + 0.15)},Sub,,0,0,0,,{{\\fad(120,240)\\blur2}}we lost some of the little things that made an office feel…")
            continue
        ass.append(f"Dialogue: 0,{ts(ONSET[k] - 0.02)},{ts(place + b - a + 0.15)},Sub,,0,0,0,,{{\\fad(180,240)\\blur2}}{cap}")
    for k, t, d, cap in LINES:
        p = os.path.join(SVO, f"{k}.wav"); vo.append((p, 0.0, d, t)); script.append((t, t + d, "scratch (local voice)", cap))
        ass.append(f"Dialogue: 0,{ts(t - 0.02)},{ts(t + d + 0.2)},Sub,,0,0,0,,{{\\fad(180,240)\\blur2}}{cap}")
        ass.append(f"Dialogue: 2,{ts(t - 0.1)},{ts(t + d + 0.3)},Scratch,,0,0,0,,{{\\fad(150,150)}}SCRATCH VO · local voice · timing only")
    ass.append(f"Dialogue: 1,{ts(0.5)},{ts(PIC_END - 0.3)},Tag,,0,0,0,,{{\\fad(400,300)}}TEASER 2 · COMPLETE REVIEW CUT · temp score · scratch VO")
    ass.append(f"Dialogue: 1,{ts(start('U1') + 0.3)},{ts(endof('Y2') - 0.1)},Lab,,0,0,0,,{{\\fad(500,400)}}AI LAB  ·  SCRIPTED PREVIEW")
    card_in = CREATE - 0.35; card_out = END - 0.75
    ass.append(f"Dialogue: 1,{ts(card_in + 0.35)},{ts(card_out)},CardSub,,0,0,0,,{{\\fad(900,700)\\pos(960,640)}}VIRTUAL OFFICE")
    subs = os.path.join(WORK, "full-subs.ass"); open(subs, "w").write("\n".join(ass) + "\n")

    # ---- the mix
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
        fades = (f",afade=t=in:d={fi}" if fi else "") + (f",afade=t=out:st={max(0, d - fo):.3f}:d={fo}" if fo else "")
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
    mix = os.path.join(WORK, "full-mix.wav")
    run(*ins, "-filter_complex", ";".join(fl), "-map", "[a]", "-c:a", "pcm_s16le", mix); print("mix", flush=True)

    # ---- the picture, in chunks (a dissolve inside a chunk; chunk joins are straight cuts)
    def assemble(items, name, fade_in, fade_out):
        vin, ch, last, runlen = [], [], None, 0.0
        for j, (s, st, d) in enumerate(items):
            vin += ["-threads", "2", "-i", seg_file(s[0])]; n = frames(s[2], s[3])
            ch.append(f"[{j}:v]settb=1/{FPS},setpts=N,trim=end_frame={n},tpad=stop_mode=clone:stop=3,trim=end_frame={n},setpts=N,format=yuv420p[v{j}]")
            if j == 0:
                last = f"[v{j}]"; runlen = d
                if fade_in: ch.append(f"{last}fade=t=in:st=0:d={fade_in}[f0]"); last = "[f0]"
                continue
            if s[5]: ch.append(f"{last}[v{j}]xfade=transition=fade:duration={s[5]}:offset={runlen - s[5]:.4f},settb=1/{FPS},setpts=N[c{j}]"); runlen += d - s[5]
            else: ch.append(f"{last}[v{j}]concat=n=2:v=1:a=0,settb=1/{FPS},setpts=N[c{j}]"); runlen += d
            last = f"[c{j}]"
        if fade_out: ch.append(f"{last}fade=t=out:st={runlen - fade_out:.3f}:d={fade_out}[o]"); last = "[o]"
        out = os.path.join(WORK, f"{name}.mp4")
        run(*vin, "-filter_complex", ";".join(ch), "-map", last, "-c:v", "libx264", "-preset", "veryfast", "-crf", "15", "-r", str(FPS), out)
        return out, runlen
    # chunk boundaries fall on straight cuts only
    chunks, cur = [], []
    for item in LAYOUT:
        if cur and len(cur) >= 16 and not item[0][5]: chunks.append(cur); cur = []
        cur.append(item)
    chunks.append(cur)
    parts, total = [], 0.0
    for i, c in enumerate(chunks):
        p, ln = assemble(c, f"chunk{i}", 0.6 if i == 0 else 0, 0.5 if i == len(chunks) - 1 else 0)
        parts.append(p); total += ln; print("chunk", i, len(c), round(ln, 2), flush=True)
    lst = os.path.join(WORK, "chunks.txt"); open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
    pic = os.path.join(WORK, "picture.mp4"); run("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", pic)

    tc = "fontfile=/System/Library/Fonts/HelveticaNeue.ttc:fontsize=21:fontcolor=white@0.55:x=36:y=58"
    ch = [f"color=c=black:s=1920x1080:r={FPS}:d={END - PIC_END:.3f},format=yuv420p[CD]",
          "[0:v]settb=1/30,setpts=N[p0]", "[p0][CD]concat=n=2:v=1:a=0,settb=1/30,setpts=N[pic]",
          f"[1:v]scale=700:-1:flags=lanczos,format=rgba,fade=t=in:st={card_in:.3f}:d=0.9:alpha=1,fade=t=out:st={card_out - 0.7:.3f}:d=0.7:alpha=1[logo]",
          f"[pic]subtitles='{subs}':fontsdir=/System/Library/Fonts,"
          f"drawtext={tc}:text='TC %{{pts\\:hms}}':enable='between(t,0.5,{PIC_END - 0.3:.3f})'[base]",
          "[base][logo]overlay=(W-w)/2:422:eof_action=pass,format=yuv420p[vout]"]
    out = os.path.join(OUT, f"{NAME}.mp4")
    run("-i", pic, "-loop", "1", "-t", f"{END:.3f}", "-i", LOGO, "-i", mix, "-filter_complex", ";".join(ch),
        "-map", "[vout]", "-map", "2:a", "-t", f"{END:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", out)
    tl = dict(END=END, PIC_END=PIC_END, ALIVE=ALIVE, EXP=EXP, DOORS02=DOORS02, SUNSET=SUNSET, NIGHT=NIGHTT, RAIN=RAIN, CAVE_IN=CAVE_IN,
              LIFTOFF=LIFTOFF, REVEAL=REVEAL, DELIVERED=DELIVERED, APPROVE=APPROVE, CREATE=CREATE,
              script=[dict(start=round(a, 2), end=round(b, 2), voice=v, text=c) for a, b, v, c in sorted(script)],
              segments=[dict(key=s[0], take=s[1], src=[round(s[2], 2), round(s[3], 2)], start=round(st, 2), dur=round(d, 2)) for s, st, d in LAYOUT],
              music=[dict(src=[round(a, 2), round(b, 2)], at=round(t, 2), gain=g) for a, b, t, g, fi, fo in MUSIC])
    json.dump(tl, open(os.path.join(OUT, f"{NAME}.timeline.json"), "w"), indent=1)
    print(json.dumps({k: round(v, 2) for k, v in tl.items() if isinstance(v, float)}))
    print(out)
