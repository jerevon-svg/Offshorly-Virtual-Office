from __future__ import annotations

# Centralized DND V1 policy constants — the server-side (cooldown enforcement) half of the
# policy. Mirrored on the frontend by services/presence/dndPolicy.ts (session length/daily
# allowance are enforced client-side in V1; only the decline cooldown needs server enforcement,
# since it gates a REST create call directly — see repositories/talk_requests.py's
# get_cooldown_until). Kept as one importable module (not inlined in the repo/router) so a future
# company-configurable policy can swap these for a DB-backed lookup without touching call sites.

DECLINE_COOLDOWN_SECONDS = 15 * 60
MAX_DND_SESSION_SECONDS = 2 * 60 * 60
DAILY_DND_ALLOWANCE_SECONDS = 3 * 60 * 60
