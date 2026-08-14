# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Local test: real chat backend across two browsers (dev-only)

Validates Phase 3 real-time chat (`../backend/`, Socket.IO + Postgres +
Atlas-JWT auth) end to end, without needing two real Atlas logins. Uses the
backend's dev-only `x-dev-email` bypass (see `../backend/README.md`'s
"Dev-only bypass" section) and a throwaway test page
(`src/pages/ChatTestPage.tsx`) that is compiled out of any production
build (`import.meta.env.DEV`-gated).

1. Start the backend (from `../backend/`):
   ```bash
   cd backend
   npm install
   cp .env.example .env   # fill in DATABASE_URL at minimum
   npm run migrate
   npm run dev             # listens on PORT, default 4800
   ```
2. Start this frontend's dev server with real chat mode pointed at that
   backend:
   ```bash
   cd frontend
   VITE_CHAT_MODE=real VITE_CHAT_SOCKET_URL=http://localhost:4800 npm run dev
   ```
3. **Browser 1** (e.g. your normal browser): open
   `http://localhost:5173/?chatTest=1` (adjust the port to whatever
   `npm run dev` prints). Set "your email" to `alice@local.test`, "peer
   email" to `bob@local.test`, click **Start chat**.
4. **Browser 2** (e.g. an incognito window, so it doesn't share the first
   tab's local state): open the same `?chatTest=1` URL. Set "your email" to
   `bob@local.test`, "peer email" to `alice@local.test`, click **Start
   chat**.
5. Send a message from either browser — it should appear live in the
   other's conversation panel via the real backend's Socket.IO delivery.

This page never appears in a production build and never touches the real
office/roster chat UI or identity-resolution logic in `OfficeMap.tsx`.
