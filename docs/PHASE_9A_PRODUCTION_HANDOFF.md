# Phase 9A — Office Experience foundation: production handoff

**For:** Jan, reviewing and applying the production change.
**Status:** implemented and tested on `vo-v1-v2-integration`. **Nothing has been applied to production.** No migration was run, no permission was granted, nothing was deployed.

Phase 9A ships the *foundation only*: the server decides which offices an employee may open, an authorised Creator can publish seasonal offices and set the company default, and the gallery reflects that. **There is no Halloween or Christmas office yet** — no decoration, no assets, no screenshots — and the backend refuses to publish one until its decoration layer ships. Applying this changes nothing an employee sees.

---

## 1. What changes for people

| Who | Before | After |
|---|---|---|
| Every employee | Opens the 3D office, or Classic if they chose it | **Unchanged.** Same two offices, same saved choice |
| The Creator | — | Gains a Creator Studio section in Settings → General. With nothing publishable yet, it lists both seasons as "Not built yet" and lets the company default be moved between 3D and Classic |

One behavioural change worth knowing: the office now waits for one extra API call during boot (`GET /office/experience`). It is behind the existing branded loading cover, it is on the path that already waits for `/auth/me`, and **it cannot fail into a locked-out state** — any failure resolves to the two permanent offices with nobody's saved preference touched.

---

## 2. Migration

**One new revision: `e1f2a3b4c5d7` — `add_office_experience_settings`.**

- `down_revision = d0e1f2a3b4c6` (`add_employee_permissions`), which is the current single head in the repository.
- Creates two tables, **both empty on creation**: `office_experience_publications` and `company_settings`.
- Purely additive. No existing table, column, index or row is touched.

### Dependency order — please check this first

The repository head is `e1f2a3b4c5d7` once this lands. Several earlier revisions have been recorded as still pending on production across previous phases. **Please confirm production's actual current revision before applying anything**, then bring it up in order:

```bash
alembic current          # what production is actually on
alembic heads            # should be e1f2a3b4c5d7 alone
alembic upgrade head
```

`e1f2a3b4c5d7` cannot be applied on its own if production is behind `d0e1f2a3b4c6` — that revision creates the `employee_permissions` table the Creator capability is stored in.

### Deploy order: migration before frontend

Every route in the new router reads the two new tables. **Before the migration is applied, `GET /office/experience` answers HTTP 500.** That is deliberate and is not softened into "nothing is published" — a forgotten migration must not be able to look healthy.

Nothing breaks in the meantime. The frontend treats a failed catalog read as "only the 3D and Classic offices", writes nothing, and leaves every saved preference alone. A pre-migration backend is therefore an invisible degradation, not an outage. Applying the migration first removes even that window.

---

## 3. How the company default is initialised

**It is not.** There is no seed row and no data migration.

`company_settings` starts empty, and an absent `office_experience.default` row reads as the 3D office — the same answer the product gives today. The first write happens only when the Creator sets a default in the Studio.

Three further safety properties, all in `app/repositories/office_experience.py`:

- A stored default naming an office that is not currently available reads as the 3D office.
- A stored default naming an identifier the build does not recognise reads as the 3D office.
- Unpublishing the office that is currently the default restores the 3D office **in the same transaction** — one commit, or neither change.

---

## 4. The one-time permission grant

The intended Creator is **jerevon@offshorly.com**.

Nothing grants this automatically. There is no HTTP route that writes permissions anywhere in the app, no startup hook, and no email comparison in any code path — the grant is a row, and it is made deliberately, out of band, exactly once. Please make it against the **verified production employee identity**; the email below is the intended account, and it should be confirmed against Atlas before the grant rather than assumed.

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
    --note 'Phase 9A, approved by Bon'
```

The script refuses to run without an explicit `DATABASE_URL` — it will not fall back to `backend/.env` — and confirms interactively before writing. `--yes` skips the prompt and should not be needed here.

**To undo it:** the same command with `--revoke`. The row and its audit trail stay; the capability stops applying immediately, on the Creator's next request.

### What the capability does and does not grant

- **Does:** see unpublished seasonal offices that have shipped a decoration layer, publish and unpublish them, set and restore the company default.
- **Does not:** any Atlas management or admin privilege; access to another employee's data; the ability to grant or revoke any permission, including this one. A Creator cannot make a second Creator, or re-grant themselves anything, from the product.

---

## 5. Deployment prerequisites

1. Production database is at `d0e1f2a3b4c6` or later, then upgraded to `e1f2a3b4c5d7`.
2. Backend deployed (new router mounted at `/office/experience`).
3. Frontend deployed. It is a static bundle, so the seasonal code and the Creator Studio ship at build time — which is the point: *publishing* afterwards needs no further deploy.
4. The permission granted, per §4.

**`VITE_CHAT_SOCKET_URL` must be set in the frontend build.** `/office/experience` is a **Virtual Office backend** route, in the same FastAPI app as chat, hub, attendance and quests — it is **not** an Atlas route, so it is addressed from `VITE_CHAT_SOCKET_URL` (per DEPLOY.md, `https://virtual-office-api-0hzd.onrender.com`), not from `VITE_API_URL`. That variable is already required and already set for chat, so this adds no new configuration; it is recorded here because getting it wrong fails *silently*. An unset or wrong value degrades to "only the 3D and Classic offices" with no error anywhere — the Creator Studio simply never appears. If it is missing after deploy, that is the first thing to check.

No new environment variable, no new secret, no config change. `REWARD_APPROVER_EMAILS` is untouched and unrelated.

### After deployment, without another deploy

The Creator can, entirely self-service: set the company default between the available offices, restore the 3D office as default, and — once a season's decoration layer has shipped — preview it privately, publish it, and unpublish it.

---

## 6. How a seasonal office becomes publishable later

Two changes, both in code, both in one deploy:

1. **Backend:** add the identifier to `IMPLEMENTED_EXPERIENCES` in `app/models/office_experience.py`.
2. **Frontend:** add the season's entry (label, hint, and a genuine screenshot of the decorated office) to `SEASONAL_PRESENTATION` in `components/OfficeMap/officeExperienceGallery.ts`, alongside its decoration layer.

**No migration, no new table, no new endpoint, no schema change.** The publication row and the default setting already exist and already mean what they will mean then. After that deploy, publishing is a button in the Studio.

Until both halves are done, the season cannot be published (the server refuses, with a message the Studio shows), cannot be previewed, and produces no card in the gallery.

---

## 7. What to check after applying

```bash
# As an ordinary employee — two offices, no preview, no Creator.
curl -H "Authorization: Bearer <token>" https://<api>/office/experience
# {"available":["v2","classic"],"previewable":[],"default":"v2","creator":false,...}

# As the Creator — same availability, creator true.
# {"available":["v2","classic"],"previewable":[],"default":"v2","creator":true,
#  "publications":[{"experience":"halloween","published":false,"implemented":false,...},
#                  {"experience":"christmas","published":false,"implemented":false,...}]}
```

Then, in the product: Settings → General shows the unchanged two-card gallery for everyone, and the Creator Studio section only for the Creator.

If the endpoint answers but the Studio does not appear, the cause is almost always one of two things: the permission was granted to a different spelling of the email (the repository lowercases and trims, so check the row), or the frontend build has no `VITE_CHAT_SOCKET_URL`.
