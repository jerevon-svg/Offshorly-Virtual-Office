#!/usr/bin/env python3
"""FILM RIG ONLY — "A Day Inside Offshorly", PROOF SEQUENCE (Act I → the start of Act II).

Picture: new in-engine takes from the film rig (cinematic/shots.mjs). Voice: Bon's own walkthrough
recording, cut on verified silences (vo.py + cuts_proof.json). Score + effects: the already-owned teaser
library (out/teaser/audio) and the world's own rain (the CineNight ambience tap).

  FILM_FFMPEG=… python3 proof_edit.py <takes dir> <edit dir> <out dir>
Writes <out>/a-day-inside-offshorly_proof_master.mp4, …_proof_subtitled.mp4 and …_proof.srt
"""
import json, os, subprocess, sys

FF = os.environ["FILM_FFMPEG"]
TAKES, EDIT, OUT = (os.path.abspath(p) for p in sys.argv[1:4])
os.makedirs(OUT, exist_ok=True)
REPO_FILM = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
AUD = os.path.join(REPO_FILM, "out/teaser/audio")
LOGO = os.path.join(REPO_FILM, "out/final/offshorly-logo-reversed.png")
VOSRC = os.environ.get("FILM_VO_SRC", os.path.join(EDIT, "..", "..", "audio", "final.wav"))
FPS = 30
cuts = {c["id"]: c for c in json.load(open(os.path.join(EDIT, "cuts_proof.json")))["cuts"]}

# ------------------------------------------------------------------------------------------- picture
NIGHT = "eq=brightness=-0.035:contrast=1.12:saturation=0.78:gamma=0.96,colorbalance=rs=-0.04:gs=-0.01:bs=0.07:rm=-0.02:bm=0.035,vignette=a=PI/4.6"
MORNING = "eq=contrast=1.05:saturation=1.08,colorbalance=rh=0.035:gh=0.012:bh=-0.025:rm=0.01,vignette=a=PI/6"
INTERIOR = "eq=contrast=1.05:saturation=1.05,colorbalance=rh=0.02:bh=-0.012,vignette=a=PI/6.5"
UI = "eq=contrast=1.02"
LB = 139  # 2.39:1 letterbox bar height at 1920x1080

def smooth(a, d):  # ffmpeg expr: 0 → 1 smoothstep over [a, a+d] (frame-time `t`)
    return f"(st(0,clip((t-{a})/{d},0,1))*0+ld(0)*ld(0)*(3-2*ld(0)))"

# (input, take_in, take_out, kind) in edit order; kind picks the framing/grade
SEG = [
    ("A", "CineNight", 1.0, 17.6, "night"),
    ("B", "CineDawn", 2.2, 4.55, "night"),
    ("C", "CineDawn", 7.0, 12.1, "morning"),          # dissolves in over B (the time-lapse)
    ("D", "CineArrive", 0.7, 5.6, "interior"),
    ("E", "CineGate", 0.7, 8.6, "interior"),
    ("F", "CineCheckIn", 0.7, 8.22, "kiosk"),         # ends on the frame the Hub opens (≈0.1 s after the click)         # 4K: digital push-in onto the real Check In card
    ("G1", "CineCheckIn", 8.22, 14.25, "hub"),       # the Company Hub's real carousel, slide by slide
    ("G2", "CineCheckIn", 14.6, 16.85, "hub"),
    ("G3", "CineCheckIn", 17.2, 19.45, "hub"),
    ("G4", "CineCheckIn", 19.8, 22.05, "hub"),
    ("G5", "CineCheckIn", 22.4, 24.6, "hub"),
    ("H", "CineWeather", 1.2, 13.0, "weather"),
    ("I", "CineEnter", 0.7, 15.6, "interior"),
]
XF = 1.8                                              # the B → C dissolve
CARD = 6.4                                            # end card length

inputs, idx = [], {}
def inp(path, *pre):
    if path not in idx:
        idx[path] = len(inputs); inputs.append((list(pre), path))
    return idx[path]

f, starts, t = [], {}, 0.0
for k, (name, take, a, b, kind) in enumerate(SEG):
    n = inp(os.path.join(TAKES, f"{take}.mp4"))
    d = b - a
    base = f"[{n}:v]trim={a}:{b},setpts=PTS-STARTPTS,fps={FPS}"
    if kind == "kiosk":
        # 4K source: full frame until the card is about to appear, then a 1.2 s push to 1.85× on Bon + card
        e = "(st(1,clip((on/30-4.75)/1.25,0,1))*0+ld(1)*ld(1)*(3-2*ld(1)))"
        z = f"1+0.85*{e}"
        g = f"{base},zoompan=z='{z}':x='(1920+80*{e})-iw/zoom/2':y='(1080-190*{e})-ih/zoom/2':d=1:s=1920x1080:fps={FPS},{INTERIOR}"
    elif kind == "hub":
        g = f"{base},crop=3340:1878:250:141,scale=1920:1080:flags=lanczos,{UI}"
    elif kind == "weather":
        g = f"{base},crop=1670:939:125:70,scale=1920:1080:flags=lanczos,{UI}"
    else:
        g = f"{base},scale=1920:1080,{dict(night=NIGHT, morning=MORNING, interior=INTERIOR)[kind]}"
    if name == "A": g += ",fade=t=in:st=0:d=1.6"
    f.append(f"{g},format=yuv420p,setsar=1,settb=1/{FPS}[{name}]")
    if name == "C":
        starts[name] = t - XF; t += d - XF
    else:
        starts[name] = t; t += d
PIC = t
f.append(f"[A][B]concat=n=2:v=1:a=0,fps={FPS},settb=1/{FPS}[AB]")
f.append(f"[AB][C]xfade=transition=fade:duration={XF}:offset={starts['C']:.3f}[ABC]")
rest = [s[0] for s in SEG[3:]]
f.append("[ABC]" + "".join(f"[{r}]" for r in rest) + f"concat=n={1 + len(rest)}:v=1:a=0[body]")
# end card: black, the logo fades up above the title (the title itself is ASS)
lg = inp(LOGO, "-loop", "1")
f.append(f"color=c=black:s=1920x1080:r={FPS}:d={CARD},format=yuv420p[cardbg]")
f.append(f"[{lg}:v]scale=520:-1,format=rgba,fade=t=in:st=0.5:d=1.2:alpha=1,fade=t=out:st={CARD-1.2}:d=0.9:alpha=1,trim=duration={CARD},setpts=PTS-STARTPTS[logo]")
f.append("[cardbg][logo]overlay=x=(W-w)/2:y=330:shortest=1,format=yuv420p[card]")
f.append("[body][card]concat=n=2:v=1:a=0[film]")
END = PIC + CARD

# moments (output time) — read off the takes' own marks
def mark(take, what):
    d = json.load(open(os.path.join(TAKES, f"{take}.json")))
    return next(m["t"] - d["clip"]["t0"] for m in d["ran"] if m["what"].startswith(what))
def at(name, take_t):
    seg = next(s for s in SEG if s[0] == name)
    return starts[name] + (take_t - seg[2])
T_CARD = at("F", mark("CineCheckIn", "card")); T_CLICK = at("F", mark("CineCheckIn", "check-in"))
T_TYPE = at("H", mark("CineWeather", "typing")); T_SEARCH = at("H", mark("CineWeather", "search"))
T_PICK = at("H", mark("CineWeather", "picked")); T_FORE = at("H", mark("CineWeather", "forecast"))
T_THROUGH = at("I", mark("CineEnter", "through")); T_RISE = at("I", mark("CineEnter", "walk") + 4.5)
T_RED = at("E", mark("CineGate", "red")) - 0.5
OPEN = T_THROUGH + 0.1                                # the letterbox opens as he passes the green gates

# letterbox: two black bars that slide away (overlay y per frame)
f.append(f"color=c=black:s=1920x{LB}:r={FPS}:d={END}[bt];color=c=black:s=1920x{LB}:r={FPS}:d={END}[bb]")
f.append(f"[film][bt]overlay=x=0:y='-{LB}*{smooth(OPEN, 1.6)}':eval=frame[lb1]")
f.append(f"[lb1][bb]overlay=x=0:y='1080-{LB}+{LB}*{smooth(OPEN, 1.6)}':eval=frame,format=yuv420p[pic]")

# ------------------------------------------------------------------------------------------- narration
VO = [  # (cut id, output time, caption)
    ("V1", 2.0, "Working remotely is very common."),
    ("V2", 5.3, "It gave you freedom, convenience…\nbut sometimes it feels lonely, working alone."),
    ("V4", 13.0, "That's why this virtual office comes in."),
    ("V5", 17.7, "We don't want to create just another virtual office,"),
    ("V6", 21.1, "but we want to create the experience\nof working in a real office… virtually."),
    ("V7a", 27.9, None), ("V7b", 28.75, "Let's start with just a normal day."),
    ("V8a", 30.9, "When you try to enter here,"),
    ("V8b", 33.2, "you cannot enter. It's red\nbecause you need to check in first."),
    ("V9", T_CLICK - 0.18, "Check in."),
    ("V10", T_CLICK + 0.55, "When you check in, you can see the Company Hub."),
    ("W1", starts["G1"] + 3.1, "Give kudos,"),
    ("W2", starts["G2"] + 0.0, "updates,"),
    ("W3", starts["G3"] + 0.25, "surveys,"),
    ("V12", starts["G4"] + 0.15, "For example, like this town hall."),
    ("BD", starts["G5"] + 0.2, "Birthdays, those important stuff."),
    ("V13", T_TYPE + 0.06, "You can also see the actual area where you are in."),
    ("V14", T_FORE + 1.1, "For example, me — I'm in Mandaluyong."),
    ("V15", T_FORE + 3.9, "You can see the three-day forecast."),
    ("V18", starts["I"] + 0.45, "As you can see, it's green now."),     # the lanes are green from take 1.1 to 3.0
]
ms = lambda s: int(round(s * 1000))
ai, af = [], []
src = len(inputs) + len(ai); ai.append(([], VOSRC))
vl = []
for k, (cid, tt, _) in enumerate(VO):
    c = cuts[cid]
    af.append(f"[{src}:a]atrim={c['in']}:{c['out']},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=mono,"
              f"afade=t=in:d=0.015,afade=t=out:st={max(0, c['dur'] - 0.035):.3f}:d=0.035,adelay={ms(tt)},apad=whole_dur={END:.3f}[v{k}]")
    vl.append(f"[v{k}]")
af.append("".join(vl) + f"amix=inputs={len(vl)}:normalize=0,"
          "highpass=f=85,afftdn=nr=6:nf=-62,deesser=i=0.3,"
          "equalizer=f=190:t=q:w=1:g=1.5,equalizer=f=450:t=q:w=1.4:g=-1.5,equalizer=f=3300:t=q:w=1.2:g=2,"
          "acompressor=threshold=-22dB:ratio=3:attack=8:release=150:makeup=2.2,volume=1.25,"
          "aformat=channel_layouts=stereo,asplit=2[vobus][vokey]")

# ------------------------------------------------------------------------------------------- score
MUS = os.path.join(AUD, "music.mp3")
MUSIC = [  # (m_in, m_out, out_t, gain, fade_in, fade_out) — music.mp3 is the owned teaser cue (70 s)
    (48.0, 61.0, 0.8, 0.30, 3.0, 2.5),                                   # night: the long soft decay as a bed
    (0.0, 11.5, starts["D"] - 11.5, 0.45, 2.0, 0.0),                     # the build → its hit ON the arrival cut
    (11.5, 36.0, starts["D"], 0.42, 0.0, 0.6),                           # the drive: arrival, gate, kiosk
    (13.0, 33.9, starts["D"] + 24.35, 0.40, 0.3, 1.2),                   # the drive continues: Hub + weather
    (40.0, 64.0, T_RISE - 5.0, 0.55, 0.0, 2.0),                          # riser → hit as the crane rises → decay
    (65.2, 70.0, PIC + 0.3, 0.45, 0.2, 1.6),                             # resolution under the end card
]
ml = []
for k, (a, b, tt, g, fi, fo) in enumerate(MUSIC):
    n = len(inputs) + len(ai); ai.append(([], MUS)); d = b - a
    fades = (f",afade=t=in:d={fi}" if fi else "") + (f",afade=t=out:st={d - fo:.3f}:d={fo}" if fo else "")
    af.append(f"[{n}:a]atrim={a}:{b},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo{fades},volume={g},adelay={ms(tt)}|{ms(tt)},apad=whole_dur={END:.3f}[m{k}]")
    ml.append(f"[m{k}]")
af.append("".join(ml) + f"amix=inputs={len(ml)}:normalize=0[mus]")
af.append("[mus][vokey]sidechaincompress=threshold=0.035:ratio=5:attack=25:release=420:makeup=1[musduck]")

# ------------------------------------------------------------------------------------------- world + effects
rain_t0 = next(m for m in json.load(open(os.path.join(TAKES, "CineNight.json")))["ran"] if m["what"] == "tap")
rain_off = 1.0 - (rain_t0["t0"] - json.load(open(os.path.join(TAKES, "CineNight.json")))["clip"]["t0"])  # take 1.0 ↔ out 0
FX = [  # (file, out_t, gain, length, fade_in, fade_out, trim_from)
    (os.path.join(TAKES, "CineNight.ambience.webm"), 0.0, 2.2, 18.6, 1.5, 2.6, max(0.0, rain_off)),   # the world's own rain
    (os.path.join(AUD, "office.mp3"), starts["D"], 0.07, 11.5, 0.8, 0.8, 0.0),
    (os.path.join(AUD, "office.mp3"), starts["D"] + 11.4, 0.07, 11.5, 0.6, 0.6, 0.0),
    (os.path.join(AUD, "office.mp3"), starts["D"] + 22.8, 0.07, 11.5, 0.6, 0.6, 0.0),
    (os.path.join(AUD, "office.mp3"), starts["D"] + 34.2, 0.07, 11.5, 0.6, 1.2, 0.0),
    (os.path.join(AUD, "run.mp3"), starts["D"] + 0.3, 0.09, 4.4, 0.3, 0.5, 0.0),                    # footsteps in
    (os.path.join(AUD, "deny.mp3"), T_RED, 0.45, 0, 0, 0, 0.0),
    (os.path.join(AUD, "click1.mp3"), T_CARD, 0.30, 0, 0, 0, 0.0),
    (os.path.join(AUD, "confirm.mp3"), T_CLICK, 0.45, 0, 0, 0, 0.0),
    (os.path.join(AUD, "click2.mp3"), starts["G1"], 0.24, 0, 0, 0, 0.0),
    *[(os.path.join(AUD, "click1.mp3" if i % 2 else "click2.mp3"), starts[g], 0.17, 0, 0, 0, 0.0) for i, g in enumerate(["G2", "G3", "G4", "G5", "H"])],
    *[(os.path.join(AUD, "click1.mp3"), T_TYPE + 0.04 + i * 0.145, 0.06, 0, 0, 0, 0.0) for i in range(11)],
    (os.path.join(AUD, "click2.mp3"), T_SEARCH, 0.17, 0, 0, 0, 0.0),
    (os.path.join(AUD, "click1.mp3"), T_PICK, 0.20, 0, 0, 0, 0.0),
    (os.path.join(AUD, "confirm.mp3"), T_FORE, 0.24, 0, 0, 0, 0.0),
    (os.path.join(AUD, "confirm.mp3"), T_THROUGH - 0.9, 0.32, 0, 0, 0, 0.0),
]
fl = []
for k, (path, tt, g, ln, fi, fo, tf) in enumerate(FX):
    n = len(inputs) + len(ai); ai.append(([], path))
    ex = f",atrim={tf}:{tf + ln}" if ln else ""
    ex += ",asetpts=PTS-STARTPTS"
    if fi: ex += f",afade=t=in:d={fi}"
    if fo and ln: ex += f",afade=t=out:st={max(0, ln - fo):.3f}:d={fo}"
    af.append(f"[{n}:a]aformat=sample_rates=48000:channel_layouts=stereo{ex},volume={g},adelay={ms(tt)}|{ms(tt)},apad=whole_dur={END:.3f}[fx{k}]")
    fl.append(f"[fx{k}]")
af.append("".join(fl) + f"amix=inputs={len(fl)}:normalize=0[fxbus]")
af.append(f"[vobus][musduck][fxbus]amix=inputs=3:normalize=0,atrim=0:{END:.3f},afade=t=out:st={END - 1.4:.3f}:d=1.4[mix]")

# ------------------------------------------------------------------------------------------- titles + captions
def ts(s): h = int(s // 3600); m = int(s % 3600 // 60); return f"{h}:{m:02d}:{s % 60:05.2f}"
def srt_ts(s): h = int(s // 3600); m = int(s % 3600 // 60); return f"{h:02d}:{m:02d}:{int(s % 60):02d},{int(round((s % 1) * 1000)) % 1000:03d}"
HEAD = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Sub,Helvetica Neue Medium,42,&H00F6F6F6,&H00FFFFFF,&H8C0C0C0C,&H8C0C0C0C,0,0,0,0,100,100,0.4,0,3,9,0,2,200,200,178,1",
        "Style: Title,Helvetica Neue Light,66,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,16,0,1,0,0,5,0,0,0,1",
        "Style: TitleSub,Helvetica Neue Medium,24,&H00B4B4B4,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,9,0,1,0,0,5,0,0,0,1",
        "Style: Note,Helvetica Neue,18,&H00787878,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,4,0,1,0,0,2,0,0,40,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
titles = [
    f"Dialogue: 0,{ts(PIC + 1.0)},{ts(END - 0.5)},Title,,0,0,0,,{{\\pos(960,600)\\fad(1100,800)}}A DAY INSIDE OFFSHORLY",
    f"Dialogue: 0,{ts(PIC + 1.6)},{ts(END - 0.5)},TitleSub,,0,0,0,,{{\\pos(960,668)\\fad(1100,800)}}OFFSHORLY VIRTUAL OFFICE",
    f"Dialogue: 0,{ts(PIC + 2.0)},{ts(END - 0.5)},Note,,0,0,0,,{{\\fad(900,700)}}Proof sequence · Acts I–II · in-engine footage · narration: Bon (original walkthrough recording)",
]
caps, srt = [], []
spoken = [(tt, cuts[c]["dur"], cap) for c, tt, cap in VO]
merged = []  # V7a + V7b read as one caption
for k, (c, tt, cap) in enumerate(VO):
    if cap is None: continue
    st = tt if c != "V7b" else VO[k - 1][1]
    en = tt + cuts[c]["dur"] + 0.35
    nxt = next((x[1] for x in VO[k + 1:] if x[2] is not None), None)
    if nxt is not None: en = min(en, nxt - 0.05)
    merged.append((st, en, cap))
for i, (st, en, cap) in enumerate(merged, 1):
    caps.append(f"Dialogue: 0,{ts(st)},{ts(en)},Sub,,0,0,0,,{cap.replace(chr(10), '\\N')}")
    srt.append(f"{i}\n{srt_ts(st)} --> {srt_ts(en)}\n{cap}\n")
open(os.path.join(EDIT, "proof-titles.ass"), "w").write("\n".join(HEAD + titles) + "\n")
open(os.path.join(EDIT, "proof-subs.ass"), "w").write("\n".join(HEAD + titles + caps) + "\n")
open(os.path.join(OUT, "a-day-inside-offshorly_proof.srt"), "w").write("\n".join(srt))

# ------------------------------------------------------------------------------------------- render
def run(args): print(" ".join(a if len(a) < 120 else a[:117] + "…" for a in args[:6]), "…"); subprocess.run(args, check=True)
# 1) audio stem (no loudness pass yet)
a_in = []
for pre, path in ai: a_in += pre + ["-i", path]
a_graph = ";".join(af).replace(f"[{src}:a]", "[0:a]")
# audio inputs were numbered after the picture inputs: renumber to start at 0
remap = {len(inputs) + i: i for i in range(len(ai))}
import re
a_graph = re.sub(r"\[(\d+):a\]", lambda m: f"[{remap.get(int(m.group(1)), int(m.group(1)))}:a]", ";".join(af))
open(os.path.join(EDIT, "proof-audio.txt"), "w").write(a_graph)
stem = os.path.join(EDIT, "proof-mix.wav")
run([FF, "-y", "-hide_banner", "-loglevel", "error", *a_in, "-filter_complex_script", os.path.join(EDIT, "proof-audio.txt"), "-map", "[mix]", "-ar", "48000", "-c:a", "pcm_s16le", stem])
# measure, then one linear gain + true-peak limit to −14 LUFS (LinkedIn / social)
m = subprocess.run([FF, "-hide_banner", "-nostats", "-i", stem, "-af", "loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json", "-f", "null", "-"], capture_output=True, text=True).stderr
meas = json.loads(m[m.rindex("{"):m.rindex("}") + 1])
gain = -14.0 - float(meas["input_i"])
print("mix loudness", meas["input_i"], "LUFS → gain", round(gain, 2), "dB")
# 2) picture (+ titles, or + titles and captions)
v_in = []
for pre, path in inputs: v_in += pre + ["-i", path]
for tag, ass in (("master", "proof-titles.ass"), ("subtitled", "proof-subs.ass")):
    g = ";".join(f) + f";[pic]subtitles='{os.path.join(EDIT, ass)}':fontsdir=/System/Library/Fonts[vout]"
    open(os.path.join(EDIT, f"proof-video-{tag}.txt"), "w").write(g)
    out = os.path.join(OUT, f"a-day-inside-offshorly_proof_{tag}.mp4")
    run([FF, "-y", "-hide_banner", "-loglevel", "error", *v_in, "-i", stem, "-filter_complex_script", os.path.join(EDIT, f"proof-video-{tag}.txt"),
         "-map", "[vout]", "-map", f"{len(inputs)}:a", "-af", f"volume={gain:.2f}dB,alimiter=limit=0.89:level=false",
         "-t", f"{END:.3f}", "-r", str(FPS), "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", out])
print(json.dumps({"end": round(END, 2), "pic": round(PIC, 2), "starts": {k: round(v, 2) for k, v in starts.items()},
                  "moments": {"red": round(T_RED, 2), "card": round(T_CARD, 2), "click": round(T_CLICK, 2), "typing": round(T_TYPE, 2),
                              "picked": round(T_PICK, 2), "forecast": round(T_FORE, 2), "through": round(T_THROUGH, 2), "rise": round(T_RISE, 2)}}, indent=1))
