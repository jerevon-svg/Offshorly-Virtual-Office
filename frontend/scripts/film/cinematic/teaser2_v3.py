#!/usr/bin/env python3
"""FILM RIG ONLY — Offshorly VO TEASER 2 · DIRECTOR'S REVISION (one day at Offshorly, ~3:35, locked to one score).

Picture: real-engine takes only (out/cinematic/takes_t2). Sound: ONE narrator (Liam Hayes, Magnific/ElevenLabs v3), ONE
continuous orchestral score composed for this structure (Magnific/ElevenLabs music), six generated effects + the owned
teaser-1 effect library. Every segment is placed from a score-locked START-TIME TABLE (film time = score time), so the anchors
(alive, experience, the beat-grid montage, the doors, the orbit, the takeoff, the reveal, Approve) land exactly. The one
music edit: the score's final chord (attack at 204.40) is moved to the cut to black, so the day resolves on the logo.

  FILM_FFMPEG=… python3 teaser2_v3.py <takes_t2> <audio_v3> <work_dir> <out_dir>
"""
import json, os, re, subprocess, sys

FF = os.environ["FILM_FFMPEG"]
TAKES, AV3, WORK, OUT = (os.path.abspath(p) for p in sys.argv[1:5])
os.makedirs(WORK, exist_ok=True); os.makedirs(OUT, exist_ok=True)
FILM = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
AUD = os.path.join(FILM, "out/teaser/audio"); LOGO = os.path.join(FILM, "out/final/offshorly-logo-reversed.png")
FPS = 30
NAME = "offshorly-vo-teaser2_directors-cut"
# FINAL=1 → the clean master: the same picture without the review tag and the running timecode, and the approved cut's
# audio stream copied bit-for-bit (no re-mix). Narration captions and the disclosure labels stay.
FINAL = os.environ.get("FINAL") == "1"
APPROVED = os.path.join(OUT, f"{NAME}.mp4")
if FINAL: NAME = "offshorly-vo-teaser2-final"
run = lambda *a: subprocess.run([FF, "-nostdin", "-y", "-hide_banner", "-loglevel", "error", *a], check=True)

def marks(take):
    d = json.load(open(os.path.join(TAKES, f"{take}.json"))); t0 = (d.get("clip") or {}).get("t0") or 0
    out = {}
    for x in (d.get("ran") if isinstance(d.get("ran"), list) else []):
        if isinstance(x, dict) and "t" in x: out.setdefault(x["what"], x["t"] - t0)
    return out
TL, MEM, EXI, L4A, L3J = (marks(k) for k in ("T2Tools", "T2Memory", "T2Exit", "T2Lab4a", "T2Lab3j"))
ORB, PB = marks("T2Orbit"), marks("T2Party4B_r6")

WORLD = "eq=contrast=1.05:saturation=1.06,colorbalance=rh=0.016:bh=-0.01,vignette=a=PI/6.5"
UI = "eq=contrast=1.02"
WARM = "eq=contrast=1.04:saturation=1.05,vignette=a=PI/6"
PUNCH_TALK = "crop=1440:810:0:0,scale=1920:1080:flags=lanczos"        # Bon ↔ Micah and both chat bubbles, readable
PUNCH_TOUCAN = "crop=1280:720:640:300,scale=1920:1080:flags=lanczos"  # the toucan, Bon and the catch-up answer
# After Stop sharing the product shows Echo's idle screen, but the film-only slide overlay (teaser2.mjs T2Present) re-asserted
# itself 150 ms later. The camera is locked off from 9.6 s and nothing crosses the TV, so the TV area (bezel included) is
# replaced by the product's own frame one tick after the stop (10.083 s). Nothing else in the frame is touched.
IDLE_TV = {"patch": {"t": 10.083, "box": (352, 392, 524, 312)}}
BEAT, B0 = 0.8115, 25.97                                  # the score's beat grid (73.9 BPM), anchored on its strong onset
beat = lambda n: B0 + n * BEAT
OUTB = lambda n: 116.77 + n * 1.621                       # the outdoor phrase: two-beat units from the doors' re-entry
# THE START-TIME TABLE: (key, take, source-in, film-start, grade, dissolve-in[, extra filter]). A segment runs to the next start.
T = [
    # A · MORNING — Office View: the lane, refused at the gate, the kiosk check-in, through the gates, the office
    ("O1", "T2Opening", 2.00, 0.00, WORLD, None), ("O2", "T2Opening", 14.60, 6.50, WORLD, 0.25),
    ("O3", "T2Opening", 23.00, 9.15, WORLD, 0.25), ("O4", "T2Opening", 32.40, 11.00, WORLD, 0.30),
    # B · "alive." = the real Office→3D switch ON the score's first bloom; the rooms on the beat, accelerating
    ("A1", "T2Alive", 2.167, 12.70, WORLD, None),
    ("M0", "T2Rooms", 1.20, beat(-14), WORLD, None), ("M1", "T2Rooms", 4.30, beat(-12), WORLD, None),
    ("M2", "T2Rooms", 7.40, beat(-10), WORLD, None), ("M3", "T2Rooms", 10.40, beat(-8), WORLD, None),
    ("M4", "T2Rooms", 13.60, beat(-7), WORLD, None), ("M5", "T2Rooms", 16.60, beat(-6), WORLD, None),
    ("M6", "T2Rooms", 21.60, beat(-5), WORLD, None),   # the Central Hub
    # C · "you experience." = the real 3D→Player switch ON the strong onset (25.97)
    ("X1", "T2Experience", 1.60, 23.37, WORLD, 0.40),
    # D · TOOLS — on the beat: two beats per tool, single-beat flashes as it accelerates
    ("T01", "T2Tools", TL["hub-open"] - 0.08, beat(4), UI, None), ("T02", "T2Hub", 18.80, beat(6), UI, None),
    ("T03", "T2UI", 3.05, beat(8), UI, None), ("T03b", "T2UI", 4.85, beat(9), UI, None),       # feed · achievements (never the legacy "Your character" tab)
    ("T04", "T2Tools", TL["search-open"] - 0.05, beat(10), UI, None), ("T05", "T2UI", 11.60, beat(12), UI, None),
    ("T06", "T2Tools", 12.60, beat(13), UI, None), ("T07", "HumTasks", 2.95, beat(15), UI, None),  # quests → missions · claim
    ("T08", "T2UI", 18.40, beat(16), UI, None), ("T09", "T2UI", 29.00, beat(17), UI, None),      # notifications · rewards
    ("T10", "T2UI", 35.75, beat(19), UI, None), ("T11", "T2UI", 37.30, beat(20), UI, None),      # settings: open the 3D office in · controls
    ("T12", "T2UI", 38.40, beat(21), UI, None),                                                   # · audio
    # E · PEOPLE — "how close can we feel… when we're miles apart?": Bon joins Micah and Angelo; a chat
    ("E0", "T2Talk", 0.70, beat(22), WORLD, None), ("E1", "T2Talk", 2.90, 45.02, WORLD, None),
    ("E2", "T2Talk", 10.60, 51.92, WORLD, None, PUNCH_TALK),
    # (the teaser-1 video-call take is out: the whole take stands the cast by the gate sensors under a dawn sky — the staging
    #  this revision replaces — and a daytime recapture would need a live webcam; webcams are never fabricated)
    # F · IDEAS — "every idea… finding its people, in one shared space": the boards list, a live board, the team map
    ("F0", "FeatBoards", 2.30, 55.20, UI, 0.30), ("F1", "FeatBoards", 6.00, 56.40, UI, None),
    ("F2", "Map", 4.60, 61.60, UI, None, "tpad=stop_mode=clone:stop_duration=2"),   # tiles fill in, then hold the loaded map (static UI; the take ends at 6.43)
    # G · GO TOGETHER × 4 — "shouldn't that be as simple as walking there?" — the party sets off ON the score's re-entry
    ("G1", "T2Party4A_r6", 5.00, 64.48, UI, None), ("G2", "T2Party4B_r6", 1.50, 66.40, UI, None),
    ("G3", "T2Party4B_r6", 6.20, 68.13, WORLD, None), ("G4", "T2Party4C", 1.12, 72.80, WORLD, None),
    ("G5", "T2Party4D_r6", 2.79, 79.00, WORLD, None), ("G6", "T2Party4D_r6", 19.65, 84.50, WORLD, None),
    ("G7", "T2Party4D_r6", 22.55, 87.10, WORLD, None),
    # H · THE MEETING — across the Meeting Floor into Echo; seated; Start meeting; Bon presents (real share, placeholder slide)
    ("H1", "T2Party4E_r6", 1.11, 90.60, WORLD, None), ("H2", "T2Party4E_r6", 11.75, 93.20, WORLD, 0.30),
    ("H3", "T2Party4E_r6", 17.10, 95.60, WORLD, None), ("H4", "T2Present", 2.20, 99.40, WORLD, None),
    ("H5", "T2Present", 10.10, 104.50, WORLD, 0.30, IDLE_TV),                                     # Stop sharing → back to his seat
    # I · MEETING MEMORY — "and when the meeting ends… what happens to everything that mattered?"
    ("I1", "T2Memory", 4.60, 106.40, UI, 0.30), ("I2", "T2Memory", 11.11, 110.30, UI, None),
    # J · "why should possibility stop at the office door?" — the doors open ON the score's re-entry (116.77)
    ("J1", "T2Exit", 2.40, 115.07, WORLD, None),
    # K · OUT — the street, the lot, the crew, then the scooter from the dock up the east walk to the Lab lawn
    ("K1", "T2Traffic", 0.80, OUTB(2), WORLD, None), ("K2", "T2Street", 9.70, OUTB(5), WORLD, None),
    ("K3", "T2Street", 13.80, OUTB(6.5), WORLD, None), ("K4", "T2Scoot2", 1.00, OUTB(8), WORLD, None),
    ("K5", "T2Scoot2", 21.45, OUTB(12), WORLD, None),
    # L · THE WORLD AROUND YOU — Settings → Environment, the 360° orbit (day → sunset → night → rain), the seasons
    ("L1", "T2UI", 39.17, OUTB(14.5), UI, None),
    ("L2", "T2Orbit", ORB["orbit"] + 0.02, 142.71, WORLD, 0.35),
    ("L3", "T2SeasonH", 2.20, 155.31, WORLD, 0.40), ("L4", "T2SeasonC", 15.60, 157.20, WORLD, 0.40),
    # M · CAVE — "some moments are bigger than any one room…"
    ("C0", "T2Cave", 0.35, 159.40, WORLD, 0.30), ("C1", "T2Cave", 2.80, 160.55, WORLD, None),
    ("C2", "T2Cave", 7.00, 162.80, WORLD, 0.25),
    # N · TOUCAN — it comes when called; "What did I miss?"; the answer
    ("N1", "T2Toucan2", 1.40, 165.00, WORLD, 0.30), ("N2", "T2Toucan2", 9.20, 170.00, WORLD, None, PUNCH_TOUCAN),
    # O · AI LAB · SCRIPTED PREVIEW — the ask, takeoff, the flight (the statue pass that clipped is cut), the monkeys, Approve
    ("U1", "T2Lab4a", 1.20, 171.90, UI, None), ("SA", "T2Lab4a", 7.45, 177.60, WORLD, None),
    ("SC", "T2Lab4a", 11.62, 179.65, WORLD, None),
    ("D1L", "T2Lab3b", 1.12, 184.40, WORLD, None), ("D2L", "T2Lab3b", 3.42, 185.30, WORLD, None),
    ("D3L", "T2Lab3b", 6.07, 186.20, WORLD, None), ("BR", "T2Lab3b", 8.67, 187.10, WORLD, None),
    ("W1", "T2Lab3c", 0.90, 188.10, WORLD, None), ("W3", "T2Lab3e", 1.95, 188.90, WORLD, None),
    ("W4", "T2Lab3f", 1.00, 189.70, WORLD, None), ("W6", "T2Lab3h", 1.00, 190.50, WORLD, None),
    ("Y1", "T2Lab3j", L3J["delivered"] - 0.30, 191.36, UI, None), ("Y2", "T2Lab3j", L3J["result"] - 0.10, 193.20, UI, None),
    # Z · THE END OF THE DAY — sunset: Check Out → today's log → checked out → out through the doors → black → the logo
    ("Z1", "T2End", 0.90, 199.00, WARM, 0.80), ("Z2", "T2End", 9.40, 202.20, UI, None),
    ("Z3", "T2End", 14.30, 203.90, UI, None), ("Z4", "T2End", 19.00, 207.10, WARM, None),
]
PIC_END = 211.20                                          # hard cut to black
CHORD = PIC_END                                           # the score's final chord strikes on the black
END = 215.40
f_ = lambda t: int(round(t * FPS))
SEGS = []   # (key, take, src_in, frames, grade, dissolve_frames, extra)
for i, e in enumerate(T):
    k, take, a, st, grade, ov = e[:6]; extra = e[6] if len(e) > 6 else None
    nxt = T[i + 1][3] if i + 1 < len(T) else PIC_END
    nov = (T[i + 1][5] or 0.0) if i + 1 < len(T) else 0.0
    SEGS.append((k, take, a, f_(nxt) - f_(st) + f_(nov), grade, f_(ov or 0.0), extra))
START = {e[0]: e[3] for e in T}
import hashlib
SRC = {e[0]: e[2] for e in T}
at = lambda k, src_t: START[k] + (src_t - SRC[k])
ALIVE, EXP = at("A1", 2.367), at("X1", 4.200)
DOORS02 = START["G7"]; DOOR_OUT = at("J1", EXI["ai-lab"] + 0.50)
SUNSET, NIGHTT, RAIN = at("L2", ORB["sunset"]), at("L2", ORB["night"]), at("L2", ORB["rain"])
LIFTOFF = at("U1", L4A["liftoff"]); REVEAL = START["D1L"]; DELIVERED = at("Y1", L3J["delivered"]); APPROVE = at("Y2", L3J["approved"])

# ONE NARRATOR — the measured clips (audio_v3/V*.wav) at their moments; any overlap stops the build
VO = [
    ("V01", 2.00, "Remote work gave us freedom."),
    ("V02a", 6.50, "But somewhere along the way, we lost some of the little things that made an office feel…"),
    ("V02b", ALIVE - 0.05, "alive."),
    ("V03", 15.20, "But a workplace isn’t something you just look at."),
    ("V04a", 23.90, "It’s something…"),
    ("V04b", EXP - 0.35, "you experience."),
    ("V05", 44.20, "So how close can we feel… when we’re miles apart?"),
    ("V06", 57.80, "Imagine every idea… finding its people, in one shared space."),
    ("V07", 64.60, "And bringing everyone together… shouldn’t that be as simple as walking there?"),
    ("V08", 105.00, "And when the meeting ends… what happens to everything that mattered?"),
    ("V09", 113.70, "Why should possibility stop at the office door?"),
    ("V10", 140.30, "And what if your workplace could change… with the world around you?"),
    ("V11", 159.60, "Some moments are bigger than any one room… and they bring us all together."),
    ("V12", 172.20, "But what if an idea didn’t have to wait… for someone to bring it to life?"),
    ("V13", 180.40, "What if the next chapter of work… was already taking shape?"),
    ("V14", 203.20, "Because the future of work isn’t just about where we are… it’s about what we can create."),
]
def probe(p, af):
    return subprocess.run([FF, "-hide_banner", "-nostdin", "-i", p, "-af", af, "-f", "null", "-"], capture_output=True, text=True).stderr
def dur(p):
    h, m, s = probe(p, "anull").split("Duration: ")[1].split(",")[0].split(":"); return int(h) * 3600 + int(m) * 60 + float(s)
def lufs(p):
    r = probe(p, "apad=pad_dur=0.5,ebur128=framelog=quiet"); return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", r)[-1])
LINES, prev = [], 0.0
for k, t, cap in VO:
    d = dur(os.path.join(AV3, f"{k}.wav"))
    if t < prev + 0.15: raise SystemExit(f"narration overlap: {k} at {t:.2f} < previous end {prev:.2f}")
    LINES.append((k, t, d, cap)); prev = t + d

SCORE = os.path.join(AV3, "score_v1.mp3")
SCORE_A_END, CHORD_SRC = 203.90, 204.40                   # the climax decays to −57 dB by 203.3; the final chord attacks at 204.40
S = lambda f: os.path.join(AUD, f)
X = lambda f: os.path.join(AV3, f)
# (file, t, target LUFS[, len, fade_in, fade_out]) — every effect is levelled to a loudness target, not a raw gain:
# UI feedback ≈ −31, world events −25…−29, beds −36…−42 (the narration sits at ≈ −16.6)
SFX = [
    (S("office.mp3"), 0.0, -42, 12.6, 0.8, 1.2), (S("deny.mp3"), at("O1", 7.75), -27),
    (S("click1.mp3"), at("O2", 17.42), -31), (S("confirm.mp3"), at("O2", 17.72), -30),
    (S("run.mp3"), at("X1", 5.03), -32, 1.6, 0.0, 0.5), (S("jump.mp3"), at("X1", 6.18), -29),
    (S("click1.mp3"), at("T01", TL["hub-open"] + 0.12), -32), (S("click2.mp3"), at("T04", TL["search-open"] + 0.10), -32),
    (S("notif.mp3"), START["T08"] + 0.25, -32),
    (S("click2.mp3"), at("E1", 8.40), -33), (S("notif.mp3"), at("E2", 11.10), -31),
    (S("click1.mp3"), START["G2"] + 0.45, -31), (S("confirm.mp3"), at("G3", PB["start"]) + 0.05, -31),
    (S("notif.mp3"), at("G4", 4.35), -34),
    (S("elevator.mp3"), START["G6"] - 0.3, -33, 2.9, 0.3, 0.7), (S("ding.mp3"), DOORS02 - 0.10, -29),
    (S("click1.mp3"), at("H3", 18.85), -31),
    (S("notif.mp3"), at("I2", MEM["question"] + 2.60), -33),
    (X("door.mp3"), DOOR_OUT - 0.55, -27),
    (X("carpass.mp3"), at("K1", 5.00) - 1.00, -25), (X("scooter.mp3"), at("K4", 1.55), -30, 5.0, 0.3, 1.2),
    (X("rain.mp3"), RAIN - 0.30, -31, START["L3"] - RAIN + 0.6, 1.8, 0.9),
    (S("cave.mp3"), START["C1"] - 0.05, -28, 4.6, 0.3, 1.4),
    (X("evening.mp3"), START["N1"] + 0.3, -35, START["U1"] - START["N1"] - 0.3, 1.0, 0.8),     # a soft outdoor bed in the score's near-silence
    (X("wings.mp3"), at("N1", 2.00), -28), (S("notif.mp3"), START["N2"] + 0.05, -32),
    (S("click1.mp3"), at("U1", L4A["request"]), -30), (X("wings.mp3"), LIFTOFF - 0.50, -26),
    (S("notif.mp3"), DELIVERED, -30), (S("confirm.mp3"), APPROVE, -27),
    (X("evening.mp3"), START["Z1"] + 0.3, -36, PIC_END - START["Z1"] - 0.3, 1.5, 0.25),
    (S("click1.mp3"), at("Z1", 3.29), -32), (S("confirm.mp3"), at("Z3", 14.50), -31),
    (X("door.mp3"), at("Z4", 19.30), -30),
]
SECTIONS = [("Morning arrival", 0.0, beat(-14)), ("Alive · the rooms", beat(-14), beat(4)), ("Tools montage", beat(4), beat(22)),
    ("People · conversation", beat(22), 55.20), ("Ideas · boards · map", 55.20, 64.48), ("Go Together × 4", 64.48, 90.60),
    ("Meeting · presentation", 90.60, 106.40), ("Meeting Memory", 106.40, 115.07), ("Out the door · exploration", 115.07, 142.71),
    ("Orbit · weather", 142.71, 155.31), ("Seasons", 155.31, 159.40), ("CAVE", 159.40, 165.00), ("Toucan", 165.00, 171.90),
    ("AI Lab · climax", 171.90, 199.00), ("End of the day", 199.00, PIC_END), ("Logo · resolution", PIC_END, END)]

SEGKEY = {}
def seg_file(k): return os.path.join(WORK, f"{k}_{SEGKEY[k]}.mp4")
def render(seg):
    k, take, a, n, grade, ov, extra = seg
    SEGKEY[k] = hashlib.md5(f"{take}|{a:.3f}|{n}|{grade}|{extra}".encode()).hexdigest()[:8]
    if os.environ.get("REUSE") and os.path.exists(seg_file(k)): return
    src = os.path.join(TAKES, f"{take}.mp4")
    if isinstance(extra, dict) and "patch" in extra:
        pt = extra["patch"]; x, y, w, h = pt["box"]; png = os.path.join(WORK, f"patch_{k}.png")
        run("-ss", f"{pt['t']:.3f}", "-i", src, "-frames:v", "1", "-vf", f"crop={w}:{h}:{x}:{y}", png)
        feather = "a='255*min(1,min(min(X,W-1-X),min(Y,H-1-Y))/6)'"          # 6 px soft edge
        fc = (f"[0:v]fps={FPS},setpts=PTS-STARTPTS[b];[1:v]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':{feather}[p];"
              f"[b][p]overlay={x}:{y}:shortest=1,format=yuv420p,{grade},trim=end_frame={n},format=yuv420p[v]")
        run("-threads", "4", "-ss", f"{a:.3f}", "-t", f"{n / FPS + 0.4:.3f}", "-i", src, "-loop", "1", "-i", png, "-filter_complex", fc,
            "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-r", str(FPS), seg_file(k))
        return
    pre = f"{extra}," if extra else ""
    run("-threads", "4", "-ss", f"{a:.3f}", "-t", f"{n / FPS + 0.4:.3f}", "-i", src,
        "-vf", f"fps={FPS},setpts=PTS-STARTPTS,{pre}format=yuv420p,{grade},trim=end_frame={n},format=yuv420p",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-r", str(FPS), seg_file(k))
def ts(x): x = max(0.0, x); return f"{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}"

def build_mix():
    ins, fl = [], []
    def add(p): ins.extend(["-i", p]); return len(ins) // 2 - 1
    fmt = "aformat=sample_rates=48000:channel_layouts=stereo"; pad = f"apad=whole_dur={END:.3f},atrim=0:{END:.3f}"
    ms = lambda x: max(0, int(round(x * 1000)))
    vl, xl = [], []
    for i, (k, t, d, cap) in enumerate(LINES):
        n = add(os.path.join(AV3, f"{k}.wav")); fl.append(f"[{n}:a]{fmt},adelay={ms(t)}|{ms(t)},{pad}[vo{i}]"); vl.append(f"[vo{i}]")
    fl.append(f"{''.join(vl)}amix=inputs={len(vl)}:normalize=0,highpass=f=70,equalizer=f=3200:t=q:w=1.2:g=1.5,"
              "acompressor=threshold=0.10:ratio=2.8:attack=6:release=180:makeup=1.6,asplit=2[vomix][vokey]")
    n = add(SCORE)
    fl.append(f"[{n}:a]{fmt},asplit=2[sa][sc]")
    # the orbit + seasons phrase sits 3 dB under the AI Lab climax, so the Lab is the one peak (0.5 s ramps either side)
    o0, o1 = START["L2"] - 0.5, START["C0"] + 0.5
    fl.append(f"[sa]atrim=0:{SCORE_A_END:.3f},asetpts=PTS-STARTPTS,afade=t=out:st={SCORE_A_END - 0.4:.3f}:d=0.4,"
              f"volume='1-0.292*clip((t-{o0:.2f})/0.5,0,1)*clip(({o1:.2f}-t)/0.5,0,1)':eval=frame,{pad}[mA]")
    lead = 0.06                                           # keep 60 ms before the attack; the attack itself lands ON the black
    fl.append(f"[sc]atrim=start={CHORD_SRC - lead:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.03,adelay={ms(CHORD - lead)}|{ms(CHORD - lead)},"
              f"volume=6dB,afade=t=out:st={END - 1.3:.3f}:d=1.3,{pad}[mC]")             # the soft resolution chord, lifted to sit with the logo
    fl.append("[mA][mC]amix=inputs=2:normalize=0,volume=-2dB[mus]")
    fl.append("[mus][vokey]sidechaincompress=threshold=0.035:ratio=3.2:attack=60:release=700:knee=6[musduck]")
    cache = {}
    for i, s in enumerate(SFX):
        f, t, target = s[:3]; n = add(f); ex = ""
        if f not in cache: cache[f] = lufs(f)
        if len(s) > 3:
            ln, fi, fo = s[3], s[4], s[5]; ex += f",atrim=0:{ln:.3f}"
            if fi: ex += f",afade=t=in:d={fi}"
            if fo: ex += f",afade=t=out:st={max(0, ln - fo):.3f}:d={fo}"
        fl.append(f"[{n}:a]{fmt}{ex},volume={target - cache[f]:.2f}dB,adelay={ms(t)}|{ms(t)},{pad}[x{i}]"); xl.append(f"[x{i}]")
    fl.append(f"{''.join(xl)}amix=inputs={len(xl)}:normalize=0[fx]")
    fl.append(f"[vomix][musduck][fx]amix=inputs=3:normalize=0,aresample=48000,atrim=0:{END:.3f}[a]")
    raw = os.path.join(WORK, "v3-mix-raw.wav")
    run(*ins, "-filter_complex", ";".join(fl), "-map", "[a]", "-c:a", "pcm_f32le", raw)
    # two-pass, LINEAR: one gain for the whole film (the breakdowns stay quiet, the climax stays the peak), then a peak limiter
    I0 = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", probe(raw, "ebur128=framelog=quiet"))[-1])
    mix = os.path.join(WORK, "v3-mix.wav")
    run("-i", raw, "-af", f"volume={-15.0 - I0:.2f}dB,alimiter=limit=0.84:attack=3:release=60:level=disabled", "-c:a", "pcm_s16le", mix)
    return mix, I0, {os.path.basename(f): round(v, 1) for f, v in cache.items()}

def section_loudness(mix):
    r = subprocess.run([FF, "-hide_banner", "-nostdin", "-v", "verbose", "-i", mix, "-af", "ebur128=framelog=verbose", "-f", "null", "-"], capture_output=True, text=True).stderr
    pts = [(float(t), float(s)) for t, s in re.findall(r"t:\s*([\d.]+)\s+TARGET.*?S:\s*(-?[\d.]+)", r)]
    out = []
    for name, a, b in SECTIONS:
        v = [s for t, s in pts if a + 1.5 <= t <= b + 1.5 and s > -70]
        out.append(dict(section=name, start=round(a, 2), end=round(b, 2), short_term_lufs_mean=round(sum(v) / len(v), 1) if v else None,
                        short_term_lufs_max=round(max(v), 1) if v else None))
    tot = probe(mix, "ebur128=peak=true:framelog=quiet")
    return out, dict(integrated_lufs=float(re.findall(r"I:\s+(-?[\d.]+) LUFS", tot)[-1]), lra_lu=float(re.findall(r"LRA:\s+([\d.]+) LU", tot)[-1]),
                     true_peak_dbtp=float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", tot)[-1]))

if __name__ == "__main__":
    for s in SEGS: render(s)
    print("segments", len(SEGS), flush=True)
    ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 2", "", "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Sub,Helvetica Neue Medium,44,&H00F6F6F6,&H00FFFFFF,&H78000000,&H88000000,0,0,0,0,100,100,1.2,0,1,1.5,1.6,2,170,170,140,1",
        "Style: Tag,Helvetica Neue,20,&H50FFFFFF,&H00FFFFFF,&H90000000,&H90000000,0,0,0,0,100,100,1,0,1,1.2,0,7,36,36,30,1",
        "Style: Lab,Helvetica Neue Medium,25,&H18FFFFFF,&H00FFFFFF,&H70000000,&H80000000,0,0,0,0,100,100,5,0,1,1.4,1.2,1,64,64,58,1",
        "Style: CardSub,Helvetica Neue Medium,28,&H00BEBEBE,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,16,0,1,0,0,5,0,0,0,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    for k, t, d, cap in LINES:
        ass.append(f"Dialogue: 0,{ts(t - 0.02)},{ts(t + d + 0.25)},Sub,,0,0,0,,{{\\fad(160,220)\\blur2}}{cap}")
    if not FINAL: ass.append(f"Dialogue: 1,{ts(0.5)},{ts(PIC_END - 0.3)},Tag,,0,0,0,,{{\\fad(400,300)}}TEASER 2 · DIRECTOR'S REVISION · REVIEW CUT")
    ass.append(f"Dialogue: 1,{ts(START['H4'] + 0.2)},{ts(START['H5'] + 0.3)},Lab,,0,0,0,,{{\\fad(300,300)}}REAL SCREEN SHARE  ·  PLACEHOLDER SLIDE")
    ass.append(f"Dialogue: 1,{ts(START['U1'] + 0.3)},{ts(START['Z1'] + 0.2)},Lab,,0,0,0,,{{\\fad(500,500)}}AI LAB  ·  SCRIPTED PREVIEW")
    card_in = PIC_END + 0.25; card_out = END - 0.15
    ass.append(f"Dialogue: 1,{ts(card_in + 0.45)},{ts(card_out)},CardSub,,0,0,0,,{{\\fad(900,700)\\pos(960,640)}}VIRTUAL OFFICE")
    subs = os.path.join(WORK, "v3-subs.ass"); open(subs, "w").write("\n".join(ass) + "\n")

    if FINAL: mix = APPROVED; assert os.path.exists(APPROVED), APPROVED
    else: mix, I0, sfx_lufs = build_mix(); print("mix raw LUFS", I0, flush=True)

    def assemble(items, name, fade_in):
        vin, ch, last, runf = [], [], None, 0
        for j, s in enumerate(items):
            k, n, ov = s[0], s[3], s[5]
            vin += ["-threads", "2", "-i", seg_file(k)]
            ch.append(f"[{j}:v]settb=1/{FPS},setpts=N,trim=end_frame={n},tpad=stop_mode=clone:stop=3,trim=end_frame={n},setpts=N,format=yuv420p[v{j}]")
            if j == 0:
                last = f"[v{j}]"; runf = n
                if fade_in: ch.append(f"{last}fade=t=in:st=0:d={fade_in}[f0]"); last = "[f0]"
                continue
            if ov: ch.append(f"{last}[v{j}]xfade=transition=fade:duration={ov / FPS:.4f}:offset={(runf - ov) / FPS:.4f},settb=1/{FPS},setpts=N[c{j}]"); runf += n - ov
            else: ch.append(f"{last}[v{j}]concat=n=2:v=1:a=0,settb=1/{FPS},setpts=N[c{j}]"); runf += n
            last = f"[c{j}]"
        out = os.path.join(WORK, f"{name}.mp4")
        run(*vin, "-filter_complex", ";".join(ch), "-map", last, "-c:v", "libx264", "-preset", "veryfast", "-crf", "15", "-r", str(FPS), out)
        return out, runf
    chunks, cur = [], []
    for s in SEGS:
        if cur and len(cur) >= 16 and not s[5]: chunks.append(cur); cur = []
        cur.append(s)
    chunks.append(cur)
    parts, total = [], 0
    for i, c in enumerate(chunks):
        p, nf = assemble(c, f"chunk{i}", 0.8 if i == 0 else 0)
        parts.append(p); total += nf; print("chunk", i, len(c), nf, flush=True)
    if total != f_(PIC_END): raise SystemExit(f"picture length {total} frames != {f_(PIC_END)}")
    lst = os.path.join(WORK, "chunks.txt"); open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
    pic = os.path.join(WORK, "picture.mp4"); run("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", pic)
    tc = "fontfile=/System/Library/Fonts/HelveticaNeue.ttc:fontsize=20:fontcolor=white@0.45:x=36:y=56"
    ch = [f"color=c=black:s=1920x1080:r={FPS}:d={END - PIC_END:.3f},format=yuv420p[CD]",
          f"[0:v]settb=1/{FPS},setpts=N[p0]", f"[p0][CD]concat=n=2:v=1:a=0,settb=1/{FPS},setpts=N[pic]",
          f"[1:v]scale=700:-1:flags=lanczos,format=rgba,fade=t=in:st={card_in:.3f}:d=1.0:alpha=1,fade=t=out:st={card_out - 0.7:.3f}:d=0.7:alpha=1[logo]",
          (f"[pic]subtitles='{subs}':fontsdir=/System/Library/Fonts[base]" if FINAL else
           f"[pic]subtitles='{subs}':fontsdir=/System/Library/Fonts,drawtext={tc}:text='TC %{{pts\\:hms}}':enable='between(t,0.5,{PIC_END - 0.3:.3f})'[base]"),
          "[base][logo]overlay=(W-w)/2:422:eof_action=pass,format=yuv420p[vout]"]
    out = os.path.join(OUT, f"{NAME}.mp4")
    run("-i", pic, "-loop", "1", "-t", f"{END:.3f}", "-i", LOGO, "-i", mix, "-filter_complex", ";".join(ch),
        "-map", "[vout]", "-map", "2:a", "-t", f"{END:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", str(FPS),
        *(["-c:a", "copy"] if FINAL else ["-c:a", "aac", "-b:a", "256k"]), "-movflags", "+faststart", out)
    if FINAL: print(out); sys.exit(0)
    secs, tot = section_loudness(mix)
    TDUR = {t: dur(os.path.join(TAKES, f"{t}.mp4")) for t in {x[1] for x in SEGS}}
    tl = dict(END=END, PIC_END=PIC_END, CHORD=CHORD, ALIVE=ALIVE, EXP=EXP, DOORS02=DOORS02, DOOR_OUT=DOOR_OUT, SUNSET=SUNSET, NIGHT=NIGHTT,
              RAIN=RAIN, LIFTOFF=LIFTOFF, REVEAL=REVEAL, DELIVERED=DELIVERED, APPROVE=APPROVE, mix_raw_lufs=I0, loudness=tot, sections=secs,
              script=[dict(clip=k, start=round(t, 2), end=round(t + d, 2), text=c) for k, t, d, c in LINES],
              segments=[dict(key=s[0], take=s[1], src=[round(s[2], 2), round(min(s[2] + s[3] / FPS, TDUR[s[1]]), 2)], start=round(START[s[0]], 2),
                             dur=round(s[3] / FPS, 2), dissolve=round(s[5] / FPS, 2), hold_s=round(max(0.0, s[2] + s[3] / FPS - TDUR[s[1]]), 2),
                             punch_in=isinstance(s[6], str) and s[6].startswith("crop"), tv_patch=isinstance(s[6], dict)) for s in SEGS],
              sfx=[dict(file=os.path.basename(s[0]), at=round(s[1], 2), target_lufs=s[2], source_lufs=sfx_lufs.get(os.path.basename(s[0]))) for s in SFX])
    json.dump(tl, open(os.path.join(OUT, f"{NAME}.timeline.json"), "w"), indent=1, ensure_ascii=False)
    print(json.dumps({k: (round(v, 2) if isinstance(v, float) else v) for k, v in tl.items() if k in ("ALIVE", "EXP", "DOOR_OUT", "RAIN", "LIFTOFF", "APPROVE", "loudness")}))
    print(out)
