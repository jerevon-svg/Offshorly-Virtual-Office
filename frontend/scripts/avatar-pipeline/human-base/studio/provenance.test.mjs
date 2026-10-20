// provenance.test.mjs — a SIMULATED stage (a fixture standing in for a paid generation) is labelled and never promotable; a Meshy head
// borrowed from another person is caught even without records. From frontend/:  npx vitest run scripts/avatar-pipeline/human-base/studio/provenance.test.mjs
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertPromotable, borrowedHead, readProvenance, recordStage, simulatedStages } from "./provenance.mjs";
// every temp dir a test makes is removed after the file (they held ~25 MB of GLBs per run and filled the disk)
const made = [], scratch = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const tmp = () => scratch("hb-prov-");
describe("provenance (studio/provenance.mjs)", () => {
  it("records each stage with its mode; a SIMULATED stage makes the person non-promotable", () => {
    const d = tmp(); recordStage("zz-new", "illustration", { mode: "real", outputSha256: "a" }, d); expect(() => assertPromotable("zz-new", d)).not.toThrow();
    recordStage("zz-new", "meshy", { mode: "SIMULATED", from: "bon-head-v1" }, d); expect(simulatedStages("zz-new", d)).toEqual(["meshy"]);
    expect(() => assertPromotable("zz-new", d)).toThrow(/SIMULATED stage\(s\) \(meshy\)/); expect(readProvenance("zz-new", d).stages.illustration.mode).toBe("real"); });
  it("a head linked from ANOTHER person's folder is a stand-in; a person's own head is not", () => {
    const M = tmp(), src = `${M}/bon-head-v1/raw-untouched`, own = `${M}/kael-head-v1/raw-untouched`, dst = `${M}/zz-new-head-v1/raw-untouched`; for (const d of [src, own, dst]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(`${src}/bon-head-v1-raw-model.glb`, "x"); fs.writeFileSync(`${own}/kael-head-v1-raw-model.glb`, "y"); fs.symlinkSync(`${src}/bon-head-v1-raw-model.glb`, `${dst}/zz-new-head-v1-raw-model.glb`);
    expect(borrowedHead("zz-new", M)).toMatch(/bon-head-v1/); expect(borrowedHead("kael", M)).toBeNull(); expect(borrowedHead("nobody", M)).toBeNull(); });
});
