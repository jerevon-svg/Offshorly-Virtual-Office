# Deploy — Render Static Site

Virtual Office is a Vite SPA, built to static files and reverse-proxied by
Atlas at `https://atlas.offshorly.com/virtual-office`. Deploy target is a
Render **Static Site** (not a Web Service) — the build output is static, so
a Static Site gives always-on CDN serving with no cold starts.

## Render service settings

| Setting            | Value                                                    |
|---------------------|----------------------------------------------------------|
| Service type         | Static Site                                              |
| Root Directory       | `app` (repo root has no `package.json` — omitting this breaks the build) |
| Build Command        | `npm ci && npm run build`                                 |
| Publish Directory     | `dist`                                                     |
| Region               | same region as Atlas                                       |
| Env var              | `VITE_API_URL=https://atlas-api.offshorly.com`             |

`VITE_API_URL` is inlined into the JS bundle at build time — there is no
runtime env on a static bundle. Changing it requires a rebuild + redeploy on
Render, not just an env var flip.

**Failure mode if `VITE_API_URL` is unset at build time:** the build still
succeeds — Vite just inlines `undefined` where the value should be.
`resolveApiBase()` then throws at runtime, inside `apiFetch`, the first time
the app tries to call the API. `useAuthGate` catches that as a non-
`AuthRedirectError`, sets status `"denied"`, and redirects to `/`. So a
missing env var does NOT fail the build or show an obvious error — it
presents as the app silently bouncing to home, with the real cause visible
only in the browser console. If you see an unexplained redirect to `/`,
check this env var first.

### Why `dist` (not `app/dist`) as Publish Directory

Render's Root Directory is already `app`, so the Publish Directory path is
relative to that — `dist`, not `app/dist`. `vite.config.ts` sets
`build.outDir: "dist/virtual-office"` (see comment there), so the real
build output Render finds under `dist` is `dist/virtual-office/`, containing
`index.html` and `assets/`.

### The one assumption this whole layout depends on

**Atlas's proxy preserves the `/virtual-office` prefix** — it does not
strip it. Their documented rewrite is:

```
/virtual-office/:path*  ->  ${VIRTUAL_OFFICE_URL}/virtual-office/:path*
```

That's why this app must genuinely serve itself under `/virtual-office/`
(via the nested `outDir` above) rather than at the service root. If Atlas
ever changes their proxy to strip the prefix before forwarding, this whole
build layout — and the rewrite rule below — breaks and must be redone.

## Rewrite rule (SPA fallback)

Required so hard-refreshing a deep path under `/virtual-office/*` doesn't
404 — there is no router in this app, but the host still needs a fallback
rule for direct navigation/refresh to resolve to the built `index.html`.

```
Source:      /virtual-office/*
Destination: /virtual-office/index.html
Action:      Rewrite
```

(Render's dashboard: Redirects/Rewrites tab on the static site.)

**This destination is only correct because `index.html` is emitted inside
`dist/virtual-office/`** (see outDir note above). It only became valid once
outDir was nested — do NOT "simplify" this back to `/index.html`; that path
does not exist in the publish directory and will 404.

## Verify after deploy

In the browser Network tab, confirm:

```
<host>/virtual-office/assets/index-*.js  ->  200, JS MIME type (application/javascript)
```

If it 404s or returns HTML, the outDir/publish-dir layout has drifted from
this doc — see the outDir note above.

Note: the office UI itself will **not** render standalone at
`https://<service>.onrender.com/virtual-office` before the Atlas cutover —
there's no Atlas auth token on the onrender origin, and the `/api/v1/auth/me`
call is cross-origin, so `useAuthGate` will deny and bounce to `/`. That is
expected at this stage, not a failure. The only thing to verify pre-cutover
is that the JS/CSS assets themselves load with a 200 and correct MIME type.

## Handoff to Atlas

Once deployed, hand Atlas the resulting `https://<service>.onrender.com`
URL. They set it as `VIRTUAL_OFFICE_URL` on their reverse proxy config.
Clearing that var on Atlas's side rolls back the cutover (Atlas stops
proxying to this app).
