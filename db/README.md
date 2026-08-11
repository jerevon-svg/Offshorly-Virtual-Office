# db

No database exists in this repo today.

Current persistence is either external — the Atlas API (auth) and a mocked
Zoho integration (`frontend/src/services/zoho/MockZohoService.ts`) — or
client-side `localStorage`, e.g. `frontend/src/services/avatar/avatarStorage.ts`
and `frontend/src/data/checkoutStorage.ts`.

This folder is reserved for a future real database (schema, migrations,
etc.) once one is introduced.
