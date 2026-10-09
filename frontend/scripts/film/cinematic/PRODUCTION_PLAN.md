# A Day Inside Offshorly: Production Plan (Phases 1–3)

> **SUPERSEDED on story, runtime and narration by [PRODUCTION_PLAN_v2.md](PRODUCTION_PLAN_v2.md)** (2026-10-08). The new plan is Office → 3D → Player, about 5:00, with a new script for Bon to record. Do not reuse the walkthrough audio as voice-over. The source audit, honesty flags and repro notes below still apply.

The cinematic master for Offshorly Virtual Office. This document covers the source audit, the feature coverage matrix, the narration script, the storyboard and the proof sequence. **Phase 4 (full production) waits for Bon's approval.**

Status: 2026-10-08. Proof sequence rendered. Nothing committed, pushed or published. No credits spent.

---

## 1. Source audit

### 1.1 Sources found

| Item | Location | Notes |
|---|---|---|
| **Walkthrough (source of truth)** | `~/Downloads/VO-Full-Walkthrough-Client-Final-With-CAVE.mp4` | 24:30.2, 1920×1080 at 30 fps, AAC 48 kHz. Burned-in captions. Identical copy at `My Drive/Virtual Office/VO-Full-Walkthrough.mp4`. |
| **Subtitles (source of truth)** | `~/Downloads/VO-Full-Walkthrough-Client-Final-With-CAVE.srt` | 420 cues, 0:00–24:30. Fully read and mapped below. |
| Earlier cuts | `VO-Full-Walkthrough.webm` (raw, 27:00), `-Polished.mp4/.srt`, `-Client.mp4/.srt` | Superseded. The CAVE section exists only in the Final cut. |
| Bon's voice | the walkthrough's audio track | Dry voice with no music bed. Noise floor −65 dBFS, −21.5 LUFS. Clean enough for reuse (see 1.3). |
| Previous teaser | `frontend/scripts/film/teaser/*` and `out/teaser/` | FINAL-v2 (63.9 s): takes, edit scripts, owned score and effects (`out/teaser/audio`, Magnific-generated; see `teaser/ASSETS.md`). Its narration is a stock TTS voice ("Liam Hayes") and is **not reused**. |
| Film rig | `frontend/scripts/film/{director,shots,puppets,seed}.mjs`, `backend/run-film-backend.sh`, `backend/film-db.sh` | Headless Chrome on the M1 GPU (Metal), CDP screencast, Socket.IO puppets for the cast, an isolated film backend on :8003 (`dev_film.db`) and the :5175 film Vite server. |
| Brand | `out/final/offshorly-logo-reversed.png` (from `src/assets/brand/offshorly-logo.svg`) | Used on the end card. |

### 1.2 What was filmed, and from which build

* **Production build only.** The film frontend runs from a read-only `git archive` of **`origin/main` (c68144a)** in the scratchpad. The working tree on `vo-v1-v2-integration` has unreleased HumanBase avatars switched on by default, and those must not appear. The working-tree backend differs from production only in Postgres schema handling, which is a no-op on the film's SQLite DB.
* Every walkthrough feature was checked against `origin/main` source (26 feature groups, all present).
* The film DB was backed up before use (`scratchpad/dev_film.before-cinematic.db`). Two film-clean Hub cards were added through the real API: a survey ("Quick pulse") and a What's new card ("New: Go Together").

### 1.3 Narration tooling (local only; Bon's voice never leaves the machine)

* whisper.cpp, built locally in the scratchpad with Metal, base.en model, DTW token alignment. Used for word timing and for **verifying every excerpt by re-transcribing the cut**.
* `cinematic/vo.py` places each cut in the longest true silence between word markers. `cinematic/islands.py` maps speech islands. A few phrases were hand-set from the 10 ms energy envelope.
* Every proof excerpt was verified word for word (see 6.3).

### 1.4 Voice synthesis: investigated, not available without approval

* The Magnific account (Premium, **101,514 credits**) has **no cloned "My Voice"** for Bon. Its voice changer only maps to stock catalog voices.
* Synthesizing new lines in Bon's voice would need a **new voice clone**, which means uploading his recording to Magnific/ElevenLabs. **Not done; requires explicit approval.**
* **Recommendation: record the 8 pickup lines in 7.3** (about 5 minutes with the same laptop mic as the walkthrough). Everything else uses his original recording.

### 1.5 Music and effects (licensing)

* The proof uses the **already-owned teaser cue** (`music.mp3`, 70 s, Magnific music generation) plus the owned teaser effects library and the world's own rain (recorded live from the engine's audio).
* A ~9.5-minute master needs about 6 new cues. Quote (read-only `simulate_cost`): **Google Lyria 3 Pro, 160 credits per 180 s cue**, so roughly 960 credits for the score. ElevenLabs music is 6,000 credits per 300 s and is not recommended. **Needs approval.** Usage rights follow the Magnific Premium terms; Bon/legal to confirm for public LinkedIn use.

### 1.6 Gaps and risks

| # | Issue | Impact | Ask |
|---|---|---|---|
| G1 | **Disk: about 0.9 GB free (99% full).** Rendering at 2× density pushed macOS swap to 2.8 GB. | Full production needs about 15 GB of working space. | **Free ~15 GB** before Phase 4. |
| G2 | Video call and CAVE camera need a camera feed. The rig's `bon-camera.mjpeg` is a stand-in. | A real face makes those scenes. | A **15–20 s webcam clip of Bon** (or approve the stand-in). |
| G3 | Screen share (meeting and CAVE) needs real slide content. | Shown on camera. | Choose the deck or page to present. |
| G4 | Toucan Q&A, board summary and "Ask the meeting" call the company OpenAI key. | Small cost (well under $1). | Approve OpenAI usage on the film rig. |
| G5 | Meeting memory, compare and "Ask the meeting" need the Q4 Planning demo sessions in the film DB (they live on the :8002 rig). | Required for S17. | Approve seeding equivalent demo meetings into the film DB. |
| G6 | Score for the full master. | See 1.5. | Approve ~960 credits, or supply licensed tracks. |
| G7 | 8 pickup lines. | See 7.3. | Record them, or approve a clone. |
| G8 | Homebrew cannot install bottles on macOS 12 (it tried to compile llvm and rust). The interrupted attempt was cleaned up and cmake 4.4.2 relinked. | None now. | Nothing. |

---

## 2. Production status flags (what can and can't be shown faithfully)

| Flag | Feature | Finding | Film treatment |
|---|---|---|---|
| ⚠️F1 | Weather → environment (01:49) | The Hub card shows each person's chosen city. The 3D world's live weather follows the **office's fixed location (Manila)**, not the card. For Bon (Mandaluyong) the sky is the same. | Avoid implying a per-person link. Show the live sky matching the forecast, or use pickup P11. |
| 🔍F2 | AI Lab orchestration (18:34–22:13) | Production labels it **"Preview — scripted sample, not real AI work."** Execution is a scripted mock. | Present it as a **preview** with the product's labels visible. Drop "real work is happening" and "it's coding it." Pickup P05 frames it honestly. |
| ⚠️F3 | "Notify you on your phone" (21:39) | No phone or push delivery found. The in-app notification is real. | Show the in-app notification only. Don't say "phone." |
| ⚠️F4 | Checkout projects (24:11) | The film rig runs Zoho in **mock** mode, so project names are mock (production pulls real Zoho projects). | Real UI. Use neutral names on screen. |
| 📎F5 | Video call / CAVE camera | Needs a camera feed (G2). | Bon's clip, or a labelled stand-in. |
| 📎F6 | Second-person views (Micah sees the chat indicator; Go Together party) | Needs a second real client. The rig supports extra clients; 3D second views are heavy on 8 GB RAM. | Capture each person's view sequentially and cut between them (no fake UI). |
| ℹ️F7 | Visible but not narrated in the walkthrough | Status selector (Available), Level/XP/Coins strip, Classic Office tile in Settings, startup loading screen (12:00). | Covered incidentally. Classic Office gets a 1 s cameo in S27. |

---

## 3. Feature inventory and coverage matrix

**Legend.** WT = walkthrough timecode. ✅ production, demonstrable on the rig. ⚠️ / 🔍 / 📎 see section 2. In the narration column, **O mm:ss** is an original excerpt at that walkthrough time and **P##** is a pickup line (7.3). Durations are estimates in the master. Camera abbreviations: PV = Player view (perspective), 3D = explore view (orthographic), OV = Office view, OTS = over the shoulder.

| # | WT | Feature and interaction | St | Scene | Real UI / gameplay to capture | Camera | Narration | Est. |
|---|---|---|---|---|---|---|---|---|
| 1 | 00:00–00:47 | Premise: remote work is free but lonely; "the experience of a real office, virtually" | ✅ | S1–S2 | Night rain, empty office, Bon alone; the real Environment switch to morning | 3D crane down; locked-off time-lapse | O 00:19–00:41 | 23s |
| 2 | 00:47–01:03 | Gates refuse entry until check-in (lanes go red) | ✅ | S4 | Checked-out Bon steps into the lane; red sensors | 3D ¾ push-in | O 00:53–01:03 | 8s |
| 3 | 01:03–01:10 | Check in at the reception kiosk | ✅ | S5 | Kiosk card → **Check In** → "Checking you in…" | 3D orbit + 1.85× punch-in (4K) | O 01:06 "Check in." | 7s |
| 4 | 01:06–01:26 | Company Hub after check-in: Kudos, What's new, surveys, town hall, birthdays | ✅ | S6 | The real carousel, slide by slide | Hub at 1.15× | O 01:06–01:24 | 15s |
| 5 | 01:26–01:49 | Weather slide: choose a city → your area + 3-day forecast | ✅ | S7 | "Choose a city" → Mandaluyong → live WeatherAPI forecast | UI at 1.15× | O 01:33–01:44 | 11s |
| 6 | 01:49–01:53 | Environment follows real weather | ⚠️F1 | S7/S8 | Live sky in the world | Exterior | P11 (optional) | 3s |
| 7 | 01:53–02:00 | Gates turn green; walk in | ✅ | S8 | Lanes green as Bon passes; crane reveal; letterbox opens | 3D crane up | O 01:58–02:00 | 8s |
| 8 | 02:00–02:07 | Office view (top-down) | ✅ | S9 | OV with the cast moving | OV slow push | O 02:00–02:07 | 5s |
| 9 | 02:08–02:25 | 3D view: orbit to see rooms and architecture | ✅ | S9 | Press C, real orbit across rooms | 3D orbit | O 02:08–02:25 | 9s |
| 10 | 02:25–02:40 | Player view: control your character | ✅ | S9 | Press C, walk and sprint along the concourse | PV tracking | O 02:31–02:40 | 8s |
| 11 | 02:42–02:54 | Profile: badges and pinned badges | ✅ | S10 | Profile panel | PV OTS → panel punch-in | O 02:45–02:54 | 5s |
| 12 | 02:54–03:00 | Feed: kudos and birthday greetings received | ✅ | S10 | Feed tab with the Kudos and birthday posts (from S6 actions) | UI | O 02:54–03:00 | 4s |
| 13 | 03:00–03:13 | Achievements ("Regular"); tracked missions and tasks | ✅ | S10 | Achievements grid | UI | O 03:00–03:13 | 5s |
| 14 | 03:13–03:35 | Rewards as badges; progressive tiers bronze → platinum | ✅ | S10 | Badge detail: progression tiers | UI punch-in | O 03:13–03:35 | 6s |
| 15 | 03:36–03:40 | Your character | ✅ | S10 | "Your character" preview | UI | O 03:36–03:39 | 3s |
| 16 | 03:40–03:47 | Search for teammates | ✅ | S11 | Search "Mi" → Micah | PV + UI | O 03:40–03:47 | 4s |
| 17 | 03:47–03:50 | Hub button (reopen the Company Hub) | ✅ | S11 | Dock → Hub | UI | O 03:47–03:50 | 2s |
| 18 | 03:50–04:10 | Rooms: list → room members (Design Room: Bon, Micah) | ✅ | S11 | Room details, Design Room members | OV room focus | O 03:50–04:10 | 6s |
| 19 | 04:11–04:42 | Quests: gamified onboarding journey | ✅ | S12 | Tasks → Quests ("You know your way around!") | UI | O 04:13–04:42 | 9s |
| 20 | 04:42–05:02 | Missions: daily and weekly (log time, walk up to a coworker, chat…) | ✅ | S12 | Missions tab ("Make today count.") | UI | O 04:42–05:02 | 8s |
| 21 | 05:02–05:05 | Claim rewards | ✅ | S12 | Claim → reward FX flies to the HUD | PV wide | O 05:02–05:05 | 4s |
| 22 | 05:05–05:27 | Global chat | ✅ | S13 | Chats panel: DMs and groups | UI | O 05:11–05:24 | 6s |
| 23 | 05:27–05:30 | Minimize chat to a chat head | ✅ | S13 | Minimize → chat head | UI | O 05:27–05:30 | 3s |
| 24 | 05:30–05:59 | Walk up to a colleague → menu (Chat/Call/Approach/Profile) → spatial conversation | ✅ | S14 | Bon walks to Micah; real interaction menu; "Chat" | PV tracking → OTS | O 05:36–06:05 | 9s |
| 25 | 06:05–06:29 | Spatial chat indicator; Micah sees it and opens it | 📎F6 | S14 | Bubble over Bon; Micah's own client opens the chat | Two-shot + Micah's view | O 06:14–06:29 | 7s |
| 26 | 06:29–06:53 | Talking animation while typing (both sides) | ✅ | S14 | Typing → talking animation | Two-shot | O 06:33–06:53 | 7s |
| 27 | 06:55–07:13 | Start a video call from the conversation | 📎F5 | S15 | Call → accepted → live video floats above them | PV two-shot | O 06:55–07:08 | 7s |
| 28 | 07:13–07:21 | Camera sharing visible to both | 📎F5 | S15 | Both see the feed | PV | O 07:14–07:21 | 4s |
| 29 | 07:22–07:47 | Whiteboard (Miro-like), opened from a DM | ✅ | S16 | DM → Boards → "With Micah" board | UI | O 07:28–07:47 | 6s |
| 30 | 07:47–08:18 | Real-time collaboration: drawing, typing, live named cursors | 📎F6 | S16 | Both clients drawing; Micah's cursor label | Board UI, split | O 07:53–08:18 | 10s |
| 31 | 08:19–08:36 | Board voice session (join voice, no call needed) | ✅ | S16 | "Join voice" → voice state | UI | O 08:24–08:36 | 5s |
| 32 | 08:36–09:19 | Ask Toucan to summarize the board | ⚠️G4 | S16 | Ask Toucan → "Can you tell me what this board is all about?" → summary | UI | O 08:40–09:19 | 10s |
| 33 | 09:19–09:59 | Team Map: share location, meet nearby; last position saved | ✅ | S22 | Map → My location (Mandaluyong) → teammates nearby → stop sharing | UI map | O 09:25–09:59 | 12s |
| 34 | 09:59–10:27 | Rewards: redeem coins (coffee or lunch voucher) | ✅ | S23 | Rewards catalog → a voucher | UI | O 10:04–10:27 | 9s |
| 35 | 10:27–10:39 | Meetings: schedule + memory | ⚠️G5 | S17 | Meetings panel (Upcoming / Memory) | UI | O 10:31–10:39 | 4s |
| 36 | 10:39–11:16 | Recurring meeting: compare with the last session, new evidence, who decided, timestamped quotes | ⚠️G5 | S17 | "VO Product Sync — Q4 Planning" receipt and continuity | UI scroll | O 10:41–11:16 | 11s |
| 37 | 11:16–11:20 | Track changes across meetings | ⚠️G5 | S17 | Continuity "raised again / decided" rows | UI | O 11:16–11:20 | 3s |
| 38 | 11:20–11:40 | Ask the meeting ("What did we decide?") → answer with sources | ⚠️G4/G5 | S17 | Twin query → cited answer | UI | O 11:20–11:40 | 8s |
| 39 | 11:45–12:10 | (Setup: three browsers; startup loading screen) | ℹ️F7 | — | Loading screen cameo (optional) | — | — | 0–2s |
| 40 | 12:10–12:19 | Start a meeting; Alex takes a seat (Foxtrot) | ✅ | S18 | Alex's client starts the meeting | PV | O 12:10–12:19 | 4s |
| 41 | 12:19–12:27 | Invite people to the meeting | ✅ | S18 | "Invite to this meeting" list | UI | O 12:22–12:27 | 3s |
| 42 | 12:27–13:01 | Go Together: invite a colleague; party walks to the meeting | 📎F6 | S18 | Invite → accept → both walk together | PV tracking pair | O 12:33–13:01 | 10s |
| 43 | 13:01–13:31 | Talk while walking (travel chat) | ✅ | S18 | "Are you ready?" bubbles while walking | PV side-track | O 13:08–13:31 | 6s |
| 44 | 13:31–13:37 | Elevator to the second floor | ✅ | S18 | Real lift ride 01 → 02 | PV in the car | O 13:31–13:37 | 5s |
| 45 | 13:38–13:50 | Automatic seating on arrival | ✅ | S18 | Characters find seats | 3D room | O 13:38–13:48 | 5s |
| 46 | 13:50–14:04 | Screen share; presenter walks to the front | ⚠️G3 | S18 | Share screen → Alex walks to the front | 3D room | O 13:50–14:06 | 7s |
| 47 | 14:06–14:16 | Others chat during the presentation | ✅ | S18 | "hey" bubbles | 3D | O 14:06–14:16 | 4s |
| 48 | 14:16–14:31 | Stop sharing → presenter returns to seat | ✅ | S18 | Return walk | 3D | O 14:16–14:31 | 4s |
| 49 | 14:31–14:36 | End or leave the meeting | ✅ | S18 | End meeting | UI | O 14:27–14:36 | 3s |
| 50 | 14:38–14:59 | Meeting floor: rooms Alpha…Mike (NATO), each with a capacity | ✅ | S19 | Floor tour | 3D crane over the floor | O 14:43–14:59 | 6s |
| 51 | 14:59–15:09 | Capacities: Golf 2, Foxtrot 3 | ✅ | S19 | Room signs | PV | O 14:59–15:09 | 4s |
| 52 | 15:09–15:16 | Shared waiting area | ✅ | S19 | Social island | PV | O 15:09–15:16 | 3s |
| 53 | 15:16–15:24 | Hotel: the biggest room, 14 seats | ✅ | S19 | Hotel room | PV | O 15:16–15:24 | 4s |
| 54 | 15:25–15:39 | Room status (Available / In a meeting); locked rooms need permission | ✅ | S19 | Door sign + lock | PV close | O 15:25–15:39 | 5s |
| 55 | 15:45–15:59 | Back down to the first floor | ✅ | S20 | Lift down | PV | O 15:53–15:59 | 3s |
| 56 | 15:59–16:14 | Go outside without checking out: tell Reception; status changes | ✅ | S20 | Reception "Leaving?" → choice → status label | PV + UI | O 15:59–16:14 | 8s |
| 57 | 16:14–16:23 | The outside world: moving traffic, cars, kalesa | ✅ | S21 | Street life | 3D or PV wide | O 16:14–16:23 | 5s |
| 58 | 16:24–16:33 | Scooters to roam | ✅ | S21 | Mount a scooter, ride | PV chase | O 16:24–16:33 | 5s |
| 59 | 16:33–16:42 | Parking lot (Cybertruck) | ✅ | S21 | Ride past the lot | PV | O 16:33–16:39 | 3s |
| 60 | 16:42–16:50 | Speedometer adapts on- vs off-road | ✅ | S21 | Scooter HUD speed change on grass | PV + HUD | O 16:42–16:50 | 4s |
| 61 | 16:51–17:15 | Expansion in progress: construction crew at work | ✅ | S21 | "AI Lab — expansion in progress" crew | PV / 3D | O 16:56–17:15 | 6s |
| 62 | 17:17–17:53 | CAVE: all-hands (start, allow, share screen, camera, invite, chat) | ⚠️G2/G3 | S24 | Championship Cave meeting | PV in the Cave | O 17:17–17:53 | 18s |
| 63 | 17:53–18:12 | Toucan Assistant: call it; ask anything office-wide or general | ⚠️G4 | S25 | Call the toucan (it flies to you) → ask | PV + UI | O 17:53–18:11 | 9s |
| 64 | 18:12–18:34 | Toucan handles messages while you're away, then catches you up | ⚠️G4 | S25 | Delegation on → away answers → catch-up | UI | O 18:12–18:34 | 9s |
| 65 | 18:34–18:53 | AI Lab: agents are monkeys (Milo, Nova, Pip) | 🔍F2 | S26 | Treehouse Lab, agents | 3D crane | O 18:37–18:53 + P05 | 6s |
| 66 | 18:53–19:38 | Orchestration: Toucan picks up a request from a meeting ("handle what Alex asked us to build") | 🔍F2 | S26 | Ask Toucan → job created (Preview label visible) | UI | O 19:01–19:38 | 9s |
| 67 | 19:38–20:11 | Toucan flies to the Lab and delegates (Nova design, Pip QA, Milo dev) | 🔍F2 | S26 | Real choreography | 3D follow the bird | O 19:45–20:05 | 8s |
| 68 | 20:11–20:35 | Work continues while you're away | 🔍F2 | S26 | Job progresses while away | 3D | O 20:13–20:35 (trimmed; no "real work" claim) | 5s |
| 69 | 20:35–20:52 | Handoff: Nova → Milo | 🔍F2 | S26 | Milo at the dev station | 3D | O 20:36–20:44 | 4s |
| 70 | 20:52–21:31 | Pip QA; why a bird and monkeys (mythology) | 🔍F2 | S26 | Pip reviewing | 3D | O 21:00–21:31 (trimmed) | 7s |
| 71 | 21:31–21:49 | The result comes back via Toucan; notification | 🔍F2 ⚠️F3 | S26 | Toucan returns; in-app notification | UI | O 21:31–21:36, 21:43–21:46 | 4s |
| 72 | 21:49–22:01 | Approve or request changes | 🔍F2 | S26 | Result viewer → Request changes | UI | O 21:49–22:01 | 5s |
| 73 | 22:02–22:13 | Real-time agent conversation | 🔍F2 | S26 | Task chat thread | UI | O 22:02–22:13 | 4s |
| 74 | 22:13–22:19 | Notifications center | ✅ | S27 | Notifications panel | UI | O 22:13–22:19 | 3s |
| 75 | 22:19–22:26 | Settings: controls, audio | ✅ | S27 | Settings panes | UI | O 22:19–22:26 | 3s |
| 76 | 22:26–22:52 | Environment: day → sunset → night | ✅ | S27 / Act 5 | Settings → Sunset (live change) | 3D wide | O 22:26–22:52 | 7s |
| 77 | 22:52–23:04 | Weather indicator: storm (clouds, rain) | ✅ | S27 | Storm in the world | PV | O 22:52–23:04 | 5s |
| 78 | 23:04–23:25 | Graphics modes: Smooth (recommended) / Full / Custom | ✅ | S27 | Settings → Graphics | UI + world | O 23:08–23:25 | 6s |
| 79 | 23:25–23:54 | Seasonal themes (White Christmas, Halloween; reload) | ✅ | S27 | Office experience gallery → White Christmas | 3D wide | O 23:25–23:54 | 8s |
| 80 | 23:55–24:23 | Checkout: start checkout → log time (project, time, notes) → submit | ⚠️F4 | S28 | Real checkout and time-log flow | PV + UI | O 23:55–24:23 | 14s |
| 81 | 24:23–24:30 | "Ciao ciao": walk out, end of day | ✅ | S28–S29 | Walk out into the night | PV → 3D crane out | O 24:23 + O 00:00 | 10s |

**81 rows, every one placed.** Rows 39 and 81 are setup or close. Nothing from the walkthrough has been dropped or merged into the background.

---

## 4. Story and structure

| Act | Scenes | Master TC (est.) | Time of day | Idea |
|---|---|---|---|---|
| I · The Problem | S1–S2 | 0:00–0:23 | Night, rain → dawn | Freedom, but alone. The storm passes. |
| II · Enter the World | S3–S11 | 0:23–2:20 | Morning | Arrival, refusal, check-in, the Hub, the office opens up (letterbox opens), how to see it, who you are here. |
| III · Working Together | S12–S19 | 2:20–5:55 | Late morning → early afternoon | Quests, chat, walking up to Micah, the call, the board, meetings that remember, going together, the meeting floor. |
| IV · More Than a Workplace | S20–S27 | 5:55–8:45 | Lunch → afternoon → **sunset** | Stepping out, the world outside, meeting nearby, rewards, the CAVE, Toucan, the AI Lab (preview), making it yours. The Settings sunset demo *is* the film's sunset. |
| V · The End of the Day | S28–S29 | 8:45–9:35 | Night | Checkout, "ciao ciao", the living office at night, the tagline, then Bon's own first line as the last: *"Welcome to Offshorly Virtual Office."* |

**Estimated master runtime: about 9:30** (± 30 s). This length is required to keep all 81 rows understandable.

Visual language:
* Act I is letterboxed 2.39:1 and graded cool.
* The bars open the moment the gates turn green, and the film stays full-frame from there.
* Establishing shots hide the HUD (the world only). Feature shots show the product exactly as an employee sees it.
* UI is captured at 2× density where small text needs a punch-in.

---

## 5. Timecoded storyboard and camera plan

Camera vocabulary on the real engine:
* **3D crane, orbit, dolly and truck:** keyframed `cameraModes.orbit` + `R.target`, rAF-smooth.
* **Player-view tracking / OTS / swing:** real WASD input; eased `player.look`.
* **Digital punch-ins:** from 4K captures.

| Scene | Master TC | Shots and camera | Real action captured |
|---|---|---|---|
| S1 Night | 0:00–0:17 | **[PROOF]** 3D crane from high over the rainy street (jeepney, kalesa, lamps) down to Bon alone outside the lit glass entrance | Night + rain (Environment), engine rain audio |
| S2 Dawn | 0:17–0:23 | **[PROOF]** locked-off: rain clears, dissolve to morning (time-lapse) | Real weather and time changes |
| S3 Arrival | 0:23–0:28 | **[PROOF]** PV tracking from behind; the auto door slides open | Real walk-in |
| S4 Refused | 0:28–0:36 | **[PROOF]** 3D ¾ push-in to the lanes as they go red | Real access gating |
| S5 Check-in | 0:36–0:43 | **[PROOF]** 110° orbit tracking Bon to the kiosk; 1.85× punch-in on the card; click | Real kiosk card and check-in |
| S6 Hub | 0:43–0:58 | **[PROOF]** five real slides, cut on Bon's words | Real carousel |
| S7 Weather | 0:58–1:10 | **[PROOF]** choose a city → typing → forecast | Live forecast |
| S8 Green | 1:10–1:24 | **[PROOF]** lanes green → crane up and back; letterbox opens; title card | Real gates and cast |
| S9 Three views | 1:24–1:46 | OV push → press C → 3D orbit across rooms → press C → PV run | Real view switching |
| S10 Who you are | 1:46–2:10 | PV OTS → profile panel; punch-ins on pinned badges, feed, Achievements, tier ladder, character | Real panels |
| S11 People and places | 2:10–2:20 | Search "Mi" → Micah; Hub button; OV focus on the Design Room → members | Real search and rooms |
| S12 Quests | 2:20–2:44 | UI Quests → Missions → Claim (reward FX flies to the HUD, PV wide) | Real quest and mission data |
| S13 Chat | 2:44–2:54 | Chats panel → minimize to a chat head | Real conversations |
| S14 Walk up | 2:54–3:22 | PV tracking Bon to Micah; menu; spatial chat; cut to Micah's client seeing the indicator; two-shot of talking animations | Two real clients |
| S15 The call | 3:22–3:34 | PV two-shot; the call connects; live video floats up | LiveKit call (G2) |
| S16 The board | 3:34–4:12 | DM → board; split of both clients drawing with live cursors; Join voice; Ask Toucan → summary | Real board, voice and Toucan (G4) |
| S17 Meetings remember | 4:12–4:42 | Meetings → Q4 Planning receipt → compare with last session → "What did we decide?" → cited answer | Real meeting memory (G5) |
| S18 Go Together | 4:42–5:34 | Alex starts the meeting in Foxtrot → invite → Go Together → pair walks and chats → lift → auto-seat → screen share, presenter walks up → chat → stop → end | Three real clients (G3) |
| S19 Meeting floor | 5:34–5:55 | 3D crane over the NATO rooms → Golf / Foxtrot signs → waiting area → Hotel (14) → status sign + lock | Real floor 2 |
| S20 Stepping out | 5:55–6:07 | Lift down → Reception "Leaving?" → status label changes | Real exit authorization |
| S21 Outside | 6:07–6:35 | Street life → scooter mount → chase cam past the parking lot (Cybertruck) → speedometer on grass → construction crew | Real exterior |
| S22 Meet nearby | 6:35–6:47 | Team Map → My location → teammates nearby → stop sharing | Real map (OpenFreeMap) |
| S23 Earned | 6:47–6:56 | Rewards catalog → coffee voucher | Real rewards |
| S24 CAVE | 6:56–7:14 | PV through the portal → start → share screen → camera → invite → chat | Real Cave (G2/G3) |
| S25 Toucan | 7:14–7:32 | Call the toucan (it flies in) → ask → delegation on → catch-up | Real Toucan (G4) |
| S26 AI Lab | 7:32–8:15 | 3D crane over the treehouse → Toucan delegates → Nova / Milo / Pip → result → Request changes → agent chat. **"Preview — scripted sample" label visible** | Production AI Workforce preview (F2) |
| S27 Make it yours | 8:15–8:45 | Notifications → Settings (controls, audio) → **Sunset** (the film's sunset) → storm → Graphics → White Christmas (+ Classic Office cameo) | Real settings and themes |
| S28 Clocking out | 8:45–9:05 | Night: Start checkout → Log today's work → Submit → "ciao ciao" | Real checkout (F4) |
| S29 The living office | 9:05–9:35 | PV: Bon walks out → 3D crane out over the lit campus, colleagues still inside → tagline → logo | Real world |

**End card text (on screen):** ONE PERSON CAN BUILD THE SPACE. / BUT IT TAKES EVERYONE TO MAKE IT A WORKPLACE. / THE OFFICE IS JUST THE BEGINNING. / [logo] Offshorly Virtual Office.

---

## 6. Phase 3: proof sequence (delivered)

### 6.1 Files

Location: `frontend/scripts/film/out/cinematic/` (git-ignored). Raw takes and cut lists are under `out/cinematic/takes/` and `out/cinematic/edit/`.
* `a-day-inside-offshorly_proof_master.mp4`: 90.6 s, 1080p30, −14 LUFS, 2.39:1 → 16:9.
* `a-day-inside-offshorly_proof_subtitled.mp4`: captions burned in.
* `a-day-inside-offshorly_proof.srt`

### 6.2 Contents

It covers scenes S1–S8, which are matrix rows 1–7 (plus the title card):
* rainy-night crane;
* storm-clears time-lapse;
* arrival;
* red gates;
* kiosk check-in;
* the five Hub slides;
* live Mandaluyong forecast;
* green gates and reveal with the letterbox opening;
* end card.

Score: the owned teaser cue, re-cut so its hit lands on the arrival and the swell on the reveal. Effects: the owned library plus the engine's own rain. Narration: Bon's original recording only, 20 excerpts. The proof uses no pickups.

### 6.3 Narration verification

Every excerpt was re-transcribed in isolation. Results:
* All match, except whisper's own mishearings: "parade" for "create", "good" for "green", "Turbese" for "surveys". In each case the waveform confirms the right word.
* The two single words that could not be cut cleanly were replaced with Bon's natural phrases: "important announcement" became "Give kudos," and "birthdays" became "Birthdays, those important stuff(s)."
* The "Now that you check in…" line was dropped so that "it's green now" lands on the green lights.

### 6.4 Known proof limitations

* The arrival take ends early because Player movement follows the camera swing. The fix is understood (no swing while walking).
* The nav-path debug line at the gates was fixed (the shots now call the rig's `hidePathOverlay`) and the take re-filmed.
* Bon's walk-in and the forecast are under cloud (live Manila weather) while the time-lapse morning is clear. That's a continuity choice to settle: live weather everywhere, or clear everywhere.

---

## 7. Narration

### 7.1 Approach

Bon's own voice throughout. About 90% of the master's narration comes from **re-edited excerpts of the walkthrough**, cut on verified silences:
* fillers removed (basically, like, "something like that");
* pauses re-timed to picture;
* level-matched (high-pass, gentle de-noise and de-ess, light EQ and compression, −14 LUFS master).

The tone moves from tutorial to story through picture, music and pacing rather than new words. A handful of pickups carry the story where the walkthrough has no line, and keep the AI Lab claims accurate.

### 7.2 Script outline (O = original excerpt at walkthrough time)

* **Act I:** O 00:19 "Working remotely is very common." / O 00:22 "It gave you freedom, convenience… but sometimes it feels lonely, working alone." / O 00:27 "That's why this virtual office comes in." / O 00:32 "We don't want to create just another virtual office, but we want to create the experience of working in a real office… virtually."
* **Act II:** O 00:43 "Let's start… with just a normal day." / O 00:53 "When you try to enter here, you cannot enter. It's red because you need to check in first." / O 01:06 "Check in." / "When you check in, you can see the Company Hub." / "Give kudos, updates, surveys… for example, like this town hall… birthdays, those important stuff." / O 01:33 "You can also see the actual area where you are in. For example, me, I'm in Mandaluyong. You can see the three-day forecast." / O 01:58 "As you can see, it's green now." / O 02:00–02:40 three views / O 02:45–04:10 tools, search, rooms.
* **Act III:** P02 → O 04:11–05:05 quests and missions / O 05:11–05:30 chat / O 05:36–06:53 "I walk up to Micah… spatial conversation… talking animation" / O 06:55–07:21 call / O 07:28–09:19 board, voice, Toucan / O 10:27–11:40 meetings memory / O 12:10–14:36 Go Together (trimmed) / O 14:43–15:39 meeting floor.
* **Act IV:** O 15:53–16:14 stepping out / O 16:14–17:15 outside / O 09:25–09:59 map / O 10:04–10:27 rewards / O 17:17–17:53 CAVE / O 17:53–18:34 Toucan / **P05** then O 18:37–22:13 AI Lab (trimmed, no "real work" claims) / O 22:13–23:54 settings, environment, themes.
* **Act V:** O 24:03 "So after a very long day…" → checkout → O 24:22 "Ciao ciao." / P07–P08 / **O 00:00 "…welcome to Offshorly Virtual Office."** (his first line becomes the last).

### 7.3 Pickup lines to record

Use the same mic and room as the walkthrough, at a relaxed, warm pace, with about 2 s of silence between takes. Record 2–3 takes of each.

| ID | Line | Where |
|---|---|---|
| P01 | "By nine, the office is already awake." | S9 (optional) |
| P02 | "Work isn't only tasks. It's the people you do them with." | Opens Act III |
| P05 | "Our AI Lab is still a preview, but this is where it's heading." | Before S26 (required for accuracy) |
| P07 | "One person can build the space." | Finale |
| P08 | "But it takes everyone to make it a workplace." | Finale |
| P09 | "The office is just the beginning." | Finale |
| P11 | "And the sky in here follows the real weather outside." | S7 (optional; replaces the ambiguous original) |
| P12 | "Even when you step away, the work keeps moving." | S26 (optional; replaces the overstated original) |

---

## 8. Deliverables plan (Phase 4–5)

1. **Cinematic master**, about 9:30, 1080p30, −14 LUFS: clean version plus a subtitled version, with `.srt`.
2. **LinkedIn cut**, about 75–90 s, derived from the master: night → arrival and Hub → spatial chat → board → Go Together → scooter → CAVE → AI Lab (preview) → sunset → checkout → tagline. Subtitled, `.srt`, plus a 1:1 or 4:5 crop if wanted.
3. **QC report**: every row of section 3 linked to its timestamp in the finished master, black-frame and loudness scans, and caption verification.

Tooling (reusable, untracked under `frontend/scripts/film/cinematic/`):
* `shots.mjs`: cinematic shots for the existing director;
* `take.sh`: record → mezzanine → free disk;
* `vo.py` / `islands.py`: narration cutting;
* `proof_edit.py`: the edit, which becomes the master edit.

---

## 9. Decisions needed from Bon (before Phase 4)

1. **Creative approval** of the proof, this storyboard and the narration approach (original recording plus the few pickups).
2. **Pickups:** record the lines in 7.3 (recommended) **or** approve creating a voice clone. The clone is not recommended; it uploads his voice.
3. **Music:** approve about 960 Magnific credits (six Lyria 3 Pro cues) **or** supply licensed tracks.
4. **Disk:** free about 15 GB.
5. **Webcam clip** (15–20 s) for the call and the CAVE, **and the screen-share content** for the meeting and the CAVE.
6. **OpenAI usage** on the film rig (Toucan, board summary, Ask the meeting), plus **seeding demo meetings** into the film DB.
7. **AI Lab framing:** OK to show it as a labelled preview in a public film?
8. **Weather continuity:** live sky (honest, overcast today) or a clear morning across all of Act II?

---

## 10. Reproducing the proof

1. **Production frontend.** `git archive origin/main frontend | tar -x -C <scratch>/prod`, then `cp -cR frontend/node_modules <scratch>/prod/frontend/` (APFS clone, ~5 s), then copy `out/bon-camera.mjpeg` and `out/silence.wav`.
2. **Hook the shots.** In the scratch copy's `shots.mjs` (never the repo's), append `Object.assign(SHOTS, (await import("…/cinematic/shots.mjs")).cine({ attendance, view, placeBon, walkPuppet, walkLine, closePanels, readAll, hideHint, hidePathOverlay, yawTo, until }))`.
3. **Rig.** `backend/run-film-backend.sh` (:8003); `npx vite --config scripts/film/vite.film.config.ts --mode film` from the scratch frontend (:5175). Then start the director with `FILM_GRAPHICS=custom FILM_GRAPHICS_CUSTOM='{"renderScale":0.85}' FILM_DPR=1 FILM_JPEG=95 FILM_ENCODE=0 FILM_CLIPS=<takes>`. Use `FILM_DPR=2` only for UI close-ups: it triggers swap on this 8 GB machine.
4. **Takes.** `cinematic/take.sh <Shot> <scratch>/prod/frontend/scripts/film` records one take, encodes the mezzanine and deletes the raw frames.
5. **Narration.** Extract with `ffmpeg -i ~/Downloads/VO-Full-Walkthrough-Client-Final-With-CAVE.mp4 -vn -ac 1 -ar 48000 final.wav` and a 16 kHz copy. Run whisper.cpp with `-ojf --dtw base.en -nfa` (DTW needs flash attention off). Build `dtw_words.json` (the saved copy is in `out/cinematic/edit/`). `vo.py` cuts; verify every cut by re-transcribing it in isolation.
6. **Edit.** `FILM_FFMPEG=… FILM_VO_SRC=<final.wav> python3 cinematic/proof_edit.py out/cinematic/takes out/cinematic/edit out/cinematic`.
7. **Film DB.** The pre-session state is `backend/dev_film.before-cinematic.db` (git-ignored).
