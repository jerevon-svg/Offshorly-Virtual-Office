# Request: Atlas Endpoints for Zoho Employee Data (Read-Only)

Bon builds and runs the standalone Virtual Office frontend (`app/`), a Vite/React
SPA with no backend of its own — Atlas (`https://atlas-api.offshorly.com`) is
the only real backend it talks to. The frontend today has a mocked Zoho
time-logging integration (`app/src/services/zoho/`) and needs real Zoho-backed
**employee profile** and **resourcing** data for two reasons: (1) to replace
mock data with a real end-to-end data flow for testing, and (2) to seed the
existing avatar-generation pipeline with a real employee's name/photo instead
of a manually uploaded one. Atlas's production `.env` already holds registered
Zoho OAuth credentials (client id/secret, redirect, scopes, datacenter domain)
and already handles this frontend's auth (`GET /api/v1/auth/me`). This is a
request to add one or two small read-only endpoints on top of what's already
there — not a new integration from scratch.

## Requested endpoints

### 1. `GET /api/v1/virtual-office/zoho/profile`

Returns the calling employee's profile from Zoho People: name, description/bio,
job title, department, and photo URL. Rough response shape (field names
negotiable — use whatever's natural given your existing Zoho People client):

```json
{
  "employeeId": "string",
  "name": "string",
  "jobTitle": "string",
  "department": "string",
  "description": "string",
  "photoUrl": "string"
}
```

### 2. `GET /api/v1/virtual-office/zoho/resourcing`

Returns the calling employee's current project/resourcing assignments —
intended to be a superset of what the frontend already models for time
logging (`ZohoProject { id, name }`, `ZohoTask { id, projectId, name }`, see
`app/src/services/zoho/types.ts`). Rough shape:

```json
{
  "employeeId": "string",
  "assignments": [
    {
      "projectId": "string",
      "projectName": "string",
      "taskId": "string | null",
      "taskName": "string | null",
      "allocationPercent": "number | null"
    }
  ]
}
```

**Unconfirmed:** which Zoho product actually holds resourcing data for your
org (Zoho Projects vs. Zoho People vs. something else) — see open questions
below. If it turns out resourcing isn't cleanly available, endpoint 1 alone
still unblocks the profile/avatar use case.

## Auth requirement (non-negotiable)

Both endpoints must:

- Require the same Atlas bearer token already used for `/api/v1/auth/me`
  (`Authorization: Bearer <token>`).
- Derive **which employee** to return data for **server-side**, from the
  caller's authenticated session (the same identity `/auth/me` resolves) —
  never from a client-supplied employee id in the URL, query string, or body.

A client-supplied id would let any authenticated user request any other
employee's Zoho profile/resourcing data by changing a parameter. Given
`/auth/me` already establishes "who is calling," these new endpoints should
follow the exact same pattern and just answer "give me *my* data."

## Why not a separate Zoho proxy service

Considered and rejected: Bon standing up his own backend service to call Zoho
directly would mean duplicating the Zoho OAuth credential handling Atlas
already has, plus reinventing an auth-verification layer to know who's asking.
That's a new internet-facing, secrets-holding service for no real benefit —
Atlas already has both the Zoho credentials and the auth layer, so adding the
endpoint(s) there is strictly less work and less exposure than the
alternative.

## Open questions for Atlas to confirm

- Which Zoho product "resourcing" data actually lives in for this org
  (Projects vs. People vs. something else) — determines whether endpoint 2 is
  feasible as scoped above.
- Does `photoUrl` need to be a signed/expiring URL, or can it be a plain
  publicly-fetchable URL? Affects how the frontend/avatar pipeline consumes it.
- Any rate-limit or caching expectations on these endpoints (e.g. is Zoho
  People/Projects API quota shared across all of Atlas, and should the
  frontend expect to poll rarely / cache client-side)?
- Exact field names/shapes above are a starting proposal, not a contract —
  adjust to whatever's natural given your existing Zoho client code.
