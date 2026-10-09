// pipeline-contract.test.mjs — THE HUMANBASE PIPELINE CONTRACT (V2, 2026-10-06). Proves the pipeline itself works before it
// is asked to make another employee: fixtures pass / fail on the registry's detectors, nothing un-gated reaches
// production/, activation never branches on a name, and a detector that cannot run is a failure.
// Heavy (real GLBs + the production runtime via vite-node): run on its own —
//   npx vitest run scripts/avatar-pipeline/human-base/pipeline-contract.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { APPROVED, BROKEN, REPAIRED } from "./fixtures/fixtures.mjs";
import { bindingHashOf, gate, mountedEvidence, sha256 } from "./gate.mjs";
import { approvalCovers, evaluate, FROZEN, REGISTRY, repairsFor, SIGNOFF_CLASSES } from "./failure-registry.mjs";
import { promoteCandidate } from "./build-employees.mjs";

const T = 30 * 60_000;
const results = {};
beforeAll(async () => {
  const all = [...APPROVED, ...BROKEN, ...REPAIRED.filter((f) => fs.existsSync(f.identityFile))];
  // the frozen five are measured at their approved mount; every other fixture the way a candidate is: the automatic mount
  const spec = (f) => (FROZEN.has(f.appearanceId) ? "prod" : "auto");
  const m = mountedEvidence(all.map((f) => [f.appearanceId, f.identityFile, spec(f)]));   // ONE runtime process for every mounted build
  for (const f of all) results[f.name] = await gate({ ...f, mounted: m[`${f.appearanceId}|${f.identityFile}|${spec(f)}`] ?? m[`${f.appearanceId}|${f.identityFile}`] });
}, T);

describe("1 · the approved first five are immutable PASSING fixtures", () => {
  for (const f of APPROVED) it(`${f.name}: every automated class passes on the frozen production artifact`, () => {
    expect(results[f.name].failed).toEqual([]);
    expect(results[f.name].evidence.mounted, "validated mounted + dressed").toBeTruthy();
  });
});

describe("2 · today's broken batch-2 states are FAILING fixtures", () => {
  for (const f of BROKEN) it(`${f.name} trips ${f.expect.join(" + ")}`, () => {
    for (const id of f.expect) expect(results[f.name].failed).toContain(id);
  });
  for (const f of BROKEN.filter((x) => x.visualReject)) it(`${f.name} (visually rejected) can never pass the gate — held by ${f.visualReject.join(" + ")}`, () => {
    expect(results[f.name].pass).toBe(false);
    for (const id of f.visualReject) expect(results[f.name].signoffRequired).toContain(id);
  });
  it("Nicole: a passing face-width ratio cannot override a broken whole-head relationship", () => {
    const r = results["nicole-broken-narrowed-face"], aspect = r.classes.find((c) => c.id === "FC-FACE-ASPECT-GROWTH");
    expect(aspect.status).toBe("PASS");                                  // the narrowing made the ratio pass …
    expect(r.failed).toEqual(expect.arrayContaining(["FC-SKULL-CONTRACT", "FC-CLOSURE-EXPOSED"]));   // … the whole head still fails
    expect(r.automatedPass).toBe(false);
  });
});

describe("3 · repaired fixtures (rebuilt from the clean raw by the detector-driven build) pass their classes", () => {
  for (const f of REPAIRED) it.runIf(fs.existsSync(f.identityFile))(`${f.name}: ${f.fixes.join(" + ")} now pass`, () => {
    for (const id of f.fixes) expect(results[f.name].classes.find((c) => c.id === id).status).toBe("PASS");
  });
});

describe("4 · nothing un-gated reaches production/", () => {
  const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "hb-prod-")); return d; };
  it("a failing candidate is refused and production is untouched", () => {
    const d = tmp(), f = BROKEN[0]; fs.writeFileSync(path.join(d, `${f.appearanceId}-v1.glb`), "approved-bytes");
    expect(() => promoteCandidate({ who: f.appearanceId, file: f.identityFile, gateResult: results[f.name], prodDir: d, manifestFile: null })).toThrow(/gate did not pass/);
    expect(fs.readFileSync(path.join(d, `${f.appearanceId}-v1.glb`), "utf8")).toBe("approved-bytes");
  });
  it("an automated pass still needs the hash-bound visual sign-off", () => {
    const r = results[APPROVED[0].name]; expect(r.automatedPass).toBe(true); expect(r.pass).toBe(false); expect(r.signoffRequired.length).toBeGreaterThan(0);
  });
  it("a frozen approved fixture can never be promoted over", () => {
    expect(() => promoteCandidate({ who: "bon", file: APPROVED[0].identityFile, gateResult: { ...results.bon, pass: true }, prodDir: tmp(), manifestFile: null })).toThrow(/frozen/);
    expect([...FROZEN]).toEqual(["bon", "micah", "angelo", "clang", "france"]);
  });
});

describe("5 · reproducibility stamps", () => {
  it("every gate result carries the artifact hash of the exact file it measured", () => {
    for (const r of Object.values(results)) expect(r.artifactHash).toBe(sha256(r.identityFile));
  });
});

describe("6 · repair activation never branches on an employee name", () => {
  // a BRANCH on a name: compared, switched on, or tested for membership (prose and the shared canonical-skull asset are not activation)
  const N = "(bon|micah|angelo|clang|france|jona|kael|nicole|lui|alex|jan)", NAMES = new RegExp(`(?:[!=]==?|\\bcase)\\s*["'\`]${N}["'\`]|["'\`]${N}["'\`]\\s*[!=]==?|\\.(?:includes|has|startsWith)\\(\\s*["'\`]${N}["'\`]|\\[\\s*["'\`]${N}["'\`]\\s*\\]\\s*\\?|\\b${N}\\s*:\\s*\\{\\s*(?:rimTuck|collarCull|hairAsSkinRelabel|napeSkin)|\\[[^\\]]*["'\`]${N}["'\`][^\\]]*\\]\\s*\\.(?:includes|indexOf)\\(`, "i");
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/history:\s*\[[^\]]*\]/g, "").replace(/export const FROZEN[^\n]*\n/, "");
  for (const f of ["build-employees.mjs", "failure-registry.mjs", "failure-detectors.mjs", "gate.mjs", "chibify.mjs", "hair-layers.mjs", "mounted-gate.run.ts"]) it(`${f}: no employee name in code`, () => {
    const code = strip(fs.readFileSync(`scripts/avatar-pipeline/human-base/${f}`, "utf8")), hit = code.split("\n").find((l) => NAMES.test(l));
    expect(hit ?? null).toBeNull();
  });
  it("employees.json carries no repair switch (history only for the frozen five)", () => {
    const R = JSON.parse(fs.readFileSync("scripts/avatar-pipeline/human-base/employees.json", "utf8"));
    for (const e of Object.values(R.employees)) expect(e.repairs).toBeUndefined();
  });
  it("repairs come only from detectors on evidence", () => {
    expect(repairsFor({ artifact: { closureBelowJaw: 0, baldPocketCells: 0, collarHair: { verts: 0 }, neckHair: { verts: 0 }, skinFlaps: { verts: 0 }, hairAsSkin: { areaPct: 0 } }, mounted: { closure: { pct: 2, worstPct: 10 } } })).toEqual([]);
    expect(repairsFor({ artifact: { closureBelowJaw: 99, baldPocketCells: 270, collarHair: { verts: 12 }, neckHair: { verts: 1367 }, skinFlaps: { verts: 87 }, hairAsSkin: { areaPct: 17 } }, mounted: { closure: { pct: 12.6, worstPct: 25 } } }).sort()).toEqual(["collarCull", "crownSkinRelabel", "hairAsSkinRelabel", "jawClosureClip", "keepOwnUnderside", "neckHairClear", "rimTuck"]);
    for (const c of REGISTRY) for (const f of c.repairFlags ?? (c.repairFlag ? [c.repairFlag] : [])) expect(f).not.toBe("napeSkin");   // the withdrawn universal repair can never be enabled
  });
});

describe("7–8 · mounted validation precedes promotion; nothing can change the file in between", () => {
  const pass = (f) => ({ ...results[f.name], pass: true });
  it("a gate result without mounted evidence is refused", () => {
    const f = BROKEN[1], g = pass(f); delete g.evidence; const d = fs.mkdtempSync(path.join(os.tmpdir(), "hb-prod-"));
    expect(() => promoteCandidate({ who: f.appearanceId, file: f.identityFile, gateResult: g, prodDir: d, manifestFile: null })).toThrow(/mounted/);
  });
  it("a file that changed after the gate (re-optimised / edited) is refused", () => {
    const f = BROKEN[1], d = fs.mkdtempSync(path.join(os.tmpdir(), "hb-prod-")), copy = path.join(d, "cand.glb"); fs.copyFileSync(f.identityFile, copy); fs.appendFileSync(copy, "x");
    expect(() => promoteCandidate({ who: f.appearanceId, file: copy, gateResult: pass(f), prodDir: d, manifestFile: null })).toThrow(/changed after the gate/);
  });
});

describe("9 · a detector failure is a FAIL, never a warning", () => {
  it("missing evidence fails every class that needs it", () => {
    const r = evaluate({ record: { skullWidth: 1, aspectGrowth: 1.2, detections: {} } });
    expect(r.automatedPass).toBe(false); expect(r.failed).toContain("FC-CLOSURE-EXPOSED"); expect(r.failed).toContain("FC-JAW-RIM");
  });
  it("a validator that throws is a FAIL", () => {
    const r = evaluate({ record: {}, artifact: {}, mounted: {} });
    const c = r.classes.find((x) => x.id === "FC-CLOSURE-EXPOSED"); expect(c.status).toBe("FAIL"); expect(String(c.value)).toMatch(/validator error/);
  });
});

describe("10 · visual sign-off is hash-, version- and class-bound, and never passes an automated class", () => {
  const passingEvidence = () => results.bon.evidence, H = "a".repeat(64), V = "0123456789abcdef";
  const MT = { scale: 0.885, pitchDeg: 0 }, BH = bindingHashOf(H, MT);
  const ok = { artifactHash: H, bindingHash: BH, pipelineVersion: V, classes: [...SIGNOFF_CLASSES], reviewer: "Bon", timestamp: "2026-10-06T12:00:00.000Z" };
  const at = (o = {}) => ({ approval: ok, artifactHash: H, pipelineVersion: V, bindingHash: BH, ...o });
  it("a complete approval on an automated pass makes the gate pass", () => {
    const r = evaluate(passingEvidence(), at()); expect(r.pass).toBe(true); expect(r.signoffRequired).toEqual([]);
  });
  it("any artifact change invalidates it", () => { expect(evaluate(passingEvidence(), at({ artifactHash: "b".repeat(64) })).pass).toBe(false); });
  it("a different pipeline version invalidates it", () => { expect(evaluate(passingEvidence(), at({ pipelineVersion: "fedcba9876543210" })).pass).toBe(false); });
  it("the SAME artifact at a different head mount is a different validated thing — the approval does not carry over", () => {
    expect(evaluate(passingEvidence(), at({ bindingHash: bindingHashOf(H, { scale: 0.9, pitchDeg: 0 }) })).pass).toBe(false);
    expect(evaluate(passingEvidence(), at({ bindingHash: bindingHashOf(H, { scale: 0.885, pitchDeg: 3 }) })).pass).toBe(false);
  });
  it("an approval for one class does not approve another", () => {
    const r = evaluate(passingEvidence(), at({ approval: { ...ok, classes: ["FC-EAR-BOUNDARY"] } }));
    expect(r.pass).toBe(false); expect(r.signoffRequired).toEqual(SIGNOFF_CLASSES.filter((c) => c !== "FC-EAR-BOUNDARY"));
  });
  it("a generic approval ('looks good', or naming automated classes) cannot bypass an automated failure", () => {
    const broken = results["kael-broken-collar-ears"];
    const all = { ...ok, classes: [...SIGNOFF_CLASSES, ...REGISTRY.map((c) => c.id), "looks-good"] };
    const r = evaluate(broken.evidence, at({ approval: all }));
    expect(r.pass).toBe(false); expect(r.failed).toContain("FC-COLLAR-AS-HAIR");
    for (const c of REGISTRY.filter((x) => !x.signoff)) expect(approvalCovers(all, c.id, { artifactHash: H, pipelineVersion: V, bindingHash: BH })).toBe(false);
  });
  it("an approval without reviewer or timestamp is not an approval", () => {
    expect(approvalCovers({ ...ok, reviewer: "" }, "FC-EAR-BOUNDARY", { artifactHash: H, pipelineVersion: V, bindingHash: BH })).toBe(false);
    expect(approvalCovers({ ...ok, timestamp: undefined }, "FC-EAR-BOUNDARY", { artifactHash: H, pipelineVersion: V, bindingHash: BH })).toBe(false);
    expect(approvalCovers({ ...ok, bindingHash: undefined }, "FC-EAR-BOUNDARY", { artifactHash: H, pipelineVersion: V, bindingHash: BH })).toBe(false);
  });
});

describe("11 · RUNTIME / GATE PARITY — what passed the final gate is exactly what the Virtual Office renders", () => {
  const f = REPAIRED.find((x) => x.automatedParity && fs.existsSync(x.identityFile)) ?? REPAIRED.find((x) => fs.existsSync(x.identityFile));
  const passed = () => ({ ...results[f.name], pass: true });   // stand-in for the sign-off (never written for real here)
  it("the gate result carries the automatic mount it validated, bound to the artifact", () => {
    const r = results[f.name]; expect(r.validatedMount).toEqual(r.evidence.mounted.mount); expect(r.validatedMount.scale).toBeGreaterThan(0.7);
    expect(r.bindingHash).toBe(bindingHashOf(sha256(f.identityFile), r.validatedMount));
  });
  it("promotion writes the validated mount into the runtime record; the production appearance path renders it identically", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "hb-prod-")), mounts = path.join(d, "mounts.json");
    promoteCandidate({ who: f.appearanceId, file: f.identityFile, gateResult: passed(), prodDir: d, manifestFile: null, mountsFile: mounts });
    const rec = JSON.parse(fs.readFileSync(mounts, "utf8"))[f.appearanceId], prod = path.join(d, `${f.appearanceId}-v1.glb`);
    expect(rec.mount).toEqual(results[f.name].validatedMount); expect(rec.artifactHash).toBe(sha256(prod)); expect(rec.bindingHash).toBe(results[f.name].bindingHash);
    const rt = mountedEvidence([[f.appearanceId, prod, `mounts:${mounts}`]])[`${f.appearanceId}|${prod}`];   // humanBody.appearanceFor(id, record) — the runtime path
    const strip = ({ mountSpec, ...m }) => m; expect(rt.ok).toBe(true);
    expect(strip(rt)).toEqual(strip(results[f.name].evidence.mounted));   // every mounted measurement, incl. the 12-view closure, identical
  }, T);
  it("a mount changed after the gate is refused (and changes the binding)", () => {
    const g = passed(), d = fs.mkdtempSync(path.join(os.tmpdir(), "hb-prod-"));
    expect(() => promoteCandidate({ who: f.appearanceId, file: f.identityFile, gateResult: { ...g, validatedMount: { ...g.validatedMount, scale: g.validatedMount.scale + 0.01 } }, prodDir: d, manifestFile: null, mountsFile: path.join(d, "m.json") })).toThrow(/mount/);
    expect(() => promoteCandidate({ who: f.appearanceId, file: f.identityFile, gateResult: { ...g, validatedMount: { ...g.validatedMount, pitchDeg: 5 } }, prodDir: d, manifestFile: null, mountsFile: path.join(d, "m.json") })).toThrow(/mount/);
    expect(fs.existsSync(path.join(d, "m.json"))).toBe(false);
  });
});
