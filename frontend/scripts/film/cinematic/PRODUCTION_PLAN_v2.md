# A Day Inside Offshorly: Revised Plan (v2)

**Five minutes. Office View → 3D View → Player View. Every walkthrough feature on screen. A new script in Bon's voice.**

Status (2026-10-08): the revised proof is rendered. **Full production is waiting for Bon's approval.** Nothing has been committed, pushed or published, and no credits have been spent. No voice has been cloned or uploaded.

This plan supersedes `PRODUCTION_PLAN.md` (v1) on story, runtime and narration. The v1 audit findings still apply.

---

## 1. What changed from v1

| | v1 (first proof) | v2 (this plan) |
|---|---|---|
| Story | Night street → arrival | **Office View → 3D View → Player View**, then the working day, then the finale |
| Runtime | About 9:30 | **About 5:00** (see 5.2 for the honest range) |
| Narration | Excerpts from the walkthrough recording | **A new script written from scratch**, for Bon to record. The proof uses a labelled scratch voice |
| Proof | 90 s | 97 s, re-shot in the new structure; approved v1 footage reused where it fits |
| Staging | Straight-line walks (Jona went through the desk) | Every colleague walk uses the product's pathfinder; lanes and pillars mapped; QA list in section 8 |

---

## 2. Recheck of the walkthrough

**Method.**
* The SRT was re-read in full.
* The video was rescanned frame by frame at **every on-screen change**: 242 change points detected across 24:30, of which 167 frames in the UI-dense ranges were inspected.
* The v1 pass had sampled every 12 s; this one catches brief UI states.

**Result.** All 81 v1 rows were confirmed. The pass found sub-interactions that v1 only implied; they are now explicit rows (marked NEW in section 3):

1. Presence labels during interactions ("In Conversation", "In Call", "In Meeting").
2. The Room button's room names over the floor plan.
3. The Boards list with "New board".
4. Toucan's "Preview a sample task" entry (AI Workforce preview).
5. The Meetings Memory tab with "Ask your Memory".
6. Go Together's partner picker, invite toast and journey card.
7. The meeting controls panel.
8. Reception's "Leaving?" menu and the status/location label.
9. The weather indicator pill.
10. The "Open the 3D office in" default-view setting.
11. The startup loading screen on reload.
12. The checkout prompt "Ready to wrap up your day?".

**Visible but not demonstrated** (cameo only, not required):
* the status selector;
* the Level/XP/Coins strip (visible on the HUD throughout);
* the Classic Office tile;
* an avatar holding a phone in a few Player-view frames. Its origin is unverified, and it is not claimed as a feature.

---

## 3. Coverage matrix (88 rows, film order)

**Columns.**
* **WT:** walkthrough timecode.
* **Planned TC:** time in the 5:00 master.
* **Final TC:** filled after the master renders. For rows already in the revised proof, it shows the proof timestamp.

**Status.**
* ✅ filmed (proof v2)
* ♻️ approved v1 footage reused
* 📋 to film
* ⚠️ needs a decision (section 10)
* 🔍 production labels it as a preview

| # | WT | Feature | Behavior shown (real) | Planned shot | Required real UI / interaction | Dur | Planned TC | Final TC (proof v2) | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 00:00–00:47 | The idea (remote work, togetherness) | Story frame | Act 1–2 | Narration over the real world | — | 0:00 | 0:00 | ✅ |
| 2 | 02:00–02:07 | **Office View** | Top-down floor: rooms, scale, people | 1.1 Night: Reception → whole floor → rooms | Office view, focus rects | 20s | 0:00 | 0:00–0:19 | ✅ |
| 3 | 02:08–02:25 | **3D View** | Real C press; plan tilts into 3D; orbit | 2.1 + 2.4 | C key, explore camera | 6s | 0:20 | 0:19–0:26 | ✅ |
| 4 | (atmosphere) | Living environment: lighting, rain, traffic | Night rain over the street; rain clears to morning | 2.2–2.3 | Environment + weather system | 14s | 0:26 | 0:25–0:40 | ♻️ |
| 5 | (02:36, 15:55) | Colleagues present (name pills), arrivals | Cast through the gates into the Hub | 2.4 | Live presence | 12s | 0:40 | 0:40–0:52 | ✅ |
| 6 | 02:25–02:40 | **Player View** | Real C press into third person; walk in | 3.1 | C key, WASD | 7s | 0:52 | 0:52–0:58 | ✅ |
| 7 | 00:47–01:03 | Gates refuse entry until check-in | Lane lights red | 3.2 side-on → behind | Access gating, lane sensors | 8s | 0:59 | 0:58–1:07 | ✅ |
| 8 | 01:03–01:10 | Check in at the kiosk | E → kiosk card → Check In | 3.3 OTS close | PlayerTargeting, kiosk card | 3s | 1:07 | 1:07–1:10 | ✅ |
| 9 | 01:06–01:26 | Company Hub (kudos, updates, survey, town hall, birthday) | Real carousel, 5 slides | 3.4 cut on each word | Hub carousel | 8s | 1:10 | 1:10–1:18 | ✅ |
| 10 | 01:26–01:49 | Weather card: city search, 3-day forecast | Change city → "Mandaluyong" → live forecast | 3.5 | WeatherForecastCard (WeatherAPI) | 6s | 1:18 | 1:18–1:24 | ✅ |
| 11 | 01:49–01:53 | Environment follows real weather | Shown in Act 2; wording kept honest | 2.3 | — | — | 0:35 | 0:35 | ✅ (see F1) |
| 12 | 01:53–02:00 | Gates turn green; walk in | Lane C goes green; out onto the concourse | 3.6 | Gates, permitted access | 7s | 1:25 | 1:25–1:32 | ✅ |
| 13 | 02:42–02:54 | Profile and pinned badges | Profile panel | 3.7 | Profile panel | 2.5s | 1:32 | — | 📋 |
| 14 | 02:54–03:00 | Feed (kudos and birthday greetings) | Feed tab | 3.7 | Feed | 2s | 1:34 | — | 📋 |
| 15 | 03:00–03:13 | Achievements | Achievements grid | 3.7 | Achievements | 2.5s | 1:36 | — | 📋 |
| 16 | 03:13–03:35 | Badge tiers bronze → platinum | Tier ladder | 3.7 punch-in | Badge detail | 2.5s | 1:39 | — | 📋 |
| 17 | 03:36–03:40 | Your character | Character preview | 3.7 | Profile | 2s | 1:41 | — | 📋 |
| 18 | 03:40–03:47 | Search for people | "Mi" → Micah | 3.8 | Search | 2.5s | 1:44 | — | 📋 |
| 19 | 03:47–03:50 | Hub button | Dock → Hub | 3.8 | Dock | 1s | 1:46 | — | 📋 |
| 20 | 03:50–04:10 | Rooms: names over the plan; room members (NEW: labels) | Room button → labels → Design Room → Bon, Micah | 3.8 | Room details | 4.5s | 1:47 | — | 📋 |
| 21 | 04:11–04:42 | Quests (gamified onboarding) | "You know your way around!" | 4.1 | Tasks → Quests | 3s | 1:52 | — | 📋 |
| 22 | 04:42–05:02 | Missions (daily and weekly) | "Make today count." | 4.1 | Missions tab | 2.5s | 1:55 | — | 📋 |
| 23 | 05:02–05:05 | Claim rewards | Claim → reward FX flies to the HUD | 4.1 | Claim | 2.5s | 1:57 | — | 📋 |
| 24 | 05:05–05:27 | Global chat | Chats list | 4.2 | Chat panel | 3s | 2:00 | — | 📋 |
| 25 | 05:27–05:30 | Minimize to a chat head | Minimize | 4.2 | Chat head | 2s | 2:03 | — | 📋 |
| 26 | 05:30–05:59 | Walk up → menu (Chat/Call/Approach/Profile) → Chat | PV walk to Micah; real menu | 4.3 | Interaction menu | 4s | 2:05 | — | 📋 |
| 27 | 06:05–06:29 | Spatial chat indicator; Micah sees it | Bubble; cut to Micah's own client | 4.3 | Second real client | 3s | 2:09 | — | 📋 ⚠️G6 |
| 28 | 06:29–06:53 | Talking animation while typing | Both animate | 4.3 two-shot | Typing state | 3s | 2:12 | — | 📋 |
| 29 | 05:57–07:20 | **NEW** Presence labels (In Conversation / In Call) | Labels change | 4.3–4.4 | StatusLabel | (in shot) | 2:12 | — | 📋 |
| 30 | 06:55–07:13 | Video call from the conversation | Call → live video floats up | 4.4 | LiveKit call | 3s | 2:17 | — | 📋 ⚠️G2 |
| 31 | 07:13–07:21 | Camera sharing | Both see the feed | 4.4 | Call tiles | 2s | 2:20 | — | 📋 ⚠️G2 |
| 32 | 07:22–07:47 | Boards via DM (**NEW**: list, New board) | Boards → "With Micah" | 4.5 | Boards panel | 2s | 2:22 | — | 📋 |
| 33 | 07:47–08:18 | Real-time drawing, typing, named cursors | Two clients draw | 4.5 split | Excalidraw realtime | 4s | 2:24 | — | 📋 ⚠️G6 |
| 34 | 08:19–08:36 | Board voice (no call needed) | Join voice | 4.5 | Voice state | 2s | 2:28 | — | 📋 |
| 35 | 08:36–09:19 | Ask Toucan to summarize the board | Real summary | 4.5 | Toucan on board | 4s | 2:30 | — | ⚠️G4 |
| 36 | 10:27–10:39 | Meetings (**NEW**: Memory tab, Ask your Memory) | Upcoming / Memory | 4.6 | Meetings panel | 2s | 2:34 | — | ⚠️G5 |
| 37 | 10:39–11:16 | Recurring meeting: compare, decisions, evidence | Q4 Planning receipt | 4.6 scroll | Receipt | 3s | 2:36 | — | ⚠️G5 |
| 38 | 11:16–11:20 | Track changes across meetings | Raised-again / decided rows | 4.6 | Continuity | 1.5s | 2:39 | — | ⚠️G5 |
| 39 | 11:20–11:40 | Ask the meeting → answer with sources | Chips → cited answer | 4.6 | Twin query | 3.5s | 2:40 | — | ⚠️G4/G5 |
| 40 | 12:10–12:19 | Start a meeting (Alex, Foxtrot) | Meeting starts | 4.7 | Meeting terminal | 2s | 2:44 | — | 📋 ⚠️G6 |
| 41 | 12:19–12:27 | Invite people | Invite list | 4.7 | Invite | 1.5s | 2:46 | — | 📋 |
| 42 | 12:27–13:01 | Go Together (**NEW**: picker, invite toast, journey card) | Accept → party walks | 4.7 | Go Together | 3s | 2:47 | — | 📋 ⚠️G6 |
| 43 | 13:01–13:31 | Talk while walking | "Are you ready?" bubbles | 4.7 side-track | Travel chat | 3s | 2:50 | — | 📋 |
| 44 | 13:31–13:37 | Lift to floor 2 | Ride 01 → 02 | 4.7 | Elevator | 2.5s | 2:53 | — | 📋 |
| 45 | 13:38–13:50 | Automatic seating | Find seats | 4.7 | Meeting seats | 2s | 2:56 | — | 📋 |
| 46 | 13:50–14:04 | Screen share; presenter walks to the front | Share → walk up | 4.7 | Screen share | 3s | 2:58 | — | ⚠️G3 |
| 47 | 14:06–14:16 | Chat during the presentation | "hey" bubbles | 4.7 | Spatial chat | 1.5s | 3:01 | — | 📋 |
| 48 | 14:16–14:31 | Stop sharing → back to seat | Return | 4.7 | — | 1.5s | 3:02 | — | 📋 |
| 49 | 14:31–14:36 | End meeting (**NEW**: controls panel) | End | 4.7 | Meeting controls | 1.5s | 3:04 | — | 📋 |
| 50 | 14:38–14:59 | Meeting floor: rooms Alpha…Mike | Crane over floor 2 | 4.8 | Floor 2 | 2.5s | 3:06 | — | 📋 |
| 51 | 14:59–15:09 | Room capacities (Golf 2, Foxtrot 3) | Signs | 4.8 | Room signs | 1.5s | 3:08 | — | 📋 |
| 52 | 15:09–15:16 | Shared waiting area | Social island | 4.8 | — | 1.5s | 3:10 | — | 📋 |
| 53 | 15:16–15:24 | Hotel: 14 seats | Big room | 4.8 | — | 1.5s | 3:11 | — | 📋 |
| 54 | 15:25–15:39 | Status sign; locked rooms | "In a meeting" + lock | 4.8 | Door sign | 1.5s | 3:13 | — | 📋 |
| 55 | 15:45–15:59 | Lift down | Ride 02 → 01 | 4.9 | Elevator | 1.5s | 3:14 | — | 📋 |
| 56 | 15:59–16:14 | Step out without checking out (**NEW**: "Leaving?" menu, status/location label) | Reception menu → label | 4.9 | Exit authorization | 4.5s | 3:16 | — | 📋 |
| 57 | 16:14–16:23 | Outside: traffic, cars, kalesa | Street life | 4.10 | Exterior traffic | 2s | 3:20 | — | 📋 (♻️ night street) |
| 58 | 16:24–16:33 | Scooters | Mount and ride | 4.10 chase | Scooters | 3s | 3:22 | — | 📋 |
| 59 | 16:33–16:42 | Parking lot (Cybertruck) | Ride past | 4.10 | — | 1.5s | 3:25 | — | 📋 |
| 60 | 16:42–16:50 | Speedometer adapts on- vs off-road | HUD speed change on grass | 4.10 | Scooter HUD | 2s | 3:27 | — | 📋 |
| 61 | 16:51–17:15 | Expansion in progress: construction crew | Crew working | 4.10 | Construction crew | 2.5s | 3:29 | — | 📋 |
| 62 | 09:19–09:59 | Team Map: share location, meet nearby | My location → nearby | 4.11 | Team Map | 5s | 3:31 | — | 📋 |
| 63 | 09:59–10:27 | Rewards: redeem coins | Catalog → redeem | 4.12 | Rewards | 4s | 3:36 | — | ⚠️F5 |
| 64 | 17:17–17:53 | CAVE all-hands (immersive room, start, allow, share, camera, invite, chat) | Portal → Cave → meeting | 4.13 | Cave + LiveKit | 10s | 3:40 | — | ⚠️G2/G3 |
| 65 | 17:53–18:12 | Toucan: call it, ask anything | Bird flies in; answer | 4.14 | Toucan | 4s | 3:50 | — | ⚠️G4 |
| 66 | 18:12–18:34 | Toucan replies while you're away; catch-up | Delegation + catch-up | 4.14 | Toucan A2/A5 | 6s | 3:54 | — | ⚠️G4 |
| 67 | (09:02) | **NEW** AI Workforce entry ("Preview a sample task") | Preview label | 4.15 | Toucan panel | 1s | 4:00 | — | 🔍 |
| 68 | 18:34–18:53 | AI Lab agents (Milo, Nova, Pip) | Treehouse Lab | 4.15 | AI Workforce (preview) | 2s | 4:01 | — | 🔍 |
| 69 | 18:53–19:38 | Toucan takes a request ("handle what Alex asked") | Job card | 4.15 | Toucan → job | 2s | 4:03 | — | 🔍 |
| 70 | 19:38–20:11 | Toucan flies to the Lab and delegates | Choreography | 4.15 | Lab | 2s | 4:05 | — | 🔍 |
| 71 | 20:11–20:35 | Work continues while you're away | Job progresses | 4.15 | jobStore | 1s | 4:07 | — | 🔍 |
| 72 | 20:35–20:52 | Nova → Milo handoff | Milo at the dev station | 4.15 | — | 1.5s | 4:08 | — | 🔍 |
| 73 | 20:52–21:31 | Pip reviews (bird + monkey idea, visual only) | Pip reviewing | 4.15 | — | 1.5s | 4:09 | — | 🔍 |
| 74 | 21:31–21:49 | Result returns; in-app notification (no phone) | Toucan returns; notification | 4.15 | Notifications | 1s | 4:11 | — | 🔍 |
| 75 | 21:49–22:01 | Approve or request changes | Result viewer | 4.15 | Guarded actions | 1.5s | 4:12 | — | 🔍 |
| 76 | 22:02–22:13 | Agent conversation | Task chat | 4.15 | Task chat | 1s | 4:13 | — | 🔍 |
| 77 | 22:13–22:19 | Notifications center | Panel | 4.16 | Notifications | 1s | 4:14 | — | 📋 |
| 78 | 22:19–22:26 | Settings: controls, audio | Panes | 4.16 | Settings | 1s | 4:15 | — | 📋 |
| 79 | (22:20) | **NEW** Default view setting ("Open the 3D office in") | Setting row | 4.16 | Settings | 0.5s | 4:16 | — | 📋 |
| 80 | 22:26–22:52 | Environment: day → sunset → night | Live change | 4.16 (+2.3) | Environment | 2s | 4:16 | (0:35) | 📋 |
| 81 | 22:52–23:04 | Storm (**NEW**: weather indicator pill) | Clouds, rain, pill | 4.16 | Weather | 1.5s | 4:18 | (0:26) | 📋 |
| 82 | 23:04–23:25 | Graphics: Smooth / Full / Custom | Settings → Graphics | 4.16 | Graphics | 1.5s | 4:20 | — | 📋 |
| 83 | 23:25–23:54 | Seasonal themes (Halloween, White Christmas; reload) | Gallery → White Christmas | 4.16 | Office experience | 2.5s | 4:21 | — | 📋 |
| 84 | 23:43 | **NEW** Startup loading screen | "VIRTUAL OFFICE" loader | 4.16 | Startup | 0.5s | 4:23 | — | 📋 |
| 85 | 23:57–24:07 | **NEW** Checkout prompt ("Ready to wrap up your day?") | Kiosk at night | 5.1 | Checkout | 2s | 4:24 | — | 📋 |
| 86 | 24:07–24:23 | Log today's work → submit | Log modal → Submit | 5.1 | Time log | 4s | 4:26 | — | ⚠️F4 |
| 87 | 24:23–24:30 | "Ciao ciao": walk out | Out into the night | 5.1–5.2 | — | 4s | 4:30 | — | 📋 |
| 88 | — | Finale: the living office, tagline, logo | Crane out over the lit campus | 5.2–5.3 | Real world | 26s | 4:34 | — | 📋 |

**Coverage check:**
* All 81 v1 rows map to rows 1–88. Row 11 is honest wording plus the Act 2 visuals.
* Nothing from the walkthrough was dropped.
* After the master renders, the Final TC column is filled from the edit's own event marks and verified frame by frame. Each row gets ✅ or a written exception.

---

## 4. Story progression

| Act | Views | TC | Emotion | What the viewer sees |
|---|---|---|---|---|
| **1 · Discover the office** | Office View | 0:00–0:20 | Curiosity | The office from above at night: Reception, the whole floor, the rooms, a few people working late. |
| **2 · The world becomes 3D** | 3D View | 0:20–0:52 | Discovery | The real C press tilts the plan into 3D. Rain on the street, a lone figure outside. The storm passes, morning comes, colleagues stream in. |
| **3 · Step inside** | Player View | 0:52–1:52 | Connection | C again: we're behind Bon. Walk in, refused at the gate, check in, the Hub, the weather, through the green lane. Profile, search, rooms. |
| **4 · The complete virtual office** | All three as needed | 1:52–4:24 | Excitement | The working day as linked sequences: quests, chat, walking up to Micah, a call, the board, meetings that remember, going together, the meeting floor, stepping out, the city, the map, rewards, the CAVE, Toucan, the AI Lab (preview), making it yours. |
| **5 · The bigger vision** | Player → 3D | 4:24–5:00 | Inspiration | Checkout at night, walk out, the camera rises over the lit office and its people. Tagline, logo. |

Visual rules (kept from the approved proof):
* A 2.39:1 letterbox for Acts 1–2 that **opens as the world drops into Player view**.
* Night grade cool, morning warm, UI neutral.
* Establishing shots hide the HUD; feature shots show the product exactly as an employee sees it.
* Small chapter labels name each view (OFFICE VIEW / 3D VIEW / PLAYER VIEW) the first time it appears.

---

## 5. Five-minute timeline

### 5.1 Scene list

| Scene | TC | Contents (matrix rows) | Narration |
|---|---|---|---|
| 1.1 | 0:00–0:20 | 1, 2 | A1–A4 |
| 2.1 | 0:20–0:26 | 3 | B1–B2 |
| 2.2–2.3 | 0:26–0:40 | 4, 11 | B3–B4 |
| 2.4 | 0:40–0:52 | 5 | B5 |
| 3.1–3.6 | 0:52–1:32 | 6–10, 12 | C1–C7 |
| 3.7 | 1:32–1:44 | 13–17 | C8 |
| 3.8 | 1:44–1:52 | 18–20 | C9 |
| 4.1 | 1:52–2:00 | 21–23 | D1 |
| 4.2 | 2:00–2:05 | 24–25 | D2 |
| 4.3 | 2:05–2:17 | 26–29 | D3 |
| 4.4 | 2:17–2:22 | 30–31 | D4 |
| 4.5 | 2:22–2:34 | 32–35 | D5 |
| 4.6 | 2:34–2:44 | 36–39 | E1–E2 |
| 4.7 | 2:44–3:06 | 40–49 | E3–E4 |
| 4.8 | 3:06–3:14 | 50–54 | (music only) |
| 4.9 | 3:14–3:20 | 55–56 | E5 |
| 4.10 | 3:20–3:31 | 57–61 | (music only) |
| 4.11 | 3:31–3:36 | 62 | F1 |
| 4.12 | 3:36–3:40 | 63 | F2 |
| 4.13 | 3:40–3:50 | 64 | F3 |
| 4.14 | 3:50–4:00 | 65–66 | F4 |
| 4.15 | 4:00–4:14 | 67–76 | G1 |
| 4.16 | 4:14–4:24 | 77–84 | G2 |
| 5.1 | 4:24–4:34 | 85–87 | H1 |
| 5.2 | 4:34–4:52 | 87–88 | H2 |
| 5.3 | 4:52–5:00 | 88 | H3 + on-screen line |

### 5.2 Runtime honesty

* All 88 rows fit in **5:00**, but Act 4 averages about **2.7 s per feature**. That works for visual features (scooter, lift, signs) and is tight for text-heavy UI: meeting memory (rows 36–39) and the AI Lab (rows 67–76).
* **The shortest realistic runtime that keeps every feature readable is 5:00–5:20.** The likely extra 10–20 s would go to meeting memory (+6 s) and the AI Lab preview (+8 s).
* The final cut will be judged by the readability test in section 8, not by hitting 5:00 exactly. **No feature will be dropped to save time.**

---

## 6. The narration: new script for Bon's voice

**How to record.**
* Use the same mic and quiet room as the walkthrough. Speak in your natural voice at an easy pace, with no trailer voice.
* Do 2–3 takes of each line, with 2 s of silence between takes.
* Record section by section (A–H); each section takes about 3–5 minutes.
* Name files like `A1_take2.wav`. The edit picks the best take and places it to the frame.

**Format of each line.** TC → line. *(delivery)* [approx. duration · pause after]

### Section A · Act 1 · Office View, night. Calm, reflective, unhurried
* **A1** 0:02.5 → "Remote work gave us freedom." *(warm, matter-of-fact)* [2.0 s · 1.5 s]
* **A2** 0:06.0 → "But somewhere along the way, we lost the hallway." *(softer; a little weight on "hallway")* [3.0 s · 1.2 s]
* **A3** 0:10.3 → "The quick hello. … The coffee chat. … The feeling of being in it together." *(three beats, small pauses)* [5.5 s · 1.0 s]
* **A4** 0:16.8 → "So we built a place to find it again." *(quiet resolve; lift on "again")* [2.5 s]

### Section B · Act 2 · 3D View. A touch of wonder
* **B1** 0:21.0 → "Not another grid of video calls." *(light, almost amused)* [2.0 s · 0.6 s]
* **B2** 0:23.7 → "A world." *(let it land; smile)* [0.8 s]
* **B3** 0:28.0 → "It keeps real time." *(simple, under the rain)* [1.4 s]
* **B4** 0:35.5 → "It feels the real weather." *(as the rain clears)* [1.6 s]
* **B5** 0:41.0 → "And every morning, it fills up with the people you work with." *(warm, building)* [3.8 s]

### Section C · Act 3 · Player View. Personal, first person
* **C1** 0:53.4 → "This is me." *(personal, small smile)* [0.9 s · 0.4 s]
* **C2** 0:54.8 → "Let's start the day." *(easy)* [1.3 s]
* **C3** 1:00.0 → "Like any office, you check in at the door." *(a little humor at the red gate)* [2.6 s]
* **C4** 1:08.4 → "Then the Company Hub catches you up." [2.2 s]
* **C5** 1:10.9 / 1:12.4 / 1:13.9 / 1:15.4 / 1:17.1 → "Kudos." · "Updates." · "Surveys." · "Town halls." · "Birthdays." *(an even list, about 1 s between words; record all five in one go)* [0.6 s each]
* **C6** 1:19.8 → "Even the weather, wherever you are." [2.2 s]
* **C7** 1:25.5 → "And you're in." *(a beat of satisfaction)* [0.9 s]
* **C8** 1:33.0 → "Your profile carries your badges, your wins… and the kudos people send you." [4.0 s]
* **C9** 1:44.0 → "Find anyone. See every room, and who's in it." [2.8 s]

### Section D · Act 4 · Play and people. Lighter, upbeat
* **D1** 1:52.5 → "Your first days become a quest." / "Every day brings new missions." / "And everything you do together earns something." [1.8 + 1.8 + 2.4 s]
* **D2** 2:00.5 → "You can message anyone, the way you always have." [2.4 s]
* **D3** 2:05.5 → "Or you can do what offices do best." … "Walk over. Say hi." *(the turn of the film: warm smile)* [1.8 s · 0.8 s · 1.5 s]
* **D4** 2:17.5 → "When it needs a face, start a call, right there." [2.4 s]
* **D5** 2:22.5 → "Sketch it out together, live." / "Jump into voice." / "Then ask Toucan to sum it up." [1.8 + 1.0 + 1.8 s]

### Section E · Act 4 · Meetings and moving around
* **E1** 2:34.5 → "Meetings remember." … "What changed, who decided, and the moment it was said." [1.0 s · 0.5 s · 3.0 s]
* **E2** 2:40.5 → "Ask a meeting a question, and it answers with sources." [2.8 s]
* **E3** 2:45.0 → "And when it's time to meet…" … "…you don't walk in alone." *(a little playful)* [1.3 s · 0.6 s · 1.4 s]
* **E4** 3:01.0 → "Present, react, and get back to work." [2.0 s]
* **E5** 3:14.5 → "Stepping out? Tell reception where you're headed." [2.4 s]

### Section F · Act 4 · The world outside and beyond
* **F1** 3:31.0 → "Working from a café today? Share your spot, and meet whoever's nearby." [3.8 s]
* **F2** 3:36.0 → "The coins you earn turn into rewards." [2.0 s]
* **F3** 3:40.5 → "For the big moments, the whole company gathers in the CAVE." [3.0 s]
* **F4** 3:50.0 → "Need something? Call Toucan." / "Ask about anything in the office." / "Let it reply while you're away… and catch you up when you're back." [1.6 + 1.7 + 3.4 s]

### Section G · Act 4 · What's next, and making it yours
* **G1** 4:00.5 → "In our AI Lab, we're previewing what's next:" / "a team of agents that takes on the work, while you review and decide." *(honest, curious; not salesy)* [2.2 + 3.6 s]
* **G2** 4:14.5 → "And it's yours to shape." / "Morning or sunset." / "Clear skies or a storm." / "Even the season." [1.4 + 1.0 + 1.2 + 1.0 s]

### Section H · Act 5 · Finale. Slow, sincere
* **H1** 4:25.0 → "When the day is done, log your hours… check out…" / "…and head home." [2.8 + 1.0 s]
* **H2** 4:38.0 → "One person can build the space." … "But it takes everyone to make it a workplace." *(the emotional peak; don't push)* [1.8 s · 1.2 s · 2.6 s]
* **H3** 4:53.0 → "Welcome to Offshorly Virtual Office." *(warm, final)* [2.0 s]
* **On screen at 4:55:** THE OFFICE IS JUST THE BEGINNING. + logo.

Spoken total is about 2:15 of the 5:00. The rest is picture, music, the world's sound and silence. Scenes 4.8 (meeting floor) and 4.10 (the city) are deliberately wordless.

### Accuracy notes built into the script

| Line | Kept accurate by |
|---|---|
| B3 / B4 | The world's automatic mode follows real time and real weather (WeatherAPI for the office location). It never claims to follow each person's chosen city. |
| C6 | The weather card shows *your* city's forecast. |
| F2 | Says rewards, not "free coffee": the current catalog items are labelled "(demo)". |
| G1 | Says *previewing*, and production's own "Preview — scripted sample" labels stay visible. |
| (none) | No line mentions phones. Notifications are shown in-app. |

---

## 7. Camera plan and reuse

### 7.1 Camera vocabulary

All moves are on the real engine:
* **Office View:** the product's own focus rects, eased per frame (pull-outs, drifts).
* **3D View:** keyframed orbit, pitch, zoom and target (cranes, orbits, push-ins).
* **Player View:** real WASD and E. Over-the-shoulder via an eased boom swing while standing (never while walking: movement follows the camera). Strafing for side-on tracking.
* **Transitions:** the product's own C-key view changes, dissolves for time-lapse, cuts on action.

### 7.2 Reuse map

| Footage | Source | Used in |
|---|---|---|
| Night rain crane | v1 `CineNight` (approved) | 2.2 |
| Storm clears to morning | v1 `CineDawn` (approved) | 2.3 |
| Office View night | v2 `V2OfficeNight` | 1.1 |
| C into 3D, night | v2 `V2Night3D` | 2.1 |
| Morning arrivals | v2 `V2Morning3D` | 2.4 |
| Kerb → C → Player, walk in | v2 `V2StreetPV` (replaces v1 `CineArrive`, which had the Jona clip) | 3.1 |
| Refused (red) | v2 `V2GatePV` (v1 `CineGate` kept as an alternate) | 3.2 |
| E → card → Check In → Hub → weather | v2 `V2KioskPV` (replaces v1 `CineCheckIn`/`CineWeather` for Player-view continuity) | 3.3–3.5 |
| Green lane → concourse | v2 `V2GreenPV` | 3.6 |
| v1 3D gate-to-Hub crane | v1 `CineEnter` | Candidate for 5.2 (finale) or 4.x orbits |

Everything else (Act 4, 5.1–5.3, scenes 3.7–3.8) is **to film** with the same rig and shot module.

---

## 8. Staging QA

### Fixed in v2

| Issue | Cause | Fix |
|---|---|---|
| **Jona walked through the reception desk** (v1 arrival) | Straight-line staging walk (`walkLine`) ignores furniture | Colleague walks now use the product's own pathfinder (`walkPuppet`), which routes around the desk. The ghosting take was replaced (`V2StreetPV`). |
| Bon stuck at the gate | The middle lane has a bollard, and x 678–698 is a pillar (lanes are x 634–678, 698–758 and 762–806) | Walks go through lane C (x ≈ 784) |
| Bon steered into the desk while the camera swung (v1) | Player movement follows the camera | No camera swings while walking; swing only while standing; strafe for side-on tracking |
| Player-view hint flashed on the view change | HUD hiding ran on a timer | A MutationObserver hides overlays before they paint |
| Nav-path debug line at the gates (v1) | Dev overlay | The rig's `hidePathOverlay` runs at every stage |
| Night office with too many colleagues standing on the concourse | Presence is persistent for checked-in employees, and the roster seats people | Act 1 uses the real roster (people at desks) plus three late workers; no fake removals |

### Checks every final shot must pass

The checks below run on every take (frame sheets at ≥4 per second of action, plus a full-speed watch):
* characters through furniture or walls;
* overlap between characters;
* foot sliding (the engine scales the walk cycle to travel speed; staged speeds stay in the walk range);
* floating or teleport pops inside a take;
* broken animations;
* camera inside geometry (the Player boom behind glass or lecterns, as seen once at the kiosk; that angle is banned);
* scale;
* unreadable UI (punch-ins from 2× captures where needed);
* jarring transitions.

### Watch item in the proof

At 1:30 Clang stands close beside Bon on the concourse. They don't intersect, but it reads tight. For the master, Clang's mark moves 30 units east.

---

## 9. Proof v2 (delivered)

Location: `frontend/scripts/film/out/cinematic/` (git-ignored).

| File | Contents |
|---|---|
| `a-day-inside-offshorly_proof2_scratch_master.mp4` | 96.7 s, 1080p30, −14.1 LUFS, view chapter labels, scratch-voice watermark |
| `a-day-inside-offshorly_proof2_scratch_subtitled.mp4` | Same, with captions of the new script |
| `a-day-inside-offshorly_proof2_scratch.srt` | Captions |

* It covers Acts 1–3 through the green lane, which is matrix rows 1–12.
* Narration is a **scratch timing guide** (macOS's built-in voice, generated locally). It is watermarked on screen and will be replaced by Bon's recordings of the same lines (sections A–C).
* Score and effects are the owned teaser library, cut so the build hits on the morning reveal and the swell on "And you're in". There are no new credits.

---

## 10. Blockers and decisions for Bon

| # | Item | Why it matters | Options / recommendation |
|---|---|---|---|
| D1 | **Approve the revised direction**: Office → 3D → Player structure, five-minute timeline, new script | Gates full production | — |
| D2 | **Record sections A–H** (section 6) | Final narration in your voice | Recommended. Voice cloning stays off the table unless you explicitly ask; if you ever want it, I'd quote and explain it first. |
| D3 | **Music** | A 5:00 film needs a proper score; the teaser cue is 70 s | (a) Magnific Lyria 3 Pro, 2 cues × 180 s ≈ **320 credits** (balance 101,514); (b) you supply licensed tracks. Direction: a slow felt-piano/pad opening → a warm pulse at the morning reveal → a lift at "Walk over. Say hi." → the full swell at the finale. |
| D4 | **Disk and memory** | macOS swap reached 7 GB during capture on this 8 GB machine (free disk fell to about 0.4 GB once). About 3 GB is free now. | Free about **15 GB**, and close other dev servers (:5173 :5174 :8001 :8002) during capture. |
| D5 | **Second-person and multi-client scenes** (rows 27, 33, 40–49) | Micah seeing the chat, live cursors, Go Together, the meeting | The rig supports extra real clients. Capture each person's view in turn, which is heavier but honest. OK to proceed? |
| D6 | **Webcam clip** (15–20 s) and **screen-share content** (rows 30–31, 46, 64) | Call, meeting and CAVE | A clip of you; a deck or page you're happy to show publicly |
| D7 | **OpenAI on the film rig** and **demo meetings** in the film DB (rows 35–39, 65–66) | Real AI answers and meeting memory | Small cost (well under $1). Seed the Q4-style demo sessions into the film DB only |
| D8 | **AI Lab shown as a labelled preview** in a public film (rows 67–76) | Honesty | Recommended as scripted (G1) |
| D9 | **Rewards catalog** items are labelled "(demo)" (row 63) | Honesty | Show the catalog and redemption as is (no "free coffee" claim), or populate real catalog items first |
| D10 | **Finale look** | Memorable ending | Normal night (recommended, evergreen) or seasonal (Halloween is timely in October; White Christmas is on brand for December) |
| D11 | **Chapter labels** (OFFICE VIEW / 3D VIEW / PLAYER VIEW) | Recognition of the real view modes | Keep (recommended) or remove |
