/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Atlas reverse-proxies this app at https://atlas.offshorly.com/virtual-office,
// so all built asset URLs must carry the /virtual-office/ prefix. ES-module
// image imports (src/data/office-layout.ts, bonWalkFrames.ts) get this
// automatically via Vite's asset pipeline. Any FUTURE runtime-built path
// (i.e. a string path constructed in code, not an `import`) must be built
// from `import.meta.env.BASE_URL` instead of a hardcoded leading-slash
// literal, or it will resolve against Atlas's root instead of this app.
const BASE_PATH = "/virtual-office/";

// Vite's `base` only rewrites URLs inside the built HTML/JS — it does NOT
// change where files are physically emitted. Render's publish dir serves
// `dist/` at the service root, so if outDir stayed the default `dist`, the
// HTML would ask for `/virtual-office/assets/*` while the files sit at
// `/assets/*` (404 -> blank page). Nesting outDir under `dist/virtual-office`
// makes the physical layout match the `base` URL layout, so the service
// genuinely serves the app at `/virtual-office/` — which is required because
// Atlas's proxy preserves that path prefix (forwards
// `/virtual-office/:path*` to `<upstream>/virtual-office/:path*`), not
// rewrites to root.
// https://vite.dev/config/
export default defineConfig({
  base: BASE_PATH,
  build: {
    outDir: "dist/virtual-office",
    emptyOutDir: true,
  },
  plugins: [react()],
  server: {
    // 5173 is a CONTRACT, not a preference: Atlas's dev proxy targets
    // VIRTUAL_OFFICE_URL=http://localhost:5173, and the hmr block below
    // hardcodes the same port. Vite's default behaviour on a busy port is to
    // silently pick the next free one (5174, 5175...) — which breaks both of
    // those at once, with no error: Atlas proxies to a port nothing serves (or
    // worse, to a STALE dev server from an earlier session), and this server's
    // HMR client dials 5173 and talks to that other app. strictPort turns that
    // silent drift into a loud startup failure, so a leftover `npm run dev`
    // gets noticed and killed instead of quietly shadowing this one.
    port: 5173,
    strictPort: true,
    // Atlas fronts this dev server via Next.js `rewrites()` — the browser sits
    // on origin localhost:3000 and Next forwards to localhost:5173. `rewrites()`
    // proxies HTTP only; it does NOT forward the WebSocket upgrade that Vite's
    // HMR client needs. Without this block the HMR socket tries to connect to
    // the page's own origin (3000), gets no upgrade, and hot reload dies
    // SILENTLY — the page still renders, edits just never appear. Pointing the
    // HMR client straight at 5173 keeps the socket direct while the page itself
    // stays on origin 3000 (and so keeps Atlas's localStorage token).
    hmr: { protocol: "ws", host: "localhost", port: 5173 },
    proxy: {
      // Local avatar-generation server (scripts/avatar-pipeline/gen-server.mjs)
      // — holds the OpenAI key server-side only. Browser calls /avatar-api/*
      // same-origin; never fetches OpenAI directly.
      "/avatar-api": {
        target: "http://localhost:4748",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/avatar-api/, ""),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    env: { VITE_CHAT_MODE: 'mock' },
  },
})
