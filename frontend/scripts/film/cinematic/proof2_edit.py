#!/usr/bin/env python3
"""FILM RIG ONLY — "A Day Inside Offshorly", REVISED PROOF (v2): Act 1 Office view → Act 2 3D → Act 3 Player view.

Picture: new in-engine takes (out/cinematic/takes_v2) + the approved night crane and dawn time-lapse from the first
proof (out/cinematic/takes). Narration: a SCRATCH timing guide (macOS `say`, local) clearly labelled on screen; the
final film uses Bon's own recordings of the same lines. Score + effects: the already-owned teaser library.

  FILM_FFMPEG=… python3 proof2_edit.py <takes_v1> <takes_v2> <scratch_vo_dir> <work_dir> <out_dir>
"""
import json, os, re, subprocess, sys

FF = os.environ["FILM_FFMPEG"]
T1, T2, VO, WORK, OUT = (os.path.abspath(p) for p in sys.argv[1:6])
os.makedirs(WORK, exist_ok=True); os.makedirs(OUT, exist_ok=True)
FILM = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
AUD = os.path.join(FILM, "out/teaser/audio")
LOGO = os.path.join(FILM, "out/final/offshorly-logo-reversed.png")
FPS, LB, CARD = 30, 139, 4.6

NIGHT_OFFICE = "eq=brightness=0.02:contrast=1.08:saturation=0.85,colorbalance=rs=-0.03:bs=0.06:rm=-0.015:bm=0.03,vignette=a=PI/5"
NIGHT = "eq=brightness=-0.035:contrast=1.12:saturation=0.78:gamma=0.96,colorbalance=rs=-0.04:gs=-0.01:bs=0.07:rm=-0.02:bm=0.035,vignette=a=PI/4.6"
MORNING = "eq=contrast=1.05:saturation=1.08,colorbalance=rh=0.035:gh=0.012:bh=-0.025:rm=0.01,vignette=a=PI/6"
INTERIOR = "eq=contrast=1.05:saturation=1.05,colorbalance=rh=0.02:bh=-0.012,vignette=a=PI/6.5"
UI = "eq=contrast=1.02"

# (name, takes dir, take, in, out, framing/grade) — in edit order. XF marks a dissolve INTO that segment.
SEG = [
    ("A", T2, "V2OfficeNight", 0.8, 19.6, "night_office"),     # ACT 1 · Office view: Reception → the whole floor → the rooms
    ("B", T2, "V2Night3D", 0.6, 7.8, "night_office"),          # ACT 2 · the real C press: flat plan → 3D
    ("C", T1, "CineNight", 8.0, 17.6, "night"),                # the approved night crane, down to Bon alone
    ("D", T1, "CineDawn", 2.2, 4.55, "night"),                 # the rain clears…
    ("E", T1, "CineDawn", 7.0, 11.5, "morning"),               # …morning (time-lapse dissolve)
    ("F", T2, "V2Morning3D", 0.8, 12.8, "morning"),            # colleagues come through the gates
    ("G", T2, "V2StreetPV", 0.6, 7.4, "interior"),             # ACT 3 · the real C press into Player view; the walk in
    ("H", T2, "V2GatePV", 0.5, 9.3, "interior"),               # refused: the lane goes red
    ("I", T2, "V2KioskPV", 1.2, 4.4, "kiosk"),                 # E · the card · Check In
    ("J1", T2, "V2KioskPV", 5.9, 7.5, "hub"),                  # Kudos
    ("J2", T2, "V2KioskPV", 8.0, 9.5, "hub"),                  # What's new (an update)
    ("J3", T2, "V2KioskPV", 10.05, 11.6, "hub"),               # Survey
    ("J4", T2, "V2KioskPV", 12.15, 13.8, "hub"),               # Town hall
    ("J5", T2, "V2KioskPV", 14.2, 15.9, "hub"),                # Birthday
    ("K1", T2, "V2KioskPV", 16.3, 17.4, "hub"),                # the weather slide (saved city)
    ("K2", T2, "V2KioskPV", 18.7, 21.0, "hub"),                # Change city · typing · search
    ("K3", T2, "V2KioskPV", 22.9, 25.6, "hub"),                # pick → the live forecast
    ("L", T2, "V2GreenPV", 0.5, 8.0, "interior"),              # green lane → the concourse
]
XF = {"C": 1.0, "E": 1.8}

inputs, idx = [], {}
def inp(path, *pre):
    if path not in idx: idx[path] = len(inputs); inputs.append((list(pre), path))
    return idx[path]

f, starts, t = [], {}, 0.0
for name, tdir, take, a, b, kind in SEG:
    n = inp(os.path.join(tdir, f"{take}.mp4"))
    base = f"[{n}:v]trim={a}:{b},setpts=PTS-STARTPTS,fps={FPS}"
    if kind == "kiosk":
        g = f"{base},crop=1422:800:289:0,scale=1920:1080:flags=lanczos,{INTERIOR}"     # 1.35× onto Bon + the real card
    elif kind == "hub":
        g = f"{base},crop=1778:1000:71:40,scale=1920:1080:flags=lanczos,{UI}"
    else:
        g = f"{base},scale=1920:1080,{dict(night_office=NIGHT_OFFICE, night=NIGHT, morning=MORNING, interior=INTERIOR)[kind]}"
    if name == "A": g += ",fade=t=in:st=0:d=1.8"
    f.append(f"{g},format=yuv420p,setsar=1,settb=1/{FPS}[{name}]")
    starts[name] = t - XF.get(name, 0.0)
    t = starts[name] + (b - a)
PIC = t
# A + B concat; xfade C; concat D; xfade E; concat the rest
f.append(f"[A][B]concat=n=2:v=1:a=0,fps={FPS},settb=1/{FPS}[AB]")
f.append(f"[AB][C]xfade=transition=fade:duration={XF['C']}:offset={starts['C']:.3f},fps={FPS},settb=1/{FPS}[ABC]")
f.append(f"[ABC][D]concat=n=2:v=1:a=0,fps={FPS},settb=1/{FPS}[ABCD]")
f.append(f"[ABCD][E]xfade=transition=fade:duration={XF['E']}:offset={starts['E']:.3f},fps={FPS},settb=1/{FPS}[ABCDE]")
rest = [s[0] for s in SEG[5:]]
f.append("[ABCDE]" + "".join(f"[{r}]" for r in rest) + f"concat=n={1 + len(rest)}:v=1:a=0[body]")
lg = inp(LOGO, "-loop", "1")
f.append(f"color=c=black:s=1920x1080:r={FPS}:d={CARD},format=yuv420p[cardbg]")
f.append(f"[{lg}:v]scale=460:-1,format=rgba,fade=t=in:st=0.4:d=1.0:alpha=1,fade=t=out:st={CARD-1.0}:d=0.8:alpha=1,trim=duration={CARD},setpts=PTS-STARTPTS[logo]")
f.append("[cardbg][logo]overlay=x=(W-w)/2:y=350:shortest=1,format=yuv420p[card]")
f.append("[body][card]concat=n=2:v=1:a=0[film]")
END = PIC + CARD

def mark(tdir, take, what):
    d = json.load(open(os.path.join(tdir, f"{take}.json")))
    return next(m["t"] - d["clip"]["t0"] for m in d["ran"] if m["what"].startswith(what))
def at(name, take_t):
    seg = next(s for s in SEG if s[0] == name)
    return starts[name] + (take_t - seg[3])
T_C1 = at("B", mark(T2, "V2Night3D", "C"))
T_PLAYER = at("G", mark(T2, "V2StreetPV", "player"))
T_WALKIN = at("G", mark(T2, "V2StreetPV", "walk"))
T_RED = at("H", mark(T2, "V2GatePV", "red")) - 0.35
T_E = at("I", mark(T2, "V2KioskPV", "E")); T_CARD = at("I", mark(T2, "V2KioskPV", "card")); T_CHECK = at("I", mark(T2, "V2KioskPV", "check-in"))
T_TYPE = at("K2", mark(T2, "V2KioskPV", "typing")); T_SEARCH = at("K2", mark(T2, "V2KioskPV", "search"))
T_PICK = at("K3", mark(T2, "V2KioskPV", "picked"))
T_GREEN = at("L", 1.15)

# letterbox: the frame opens as the world drops into Player view
OPEN = T_PLAYER
sm = lambda a, d: f"(st(0,clip((t-{a})/{d},0,1))*0+ld(0)*ld(0)*(3-2*ld(0)))"
f.append(f"color=c=black:s=1920x{LB}:r={FPS}:d={END}[bt];color=c=black:s=1920x{LB}:r={FPS}:d={END}[bb]")
f.append(f"[film][bt]overlay=x=0:y='-{LB}*{sm(OPEN, 1.6)}':eval=frame[lb1]")
f.append(f"[lb1][bb]overlay=x=0:y='1080-{LB}+{LB}*{sm(OPEN, 1.6)}':eval=frame,format=yuv420p[pic]")

# ------------------------------------------------------------------------------------------- scratch narration
VOL = [  # (scratch id, time, caption) — the lines of the NEW script (sections A–C of the recording sheet)
    ("S01", 2.6, "Remote work gave us freedom."),
    ("S02", 6.0, "But somewhere along the way, we lost the hallway."),
    ("S03", 10.3, "The quick hello. The coffee chat.\nThe feeling of being in it together."),
    ("S04", T_C1 - 3.2, "So we built a place to find it again."),
    ("S05", T_C1 + 0.9, "Not another grid of video calls."),
    ("S06", T_C1 + 3.7, "A world."),
    ("S07", starts["C"] + 3.0, "It keeps real time."),
    ("S08", starts["D"] + 0.9, "It feels the real weather."),
    ("S09", starts["F"] + 1.4, "And every morning, it fills up\nwith the people you work with."),
    ("S10", T_PLAYER + 0.2, "This is me."),
    ("S11", T_WALKIN + 0.25, "Let's start the day."),
    ("S12", T_RED - 0.6, "Like any office, you check in at the door."),
    ("S13", T_CHECK - 1.25, "Then the Company Hub catches you up."),
    ("S14a", starts["J1"] + 0.45, "Kudos."),
    ("S14b", starts["J2"] + 0.35, "Updates."),
    ("S14c", starts["J3"] + 0.35, "Surveys."),
    ("S14d", starts["J4"] + 0.35, "Town halls."),
    ("S14e", starts["J5"] + 0.35, "Birthdays."),
    ("S15", starts["K2"] + 0.25, "Even the weather, wherever you are."),
    ("S16", T_GREEN + 0.25, "And you're in."),
]
dur = {}
FP = FF.replace("ffmpeg-static/ffmpeg", "ffprobe-static/bin/darwin/x64/ffprobe")
for sid, _, _ in VOL:
    dur[sid] = float(subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", os.path.join(VO, f"{sid}.wav")], capture_output=True, text=True).stdout)
ms = lambda s: int(round(s * 1000))
ai, af = [], []
def ainp(path): ai.append(path); return len(ai) - 1
vl = []
for k, (sid, tt, _) in enumerate(VOL):
    n = ainp(os.path.join(VO, f"{sid}.wav"))
    af.append(f"[{n}:a]aformat=sample_rates=48000:channel_layouts=mono,adelay={ms(tt)},apad=whole_dur={END:.3f}[v{k}]"); vl.append(f"[v{k}]")
af.append("".join(vl) + f"amix=inputs={len(vl)}:normalize=0,highpass=f=90,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=150:makeup=1.6,"
          "aformat=channel_layouts=stereo,asplit=2[vobus][vokey]")

# ------------------------------------------------------------------------------------------- score (owned teaser cue)
MUS = os.path.join(AUD, "music.mp3")
MUSIC = [  # (m_in, m_out, out_t, gain, fade_in, fade_out)
    (46.5, 64.0, 1.0, 0.30, 3.5, 2.5),                        # Act 1: the long soft decay, under the night plan
    (0.0, 11.5, starts["F"] - 11.5, 0.42, 2.5, 0.0),          # the build → its hit on the morning reveal
    (11.5, 36.0, starts["F"], 0.40, 0.0, 0.6),                # the drive: morning → arrival → gate
    (13.0, 31.5, starts["F"] + 24.35, 0.36, 0.3, 1.2),        # the drive continues under the Hub + weather
    (40.0, 64.0, T_GREEN - 5.0 + 0.3, 0.52, 0.0, 2.2),        # riser → hit as he steps through → decay
    (65.2, 70.0, PIC + 0.2, 0.42, 0.2, 1.6),                  # resolution under the card
]
ml = []
for k, (a, b, tt, g, fi, fo) in enumerate(MUSIC):
    n = ainp(MUS); d = b - a
    fades = (f",afade=t=in:d={fi}" if fi else "") + (f",afade=t=out:st={d - fo:.3f}:d={fo}" if fo else "")
    af.append(f"[{n}:a]atrim={a}:{b},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo{fades},volume={g},adelay={ms(tt)}|{ms(tt)},apad=whole_dur={END:.3f}[m{k}]")
    ml.append(f"[m{k}]")
af.append("".join(ml) + f"amix=inputs={len(ml)}:normalize=0[mus]")
af.append("[mus][vokey]sidechaincompress=threshold=0.035:ratio=5:attack=25:release=420:makeup=1[musduck]")

# ------------------------------------------------------------------------------------------- world sound + effects
def tap(tdir, take, seg_in):  # the take's own ambience, aligned to the segment
    d = json.load(open(os.path.join(tdir, f"{take}.json")))
    tp = next(m for m in d["ran"] if m["what"] == "tap")
    return os.path.join(tdir, f"{take}.ambience.webm"), max(0.0, seg_in - (tp["t0"] - d["clip"]["t0"]))
FX = []  # (file, out_t, gain, length, fade_in, fade_out, trim_from)
p, tf = tap(T2, "V2OfficeNight", 0.8); FX.append((p, 0.0, 2.0, 19.5, 2.0, 1.5, tf))
p, tf = tap(T2, "V2Night3D", 0.6); FX.append((p, starts["B"], 2.0, 7.4, 0.4, 1.2, tf))
p, tf = tap(T1, "CineNight", 8.0); FX.append((p, starts["C"], 2.2, 9.6, 1.0, 2.6, tf))
FX += [
    (os.path.join(AUD, "riser.mp3"), T_C1 - 1.9, 0.22, 0, 0, 0, 0.0),
    *[(os.path.join(AUD, "office.mp3"), starts["G"] + 11.4 * i, 0.06, 11.5, 0.6, 0.6, 0.0) for i in range(4)],
    (os.path.join(AUD, "run.mp3"), T_WALKIN + 0.05, 0.09, 2.2, 0.15, 0.4, 0.0),
    (os.path.join(AUD, "run.mp3"), starts["H"] + 0.2, 0.08, 2.4, 0.15, 0.4, 0.0),
    (os.path.join(AUD, "deny.mp3"), T_RED, 0.45, 0, 0, 0, 0.0),
    (os.path.join(AUD, "click1.mp3"), T_E, 0.24, 0, 0, 0, 0.0),
    (os.path.join(AUD, "click2.mp3"), T_CARD, 0.2, 0, 0, 0, 0.0),
    (os.path.join(AUD, "confirm.mp3"), T_CHECK, 0.45, 0, 0, 0, 0.0),
    *[(os.path.join(AUD, "click1.mp3" if i % 2 else "click2.mp3"), starts[g], 0.16, 0, 0, 0, 0.0) for i, g in enumerate(["J1", "J2", "J3", "J4", "J5", "K1"])],
    *[(os.path.join(AUD, "click1.mp3"), T_TYPE + 0.04 + i * 0.13, 0.06, 0, 0, 0, 0.0) for i in range(11)],
    (os.path.join(AUD, "click2.mp3"), T_SEARCH, 0.17, 0, 0, 0, 0.0),
    (os.path.join(AUD, "click1.mp3"), T_PICK, 0.2, 0, 0, 0, 0.0),
    (os.path.join(AUD, "confirm.mp3"), T_PICK + 0.05, 0.24, 0, 0, 0, 0.0),
    (os.path.join(AUD, "confirm.mp3"), T_GREEN - 0.1, 0.3, 0, 0, 0, 0.0),
    (os.path.join(AUD, "run.mp3"), starts["L"] + 0.2, 0.08, 2.8, 0.15, 0.5, 0.0),
]
fl = []
for k, (path, tt, g, ln, fi, fo, tfrom) in enumerate(FX):
    n = ainp(path)
    ex = (f",atrim={tfrom}:{tfrom + ln}" if ln else "") + ",asetpts=PTS-STARTPTS"
    if fi: ex += f",afade=t=in:d={fi}"
    if fo and ln: ex += f",afade=t=out:st={max(0, ln - fo):.3f}:d={fo}"
    af.append(f"[{n}:a]aformat=sample_rates=48000:channel_layouts=stereo{ex},volume={g},adelay={ms(tt)}|{ms(tt)},apad=whole_dur={END:.3f}[fx{k}]")
    fl.append(f"[fx{k}]")
af.append("".join(fl) + f"amix=inputs={len(fl)}:normalize=0[fxbus]")
af.append(f"[vobus][musduck][fxbus]amix=inputs=3:normalize=0,atrim=0:{END:.3f},afade=t=out:st={END - 1.4:.3f}:d=1.4[mix]")

# ------------------------------------------------------------------------------------------- titles, label, captions
def ts(s): return f"{int(s // 3600)}:{int(s % 3600 // 60):02d}:{s % 60:05.2f}"
def srt_ts(s): return f"{int(s // 3600):02d}:{int(s % 3600 // 60):02d}:{int(s % 60):02d},{int(round((s % 1) * 1000)) % 1000:03d}"
HEAD = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "", "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Sub,Helvetica Neue Medium,42,&H00F6F6F6,&H00FFFFFF,&H8C0C0C0C,&H8C0C0C0C,0,0,0,0,100,100,0.4,0,3,9,0,2,200,200,178,1",
        "Style: Title,Helvetica Neue Light,62,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,16,0,1,0,0,5,0,0,0,1",
        "Style: TitleSub,Helvetica Neue Medium,22,&H00B4B4B4,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,8,0,1,0,0,5,0,0,0,1",
        "Style: Label,Helvetica Neue Medium,17,&H30FFFFFF,&H00FFFFFF,&H00000000,&H90000000,0,0,0,0,100,100,2,0,3,5,0,7,24,0,22,1",
        "Style: Chapter,Helvetica Neue Medium,24,&H10FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,9,0,1,0,1.2,1,150,0,170,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
titles = [
    f"Dialogue: 0,{ts(0)},{ts(PIC)},Label,,0,0,0,,SCRATCH NARRATION · temporary voice for timing only · final narration: Bon",
    f"Dialogue: 0,{ts(1.2)},{ts(5.6)},Chapter,,0,0,0,,{{\\fad(700,700)}}OFFICE VIEW",
    f"Dialogue: 0,{ts(T_C1 + 2.6)},{ts(T_C1 + 6.6)},Chapter,,0,0,0,,{{\\fad(700,700)}}3D VIEW",
    f"Dialogue: 0,{ts(T_PLAYER + 0.4)},{ts(T_PLAYER + 4.4)},Chapter,,0,0,0,,{{\\fad(700,700)}}PLAYER VIEW",
    f"Dialogue: 0,{ts(PIC + 0.9)},{ts(END - 0.4)},Title,,0,0,0,,{{\\pos(960,600)\\fad(1000,700)}}A DAY INSIDE OFFSHORLY",
    f"Dialogue: 0,{ts(PIC + 1.4)},{ts(END - 0.4)},TitleSub,,0,0,0,,{{\\pos(960,664)\\fad(1000,700)}}REVISED PROOF  ·  OFFICE VIEW → 3D VIEW → PLAYER VIEW",
]
caps, srt = [], []
for k, (sid, tt, cap) in enumerate(VOL):
    nxt = VOL[k + 1][1] if k + 1 < len(VOL) else END
    en = min(tt + dur[sid] + 0.35, nxt - 0.05)
    caps.append(f"Dialogue: 0,{ts(tt)},{ts(en)},Sub,,0,0,0,,{cap.replace(chr(10), '\\N')}")
    srt.append(f"{k + 1}\n{srt_ts(tt)} --> {srt_ts(en)}\n{cap}\n")
open(os.path.join(WORK, "p2-titles.ass"), "w").write("\n".join(HEAD + titles) + "\n")
open(os.path.join(WORK, "p2-subs.ass"), "w").write("\n".join(HEAD + titles + caps) + "\n")
open(os.path.join(OUT, "a-day-inside-offshorly_proof2_scratch.srt"), "w").write("\n".join(srt))

# ------------------------------------------------------------------------------------------- render
def run(args): subprocess.run(args, check=True)
a_in = []
for path in ai: a_in += ["-i", path]
open(os.path.join(WORK, "p2-audio.txt"), "w").write(";".join(af))
stem = os.path.join(WORK, "p2-mix.wav")
run([FF, "-nostdin", "-y", "-hide_banner", "-loglevel", "error", *a_in, "-filter_complex_script", os.path.join(WORK, "p2-audio.txt"), "-map", "[mix]", "-ar", "48000", "-c:a", "pcm_s16le", stem])
m = subprocess.run([FF, "-nostdin", "-hide_banner", "-nostats", "-i", stem, "-af", "loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json", "-f", "null", "-"], capture_output=True, text=True).stderr
meas = json.loads(m[m.rindex("{"):m.rindex("}") + 1]); gain = -14.0 - float(meas["input_i"])
print("mix", meas["input_i"], "LUFS → gain", round(gain, 2))
v_in = []
for pre, path in inputs: v_in += pre + ["-i", path]
for tag, ass in (("master", "p2-titles.ass"), ("subtitled", "p2-subs.ass")):
    g = ";".join(f) + f";[pic]subtitles='{os.path.join(WORK, ass)}':fontsdir=/System/Library/Fonts[vout]"
    open(os.path.join(WORK, f"p2-video-{tag}.txt"), "w").write(g)
    run([FF, "-nostdin", "-y", "-hide_banner", "-loglevel", "error", *v_in, "-i", stem, "-filter_complex_script", os.path.join(WORK, f"p2-video-{tag}.txt"),
         "-map", "[vout]", "-map", f"{len(inputs)}:a", "-af", f"volume={gain:.2f}dB,alimiter=limit=0.89:level=false",
         "-t", f"{END:.3f}", "-r", str(FPS), "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", os.path.join(OUT, f"a-day-inside-offshorly_proof2_scratch_{tag}.mp4")])
json.dump({"end": round(END, 2), "starts": {k: round(v, 2) for k, v in starts.items()},
           "vo": [(sid, round(tt, 2), round(dur[sid], 2)) for sid, tt, _ in VOL],
           "moments": {"C1": round(T_C1, 2), "player": round(T_PLAYER, 2), "red": round(T_RED, 2), "check": round(T_CHECK, 2), "green": round(T_GREEN, 2)}},
          open(os.path.join(WORK, "p2-timeline.json"), "w"), indent=1)
print(json.dumps({"end": round(END, 2), "player": round(T_PLAYER, 2), "check": round(T_CHECK, 2), "green": round(T_GREEN, 2)}))
