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

## Handoff to Atlas

Once deployed, hand Atlas the resulting `https://<service>.onrender.com`
URL. They set it as `VIRTUAL_OFFICE_URL` on their reverse proxy config.
Clearing that var on Atlas's side rolls back the cutover (Atlas stops
proxying to this app).
