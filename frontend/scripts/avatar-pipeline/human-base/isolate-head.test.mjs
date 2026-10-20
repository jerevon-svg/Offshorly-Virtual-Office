// isolate-head.test.mjs — a full-body figure is told from a head-only Meshy result by its NECK POSITION, measured around the head's
// vertical axis (so long hair never hides the neck); a head-only result is never cut. Synthetic surfaces only. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/isolate-head.test.mjs
import { describe, expect, it } from "vitest";
import { detectFullBody, neckCut, profileOf } from "./isolate-head.mjs";

// surface samples of simple solids (y up, figures centred on the y axis); top = 1
const sphere = (cy, r, out, cx = 0) => { for (let i = 0; i <= 80; i++) { const t = (i / 80) * Math.PI; for (let j = 0; j < 96; j++) { const p = (j / 96) * 2 * Math.PI; out.push(cx + r * Math.sin(t) * Math.cos(p), cy + r * Math.cos(t), r * Math.sin(t) * Math.sin(p)); } } };
const tube = (y0, y1, r, out, cx = 0) => { for (let y = y0; y <= y1; y += 0.0025) for (let j = 0; j < 96; j++) { const p = (j / 96) * 2 * Math.PI; out.push(cx + r * Math.cos(p), y, r * Math.sin(p)); } };
const profile = (pts) => profileOf([Float32Array.from(pts)]);

const headOnly = () => { const P = []; sphere(0.62, 0.3, P); tube(0.12, 0.34, 0.07, P); tube(0, 0.12, 0.22, P); return P; };   // head, neck, bust
const fullBody = (hair = false) => { const P = []; sphere(0.8, 0.2, P); tube(0.5, 0.6, 0.035, P); tube(0.3, 0.5, 0.11, P);      // head, neck, torso
  tube(0, 0.3, 0.035, P, -0.06); tube(0, 0.3, 0.035, P, 0.06); if (hair) tube(0.5, 0.75, 0.21, P); return P; };              // two legs; a bob hiding the neck

describe("full-body detection", () => {
  it("leaves a head-only result (head, neck stump, bust) alone — its neck is low", () => {
    const d = detectFullBody(profile(headOnly()));
    expect(d.fullBody).toBe(false);
    expect(d.neckAt).toBeGreaterThan(0.58);
  });

  it("finds the neck of a full-body figure in the middle of it, and cuts between the head and the torso", () => {
    const p = profile(fullBody()), d = detectFullBody(p), c = neckCut(p);
    expect(d.fullBody).toBe(true);
    expect(c.y).toBeGreaterThan(0.48); expect(c.y).toBeLessThan(0.62);
  });

  it("long hair over the neck does not hide it (the core is measured from the axis outward)", () => {
    const p = profile(fullBody(true)), c = neckCut(p);
    expect(detectFullBody(p).fullBody).toBe(true);
    expect(c.y).toBeGreaterThan(0.48); expect(c.y).toBeLessThan(0.62);
  });
});
