# Request: Atlas endpoint to verify a Zoho work-log submission (read-only)

Status: **specification only — not yet requested from the Atlas team, not yet implemented on
either side.** Written during Phase 7F Step 2 (Executive Access Pass, permission foundation).

## Why this is needed

The Virtual Office treats "you submitted your Zoho work log" as a precondition for ending a work
session. **That precondition is not enforced anywhere on a server.** It is client-side sequencing
only:

* `frontend/src/data/checkoutState.ts` — the only edge into `CHECKOUT_SUCCESS` is
  `SUBMITTING → CHECKOUT_SUCCESS`.
* `frontend/src/components/OfficeMap/useCheckoutFlow.ts` — `submit()` reaches that state only on a
  successful `zohoService.submitTimeLogs`.
* `backend/app/routers/attendance.py` — `POST /attendance/check-out` takes no body, references no
  time log, and verifies nothing. Any authenticated caller can already end their session with no
  work log by calling it directly.

So the Executive Access Pass currently waives a rule this backend does not enforce. Before the
waiver means anything, the rule has to exist, and that needs one fact this backend cannot obtain:
**whether a Zoho work log exists for a given employee on a given work date.** Atlas owns the Zoho
OAuth connection and writes the entries (`POST /api/v1/office/my-timelogs`, consumed by
`frontend/src/services/zoho/AtlasZohoService.ts`); this backend has no Zoho credentials and must
never hold any.

## The contract we need

### `GET /api/v1/office/timelog-status?work_date=YYYY-MM-DD`

Authorization: the **caller's own** bearer token, forwarded verbatim — the same pattern
`backend/app/services/toucan/roster.py` already uses for the roster. No service account, no
second credential, and the answer must be about the token's own employee only.

Response `200`:

```json
{
  "employee_email": "string",
  "work_date": "YYYY-MM-DD",
  "submitted": true,
  "submission_id": "string | null",
  "submitted_at": "ISO-8601 UTC | null",
  "entries_count": 0,
  "total_minutes": 0
}
```

Requirements:

1. **`submitted` must mean "Zoho holds entries for this employee and date"**, read from Zoho or
   from Atlas's own record of what it wrote to Zoho — not from anything the Virtual Office told
   Atlas. A value this product supplied cannot verify this product.
2. **`work_date` is a Manila calendar date.** The Virtual Office computes it with
   `manilaWorkDate()` (`useCheckoutFlow.ts`) and submits against it today; both sides must agree
   or the check fails at midnight.
3. **A partial submission must be distinguishable.** `AtlasZohoService` already surfaces per-entry
   failures, and `success` is false whenever any entry failed. If a day can land partially,
   `entries_count` must reflect what actually landed.
4. **Idempotent, cheap and cacheable for a short TTL.** It would be called at most once per
   checkout attempt, but a retry loop must not become Zoho request volume.
5. `200` with `submitted: false` for "no log yet" — not `404`, so "not submitted" is never
   indistinguishable from "endpoint or employee missing".
6. Failure modes must be explicit. If Atlas cannot reach Zoho, say so (e.g. `503`) rather than
   answering `submitted: false` — a checkout gate that **fails open on an outage is no gate, and
   one that fails closed on an outage strands everyone at their desk.** The Virtual Office needs to
   tell those two apart to choose a policy.

## How this backend would use it

`POST /attendance/check-out` would, before ending a session, either:

* confirm `submitted: true` for the caller's current work date, **or**
* confirm the caller holds `attendance.timelog_exempt`
  (`backend/app/services/attendance_exemption.py`, the single seam that answers this).

Until the endpoint above exists, only the second half is implementable, and the first half stays
what it is today: a UI convention.

## Alternative that would remove the cross-repo dependency

If Atlas instead carried permissions on `GET /api/v1/auth/me` — it already returns
`permissions.can_view_virtual_office`, which `frontend/src/auth/useAuthGate.ts` reads — then
`backend/app/auth/atlas.py` could extract a permission claim alongside the email it already
extracts, and the Executive Access Pass could be an Atlas-managed role rather than a local grant
table. That is the preferred long-term home for the *permission*; it does **not** remove the need
for the timelog-status endpoint above, which answers a different question.
