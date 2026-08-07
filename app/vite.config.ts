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

// https://vite.dev/config/
export default defineConfig({
  base: BASE_PATH,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
