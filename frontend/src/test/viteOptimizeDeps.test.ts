import { describe, expect, it } from "vitest";
// Vite `?raw` import — the config's own source text, same trick as OfficeMap.moveSelfGuard.test.ts.
// Asserted as text so this test needs neither vite's node-only config loader nor node types.
import viteConfigSource from "../../vite.config.ts?raw";

// Regression guard for the Whiteboard create flow (2026-09-05): the editor dependency (now
// @excalidraw/excalidraw, previously tldraw) is loaded lazily, so
// unless it is pre-bundled at dev-server start, Vite discovers it on the first board open and
// forces a full page reload — which threw the user out of the group chat and the board they had
// just created.
describe("vite.config.ts", () => {
  it("pre-bundles @excalidraw/excalidraw so opening a whiteboard never triggers a dev-server reload", () => {
    const optimizeDeps = /optimizeDeps:\s*\{[\s\S]*?include:\s*\[([\s\S]*?)\]/.exec(viteConfigSource);
    expect(optimizeDeps, "optimizeDeps.include block missing").not.toBeNull();
    expect(optimizeDeps![1]).toMatch(/["']@excalidraw\/excalidraw["']/);
  });
});
