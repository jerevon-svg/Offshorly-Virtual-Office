# Running the Virtual Office locally

This app has **no backend of its own**. It is a Vite SPA that Atlas
reverse-proxies at `/virtual-office` and whose data all comes from Atlas's
API. So running it locally means running **three** processes, and browsing
Atlas — not this app directly.

## 0. Before you start — two things to request

**Your Atlas account needs the `can_view_virtual_office` permission**
(super-user only). Without it the office loads and immediately bounces you
to `/`. This is enforced server-side on every office endpoint, so there is
no way around it locally. Ask for it first — it is the most common reason
"nothing works".

**You need the `.env` files**, which are gitignored and contain secrets
(database URL, Zoho client secret, API keys). Get them from the team
through a password manager or 1Password — **never over chat or email**.
`.env.example` in each repo lists the variable names, not the values.

## 1. Prerequisites

| | |
|---|---|
| **Node** | **22 or newer.** Not optional — `jsdom@30` pulls `undici@8`, which needs Node ≥22. On Node 20 every test file dies at startup with `webidl.util.markAsUncloneable is not a function`. Developed on 24.19.0. |
| Python | Whatever Atlas's `backend/.venv` was built with. Use `.venv`, **not** `venv` — the latter is a broken leftover. |
| Repos | `Offshorlyreporting` (Atlas) and `Offshorly-Virtual-Office` (this one), checked out side by side. |

## 2. Environment files

Three files, in two repos. All gitignored.

**Atlas → `backend/.env`** — from the team. The only line relevant to this
app is CORS, and only if you want to run this app standalone (see §5):

```
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173
```

**Atlas → `frontend/.env.local`**

```
VIRTUAL_OFFICE_URL=http://localhost:5173
```

Without this, `/virtual-office` silently serves Atlas's own in-repo
`/office` route instead of this app. It does not error — you just end up
looking at a different office and wondering why your changes do nothing.

**This repo → `app/.env.local`**

```
VITE_API_URL=http://localhost:8000
VITE_OFFICE_INTEGRATION_MODE=real
VITE_ZOHO_INTEGRATION_MODE=mock
VITE_AVATAR_GENERATION_MODE=mock
# VITE_AUTH_GATE=off   <- leave COMMENTED OUT, see below
```

- `VITE_OFFICE_INTEGRATION_MODE` defaults to `mock`, which renders a
  fictional cast (Bon, Arisha, Alex) and looks completely healthy. Set it
  to `real` or you will be developing against made-up people.
- `VITE_ZOHO_INTEGRATION_MODE=real` turns on the end-of-day checkout flow,
  which writes **real time entries into Zoho Projects**. Leave it `mock`
  unless you are specifically working on time-logging.
- **`VITE_AUTH_GATE=off` must stay commented out.** It short-circuits the
  permission gate *without ever calling `/api/v1/auth/me`* — and that call
  is the only thing that tells the app who you are. With it on you are
  never recognised, never seated at your own desk, and never excluded from
  the drawn roster. It exists only for standalone dev (§5).

## 3. Run it — three processes

| Process | Where | Command | Port |
|---|---|---|---|
| Atlas backend | `Offshorlyreporting/backend` | your usual backend run command | 8000 |
| Atlas frontend | `Offshorlyreporting/frontend` | `npm run dev` | 3000 |
| Virtual Office | `Offshorly-Virtual-Office/app` | `npm run dev` | 5173 |

Then:

1. Go to **`http://localhost:3000`** and log in with Zoho SSO **first**.
   The token lives in `localStorage` on origin `:3000`; this app reads it
   from there. No login, no office.
2. Go to **`http://localhost:3000/virtual-office/`**.

**Do not browse `localhost:5173` directly.** That origin has no Atlas
token, so the app redirects to `/login`, which does not exist on the Vite
dev server, and you land on a "did you mean /virtual-office/?" page.

## 4. The single most repeated mistake

**Anything read at server startup needs a full restart** — `next.config.ts`,
`vite.config.ts`, and every `.env*` file. Hot reload does not touch them.

The symptom is never an error. The app behaves like an older version of
itself: a missing `VIRTUAL_OFFICE_URL` serves the wrong office, a stale
`rewrites()` lands you on Vite's hint page, an unset
`VITE_OFFICE_INTEGRATION_MODE` shows fictional people. All three look like
working software. This cost several debugging sessions during the rollout.

Change one of those files → restart the process that reads it.

## 5. Standalone dev (optional)

To work on visuals without running Atlas, uncomment `VITE_AUTH_GATE=off`
and browse `http://localhost:5173/virtual-office/` directly. You get the
canvas with no Atlas session — which also means no identity, no real
roster, and no live presence. Fine for art and animation, useless for
anything touching data. Re-comment it before testing anything real.

## 6. Checking it works

A dev-only panel sits bottom-right showing roster state:

```
roster
people: 65
floor: 65 · presence: 41
stream: live
merges: 7 (last 10:52:14)
you: dev-team · ONLINE
```

- `people: 0` with `floor: 0` → the roster failed to load; check the
  Network tab for `/api/v1/office/floor`.
- `stream: not live` → the SSE connection dropped; the office is still
  rendered but frozen.
- `you: not in roster` → identity did not resolve; check that
  `VITE_AUTH_GATE` is commented out.
- Everyone piled into `reception-room` → a Zoho department name stopped
  matching; see `src/data/roomIdentity.ts`.

The panel is behind `import.meta.env.DEV`, so it never ships to production.

## 7. Useful commands

```bash
cd app
npm run dev      # dev server on 5173
npm run test     # vitest — 289 tests, needs Node 22+
npm run lint     # oxlint
npm run build    # tsc -b && vite build
```

Two lint warnings are pre-existing and expected (`ConversationView.tsx`,
`generate-production.mjs`).

## 8. Further reading

- `DEPLOY.md` — Render static-site deployment
- Atlas repo `docs/VIRTUAL_OFFICE_PROXY_SPEC.md` — the proxy contract
- Atlas repo `docs/VIRTUAL_OFFICE_ROLLOUT_PLAN.md` — how this was built,
  and the decisions still open
- Atlas repo `docs/OFFICE_TIMELOG_IMPLEMENTATION.md` — the time-logging
  backend contract
