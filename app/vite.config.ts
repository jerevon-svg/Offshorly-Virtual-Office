/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
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
  },
})
