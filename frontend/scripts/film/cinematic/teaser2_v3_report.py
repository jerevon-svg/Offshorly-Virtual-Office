#!/usr/bin/env python3
"""FILM RIG ONLY — writes the Teaser 2 DIRECTOR'S CUT report (markdown) from the render's own timeline JSON, so every
timestamp in it is the cut's real one.
  python3 teaser2_v3_report.py <timeline.json> <report.md> <qa.json>
qa.json carries what the render cannot know about itself: file facts, decode/black-frame checks, credits, disk."""
import json, sys

tl = json.load(open(sys.argv[1])); OUT = sys.argv[2]; QA = json.load(open(sys.argv[3]))
seg = {s["key"]: s for s in tl["segments"]}
def tc(x): return f"{int(x // 60)}:{x % 60:04.1f}"
def at(k): return "3:31.2–end" if k == "LOGO" else (tc(seg[k]["start"]) if k in seg else "—")

DESC = {
    "O1": "Office View, morning: the team walks in; Bon is refused at the gate lane (red) — not checked in yet",
    "O2": "the real kiosk card → Check In", "O3": "through the gates, now green", "O4": "the office around him",
    "A1": "“alive.” on the real Office→3D switch", "M0": "the whole office from the air", "M1": "Design room: Micah and Angelo",
    "M2": "Dev room: Alex and Jan", "M3": "Gaming room: Clang and France", "M4": "Executive room: Kael and Nicole", "M5": "AI room: Jona",
    "M6": "the Central Hub", "X1": "push-in → “you experience.” on the real 3D→Player switch → run, jump",
    "T01": "Company Hub at the café", "T02": "the Hub’s weather card: the forecast city", "T03": "Profile (pinned badges) → Feed",
    "T03b": "Achievements + badge tiers", "T04": "Search “Mi” → Micah", "T05": "Rooms: names over the office",
    "T06": "Tasks: Quests → Missions", "T07": "claim a reward", "T08": "Notifications", "T09": "Rewards: the demo catalog",
    "T10": "Settings: “Open the 3D office in”", "T11": "Settings: Controls", "T12": "Settings: Audio",
    "E0": "Bon walks up to Micah and Angelo, mid-conversation at the plaza",
    "E1": "they turn to him → the coworker menu → Chat; Kael crosses behind; Bon: “Coffee after standup? ☕”",
    "E2": "punch-in: Micah answers “Always ☕” (synthetic film-only line)",
    "F0": "Boards: the list", "F1": "a live board: a note dragged into place", "F2": "the Global Team Map (tiles fill in; the loaded map held)",
    "G1": "Schedule the Product Sync in Echo: invite Alex, Micah and Jan", "G2": "“Go together with…” → three invited",
    "G3": "all three accept, get up from the café and gather; the party sets off",
    "G4": "walking together; travel chat “Echo’s this way 👉” · “Right behind you!” · “Bringing the launch numbers 📈” (synthetic film-only lines)",
    "G5": "the lift lobby: the four gather at the doors, facing each other", "G6": "inside the car, the four together",
    "G7": "Floor 2: the doors open; the group steps out", "H1": "together across the Meeting Floor (front tracking)", "H2": "into Echo",
    "H3": "seated, paired across the table → Start meeting",
    "H4": "Share screen → the product walks Bon to the TV; he presents (real LiveKit share; placeholder slide, labelled)",
    "H5": "Stop sharing → the TV returns to Echo; Bon walks back to his seat",
    "I1": "Meeting Memory: the recurring Product Sync → its receipt", "I2": "Ask this meeting → a cited answer",
    "J1": "“Leaving?” → Go to the AI Lab → the doors open → out past the kalesa",
    "K1": "real traffic at the lay-by: jeepney, e-trike, kalesa, a car passing", "K2": "the staff car park", "K3": "the expansion crew at work",
    "K4": "a shared scooter: off the dock, up the east walk (speedometer 60s–80s, Off-road / Boost)", "K5": "the scooter onto the Lab lawn (crane)",
    "L1": "Settings → Graphics → Environment", "L2": "ONE continuous 360° orbit: day → sunset → night → rain",
    "L3": "the same framing in Halloween (night)", "L4": "…dissolving into White Christmas (day)",
    "C0": "the CAVE door", "C1": "inside the CAVE: the 270° screen", "C2": "the CAVE, wide",
    "N1": "the Toucan comes when called; its panel opens; Bon turns to it", "N2": "punch-in: “What did I miss?” → the catch-up (deterministic)",
    "U1": "AI LAB · the request, face to face → “Got it. Taking it to the Lab.” → takeoff", "SA": "the flight over the gates",
    "SC": "over the trees: the Lab revealed", "D1L": "Milo", "D2L": "Nova", "D3L": "Pip", "BR": "the brief at the perch",
    "W1": "Nova designs", "W3": "the handoff to Milo", "W4": "Milo builds", "W6": "Pip reviews",
    "Y1": "the result arrives: “Here’s your landing page.”", "Y2": "the result → Approve → “Approved. I’ll tell the team.”",
    "Z1": "sunset: the doors → “Leaving?” → Check Out → “Ready to wrap up your day?”", "Z2": "Log today’s work (one description)",
    "Z3": "“You’re checked out! 🎉” → View today’s log", "Z4": "out through the doors (low-angle three-quarter exterior) → cut to black",
}
# the 88 audited rows → (segments, status, note).  ✅ shown · 🟡 partly · ⛔ not in this cut (with the reason)
ROWS = [
    (1, "The idea", ["O1"], "✅", "narration over the real world"), (2, "Office View", ["O1", "O4"], "✅", ""),
    (3, "3D View (real C press)", ["A1"], "✅", ""), (4, "Living environment (light, rain, traffic)", ["M0", "K1", "L2"], "✅", "daylight · traffic · the orbit’s rain"),
    (5, "Colleagues present, name pills", ["M1", "M6"], "✅", "the full cast as loaded"), (6, "Player View (real C press)", ["X1"], "✅", ""),
    (7, "Gates refuse before check-in", ["O1"], "✅", ""), (8, "Kiosk check-in", ["O2"], "✅", ""), (9, "Company Hub", ["T01"], "✅", ""),
    (10, "Weather card: city forecast", ["T02"], "✅", "the card names its forecast city"),
    (11, "Environment follows real weather", ["L1"], "🟡", "the Environment panel’s Auto mode; the orbit uses its presets and claims nothing more"),
    (12, "Gates green, walk in", ["O3"], "✅", ""), (13, "Profile + pinned badges", ["T03"], "✅", "the profile column beside the feed"),
    (14, "Feed", ["T03"], "✅", ""), (15, "Achievements", ["T03b"], "✅", "single-beat flash"), (16, "Badge tiers", ["T03b"], "🟡", "visible in the achievements grid, one beat"),
    (17, "Your character", [], "⛔", "B1: the tab still renders the legacy glasses Bon — its frames are cut out (the feed flash starts after it)"),
    (18, "Search for people", ["T04"], "✅", ""), (19, "Hub button (dock)", ["T01"], "✅", ""), (20, "Rooms: labels + members", ["T05"], "✅", ""),
    (21, "Quests", ["T06"], "✅", ""), (22, "Missions", ["T06"], "✅", ""), (23, "Claim reward", ["T07"], "✅", ""),
    (24, "Global chat", ["E1"], "🟡", "the chat panel opened from the coworker menu; the global list itself is not shown"),
    (25, "Chat head", ["E1"], "🟡", "the chat panel; no separate chat-head beat"), (26, "Walk up → menu → Chat", ["E0", "E1"], "✅", "natural approach, facing"),
    (27, "Spatial chat seen by the other person", ["E1", "E2"], "🟡", "bubbles over Bon and over Micah in Bon’s view (Micah’s line sent by the film-rig client); the other person’s own screen is not shown"),
    (28, "Talking animation while typing", ["E1"], "🟡", "in the conversation take"), (29, "Presence labels", ["E1", "E2"], "✅", "In Conversation pills"),
    (30, "Video call", [], "⛔", "the only take (teaser 1, Bon’s recorded camera) stands the cast by the gate sensors under a dawn sky — the staging this revision replaces; a daytime recapture needs a live webcam, and webcams are never fabricated"),
    (31, "Camera sharing", [], "⛔", "same take as row 30"),
    (32, "Boards via DM, list, New board", ["F0", "F1"], "🟡", "the list + a live board; New board not shown"),
    (33, "Real-time drawing, named cursors", ["F1"], "🟡", "drawing yes; named cursors need a second client"),
    (34, "Board voice", [], "⛔", "not filmed (needs a second client + LiveKit audio)"), (35, "Toucan summarises the board", [], "⛔", "AI answer — no paid calls; not filmed"),
    (36, "Meetings: Memory tab", ["I1"], "✅", "film-DB demo meetings (dev fake generator)"), (37, "Recurring meeting: decisions + evidence", ["I1"], "✅", ""),
    (38, "Changes tracked across meetings", ["I1"], "🟡", "the continuity line in the receipt"), (39, "Ask the meeting → cited answer", ["I2"], "✅", "deterministic dev twin — no AI call"),
    (40, "Start a meeting", ["G1", "H3"], "✅", "schedule → Start meeting"), (41, "Invite people", ["G1"], "✅", ""),
    (42, "Go Together", ["G2", "G3", "G4"], "✅", "the real party protocol: invite, accept, gather"),
    (43, "Talk while walking", ["G4"], "✅", "the product’s travel chat; three synthetic film-only lines (no real employee speech)"),
    (44, "Lift to Floor 2", ["G5", "G6", "G7"], "✅", "four in the car"), (45, "Automatic seating", ["H3"], "🟡", "seated through the product’s own seat actions"),
    (46, "Screen share, presenter walks up", ["H4"], "✅", "real share; the slide is a labelled placeholder over the headless browser’s test source"),
    (47, "Chat during the presentation", [], "⛔", "not filmed"), (48, "Stop sharing → back to seat", ["H5"], "✅", "the TV shows the product’s own idle screen (see disclosures)"),
    (49, "End meeting (controls)", ["H3"], "🟡", "the meeting card"), (50, "Meeting floor Alpha…Mike", ["G1", "H1"], "✅", "the room list + the floor itself"),
    (51, "Room capacities", ["G1"], "🟡", "in the room grid, briefly"), (52, "Shared waiting area", ["H1"], "🟡", "passed on the way to Echo"),
    (53, "Hotel, 14 seats", ["G1"], "🟡", "in the room grid, briefly"), (54, "Status sign, locked room", [], "⛔", "not clearly shown"),
    (55, "Lift down", [], "⛔", "captured (T2Down) but cut for pace — the day continues from the ground floor"),
    (56, "“Leaving?” (not check-out)", ["J1"], "✅", "→ Go to the AI Lab"), (57, "Traffic, cars, kalesa", ["K1"], "✅", ""),
    (58, "Scooters", ["K4", "K5"], "✅", "dock → east walk → Lab lawn"), (59, "Parking lot, Cybertruck", ["K2"], "✅", "the angular pickup"),
    (60, "Speedometer on/off-road", ["K4"], "✅", "readable HUD: 60s–80s, Off-road / Boost"), (61, "Construction crew", ["K3"], "✅", ""),
    (62, "Team Map", ["F2"], "✅", "the last second holds the loaded map (static UI; the take ends there)"), (63, "Rewards: redeem coins", ["T09"], "✅", "(demo) labels in the catalog"),
    (64, "CAVE all-hands", ["C1", "C2"], "🟡", "the CAVE itself; no multi-person all-hands (no fabricated webcams)"),
    (65, "Toucan: call it, ask", ["N1", "N2"], "✅", "deterministic answer — no AI call"), (66, "Toucan catch-up", ["N2"], "✅", "“What did I miss?”"),
    (67, "AI Workforce entry", ["U1"], "✅", "AI LAB · SCRIPTED PREVIEW"), (68, "AI Lab agents", ["D1L", "D2L", "D3L"], "✅", ""),
    (69, "Toucan takes the request", ["U1"], "✅", "“Got it. Taking it to the Lab.”"), (70, "Toucan flies to the Lab, delegates", ["SA", "SC", "BR"], "✅", "the statue pass that clipped is cut"),
    (71, "Work continues while you’re away", ["W1", "W4"], "✅", ""), (72, "Nova → Milo handoff", ["W3"], "✅", ""), (73, "Pip reviews", ["W6"], "✅", ""),
    (74, "Result returns, in-app notification", ["Y1"], "✅", ""), (75, "Approve / Request Changes", ["Y2"], "✅", ""),
    (76, "Agent conversation", ["U1", "Y1"], "🟡", "the task chat panel"), (77, "Notifications center", ["T08"], "✅", ""),
    (78, "Settings: controls, audio", ["T11", "T12"], "✅", "single-beat flashes"), (79, "“Open the 3D office in”", ["T10"], "✅", "single-beat flash"),
    (80, "Day → sunset → night", ["L2"], "✅", "the 360° orbit"), (81, "Storm + weather indicator", ["L2", "L1"], "🟡", "rain (not storm) + the Environment panel’s weather tiles"),
    (82, "Graphics: Smooth / Full / Custom", ["L1"], "✅", ""),
    (83, "Halloween, White Christmas", ["L3", "L4"], "✅", "film DB only; temporary creator grant, revoked; both themes unpublished again"),
    (84, "Startup loading screen", [], "⛔", "captured (T2SeasonC, the theme reload) — left out: it read as a stall in the season dissolve"),
    (85, "“Ready to wrap up your day?”", ["Z1"], "✅", ""), (86, "Log today’s work → submit", ["Z2", "Z3"], "✅", "one description (the duplicate fixed); mock Zoho; Bon’s film-DB attendance"),
    (87, "Walk out", ["Z4"], "✅", "the last product interaction is the checkout"), (88, "Finale: logo", ["LOGO"], "✅", "on the score’s final chord"),
]
n = {s: sum(1 for r in ROWS if r[3] == s) for s in ("✅", "🟡", "⛔")}
CUES = [
    ("0:00.0–0:12.9", "same", "Morning: the gentle opening phrase", "arrival · refused · kiosk · through the gates"),
    ("0:12.9", "same", "first bloom", "“alive.” on the real Office→3D switch"),
    ("0:14.6–0:25.9", "same", "the beat grid (73.9 BPM) arrives; cuts every two beats, then every beat", "the rooms"),
    ("0:25.97", "same", "strong downbeat: the drive begins", "“you experience.” on the real 3D→Player switch"),
    ("0:29.2–0:43.8", "same", "fast strings; a tool every two beats, single-beat flashes as it accelerates", "the tools montage"),
    ("0:43.8–0:51.9", "same", "the drive eases (contrast)", "the conversation, unhurried"),
    ("0:51.9", "same", "accent", "punch-in on Micah’s reply"),
    ("0:52–1:05.0", "same", "lighter bed", "the reply · boards · the team map"),
    ("1:05.0–1:08.1", "same", "a breath", "invite · “Go together with…”"),
    ("1:08.1–1:49", "same", "re-entry, then the sustained journey", "the party sets off · travel chat · lift · Floor 2 · Echo · the presentation"),
    ("1:49–1:56.5", "same", "decay to near-silence", "“when the meeting ends…” · Meeting Memory"),
    ("1:56.77", "same", "re-entry", "the doors open: outside"),
    ("1:57–2:21", "same", "outdoor phrase; cuts on two-beat units", "traffic · car park · crew · the scooter"),
    ("2:21.3–2:22.6", "same", "a breath", "Settings → Environment"),
    ("2:22.71", "same", "re-entry", "the 360° orbit begins"),
    ("2:35.3–2:38.3", "same", "phrase end, decaying", "Halloween → White Christmas"),
    ("2:38.3–2:51.75", "same", "near-silent breakdown", "the CAVE · the Toucan"),
    ("2:51.9", "same", "re-entry: the build", "AI Lab: the request · takeoff · the reveal · the monkeys"),
    ("3:10.3–3:11.0", "same", "a breath", "Pip reviews"),
    ("3:11.25–3:20.5", "same", "THE climax — the only one", "the result · Approve (3:16.3)"),
    ("3:20.5–3:23.9", "same", "the climax decays", "sunset · the doors · Check Out"),
    ("3:23.9–3:31.2", "— (music out)", "hush: narration + evening ambience only", "today’s log · checked out · out the door"),
    ("3:31.2", "3:24.4 →", "the score’s own final chord, moved 6.8 s later", "cut to black → the logo"),
    ("3:31.2–3:35.4", "3:24.4–3:28.6", "the chord decays; fade", "OFFSHORLY · VIRTUAL OFFICE"),
]
RECAPTURED = [
    ("T2Talk", "the 0:50 scene rebuilt: Micah and Angelo mid-conversation facing each other, Kael crossing behind, Jan and Alex seated at the café; Bon walks up, they turn to him; menu → Chat; one exchange", "E0–E2"),
    ("T2Party4C (run 7)", "the four-person walk with the product’s travel chat (three synthetic film-only lines); run-6 takes kept for invite, lift and Floor 2", "G4"),
    ("T2Present", "real screen share from the meeting card: the product walks Bon to the TV; he presents; Stop sharing → back to his seat", "H4–H5"),
    ("T2Scoot2", "scooter exploration: mount at the reception dock, up the east walk with the speedometer, a crane onto the Lab lawn", "K4–K5"),
    ("T2SeasonPrep / T2SeasonH / T2SeasonC / T2SeasonRestore", "Halloween and White Christmas through the real Office Experience switch, matched orbit framing; restored afterwards", "L3–L4"),
    ("T2End", "the new final scene at sunset: Check Out → wrap-up → Log today’s work (one description) → checked out → View today’s log → low-angle exit", "Z1–Z4"),
]
RE_EDITED = [
    "AI Lab flight: the camera’s pass through the boxer statue (T2Lab4a 10.8–11.5 s) is cut — the flight goes from the gates straight over the trees.",
    "Tools montage: the profile flash now starts after the legacy “Your character” tab (it began on it for three frames before).",
    "Room montage: the last room is the Central Hub (the previous cut labelled a second AI-room shot as the Hub).",
    "Monkey introductions: each starts on its own close-up (the previous in-points caught the previous shot or the back of Milo’s head).",
    "CAVE: 1.2 s of black loading is trimmed to a cut from the door to the 270° screen.",
    "Toucan answer and Micah’s reply: punch-ins so the text reads.",
    "Stop sharing: the TV area carries the product’s own idle screen (the film-only slide overlay had re-asserted itself after the share ended).",
    "Team Map: starts as the tiles fill in instead of on a blank panel; the teaser-1 dawn video call is out (see row 30).",
]

L = []
L.append("# Offshorly Virtual Office · Teaser 2 · Director’s Revision (review cut)\n")
f = QA["file"]
L.append(f"**File:** `out/cinematic/teaser2/{f['name']}` · **{tc(tl['END'])}** (picture {tc(tl['PIC_END'])} + black/logo) · "
         f"{f['video']} · {f['audio']} · {f['size_mb']} MB\n")
lo = tl["loudness"]
L.append(f"**Mix:** {lo['integrated_lufs']} LUFS integrated · LRA {lo['lra_lu']} LU · true peak {lo['true_peak_dbtp']} dBTP (one linear gain for the whole film, then a peak limiter — the breakdowns stay quiet and the AI Lab stays the peak)\n")
L.append(f"**Coverage:** {n['✅']} of 88 rows shown in full · {n['🟡']} partly · {n['⛔']} not in the cut (each reason below).\n")
L.append("**Structure:** one day — morning arrival → alive → tools → people → ideas → Go Together → the meeting → Meeting Memory → out the door → "
         "the world around you (orbit, seasons) → CAVE → Toucan → AI Lab (the one climax) → end of the day: checkout is the last product interaction → "
         "Bon walks out → black → the logo on the score’s final chord. Nothing follows the checkout; “The office is just the beginning” is gone.\n")

L.append("## Narration — one narrator\n")
L.append("Voice: **Liam Hayes** (Magnific · ElevenLabs v3) for every line — the teaser-1 narrator, the brief’s second choice, regenerated as one consistent read (a stock voice; it imitates no real person). "
         "The first choice, Bon’s own voice, applies only “if convincing and authorised”: it needs Bon to record these 16 lines, or to authorise a clone from his reference clips explicitly. "
         "The table below doubles as the cue sheet for a one-for-one swap. Captions are burned in for review.\n")
L.append("| In | Out | Line |\n|---|---|---|")
for s in tl["script"]: L.append(f"| {tc(s['start'])} | {tc(s['end'])} | {s['text']} |")
gaps = [b["start"] - a["end"] for a, b in zip(tl["script"], tl["script"][1:])]
L.append(f"\nNo two lines overlap (the edit refuses to build otherwise; smallest gap {min(gaps):.2f} s). Syncs: “alive.” = the real Office→3D switch "
         f"({tc(tl['ALIVE'])}) · “you experience.” = the real 3D→Player switch ({tc(tl['EXP'])}) · the Floor 2 doors on the score’s accent ({tc(tl['DOORS02'])}) · "
         f"the office doors open on the re-entry ({tc(tl['DOOR_OUT'])}) · “bring it to life?” into the takeoff ({tc(tl['LIFTOFF'])}) · “taking shape?” into the reveal "
         f"({tc(tl['REVEAL'])}) · Approve inside the climax ({tc(tl['APPROVE'])}) · “create.” lands in the hush, then the final chord on black ({tc(tl['CHORD'])}).\n")

L.append("## Music cue map — one continuous score\n")
L.append("Score: one bespoke orchestral cue composed for this structure (Magnific · ElevenLabs music, 3:35). Film time = score time throughout, with one edit: the score’s final chord is moved to the cut to black.\n")
L.append("| Film | Score | Music | Picture |\n|---|---|---|---|")
for a, b, c, d in CUES: L.append(f"| {a} | {b} | {c} | {d} |")

L.append("\n## Sound design\n")
L.append("Every effect is levelled to a loudness target (UI ≈ −31 LUFS, world events −25…−29, beds −36…−42; the narration sits at ≈ −16.6) instead of a raw gain. "
         "New effects generated for this cut: sliding doors, scooter, rain, a passing car, toucan wings, sunset ambience. The rest is the owned teaser-1 library.\n")
L.append("| At | Effect | Target LUFS |\n|---|---|---|")
for s in tl["sfx"]: L.append(f"| {tc(s['at'])} | {s['file']} | {s['target_lufs']} |")
L.append("\n**Section loudness** (short-term, mean / max):\n")
L.append("| Section | From | To | Mean | Max |\n|---|---|---|---|---|")
for s in tl["sections"]: L.append(f"| {s['section']} | {tc(s['start'])} | {tc(s['end'])} | {s['short_term_lufs_mean']} | {s['short_term_lufs_max']} |")

L.append("\n## Shot-by-shot timeline\n")
L.append("| TC | Dur | Shot | Take [in–out] |\n|---|---|---|---|")
for s in tl["segments"]:
    extra = (f" + {s['hold_s']} s hold" if s.get("hold_s") else "") + (" · punch-in" if s["punch_in"] else "") + (" · TV patch" if s.get("tv_patch") else "")
    L.append(f"| {tc(s['start'])} | {s['dur']:.2f} | {DESC.get(s['key'], s['key'])} | {s['take']} [{s['src'][0]}–{s['src'][1]}]{extra} |")

L.append("\n## Recaptured for this revision\n")
L.append("| Take | What | In the cut |\n|---|---|---|")
for a, b, c in RECAPTURED: L.append(f"| {a} | {b} | {c} |")
L.append("\nRe-edited (no recapture needed):\n")
for r in RE_EDITED: L.append(f"- {r}")

L.append("\n## The 88 audited features\n")
L.append("| # | Feature | TC | Status | Note |\n|---|---|---|---|---|")
for num, name, keys, st, note in ROWS:
    L.append(f"| {num} | {name} | {', '.join(at(k) for k in keys) if keys else '—'} | {st} | {note} |")

L.append("\n## What is real, what is staged (disclosures)\n")
for d in QA["disclosures"]: L.append(f"- {d}")
L.append("\n## Seasonal themes — permission and publishing status\n")
for d in QA["seasons"]: L.append(f"- {d}")
L.append("\n## QA\n")
for d in QA["checks"]: L.append(f"- {d}")
L.append("\n## Credits used (Magnific)\n")
for d in QA["credits"]: L.append(f"- {d}")
L.append("\n## Storage\n")
for d in QA["storage"]: L.append(f"- {d}")
open(OUT, "w").write("\n".join(L) + "\n")
print("rows", n)
