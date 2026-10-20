// candidate-versions.test.mjs — STEP 0 CONTRACT: builds are versioned and never delete or overwrite an earlier candidate, report,
// review sheet or export. Pure file-system tests in a temp root (the real output/ is never touched). From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/candidate-versions.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assertFresh, current, freshFile, latest, layout, newestSheet, nextTag, reportFor, resolveVersion, versions } from "./candidate-versions.mjs";
// every temp dir a test makes is removed after the file (they held ~25 MB of GLBs per run and filled the disk)
const made = [], scratch = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const tmp = () => scratch("hb-versions-");
/** a finished build of one tag: its final pass file + a report pointing at it (the shape build-employees writes) */
const built = (root, who, tag, { passes = 2 } = {}) => { const L = layout(who, tag, root);
  for (const p of L.passes.slice(0, passes)) { fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(`${p}/${who}-v1.glb`, `glb ${tag} ${p}`); }
  const file = `${L.passes[passes - 1]}/${who}-v1.glb`; fs.writeFileSync(L.report, JSON.stringify({ tag, candidate: file, artifactHash: tag })); return { ...L, file }; };

describe("0 · versioned candidates", () => {
  it("the legacy layouts are version 1 of their kind; the next build gets the next free version", () => {
    const r = tmp(); built(r, "ana", "base"); built(r, "ana", "corr");
    expect(versions("ana", "base", r).map((v) => v.tag)).toEqual(["base"]); expect(versions("ana", "corr", r).map((v) => v.tag)).toEqual(["corr"]);
    expect(nextTag("ana", "corr", r)).toBe("corr-v2"); expect(nextTag("ana", "base", r)).toBe("base-v2");
    expect(nextTag("newcomer", "corr", r)).toBe("corr-v1");   // a new employee starts at v1 (no legacy layout)
  });
  it("versions are ordered numerically, an unfinished version is never reused, and latest() is the newest FINISHED one", () => {
    const r = tmp(); built(r, "ana", "corr"); built(r, "ana", "corr-v2"); built(r, "ana", "corr-v10", { passes: 1 });
    fs.mkdirSync(layout("ana", "corr-v11", r).passes[0], { recursive: true });   // a crashed build: pass folder, no report
    expect(versions("ana", "corr", r).map((v) => v.tag)).toEqual(["corr", "corr-v2", "corr-v10", "corr-v11"]);
    expect(nextTag("ana", "corr", r)).toBe("corr-v12");
    const L = latest("ana", "corr", r); expect(L.tag).toBe("corr-v10"); expect(L.file).toBe(`${layout("ana", "corr-v10", r).passes[0]}/ana-v1.glb`);
    expect(resolveVersion("ana", "corr-v11", r)).toBeNull(); expect(latest("ana", "base", r)).toBeNull();
  });
  it("kinds never mix: corrected versions are invisible to the uncorrected history and vice versa", () => {
    const r = tmp(); built(r, "ana", "base-v3"); built(r, "ana", "corr-v2");
    expect(versions("ana", "base", r).map((v) => v.tag)).toEqual(["base-v3"]); expect(versions("ana", "corr", r).map((v) => v.tag)).toEqual(["corr-v2"]);
  });
  it("versioned exports get their own folder; legacy exports stay where they are", () => {
    const r = tmp(); expect(layout("ana", "corr", r).exportDir).toBe(`${r}/exports/ana`); expect(layout("ana", "corr-v2", r).exportDir).toBe(`${r}/exports/ana/corr-v2`);
  });
  it("invalid tags and ids are refused (no path escapes, no unversioned names)", () => {
    for (const t of ["", "corr-v0", "corr-2", "v2", "../corr-v2", "corr-v2/..", "final"]) expect(() => layout("ana", t)).toThrow(/invalid candidate tag/);
    for (const w of ["", "../x", "Ana", "a/b"]) expect(() => layout(w, "corr")).toThrow(/invalid employee id/);
  });
});

describe("0 · nothing is ever overwritten or deleted", () => {
  it("assertFresh refuses any existing pass folder or report", () => {
    const r = tmp(), L = built(r, "ana", "corr-v2"); expect(() => assertFresh([L.passes[0]])).toThrow(/already exists/); expect(() => assertFresh([L.report])).toThrow(/already exists/);
    expect(() => assertFresh(layout("ana", "corr-v3", r).passes)).not.toThrow();
  });
  it("a review sheet that exists gets a numbered sibling, and the newest one is found", () => {
    const d = tmp(), f = `${d}/ana-pipeline-sheet.png`; expect(freshFile(f)).toBe(f); fs.writeFileSync(f, "1");
    expect(freshFile(f)).toBe(`${d}/ana-pipeline-sheet.2.png`); fs.writeFileSync(`${d}/ana-pipeline-sheet.2.png`, "2"); fs.writeFileSync(`${d}/ana-pipeline-sheet.10.png`, "10");
    expect(freshFile(f)).toBe(`${d}/ana-pipeline-sheet.3.png`); expect(newestSheet(d, "ana")).toBe(`${d}/ana-pipeline-sheet.10.png`); expect(newestSheet(`${d}/none`, "ana")).toBeNull();
  });
  it("no build / Studio script deletes files (source guard)", () => {
    const S = "scripts/avatar-pipeline/human-base";
    for (const f of ["build-employees.mjs", "candidate-versions.mjs", "approve.mjs", "identity-correct.mjs", "scalp-backing.mjs", "closure-attachment.mjs", "visibility.mjs", "hair-debris.mjs", "boundary-fairing.mjs", "underside-sheet.mjs", "underside-weld.mjs", "underside-texture.mjs", "fringe-exact.mjs", "studio/server.mjs", "studio/pipeline-sheet.mjs", "studio/export.mjs"])
      expect(fs.readFileSync(`${S}/${f}`, "utf8"), f).not.toMatch(/\b(rmSync|rmdirSync|unlinkSync|rm\(|unlink\()/);
  });
  it.runIf(fs.existsSync("scripts/avatar-pipeline/output/human-base/candidates/kael/corr-pass1"))("rebuilding an existing version is refused BEFORE any work (real legacy candidate untouched)", async () => {
    const { buildEmployee } = await import("./build-employees.mjs"), C = "scripts/avatar-pipeline/output/human-base/candidates/kael", before = fs.readdirSync(C).sort().join();
    await expect(buildEmployee("kael", { correct: true, tag: "corr" })).rejects.toThrow(/already exists/);
    await expect(buildEmployee("kael", { correct: true, tag: "base-v2" })).rejects.toThrow(/not a corr build/);
    expect(fs.readdirSync(C).sort().join()).toBe(before);
  });
});

describe("0 · a candidate file maps to its own version's report (the lineup page uses the same rule)", () => {
  it("legacy and versioned layouts", () => {
    const C = "scripts/avatar-pipeline/output/human-base/candidates/ana";
    expect(reportFor(`${C}/pass2/ana-v1.glb`)).toBe(`${C}/report.json`); expect(reportFor(`${C}/corr-pass1/ana-v1.glb`)).toBe(`${C}/report.corrected.json`);
    expect(reportFor(`${C}/corr-v2-pass2/ana-v1.glb`)).toBe(`${C}/report.corr-v2.json`); expect(reportFor(`${C}/base-v12-pass1/ana-v1.glb`)).toBe(`${C}/report.base-v12.json`);
    expect(reportFor("scripts/avatar-pipeline/human-base/fixtures/broken/kael-broken-ear-nape.glb")).toBeNull();
    const ts = fs.readFileSync("src/dev/vo3d/human/playground/lineup.ts", "utf8");   // the browser copy of the rule stays identical
    expect(ts).toContain(String.raw`replace(/\/(?:([^/]+)-)?pass\d\/[^/]+$/, (_m: string, t?: string) => (t === undefined ? "/report.json" : t === "corr" ? "/report.corrected.json" : ` + "`/report.${t}.json`))");
  });
});

describe("experimental builds and the CURRENT selection (2026-10-13)", () => {
  const mk = (root, who, tag, report) => { const L = layout(who, tag, root); fs.mkdirSync(L.passes[0], { recursive: true }); fs.writeFileSync(`${L.passes[0]}/${who}-v1.glb`, "x");
    fs.writeFileSync(L.report, JSON.stringify({ builtAt: new Date().toISOString(), ...report })); return L; };

  it("experimental kinds (xbase / xcorr) version on their own and never count as base / corr", () => {
    const root = scratch("cv-x-"); mk(root, "zz", "corr-v1", {}); mk(root, "zz", "xcorr-v1", { head: "v2", experimental: true });
    expect(nextTag("zz", "xcorr", root)).toBe("xcorr-v2");
    expect(nextTag("zz", "corr", root)).toBe("corr-v2");
    expect(versions("zz", "corr", root).map((v) => v.tag)).toEqual(["corr-v1"]);
    expect(layout("zz", "xbase-v3", root).kind).toBe("xbase");
    expect(() => layout("zz", "ycorr-v1", root)).toThrow(/invalid candidate tag/);
  });

  it("current() selects only builds from the accepted head — never a newer build of another head, never an experiment", () => {
    const root = scratch("cv-cur-"); mk(root, "zz", "corr-v1", {}); mk(root, "zz", "corr-v2", { head: "v2" }); mk(root, "zz", "xcorr-v1", { head: "v2", experimental: true });
    expect(latest("zz", "corr", root).tag).toBe("corr-v2");          // history still shows the newer build
    expect(current("zz", "corr", root, "v1").tag).toBe("corr-v1");   // selection does not
    expect(current("zz", "corr", root, "v2").tag).toBe("corr-v2");   // once v2 is the accepted head
    expect(current("zz", "corr", root).tag).toBe("corr-v1");         // a person without a recipe: accepted head v1
    expect(current("zz", "base", root, "v1")).toBeNull();
    expect(() => current("zz", "xcorr", root, "v1")).toThrow(/accepted builds/);
  });
});
