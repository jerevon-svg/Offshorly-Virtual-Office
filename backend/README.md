# backend

No backend service is deployed today.

The only server-side code that exists in this repo is
`frontend/scripts/avatar-pipeline/gen-server.mjs` and `review-server.mjs` —
local dev-only Node scripts that hold the OpenAI API key for the avatar
sprite generation pipeline, reached through the Vite dev proxy. They
intentionally remain under `frontend/` as dev tooling, not here.

This folder is reserved for a future real backend service — e.g. if/when
auth, avatars, rooms, or other data move off the external Atlas API onto
infrastructure we own.
