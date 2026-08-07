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
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
