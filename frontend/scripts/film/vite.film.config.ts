// FILM RIG ONLY — the :5175 dev server for the LinkedIn teaser takes. Wraps the project's own
// vite.config.ts unchanged and overrides only what must differ so it can run beside :5173/:5174:
//   - its own port (strict),
//   - its own dependency cache (a shared cacheDir lets one server delete deps another is serving),
//   - its own env folder (this directory), so it never picks up .env.local or .env.mock.
//   npx vite --config scripts/film/vite.film.config.ts --mode film
import { defineConfig, mergeConfig, type ConfigEnv, type UserConfig } from "vite";
import { resolve } from "node:path";
import base from "../../vite.config";

export default defineConfig((env: ConfigEnv) => {
  const resolved = (typeof base === "function" ? base(env) : base) as UserConfig;
  return mergeConfig(resolved, {
    root: resolve(__dirname, "../.."),
    envDir: __dirname,
    cacheDir: "node_modules/.vite-film",
    server: { port: 5175, strictPort: true },
  });
});
