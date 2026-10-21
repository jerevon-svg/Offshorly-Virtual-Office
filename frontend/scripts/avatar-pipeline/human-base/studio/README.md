# HumanBase Studio

A local page that turns an approved Offshorly illustration into a complete, animated HumanBase avatar. It needs no coding.

## Start it

From `frontend/`, start two things:

1. The app dev server, if it isn't already running: `npm run dev` (serves the previews on http://localhost:5173).
2. The studio: `node scripts/avatar-pipeline/human-base/studio/server.mjs`, then open **http://localhost:8094**.

## The six steps (one card each on the page)

| Step | What happens | Cost |
|---|---|---|
| 1 Reference | Pick a person, or upload a new approved illustration (name + hair length). | free |
| 2 Identity analysis | Stage 0 traces the face outline, eyes, nose and mouth. Hair is never treated as skin. The trace turns into the person's Offshorly targets. | free (new uploads download the free face-landmark model once) |
| 3 Meshy head | Reuses the person's existing Meshy head. A **new** head costs about 30 Meshy credits, and the page asks for your approval before anything is sent. | 0 or ≈30 credits |
| 4 Build | The production-five path: applies the Offshorly style (chibify: canonical skull, eyes/lids, hair layers) with no identity warp, then hair, accessories, optimisation and the fail-closed gate with automatic repairs. (Identity correction is an opt-in experiment: `build-employees --correct`.) |
| 5 Preview | The avatar on the production HumanBase body next to Bon. Choose idle, walk, run or sit. "Make review sheet" makes one image: reference → trace → raw Meshy → chibified head → full avatar. | free |
| 6 Export | Packages the gated head, gate report, validated head mount, trace and review sheet into `scripts/avatar-pipeline/output/human-base/exports/<name>/`. | free |

## Good to know

- **Production is never touched.** The approved first five are frozen and are never rebuilt here. Promotion into `production/` stays the separate, human-approved `build-employees.mjs --promote` step, after visual sign-off.
- **"Gate FAIL" with no failed classes** means the automated checks passed. The three visual sign-off classes (ear boundary, hair spikes, nape) still need your look before promotion.
- **Jobs survive closing the page.** If the studio server restarts during a step, that step shows "interrupted"; run it again.
- **Resuming a Meshy generation.** If the job was interrupted after submission, the task id is in its log. Resume read-only (no new credits) with `node scripts/avatar-pipeline/human-base/studio/meshy-resume.mjs <name> <taskId>`.
- **Recipes.** Each person's appearance recipe (hair length, accessories, triangle budget) lives in `scripts/avatar-pipeline/human-base/employees.json`. Uploads get a default recipe there.

## Raw photo → avatar: the connected pipeline (2026-10-13)

Upload a **raw photo** (upload form → "raw photo"), then press **Run all** on the person's "0 · Upload → avatar pipeline" card. The
planner (`orchestrator.mjs`) runs every stage in order from what is on disk and stops on its own:

`photo → illustration (PAID) → identity (Stage 0) → illustration QA (Stage 0 input gate, fail closed) → Meshy head (PAID) → build
(Offshorly style → shared body / rig → optimise → fail-closed gate with automatic repairs, static + idle/walk)
→ review sheet → export`

- **Paid stages never run on their own.** The run stops at `awaiting-approval:<stage>`; "Approve … & continue" runs that one stage
  (the illustration = the production-five Stage A recipe: a FLAT house-style headshot from one gpt-image-1 images/edits call with the approved sprites as style references — illustration QA refuses a soft-3D render, which Meshy turns into an off-family anime head; the head ≈ 30
  Meshy credits). The illustration reads `OPENAI_API_KEY` from `frontend/.env` (gen-server's key location), else `backend/.env`.
- **SIMULATED test runs.** "Run with SIMULATED paid steps" lets a named fixture person's illustration and Meshy head stand in for the
  paid generations. Every simulated stage is recorded in `provenance/<who>.json`, shown on the card, and makes the person **never
  signable or promotable** (`approve.mjs` / `--promote` refuse). A head linked from another person's folder counts as simulated even
  without a record.
- **Association, resume, retry.** A stage is done only when its artifact was made from the current inputs (hashes / times): a new
  photo redoes everything after it; running the pipeline again resumes at the first stage that is not done; a server restart marks a
  running pipeline `interrupted` (run again to resume). Failures stop the run as `failed:<stage>` / `blocked:<stage>` with the reason.
- **The end state** is `complete` with the three visual sign-offs still required — promotion stays a human step.

## The Virtual Office side (dev-only, `VITE_CHARACTER_STUDIO=1`)

- **`/api/self/*`** — the VO Character Studio (Profile → CREATE / EDIT) acts only on the person VO's own backend says the session
  belongs to (`self-auth.mjs`: `GET <VITE_API_URL>/api/v1/auth/me`, owner ledger `owners.json`). It can upload that person's photo,
  start their pipeline and read their status; it never approves a paid stage and refuses anyone who already has an approved character.
  Local testing without an Atlas account: start this server with `HB_STUDIO_DEV_USER=<email>` (server-side, loud warning).
- **`/api/runtime/avatars`** — approved, **unpromoted** heads the office may draw at runtime (`runtime-avatars.mjs`): exactly the
  checks `promoteCandidate` makes (not frozen / promoted, no simulated stage, automated pass, every sign-off bound to this artifact +
  pipeline + mount, mount binding verifies, file hash unchanged) — and nothing is copied or written. Signing a head off with
  `approve.mjs` is what makes it appear in the office on the next load; promotion stays a separate human step.
- **Outfits** are not stored here: Character Studio EDIT saves them to the VO backend (`/avatar/wardrobe/me`, table `avatar_wardrobes`).

## Real runs: consent, the spend gate and preflight (2026-10-13)

- **Consent is per photo.** A raw photo needs it: the employee ticks "This is a photo of me…" in VO CREATE (recorded with the
  VO backend against the photo's SHA-256, then sent with the upload), or an admin uploading here enters the person's **VO email**
  and **their own name confirming consent**. The id comes from that email by the app's own rule (so the office, the self API and
  the ledger agree), and the owner ledger refuses an id that already belongs to another account.
- **Every paid stage passes the spend gate** (`spend-authority.mjs`): one paid job at a time per person + stage, never pay twice
  for the same input, ONE paid attempt per input (a reroll needs a named approver and an explicit reroll confirmation), Meshy never
  below the reserve (`HB_MESHY_RESERVE`, default 100), and every approval names its approver. Each attempt is in `spend-ledger.json`.
- **The VO backend authority** (`/avatar/generation/*`) adds eligibility, consent on record, per-employee monthly limits, the
  company budget and the spending ledger. Enable it with `AVATAR_EXECUTOR_KEY=<secret>` in the backend's environment and
  `HB_SPEND_AUTHORITY_URL=<backend url>` for this server (the key is read from `backend/.env` or `HB_EXECUTOR_KEY`, never
  printed). Configured but unreachable = no paid step starts. **Auto-spend is off** (`AVATAR_AUTOSPEND_ENABLED=false`) until it
  is deliberately switched on; then a paid stage nobody approved runs only if every policy check passes.
- **Preflight before a real run:** `node scripts/avatar-pipeline/human-base/studio/preflight.mjs <who>` (or the card's
  "Preflight" button): photo, consent for that exact photo, identity, no existing character, nothing simulated or borrowed, keys,
  Meshy balance, disk, spend rules, and the authority's dry-run verdict. Read-only.
- **A failure is evidence, not a retry:** a failed job keeps its exit code, log tail and (for a build) the gate's failed classes;
  the card shows "Stopped: …" with the evidence. A head that was not made from the current illustration is never reused for a photo
  run, and an existing paid head is never overwritten (a new head for the same person needs a new version folder — not automated).
