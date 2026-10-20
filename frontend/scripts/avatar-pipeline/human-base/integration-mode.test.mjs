// integration-mode.test.mjs — the opt-in INTEGRATION experiment (2026-10-13) and the classifier's skin-probe anchor it needed.
// Synthetic geometry only. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/integration-mode.test.mjs
import { describe, expect, it } from "vitest";
import { classifyHead } from "./chibify.mjs";

// a synthetic head: a vertical skin face (z 0) under a hair crown, optionally a saturated lock IN FRONT of the face's middle band
function head(lockInFront) {
  const P = [], COL = [], I = [];
  const quad = (x0, x1, y0, y1, z, rgb, step = 0.01) => { const base = P.length / 3, nx = Math.round((x1 - x0) / step) + 1, ny = Math.round((y1 - y0) / step) + 1;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { P.push(x0 + i * step, y0 + j * step, z); COL.push(...rgb); }
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = base + j * nx + i; I.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx); } };
  quad(-0.5, 0.5, 0, 0.9, 0, [240, 200, 175]);                           // skin face
  quad(-0.5, 0.5, 0.9, 1.0, -0.05, [230, 40, 110]);                      // pink crown (the hair seed)
  if (lockInFront) quad(0.15, 0.45, 0.35, 0.6, 0.12, [235, 50, 115]);    // a dyed lock standing ahead of the face's middle band
  return { P: Float32Array.from(P), COL: Uint8Array.from(COL), n: P.length / 3, I: Uint32Array.from(I) };
}

describe("skin probe anchor", () => {
  it("a head whose front-most point is skin is anchored exactly as before", () => {
    expect(classifyHead(head(false)).anchor).toBeUndefined();
  });

  it("a saturated lock in front of the face re-anchors the probes on the face, so skin is learned as skin", () => {
    const c = classifyHead(head(true));
    expect(c.anchor).toBeDefined();
    expect(Math.hypot(c.skinC[1], c.skinC[2])).toBeLessThan(45);   // skin's modest chroma, not the lock's
    expect(c.bald).toBe(false);
  });
});

describe("integration mode", () => {
  it("keeps the generated head: it is never identity-corrected", async () => {
    const { buildEmployee } = await import("./build-employees.mjs");
    await expect(buildEmployee("nicole", { integrate: true, correct: true })).rejects.toThrow(/never identity-corrected/);
  });
});
