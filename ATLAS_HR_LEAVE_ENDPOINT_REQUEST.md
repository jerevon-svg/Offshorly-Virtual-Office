# Request: Employee-Scoped Zoho People Leave Endpoints for the Virtual Office HR Desk

Status: **proposal only — not yet requested from the Atlas team, not implemented anywhere.** Every
route below is a proposed name, not a claim that it exists.

The Virtual Office (VO) now has an HR Desk in the Executive Room that opens an HR Services panel:
Apply for Leave, My Leave Requests, Leave Balance. All three sections show "Integration pending"
today. VO holds no Zoho credentials and must not get any. Atlas already owns the Zoho OAuth
connection and resolves the caller through `GET /api/v1/auth/me`. This asks for five small,
**employee-scoped** routes on top of that, in the same `/api/v1/office/my-*` family as the shipped
`GET /api/v1/office/my-tasks` and `POST /api/v1/office/my-timelogs`.

## Why the existing leave routes can't be used

Atlas's public spec has `GET /people/leave/records`, `GET /sync/leave` and
`GET /sync/leave/summary`. All three are reporting routes: they return leave for every employee,
and `/sync/leave` accepts a caller-chosen `employee_ids`. VO will not call them from the browser,
and we don't assume they enforce employee-level authorization. They also don't cover balances,
applicable leave types or submission.

## Non-negotiable for every route

- **Auth:** the same Atlas bearer token as `/auth/me` (`Authorization: Bearer <token>`). Missing
  or invalid token → `401`.
- **Identity is server-side.** Atlas maps the authenticated user to their Zoho People employee
  record using its own identity mapping. No route accepts an employee id, email or Zoho id in the
  path, query or body. If one is sent anyway, ignore it or reject it with `400`; never honor it.
- **No mapping, no data.** A caller Atlas can't map to exactly one active Zoho People employee
  gets `403 {"code": "employee_not_mapped"}`, never someone else's data and never an empty success.
- **Zoho credentials never leave Atlas.** Responses carry no tokens, Zoho URLs with credentials,
  or internal Zoho ids beyond the leave-type and request ids defined below.

## Proposed endpoints

### 1. `GET /api/v1/office/my-leave/types`

The leave types the caller can apply for (their Zoho People applicable types, not the
organization's full list).

```json
{ "leaveTypes": [ { "id": "string", "name": "string", "unit": "day" | "hour",
                    "allowsHalfDay": true, "requiresReason": false } ] }
```

`allowsHalfDay` and `requiresReason` are only included if Zoho exposes them per type. Otherwise
leave them out (see open questions).

### 2. `GET /api/v1/office/my-leave/balance?year=YYYY`

`year` is optional and defaults to the current leave year in the employee's Zoho People timezone.

```json
{ "year": 2026, "asOf": "2026-10-22T09:00:00Z",
  "balances": [ { "leaveTypeId": "string", "leaveTypeName": "string", "unit": "day" | "hour",
                  "available": 0, "used": 0, "pending": 0 } ] }
```

`pending` is optional. Leave it out (don't send `0`) when Zoho doesn't report it, because VO
shows a missing value differently from zero.

### 3. `GET /api/v1/office/my-leave/requests?from=YYYY-MM-DD&to=YYYY-MM-DD&status=...&cursor=...`

The caller's own requests, newest first. Every parameter is optional; the default window is the
current leave year. `status` takes a comma list of the values below.

```json
{ "requests": [ { "id": "string", "leaveTypeId": "string", "leaveTypeName": "string",
                  "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "duration": 1.5,
                  "unit": "day" | "hour", "status": "pending",
                  "submittedAt": "ISO-8601", "decidedAt": "ISO-8601 | null", "reason": "string | null" } ],
  "nextCursor": "string | null" }
```

### 4. `GET /api/v1/office/my-leave/requests/{request_id}`

One of the caller's own requests, in the same shape as an item above, plus optional
`days: [{ "date": "YYYY-MM-DD", "amount": 0.5 }]` when it covers partial days. A request that
exists but belongs to someone else returns **`404`** (not `403`), so ids can't be probed.

### 5. `POST /api/v1/office/my-leave/requests`

Files a leave request in Zoho People for the caller.

Headers: `Idempotency-Key: <uuid>`, required. VO creates one per filled-in form and re-sends the
same key on retry.

```json
{ "leaveTypeId": "string", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD",
  "reason": "string (optional, ≤ 500 chars)",
  "days": [ { "date": "YYYY-MM-DD", "amount": 1 | 0.5 } ] }
```

Only include `days` if partial days are supported. Without it, every working day in the range counts
as a full day. Responses:

- `201` with the created request (shape of endpoint 4). Return it only after Zoho People has
  accepted the record. VO shows "Sent to Zoho People" only on this response.
- The same `Idempotency-Key` with the same body inside 24 h → the original `201` response, and no
  second Zoho record. The same key with a different body → `409 {"code": "idempotency_conflict"}`.

**Validation, run in Atlas before calling Zoho:**
- `leaveTypeId` is one of the caller's applicable types.
- `endDate ≥ startDate`, and both are valid calendar dates.
- The range overlaps none of the caller's own pending or approved requests.
- The balance is sufficient, where Zoho enforces that for this type.
- `reason` is present if the type requires it, and is ≤ 500 chars.

## Dates, durations and status

- All dates are **calendar dates** (`YYYY-MM-DD`), interpreted in the employee's Zoho People
  location timezone, never converted through UTC. Timestamps (`submittedAt`, `decidedAt`,
  `asOf`) are ISO-8601 with an offset.
- Status vocabulary is exactly `pending | approved | rejected | cancelled`. Map Zoho's own values
  onto these in Atlas. Anything unmappable → `pending`, logged in Atlas.
- Weekends and holidays inside a range follow Zoho People's own counting. Atlas reports
  `duration` as Zoho computed it; VO never computes it.

## Errors

Use one shape: `{ "code": "string", "message": "human readable" }`.

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_request` | malformed body or dates; an employee id was sent |
| 401 | `unauthenticated` | missing or invalid bearer |
| 403 | `employee_not_mapped` | caller has no unique Zoho People employee |
| 404 | `not_found` | request id unknown or not the caller's |
| 409 | `overlap`, `idempotency_conflict` | as above |
| 422 | `insufficient_balance`, `reason_required`, `type_not_applicable` | Zoho-side business rule |
| 429 | `rate_limited` | with `Retry-After` |
| 502 | `zoho_rejected` | Zoho returned an error; nothing was filed |
| 503 | `zoho_unavailable` | Zoho unreachable or the Zoho connection needs re-authorizing; nothing was filed |

VO retries reads at most once, after a delay, and never auto-retries a `POST` except with the
same `Idempotency-Key`.

## Authority

| Field | Source of truth |
|---|---|
| Leave types, units, balances, request status, durations | **Zoho People** (Atlas reads, never derives) |
| Employee ↔ Zoho People mapping | **Atlas** |
| Idempotency record, audit log | **Atlas** |
| Nothing | Virtual Office (VO stores no leave data) |

Reads can come from Atlas's synced copy (`/sync/*` data kept fresh by the existing leave webhook)
if it is fresh enough. If so, include `asOf` so VO can say how fresh the data is. Submission always
goes to Zoho People itself.

## Audit, rate limits, caching

- **Audit:** log every `POST` attempt in Atlas: who, when, type, dates, idempotency key, outcome,
  and the Zoho record id. Don't log reason text in plain application logs.
- **Rate limits:** Zoho People leave APIs have tight per-endpoint limits (the legacy leave-types
  endpoint documents 30 requests per 5 minutes). Cache types and balances per employee for a few
  minutes in Atlas and invalidate them on the leave webhook. Rate-limit `POST` per employee (for
  example 10 per minute).
- **Privacy:** these routes return only the caller's own data. Nobody's leave is visible to
  anyone else through VO.

## Zoho OAuth scopes (Zoho administrator to confirm)

From Zoho People's API documentation: `ZOHOPEOPLE.leave.READ` covers leave reads and the
booked-and-balance report. `ZOHOPEOPLE.leave.CREATE` is listed on leave-tracker write endpoints.
The documentation we found doesn't name the scope for adding a leave record (the forms
`insertRecord` call); it may be a `ZOHOPEOPLE.forms.*` scope. Please confirm against Atlas's
current grant before building endpoint 5.

## Open questions

**For the Atlas team**
1. Do the existing `/people/leave/*` and `/sync/leave*` routes enforce any per-employee
   authorization today? (VO won't use them either way.)
2. How does Atlas map an `/auth/me` user to a Zoho People employee id, and can a user be unmapped
   or map to more than one?
3. Will reads come from Zoho live or from Atlas's synced copy? How fresh is the copy?
4. Is the Zoho connection one shared organization connection or per user (`/auth/zoho/status` is
   "for current user")? If it's shared, submissions must still be filed as the caller.
5. Do the proposed paths and shapes fit your conventions? Rename freely; the identity rules are the
   only fixed part.

**For the Zoho People administrator**
6. Which leave scopes does Atlas's Zoho client currently hold? Can a create scope be granted?
7. Are partial-day (half or quarter) or hourly leave types configured for Offshorly?
8. Is a reason mandatory for any leave type?
9. Does approval go through Zoho People's own workflow (VO only reports the status), and should the
   approver be notified by Zoho as usual?

## What VO already has, waiting on this

- `frontend/src/services/hr/` — a typed `HrLeaveService` matching endpoints 1–3 and 5. Its only
  implementation reports every capability unavailable. There is no mock mode, so nothing fake can
  ship.
- The HR Services panel already handles loading, empty, error, idempotent retry and
  confirmed-only success. It goes live once an Atlas-backed implementation of that interface is
  added.
