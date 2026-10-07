// world/labFlags — Phase 6B.0: the ONE switch for which Lab is built and whether the AI Workforce exists, and the
// promoted default (V2 + the AI Workforce Preview) as normal VO sees it — no query parameters.
import { describe, expect, it } from "vitest";
import { LAB_FLAGS, resolveLabFlags } from "./world/labFlags";
import { LAB_FP } from "./world/labVariant";
import { LAB2_PLINTH } from "./world/ailabV2";
import { campusTreeSpots } from "./world/campus";

describe("labFlags — flag combinations (Phase 6B.8: only the demo-tooling switch is left)", () => {
  it.each([
    ["", { demoTools: false }],
    ["?aidemo=1", { demoTools: true }],
    ["?aidemo=0", { demoTools: false }],
    // the retired rollbacks are simply ignored
    ["?ailab=v1", { demoTools: false }],
    ["?aiworkforce=0", { demoTools: false }],
    ["?ailab=v1&aiworkforce=0&aidemo=1", { demoTools: true }],
    ["?veg=2&monkeyplay=1", { demoTools: false }],
  ])("%s", (search, expected) => {
    expect(resolveLabFlags(search)).toEqual(expected);
  });
});

describe("the promoted default (normal VO, no query parameters)", () => {
  it("has no demo tooling", () => {
    expect(LAB_FLAGS).toEqual({ demoTools: false });
  });
  it("the exterior reads the treehouse Lab's footprint, and the campus its grove positions", () => {
    expect(LAB_FP.plinth).toBe(LAB2_PLINTH);
    const all = Object.values(campusTreeSpots().spots).flat();
    // the approved V2 tree layout (Phase 3), pinned: count and positional checksum
    expect(all.length).toBe(220);
    expect(Math.round(all.reduce((a, t) => a + t.x * 3 + t.z * 7 + t.s * 11, 0))).toBe(-183987);
  });
});

describe("Phase 6B.5 — demo controls exist only with ?aidemo=1", () => {
  it("the world builds its dev tooling (Reset, Re-enter) only behind the demo flag, and hands it out as `dev`", async () => {
    const world = (await import("./app/world.ts?raw")).default as string;
    expect(world).toMatch(/const labDemo = [^\n]*LAB_FLAGS\.demoTools \?/);
    expect(world).toMatch(/dev: labDemo/);
  });
  it("the overlay shows Reset and Re-enter only from that `dev` handle, and the example feedback only with demoTools", async () => {
    const overlay = (await import("./app/Vo3dOverlay.tsx?raw")).default as string;
    for (const id of ["ai-workforce-dev", "ailab-reenter"]) {
      const at = overlay.indexOf(`data-testid="${id}"`);
      expect(at).toBeGreaterThan(0);
      expect(overlay.slice(Math.max(0, at - 400), at)).toMatch(/aiWorkforce\??\.dev/);
    }
    const viewer = (await import("./app/AiLabResultPreview.tsx?raw")).default as string;
    expect(viewer).toMatch(/\{demoTools && [^\n]*Use the example/);
  });
  it("the production presenter and the overlay no longer depend on the V1 demo controller for their status type", async () => {
    const presenter = (await import("./app/labWorkforce.ts?raw")).default as string;
    expect(presenter).not.toMatch(/from "\.\/aiLabDemo"/);
  });
});
