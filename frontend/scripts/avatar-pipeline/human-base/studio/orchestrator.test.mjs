// orchestrator.test.mjs — the connected upload → avatar workflow's planner (pure): paid stages never run without approval, a mock is a
// labelled stand-in, stale artifacts re-run, failures stop the flow fail-closed. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/studio/orchestrator.test.mjs
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { plan, STAGES, stateOf } from "./orchestrator.mjs";
import { recordStage, sha256File } from "./provenance.mjs";

const made = [], scratch = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "hb-orch-")); made.push(d); return d; };
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const fresh = () => ({ hasPhoto: true, illustration: { exists: false, fromCurrentPhoto: false, mode: null }, stage0: { exists: false, fresh: false }, qa: { done: false, pass: false, failed: [] },
  meshy: { exists: false, mode: null, forCurrentIllustration: true }, build: { status: "none" }, sheet: { exists: false }, export: { exists: false } });
const withIll = (s, extra = {}) => ({ ...s, illustration: { exists: true, fromCurrentPhoto: true, mode: "real" }, ...extra });

describe("the upload → avatar planner", () => {
  it("a raw photo starts at the PAID illustration stage, which waits for approval — nothing is spent automatically", () => {
    const p = plan(fresh()); expect(p).toMatchObject({ stage: "illustrate", action: "needs-approval" }); expect(p.cost).toMatch(/images\/edits/); });
  it("approved runs it; a mock runs it as a labelled SIMULATED stage", () => {
    expect(plan(fresh(), { approve: { illustrate: true } })).toMatchObject({ stage: "illustrate", action: "run" });
    const m = plan(fresh(), { mock: { illustrate: "fixture.png" } }); expect(m).toMatchObject({ stage: "illustrate", action: "run", mock: "fixture.png" }); expect(m.reason).toMatch(/SIMULATED/); });
  it("an illustration made from an EARLIER photo is redone (association by hash, never by name)", () => {
    expect(plan(withIll(fresh(), { illustration: { exists: true, fromCurrentPhoto: false, mode: "real" } }))).toMatchObject({ stage: "illustrate", action: "needs-approval" }); });
  it("then identity → illustration QA; an implausible illustration blocks the flow before any Meshy spend", () => {
    let s = withIll(fresh()); expect(plan(s)).toMatchObject({ stage: "identity", action: "run" });
    s = { ...s, stage0: { exists: true, fresh: true } }; expect(plan(s)).toMatchObject({ stage: "illustrationQA", action: "run" });
    expect(plan({ ...s, qa: { done: true, pass: false, failed: ["eyes.pairSymmetric"] } })).toMatchObject({ stage: "illustrationQA", action: "blocked" }); });
  it("the Meshy head is paid too: approval or a labelled mock, and it is redone when the illustration changed", () => {
    const s = { ...withIll(fresh()), stage0: { exists: true, fresh: true }, qa: { done: true, pass: true, failed: [] } };
    expect(plan(s)).toMatchObject({ stage: "meshy", action: "needs-approval" }); expect(plan(s, { mock: { meshy: "bon" } })).toMatchObject({ stage: "meshy", action: "run", mock: "bon" });
    expect(plan({ ...s, meshy: { exists: true, mode: "real", forCurrentIllustration: false } })).toMatchObject({ stage: "meshy", action: "needs-approval" }); });
  it("build → sheet → export; a failed automated gate stops the flow (fail closed), a stale candidate is rebuilt", () => {
    const s = { ...withIll(fresh()), stage0: { exists: true, fresh: true }, qa: { done: true, pass: true, failed: [] }, meshy: { exists: true, mode: "real", forCurrentIllustration: true } };
    expect(plan(s)).toMatchObject({ stage: "build", action: "run" }); expect(plan({ ...s, build: { status: "stale" } })).toMatchObject({ stage: "build", action: "run" });
    expect(plan({ ...s, build: { status: "failed", failed: ["FC-BALD-POCKET"] } })).toMatchObject({ stage: "build", action: "blocked" });
    const b = { ...s, build: { status: "awaiting-signoff", failed: [] } }; expect(plan(b)).toMatchObject({ stage: "sheet", action: "run" });
    expect(plan({ ...b, sheet: { exists: true } })).toMatchObject({ stage: "export", action: "run" });
    const done = plan({ ...b, sheet: { exists: true }, export: { exists: true } }); expect(done.action).toBe("complete"); expect(done.reason).toMatch(/sign-offs remain/); });
  it("an uploaded illustration (no photo) skips the paid illustration stage", () => {
    expect(plan({ ...fresh(), hasPhoto: false, illustration: { exists: true, fromCurrentPhoto: true, mode: "uploaded" } })).toMatchObject({ stage: "identity" }); });
  it("covers every stage of the workflow in order", () => { expect(STAGES).toEqual(["illustrate", "identity", "illustrationQA", "meshy", "build", "sheet", "export"]); });
  it("a PHOTO run never treats an old Meshy head (no provenance) as made from its new illustration — no hidden reuse", () => {
    const O = scratch(), M = scratch(), S = `${O}/studio`; fs.mkdirSync(`${S}/uploads`, { recursive: true });
    const photo = `${O}/t1.photo.jpg`, ill = `${S}/uploads/t1.png`, raw = `${M}/t1-head-v1/raw-untouched/t1-head-v1-raw-model.glb`;
    fs.writeFileSync(photo, "PHOTO"); fs.writeFileSync(ill, "ILLUSTRATION"); fs.mkdirSync(path.dirname(raw), { recursive: true }); fs.writeFileSync(raw, "OLD HEAD");
    fs.writeFileSync(`${S}/uploads.json`, JSON.stringify({ t1: { photo } }));
    recordStage("t1", "illustration", { mode: "real", photoSha256: sha256File(photo), outputSha256: sha256File(ill) }, `${S}/provenance`);
    expect(stateOf("t1", { O, M }).meshy.forCurrentIllustration).toBe(false);
    recordStage("t1", "meshy", { mode: "real", illustrationSha256: sha256File(ill) }, `${S}/provenance`);
    expect(stateOf("t1", { O, M }).meshy.forCurrentIllustration).toBe(true);
    // the legacy uploaded-illustration flow (no photo) keeps accepting a head made before provenance existed
    fs.writeFileSync(`${S}/uploads/t2.png`, "UPLOADED"); const raw2 = `${M}/t2-head-v1/raw-untouched/t2-head-v1-raw-model.glb`; fs.mkdirSync(path.dirname(raw2), { recursive: true }); fs.writeFileSync(raw2, "HEAD");
    expect(stateOf("t2", { O, M }).meshy.forCurrentIllustration).toBe(true);
  });
});
