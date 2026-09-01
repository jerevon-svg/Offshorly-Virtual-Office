# Virtual Office — Master Roadmap & Audit

**Audit date:** 2026-08-28
**Audited checkout:** `fix/multiplayer-movement-sync` @ `a2a91a6` (working tree clean except the intentionally untracked `frontend/scripts/avatar-pipeline/meshy-image-to-chibi.mjs`, which was read but not touched)
**Branches compared:** `main` (local, stale), `origin/main` @ `bcea21c`, `new-features` @ `0272948`, `fix/chat-unread-spatial-receipts` @ `3bd7119`, `fix/multiplayer-movement-sync` @ `a2a91a6`
**Method:** read-only inspection of source, tests, Alembic migrations, Git history/branch diffs, `render.yaml`, `DEPLOY.md`, planning docs, and one local run of both test suites plus a frontend type-check and lint. No application code, config, database, branch, deployment, or avatar asset was modified. The only file created is this document.

> **Deployment caveat that applies to every row below:** this repository contains no CI, no deploy logs, no build/version stamp, and no record of which commit each Render service is running. `render.yaml` only takes effect once connected as a Blueprint in the Render dashboard, and the frontend Static Site is dashboard-managed. Nothing in the repo proves what is live at `https://atlas.offshorly.com/virtual-office`. **No feature in this document is marked `Deployed`, and none is marked `Production-ready`.**

---

## 1. Executive overview

Virtual Office is a 2D (with opt-in live-3D) isometric office where Offshorly employees check in, sit at their team's desks, see colleagues' live presence from Atlas, walk around, chat (DM, group, and spatial "walk up and talk"), set statuses including a protected DND mode, and check out through a time-log flow that submits to Zoho via Atlas. It is a Vite/React 19 SPA (~23k lines of non-test TypeScript) backed by a FastAPI + python-socketio service (~5.4k lines of Python) with SQLAlchemy/Alembic persistence, deployed (per docs, unverified) as a Render Static Site + a free-tier Render web service + a free-tier Render Postgres, and reverse-proxied by Atlas under `/virtual-office`.

**Where the product is:**

- The **core daily loop is built end to end** — auth gate, check-in with Company Hub, roster + live presence, seating, status system, chat, DND protections, checkout with Zoho time logs, offline sidewalk lineup. This is the strongest, most-tested part of the codebase (997 frontend + 229 backend automated tests, all passing locally; TypeScript clean).
- **Multiplayer movement synchronization was just rebuilt** (branch `fix/multiplayer-movement-sync`, 37 files, +4.5k lines) and is approved by review but **not yet merged and not yet re-validated in a three-browser session**. Until it lands, different clients can render the same employee in different places.
- **Notifications are scattered** across eight independent toasts/badges/prompts with no center, no persistence, no history, and no deep links.
- **Voice/video/meetings, HR requests, surveys, gamification, and chat media are not started** (zero LiveKit/WebRTC references; `IN_CALL` is a dormant flag).
- **The 3D avatar pipeline is a working but fully manual CLI chain** proven for exactly one employee (Bon/jerevon). The 2026-08-28 cross-employee identity test **failed**, prompting a two-stage redesign that is implemented in the untracked script but not yet validated.
- **Deployment state is unknown.** The backend on `origin/main` is missing the `employee_positions` migration that the movement branch needs; the Static Site's `VITE_OFFICE_INTEGRATION_MODE`/`VITE_ZOHO_INTEGRATION_MODE` values are not documented in `DEPLOY.md`, so production may be running with mock roster/Zoho data; the free Postgres expires 30 days after creation.

**Overall completion assessment:** of 121 audited feature rows, **59 (49%) are code-complete**, 24 (20%) are partial, 36 (30%) are not started, and 2 are blocked externally. The not-started share is concentrated in three whole areas (voice/video/meetings, the notification center, HR requests); the daily employee loop itself is ~85% complete. Quality-wise almost everything complete is "functional but needs polish"; nothing can be called production-ready without deployment evidence.

---

## 2. Product vision

A persistent, ambient "office you can see" for a distributed team: one place where showing up, being reachable, talking to people, protecting focus time, celebrating each other, and logging the day all happen through the same spatial metaphor — and where every employee eventually has a recognizably *themselves* animated 3D character produced automatically from a headshot, rendered safely on whatever device they have. Atlas remains the source of truth for identity, people, and Zoho; Virtual Office owns the spatial/social layer (positions, conversations, statuses, hub engagement) and integrates rather than duplicates.

---

## 3. Primary daily employee journey (as implemented today)

1. Employee opens Atlas → `/virtual-office`. `useAuthGate` calls Atlas `GET /api/v1/auth/me`, checks `can_view_virtual_office`, parks identity in `currentUserStore`. (UX gate only; Atlas enforces server-side.)
2. Office renders in the current Manila day-phase (morning/day/sunset/night). Roster loads from Atlas `/floor` + `/presence` and stays live via SSE `/api/v1/office/events` (in `real` mode; `mock` cast otherwise).
3. Check-in prompt → `come_online` (leaves sidewalk lineup) → **Company Hub** opens with announcements/birthdays/recognition/surveys/what's-new items (seen/dismiss/acknowledge/CTA persisted per employee).
4. Employee walks (right-click tile, "Approach", seat menu "Sit here") — path-found over the walkability grid, through door stand-points where painted (7/10 rooms), doors slide for `ai-room`/`executive-team`. Movement is broadcast to peers (fully consistent only on the movement branch).
5. Status: manual Available/Busy/Break/Lunch/DND via `StatusPicker`; Away auto after 5 min idle; In Conversation auto while in a spatial session; Break/Lunch overtime nudges at 15/60 min. DND (30m/1h/2h, 3h/day allowance) is broadcast and locks the room; visitors stop at the door and can request entry.
6. Chat: 💬 Global Chat HUD → employee picker → DM/group windows in a Messenger-style floating stack; or click a character → Chat/Approach → spatial conversation with talking bubbles, keystroke-driven typing indicators, cluster formation, Ask-to-Join with accept/decline and DM→group upgrade; delivery/read receipts and seen-avatar stacks; @mentions with badges.
7. Profile: click a person → Employee Profile feed (posts, emoji reactions, one-level comment threads; birthday/congratulation posts arrive from Hub CTAs).
8. After 8 worked hours: checkout reminder → confirm → character says goodbye → walks to reception → time-log form (projects/tasks from Atlas `my-tasks`) → review → submit `my-timelogs` (Zoho via Atlas; draft persisted; retry on failure; duplicate-day detection) → success card → walk to exit → `go_offline` → appears in the sidewalk lineup for everyone.

---

## 4. Status-summary counts

Counts are over the **121 feature rows** in Section 5 (one row = one feature; counted mechanically from the status tables). Vocabulary is exactly the four status scales defined in the brief.

| Metric | Count | Definition used |
|---|---:|---|
| **Implemented** | 59 | Implementation = Implemented |
| **Partially implemented** | 24 | Implementation = Partially implemented |
| **Not started** | 36 | Implementation = Not started (13 of these are voice/video/meetings rows, 6 are notification-center rows) |
| Needs rework | 0 | Implementation = Needs rework (the failed single-stage identity approach was already superseded by the two-stage script, counted under AV-4/5) |
| Blocked | 2 | Implementation = Blocked (HB-9 Atlas/Zoho endpoints, HR-7 Atlas timelog 500) |
| **Needs polish** | 65 | Quality = Functional but needs polish |
| **Known defects** | 13 | Quality = Known defects |
| Experimental / proof of concept | 10 | Quality = Experimental / proof of concept |
| Not applicable yet | 33 | Quality = Not applicable yet |
| **Locally validated** (manual evidence exists) | 34 | Validation = Automated and manually validated (25) + Manual testing only (9) |
| Automated tests only | 38 | Validation = Automated tests only |
| Needs validation | 47 | Validation = Needs validation (includes every not-started row) |
| Validation failed | 2 | Validation = Validation failed (AV-6 cross-employee identity test, HR-7 external timelog endpoint) |
| **Confirmed deployed** | 0 | Deployment = Deployed |
| **Deployment unverified** | 70 | Deployment = Merged but deployment unverified (65) + Unknown (5) |
| Local or feature branch only | 16 | Deployment = Local or feature branch only |
| Not deployed | 35 | Deployment = Not deployed |
| **Production-ready** | 0 | Requires implementation + automated + manual + deployment evidence — none qualify |

Local evidence gathered during this audit: `pytest` → **229 passed**; `vitest run` → **79 files / 997 tests passed**; `tsc --noEmit -p tsconfig.app.json` → clean; `oxlint` → warnings only in the vendored Draco decoder. No Playwright/e2e config exists despite the `playwright` dev dependency.

---

## 5. Complete feature inventory

Legend — **Pri:** P0 blocks release/foundation · P1 next · P2 valuable · P3 later. **Diff:** Small / Medium / Large / Foundational. **Scope:** FE = frontend, BE = backend, DB = migration/persistence, INT = external integration (Atlas/Zoho/Meshy/Render).
Deployment vocabulary: *Merged…unverified* = on `origin/main`, live state unproven · *Branch only* = only on `fix/*` or untracked locally · *Not deployed* = nothing to deploy.

### 5.1 Core office and attendance

| ID | Feature | Implementation | Quality | Validation | Deployment |
|---|---|---|---|---|---|
| CO-1 | Authentication gate + Atlas identity (`useAuthGate`, `currentUserStore`, backend `verify_atlas_token`) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| CO-2 | Dev bypass (FE `VITE_AUTH_GATE=off` DEV-only, `?as=`, `?deviceTier=`; BE `x-dev-email` gated on `APP_ENV=development`) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| CO-3 | Check-in (onboarding prompt → `come_online` → Company Hub) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| CO-4 | Check-out flow (13-state machine: reminder → confirm → goodbye → walk to reception → log → review → submit → exit) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| CO-5 | Work logs & Zoho submission via Atlas (`AtlasZohoService`: `my-tasks`, `my-timelogs`; gated on `isRealZohoMode()`) | Implemented | Known defects | Needs validation | Merged but deployment unverified |
| CO-6 | Draft / retry / error handling (localStorage draft per employee+day, `SubmissionFailedPanel`, `retrySubmit`, `AlreadySubmittedError`) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| CO-7 | Eight-hour checkout reminder (fires once worked ≥ 8h; "Later" re-arms after 30 min) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| CO-8 | Atlas roster & presence (`/floor`, `/presence`, `/map`, `/rooms`, `/people/{email}/card`, SSE `/events`; `floorMerge`) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| CO-9 | Online/offline state & sidewalk lineup (`OfflineLineup` in-memory, `lineupSlots`, `offlineLineupPlacement`) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| CO-10 | Assigned desks, rooms, seating (`rosterLayers` packed grid, `roomSeats`, `seatDirections`, `SeatActionMenu`, back-sit occupancy, chair crop table) | Partially implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| CO-11 | Doors: slide animation + stand-here gating (`officeDoors`, `doorStandPoints`, `DOOR_ANIM_MS`) | Partially implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| CO-12 | Room movement, room sidebar, character search | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |

| ID | Works | Incomplete | Known defects | Polish | Scope | Deps / blockers | Testing required | Next action | Pri | Diff |
|---|---|---|---|---|---|---|---|---|---|---|
| CO-1 | Permission flag read from either `/auth/me` shape; identity parked once; 401 → login redirect; backend proxies token to Atlas with 60s cache | Atlas's canonical user-id field is still **unconfirmed** — code tries 6 shapes then falls back to `"bon"` | Fallback masks unknown ids as Bon in edge cases; gate is UX-only (documented) | Tighten id extraction once Atlas confirms; remove fallback | FE, BE, INT | Atlas confirmation of `/auth/me` id field | Contract test against real Atlas response; keep `useAuthGate.test` | Ask Atlas for the field; add a guard that logs when fallback is used | P1 | Small |
| CO-2 | Bypass compiled out of `vite build`; backend fails closed unless `APP_ENV=="development"`; malformed dev emails rejected on socket | — | None found | Document in one place (README currently describes the old Node backend) | FE, BE | — | Existing unit tests cover gating | Update `frontend/README.md` dev section (stale `npm run migrate`/port 4800 text) | P2 | Small |
| CO-3 | Prompt → `come_online` → hub opens in `checkin` mode | No server-side check-in record; "checked in" is inferred from lineup absence | — | Confirm hub open only on first check-in of the day | FE, BE | — | Add test for "hub not reopened on refresh" | Decide whether check-in should persist server-side (see §16) | P1 | Medium |
| CO-4 | All 13 states, reception walk, goodbye beats, exit walk, `go_offline` | Only reachable in prod when `isRealZohoMode()`; DEV always shows it | — | Copy/UX pass on modals; keyboard access | FE | CO-5 | `useCheckoutFlow.test` (210 lines) exists; add e2e smoke | Live-verify once CO-5 is unblocked | P1 | Small |
| CO-5 | Task list cached per page; billable default; duplicate-day detection | End-to-end Zoho write **not currently verifiable** — Atlas `/my-timelogs` was returning HTTP 500 (see HR-7) | External 500 from Atlas/Zoho; production env mode (`VITE_ZOHO_INTEGRATION_MODE`) undocumented in `DEPLOY.md` | Surface a clearer "Zoho unavailable" state than generic failure | FE, INT | Atlas fix; Render env var | Integration test against Atlas staging; manual submit of a real day | Get Atlas to fix `/my-timelogs`; confirm Render env | P0 | Small (ours) |
| CO-6 | Draft restore on mount, per-entry persistence, retry with double-log warning | No server-side draft; lost if browser storage cleared | — | Show "draft saved" affordance | FE | — | Covered by `checkoutStorage.test`, `useCheckoutFlow.test` | Keep; revisit when backend owns attendance | P2 | Small |
| CO-7 | Worked-minutes trigger (spec-correct), snooze | Worked time is client-computed from local check-in time | — | Timezone edge cases (Manila date boundary) | FE | — | `workedTime.test` exists | None until server-side attendance | P2 | Small |
| CO-8 | Floor + presence merged; SSE envelope parsing hardened against Atlas's own bug; degrade to "elsewhere" on `/rooms` failure | Placement rules for ephemeral PROJECT/CLIQ rooms are name-only | Production mode env unknown (may be `mock`) | Live/stale indicator UI for `live=false` | FE, INT | Render env; Atlas uptime | `floorMerge.test`, `officeSse.test`; manual with Atlas | Verify `VITE_OFFICE_INTEGRATION_MODE=real` on Render and document it | P0 | Small |
| CO-9 | Explicit checkout adds to lineup; broadcast to all; late joiner gets snapshot; disconnect frees slot | Offline is explicit-checkout-only (disconnect ≠ offline by design v1); registry is in-memory — lineup empties on backend restart | Lineup lost on Render restart/cold start | — | FE, BE | Decision: should disconnect imply offline? | `test_offline_lineup.py`, `lineupSlots.test` | Persist lineup or rebuild from Atlas presence on boot | P1 | Medium |
| CO-10 | Packed per-room grid, per-room scaling bound, manifest-derived seats for 4 dense rooms, sit/stand, seat directions table | `SEAT_DIRECTIONS_TODO.md`: most seats still default to `front`; 4 sofa sub-seats and 3 qa-room seats unassigned | Backrest-occlusion crop deliberately zeroed (c1d87a9) — not a bug | Fill seat directions via `seat-direction-tool.html`; assigned-desk (person→seat) mapping is positional, not per-employee | FE | Bon's design pass | Existing `roomSeats`/`seatDirections` tests | Bon completes direction table; decide on per-employee assigned desks | P2 | Small |
| CO-11 | Two-stand door sequencing (outside → open → inside → close), 7/10 rooms have complete pairs, 2 rooms have door art | 3 rooms lack stand pairs; 8 rooms lack door art layers | Door-hold timing bug previously only found by live driving (memory: static review missed it twice) | Add remaining door art + stand markers | FE (assets by Bon) | Bon paints markers/doors | `doorStandPoints.test`, `officeDoors.test`; live Playwright drive after any change | Bon paints remaining doors; re-verify live | P2 | Small |
| CO-12 | Click room → sidebar members; search person; approach | — | — | Sidebar shows raw status colours incl. Atlas `IN_MEETING` | FE | — | Add RoomSidebar test (none today) | Low priority | P3 | Small |

### 5.2 Movement and multiplayer state

All rows marked *Branch only* live on `fix/multiplayer-movement-sync` (commit `a2a91a6`, pushed to origin, no PR). Master review APPROVED; **the final three-browser manual retest was deferred** and is the gate before merge.

| ID | Feature | Implementation | Quality | Validation | Deployment |
|---|---|---|---|---|---|
| MV-1 | Right-click move-to-tile (`OfficeStage.onContextMenu` → `moveSelf`; drag conflict fixed in `afe991f`) | Implemented | Functional but needs polish | Needs validation | Local or feature branch only |
| MV-2 | Character-interaction auto-walk ("Approach" / "Chat" walk-to-character with mutual face-turn) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| MV-3 | Spatial & Ask-to-Join auto-walk (`assignClusterSlots`, join walks as one leg) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| MV-4 | Position/facing/walking/sitting/room synchronization (unified `moveSelf`, `walk_started`/`walk_arrived`, server `PositionRegistry`, monotonic revisions, `PeerWalker` replay) | Implemented | Functional but needs polish | Needs validation | Local or feature branch only |
| MV-5 | Late-join & reconnect snapshots (`positions_snapshot` on connect with `serverTime` offset) | Implemented | Functional but needs polish | Automated tests only | Local or feature branch only |
| MV-6 | Persistent stable position (`employee_positions` table, migration `a2b3c4d5e6f7`, loaded at startup) | Implemented | Functional but needs polish | Automated tests only | Local or feature branch only |
| MV-7 | 2D/3D device-tier consistency for peers (live-3D peer `isWalking` default bug fixed) | Implemented | Functional but needs polish | Needs validation | Local or feature branch only |
| MV-8 | Roster deduplication (viewer's static roster portrait dropped by email; `rosterLayers` + `peerOverrides`) | Implemented | Functional but needs polish | Automated tests only | Local or feature branch only |
| MV-9 | Pathfinding & walkability collision (A* over painted grid, `walkable-zones`, stand-offs) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| MV-10 | DND door gating & offline precedence (`isRoomLocked` client+server parity, `ONLINE > IN_MEETING/AWAY > ON_LEAVE > OFFLINE`) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| MV-11 | Redis / multi-worker scaling of realtime state | Not started | Not applicable yet | Needs validation | Not deployed |

| ID | Works | Incomplete | Known defects | Polish | Scope | Deps / blockers | Testing required | Next action | Pri | Diff |
|---|---|---|---|---|---|---|---|---|---|---|
| MV-1 | Right-click → path → walk, broadcast on branch | On `origin/main` right-click walks are **local-only** (never emitted) — the bug the branch fixes | Pre-branch: peers don't see right-click walks | Cursor/target marker feedback | FE | Merge of branch | `OfficeMap.moveSelfGuard.test`, `useSelfMovement.test`; 3-browser manual | Run 3-browser checklist, open PR | P0 | Small |
| MV-2 | Walk to target, stop at stand-off, face each other | — | — | — | FE | — | Existing tests | Fold into MV-4 validation | P2 | Small |
| MV-3 | Deterministic cluster geometry; joiner single-leg walk (fixed live) | Cluster anchors were per-client before branch | Pre-branch: different anchors per client | — | FE, BE | Merge of branch | `clusterFormation.test`, `clusterSlots.test`; live | Validate with branch | P1 | Small |
| MV-4 | Mover sends path, peers replay; server issues revision; stale arrivals rejected; sitting/facing/room in stable state | Manual 3-browser retest pending; no interpolation smoothing on packet jitter | Unknown until live retest | Smooth peer replay under latency | FE, BE, DB | Migration must run on the deployed DB | `test_movement_sync_socket.py` (551 lines), `PeerWalker.movementReplay.test`, `movementSync.test`; **3-browser manual** | Retest → PR → deploy backend first (migration) then frontend | P0 | Foundational |
| MV-5 | Snapshot on connect incl. in-flight walks; clock offset from `serverTime` | Reconnect re-sync relies on socket.io auto-reconnect only | — | Visual catch-up (teleport vs. fast-walk) | FE, BE | MV-4 | Covered in socket tests; manual reconnect test | Include in checklist | P1 | Small |
| MV-6 | Only stable state persisted; tolerant of missing table at startup | In-flight never persisted (by design) | Migration absent on `origin/main` | — | BE, DB | Deploy order | `test_position_repo.py`, `test_migrations.py` | Ship with MV-4 | P0 | Small |
| MV-7 | Peer live-3D defaults to standing, not walking | Only one live-3D character exists to compare | — | — | FE | AV-3 | `CharacterCanvas.test` | Validate visually with a T2 + T0 viewer | P1 | Small |
| MV-8 | Viewer's roster twin removed; `peerOverrides` merge | Dev-bypass mode depends on default email being set | Two-Bons bug when identity email missing (documented) | — | FE | CO-1 | `rosterLayers.test`, `peerOverrides.test` | Validate | P1 | Small |
| MV-9 | Grid A*, snapping to walkable, stand-offs | No **character-to-character** collision (avatars overlap) | — | Optional soft avoidance | FE | — | `gridAStar`, `officePathfinding.test` | Defer | P3 | Medium |
| MV-10 | Client stops at door when locked; server rejects; precedence mapping | — | — | Toast copy | FE, BE | — | `roomLock.test`, `test_dnd_room_lock_socket.py` | None | P2 | Small |
| MV-11 | — | All five realtime registries are per-process; render.yaml runs a single uvicorn worker (correct today) | Any `--workers>1` or second instance silently splits state | — | BE, INT | Decision (§16) | Load test single worker first | Keep single worker; document as hard constraint | P2 | Large |

### 5.3 Presence and statuses

| ID | Feature | Implementation | Quality | Validation | Deployment |
|---|---|---|---|---|---|
| PS-1 | Available (manual, default) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| PS-2 | Busy (manual) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| PS-3 | Away (auto: 5-min idle, visibility reset) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| PS-4 | Break (manual, 15-min overtime prompt) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| PS-5 | Lunch (manual, 60-min overtime prompt) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| PS-6 | In Conversation (auto from spatial session) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| PS-7 | In Call (auto) | Not started | Not applicable yet | Needs validation | Not deployed |
| PS-8 | DND (manual, 30m/1h/2h, reason, 3h/day allowance, broadcast `dnd_set`, room lock, 15-min decline cooldown) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| PS-9 | Offline (auto on checkout) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| PS-10 | Manual vs automatic restoration & precedence (`OFFLINE > DND > IN_CALL > IN_CONVERSATION > AWAY > manual`; DND restores previous manual status) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| PS-11 | Cross-client visibility of self manual status (peers see Busy/Break/Lunch/Away) | Partially implemented | Known defects | Needs validation | Merged but deployment unverified |

| ID | Works | Incomplete | Known defects | Polish | Scope | Deps / blockers | Testing required | Next action | Pri | Diff |
|---|---|---|---|---|---|---|---|---|---|---|
| PS-1..5 | Picker, label suffixes, colours, localStorage persistence, overtime polling | **Only DND is broadcast**; Available/Busy/Break/Lunch/Away are local-only for self; peers are rendered from Atlas's 5-value feed (`ONLINE/AWAY/IN_MEETING/ON_LEAVE/OFFLINE`) | Peers never see a colleague's Busy/Break/Lunch | Status picker a11y; persist since-timestamp | FE | PS-11 | `status.test`, `selfStatusStore.test`, `useStatusOvertime.test`, `StatusPicker.test` | Build server-side presence registry (PS-11) | P1 | Medium |
| PS-6 | Set from `talkingIds`; drives label | — | — | — | FE | — | covered | — | P2 | Small |
| PS-7 | Store flag exists | Nothing sets it (no call system) | — | — | FE | VV-1/2 | — | Wire when calls exist | P2 | Small |
| PS-8 | Full V1 policy client+server; auto-expiry; request queue; stale-request cancel on disconnect | Session length & daily allowance enforced **client-side only** (documented, bypassable via localStorage) | Allowance bypassable | Company-configurable policy endpoint | FE, BE | — | `dndPolicy.test`, `test_dnd_registry.py`, `test_dnd_room_lock_socket.py` | Move allowance enforcement server-side when presence registry exists | P2 | Medium |
| PS-9 | Checkout → `offline` auto-condition → lineup | Disconnect not treated as offline | — | — | FE, BE | Decision | covered | See CO-9 | P1 | Small |
| PS-10 | Precedence resolver; DND previous-status restore; auto-conditions session-only | — | — | — | FE | — | covered | — | P3 | Small |
| PS-11 | DND via socket; peers via Atlas SSE mapping | No `status_set` socket event / registry for the other 4 manual statuses; no write-back to Atlas | Status mismatch between what I set and what others see | — | FE, BE | Decision: own registry vs. write to Atlas | New socket tests + 2-browser manual | Design presence registry (mirror `DndRegistry`), broadcast snapshot on connect | P1 | Medium |

### 5.4 Chat and spatial conversation

| ID | Feature | Implementation | Quality | Validation | Deployment |
|---|---|---|---|---|---|
| CH-1 | Persistent DM (REST `/conversations`, socket `send_message`, history, since-cursor catch-up, cold-start connect handling) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| CH-2 | Persistent group chat (`POST /conversations/group`, `GroupConversationView`, reopen list) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| CH-3 | Unified Global Chat entry (💬 HUD, `EmployeePickerModal`, floating window stack) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| CH-4 | Normal vs spatial routing (conversation with live spatial session opens in spatial slot; never both) | Implemented | Functional but needs polish | Automated and manually validated | Local or feature branch only |
| CH-5 | Unread & mention badges (`unread_count`, `mentionCount`, `useUnreadTotal`, `MessageNotificationBadge`) | Implemented | Functional but needs polish | Automated and manually validated | Local or feature branch only |
| CH-6 | Delivery & read receipts (per-reader `deliveredTo`/`readBy`, watermarks, checkmarks, "Seen HH:MM") | Implemented | Functional but needs polish | Automated and manually validated | Local or feature branch only |
| CH-7 | Live group reader avatars (`SeenAvatarStack`, `computeSeenByMessage`, live merge of receipts) | Implemented | Functional but needs polish | Automated and manually validated | Local or feature branch only |
| CH-8 | Spatial typing indicator driven by real keystrokes (`typing` event, inactivity window, `TalkingBubble`) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| CH-9 | Ask-to-Join, Accept/Decline, atomic DM→group upgrade (`ConversationRequest`, `conversation_upgraded`) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| CH-10 | DND protections: room locks, talk requests (`chat`/`approach`), room-entry requests, request queue, decline cooldown, muted header | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| CH-11 | @mentions autocomplete + server validation (migration `f6a7b8c9d0e1`) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| CH-12 | Images, GIFs, file attachments | Not started | Not applicable yet | Needs validation | Not deployed |
| CH-13 | Message reactions (chat) | Not started | Not applicable yet | Needs validation | Not deployed |
| CH-14 | Voice messages | Not started | Not applicable yet | Needs validation | Not deployed |
| CH-15 | Mock chat mode (localStorage + echo; default when no socket URL) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |

| ID | Works | Incomplete | Known defects | Polish | Scope | Deps / blockers | Testing required | Next action | Pri | Diff |
|---|---|---|---|---|---|---|---|---|---|---|
| CH-1 | End-to-end over Socket.IO with Atlas token; ms-precision `sent_at` fix; `connect_error` handling for Render cold start | Message edit/delete; search; pagination beyond `since` | Cold-start "waking up" UX still ~1 min on free tier | Per-message image avatars disabled (`ALWAYS_USE_INITIALS`) | FE, BE, DB | Render plan | `test_chat_socket.py`, `RealChatService.test`, `ConversationView.test` | Re-enable avatars once avatar URLs are stable | P1 | Small |
| CH-2 | Create with picker, title, reopen after refresh | Leave group, rename, add members after creation | — | — | FE, BE | — | `GroupConversationView.test`, `test_chat_router.py` | Add membership management | P2 | Medium |
| CH-3 | Right-to-left stack, collapse, one spatial slot | Window limit/overflow behaviour on small screens | — | — | FE | — | `OfficeMap.test` | Responsive pass (PQ-7) | P2 | Small |
| CH-4 | Fixed in `3bd7119`: remote vs spatial never both open | — | Pre-fix: duplicate windows | — | FE | Merge branch | covered + 3-browser manual | Merge | P0 | Small |
| CH-5 | Counts recomputed after watermark flush (fix `3bd7119`) | No per-conversation muting | Pre-fix: badge stuck after read | — | FE, BE | Merge branch | covered | Merge | P0 | Small |
| CH-6 | Derived (not stored) statuses; batch "Seen" time | — | — | — | FE, BE, DB | — | covered | — | P2 | Small |
| CH-7 | Live `read_receipt`/`delivery_receipt` with server-verified reader (fix `3bd7119`) | — | Pre-fix: needed reopen to refresh | — | FE, BE | Merge branch | covered | Merge | P0 | Small |
| CH-8 | Emitted only on composer `onChange`; timeout stop | — | — | — | FE, BE | — | covered | — | P3 | Small |
| CH-9 | Request primitive, accept/decline, upgrade never mutates original DM, spatial session registry | — | Live-found bugs fixed 08-22 | — | FE, BE, DB | — | `test_conversation_requests.py`, `requestsClient.test` | — | P2 | Small |
| CH-10 | Server `is_room_locked`, stale request cancellation, `RoomLockedToast`, `DndRequestQueue`, `TalkRequestToast` | Manual 3-browser validation of the final polish commit `0272948` not recorded | — | Toast stacking with other toasts (see NT) | FE, BE, DB | — | `test_talk_request_socket.py`, `test_room_requests_router.py`; **manual** | Run manual DND scenario checklist | P1 | Small |
| CH-11 | Participant-validated mentions, counts | Mentions in group only for participants (by design) | — | Highlight style | FE, BE, DB | — | `mentions.test`, socket tests | — | P3 | Small |
| CH-12 | — | Requires object storage (Render free has no disk — `render.yaml` explicitly warns) | — | — | FE, BE, DB, INT | Paid plan or S3-class storage decision | New | Decide storage (§16) | P2 | Large |
| CH-13 | — | Feed already has reactions model to copy | — | — | FE, BE, DB | — | New | After NT | P2 | Medium |
| CH-14 | — | Same storage dependency as CH-12 | — | — | FE, BE, INT | CH-12 | New | Defer | P3 | Large |
| CH-15 | Silent fallback when env unset | Silent mock in a misconfigured prod build is a risk (documented in DEPLOY.md) | — | Build-time assertion for prod | FE | — | `index.test` | Fail build if prod && mock (§16) | P1 | Small |

### 5.5 Unified notifications

No notification center exists. Today's surfaces: `MessageNotificationBadge`, `TalkRequestToast`, `JoinRequestPrompt`, `DndRequestQueue`, `RoomLockedToast`, `CheckoutReminderToast`, `StatusOvertimePrompt`, Company Hub item states. None persist, none deep-link, none share a queue.

| ID | Feature | Implementation | Quality | Validation | Deployment |
|---|---|---|---|---|---|
| NT-1 | Central notification center (store, panel, queue) | Not started | Not applicable yet | Needs validation | Not deployed |
| NT-2 | Chat message & mention notifications | Partially implemented | Functional but needs polish | Automated and manually validated | Local or feature branch only |
| NT-3 | Ask-to-Join & room-entry request notifications | Partially implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| NT-4 | Incoming voice/video call notifications | Not started | Not applicable yet | Needs validation | Not deployed |
| NT-5 | Meeting reminders & invitations | Not started | Not applicable yet | Needs validation | Not deployed |
| NT-6 | DND request notifications (queue for the DND holder) | Partially implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| NT-7 | HR request updates | Not started | Not applicable yet | Needs validation | Not deployed |
| NT-8 | Announcements, birthdays, recognition, surveys, system alerts | Partially implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| NT-9 | Read/unread state across notification types | Partially implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| NT-10 | Deep links to the originating feature | Not started | Not applicable yet | Needs validation | Not deployed |
| NT-11 | Grouping, preferences, persistence, history | Not started | Not applicable yet | Needs validation | Not deployed |

| ID | Works | Incomplete | Known defects | Polish | Scope | Deps / blockers | Testing required | Next action | Pri | Diff |
|---|---|---|---|---|---|---|---|---|---|---|
| NT-1 | — | Everything | — | — | FE, BE, DB | PS-11 recommended first | New unit + socket tests | Design: `notifications` table + `notification` socket event + FE store consolidating existing toasts | P1 | Foundational |
| NT-2 | Unread/mention badges on HUD & windows | No OS/browser notification, no sound, no toast on new message | — | — | FE | NT-1 | — | Route through NT-1 | P1 | Small |
| NT-3 | Toasts/prompts with accept/decline | Lost on refresh (pending lists are fetchable via `/requests/pending` but not re-shown as notifications) | — | — | FE, BE | NT-1 | — | Re-hydrate pending requests into NT-1 on connect | P1 | Small |
| NT-4 | — | — | — | — | FE, BE | VV-1 | — | After VV | P2 | Medium |
| NT-5 | — | — | — | — | FE, BE, INT | VV-9/10 | — | After VV | P3 | Medium |
| NT-6 | Queue UI for DND holder; expiry handling | Not persisted | — | — | FE, BE | NT-1 | — | Fold into NT-1 | P2 | Small |
| NT-7 | — | — | — | — | FE, BE | HR-2/3 | — | After HR | P3 | Small |
| NT-8 | Hub items with seen/dismissed/acknowledged; `required` priority | Only visible inside Company Hub; no system-alert type | — | — | FE, BE, DB | NT-1 | — | Emit hub items into NT-1 | P2 | Small |
| NT-9 | Per-conversation watermarks; per-hub-item state | No unified read model | — | — | BE, DB | NT-1 | — | Part of NT-1 schema | P1 | Small |
| NT-10 | — | No router in app (hash/query only) | — | — | FE | NT-1 | — | Define in-app intent map (open conversation X, open hub item Y) | P2 | Medium |
| NT-11 | — | — | — | — | FE, BE, DB | NT-1 | — | Phase 2 of NT-1 | P3 | Medium |

### 5.6 Voice, video, and meetings

Zero references to LiveKit, WebRTC media, calendars, or meeting scheduling exist in `frontend/src` or `backend/app`. "Meeting Room" is a physical room only; Atlas `IN_MEETING` maps to `IN_CALL` for peers.

| ID | Feature | Implementation | Quality | Validation | Deployment |
|---|---|---|---|---|---|
| VV-1 | LiveKit integration (server token endpoint, client SDK) | Not started | Not applicable yet | Needs validation | Not deployed |
| VV-2 | One-to-one and group voice/video | Not started | Not applicable yet | Needs validation | Not deployed |
| VV-3 | Spatial voice/video (proximity/cluster-scoped) | Not started | Not applicable yet | Needs validation | Not deployed |
| VV-4 | Video tiles above avatars | Not started | Not applicable yet | Needs validation | Not deployed |
| VV-5 | Full-size call view | Not started | Not applicable yet | Needs validation | Not deployed |
| VV-6 | In Call status wiring | Not started | Not applicable yet | Needs validation | Not deployed |
| VV-7 | Incoming-call flow | Not started | Not applicable yet | Needs validation | Not deployed |
| VV-8 | Join/leave/reconnect, mic/camera controls | Not started | Not applicable yet | Needs validation | Not deployed |
| VV-9 | Scheduled & recurring meetings | Not started | Not applicable yet | Needs validation | Not deployed |
| VV-10 | Google Calendar integration | Not started | Not applicable yet | Needs validation | Not deployed |
| VV-11 | Meeting-room permissions | Not started | Not applicable yet | Needs validation | Not deployed |
| VV-12 | Zoho Meeting / Cliq feasibility | Not started | Not applicable yet | Needs validation | Not deployed |
| VV-13 | LiveKit hosting, token security, recording, cost decisions | Not started | Not applicable yet | Needs validation | Not deployed |

| ID | Works | Incomplete | Known defects | Polish | Scope | Deps / blockers | Testing required | Next action | Pri | Diff |
|---|---|---|---|---|---|---|---|---|---|---|
| VV-1 | — | All | — | — | BE (token mint with Atlas identity), FE | Decision VV-13; Render free tier likely insufficient for signalling reliability | Token expiry/authz tests; 2-browser call | Spike: LiveKit Cloud + backend `/livekit/token` reusing `get_current_email` | P1 | Large |
| VV-2 | — | — | — | — | FE, BE | VV-1 | — | Reuse `Conversation` as the room key | P1 | Large |
| VV-3 | — | — | — | — | FE, BE | VV-2, spatial session registry (exists) | — | Room name = spatial session id | P2 | Medium |
| VV-4 | — | — | — | — | FE | VV-2, `KeepScale`/anchor math (exists) | — | Reuse `greetingAnchor` positioning | P2 | Medium |
| VV-5 | — | — | — | — | FE | VV-2 | — | — | P2 | Medium |
| VV-6 | Flag exists | Setter | — | — | FE | VV-2 | — | Set `inCall` from LiveKit room state | P2 | Small |
| VV-7 | — | — | — | — | FE, BE | NT-1 | — | Deliver via notification center | P2 | Medium |
| VV-8 | — | — | — | — | FE | VV-2 | — | — | P2 | Medium |
| VV-9 | — | — | — | — | FE, BE, DB | Decision on source of truth (Google vs own) | — | After VV-2 | P3 | Large |
| VV-10 | — | — | — | — | INT, BE | OAuth via Atlas (same argument as `ZOHO_ENDPOINT_REQUEST.md`) | — | Ask Atlas | P3 | Large |
| VV-11 | — | Room-lock primitive exists (DND) to extend | — | — | FE, BE | VV-9 | — | Extend `is_room_locked` with booking | P3 | Medium |
| VV-12 | — | Atlas SSE already carries `CLIQ_CHANNEL` rooms (ignored) | — | — | INT | Atlas/Zoho licensing | — | Feasibility memo | P3 | Small |
| VV-13 | — | — | — | — | INT | Bon/team | — | Decision (§16) | P1 | Small |

### 5.7 Employee Hub and engagement

| ID | Feature | Implementation | Quality | Validation | Deployment |
|---|---|---|---|---|---|
| HB-1 | Company Hub displayed at check-in (+ manual open; per-employee seen/dismiss/ack/CTA state) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| HB-2 | Announcements | Partially implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| HB-3 | Birthdays & "Wish Happy Birthday" action (posts to target's feed) | Partially implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| HB-4 | Employee of the Month | Not started | Not applicable yet | Needs validation | Not deployed |
| HB-5 | Recognition & "Congratulate" action | Partially implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| HB-6 | Employee profile feed (posts, emoji reactions, one-level comments, delete own) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| HB-7 | Surveys and polls | Partially implemented | Experimental / proof of concept | Automated tests only | Merged but deployment unverified |
| HB-8 | Daily check-in streaks / gamification | Not started | Not applicable yet | Needs validation | Not deployed |
| HB-9 | Reuse of Atlas/Zoho content (profile, birthdays, resourcing) | Blocked | Not applicable yet | Needs validation | Not deployed |
| HB-10 | Hub content authoring, admin role & authorization | Not started | Known defects | Needs validation | Merged but deployment unverified |

| ID | Works | Incomplete | Known defects | Polish | Scope | Deps / blockers | Testing required | Next action | Pri | Diff |
|---|---|---|---|---|---|---|---|---|---|---|
| HB-1 | `openCompanyHub("checkin")`, item types, priorities (`normal/important/required`), audience targeting, dev seed script (dev-gated) | Only content source is the dev seeder | — | Empty-state design; keyboard nav | FE, BE, DB | HB-10 | `CompanyHub.test`, `test_hub_repo.py`, `test_hub_feed_router.py` | Build authoring (HB-10) | P1 | Small |
| HB-2 | `announcement` type with Read More CTA | No authoring UI, no scheduling UI | — | — | FE, BE | HB-10 | — | HB-10 | P2 | Small |
| HB-3 | Hub → feed wiring, dedup per author | No birthday data source (needs Zoho profile via Atlas — requested, not delivered) | — | — | FE, BE, INT | HB-9 | — | Ask Atlas for birthday field | P2 | Small |
| HB-4 | Only a dev-seed title inside `recognition` | Distinct type/badge/history | — | — | FE, BE | HB-10 | — | Model as recognition subtype | P3 | Small |
| HB-5 | `recognition` type → congratulation feed post | Authoring | — | — | FE, BE | HB-10 | — | HB-10 | P2 | Small |
| HB-6 | Full CRUD subset, reactions upsert, nested-one comments, roster name resolution | No pagination; names resolved client-side (no employee-name table) | 2 tests were in pytest's `lastfailed` cache but **pass now** (229/229) | Empty states | FE, BE, DB | — | `EmployeeProfile.test`, `test_feed_repo.py` | Pagination | P2 | Small |
| HB-7 | `survey` type with "Answer Survey" CTA that only records the click | No survey/poll engine, questions, or results | — | — | FE, BE, DB | Decision: build vs link to external form | — | Decide (§16) | P3 | Large |
| HB-8 | — | — | — | — | FE, BE, DB | Server-side check-in record (CO-3) | — | After attendance persistence | P3 | Medium |
| HB-9 | `ZOHO_ENDPOINT_REQUEST.md` drafted (profile + resourcing endpoints) | Atlas has not delivered endpoints | — | — | INT | Atlas | — | Follow up with Atlas | P2 | Small (ours) |
| HB-10 | `POST /hub/items` exists | **Any authenticated user can create/target hub items** — no role check (Atlas `/auth/me` has `role`, unused); no admin UI | Authorization gap | — | FE, BE | Decision on admin model | Authz tests | Gate create/dismiss-for-others on role; build minimal admin form | P1 | Medium |

### 5.8 HR and operations

| ID | Feature | Implementation | Quality | Validation | Deployment |
|---|---|---|---|---|---|
| HR-1 | HR desk (interaction point / requests entry) | Not started | Not applicable yet | Needs validation | Not deployed |
| HR-2 | Leave requests | Not started | Not applicable yet | Needs validation | Not deployed |
| HR-3 | Early-out requests | Not started | Not applicable yet | Needs validation | Not deployed |
| HR-4 | Attendance & time logs (client-side worked time, Zoho time entries) | Partially implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| HR-5 | Approval notifications | Not started | Not applicable yet | Needs validation | Not deployed |
| HR-6 | Zoho Projects integration (via Atlas `my-tasks` / `my-timelogs`) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| HR-7 | External Atlas/Zoho timelog HTTP 500 and current safe fallback | Blocked | Known defects | Validation failed | Unknown |

| ID | Works | Incomplete | Known defects | Polish | Scope | Deps / blockers | Testing required | Next action | Pri | Diff |
|---|---|---|---|---|---|---|---|---|---|---|
| HR-1 | `hr-chair` seat exists in executive-team art | No HR interaction | — | — | FE, BE | HR-2/3 design | — | Reuse `ConversationRequest`-style request primitive | P3 | Medium |
| HR-2 | — | Whether Zoho People owns leave (Atlas) or we do | — | — | FE, BE, DB, INT | Decision (§16) | — | Decide owner | P3 | Large |
| HR-3 | — | Could reuse checkout flow with a reason | — | — | FE, BE | HR-2 decision | — | — | P3 | Medium |
| HR-4 | Worked-time computation, break minutes, per-day draft, Zoho entries | No server-side attendance record; no history view | — | — | FE (BE later) | CO-3 decision | `workedTime.test`, `checkoutStorage.test` | Persist check-in/out server-side | P2 | Medium |
| HR-5 | — | — | — | — | FE, BE | NT-1, HR-2 | — | — | P3 | Small |
| HR-6 | Project/task grouping from flat task list, promise cache, billable default | Real mode off by default; `mcp` mode retained only to fail loudly | — | — | FE, INT | Render env, Atlas | `AtlasZohoService.test` | Confirm prod env | P1 | Small |
| HR-7 | Fallback today: `mock` default renders sample projects; real-mode failures show `SubmissionFailedPanel` with retry and duplicate detection; UI hidden entirely when not real mode | Atlas `/api/v1/office/my-timelogs` returned HTTP 500 (external); status **today is unverified** | External | Distinguish "Atlas down" from "Zoho rejected" in the panel | INT, FE | Atlas team | Re-run a real submission once Atlas confirms fix | Chase Atlas; add a health probe for `my-tasks` at checkout start | P0 | Small (ours) |

### 5.9 Avatar and 3D pipeline

| ID | Feature | Implementation | Quality | Validation | Deployment |
|---|---|---|---|---|---|
| AV-1 | Existing 2D avatar system (static cast, animated 20-frame sets for bon/alex/micah, placeholder sprite, registry by email) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| AV-2 | Avatar Creator / "Add Employee" (mock mode; real GPT-image path hard-disabled; `avatars` table has no API) | Partially implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| AV-3 | Live-3D registry, gating, device tiers (T0/T1/T2, WebGL1 fallback, microbench rescue, LOD selection, crowd cap dormant) | Implemented | Experimental / proof of concept | Automated and manually validated | Merged but deployment unverified |
| AV-4 | Stage A: headshot → soft-3D identity (Meshy image-to-image, identity-only prompt) | Implemented | Experimental / proof of concept | Needs validation | Local or feature branch only |
| AV-5 | Stage B: approved identity → standardized full body (identity + global style reference) | Implemented | Experimental / proof of concept | Needs validation | Local or feature branch only |
| AV-6 | Bon, Micah, Alex proof of concept (3D) | Partially implemented | Experimental / proof of concept | Validation failed | Local or feature branch only |
| AV-7 | Identity-preservation approval gates | Partially implemented | Experimental / proof of concept | Manual testing only | Local or feature branch only |
| AV-8 | Meshy Nano Banana Pro generation (image-to-image endpoint, ~9 credits/run) | Implemented | Experimental / proof of concept | Manual testing only | Local or feature branch only |
| AV-9 | Meshy image-to-3D (`meshy-generate-employee-3d.mjs`, balance check, 30 credits) | Implemented | Experimental / proof of concept | Manual testing only | Merged but deployment unverified |
| AV-10 | Remeshing (300k target polycount, 5 credits) | Implemented | Experimental / proof of concept | Manual testing only | Merged but deployment unverified |
| AV-11 | Rigging (5 credits; free walking/running clips) | Implemented | Experimental / proof of concept | Manual testing only | Merged but deployment unverified |
| AV-12 | Six animation states (idle-9, walking, agree-gesture, listening-gesture, sit-on-chair-arms, sitting-answering; crossfade mixer) | Implemented | Functional but needs polish | Automated and manually validated | Merged but deployment unverified |
| AV-13 | GLB optimization: Draco, textures, three LODs (`build-character-lods.mjs`, meshoptimizer simplify, DRACOLoader) | Partially implemented | Functional but needs polish | Manual testing only | Merged but deployment unverified |
| AV-14 | Estimated Meshy credits per employee | Implemented | Functional but needs polish | Manual testing only | Not deployed |
| AV-15 | Automated employee-avatar generation (one command, no manual steps) | Not started | Not applicable yet | Needs validation | Not deployed |
| AV-16 | Performance with many simultaneous 3D characters | Not started | Not applicable yet | Needs validation | Not deployed |
| AV-17 | Roaming animated bird / environment characters (`ToucanFlyer`, `toucan.glb`) | Implemented | Functional but needs polish | Manual testing only | Merged but deployment unverified |

| ID | Works | Incomplete | Known defects | Polish | Scope | Deps / blockers | Testing required | Next action | Pri | Diff |
|---|---|---|---|---|---|---|---|---|---|---|
| AV-1 | 19 static portraits, 3 animated sets, faceless placeholder for unmapped people, email→avatar registry | Only 3 of ~21 employees animated; old Gemini/GPT pipeline marked DEPRECATED (paid) | — | — | FE (assets) | Bon's decision on 2D vs 3D per employee | `bonWalkFrames.test`, `avatarIdentity.test` | Decide whether 2D sets are still produced for new hires or 3D replaces them | P2 | Medium |
| AV-2 | Wizard (upload/nickname/outfit/room/review), placeholder-first non-blocking save, localStorage persistence | `resolveMode()` hard-returns `mock`; `RealAvatarService` unreachable; `avatars` DB table has no router/repository | Dead table + dead service = drift | — | FE, BE, DB | Product decision on in-app generation | `MockAvatarService.test`, `avatarStorage.test` | Either wire `avatars` API or drop the table in a migration | P2 | Medium |
| AV-3 | Eligibility (registry) vs permission (tier) split; `?live3d=` dev override; telemetry console log; PiP error boundary | Only `bon` registered; T1 crowd cap 0 pending field data; `REALTIME_LOD_BUDGETS` unused | White-screen fixed in `1b21cea`; no field telemetry sink | Fallback UX when GLB 404s | FE | AV-13 | `deviceTier.test`, `CharacterCanvas.test`, `characterAnimationState.test`; manual on real low-end device | Add a second character to re-arm crowd cap and observe | P1 | Medium |
| AV-4 | Untracked script `identity` stage: own headshot only, no style ref, task JSON with credits, no overwrite | Not yet run to approval on a second employee after the 2026-08-28 redesign | Single-stage predecessor **failed** cross-employee (style bled identity) | — | INT (Meshy), tooling | `MESHY_API_KEY`; Bon approval | Run on Micah & Alex; visual approval | Run Stage A for Micah, Alex → approve | P1 | Small |
| AV-5 | `fullbody` stage: approved Stage-A + fixed global style ref | Same — unvalidated post-redesign | — | — | INT, tooling | AV-4 approval | Same | Run after AV-4 | P1 | Small |
| AV-6 | Bon/jereven: full 3D LOD set shipped and live-3D eligible; Micah/Alex: 2D animated only, Alex previewable via dev override (no shipped GLB) | Micah & Alex 3D not produced | Cross-employee identity test failed 2026-08-28 (revision in progress) | — | INT, FE | AV-4/5 | Three-viewer visual approval | Complete pipeline for Micah & Alex | P1 | Medium |
| AV-7 | Human gates by file convention (`-identity-3d`, `-chibi-ref`), never overwrite, outputs kept out of `public/` | No checklist/scorecard; no side-by-side review tool | — | — | tooling | — | — | Reuse `review-server.mjs` pattern for approvals | P2 | Small |
| AV-8 | Endpoint integration, polling, 3-day URL expiry handled by immediate download | Prompt tuning ongoing | — | — | INT | Meshy account | — | — | P1 | Small |
| AV-9 | Task chain with balance check; used once (task ids logged) | Not parameterized for batch | — | — | INT | Credits | — | — | P2 | Small |
| AV-10 | v1 remesh, 300k polys | Target polycount not tied to tier budgets (6k tris T1) | LOD sizes barely differ (1.3/1.1/1.0 MB) → texture-dominated | — | INT, tooling | AV-13 | — | Tune remesh target per LOD | P2 | Small |
| AV-11 | Rig task; skeleton names verified 26/26 for retargeting | — | — | — | INT | — | — | — | P2 | Small |
| AV-12 | 6 clips consolidated into one GLB per LOD; mixer crossfade | 3 of 6 clip mappings flagged best-guess (`walking`=1, `sit-on-chair-arms`=364, `sitting-answering`=307) | Possible wrong clip choice | Idle variety | FE, tooling | Human check vs Meshy previews | covered | Confirm 3 uncertain ids before batch spend | P2 | Small |
| AV-13 | Draco geometry compression, meshoptimizer simplify per tier, DRACOLoader + decoder vendored | **No texture compression** (KTX2/Basis absent), LOD2 ≈ LOD0 size; `draco_decoder.js` trips lint | Bundle/asset size on T1 | Add KTX2 | tooling, FE | Build-machine toolchain | Size budget test | Add texture downscale/KTX2 step | P1 | Medium |
| AV-14 | Logged: image-to-3D 30 + remesh 5 + rig 5 + 5 clips×3 = **55 credits**; image stages ~9 each ×2 = **~18**; ≈ **73 credits/employee** before retries (balance 976→961 during clip run) | Retry rate unknown | — | — | — | — | — | Track per-employee actuals in task JSON | P2 | Small |
| AV-15 | Individual scripts exist for every stage | No orchestrator; approval gates are manual by design | — | — | tooling | AV-4..13 validated | Dry-run mode | Write `generate-employee.mjs` orchestrator with `--stage` resume | P2 | Large |
| AV-16 | Tier caps designed (T2: 4 crowd) | No measurement with >1 live-3D character; `useFrameBudget` exists but unconsumed for capping | Unknown | — | FE | AV-6 (second character) | Frame-time test with 5–20 GLBs | Benchmark once Micah/Alex ship | P1 | Medium |
| AV-17 | Ambient toucan on a flight path, rigged placeholder GLB (1.4 MB) | Not tier-gated like characters (check on T0) | Meshy rig lacked wing bones → placeholder rig kept | — | FE | — | No unit test; add gating test | Gate on tier; consider more ambient NPCs later | P3 | Small |

### 5.10 Platform quality and deployment

| ID | Feature | Implementation | Quality | Validation | Deployment |
|---|---|---|---|---|---|
| PQ-1 | Frontend/backend/database architecture (SPA + FastAPI/Socket.IO + SQLAlchemy/Alembic + Atlas) | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| PQ-2 | Socket events & in-memory registries (14 events; 5 registries) | Implemented | Known defects | Automated tests only | Merged but deployment unverified |
| PQ-3 | Database migrations & persistence (10 migrations, linear chain, `alembic upgrade head` on deploy) | Implemented | Known defects | Automated tests only | Merged but deployment unverified |
| PQ-4 | Error boundaries & white-screen prevention | Implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| PQ-5 | Test coverage (79 FE files/997 tests; 26 BE files/229 tests; no e2e) | Partially implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| PQ-6 | Accessibility | Partially implemented | Known defects | Needs validation | Merged but deployment unverified |
| PQ-7 | Responsive behavior | Not started | Known defects | Needs validation | Merged but deployment unverified |
| PQ-8 | Performance (device tiers, frame budget, shared renderer, GLB cache) | Partially implemented | Functional but needs polish | Automated tests only | Merged but deployment unverified |
| PQ-9 | Observability & logs | Partially implemented | Known defects | Needs validation | Unknown |
| PQ-10 | Security | Partially implemented | Known defects | Automated tests only | Merged but deployment unverified |
| PQ-11 | Render cold starts | Partially implemented | Known defects | Manual testing only | Unknown |
| PQ-12 | Build/version metadata | Not started | Known defects | Needs validation | Not deployed |
| PQ-13 | Frontend/backend branch alignment | Partially implemented | Functional but needs polish | Needs validation | Unknown |
| PQ-14 | Production deployment certainty | Not started | Known defects | Needs validation | Unknown |

| ID | Works | Incomplete | Known defects | Polish | Scope | Deps / blockers | Testing required | Next action | Pri | Diff |
|---|---|---|---|---|---|---|---|---|---|---|
| PQ-1 | Clear service seams (mock/real singletons), REST error shape `{error}`, single origin for REST+socket, identity = email (no users table) | `OfficeMap.tsx` is **4,235 lines** (god component); stale `backend/dist/` Node build and two `.db` files sit locally (gitignored); `backend/README.md` says "no routers wired" (stale) | — | Split OfficeMap into feature hooks; refresh READMEs | FE, BE | — | — | Incremental extraction (movement, chat windows, checkout already partly hooked) | P2 | Large |
| PQ-2 | Snapshot-on-connect for all registries; disconnect cleanup; stale-request cancellation | `offline_lineup`, `spatial_sessions`, `dnd_registry`, `room_presence` vanish on restart; only positions reload from DB | State loss on every deploy/cold start (free tier spins down after 15 min) | — | BE | Decision: persist vs. accept | Restart test | Persist lineup/DND expiry; rebuild others from clients on reconnect | P1 | Medium |
| PQ-3 | Linear chain `b666…→…→f6a7→a2b3`; partial unique indexes for SQLite+Postgres; `test_migrations.py` | `a2b3c4d5e6f7` only on the movement branch; `avatars` table unused | **Free Render Postgres expires 30 days after creation, then deletes data**; only one free Postgres per workspace | — | DB, INT | Bon: paid plan | Migration test on Postgres (currently SQLite in tests) | Upgrade plan before expiry; add Postgres CI job | P0 | Small |
| PQ-4 | App-level + PiP boundary; `connect_error` breaks stuck states | No global `window.onerror`/unhandled-rejection capture; no user-facing reload CTA copy review | — | — | FE | PQ-9 | `ErrorBoundary.test` | Add error reporting hook | P2 | Small |
| PQ-5 | Broad unit coverage, socket integration tests with real `AsyncClient`, migration test | **No e2e**; Playwright installed but unconfigured; timing bugs repeatedly found only by live driving | — | — | FE, BE | — | — | Add Playwright smoke: login-bypass → check-in → move → chat → checkout | P1 | Medium |
| PQ-6 | `aria-`/`role` in 14 components; Escape closes menus | No audit; canvas interactions mouse-only; contrast unchecked | Keyboard-only users cannot move or open menus | — | FE | — | axe pass | Baseline audit + keyboard map | P2 | Medium |
| PQ-7 | Zoom/pan canvas | **Zero `@media` queries**; floating chat stack and HUD assume desktop | Unusable on phones/tablets | — | FE | Decision: desktop-only? | Viewport matrix | Decide target devices (§16) | P2 | Large |
| PQ-8 | Tier detection + microbench, LOD selection, shared WebGL renderer, GLB cache | `useFrameBudget` not used for adaptive capping; no perf budget test | — | — | FE | AV-16 | Frame-time benchmark | Wire frame budget into crowd cap | P2 | Medium |
| PQ-9 | Backend `logging.exception` on unhandled; FE `[device-tier]` console telemetry | No structured logs, no error tracker, no metrics, no uptime check | Blind in production | — | FE, BE, INT | Tool choice | — | Add Sentry-class reporting + Render health check on `/health` | P1 | Medium |
| PQ-10 | Server-side identity for every REST/socket action; dev bypass fail-closed; secrets out of `VITE_*`; `.env` files untracked; CORS exact-origin | Hub create/target has no role check (HB-10); DND allowance client-enforced; no rate limiting; token cache keyed by raw token in memory | Authorization gap on hub | — | BE | — | Authz tests | Fix HB-10; add basic rate limit on `send_message` | P1 | Medium |
| PQ-11 | Split connect/ack timeouts, "waking up" state, `connect_error` handling (`47b9a4c`, `7dacad9`) | Free web service sleeps after 15 min → ~1 min first-message latency; 750 free hours shared workspace-wide | Cold-start UX | Pre-warm on office load | INT, FE | Bon: paid plan | Manual cold-start test | Decide plan (§16) | P1 | Small |
| PQ-12 | — | `package.json` version `0.0.0`; FastAPI `version="0.1.0"`; no commit SHA in `/health` or UI | Cannot tell what is deployed | — | FE, BE | — | — | Inject `VITE_GIT_SHA` at build; return sha in `/health`; show in a debug corner | P0 | Small |
| PQ-13 | Same repo, so a branch is self-consistent | Two independently-built Render services can run different commits; frontend build-time env must match backend routes | Movement branch frontend against `origin/main` backend would emit events the server lacks (`positions_snapshot` absent) | — | INT | PQ-12 | — | Deploy backend first; verify sha on both | P0 | Small |
| PQ-14 | `render.yaml` + `DEPLOY.md` describe intended topology | Blueprint not proven connected; Static Site Root Directory noted as needing manual change (`app`→`frontend`); `VITE_OFFICE_INTEGRATION_MODE`/`VITE_ZOHO_INTEGRATION_MODE` undocumented for prod; memory notes suggest production is on stale `b31c412` | Unknown live commit and env | — | INT | Bon (dashboard access) | Verify in Render dashboard | Record live commit/env in a `DEPLOY_STATE.md`; adopt release tags | P0 | Small |

---

## 6. Current architecture overview

```
Browser (Atlas origin, /virtual-office)  ──JWT in localStorage["token"]──▶  Atlas API (auth/me, office/*, my-tasks, my-timelogs, SSE events)
   │  Vite/React 19 SPA (frontend/)                                          ▲
   │   ├─ services/api      → Atlas REST (absolute URLs from VITE_API_URL)  │ token proxy-verified
   │   ├─ services/office   → roster/presence (mock|real)                    │
   │   ├─ services/zoho     → time logs via Atlas (mock|real|mcp-fails-loud) │
   │   ├─ services/chat     → REST + Socket.IO (mock|real)                   │
   │   ├─ services/presence → offline lineup, spatial sessions, DND, room    │
   │   │                      presence, movementSync (all Socket.IO)         │
   │   ├─ services/hub|feed → Company Hub + Employee Feed REST               │
   │   └─ render3d          → three.js CharacterCanvas, LOD GLBs, Draco      │
   └──Socket.IO + REST (VITE_CHAT_SOCKET_URL)──▶  FastAPI + python-socketio (backend/app)
                                                    ├─ auth: verify_atlas_token ──────────┘
                                                    ├─ routers: chat, requests, room_requests, talk_requests, hub, feed
                                                    ├─ realtime/socket.py: 14 events, 8 emit types
                                                    ├─ in-memory: OfflineLineup, SpatialSessionRegistry, DndRegistry,
                                                    │             RoomPresenceRegistry, PositionRegistry (single worker)
                                                    └─ SQLAlchemy async → SQLite (dev) / Render Postgres (prod)
                                                         tables: avatars(unused), conversations, conversation_participants,
                                                         messages(+mentions), conversation_requests, room_entry_requests,
                                                         talk_requests, hub_items, hub_item_states, feed_posts,
                                                         feed_reactions, feed_comments, employee_positions (branch)
Offline tooling (frontend/scripts/avatar-pipeline): Meshy image-to-image → image-to-3D → remesh → rig → 6 clips → build-character-lods → public/avatars/<id>/<id>-lod{0,1,2}.glb
```

Socket events (server-handled): `connect`, `disconnect`, `go_offline`, `come_online`, `spatial_session_start/leave`, `dnd_set`, `room_presence_enter/leave`, `walk_started`, `walk_arrived`, `join_conversation`, `send_message`, `typing`, `message_read`, `message_delivered`. Server emits: `chat_error`, `dnd_status`, `incoming_message`, `message_saved`, `offline_lineup`, `room_presence`, `spatial_sessions`, `unread_count`, plus request/receipt/typing relays and (branch) `positions_snapshot`.

Design constraints baked in: no users table (email is identity); all realtime state single-process; frontend env is build-time only; app must serve under `/virtual-office/` because Atlas's proxy preserves the prefix.

---

## 7. Branch and deployment matrix

| Branch | Head | Relationship | Contains | Deployment status |
|---|---|---|---|---|
| `origin/main` | `bcea21c` (2026-08-28) | Merge of PR #7 (`new-features`) | Everything through DND protections/mentions/chat polish (`0272948`), right-click movement (local-only emit), toucan, Company Hub + feed, global chat, Ask-to-Join, presence system, live-3D | **Unverified.** Docs describe Render Static Site + `virtual-office-api` + `virtual-office-db`; no evidence of which commit is live. Memory notes from earlier sessions claim production was on `b31c412` (2026-08-19) — unconfirmed. |
| `main` (local) | `163103b` (2026-08-22) | 10 commits behind `origin/main` | Stale | n/a — do not use as a reference |
| `new-features` | `0272948` | Fully merged into `origin/main` (0 commits ahead) | — | Same as `origin/main` |
| `fix/chat-unread-spatial-receipts` | `3bd7119` | `0272948` + 1 commit | Unread/mention recount after read, spatial-vs-remote routing, live group receipts; validated 196/196 BE, 943/943 FE, tsc, build, lint, 3-browser manual | Pushed; **no PR**; Local or feature branch only |
| `fix/multiplayer-movement-sync` (HEAD) | `a2a91a6` | `3bd7119` + 1 commit (37 files, +4,558/−699) | Unified `moveSelf`, server `PositionRegistry`, `employee_positions` migration, `positions_snapshot`, `PeerWalker` replay, roster dedup, `useAuthGate` identity plumbing; 229 BE / 997 FE tests | Pushed; **no PR**; master-approved; 3-browser retest deferred; Local or feature branch only |
| `chat-status-indicators-2026-08-14`, `avatar-masters-update`, `avatar-sprite-refresh`, `session/*` | older | Historical; content merged or superseded | — | Not relevant to deployment |

**Deployment facts vs. assumptions**

| Item | Evidence | Status |
|---|---|---|
| Backend service definition | `render.yaml`: `virtual-office-api`, free plan, `alembic upgrade head && uvicorn` | Defined; Blueprint connection unproven |
| Backend URL | `DEPLOY.md`: `https://virtual-office-api-0hzd.onrender.com` (bare hostname belongs to a third party) | Documented only |
| Database | `render.yaml`: `virtual-office-db`, free plan, **30-day expiry** | Creation date unknown → expiry risk unquantified |
| Frontend | `DEPLOY.md`: Static Site, root `frontend`, publish `dist`, SPA rewrite; Root Directory fix flagged as pending manual action | Dashboard-managed; state unknown |
| Frontend env in prod | `DEPLOY.md` lists `VITE_API_URL`, `VITE_CHAT_MODE`, `VITE_CHAT_SOCKET_URL` only | `VITE_OFFICE_INTEGRATION_MODE` and `VITE_ZOHO_INTEGRATION_MODE` undocumented → prod may be mock |
| CI / release process | None in repo (`.github/` absent) | Not started |
| Version stamp | None | Cannot verify live commit |

---

## 8. Implemented features needing polish

Ordered by impact.

1. **Status visibility (PS-1..5, PS-11)** — self statuses other than DND are invisible to colleagues. Needs a server-side presence registry.
2. **Notification surfaces (NT-2/3/6/8)** — eight independent toasts/badges with no stacking rules, persistence, or deep links.
3. **Chat cold-start UX (CH-1, PQ-11)** — ~1 min "waking up" on the free tier; per-message avatars disabled behind `ALWAYS_USE_INITIALS`.
4. **Seating & doors (CO-10, CO-11)** — seat directions mostly default to `front`; 3 rooms lack door stand pairs; 8 rooms lack door art.
5. **Company Hub content (HB-1/2/3/5)** — only the dev seeder creates items; no authoring UI; create endpoint unauthorized.
6. **Auth identity (CO-1)** — user-id field unconfirmed; `"bon"` fallback.
7. **Employee feed (HB-6)** — no pagination; client-side name resolution.
8. **Live-3D asset size (AV-13)** — LODs are texture-dominated; no KTX2.
9. **Offline lineup / DND / spatial registries (PQ-2)** — lost on restart.
10. **Group chat management (CH-2)** — no leave/rename/add-member.
11. **Toucan tier gating (AV-17)**, **RoomSidebar test gap (CO-12)**, **stale READMEs (PQ-1)**.

---

## 9. Partial and unfinished features

| Feature | What exists | What's missing | Gate |
|---|---|---|---|
| Multiplayer movement sync (MV-1/4/5/6/7/8) | Complete on branch, tests green, review approved | 3-browser manual retest, PR, backend-first deploy with migration | Bon runs checklist |
| Chat receipt/routing fixes (CH-4/5/7) | Complete on branch, manually validated | PR + deploy | Merge order: chat fix is an ancestor of movement branch — one PR from `fix/multiplayer-movement-sync` carries both |
| Cross-client status sync (PS-11) | DND only | `status_set` event + registry + snapshot | Design |
| Seating directions (CO-10) | Table + tool | Bon's per-seat pass | Design work |
| Doors (CO-11) | 7/10 stand pairs, 2 door arts | Remaining paint | Design work |
| Hub content types (HB-2/3/5/7) | Types + CTA wiring | Authoring, data sources, survey engine | HB-10, HB-9 decisions |
| Avatar Creator (AV-2) | Mock wizard | Real generation deliberately disabled; `avatars` table orphaned | Product decision |
| 3D identity pipeline (AV-4/5/6/7) | Two-stage script, human gates | Validation on Micah/Alex after failed single-stage test | Bon approval loop |
| GLB optimization (AV-13) | Draco + simplify + 3 LODs | Texture compression | Toolchain |
| Attendance (HR-4, CO-3) | Client-side | Server-side check-in/out record | Decision |
| Test strategy (PQ-5) | Unit + socket integration | e2e smoke | Playwright config |
| Accessibility (PQ-6), Performance capping (PQ-8), Observability (PQ-9), Security hardening (PQ-10), Cold starts (PQ-11), Branch alignment (PQ-13) | Partial mitigations | See §5.10 | — |

---

## 10. Planned feature pipeline (not started)

- **Notifications:** NT-1 center, NT-4/5/7 sources, NT-10 deep links, NT-11 grouping/preferences/history.
- **Voice/video/meetings:** VV-1..13 (all).
- **Chat media:** CH-12 attachments, CH-13 reactions, CH-14 voice messages.
- **Presence:** PS-7 In Call.
- **Engagement:** HB-4 Employee of the Month, HB-8 streaks/gamification, HB-10 authoring/admin.
- **HR:** HR-1 desk, HR-2 leave, HR-3 early-out, HR-5 approvals.
- **Avatar automation:** AV-15 orchestrator, AV-16 crowd performance.
- **Platform:** PQ-7 responsive, PQ-12 version metadata, PQ-14 deployment certainty, MV-11 Redis (deferred by design).
- **Previously planned in memory notes and now implemented:** door stand-here mechanic (CO-11), Approach replacing Pat (MV-2), Phase 3 real chat (CH-1), backend/DB relayering (PQ-1/3).

---

## 11. Known defects and technical debt

**Defects (behaviour is wrong or at risk)**

| # | Where | Defect | Evidence | Fix path |
|---|---|---|---|---|
| D1 | `origin/main` movement | Right-click walks and cluster anchors not consistent across clients | Branch `a2a91a6` message + memory repro | Merge movement branch |
| D2 | `origin/main` chat | Unread badge stale after read; duplicate spatial/remote windows; group receipts require reopen | `3bd7119` message | Merge chat fix (ancestor of D1 branch) |
| D3 | Presence | Busy/Break/Lunch/Away never reach peers | `selfStatusStore.ts` docstring: "client-side-only for self" | PS-11 |
| D4 | Hub authz | Any authenticated user can create hub items for everyone | `routers/hub.py` `create_hub_item` has no role check | HB-10 |
| D5 | Persistence | Lineup/DND/spatial/room registries lost on restart; free tier restarts often | Module docstrings; `render.yaml` free plan | PQ-2 |
| D6 | Database | Free Postgres deletes data ~44 days after creation | `render.yaml` comment | Paid plan |
| D7 | External | Atlas `/my-timelogs` HTTP 500 blocks real checkout submission | Memory/env notes (2026-08-14); unverified today | Atlas |
| D8 | Deploy | Unknown live commit; possible mock modes in prod; movement frontend incompatible with main backend | PQ-12/13/14 | Version stamp + deploy order |
| D9 | Identity | `/auth/me` id field unconfirmed → `"bon"` fallback | `useAuthGate.ts` comments | CO-1 |
| D10 | 3D pipeline | Single-stage identity conversion bled style across employees | Untracked script header (2026-08-28) | Two-stage rerun |
| D11 | Responsive | No media queries; desktop-only | grep | PQ-7 decision |
| D12 | Cold start | ~1 min first request after idle | `render.yaml`, chat fixes | Plan upgrade or pre-warm |

**Technical debt**

- `OfficeMap.tsx` at 4,235 lines; movement/checkout/chat-window logic partially extracted, rest inline.
- Orphaned `avatars` table + unreachable `RealAvatarService`; `McpZohoService` kept only to fail loudly.
- Deprecated paid 2D pipeline scripts (Gemini/GPT) retained under `avatar-pipeline/` with `DEPRECATED.md`; ~40 scripts of historical calibration runs.
- Stale docs: `backend/README.md` ("no routers wired"), `frontend/README.md` (Node backend `npm run migrate`, port 4800), `db/README.md` (lists only avatars + chat tables), `CHAT_FEATURE_PLAN.md` (pre-Phase-3 assumptions).
- Local-only cruft: `backend/dist/` (old Node build), `virtual_office_fastapi.db`, `dev_hub_playground.db` (all gitignored).
- FastAPI `on_event("startup")` deprecated in favour of lifespan (test warning).
- `playwright` and `puppeteer` dev deps with no harness.
- DND session/allowance enforcement client-side; token verification cache keyed by raw token in process memory.
- Three of six Meshy clip ids are best-guess; LOD pipeline lacks texture compression.
- `REALTIME_LOD_BUDGETS`, `useFrameBudget` defined but unconsumed.
- `SEAT_DIRECTIONS_TODO.md` lists dozens of unassigned seats.
- No CI, no lint/type gate on PRs, no release tagging.

---

## 12. Dependencies and blockers

| Dependency | Blocks | Owner | Status |
|---|---|---|---|
| Atlas: confirm `/auth/me` user-id field | CO-1, avatar mapping | Atlas | Open since 2026-08-07 |
| Atlas: fix `/api/v1/office/my-timelogs` 500 | CO-5, HR-6/7 | Atlas | Unverified |
| Atlas: Zoho profile/resourcing endpoints (`ZOHO_ENDPOINT_REQUEST.md`) | HB-3 birthdays, HB-9, avatar seeding | Atlas | Requested, not delivered |
| Render dashboard: confirm Blueprint, Static Site root dir, env vars, live commits | PQ-14, everything marked unverified | Bon | Open |
| Render plan: paid Postgres (expiry) and web service (cold start, uploads) | D6, D12, CH-12/14 | Bon | Decision |
| Three-browser manual retest of movement branch | MV-*, CH-4/5/7 merge | Bon | Deferred |
| Bon design pass: seat directions, door markers/art | CO-10, CO-11 | Bon | Ongoing |
| Bon approval gates: Stage A/B images for Micah & Alex | AV-4..6 | Bon | Pending rerun |
| Meshy credits (~73/employee) | AV-* | Budget | Balance ~961 at last log |
| Voice/video vendor & hosting decision | VV-* , NT-4, PS-7 | Bon/team | Not decided |
| Admin/role model for hub authoring | HB-10, HB-2/5 | Bon/team | Not decided |
| Desktop-only vs responsive target | PQ-7 | Bon/team | Not decided |

---

## 13. Recommended release phases

**Phase 1 — Foundation and stability**
Merge and deploy the two fix branches (backend first, migration verified); add version stamp to `/health` and UI; verify Render env (`VITE_OFFICE_INTEGRATION_MODE=real`, `VITE_ZOHO_INTEGRATION_MODE=real`, socket URL) and record live state; move Postgres to a paid plan before expiry; Playwright smoke; error reporting; persist or rebuild in-memory registries; fix hub create authorization; resolve Atlas id field and timelog 500. Exit: every P0 in §5 closed, one documented production verification.

**Phase 2 — Unified communication and notifications**
Server-side status registry (PS-11) with snapshot; notification center (NT-1/9) consolidating chat, requests, DND, hub; deep links (NT-10); chat reactions (CH-13); group management (CH-2); attachments only after storage decision (CH-12). Exit: one notification model, all existing toasts routed through it, 2-browser validation.

**Phase 3 — Voice/video and meetings**
Vendor/hosting decision (VV-13); LiveKit token endpoint reusing Atlas identity (VV-1); 1:1/group calls keyed by conversation (VV-2); In Call status (VV-6/PS-7); incoming-call notifications (VV-7/NT-4); spatial audio scoped to spatial sessions (VV-3); tiles above avatars (VV-4). Meetings/calendar (VV-9/10/11) as a follow-on after Atlas OAuth discussion.

**Phase 4 — Company Hub and HR**
Admin/role model and authoring UI (HB-10); birthday/profile data via Atlas (HB-9/3); recognition + Employee of the Month (HB-5/4); survey decision (HB-7); server-side attendance (CO-3/HR-4); HR desk + leave/early-out requests reusing the request primitive (HR-1/2/3); approvals into notifications (HR-5); streaks after attendance persists (HB-8).

**Phase 5 — 3D avatar automation**
Validate two-stage identity pipeline on Micah and Alex with approval gates (AV-4..7); confirm uncertain clip ids (AV-12); add texture compression (AV-13); ship second/third characters to re-arm crowd caps (AV-3); benchmark 5–20 live-3D characters (AV-16); write the orchestrator with resumable stages and per-employee cost log (AV-15/14); decide fate of Avatar Creator/`avatars` table (AV-2).

**Phase 6 — Production scaling and hardening**
CI with lint/type/test/migration-on-Postgres gates; release tags; observability (structured logs, metrics, uptime); rate limiting; DND policy server-side; accessibility baseline; responsive decision; `OfficeMap.tsx` decomposition; Redis adapter only if a second worker/instance becomes necessary (MV-11).

---

## 14. Recommended next 10 milestones (dependency order)

1. **Validate & merge `fix/multiplayer-movement-sync`** — run the deferred three-browser checklist (right-click, approach, ask-to-join, sit, late join, reconnect, T0 vs T2 viewer), open one PR (carries the chat fix), merge. *Depends on: Bon's session.*
2. **Deploy with certainty** — add commit SHA to `/health` and a UI debug corner; deploy backend (migration `a2b3c4d5e6f7`) then frontend; confirm Render env vars and Static Site root dir; write `docs/DEPLOY_STATE.md` with live commit + env. *Depends on: 1.*
3. **Protect the data** — upgrade `virtual-office-db` to a paid plan (or export/backup) before the 30-day expiry; decide web-service plan for cold starts. *Independent; urgent.*
4. **Close external blockers** — Atlas: `/auth/me` id field, `/my-timelogs` 500, Zoho profile endpoint. Verify a real checkout submission end to end. *Depends on: Atlas.*
5. **Playwright smoke + error reporting** — one e2e covering check-in → move → chat → DND → checkout in dev-bypass mode; wire a global error sink. *Depends on: 2.*
6. **Server-side status registry (PS-11)** — `status_set` event, snapshot on connect, peers render the 9-value palette; move DND allowance enforcement server-side. *Depends on: 1.*
7. **Notification center (NT-1/9/10)** — `notifications` table + socket event + FE store; route chat/mention, requests, DND queue, hub items through it; deep links via in-app intent map. *Depends on: 6.*
8. **Hub authoring & authorization (HB-10 → HB-2/3/5)** — role check from Atlas `role`, minimal admin form, birthday source from Atlas. *Depends on: 4 (Zoho endpoint) for birthdays; authz independent.*
9. **Voice/video spike (VV-13 → VV-1/2/6/7)** — decision memo, LiveKit token endpoint, 1:1 call between two browsers, In Call status, incoming-call notification. *Depends on: 7.*
10. **3D pipeline validation on Micah & Alex (AV-4..7, AV-12/13/16)** — rerun two-stage identity, approve, produce LODs with texture compression, register both, benchmark crowd rendering. *Independent of 1–9; gated on Bon's approvals and credits.*

---

## 15. Definition of Done

**Universal DoD (applies to every feature ID):** (a) code merged to `origin/main` via PR; (b) unit/integration tests added or updated and green in both suites; (c) `tsc`, `oxlint`, `ruff` clean; (d) manual validation recorded (who, when, browsers/devices, scenario) — multi-user features require ≥2 simultaneous browsers, spatial/animation features ≥3 and a live drive; (e) migration (if any) applied on Postgres, not just SQLite; (f) deployed to Render with the live commit SHA recorded; (g) docs updated (`DEPLOY.md`/READMEs where touched); (h) no new P0/P1 defect open against it. Only when (a)–(h) all hold may Quality be set to *Production-ready*.

**Feature-specific DoD additions**

| ID | Additional DoD |
|---|---|
| CO-1 | Real Atlas response drives identity with no fallback; contract test against a captured `/auth/me` body |
| CO-2 | Documented in one place; verified compiled out of a production bundle |
| CO-3 | Check-in persisted server-side (or explicitly decided not to); hub opens once per day |
| CO-4 | One recorded full checkout in production with real Zoho entries |
| CO-5 / HR-6 / HR-7 | Successful `my-timelogs` write against Atlas prod; failure panel distinguishes Atlas-down vs Zoho-rejected |
| CO-6 | Draft survives reload; retry never double-logs |
| CO-7 | Fires exactly once at 8h across a Manila midnight boundary test |
| CO-8 | `real` mode confirmed in production; SSE reconnect observed |
| CO-9 / PS-9 | Lineup survives backend restart or is rebuilt; disconnect semantics decided and documented |
| CO-10 | Every seat in `SEAT_DIRECTIONS_TODO.md` assigned; per-employee assigned desk decided |
| CO-11 | All 10 rooms have stand pairs; door-hold timing live-verified |
| CO-12 | RoomSidebar/CharacterSearch unit tests exist |
| MV-1..8 | Three-browser checklist passed post-merge in production; snapshot on late join within 1 s; no divergent positions after 10 min |
| MV-9 | Path never crosses non-walkable cells (property test) |
| MV-10 | Client/server lock decisions never disagree (shared fixture test) |
| MV-11 | Decision recorded; if built, two workers pass the socket suite |
| PS-1..5, PS-11 | Peer sees status change within 1 s in two browsers; persists across reload |
| PS-3 | Idle → Away → active round-trip test |
| PS-6 | Set/unset with spatial session start/leave |
| PS-7 / VV-6 | Set by real call state |
| PS-8 | Allowance enforced server-side; expiry restores previous status; room unlock cancels stale requests |
| PS-10 | Precedence table has a test per row |
| CH-1 | Cold-start send succeeds within timeout in production; avatars re-enabled |
| CH-2 | Leave/rename/add member |
| CH-3 | Stack behaves at ≥3 windows on 1280px width |
| CH-4/5/7 | Fix commit merged and observed live |
| CH-6 | "Seen" times identical for a batch read |
| CH-8 | No typing event without a keystroke (test) |
| CH-9 | Original DM unchanged after upgrade (DB assertion) |
| CH-10 | Manual DND scenario checklist executed with 3 browsers |
| CH-11 | Non-participant mentions dropped server-side |
| CH-12/14 | Storage provider chosen; size/type limits; virus/MIME checks |
| CH-13 | Reaction upsert semantics as in feed |
| CH-15 | Production build fails if mock mode would ship |
| NT-1..11 | Every existing toast routed through the center; unread persists; deep link opens exact target; preferences respected |
| VV-1..13 | Decision memo approved; token minted only for verified email; call between two browsers with reconnect; recording/cost documented |
| HB-1 | Empty state and `required` acknowledgement flow verified |
| HB-2/5/4 | Created through authorized UI, visible to audience only |
| HB-3 | Birthday sourced from Atlas; one post per author per item |
| HB-6 | Pagination; delete authorization test |
| HB-7 | Decision made; if built, results visible to authors |
| HB-8 | Based on server-side attendance |
| HB-9 | Endpoints live and consumed |
| HB-10 | Role check tested for allow/deny |
| HR-1..5 | Request primitive reused; approvals notify; owner (Zoho vs VO) decided |
| HR-4 | Server record of check-in/out per day |
| AV-1 | Every active employee has a mapped avatar or placeholder by design |
| AV-2 | Either functional API-backed creator or table dropped |
| AV-3 | ≥2 registered characters; crowd cap observed on T2; T0 never loads GLB |
| AV-4..7 | Bon-approved Stage A and B images for ≥2 non-Bon employees; scorecard recorded |
| AV-8..11 | Task ids and credits logged per employee |
| AV-12 | All 6 clip ids human-confirmed against Meshy previews |
| AV-13 | LOD2 ≤ 50% of LOD0 bytes; textures compressed |
| AV-14 | Actual per-employee cost tracked for ≥3 employees |
| AV-15 | Single command with resumable stages and approval pauses |
| AV-16 | Frame-time report for 5/10/20 characters per tier |
| AV-17 | Tier-gated; not loaded on T0 |
| PQ-1 | `OfficeMap.tsx` < 1,500 lines; READMEs accurate |
| PQ-2 | Restart test: state restored or rebuilt within one reconnect |
| PQ-3 | Migrations tested on Postgres in CI; DB on paid plan with backups |
| PQ-4 | Global error sink; boundary fallback copy reviewed |
| PQ-5 | e2e smoke in CI |
| PQ-6 | axe audit with no critical issues; keyboard movement/menu access |
| PQ-7 | Target devices decided; layouts verified at chosen breakpoints |
| PQ-8 | Frame budget drives crowd cap |
| PQ-9 | Errors and uptime visible in a dashboard |
| PQ-10 | Authz tests for every mutating endpoint; rate limit on `send_message` |
| PQ-11 | Plan decided; first-request latency measured |
| PQ-12 | SHA visible in `/health` and UI |
| PQ-13 | Deploy runbook: backend → migrate → frontend; SHA parity check |
| PQ-14 | `DEPLOY_STATE.md` current; Blueprint connected; env documented |

---

## 16. Product and architecture decisions requiring Bon/team approval

1. **Merge & deploy order for `fix/multiplayer-movement-sync`** — one PR carrying both fixes; backend deployed before frontend (migration). Confirm who runs the three-browser retest and when.
2. **Render plans** — pay for Postgres before the 30-day expiry (data loss otherwise); pay for the web service to remove cold starts; any file/voice attachments require a paid plan or external object storage.
3. **Production environment modes** — confirm the Static Site builds with `VITE_OFFICE_INTEGRATION_MODE=real` and `VITE_ZOHO_INTEGRATION_MODE=real`; decide whether a production build should refuse to ship any `mock` mode.
4. **Status synchronization scope** — own presence registry broadcast over Socket.IO (recommended) vs. writing statuses back to Atlas; whether socket disconnect should imply Offline.
5. **Notification persistence** — DB-backed history with read state (recommended) vs. ephemeral in-session only.
6. **Hub authoring model** — who may create announcements/recognition (Atlas `role` values to trust), and whether an admin UI lives in Virtual Office or content is pushed from Atlas.
7. **Voice/video** — LiveKit Cloud vs. self-hosted; recording (privacy/retention); budget; whether meetings/calendar are in scope this year and whether Google Calendar OAuth should be brokered by Atlas (same reasoning as the Zoho request).
8. **Surveys/polls** — build a survey engine vs. link out to an existing tool from a hub item.
9. **HR requests ownership** — leave/early-out in Zoho People via Atlas vs. Virtual Office-native requests.
10. **Server-side attendance** — persist check-in/out (enables streaks, history, reminders across devices) vs. keep client-side.
11. **Avatar strategy** — continue producing 2D animated sets for new hires or move everyone to the Meshy 3D pipeline (T0/T1 devices fall back to placeholder/2D); approve ~73 Meshy credits per employee plus retries; decide the fate of the in-app Avatar Creator and orphaned `avatars` table.
12. **Responsive target** — desktop-only (document and gate) vs. tablet/mobile support (large effort on the canvas UI).
13. **Redis / multi-worker** — remain single-process (recommended at current headcount) and document as a hard constraint.
14. **Observability tooling** — choice of error tracker/log sink (cost, data residency).
15. **Clean-up authorizations** — removing deprecated paid-pipeline scripts, stale READMEs, `backend/dist/`, and local `.db` files (only with Bon's go-ahead, per standing feedback to ask before touching assets/artifacts).
