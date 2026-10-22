// pipeline-contract.test.mjs — THE HUMANBASE PIPELINE CONTRACT (V2, 2026-10-06). Proves the pipeline itself works before it
// is asked to make another employee: fixtures pass / fail on the registry's detectors, nothing un-gated reaches
// production/, activation never branches on a name, and a detector that cannot run is a failure.
// Heavy (real GLBs + the production runtime via vite-node): run on its own —
//   npx vitest run scripts/avatar-pipeline/human-base/pipeline-contract.test.mjs
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APPROVED, BROKEN, GOOD, REPAIRED } from "./fixtures/fixtures.mjs";
import { bindingHashOf, gate, mountedEvidence, sha256 } from "./gate.mjs";
import { APPROVABLE_CLASSES, approvalCovers, evaluate, FROZEN, GRANDFATHERED, PRODUCTION_MOTION_BAND, REGISTRY, REPORT_ONLY, reportOnly, repairsFor, SIGNOFF_CLASSES } from "./failure-registry.mjs";
/** inside the approved five's motion band but above the welded tier (Option A, 2026-10-19) */
const inBandV = (m) => !!m && !(m.pct <= 1 && m.worstPct <= 5) && m.pct <= PRODUCTION_MOTION_BAND.pct && m.worstPct <= PRODUCTION_MOTION_BAND.worstPct;
import { promoteCandidate } from "./build-employees.mjs";
// every temp dir a test makes is removed after the file (they held ~25 MB of GLBs per run and filled the disk)
const made = [], scratch = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const T = 30 * 60_000;
const results = {};
beforeAll(async () => {
  const all = [...APPROVED, ...BROKEN, ...REPAIRED.filter((f) => fs.existsSync(f.identityFile)), ...GOOD];
  // the frozen five are measured at their approved mount; every other fixture the way a candidate is: the automatic mount
  const spec = (f) => (APPROVED.some((a) => a.name === f.name) ? "prod" : "auto");   // (a known-good dev build of an approved employee is a CANDIDATE: auto)
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

describe("12 · the nape closure in motion: automatic when welded, visual review inside the production band, fail above; the approved five are grandfathered by their exact bytes only", () => {
  const ID = "FC-CLOSURE-EXPOSED-IN-MOTION", cls = (name) => results[name].classes.find((c) => c.id === ID);
  const NAPE_REJECTS = ["kael-broken-visible-shred", "lui-broken-visible-shred", "kael-broken-ear-nape", "lui-broken-ears-closure", "jona-broken-hair-cage"];
  // Option A (2026-10-19): above the approved five's band = FAIL; inside it the measure cannot separate them from approved napes, so the
  // rejected ones there go to VISUAL REVIEW — never an automatic pass, never an overall pass without a hash-bound sign-off
  const inBand = (n) => inBandV(cls(n).value);
  for (const n of NAPE_REJECTS) it(`${n} (visually rejected nape) fails it, or — inside the production band — is held for visual review`, () => {
    if (inBand(n)) { expect(cls(n).status).toBe("SIGNOFF-REQUIRED"); expect(results[n].signoffRequired).toContain(ID); expect(results[n].pass).toBe(false); }
    else expect(results[n].failed).toContain(ID); });
  it("the band still FAILS the clearly visible rejects (lui-visible-shred, lui-ears-closure, jona-hair-cage)", () => {
    for (const n of ["lui-broken-visible-shred", "lui-broken-ears-closure", "jona-broken-hair-cage"]) expect(results[n].failed).toContain(ID); });
  it("an in-band head is approvable only for this class, and only while in band", () => {
    expect(APPROVABLE_CLASSES).toContain(ID); expect(SIGNOFF_CLASSES).not.toContain(ID); });
  for (const f of GOOD) it(`${f.name} (welded, accepted nape) passes it`, () => { expect(cls(f.name).status).toBe("PASS"); });
  for (const f of APPROVED) it(`${f.name}: GRANDFATHERED by its exact production bytes (measured, never re-judged), no automated failure`, () => {
    const c = cls(f.name); expect(c.status).toBe("GRANDFATHERED"); expect(c.value.asset).toBe(`production/${f.name}-v1.glb`); expect(c.value.measured.pct).toBeGreaterThan(0); expect(results[f.name].failed).toEqual([]);
    expect(GRANDFATHERED[sha256(f.identityFile)]).toBe(`production/${f.name}-v1.glb`);
  });
  it("the grandfather list is exactly the five production files' current bytes — nothing else", () => {
    expect(Object.keys(GRANDFATHERED).sort()).toEqual(APPROVED.map((f) => sha256(f.identityFile)).sort());
  });
  it("a modified copy of an approved file is gated in full (its bytes differ)", () => {
    const f = APPROVED[0], d = scratch("hb-gf-"), copy = path.join(d, "copy.glb"); fs.copyFileSync(f.identityFile, copy); fs.appendFileSync(copy, "x");
    const r = evaluate(results[f.name].evidence, { artifactHash: sha256(copy) }), c = r.classes.find((x) => x.id === ID);   // no waiver: its measured tier decides (the five sit in the review band)
    expect(c.status).not.toBe("GRANDFATHERED"); expect(r.pass).toBe(false); expect([...r.failed, ...r.signoffRequired]).toContain(ID);
    expect(c.status).toBe(inBandV(c.value) ? "SIGNOFF-REQUIRED" : "FAIL");
  });
  it("grandfathering never waives any other class, and a missing motion measurement fails closed even on a grandfathered file", () => {
    const f = APPROVED[0], h = sha256(f.identityFile), ev = results[f.name].evidence;
    const worse = { ...ev, mounted: { ...ev.mounted, closure: { ...ev.mounted.closure, pct: 50, worstPct: 90 } } }; expect(evaluate(worse, { artifactHash: h }).failed).toContain("FC-CLOSURE-EXPOSED");
    const blind = { ...ev, mounted: { ...ev.mounted, motion: undefined } }; expect(evaluate(blind, { artifactHash: h }).failed).toContain(ID);
  });
});

describe("3 · repaired fixtures (rebuilt from the clean raw by the detector-driven build) pass their classes", () => {
  for (const f of REPAIRED) it.runIf(fs.existsSync(f.identityFile))(`${f.name}: ${f.fixes.join(" + ")} now pass`, () => {
    for (const id of f.fixes) expect(results[f.name].classes.find((c) => c.id === id).status).toBe("PASS");
  });
});

describe("4 · nothing un-gated reaches production/", () => {
  const tmp = () => { const d = scratch("hb-prod-"); return d; };
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
  for (const f of ["build-employees.mjs", "failure-registry.mjs", "failure-detectors.mjs", "gate.mjs", "chibify.mjs", "hair-layers.mjs", "mounted-gate.run.ts", "scalp-backing.mjs", "closure-attachment.mjs", "visibility.mjs", "hair-debris.mjs", "head-closure.mjs", "boundary-fairing.mjs", "underside-sheet.mjs", "underside-weld.mjs", "underside-texture.mjs", "fringe-exact.mjs"]) it(`${f}: no employee name in code`, () => {
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
    const f = BROKEN[1], g = pass(f); delete g.evidence; const d = scratch("hb-prod-");
    expect(() => promoteCandidate({ who: f.appearanceId, file: f.identityFile, gateResult: g, prodDir: d, manifestFile: null })).toThrow(/mounted/);
  });
  it("a file that changed after the gate (re-optimised / edited) is refused", () => {
    const f = BROKEN[1], d = scratch("hb-prod-"), copy = path.join(d, "cand.glb"); fs.copyFileSync(f.identityFile, copy); fs.appendFileSync(copy, "x");
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
  const passingEvidence = () => results["lui-welded-good"].evidence, H = "a".repeat(64), V = "0123456789abcdef";   // an AUTOMATED pass under an arbitrary hash (2026-10-12: approved Bon's nape passes only by its own grandfathered bytes)
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
    for (const c of REGISTRY.filter((x) => !x.signoff && !x.reviewBand)) expect(approvalCovers(all, c.id, { artifactHash: H, pipelineVersion: V, bindingHash: BH })).toBe(false);
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
    const d = scratch("hb-prod-"), mounts = path.join(d, "mounts.json");
    promoteCandidate({ who: f.appearanceId, file: f.identityFile, gateResult: passed(), prodDir: d, manifestFile: null, mountsFile: mounts });
    const rec = JSON.parse(fs.readFileSync(mounts, "utf8"))[f.appearanceId], prod = path.join(d, `${f.appearanceId}-v1.glb`);
    expect(rec.mount).toEqual(results[f.name].validatedMount); expect(rec.artifactHash).toBe(sha256(prod)); expect(rec.bindingHash).toBe(results[f.name].bindingHash);
    const rt = mountedEvidence([[f.appearanceId, prod, `mounts:${mounts}`]])[`${f.appearanceId}|${prod}`];   // humanBody.appearanceFor(id, record) — the runtime path
    const strip = ({ mountSpec, ...m }) => m; expect(rt.ok).toBe(true);
    expect(strip(rt)).toEqual(strip(results[f.name].evidence.mounted));   // every mounted measurement, incl. the 12-view closure, identical
  }, T);
  it("a mount changed after the gate is refused (and changes the binding)", () => {
    const g = passed(), d = scratch("hb-prod-");
    expect(() => promoteCandidate({ who: f.appearanceId, file: f.identityFile, gateResult: { ...g, validatedMount: { ...g.validatedMount, scale: g.validatedMount.scale + 0.01 } }, prodDir: d, manifestFile: null, mountsFile: path.join(d, "m.json") })).toThrow(/mount/);
    expect(() => promoteCandidate({ who: f.appearanceId, file: f.identityFile, gateResult: { ...g, validatedMount: { ...g.validatedMount, pitchDeg: 5 } }, prodDir: d, manifestFile: null, mountsFile: path.join(d, "m.json") })).toThrow(/mount/);
    expect(fs.existsSync(path.join(d, "m.json"))).toBe(false);
  });
});

describe("10 · report-only detectors (2026-10-10) — measured on every build, never part of the verdict", () => {
  const ro = (name, id) => results[name].reportOnly.find((c) => c.id === id);
  for (const f of APPROVED) it(`${f.name}: FC-CLOSURE-THROUGH-HAIR is measured and CLEAR (bind + idle phases)`, () => {
    const c = ro(f.name, "FC-CLOSURE-THROUGH-HAIR"); expect(c.status, JSON.stringify(c.value)).toBe("CLEAR"); expect(c.value.worstPermille).toBeLessThan(5);   // ≥ 3× margin under the 15 ‰ line
  });
  for (const name of ["lui-broken-visible-shred", "lui-broken-ears-closure"]) it(`${name}: closure walled in by hair while idling FIRES — and the verdict is unchanged`, () => {
    const c = ro(name, "FC-CLOSURE-THROUGH-HAIR"); expect(c.status, JSON.stringify(c.value)).toBe("FIRED"); expect(c.value.worstPermille).toBeGreaterThan(30);   // ≥ 2× over the line
    expect(c.value.bindPermille, "the gap only opens in motion").toBeLessThan(15);
    expect(results[name].failed, "report-only findings never fail a class").toEqual(evaluate(results[name].evidence).failed);
  });
  it("a measure without its evidence is NOT-MEASURED, never CLEAR", () => {
    for (const ev of [{}, { mounted: {} }]) for (const c of reportOnly(ev)) expect(c.status).toBe("NOT-MEASURED");
  });
  it("report-only ids never enter the verdict registry", () => {
    for (const d of REPORT_ONLY) { expect(REGISTRY.find((c) => c.id === d.id)).toBeUndefined(); expect(SIGNOFF_CLASSES).not.toContain(d.id); }
    expect(evaluate(results[APPROVED[0].name].evidence).classes.map((c) => c.id)).not.toContain("FC-CLOSURE-THROUGH-HAIR");
  });
});

describe("11 · assembly finishing (2026-10-10): closure attachment, then scalp backing — the optimize-identity order", () => {
  const backed = {}, TMP = scratch("hb-finish-"), LUI = BROKEN.filter((f) => ["lui-broken-visible-shred", "lui-broken-ears-closure"].includes(f.name));
  const KAEL = BROKEN.filter((f) => ["kael-broken-visible-shred", "kael-broken-collar-ears", "kael-broken-ear-nape"].includes(f.name)), log = {};
  const finish = (f, tag = "") => { const mid = path.join(TMP, `${f.name}${tag}.attached.glb`), out = path.join(TMP, `${f.name}${tag}.glb`);
    log[f.name + tag] = execFileSync("node", ["scripts/avatar-pipeline/human-base/closure-attachment.mjs", f.identityFile, mid], { encoding: "utf8" });
    execFileSync("node", ["scripts/avatar-pipeline/human-base/scalp-backing.mjs", mid, out], { encoding: "utf8" }); return out; };
  beforeAll(async () => {
    const set = [...APPROVED, ...LUI, ...KAEL].map((f) => ({ ...f, identityFile: finish(f) })), spec = (f) => (APPROVED.some((a) => a.name === f.name) ? "prod" : "auto");
    const m = mountedEvidence(set.map((f) => [f.appearanceId, f.identityFile, spec(f)]));
    for (const f of set) backed[f.name] = await gate({ ...f, mounted: m[`${f.appearanceId}|${f.identityFile}`] });
  }, T);
  const ro = (r) => r.reportOnly.find((c) => c.id === "FC-CLOSURE-THROUGH-HAIR"), st = (r, id) => r.classes.find((c) => c.id === id);
  for (const f of APPROVED) it(`${f.name}: every verdict unchanged, no new open view into the head, the hair gap stays clear`, () => {
    const measured = (r) => r.classes.map((c) => `${c.id}:${c.status === "GRANDFATHERED" ? (inBandV(c.value.measured) ? "SIGNOFF-REQUIRED" : "FAIL") : c.status}`);   // a grandfathered verdict is its measured tier (only the exact frozen bytes are waived; a finished copy is gated in full)
    expect(measured(backed[f.name])).toEqual(measured(results[f.name]));
    expect(st(backed[f.name], "FC-OPEN-HEAD").value).toEqual(st(results[f.name], "FC-OPEN-HEAD").value); expect(ro(backed[f.name]).status).toBe("CLEAR");
  });
  for (const f of LUI) it(`${f.name}: the gap the idle hair opened is gone (FIRED → CLEAR), verdict unchanged`, () => {
    expect(ro(results[f.name]).status).toBe("FIRED"); expect(ro(backed[f.name]).status, JSON.stringify(ro(backed[f.name]).value)).toBe("CLEAR"); expect(ro(backed[f.name]).value.worstPermille).toBeLessThan(5);
    expect(backed[f.name].failed).toEqual(results[f.name].failed);
  });
  for (const f of KAEL) it(`${f.name}: detached skull-base pieces removed — verdict unchanged, no new open view, less closure exposed`, () => {
    const r = JSON.parse(log[f.name].replace(/^closure attachment: /, "").replace(/ → .*$/s, "")); expect(r.droppedPieces).toBeGreaterThan(0); expect(r.droppedNearestMedian).toBeGreaterThan(r.band); expect(r.keptWorstMedian).toBeLessThanOrEqual(r.band);
    const IMPROVES = "FC-CLOSURE-EXPOSED-IN-MOTION";   // finishing hides closure: the nape-in-motion check may only IMPROVE (FAIL → PASS), never regress; every other verdict unchanged
    expect(results[f.name].failed).toEqual(expect.arrayContaining(backed[f.name].failed)); expect(backed[f.name].failed.filter((id) => id !== IMPROVES)).toEqual(results[f.name].failed.filter((id) => id !== IMPROVES));
    expect(st(backed[f.name], "FC-OPEN-HEAD").value).toEqual(st(results[f.name], "FC-OPEN-HEAD").value);
    expect(st(backed[f.name], "FC-CLOSURE-EXPOSED").value.pct).toBeLessThan(st(results[f.name], "FC-CLOSURE-EXPOSED").value.pct);
  });
  it("the approved five and Lui's attached closure lose nothing (every piece within the construction band)", () => {
    for (const f of [...APPROVED, LUI.find((x) => x.name === "lui-broken-visible-shred")]) { const r = JSON.parse(log[f.name].replace(/^closure attachment: /, "").replace(/ → .*$/s, "")); expect(r.dropped, f.name).toBe(0); expect(r.keptWorstMedian, f.name).toBeLessThan(r.band); }
  });
  it("scalp backing conserves geometry: closure + cap triangles moved (none added or lost), every other part byte-identical, deterministic", async () => {
    const { NodeIO } = await import("@gltf-transform/core"), { ALL_EXTENSIONS } = await import("@gltf-transform/extensions"), draco3d = (await import("draco3dgltf")).default;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
    const f = LUI[0], a = (await io.read(path.join(TMP, `${f.name}.attached.glb`))).getRoot(), b = (await io.read(path.join(TMP, `${f.name}.glb`))).getRoot();
    const tris = (r, names) => names.flatMap((n) => { const p = r.listMeshes().find((m) => m.getName() === n).listPrimitives()[0], P = p.getAttribute("POSITION").getArray(), I = p.getIndices().getArray(), o = [];
      for (let t = 0; t < I.length; t += 3) o.push([I[t], I[t + 1], I[t + 2]].map((v) => `${P[v * 3].toFixed(5)},${P[v * 3 + 1].toFixed(5)},${P[v * 3 + 2].toFixed(5)}`).join("|")); return o; }).sort();
    const both = ["baked_interior", "identity_hair_base"]; expect(tris(b, both)).toEqual(tris(a, both)); expect(tris(b, ["baked_interior"]).length).toBeLessThan(tris(a, ["baked_interior"]).length);
    for (const m of a.listMeshes()) if (!both.includes(m.getName())) for (const s of m.listPrimitives()[0].listSemantics()) expect(Array.from(b.listMeshes().find((x) => x.getName() === m.getName()).listPrimitives()[0].getAttribute(s).getArray()), `${m.getName()} ${s}`).toEqual(Array.from(m.listPrimitives()[0].getAttribute(s).getArray()));
    expect(sha256(finish(f, ".again"))).toBe(sha256(path.join(TMP, `${f.name}.glb`)));
  });
  it("never overwrites: an existing output is refused by both steps", () => {
    for (const s of ["closure-attachment.mjs", "scalp-backing.mjs"]) expect(() => execFileSync("node", [`scripts/avatar-pipeline/human-base/${s}`, LUI[0].identityFile, path.join(TMP, `${LUI[0].name}.glb`)], { stdio: "pipe" })).toThrow();
  });
});

describe("12 · the finishing steps stay tied to what they mirror", () => {
  it("welded underside motion-class guard: only rigid / short hair is welded, medium / long styles keep the existing closure, off means never", async () => {
    const { CHIBI_RULES, weldEligible } = await import("./chibify.mjs"), on = { ...CHIBI_RULES, weldedUnderside: true };
    for (const m of ["rigid", "short", undefined]) expect(weldEligible(on, m)).toBe(true);
    for (const m of ["medium", "long"]) expect(weldEligible(on, m)).toBe(false);
    expect(weldEligible({ ...on, weldedUnderside: false }, "short")).toBe(false);
  });
  it("closure band = chibify's construction offsets + optimize-identity's interior decimation tolerance", async () => {
    const { CLOSURE_BAND } = await import("./closure-attachment.mjs"), { CHIBI_RULES } = await import("./chibify.mjs");
    expect(CLOSURE_BAND.skullBaseInset).toBe(CHIBI_RULES.attach.skullBaseInset); expect(CLOSURE_BAND.interiorMargin).toBe(CHIBI_RULES.interior.margin); expect(CLOSURE_BAND.donorInset).toBe(CHIBI_RULES.interior.alexInset);
    expect(fs.readFileSync("scripts/avatar-pipeline/human-base/optimize-identity.mjs", "utf8")).toMatch(new RegExp(`mesh\\("baked_interior"\\); if \\(inn\\) simplifyPrimitive\\(inn, \\{[^}]*error: ${CLOSURE_BAND.interiorDecimation}\\b`));
  });
  it("the rest-visibility views are the mounted gate's WALL_VIEWS", async () => {
    const { REST_VIEWS } = await import("./visibility.mjs"), { WALL_VIEWS } = await import("../../../src/dev/vo3d/human/gate/mountedGate.ts"); expect(REST_VIEWS).toEqual(WALL_VIEWS);
  });
});
