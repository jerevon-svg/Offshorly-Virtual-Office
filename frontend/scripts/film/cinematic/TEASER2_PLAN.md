# Offshorly Virtual Office: Teaser 2 Plan (proof stage)

> **2026-10-09 — DIRECTOR’S REVISION rendered (current):** `out/cinematic/teaser2/offshorly-vo-teaser2_directors-cut.mp4` (3:35.4, one day, one narrator, one score; checkout is the last interaction). Report with narration timing, music cue map, recaptures, 88-row coverage, disclosures, seasonal-permission status, QA, credits and storage: `TEASER2_DIRECTORS_CUT.md`. Edit: `teaser2_v3.py`; report: `teaser2_v3_report.py`. The review cut below is superseded.

> **2026-10-09 — COMPLETE REVIEW CUT rendered:** `out/cinematic/teaser2/offshorly-vo-teaser2_review-cut.mp4` (3:58.8). Report, 88-row coverage with real timestamps, narration timing, QA and compromises: `TEASER2_REVIEW_CUT.md`. Edit: `teaser2_full.py`; report generator: `teaser2_report.py`.


**Status, 2026-10-09:** the low-cost proof is rendered and **full production is waiting for Bon's approval**.

* Nothing has been committed, pushed, published or deployed.
* No paid credits were spent: no Magnific, and no OpenAI calls were triggered.
* Teaser 1 is the reference for the story, the narration, the timing, the camera choreography and the transitions. **Its footage is not reused**: every frame in the proof was recaptured today with the current cast.

---

## 0. Revision 2 (after Bon's review of the 86 s proof)

**Revised proof:** `out/cinematic/teaser2/offshorly-vo-teaser2_proof2.mp4`
* 82.2 s, 1080p30, −15.3 LUFS.
* Timeline JSON beside it.
* Camera check sheets are in `evidence/`.

**What changed:**
* **Narration flows.** The opening is one continuous approved line (0:03.3–0:08.4). Silence is used only right before the two reveals: 2.0 s before "alive." and 0.9 s before "you experience."
* **ALIVE becomes an escalating room montage.**
  * It is shot with a **film-only perspective camera inside the real engine** (`R.setActiveCamera`), with the real cast seated at real desks.
  * Seven moves cut at 1.6 → 0.9 s: the drone over the whole office, Design, Dev, Gaming, Executive, AI and the Hub sweep.
* **No digital zoom anywhere.**
  * Tools play full-frame and whole, each at a different place with the world alive behind it.
  * Example: Search finds Micah while Micah sits at the café behind the panel.
* **The Toucan → Lab sequence is rebuilt on the bird's real flight path:**
  * A: an exterior wide three-quarter, with a dolly onto the bird.
  * B: a chase rig at flight height.
  * C: a rise and pull-back into the wide Lab reveal.
  * D: Milo, Nova and Pip close orbits.
  * The work: Nova designs → handoff → Milo builds → handoff → Pip reviews → Toucan flies the result home → in-app "View Result" → result → **Approve on the score's peak**.
* **New question-led narration:** "But what if an idea didn't have to wait…" (request) / "…for someone to bring it to life?" (takeoff) / "What if the next chapter of work…" (flight) / "…was already taking shape?" (reveal). Then the music carries the work.

**Revised storyboard (3:40.5):**

| Seg | TC | Picture and exact sync |
|---|---|---|
| A | 0:00.0–0:10.4 | Office View. Walk in → the lane goes red **on "But somewhere along the way"** (0:03.85) → kiosk → Check In (0:06.8) → green lane → the office opens. Riser. |
| B | 0:10.4–0:20.3 | **"alive." = the real Office→3D switch (0:10.40)** + the drop, then the room montage with escalating cuts on the score. "But a workplace isn't something you just look at." 0:12.4 |
| C | 0:20.3–0:25.4 | Push-in; "It's something…" 0:20.6 (the dropout) → **"you experience." = the real 3D→Player switch (0:22.50)** → run, jump; cut on the landing. |
| D | 0:25.4–0:43.0 | The music-only tool montage (all of rows 9–23, 77 in the full cut). |
| E–M | 0:43.0–2:53.0 | As in §3, each 9 s earlier: E 0:43–0:51 · F 0:51–1:04 · G 1:04–1:16 · H 1:16–1:30 · I 1:30–1:50 · J 1:50–1:58 · K 1:58–2:19 · L 2:19–2:34 · M 2:34–2:53. |
| N/O | 2:53.0–3:31.6 | The AI Lab, as in the proof's Part 2 (38.6 s; the **liftoff lands inside "…for someone to bring it to life?"**, and **the reveal completes on "shape?"**). |
| P | 3:31.6–3:40.5 | "Because the future of work isn't just about where we are…" over the drone → "…it's about what we can create." → logo. |

**Camera system:**
* Shots go through `teaser2.mjs` (`T2Rooms`, `T2Tools`, `T2Lab1…6b`, plus `T2RoomsCheck` / `T2LabCheck` stills-only passes).
* The film camera supports keyframed Catmull-Rom paths, a damped chase rig on a moving subject, and subject orbits.
* Shadows re-centre on the subject.
* Name pills and the agents' state pills stay correct because they project with the active camera.

**Camera limitations:**
* No collision avoidance.
  * Every path was cleared with stills first.
  * The chase rig grazed the Hub statues and a tree canopy; the proof hides both with motion cuts.
  * The final needs a higher chase line (about +40) over the Hub and above canopies.
* The product's 3D→Player switch is a near-instant swing, so "experience" lands on a cut-like change by nature.
* The Room tool showed nothing visible in Player view, so it was dropped from the proof.
* The Hub tool's background (the plinth wall) is weak; reshoot it.
* At the start of the Tasks beat the boom sits briefly close to Bon's head.

**Disk** is the hard capture constraint:
* Real-camera frames run about 250–300 KB each, and swap grew 4→7 GB during capture.
* A watchdog aborted one pass at 207 MB free. Nothing was lost or deleted.
* The full shoot needs ≥ 3 GB free per session (≥ 15 GB recommended).

**Still open:** B1–B3 (§2) and D1–D9 (§7).

---

## 1. What the approved teaser actually does (the DNA we keep)

Source: `out/teaser/virtual-office-video.mp4`, 63.87 s, built by `teaser/final_master.py`.

**Narration.** One continuous take: Magnific TTS, voice "Liam Hayes" (ElevenLabs). The exact words are:

> Remote work gave us freedom. / But somewhere along the way, we lost **some of** the little things that made an office feel… / alive. / But a workplace isn't something you **just** look at. / It's something… / you experience. / Because work isn't only meetings, messages and tasks. / It's birthdays. Recognition. Conversations. Celebrating wins. / And feeling like you're actually part of a team. / We're not just building a virtual office. / We're building the experience of working in a real office — virtually. / And we're only getting started.

The storyboard's opening differs in two places: "we lost **those** little things" and "something you look at". The proof keeps the approved words (see D1).

**Anchors (teaser 1):**

| Moment | Time |
|---|---|
| ALIVE: real C press, Office → 3D tilt; impact SFX on the word, music hit 1.1 s later | 9.80 |
| EXPERIENCE: hard cut into Player view | 16.60 |
| Spatial video call | 34.8 |
| Elevator ding | 52.13 |
| Doors open to black (the cliffhanger) | 56.27 |
| Logo card | 59.46 |

**Score** (`music.mp3`, 70 s; measured envelope):

| Music time | What happens |
|---|---|
| 0–11.5 | Quiet build |
| 12.0 | **Hit** |
| 12–36.5 | Drive (peak at 36.0) |
| 37–40.5 | **Silence** (the natural dropout) |
| 41.5–45.0 | Swell that **hits** at 45.0 |
| 45–64 | Decay tail |
| 65.5 | Final sting |

**Transitions:**
* the product's own C presses, cut on the word;
* short dissolves (0.3 s) inside the opening;
* hard cuts on the percussion in the montage;
* a dip to black into the CAVE;
* the elevator doors opening at 0.63× speed into a hard black.

---

## 2. Cast and avatar verification

**Rule** (Bon, 2026-10-09): use the full existing VO cast exactly as VO loads it.
* HumanBase where an approved update exists, and the existing production body otherwise.
* Nobody is hidden or checked out to control the cast.

**Runtime readout.** Every take logs it at its start and end through `__vo3d.avatar.runtime` and `__vo3d.coworkers.positions()`. It is identical in Office, 3D and Player view. Evidence: `out/cinematic/teaser2/evidence/cast_evidence.png` and the `t2check-*.png` stills.

| Person | Body actually loaded | Source |
|---|---|---|
| **Bon** | HumanBase: medium-long hair, no glasses, status "HumanBase bon · 36 units" | `human-base-v1/production/bon-v1.glb` + `garments/tee-offshorly`, `joggers-offshorly`, `sneakers` |
| Micah, Angelo, Clang, France | HumanBase | the approved frozen five (commit 6ef6f3f); `humanMounts.generated.json` = `{}`, so no other head is promoted |
| Alex | existing production GLB | `alex-v2-hq-idle9` |
| Jan | existing production GLB | `jan-v1-hq-idle9` |
| Jona | existing production GLB | `jona-v1-fix-hq` (not the untracked `jona-v2-hq`) |
| Kael | existing production GLB | `kael-v1-fix-hq-idle9` |
| Nicole | existing production GLB | `nicole-v1-fix-hq` |
| Lui | **no body** | not HumanBase-enabled and no legacy GLB; not in the film cast |

* All of these asset folders are tracked and unmodified.
* The uncommitted HumanBase work only touches HumanBase-only employees and long-face constants. It does not change how the frozen five render.

### Avatar integration blockers (resolve before expensive rendering)

| # | Blocker | Effect on the film | Recommendation |
|---|---|---|---|
| **B1** | The profile's **"Your character"** tab (row 17) renders `render3d/CharacterCanvas`, which has no HumanBase support | It shows Bon's **outdated glasses-era `bon-v3` model** | Hold row 17 until the profile preview wears the HumanBase body. That is a product change, out of scope here. Alternatively, film it for the existing-body cast only. |
| **B2** | The rig's interactive second clients (Micah's view in the spatial conversation, Go Together, live cursors) open **Classic Office** | Bon appears there as his legacy model or sprite | Capture second perspectives in a second **3D** client, one at a time on this 8 GB machine. |
| **B3** | HumanBase is committed locally (6ef6f3f) but **not on `main`/production** (the 10-07 release held it back) | The teaser would show a look users don't see yet | Ship 6ef6f3f before the teaser goes public, or accept that. |
| B4 | A HumanBase load failure silently falls back to the legacy GLB | One bad load reintroduces the old Bon | Mitigated: every take asserts `runtime`; all 7 takes passed. |
| B5 | HUD portraits: Bon, Micah, Angelo and Alex use the New Portraits; **France and Clang fall back to legacy sprite frames** | Their HUD cards look older than their 3D bodies | Avoid France and Clang HUD close-ups, or add portraits (product change). |
| B6 | Bon's check-in on the film DB was 20 h old, so the **"8 hours reached"** card sat on every frame | Clutter | Solved without touching data: start each capture day with the real kiosk check-in (the opening take does it). |

---

## 3. Corrected master timeline (3:47; the 4:00 maximum holds)

The storyboard's 3:40 forces about 1.2 s per beat in three montages. That is too fast for text UI and conflicts with "readable", so the corrections are:

| Segment | Correction | Reason |
|---|---|---|
| K (exterior) | **+6 s** | It holds 13 beats plus the workday insert: 20.8 s measured |
| G/H | re-split **12 + 14 s** | The Go Together party now rides the callback elevator |
| O (AI Lab) | **+4 s** | 9 readable beats need 20.6 s (measured in the proof) |
| N (bridge) | **−3 s** | The request overlaps the narration |
| L | absorbs the Settings beats | They lead naturally into the Environment controls |

| Seg | TC | Picture | Narration (on-screen captions) | Music | Rows |
|---|---|---|---|---|---|
| A | 0:00.0–0:16.0 | **Office View**: walk in → lane red → glide to the kiosk → card → Check In → green lane → the office opens. ✅ proof | "Remote work gave us freedom." 0:01.8 · "But somewhere along the way," 0:04.75 (on the red) · "we lost some of the little things that made an office feel…" ends 0:14.9 | Ambience + build; riser into… | 1 2 7 8 12 |
| B | 0:16.0–0:28.5 | **"alive." = the real C press**: an immediate camera drop into 3D, the full cast at the gates, a glide through the concourse, gaming, design and dev rooms. ✅ | "alive." 0:16.0 · "But a workplace isn't something you just look at." 0:19.4 | **Impact + hit on "alive"**; the drive | 3 5 4(part) |
| C | 0:28.5–0:34.4 | Push-in onto Bon's back → **"experience" = the real C press into Player view** → walk, sprint, jump. ✅ | "It's something…" 0:28.8 (**music drops out**) · "you experience." 0:31.2 | Dropout, then the swell's **hit on "experience"** | 6 |
| D | 0:34.4–0:52.0 | **Music-only montage**, cut on the jump's landing: the dock's Hub + cards ✅ · the weather card's city forecast (labelled as the forecast city, not the office) ✅ · the profile flip (badges, feed, achievements, tiers) · search · rooms · quests → missions → claim · notifications | (none) | The drive | 9 10 13–16 (17 ⚠️B1) 18 19 20 21 22 23 77 |
| E | 0:52.0–1:00.0 | Bon walks up to Micah → menu → Chat; a cut to **Micah's own 3D client** (⚠️B2); typing animation; presence labels | "Because the heart of a workplace was never the space…" · "It was always the people." | Warm lift | 26–29 |
| F | 1:00.0–1:13.0 | Music-only: global chat · chat head · video call + camera · boards list/New board · two clients' named cursors · board voice · **Toucan's board summary** (held readable) | (none) | Drive | 24 25 30–35 |
| G | 1:13.0–1:25.0 | Start meeting (Foxtrot) → invite → Go Together picker/toast/journey → talking while walking → **elevator callback in teaser 1's three framings** (walk-in, ride 01→02, doors) → the doors **open onto the finished Floor 2** | "And some ideas deserve more than a conversation." 1:16.5 | Hum + ding; a hit as the doors open | 40–44 |
| H | 1:25.0–1:39.0 | Crane over Floor 2: Alpha…Mike names, capacities, waiting area, Hotel 14, "In a meeting" + lock → auto-seating → screen share, presenter to the front → chat → stop → end (controls) | (none) | Music-led | 45–54 |
| I | 1:39.0–1:59.0 | **Meeting Memory hero**: Memory tab → Q4 Planning receipt (recurring decisions + evidence) → raised-again/decided continuity → a question → a **cited answer**, held readable | "Because a meeting may end…" · "but its best ideas shouldn't." | A sparse bed, then a lift | 36–39 |
| J | 1:59.0–2:07.0 | Lift down → Reception **"Leaving?"** menu → status/location label → out through the doors | "And why should possibility stop at the office door?" | Breath → kick | 55 56 |
| K | 2:07.0–2:28.0 | Music-only: traffic + kalesa · scooter mount/ride · Cybertruck lot · speedometer on/off-road · construction crew · Team Map (share spot, nearby) · Rewards redeem **(demo label visible + "DEMO CATALOG" tag)** → at dusk, **workday insert**: "Ready to wrap up your day?" → log → submit → walk out. This is clearly a check-out, a different thing from J's Leaving | (none) | Drive → settle | 57–63 85–87 |
| L | 2:28.0–2:43.0 | Settings: controls/audio · "Open the 3D office in" · graphics → Environment: day → sunset → night → storm + **weather pill** → Halloween → White Christmas (real reload + loader). Auto mode follows the *office location's* real weather; the storm is the Settings override, and the film says so (no claim beyond that) | "Because the world never stands still…" · "and neither should the world we work in." | Music-only payoff from 2:38 | 78–84 11 4 |
| M | 2:43.0–3:02.0 | **CAVE**: portal → start → allow → invite → cameras → screen share → chat (the penultimate spectacle) | "We may be miles apart…" · "but some moments bring us all together." | Biggest swell before the finale | 64 |
| N | 3:02.0–3:15.0 | Toucan: summon → ask → catch-up → AI Workforce · Preview → **"Preview a sample task"** ("Toucan, handle what Alex asked us to build.") → **Watch in Lab** = the product's own cut to the flight ✅ | "But what if together… we could go even further?" · "Imagine a workplace where an idea doesn't just begin…" · "…it begins to move." (on the flight) | Quiet build → hit on the flight | 65 66 67 69 70 |
| O | 3:15.0–3:36.0 | **AI LAB · SCRIPTED PREVIEW** (§6): brief → Nova → Milo → Pip → the agents' conversation → the result comes back → in-app "View Result" → **Approve** ✅ | (none: music-led) | Drive; **its peak on the Approve click** | 68 70–76 |
| P | 3:36.0–3:47.0 | The office after the approval → black → the real Offshorly Virtual Office logo + "VIRTUAL OFFICE" | "Because the future of work isn't just about where we are…" · "it's about what we can create." | Dropout → **the final swell hits on "create"**, then resolves | 88 |

The reserved lines ("The office is just the beginning", the personal journey paper) are not used.

---

## 4. Coverage crosswalk (all 88 rows)

**Legend:**
* ✅ in the proof (captured today with the verified cast)
* 📋 to film
* ⚠️ needs a decision or blocker (§2, §7)
* 🔍 production's own "Preview — scripted sample" labels plus the film's "AI LAB · SCRIPTED PREVIEW"
* 🏷 the "(demo)" label is visible

| # | Feature | Seg · TC | Shot / source | Status |
|---|---|---|---|---|
| 1 | The idea | A 0:00 | narration over the real world | ✅ |
| 2 | Office View | A 0:00–0:16 | T2Opening | ✅ |
| 3 | 3D View (real C press) | B 0:16 | T2Alive | ✅ |
| 4 | Living environment (light, rain, traffic) | B, K, L | daylight in B; rain in L; traffic in K | 📋 |
| 5 | Colleagues present, name pills | A–B | full live cast | ✅ |
| 6 | Player View (real C press) | C 0:31.2 | T2Experience | ✅ |
| 7 | Gates refuse before check-in | A 0:04 | T2Opening | ✅ |
| 8 | Kiosk check-in | A 0:07–0:09 | T2Opening | ✅ |
| 9 | Company Hub | D 0:34.4 | T2Hub (7 cards captured, 3 cut in) | ✅ |
| 10 | Weather card: city search + forecast | D 0:39.4 | T2Hub (Mandaluyong) | ✅ |
| 11 | Environment follows real weather | L | honest wording, auto vs override | 📋 |
| 12 | Gates green, walk in | A 0:09–0:13 | T2Opening | ✅ |
| 13 | Profile + pinned badges | D | profile flip | 📋 |
| 14 | Feed | D | profile flip | 📋 |
| 15 | Achievements | D | profile flip | 📋 |
| 16 | Badge tiers | D | profile flip | 📋 |
| 17 | Your character | D | profile tab | ⚠️ B1 |
| 18 | Search for people | D | search | 📋 |
| 19 | Hub button (dock) | D 0:34.6 | T2Hub | ✅ |
| 20 | Rooms: labels + members | D | room button | 📋 |
| 21 | Quests | D | tasks | 📋 |
| 22 | Missions | D | tasks | 📋 |
| 23 | Claim reward | D | tasks | 📋 |
| 24 | Global chat | F | chat | 📋 |
| 25 | Chat head | F | chat | 📋 |
| 26 | Walk up → menu → Chat | E | Player view, Micah | 📋 |
| 27 | Spatial chat seen by Micah | E | second **3D** client | ⚠️ B2 |
| 28 | Talking animation while typing | E | two-shot | 📋 |
| 29 | Presence labels | E–F | in shot | 📋 |
| 30 | Video call | F | LiveKit | ⚠️ D6 |
| 31 | Camera sharing | F | call tiles | ⚠️ D6 |
| 32 | Boards via DM, list, New board | F | boards | 📋 |
| 33 | Real-time drawing, named cursors | F | two clients | ⚠️ B2 |
| 34 | Board voice | F | voice | 📋 |
| 35 | Toucan summarises the board | F | real answer | ⚠️ D5 |
| 36 | Meetings: Memory tab, Ask your Memory | I | meetings panel | ⚠️ D5 |
| 37 | Recurring meeting: decisions + evidence | I | receipt | ⚠️ D5 |
| 38 | Changes tracked across meetings | I | continuity | ⚠️ D5 |
| 39 | Ask the meeting → cited answer | I | twin query | ⚠️ D5 |
| 40 | Start a meeting | G | meeting terminal | 📋 |
| 41 | Invite people | G | invite | 📋 |
| 42 | Go Together | G | multi-client | ⚠️ B2/D7 |
| 43 | Talk while walking | G | travel chat | 📋 |
| 44 | Lift to Floor 2 | G 1:19–1:25 | callback framings | 📋 D7 |
| 45 | Automatic seating | H | seats | 📋 |
| 46 | Screen share, presenter walks up | H | share | ⚠️ D6 |
| 47 | Chat during the presentation | H | bubbles | 📋 |
| 48 | Stop sharing → back to seat | H | (in action) | 📋 |
| 49 | End meeting (controls) | H | controls | 📋 |
| 50 | Meeting floor Alpha…Mike | G/H 1:25 | the doors open → crane | 📋 |
| 51 | Room capacities | H | signs | 📋 |
| 52 | Shared waiting area | H | social island | 📋 |
| 53 | Hotel, 14 seats | H | big room | 📋 |
| 54 | Status sign, locked room | H | door sign | 📋 |
| 55 | Lift down | J | elevator | 📋 |
| 56 | "Leaving?" + status/location label (not check-out) | J | Reception | 📋 |
| 57 | Traffic, cars, kalesa | K | exterior | 📋 |
| 58 | Scooters | K | chase | 📋 |
| 59 | Parking lot, Cybertruck | K | ride-by | 📋 |
| 60 | Speedometer on/off-road | K | HUD | 📋 |
| 61 | Construction crew | K | crew | 📋 |
| 62 | Team Map | K | map | 📋 |
| 63 | Rewards: redeem coins | K | catalog | 🏷 |
| 64 | CAVE all-hands | M | Cave + LiveKit | ⚠️ D6 |
| 65 | Toucan: call it, ask | N | summon ✅; real answer ⚠️ D5 | ✅/⚠️ |
| 66 | Toucan replies while away, catch-up | N | A2/A5 | ⚠️ D5 |
| 67 | AI Workforce entry | N | T2AiLab | ✅🔍 |
| 68 | AI Lab agents (Milo, Nova, Pip) | O | T2AiLab | ✅🔍 |
| 69 | Toucan takes the request | N | T2AiLab | ✅🔍 |
| 70 | Toucan flies to the Lab, delegates | N/O | T2AiLab | ✅🔍 |
| 71 | Work continues while you're away | O | the status line | ✅🔍 |
| 72 | Nova → Milo handoff | O | T2AiLab | ✅🔍 |
| 73 | Pip reviews | O | T2AiLab | ✅🔍 |
| 74 | Result returns, in-app notification | O | "View Result" card | ✅🔍 |
| 75 | Approve / Request Changes | O | result viewer → Approve | ✅🔍 |
| 76 | Agent conversation | O | task-chat insert | ✅🔍 |
| 77 | Notifications center | D | panel | 📋 |
| 78 | Settings: controls, audio | L | settings | 📋 |
| 79 | "Open the 3D office in" | L | settings | 📋 |
| 80 | Day → sunset → night | L | environment | 📋 |
| 81 | Storm + weather pill | L | environment | 📋 |
| 82 | Graphics: Smooth / Full / Custom | L | settings | 📋 |
| 83 | Halloween, White Christmas (reload) | L | experience gallery | 📋 |
| 84 | Startup loading screen | L | reload | 📋 |
| 85 | "Ready to wrap up your day?" | K | kiosk at dusk | 📋 |
| 86 | Log today's work → submit | K | writes Bon's own film-DB time log | ⚠️ D9 |
| 87 | Walk out | K | exit | 📋 |
| 88 | Finale: logo | P | real logo card | ✅ (card); finale picture 📋 |

**Count:** 21 ✅ in the proof, 2 partly (row 65: summon ✅, the answer ⚠️; row 88: card ✅, picture 📋), 49 📋, 15 ⚠️, 1 🏷. That is 88; nothing is dropped.

---

## 5. The proof (rendered 2026-10-09)

**Files:**
* `out/cinematic/teaser2/offshorly-vo-teaser2_proof.mp4`: 86.0 s, 1080p30, −15.3 LUFS (peak −1.4 dBFS), captions burnt in, "PROOF" tags, storyboard timecode.
* `out/cinematic/teaser2/offshorly-vo-teaser2_proof.timeline.json`: anchors plus each segment's source take and in/out points.
* Takes: `out/cinematic/takes_t2/T2{Opening,Alive,Experience,Hub,AiLab}.mp4` + `.json`, holding the marks, the runtime cast readouts and the job's status-line log. `_a`/`_b` are earlier attempts.
* Shots: `cinematic/teaser2.mjs`. Edit: `cinematic/teaser2_proof.py`.

**Part 1 (storyboard 0:00–0:43):**
* the opening;
* "alive." at **15.98**, on the measured first frame of the real Office → 3D switch, with the camera drop starting on that frame;
* "experience" at **31.13**, on the measured first frame of the real 3D → Player switch;
* the cut on the jump's landing into the music-only Hub montage;
* the weather card's forecast city.

**Part 2 (storyboard 2:58.6–3:40.0):**
* the request;
* "…it begins to move." on the product's own Watch-in-Lab cut;
* nine Lab beats under a persistent "AI LAB · SCRIPTED PREVIEW" tag (production's own Preview labels stay visible);
* Approve on the cue's peak;
* the final line, with the swell's hit on "create" → the logo.

**Narration:**
* The opening uses the approved teaser-1 take with its approved words. Cuts are placed in measured silences; the split after "way," falls in a −85 dB pause.
* New lines use a local macOS voice, marked SCRATCH VO on screen.

**Score:** the teaser-1 cue re-cut (temp).

**Mix:** loudnorm, then +2.6 dB and a −1.5 dBFS limiter; measured −15.3 LUFS integrated. The final master needs a two-pass loudnorm.

**Known proof-only compromises:**

| Area | Compromise | Final fix |
|---|---|---|
| The Lab | The product's Watch camera is high; the proof uses 1.25–1.34× punch-ins | §6 |
| Part 2's opening frame | Bon stands close to a dark counter | Pick a better mark |
| B-roll | B's concourse key looks through the glass rail at the gates (no clipping, but the panel edges cross the characters) | Raise that key's pitch |

---

## 6. AI Lab: the proposed final language

* **Words:**
  * No narration over the work. The orchestration speaks in the product's own language:
    * the AI Workforce status line ("Nova is working", "Nova is taking the work to Milo", "Pip is reviewing");
    * the agents' task conversation ("Build's ready for review." / "I'll check it.").
  * Both are real UI and are shown as readable inserts.
  * The narration returns only for the bridge ("…it begins to move.") and the final line.
* **Labels:**
  * A persistent, quiet "AI LAB · SCRIPTED PREVIEW" lower-third for the whole sequence.
  * Production's own "Preview — scripted sample, not real AI work" stays in frame on the status card and the result viewer.
* **Picture (final):** film-only cameras on the real scripted job, recaptured with the HUD's chat panels closed during the Lab beats:
  * a crane from the briefing perch;
  * station-level push-ins on each agent's name pill ("Nova · Design · Working");
  * the handoff walks followed side-on;
  * the Toucan's return carrying the packet;
  * then Bon's Player view for the in-app result.
* **Human in control:** hold the result viewer readable. The Approve click lands on the music's peak, and the "Approved" state is the payoff, before the closing line.

---

## 7. Decisions needed

| # | Decision | Options (recommendation first) |
|---|---|---|
| D1 | Narrator for Teaser 2 | (a) Teaser 1's voice (Liam Hayes, Magnific TTS) for continuity: a few credits, **needs approval**; (b) Bon records. Keep the approved opening words (recommended), or re-record the storyboard's wording |
| D2 | Score for 3:47 | Magnific music generation (credits, needs approval), or a licensed track. Shape: the teaser-1 grammar (build → hit on "alive" → dropout → hit on "experience" → … → dropout → hit on "create") |
| D3 | Disk | 3.2 GB free. macOS swap grew from 4 to 7 GB during capture and consumes disk. **Free ≥ 15 GB before full production.** |
| D4 | Blockers B1–B3 | Fix "Your character" first or hold row 17; a second 3D client for the two-perspective scenes; ship HumanBase (6ef6f3f) before publishing |
| D5 | Real AI answers and Meeting Memory | OpenAI calls on the film rig (Toucan answers, board summary, cited meeting answers; cents) + Q4-style demo meetings **seeded into the isolated film DB only**. Both need explicit approval |
| D6 | Real people on camera | Webcam clips with consent for the call and the CAVE; screen-share content Bon is happy to publish |
| D7 | Elevator callback | (a) Go Together party rides with Bon in teaser 1's framings (recommended: continuous and honest); (b) Bon alone, an exact callback, with +3 s for Go Together elsewhere |
| D8 | Runtime | Accept 3:47, or name what to shorten |
| D9 | Bon's own data | Bon's check-out → kiosk check-in, and a time-log entry for row 86, on the isolated film DB only. No colleague's data is ever touched. OK? |

---

## 8. Rig notes

**Start the rig** (detached, so it never takes Bon's :5173/:5174/:8001/:8002 down):
* `backend/run-film-backend.sh` (:8003)
* `npx vite --config scripts/film/vite.film.config.ts --mode film` (:5175)
* `node scripts/film/director.mjs serve --headless`, with `FILM_GRAPHICS=custom FILM_GRAPHICS_CUSTOM='{"renderScale":0.85}' FILM_DPR=1 FILM_JPEG=88 FILM_ENCODE=0 FILM_CLIPS=…/takes_t2`

**Load the teaser-2 shots.** Append one line to `shots.mjs`, and remove it again afterwards:
```js
Object.assign(SHOTS, (await import(`./cinematic/teaser2.mjs?v=${Date.now()}`)).teaser2({ attendance, view, placeBon, walkPuppet, walkTo, closePanels, hideHint, hidePathOverlay, yawTo, until, camHold }));
```

**Takes.** `FILM_FFMPEG=… FILM_CLIPS=… bash cinematic/take.sh T2<Shot>`. Run the opening first: its real kiosk check-in clears the "8 hours reached" card for the day's later takes.

**Proof.** `FILM_FFMPEG=… python3 cinematic/teaser2_proof.py out/cinematic/takes_t2 <scratch_vo> <work> out/cinematic/teaser2`. `REUSE=1` keeps rendered segments.
