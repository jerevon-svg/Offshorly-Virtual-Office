// cranium.test.mjs — the cranium : face relation is ONE definition (the mounted gate's skull height ÷ face length) and its approved
// maximum is calibration data. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/cranium.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Document } from "@gltf-transform/core";
import { afterAll, describe, expect, it } from "vitest";
import { GATE_CHIN_Y, craniumMax, craniumRatio } from "./cranium.mjs";

const made = [], scratch = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function head({ skinTop, eyeY, hairTop = null }) {
  const doc = new Document(), mesh = (name, ys) => doc.createMesh(name).addPrimitive(doc.createPrimitive().setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(Float32Array.from(ys.flatMap((y) => [0, y, 0])))));
  const scene = doc.createScene().setExtras({ humanIdentity: { landmarks: { eyes: { l: [-0.1, eyeY, 0.3], r: [0.1, eyeY, 0.3] } } } });
  scene.addChild(doc.createNode().setMesh(mesh("identity_head", [GATE_CHIN_Y, eyeY, skinTop])));
  if (hairTop) scene.addChild(doc.createNode().setMesh(mesh("hair_main", [hairTop])));
  return doc;
}

describe("cranium : face", () => {
  it("is (skin top − the gate's chin) / (eye line − chin), and hair never counts", () => {
    const r = craniumRatio(head({ skinTop: 1.6, eyeY: 1.2, hairTop: 2.4 }));
    expect(r.R).toBeCloseTo((1.6 - 0.805) / (1.2 - 0.805), 3);
    expect(r.skinTop).toBe(1.6);
  });

  it("fails loudly without eye landmarks or an identity_head mesh", () => {
    const d = head({ skinTop: 1.6, eyeY: 1.2 }); d.getRoot().listScenes()[0].setExtras({});
    expect(() => craniumRatio(d)).toThrow(/eye landmarks/);
  });

  it("reads the approved maximum from calibration data and refuses a calibration without one", () => {
    const dir = scratch("cranium-"), f = path.join(dir, "cal.json");
    fs.writeFileSync(f, JSON.stringify({ max: 2.1086 })); expect(craniumMax(f)).toBe(2.1086);
    fs.writeFileSync(f, JSON.stringify({})); expect(() => craniumMax(f)).toThrow(/no maximum/);
  });

  it("the shipped calibration holds the approved five, and Bon sets the maximum", () => {
    const cal = JSON.parse(fs.readFileSync("scripts/avatar-pipeline/human-base/cranium-calibration.json", "utf8"));
    expect(Object.keys(cal.heads).sort()).toEqual(["angelo", "bon", "clang", "france", "micah"]);
    expect(cal.max).toBe(cal.heads.bon.R);
  });
});
