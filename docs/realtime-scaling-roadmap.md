# Realtime Scaling Roadmap

Status of the backend realtime layer's path from single-worker/in-memory to multi-worker.
Documentation only — no code in this file, and nothing here is implemented beyond R2.

## Current checkpoint

**`7696148` — `refactor(realtime): prepare shared-state architecture` (R0 + R1 + R2).**
Committed and manually live-verified.

- **R0** — construction seam. Every realtime singleton and the Socket.IO server are constructed
  in exactly one place: `backend/app/realtime/state.py`. Routers import shared state from there
  instead of from the 1000-line handler module.
- **R1** — typing-only contracts in `backend/app/realtime/protocols.py` for the three stores a
  shared-state backend would have to reimplement, plus seam guards in
  `backend/tests/test_realtime_state.py` (singleton identity, in-process manager, protocol
  conformance, signature pinning).
- **R2** — `_build_client_manager()` config seam. `REALTIME_REDIS_URL` is read but deliberately
  returns `None` and logs a warning; it must never half-enable a multi-worker mode the registry
  layer cannot honour.

### Runtime today

Single worker, single process, all realtime state in per-process dicts. Correct only under one
worker. Nothing in this checkpoint changed behavior, wire contracts, or deployment.

## Why R3 is deferred

R3 (sync → async store boundary) was scoped and assessed, then intentionally not implemented.

- Zero behavior change: same events, same responses, same performance, same single-worker limit.
  The whole deliverable would be a diff.
- Cost is concentrated in tests, not production: ~21 method signatures and 22 production call
  sites, versus ~62 test functions and ~200 test edit sites.
- That test churn is not reusable — the same files change again when Redis lands (fakes,
  fixtures, atomicity assertions). It would be paid for twice.
- `async` keywords capture none of the actually hard part. The atomicity work below is identical
  whether the methods are `def` or `async def`.
- An all-`async` store layer reads as "Redis-ready" and invites a Redis implementation that skips
  the atomicity work — every failure mode below is a race that passes local tests and only breaks
  under two workers.

**Do not begin R3/R4 until multi-worker is actually needed.** The right time to convert is as the
first commit of the Redis branch, where the conversion is motivated, immediately exercised, and
lands beside the locking work.

## Future sequence

### R3 — async store boundary conversion

Convert the three store Protocols and their in-memory implementations from `def` to `async def`,
retaining in-memory behavior. Redis is not part of R3.

Order by ascending blast radius, one store fully green before the next:
`CallInviteStore` (7 methods) → `CallStore` (9 methods) → `SpatialSessionStore` (5 methods).

Not converted: `_drop`, `snapshot` on `CallInviteRegistry`, all `reset()`, `wire()`,
`_normalize_email` — none are in a Protocol, none reach Redis.

Also required in R3:
- `_is_in_a_call()` in `backend/app/realtime/socket.py` is the only synchronous production
  consumer; it must become `async def` and its one caller awaited.
- Four call sites need the `await` hoisted out of an expression rather than prefixed: the
  `sio.emit` dict literals for `spatial_sessions`/`spatial_calls`, the `pending_for` list
  comprehension in the connect snapshot, the `snapshot()` comprehension in
  `backend/app/routers/calls.py`, and the `any()` generator in `_is_in_a_call`.
- Invert `test_protocol_methods_stay_synchronous` in `backend/tests/test_realtime_state.py` — it
  exists precisely to make this change deliberate and visible. The other seam tests in that file
  pass unchanged; `inspect.signature` is identical for `async def`.
- `backend/app/realtime/state.py` and `backend/app/main.py` must not change.

### R4 — Redis shared state + cross-worker Socket.IO

Redis-backed store implementations satisfying the Protocols, plus `socketio.AsyncRedisManager`
via the existing `_build_client_manager()` seam. Both halves are required: Socket.IO fan-out
alone does not make the registries correct across workers, and shared registries alone do not
deliver events to a socket on another worker. Every operation in the atomicity section below must
be implemented atomically here, not later.

### R5 — multi-worker validation

Run >1 worker and re-verify the live smoke matrix: spatial session forms across workers; call
join/leave participant lists agree; one tab closing does not eject the user from their spatial
conversation; ring accept/decline/cancel/45s-timeout; glare refusal; DND routing; busy rejection;
Ask-to-Join rekey with no room hop; reload mid-ring and mid-call restores from the connect
snapshot. Watch for `RuntimeWarning: coroutine ... was never awaited` in logs.

## Registries

**Initially targeted** (read/written from *both* the socket layer and REST routers, so a second
worker disagrees about them first):

| Singleton | Implementation | Protocol |
|---|---|---|
| `spatial_sessions` | `backend/app/services/spatial_session.py` | `SpatialSessionStore` |
| `call_registry` | `backend/app/services/call_registry.py` | `CallStore` |
| `call_invites` | `backend/app/services/call_invites.py` | `CallInviteStore` |

**Also cross-layer — must eventually be considered.** `protocols.py` currently claims DND and
room presence are "purely socket-local." That is wrong and should be corrected when the file is
next touched. `dnd_registry` is read by `routers/room_requests.py` and `routers/talk_requests.py`;
`room_presence` is read by `routers/room_requests.py`; and `state.is_room_locked()` — consumed by
both a REST endpoint and `socket.py` — reads both. They are deferred because a DND boolean is a
trivial and independent migration, not because they are single-layer. Converting them later
forces `is_room_locked()` async too, which reaches `routers/room_requests.py`.

**Safely deferred, genuinely socket-local:** `offline_lineup`, `global_chat_activity`,
`position_registry` — no REST readers.

## Test hazard: `_wait` async predicates

`_wait(pred, timeout)` in `backend/tests/test_call_socket.py` calls `pred()` **synchronously**.
It is used with sync lambdas that read registry state, e.g.
`await _wait(lambda: socket_module.call_registry.participants("conv-1") == ["b@example.com"])` —
7 such sites in that file, 9 lambda predicates repo-wide.

The moment `participants()` becomes a coroutine function, the lambda returns a **coroutine object,
which is always truthy**. `_wait` returns `True` on the first poll and **every one of those
assertions passes without testing anything**, emitting only a `RuntimeWarning: coroutine was never
awaited`. These are the tests covering call join/leave broadcast fan-out.

**Fix `_wait` to await awaitable predicates BEFORE converting any store.** This is the one failure
mode in the whole conversion that is silent; everything else fails loudly.

## Atomicity requirements for Redis

Today these are free — single-threaded asyncio, no `await` inside any method body. R3 does not
break them either: awaiting a coroutine with no internal suspension point never yields. R3 does
turn them into **latent** interleaving points that only bite once Redis makes the bodies actually
suspend. Each needs a real atomic primitive in R4.

| Operation | Requirement |
|---|---|
| `CallInviteRegistry.resolve` | Check-authority-then-pop must be one step. Single-shot "first resolution wins" is the entire contract — it is what makes Accept-racing-Cancel a harmless no-op. Lua or an atomic conditional-DEL. |
| `pending_between` → `create` (**call-site pair**, `socket.py`) | TOCTOU across two awaits. Glare protection (both parties dialing at once) breaks first. Needs one atomic op on a canonical pair key (`SET NX`), not two round-trips. |
| `CallRegistry.room_for_session` | Get-or-mint. Two concurrent callers mint two rooms → split call. `SET NX`. |
| `CallRegistry._drop` teardown | "Last participant leaves → forget the room mapping" spans 3 keys. A rejoin racing teardown lands in a dead room. |
| `CallRegistry.rekey_session` | `pop(old)` + `setdefault(new)` is compound; a half-applied rekey drops an in-progress call during Ask-to-Join upgrade. |
| `SpatialSessionRegistry.start` (move path) | Rewrites `_by_email` and `_email_by_sid` together; a torn write orphans sids. |
| `clear_sid` on all three | Read-modify-write refcount with "last owning sid ends membership" semantics. Getting this wrong re-introduces the Stage 0 bug where one of a user's ~10 sockets dropping ejects them from their conversation. |
| `expired()` sweep vs `resolve` | The TTL sweep and a concurrent resolve must not both fire terminal events for the same invite. |

## Invariant: the `main.py` → `socket.py` import

`backend/app/main.py` imports `sio` from `app.realtime.socket`, **not** from `app.realtime.state`,
even though `state.py` is where `sio` is constructed. **That import is what registers every
Socket.IO event handler.** Importing `state.py` alone yields a server with no handlers on it — a
silent, total realtime outage that no unit test catches.

Related invariant: every registry is constructed exactly once, in `state.py`. `socket.py`
re-exports the same objects, so `state.spatial_sessions is socket.spatial_sessions`. A second
instance anywhere silently splits ephemeral state — a router answering from one dict while the
socket layer mutates another. `backend/tests/test_realtime_state.py` guards both invariants; keep
those tests passing through R3–R5.
