// prepare-head-version.test.mjs — a versioned head's ONE paid call is refused unless every rule holds: a named approver, a
// prepared and unchanged reference, a new Meshy folder, no earlier attempt, the Meshy reserve. Temp roots only. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/prepare-head-version.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REF_LIMITS, acceptHead, acceptRefusals, generateRefusals, prepareVersion, recordFile, referenceRefusals } from "./prepare-head-version.mjs";
import { approvedSource, spriteFile } from "./studio/approved-source.mjs";
import { layout } from "./candidate-versions.mjs";
import { sha256File } from "./studio/provenance.mjs";

const made = [], scratch = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function prepared(status = "prepared") {
  const R = scratch("phv-r-"), M = scratch("phv-m-"), dir = `${R}/zz/head-v2`; fs.mkdirSync(dir, { recursive: true });
  const ref = `${dir}/zz-head-v2-ref-final.png`; fs.writeFileSync(ref, "reference pixels");
  fs.writeFileSync(recordFile("zz", "v2", R), JSON.stringify({ who: "zz", version: "v2", status, reference: { path: ref, sha256: sha256File(ref) } }));
  return { R, M, ref, ok: { approvedBy: "Bon", ledger: [], balance: 500, authority: null, R, M } };
}

describe("generateRefusals", () => {
  it("a prepared, unchanged version with a named approver and enough credits may be generated — once", () => {
    const { ok } = prepared();
    expect(generateRefusals("zz", "v2", ok)).toEqual([]);
  });

  it("refuses without a named approver, or when the backend authority must be asked", () => {
    const { ok } = prepared();
    expect(generateRefusals("zz", "v2", { ...ok, approvedBy: " " }).join()).toMatch(/named approver/);
    expect(generateRefusals("zz", "v2", { ...ok, authority: { url: "x", key: "y" } }).join()).toMatch(/spend authority/);
  });

  it("refuses a version that was never prepared or already had its paid attempt", () => {
    const { ok } = prepared();
    expect(generateRefusals("zz", "v3", ok).join()).toMatch(/never prepared/);
    for (const status of ["generating", "generated", "failed"]) expect(generateRefusals("zz", "v2", prepared(status).ok).join()).toMatch(/one paid attempt per version/);
  });

  it("refuses a reference that changed after it was recorded", () => {
    const { ok, ref } = prepared();
    fs.writeFileSync(ref, "different pixels");
    expect(generateRefusals("zz", "v2", ok).join()).toMatch(/reference changed/);
  });

  it("never overwrites: an existing Meshy folder for that version refuses", () => {
    const { ok, M } = prepared();
    fs.mkdirSync(`${M}/zz-head-v2`);
    expect(generateRefusals("zz", "v2", ok).join()).toMatch(/never overwritten/);
  });

  it("applies the Studio's local spend rules: unknown balance, the reserve, and no second payment for the same input", () => {
    const { ok, ref } = prepared();
    expect(generateRefusals("zz", "v2", { ...ok, balance: null }).join()).toMatch(/balance could not be read/);
    expect(generateRefusals("zz", "v2", { ...ok, balance: 120 }).join()).toMatch(/reserve/);
    const paid = [{ who: "zz", stage: "meshy", inputSha256: sha256File(ref), outcome: "succeeded", at: new Date().toISOString() }];
    expect(generateRefusals("zz", "v2", { ...ok, ledger: paid }).join()).toMatch(/never paid twice/);
  });
});

describe("accepting a head (the recipe's accepted head is never a failed one)", () => {
  const build = (root, tag, report) => { const L = layout("zz", tag, root); fs.mkdirSync(L.passes[0], { recursive: true }); fs.writeFileSync(`${L.passes[0]}/zz-v1.glb`, "x");
    fs.writeFileSync(L.report, JSON.stringify({ builtAt: new Date().toISOString(), ...report })); };

  it("refuses a head whose builds failed the gate, or passed only the automated part", () => {
    const root = scratch("phv-acc-");
    build(root, "xcorr-v1", { head: "v2", experimental: true, pass: false, automatedPass: false, failed: ["FC-HEAD-ENVELOPE"], signoffRequired: [] });
    expect(acceptRefusals("zz", "v2", { approvedBy: "Bon", root }).join()).toMatch(/no build from zz-head-v2 has passed the whole gate/);
    build(root, "xcorr-v2", { head: "v2", experimental: true, pass: false, automatedPass: true, failed: [], signoffRequired: ["FC-EAR-BOUNDARY"] });
    expect(acceptRefusals("zz", "v2", { approvedBy: "Bon", root }).join()).toMatch(/passed the whole gate/);
  });

  it("accepts only a fully passing build with a named approver, and then writes only that person's head", () => {
    const root = scratch("phv-acc2-"), file = path.join(scratch("phv-rec-"), "employees.json");
    fs.writeFileSync(file, JSON.stringify({ employees: { zz: { hair: "x" }, other: { hair: "y" } } }));
    build(root, "xcorr-v1", { head: "v2", experimental: true, pass: true, automatedPass: true, failed: [], signoffRequired: [] });
    expect(acceptRefusals("zz", "v2", { approvedBy: " ", root }).join()).toMatch(/named approver/);
    expect(() => acceptHead("zz", "v2", { approvedBy: "", file, root })).toThrow(/REFUSED/);
    expect(acceptHead("zz", "v2", { approvedBy: "Bon", file, root })).toBe("v2");
    expect(JSON.parse(fs.readFileSync(file, "utf8")).employees).toEqual({ zz: { hair: "x", head: "v2" }, other: { hair: "y" } });
  });
});

describe("a FIRST head (2026-10-20): a person with no head yet is prepared as v1, the version every recipe reads", () => {
  it("no v1 Meshy folder and no v1 reference → v1; otherwise the next free version, and v1 is never reused", () => {
    const M = scratch("phv-fm-"), R = scratch("phv-fr-");
    expect(prepareVersion("zz", null, { M, R })).toBe("v1");
    expect(prepareVersion("zz", "v1", { M, R })).toBe("v1");
    fs.mkdirSync(`${R}/zz`);   // a v1 reference already prepared: its version is taken
    expect(prepareVersion("zz", null, { M, R })).toBe("v2");
    expect(() => prepareVersion("zz", "v1", { M, R })).toThrow(/v1 is the original head/);
    const M2 = scratch("phv-fm2-"), R2 = scratch("phv-fr2-"); fs.mkdirSync(`${M2}/zz-head-v1`);   // a paid v1 head exists
    expect(prepareVersion("zz", null, { M: M2, R: R2 })).toBe("v2");
    expect(() => prepareVersion("zz", "v1", { M: M2, R: R2 })).toThrow(/v1 is the original head/);
  });
});

describe("the prepared reference fails closed before any spend", () => {
  it("passes the approved references' own range and refuses a rebuilt (non-sprite) reference", () => {
    expect(referenceRefusals({ frame: { pixels: 17765 }, inpainted: 110652 })).toEqual([]);   // Micah (glasses removed): the largest approved values
    expect(referenceRefusals({ frame: { pixels: 49 }, inpainted: 58472 })).toEqual([]);   // Esson's Stage A sprite
    const canonical = referenceRefusals({ frame: { pixels: 853718 }, inpainted: 1087728 });   // Esson's population trace crop
    expect(canonical).toHaveLength(2); expect(canonical.join()).toMatch(/Stage A sprite/);
    expect(referenceRefusals({ frame: { pixels: REF_LIMITS.framePx + 1 } }).join()).toMatch(/backdrop/);
  });
});

describe("approvedSource: the Stage A illustration a head is made from", () => {
  it("a Studio upload wins, else the roster sprite (bon ↔ Jerevon), else null — never the population crop", () => {
    const S = scratch("as-s-"), dir = scratch("as-d-"); fs.mkdirSync(`${S}/uploads`);
    expect(spriteFile("esson", dir)).toBe(path.join(dir, "Esson_Sprite.png")); expect(spriteFile("bon", dir)).toBe(path.join(dir, "Jerevon_Sprite.png"));
    expect(approvedSource("esson", { S, dir })).toBeNull();
    fs.writeFileSync(spriteFile("esson", dir), "sprite"); expect(approvedSource("esson", { S, dir })).toBe(spriteFile("esson", dir));
    fs.writeFileSync(`${S}/uploads/esson.png`, "upload"); expect(approvedSource("esson", { S, dir })).toBe(`${S}/uploads/esson.png`);
    expect(approvedSource("../x", { S, dir })).toBeNull();
  });
});
