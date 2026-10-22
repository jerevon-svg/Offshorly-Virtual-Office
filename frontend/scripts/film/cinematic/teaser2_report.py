#!/usr/bin/env python3
"""FILM RIG ONLY — writes the Teaser 2 review-cut report (markdown) from the render's own timeline JSON, so every
timestamp in it is the cut's real one.   python3 teaser2_report.py <timeline.json> <report.md> <loudness-line> <free-space-line>"""
import json, sys

tl = json.load(open(sys.argv[1])); OUT = sys.argv[2]; LOUD = sys.argv[3] if len(sys.argv) > 3 else ""; FREE = sys.argv[4] if len(sys.argv) > 4 else ""
seg = {s["key"]: s for s in tl["segments"]}
def tc(x): return f"{int(x // 60)}:{x % 60:04.1f}"
def at(k): return tc(seg[k]["start"]) if k in seg else "—"
def span(a, b=None): b = b or a; return f"{tc(seg[a]['start'])}–{tc(seg[b]['start'] + seg[b]['dur'])}"

DESC = {
    "O1": "Office View: Bon walks in; the gate lane refuses him (red)", "O2": "the real kiosk card → Check In", "O3": "through the green lane",
    "O4": "the office opens around him", "A1": "“alive.” on the real Office→3D switch + the drop",
    "M0": "ALIVE montage: the whole office from the air", "M1": "Design Room: Micah and Angelo at their desks", "M2": "Dev room: Alex and Jan",
    "M3": "Gaming room: Clang and France", "M4": "Executive room: Kael and Nicole", "M5": "AI room: Jona", "M6": "the Central Hub",
    "X1": "push-in → “you experience.” on the real 3D→Player switch → run, jump",
    "D1": "Company Hub cards at the café", "D2": "the Hub’s weather card: the forecast city", "D3": "Profile: pinned badges + Feed",
    "D4": "Achievements + badge tiers", "D5": "Search “Mi” → Micah, sitting right behind the panel", "D6": "Rooms: names over the office",
    "D7": "Tasks in the Gaming room: Quests → Missions", "D8": "claim a reward", "D9": "Notifications",
    "E1": "a conversation with Alex in Player view (dawn light take)", "E2": "walk up → the coworker menu → Chat", "E3": "presence indicators",
    "E4": "global chat", "F1": "video call with Bon’s real camera", "F2": "Boards: a live whiteboard", "F3": "the Global Team Map",
    "G1": "Bon schedules the Product Sync in Echo and invites Alex, Micah and Jan", "G2": "the reminder → “Go together with…” → three invited",
    "G3": "all three accept: they get up from the café and gather with Bon", "G4": "walking together (front tracking)",
    "G5": "the group arrives at the lift; a pause facing each other; into the car (01)", "G6": "inside the car, the four together (wide)",
    "G7": "the doors open on the Meeting Floor (02) and the group steps out", "H1": "together across the Meeting Floor (front tracking)",
    "H2": "over the glass rooms into Echo", "H3": "four seats paired across the table → Start meeting → In Meeting",
    "I1": "Meeting Memory: the recurring Product Sync, its receipt (decisions + evidence)", "I2": "Ask this meeting → a cited answer",
    "J1": "the lift down (02)", "J2": "the doors: “Leaving?” → Go to the AI Lab → out past the kalesa",
    "K1": "real traffic passing the lay-by: jeepney, tricycle, e-trike, kalesa", "K2": "the staff car park: the angular pickup, exotics, sports bikes",
    "K3": "the expansion crew at work", "K4": "a shared scooter: mount, off-road 49 → road 96 km/h", "K5": "Rewards: the demo catalog",
    "K6": "Rewards: history (Approved)", "L1": "Settings: “Open the 3D office in”", "L2": "Settings: Controls", "L3": "Settings: Graphics",
    "L4": "Settings: Environment (time + weather; Auto follows the office’s real weather)",
    "L5": "ONE continuous 360° orbit: day → sunset → night → rain", "Z1": "night: the doors → “Leaving?” → Check Out → “Ready to wrap up your day?”",
    "Z2": "today’s work log", "Z3": "“You’re checked out!”", "Z4": "out into the night", "C1": "the CAVE: the portal → the 270° screen",
    "T1": "Toucan comes when called; Bon turns to face it", "T2": "“What did I miss?” → the catch-up",
    "U1": "AI LAB · Bon and the Toucan face to face: the request → “Got it. Taking it to the Lab.” → takeoff", "SA": "Bon watches the bird fly past",
    "SB": "the chase", "SC": "the rise: the Lab revealed", "SC2": "the treehouse", "D1L": "Milo", "D2L": "Nova", "D3L": "Pip", "BR": "the brief at the perch",
    "W1": "Nova designs", "W2": "Nova carries the work to Milo", "W3": "the handoff", "W4": "Milo builds", "W5": "Milo → Pip", "W6": "Pip reviews",
    "W7": "the Toucan carries the result home", "Y1": "in-app: the result arrives (View Result)", "Y2": "the result → Approve",
    "FIN": "the office from the air → the logo",
}
# the 88 audited rows → (segments, status, note).  ✅ shown · 🟡 partly · ⛔ blocked/absent (with the reason)
ROWS = [
    (1, "The idea", ["O1"], "✅", "narration over the real world"), (2, "Office View", ["O1", "O4"], "✅", ""),
    (3, "3D View (real C press)", ["A1"], "✅", ""), (4, "Living environment (light, rain, traffic)", ["M0", "K1", "L5"], "✅", "daylight · traffic · the orbit’s rain"),
    (5, "Colleagues present, name pills", ["M0", "M6"], "✅", "the full cast as loaded"), (6, "Player View (real C press)", ["X1"], "✅", ""),
    (7, "Gates refuse before check-in", ["O1"], "✅", ""), (8, "Kiosk check-in", ["O2"], "✅", ""), (9, "Company Hub", ["D1"], "✅", ""),
    (10, "Weather card: city forecast", ["D2"], "✅", "labelled as the forecast city"), (11, "Environment follows real weather", ["L4"], "🟡", "the Settings panel’s Auto mode; the orbit uses the Settings presets and says nothing more"),
    (12, "Gates green, walk in", ["O3"], "✅", ""), (13, "Profile + pinned badges", ["D3"], "✅", ""), (14, "Feed", ["D3"], "✅", ""),
    (15, "Achievements", ["D4"], "✅", ""), (16, "Badge tiers", ["D4"], "✅", ""),
    (17, "Your character", [], "⛔", "B1: the tab still renders the legacy glasses Bon — excluded rather than show an outdated avatar"),
    (18, "Search for people", ["D5"], "✅", ""), (19, "Hub button (dock)", ["D1"], "✅", ""), (20, "Rooms: labels + members", ["D6"], "✅", ""),
    (21, "Quests", ["D7"], "✅", ""), (22, "Missions", ["D7"], "✅", ""), (23, "Claim reward", ["D8"], "✅", ""), (24, "Global chat", ["E4"], "✅", ""),
    (25, "Chat head", ["E4"], "🟡", "the chat panel; no separate chat-head beat"), (26, "Walk up → menu → Chat", ["E2", "E1"], "✅", ""),
    (27, "Spatial chat seen by the other person", [], "⛔", "B2: needs a second 3D client"), (28, "Talking animation while typing", ["E1"], "🟡", "in the conversation take"),
    (29, "Presence labels", ["E1", "E3"], "✅", "In Conversation · In Call · status pills"), (30, "Video call", ["F1"], "✅", ""),
    (31, "Camera sharing", ["F1"], "✅", "Bon’s own recorded camera; no fabricated webcams"), (32, "Boards via DM, list, New board", ["F2"], "🟡", "the live board; the list is brief"),
    (33, "Real-time drawing, named cursors", ["F2"], "🟡", "drawing yes; named cursors need a second client (B2)"), (34, "Board voice", [], "⛔", "not filmed (needs a second client + LiveKit)"),
    (35, "Toucan summarises the board", [], "⛔", "AI answer — no paid calls; not filmed"), (36, "Meetings: Memory tab", ["I1"], "✅", "film-DB demo meetings (dev fake generator)"),
    (37, "Recurring meeting: decisions + evidence", ["I1"], "✅", ""), (38, "Changes tracked across meetings", ["I1"], "🟡", "the continuity line in the receipt"),
    (39, "Ask the meeting → cited answer", ["I2"], "✅", "deterministic dev twin — no AI call"), (40, "Start a meeting", ["G1", "H3"], "✅", "schedule → Start meeting → In Meeting"),
    (41, "Invite people", ["G1"], "✅", ""), (42, "Go Together", ["G2", "G3", "G4"], "✅", "the real party protocol: invite, accept, gather"),
    (43, "Talk while walking", ["G4"], "🟡", "conversational blocking only — no fabricated colleague speech"), (44, "Lift to Floor 2", ["G5", "G6", "G7"], "✅", "four in the car"),
    (45, "Automatic seating", ["H3"], "🟡", "seated through the product’s own seat actions"), (46, "Screen share, presenter walks up", [], "⛔", "not filmed (LiveKit share)"),
    (47, "Chat during the presentation", [], "⛔", "not filmed"), (48, "Stop sharing → back to seat", [], "⛔", "not filmed"),
    (49, "End meeting (controls)", ["H3"], "🟡", "the In Meeting controls card"), (50, "Meeting floor Alpha…Mike", ["G1", "H2"], "✅", "the room list + the floor itself"),
    (51, "Room capacities", ["G1"], "✅", "e.g. ECHO 10 seats"), (52, "Shared waiting area", ["H1"], "🟡", "passed on the way to Echo"),
    (53, "Hotel, 14 seats", ["G1"], "✅", "in the room list"), (54, "Status sign, locked room", [], "⛔", "not clearly shown"),
    (55, "Lift down", ["J1"], "✅", ""), (56, "“Leaving?” (not check-out)", ["J2"], "✅", "→ Go to the AI Lab"),
    (57, "Traffic, cars, kalesa", ["K1"], "✅", ""), (58, "Scooters", ["K4"], "✅", ""), (59, "Parking lot, Cybertruck", ["K2"], "✅", "the angular pickup"),
    (60, "Speedometer on/off-road", ["K4"], "✅", "49 off-road · 96 on the road"), (61, "Construction crew", ["K3"], "✅", ""), (62, "Team Map", ["F3"], "✅", ""),
    (63, "Rewards: redeem coins", ["K5", "K6"], "✅", "(demo) labels in the catalog"), (64, "CAVE all-hands", ["C1"], "🟡", "the CAVE itself; no multi-person all-hands (no fabricated webcams)"),
    (65, "Toucan: call it, ask", ["T1", "T2"], "✅", "deterministic answer — no AI call"), (66, "Toucan catch-up", ["T2"], "✅", "“What did I miss?”"),
    (67, "AI Workforce entry", ["U1"], "✅", "AI LAB · SCRIPTED PREVIEW"), (68, "AI Lab agents", ["D1L", "D2L", "D3L"], "✅", ""),
    (69, "Toucan takes the request", ["U1"], "✅", "“Got it. Taking it to the Lab.”"), (70, "Toucan flies to the Lab, delegates", ["SA", "SC", "BR"], "✅", ""),
    (71, "Work continues while you’re away", ["W1", "W7"], "✅", ""), (72, "Nova → Milo handoff", ["W3"], "✅", ""), (73, "Pip reviews", ["W6"], "✅", ""),
    (74, "Result returns, in-app notification", ["Y1"], "✅", ""), (75, "Approve / Request Changes", ["Y2"], "✅", ""),
    (76, "Agent conversation", ["U1", "Y1"], "🟡", "the task chat panel"), (77, "Notifications center", ["D9"], "✅", ""),
    (78, "Settings: controls, audio", ["L2"], "🟡", "Controls shown; Audio not in this cut"), (79, "“Open the 3D office in”", ["L1"], "✅", ""),
    (80, "Day → sunset → night", ["L5"], "✅", "the 360° orbit"), (81, "Storm + weather indicator", ["L5", "L4"], "🟡", "rain (not storm) + the Environment panel’s weather tiles"),
    (82, "Graphics: Smooth / Full / Custom", ["L3"], "✅", ""),
    (83, "Halloween, White Christmas", [], "⛔", "Bon’s film-DB account has no experience.creator; publishing needs that grant (an access-control change) — awaiting Bon"),
    (84, "Startup loading screen", [], "⛔", "not in this cut"), (85, "“Ready to wrap up your day?”", ["Z1"], "✅", ""),
    (86, "Log today’s work → submit", ["Z2", "Z3"], "✅", "mock Zoho; Bon’s film-DB attendance"), (87, "Walk out", ["Z4"], "✅", ""),
    (88, "Finale: logo", ["FIN"], "✅", ""),
]
n = {s: sum(1 for r in ROWS if r[3] == s) for s in ("✅", "🟡", "⛔")}

L = []
L.append("# Offshorly Virtual Office · Teaser 2 · Complete Review Cut\n")
L.append(f"**File:** `out/cinematic/teaser2/offshorly-vo-teaser2_review-cut.mp4` · **{tc(tl['END'])}** (picture {tc(tl['PIC_END'])} + logo card) · 1080p30 · {LOUD}\n")
L.append(f"**Coverage:** {n['✅']} of 88 rows shown in full · {n['🟡']} partly · {n['⛔']} not in the cut (each reason below).\n")
L.append("## Narration (as placed in the cut)\n")
L.append("| In | Out | Voice | Line |\n|---|---|---|---|")
for s in tl["script"]: L.append(f"| {tc(s['start'])} | {tc(s['end'])} | {s['voice']} | {s['text']} |")
L.append("\nNo two lines overlap (enforced by the edit). Key syncs: “alive.” = the real Office→3D switch "
         f"({tc(tl['ALIVE'])}) · “you experience.” = the real 3D→Player switch ({tc(tl['EXP'])}) · the doors open on Floor 2 on the score’s hit "
         f"({tc(tl['DOORS02'])}) · the orbit’s sunset/night/rain on three accents ({tc(tl['SUNSET'])} / {tc(tl['NIGHT'])} / {tc(tl['RAIN'])}) · "
         f"“shape?” on the Lab reveal ({tc(tl['REVEAL'])}) · Approve on the score’s peak ({tc(tl['APPROVE'])}) · the final hit on “create” ({tc(tl['CREATE'])}).\n")
L.append("## Shot-by-shot timeline\n")
L.append("| TC | Dur | Shot | Take [in–out] |\n|---|---|---|---|")
for s in tl["segments"]: L.append(f"| {tc(s['start'])} | {s['dur']:.1f} | {DESC.get(s['key'], s['key'])} | {s['take']} [{s['src'][0]}–{s['src'][1]}] |")
L.append("\n## The 88 audited features\n")
L.append("| # | Feature | TC | Status | Note |\n|---|---|---|---|---|")
for num, name, keys, st, note in ROWS:
    where = ", ".join(at(k) for k in keys) if keys else "—"
    L.append(f"| {num} | {name} | {where} | {st} | {note} |")
L.append(f"\n{FREE}\n")
open(OUT, "w").write("\n".join(L) + "\n")
print("rows", n)
