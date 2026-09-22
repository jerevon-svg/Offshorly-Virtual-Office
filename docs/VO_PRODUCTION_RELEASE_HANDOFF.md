# Virtual Office — V1/V2 integration: production release handoff

**For:** Jan, preparing and applying the production deployment.
**From:** Bon.
**Branch:** `vo-v1-v2-integration`. Last code commit: `605aebe` (this document is committed after it, so the branch head will be the docs commit).
**Status:** nothing has been pushed, merged or deployed. No production database, permission, environment variable or service has been touched. This document is a plan and a checklist, not a record of work done to production.

> **Supersedes `docs/PHASE_9A_PRODUCTION_HANDOFF.md` where the two disagree.** That document is still accurate about the Office Experience *foundation*, but it was written when no seasonal office existed and states that Halloween and Christmas are "not built yet" and report `implemented: false`. Both have since shipped. Everything else in it — the permission model, the migration's shape, the failure modes — still holds, and §4 of this document does not repeat its detail.

> **Unknowns are marked `[VERIFY]`.** Every one of them is something only you can see. I have not guessed at production's migration state, its Render dashboard values, or its current Atlas wiring, and where a command needs one of those values it is written as a placeholder rather than filled in.

---

## 1. What this release actually is

This is not an incremental change. Production today serves **only the 2D Classic office** — `frontend/src/services/settings/officeExperience.ts` does not exist on `origin/main` at all, so there is no office selector, no 3D world, and no seasonal machinery in the deployed bundle.

Merging this branch ships, in one release:

- the entire 3D office (V2) — world, rooms, lighting, weather, audio, camera and movement;
- V1/V2 integration — shared identity, presence, movement, seating, chat, DND, room access, calls and attendance across both offices;
- the Office Experience selector, the server-side experience catalog, and the Creator Studio;
- two seasonal offices (Halloween, White Christmas), **both unpublished**.

**The single most consequential line in this release:** after deploy, the 3D office becomes what a normal URL opens, for everybody. No production employee has a saved office preference (the storage key does not exist in the deployed bundle yet) and `company_settings` starts empty, so every employee resolves to the company default, which is the 3D office.

That is deliberate — commit `d75d2f2`, "make the 3D office the default, with Classic as a first-class choice" — but it should be a decision someone makes on purpose on the day, not a side effect they discover. §9 has the lever that reverses it without a deploy.

### 1.1 Who lands where on the first load after deploy

The office is resolved **once per session**, immediately after the auth gate opens, in this order — and every step is intersected with the set of offices the **server** listed for that specific employee:

```
1. an allowed ?world= override      (support, QA, and a Creator's private preview)
2. an allowed saved preference      (this employee's own explicit choice)
3. the company default              (guaranteed allowed; re-checked anyway)
4. the 3D office                    (available by construction — there is always somewhere to go)
```

| Employee | What they get | Notes |
|---|---|---|
| **New, or never opened the setting** | **The company default** — the 3D office on day one | They have no stored value at all. Nothing is written on their behalf: the only code that writes a preference is the Settings panel's own confirm button, so "never chose" stays "never chose" indefinitely |
| **Explicitly chose Classic** | **Classic** | Classic is permanently available and can never be unpublished, so this choice always survives step 2 |
| **Explicitly chose the 3D office** | **The 3D office** | Unaffected by this release either way |
| **Saved a season that is now unpublished** | **The company default** (the 3D office) | Their choice is **kept in storage on purpose**, not erased — it is filtered out at resolution, not at save. Settings tells them so in plain words: *"The Halloween Office you chose is not available right now, so this one opens until it is back."* If the season is republished later, they return to it with no action |
| **Anyone typing `?world=halloween`** without access | **The company default** | The URL names an office the server did not list for them, so it collapses exactly as if it had not been typed |

**Does changing the company default override a saved preference? No — never.**

The company default is step 3, and it is only reached when steps 1 and 2 produce nothing. An employee who explicitly picked an office keeps it; the default moves only the people who never chose. This distinction is load-bearing: the store deliberately keeps "never chose" and "chose the 3D office" as *different facts* precisely so that a Creator moving the company default to Classic does not drag along everybody who had actively chosen 3D.

Two consequences worth holding together:

- Employees with no preference **track** the company default on every subsequent load, not just the first. Move the default and they move with it, next load.
- A default change **never** reaches somebody already inside the office. The experience is resolved once and held for the session, so it lands on their next ordinary load — it changes no attendance, no presence and no work session.

---

## 2. What Bon has completed

| Area | State |
|---|---|
| V2 world build-out | Complete on `origin/main`'s unpushed local ancestors (38 commits) — rooms, lighting, weather, audio, perf passes |
| V1/V2 integration | Complete on this branch (31 commits) — identity, movement, seating, HUD, chat, DND, rooms, calls, attendance |
| Office Experience selector | Implemented, server-authoritative, tested |
| Creator Studio | Implemented and **verified end to end on the isolated local mock rig** — publish, unpublish, company default, permission enforcement |
| Halloween + Christmas offices | Built, captured, and verified rendering while unpublished |
| Status-line defect | Found during that verification and fixed in `605aebe`, with regression tests |
| Backend test suite | 1371 passed, 0 failed |
| Frontend test suite | 4788 passed, 2 failed — both the same deferred seating issue (§11) |
| Production build | `tsc -b && vite build` succeeds |
| Production | **Untouched.** Nothing applied, granted or deployed |

### What the local verification did and did not prove

It ran against `backend/dev_hub_playground.db` on `:8002` with the frontend mock rig on `:5174`, using the `x-dev-email` development bypass. It proved the *logic*: permission enforcement (403/401), publication lifecycle, the atomic default-reset on unpublishing the current default, and that unpublished seasons are unreachable through a direct URL, a hand-edited `localStorage` value, or an API write.

It did **not** exercise real Atlas bearer tokens, real Zoho time logs, Postgres, or the reverse-proxied `/virtual-office` path. Everything in §5–§8 exists because the mock rig cannot speak to those.

---

## 3. Database migrations

Four new revisions, in this order. The chain is linear and there is a **single head**.

```
b2c3d4e5f6a9  (already in the chain)
  └─ b7c8d9e0f1a2   add_employee_position_yaw
       └─ c9d0e1f2a3b4   add_message_kind_and_meta
            └─ d0e1f2a3b4c6   add_employee_permissions
                 └─ e1f2a3b4c5d7   add_office_experience_settings   ← head
```

All four are **purely additive**:

| Revision | What it does | Data risk on apply |
|---|---|---|
| `b7c8d9e0f1a2` | Adds nullable `employee_positions.yaw` | None |
| `c9d0e1f2a3b4` | Adds `messages.kind` (NOT NULL, `server_default='text'`), an index on it, and nullable `messages.meta` | None — the server default backfills existing rows without a table rewrite on modern Postgres |
| `d0e1f2a3b4c6` | Creates `employee_permissions` | None — new table |
| `e1f2a3b4c5d7` | Creates `office_experience_publications` and `company_settings` | None — new tables, **both empty on creation** |

No existing column is dropped, renamed or retyped. Nothing is backfilled from application data.

### `[VERIFY]` Production's actual current revision

Several revisions from earlier phases have been recorded in project notes as still pending on production. **Confirm where production actually is before anything else** — this is the first thing to check and it gates everything below.

```bash
# Against the production database, read-only:
alembic current
alembic heads     # expect: e1f2a3b4c5d7 (single head)
```

If `alembic current` is far behind, the deploy will apply a long run of earlier revisions in the same step. That is supported, but it is worth knowing in advance rather than watching it happen in a deploy log.

### Migrations are applied automatically by the deploy

`render.yaml` sets:

```
startCommand: alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

So you do **not** run migrations by hand on Render. Two consequences:

- **A failing migration means the service does not boot at all.** It is not a degraded API; it is a down API.
- The migration runs *before* the new backend serves traffic, which is the correct order for this release (see §6).

### `[VERIFY]` The database plan

`render.yaml` declares `plan: free` for `virtual-office-db`, with these comments in-file: free Render Postgres **expires 30 days after creation**, then a 14-day grace period, after which **Render deletes the database and all its data**; free Postgres has **no backups** and 1 GB of storage.

Before this release, confirm what plan the live database is actually on and when it was created. If it is still free and near expiry, that is a bigger problem than anything in this branch. **No-backups also directly limits the rollback options in §10** — there is no snapshot to restore to.

---

## 4. The production Creator grant

The intended Creator is **jerevon@offshorly.com** (Bon).

Nothing grants this automatically. There is no HTTP route anywhere in the app that writes permissions, no startup hook, and no email compared against a constant in any code path. The grant is one row, made deliberately, out of band, once.

```bash
cd backend
source .venv/bin/activate

# Look first — this writes nothing.
DATABASE_URL='<production database URL>' python -m app.scripts.grant_permission \
    --email jerevon@offshorly.com --list

# The grant. It prints the database it resolved and asks you to type the email back.
DATABASE_URL='<production database URL>' python -m app.scripts.grant_permission \
    --email jerevon@offshorly.com \
    --permission experience.creator \
    --granted-by <your email> \
    --note 'V1/V2 integration release, approved by Bon'
```

The script refuses to run without an explicit `DATABASE_URL` and will not fall back to `backend/.env`.

`[VERIFY]` **Confirm the email against the real Atlas identity before granting.** The repository lowercases and trims, but it does not reconcile spellings — a grant to an address Atlas does not issue tokens for produces a Creator Studio that never appears, with no error anywhere.

**Order matters:** the grant requires `d0e1f2a3b4c6` (which creates `employee_permissions`) to have been applied. Grant *after* the backend deploy, not before.

**To undo:** the same command with `--revoke`. The row and its audit trail stay; the capability stops applying on the Creator's next request.

The capability grants: seeing unpublished seasonal offices, publishing and unpublishing them, and setting the company default. It grants **no** Atlas privilege, no access to another employee's data, and no ability to grant any permission to anybody — including itself.

---

## 5. Environment and configuration

### `[VERIFY]` — the item most likely to bite

`DEPLOY.md` documents the frontend Static Site with **three** environment variables: `VITE_API_URL`, `VITE_CHAT_MODE`, `VITE_CHAT_SOCKET_URL`.

The V1/V2 integration depends on **four more**, and every one of them **silently defaults to `mock`** when unset:

| Variable | Default if unset | What happens in production if left unset |
|---|---|---|
| `VITE_ATTENDANCE_MODE` | `mock` | Check-in/out is **browser `localStorage` only**. It does not survive a refresh on another device, is not server-authoritative, and the V2 office's attendance gating becomes meaningless |
| `VITE_OFFICE_INTEGRATION_MODE` | `mock` | The office is populated from the **static bundled cast**, not from real Atlas employees |
| `VITE_ZOHO_INTEGRATION_MODE` | `mock` | Time logging shows **hardcoded sample projects**; nothing reaches Zoho |
| `VITE_TOUCAN_MODE` | `mock` | Toucan answers from canned replies instead of real office state |

These are Vite build-time variables. **They are inlined into the JS bundle at build time — there is no runtime env on a static site.** Getting one wrong is not an env flip to correct; it is a full rebuild and redeploy.

I cannot see the Render dashboard, so I do not know whether these are already set there. **Check all seven before building.** If they are set, nothing to do. If they are not, this is a release blocker (§11).

### The experience catalog's base URL

`GET /office/experience` is a **Virtual Office backend** route — the same FastAPI app as chat, hub, attendance and quests. It is **not** an Atlas route, so it is addressed from `VITE_CHAT_SOCKET_URL`, not `VITE_API_URL`.

`DEPLOY.md` records that value as `https://virtual-office-api-0hzd.onrender.com` and warns that the bare `virtual-office-api.onrender.com` hostname is claimed by an unrelated third party. `[VERIFY]` that the current service URL still matches.

If it is wrong, the failure is **silent**: the catalog read fails, the frontend degrades to "only the 3D and Classic offices", no saved preference is touched, and the Creator Studio simply never appears. If the Studio is missing after deploy, this is the first thing to check, ahead of the permission grant.

### Backend environment

`render.yaml` sets `APP_ENV=production` as a literal `value:`, which is what closes the `x-dev-email` development authentication bypass — the guard is a fail-closed allow-list matching the literal string `development`. `[VERIFY]` that the Render dashboard has not overridden `APP_ENV` to anything else. Nothing else in this release adds a backend environment variable or secret.

`CORS_ORIGINS`, `FRONTEND_URL` and `ATLAS_API_URL` are declared `sync: false` — dashboard-managed and invisible to me. `[VERIFY]` they are correct for the deployed frontend origin.

I verified that the production bundle contains **no Offshorly API keys or secrets**. It does contain a Google API key string, which belongs to the upstream `@excalidraw/excalidraw` package's own public Firebase config — it ships inside that dependency and is not ours. The bundle also contains real staff names, emails and departments as the static mock office cast; that is pre-existing, not introduced by this branch, and is noted in §11.

---

## 6. Deployment sequence

Migration first, backend second, frontend third, permission fourth. The order matters and each step has a reason.

1. **`[VERIFY]` Pre-flight.** Confirm `alembic current` on production, confirm the database plan (§3), confirm all seven frontend environment variables (§5), confirm the VO backend service URL.

2. **Merge and push.** `vo-v1-v2-integration` → `main` → `origin/main`. See §8 — this is a fast-forward, but it is 69 commits.

3. **Backend deploys.** Render runs `alembic upgrade head` and then boots uvicorn. Watch the deploy log for the migration step. **If the migration fails, the API does not come up** — do not proceed.
   - Confirm: `alembic current` now reports `e1f2a3b4c5d7`.

4. **Frontend Static Site rebuilds** with the environment variables from §5.
   - Until this step, employees keep getting the old bundle: the Classic office, unchanged. There is no broken intermediate state — the old bundle does not know the new endpoint exists.

5. **Grant the Creator permission** (§4). Requires step 3.

6. **Smoke test** (§7) before telling anyone the office has changed.

### Why this order has no bad window

Between steps 3 and 4, the new backend is serving an old frontend. The old bundle never calls `/office/experience`, so the new tables sit unread and nothing changes for anybody.

If steps 3 and 4 were reversed, the new frontend would call `/office/experience` against a backend whose tables do not exist and get **HTTP 500**. That is deliberate and is not softened into "nothing is published" — a forgotten migration must not be able to look healthy. Even then the frontend degrades safely to the two permanent offices and writes nothing, so the reversed order is *ugly, not dangerous*. Prefer the stated order anyway.

---

## 7. Post-deployment smoke tests

### Backend, before touching the UI

```bash
# As an ordinary employee — two offices, no preview, not a Creator.
curl -H "Authorization: Bearer <an ordinary employee's token>" https://<vo-api>/office/experience
# expect: {"available":["v2","classic"],"previewable":[],"default":"v2","creator":false, ...}

# As Bon, after the grant — same availability, creator true, both seasons previewable.
curl -H "Authorization: Bearer <Bon's token>" https://<vo-api>/office/experience
# expect: "previewable":["halloween","christmas"], "creator":true, "default":"v2"
#         publications: halloween + christmas, both "published":false, "implemented":true
```

`implemented: true` on both seasons is the difference from the Phase 9A handoff, and it is what makes the Publish buttons live.

### In the product

- [ ] An ordinary employee opens the office and lands in the **3D office**.
- [ ] Settings → General shows **two** cards (3D Office, Classic Office) and **no** Creator Studio.
- [ ] Classic Office is selectable, and switching to it reloads into the 2D office.
- [ ] `?world=v1` opens Classic for that tab without changing the saved preference.
- [ ] An ordinary employee hand-typing `?world=halloween` lands in the 3D office, not Halloween.
- [ ] Bon sees **four** cards, the two seasons marked "ONLY YOU", plus the Creator Studio.
- [ ] Bon can preview Halloween and Christmas, and return to the 3D office.
- [ ] **Do not publish either season as part of this release.**

### Attendance and Zoho — `[VERIFY]`, and this needs you specifically

These are the contracts the local mock rig could not exercise at all.

- [ ] Check in from the product, then **hard-refresh**. The session must survive. If it does not, `VITE_ATTENDANCE_MODE` was not `real` at build time.
- [ ] Check in in one browser; confirm the state is visible in a second browser as the same employee. `localStorage` cannot do this — passing proves server-authoritative attendance.
- [ ] Switching office experience (3D ↔ Classic ↔ a season) must **not** check the employee in or out. Verified locally on the mock rig; re-confirm once against the real attendance service, because the local check ran against mock Zoho.
- [ ] Open the checkout flow and confirm **real Zoho projects and tasks** appear, not the hardcoded sample list.
- [ ] Submit one real time log end to end and confirm it lands in Zoho. The browser never holds Zoho credentials — this goes through Atlas's OAuth connection, which is the part no local rig can stand in for.
- [ ] The 8-hour reminder fires against the real work session.

### Messaging, presence, DND and rooms — `[VERIFY]`

Needs two real accounts in two browsers:

- [ ] DMs and group messages deliver both ways over the deployed `wss://`.
- [ ] Presence and movement replicate between the two sessions.
- [ ] DND blocks an approach and a call as expected.
- [ ] A room entry request reaches the occupant and is honoured.
- [ ] One voice call connects (LiveKit), and a whiteboard opens and saves.

---

## 8. Branch and merge state

| Question | Answer |
|---|---|
| Does `origin/main` have anything this branch lacks? | **No.** `git rev-list --left-right --count origin/main...HEAD` → `0 69` |
| Does the branch have an upstream? | **No.** `vo-v1-v2-integration` has never been pushed |
| Would a merge need a rebase or conflict resolution? | **No.** `origin/main` is a direct ancestor — a fast-forward |
| Would a push need force or special handling? | **No force.** But the first push creates the remote branch, and the merge into `main` carries **69 commits** |
| Is local `main` clean? | Local `main` is **38 commits ahead of `origin/main`** and 0 behind. Those 38 are all ancestors of this branch, so they ship with it |
| Files that must be excluded | Two are deliberately uncommitted (§12). `.gitignore` covers `backend/.env`, `frontend/.env`, `frontend/.env.local` and `frontend/dist`. Tracked env files are `backend/.env.example`, `frontend/.env.example` and `frontend/.env.mock` — all non-secret by construction |

### A fast-forward is a Git fact, not a release verdict

"Fast-forward" means exactly one thing: `origin/main` is an ancestor of this branch, so Git can advance the ref without inventing a merge commit or asking anyone to resolve a conflict. It is a statement about **commit topology**. Nothing more.

It is specifically **not** evidence of any of the following, and it is worth saying so because a clean merge is the most reassuring-looking signal in this whole document:

| A fast-forward tells you | It tells you nothing about |
|---|---|
| No conflicting edits to reconcile | Whether the *combined behaviour* is correct — no one ever ran these 69 commits against production data |
| No history rewrite is needed | Whether production's schema is anywhere near the migration head (§3) |
| The push is mechanically safe | Whether the frontend was built with the right seven environment variables (§5) — that is decided at **build** time, long after the merge |
| Git can advance the ref | Whether Atlas, Zoho, LiveKit and the reverse proxy still hold up their end (§7, §10) |

The same applies to the test suites. 1371 backend tests and 4788 frontend tests passing means the code does what its authors asserted, against mocks and an SQLite fixture. Every integration this release actually depends on in production — Atlas bearer tokens, Zoho OAuth time logs, Postgres, `wss://` through the proxy, LiveKit — is stubbed in that run. **Green tests and a clean merge are necessary, not sufficient.**

Production readiness for this release is the checklist in §11, not the state of the ref. Treat §6 step 1 as the real gate.

Nothing about this is risky *mechanically*. The risk is scope: one push moves production from a 2D office to a 3D one.

---

## 9. Rollback

### The fast lever — no deploy, no migration, seconds

**The Creator sets the company default to Classic Office in Creator Studio.** Classic is a permanent office, always available, and can always be the default. Every employee who has never chosen for themselves goes back to the 2D office on their next ordinary load.

This is the intended emergency response to "the 3D office is a problem for people", and it needs no deploy, no database change and no engineer. It does **not** move an employee who explicitly chose the 3D office — their choice is theirs.

Individual employees also have `?world=v1`, which opens Classic for one tab without changing anything saved. That is also what the 3D office's own failure screen offers, so a bad load never traps anybody.

### Frontend rollback

Redeploy the previous Static Site build. Employees return to whatever that bundle served. Saved preferences in `localStorage` are untouched and inert to a bundle that does not read them.

### Backend rollback

Redeploy the previous backend image.

**`[VERIFY]` Do not downgrade the database as part of a routine rollback.** The migrations are additive, so an older backend runs fine against the newer schema — the extra columns and tables are simply unread. Leaving the schema forward is the safe rollback.

### Migration downgrade limitations — read before considering one

Downgrades exist for all four revisions, but they are **destructive and there is no backup to fall back on** (§3, free-tier Postgres has none):

- `c9d0e1f2a3b4` downgrade **drops `messages.kind` and `messages.meta`**. Any message written with a non-text kind while the new version was live is permanently lost, and every remaining message loses its metadata.
- `d0e1f2a3b4c6` downgrade **drops `employee_permissions`**, destroying the Creator grant and its audit trail.
- `e1f2a3b4c5d7` downgrade **drops `office_experience_publications` and `company_settings`**, destroying publication history and the company default.
- `b7c8d9e0f1a2` downgrade drops `employee_positions.yaw` (facing data; low value, but gone).

`[VERIFY]` If a downgrade ever looks necessary, take a manual database dump first. On the free plan there is no automatic snapshot to recover from.

---

## 10. Atlas / VO backend routing

Two separate services, and the release depends on both being wired correctly.

| Service | Purpose | Frontend variable |
|---|---|---|
| **Atlas** | Authentication (`/api/v1/auth/me`), the `can_view_virtual_office` permission flag, the real office roster, and Zoho time logging | `VITE_API_URL` |
| **VO backend** | Chat, presence, attendance, quests, whiteboards, Toucan, **and the office experience catalog** | `VITE_CHAT_SOCKET_URL` |

The frontend is a static bundle reverse-proxied by Atlas at `https://atlas.offshorly.com/virtual-office`. Per `DEPLOY.md`, API URLs must be **absolute** — a relative `/api/...` path resolves against Atlas's own origin under that proxy and returns Atlas's HTML 404 where JSON is expected.

`[VERIFY]` items here:

- The Atlas-side reverse proxy still serves the rebuilt bundle at `/virtual-office`.
- Atlas still enforces `can_view_virtual_office` **server-side on every office endpoint**. The frontend's boot gate is explicitly documented in-code as UX only, not access control, and provides zero security on its own.
- `VITE_CHAT_SOCKET_URL` is an `https://` base with **no trailing slash** (Socket.IO negotiates `wss://` from it).
- The VO backend's `CORS_ORIGINS` includes the deployed frontend origin.
- Render's free web-service tier spins the VO backend down after 15 minutes idle, with roughly a one-minute cold start. `[VERIFY]` whether that is still the plan, and whether it is acceptable for a real-time 3D office — a cold start delays presence, chat and the catalog read on the first visit of the morning.

---

## 11. Findings, classified

### Confirmed release blockers

**B1 — The four `mock`-defaulting frontend environment variables (§5).**
`VITE_ATTENDANCE_MODE`, `VITE_OFFICE_INTEGRATION_MODE`, `VITE_ZOHO_INTEGRATION_MODE` and `VITE_TOUCAN_MODE` are absent from `DEPLOY.md` and each silently defaults to `mock`. If any is unset at build time, that subsystem ships as sample data with no error anywhere. Attendance is the worst case: check-in becomes browser-local, which also hollows out the V2 office's attendance gating. Blocking **until verified in the Render dashboard** — if they are already set, this closes with no work.

**B2 — The default-office flip is a product decision, not a technical one.**
Every production employee moves from the 2D office to the 3D office on their next load. Technically sound and intentional (`d75d2f2`), with a no-deploy reversal available (§9). It blocks only in the sense that it should be an explicit, dated decision with someone ready to pull the lever — not a surprise.

**B3 — `[VERIFY]` Production's migration state and database plan (§3).**
Unknown to me, and it gates the deploy. If the database is still on the free plan near its 30-day expiry, resolve that before shipping anything. No backups also constrains §9.

### Requires Jan's production verification

- **J1** — The attendance and Zoho contracts (§7). No local rig can stand in for Atlas's Zoho OAuth connection.
- **J2** — Messaging, presence, DND, room access and calls between two real accounts over the deployed `wss://`.
- **J3** — The VO backend service URL and CORS origins (§5, §10).
- **J4** — `APP_ENV=production` is genuinely in force, closing the `x-dev-email` bypass (§5).
- **J5** — The Atlas reverse proxy serves the rebuilt bundle, and Atlas still enforces `can_view_virtual_office` server-side.
- **J6** — `jerevon@offshorly.com` is the exact identity Atlas issues tokens for, before the grant (§4).
- **J7** — Whether free-tier cold starts are acceptable for a real-time office (§10).

### Known non-blocking issues

- **N1** — Two frontend tests fail, both from **one** root cause: the Design Room side beanbag reports facing `left` where V1's seat table says `front`. Cosmetic seat orientation for one item of furniture. Bon has already decided seated-avatar facing is a single whole-office calibration pass, not per-room fixes. Backend is 1371/1371 green; frontend is 4788/4790.
- **N2** — The production bundle contains real staff names, emails and departments as the **static mock office cast**. Not credentials, not an auth bypass (the `x-dev-email` header code is compiled out of the production build, verified). Pre-existing, unrelated to this branch, and only reachable by someone who can already fetch the bundle. Worth a separate look, not a release gate.
- **N3** — `frontend/.env.example` documents `VITE_AVATAR_GENERATION_MODE`, which no source file reads any more. Documentation drift.
- **N4** — `DEPLOY.md` is now incomplete (see B1) and should gain the four missing variables regardless of how B1 resolves.
- **N5** — `docs/PHASE_9A_PRODUCTION_HANDOFF.md` is stale about the seasons being unbuilt. Superseded here; worth a note in that file.
- **N6** — The upstream `@excalidraw/excalidraw` package ships its own public Firebase config and OSS collab endpoints inside the bundle. Not ours; the whiteboard uses our own backend for realtime, not Excalidraw's collab server.

### Deferred cosmetic polish

- Seated-avatar facing calibration, whole-office pass (the root cause of N1).
- `docs/HALLOWEEN_POLISH_BACKLOG.md` and `docs/CHRISTMAS_POLISH_BACKLOG.md` — neither season is being published in this release, so neither backlog gates it.

---

## 12. Files deliberately left uncommitted

These two are modified in Bon's working tree and are **not** part of this release. They must not be staged, committed or pushed with it:

- `backend/.env.example` — adds a `WEATHER_TIMEOUT_SECONDS` line, unrelated work in progress.
- `frontend/scripts/avatar-pipeline/meshy-generate-employee-3d.mjs` — unrelated avatar-pipeline work in progress.

---

## 13. Seasonal offices — explicitly not part of this release

Both Halloween and White Christmas ship as **code** and stay **unpublished**.

No action is needed to keep them that way. `office_experience_publications` is created empty, and an absent row reads as unpublished — so on a fresh production database both seasons are unpublished by construction. Nothing in the app publishes anything automatically; the only writer is the Creator Studio, behind the `experience.creator` capability.

After deploy, publishing either season is **a button in the Studio** — no deploy, no migration, no code change. Unpublishing is the same button, and unpublishing a season that is currently the company default restores the 3D office **in the same database transaction**, so there is never a default nobody can open.

Please do not publish either season as part of this deployment.
