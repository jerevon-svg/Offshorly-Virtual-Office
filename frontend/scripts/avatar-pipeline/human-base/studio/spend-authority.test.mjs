// spend-authority.test.mjs — every paid stage asks first; the local rules hold with or without the backend. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/studio/spend-authority.test.mjs
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { authorityConfig, authorize, failureEvidence, localGuard, MESHY_RESERVE } from "./spend-authority.mjs";

const made = [], scratch = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "hb-spend-")); made.push(d); return d; };
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const A = "a".repeat(64), C = "c".repeat(64), now = Date.parse("2026-10-13T09:00:00Z");
const entry = (over) => ({ who: "newhire", stage: "meshy", inputSha256: A, at: "2026-10-13T08:00:00Z", outcome: null, ...over });
const codes = (ledger, req) => localGuard(ledger, { who: "newhire", stage: "meshy", inputSha256: A, balance: 587, now, ...req }).map((f) => f.code);

describe("local spend rules (always on)", () => {
  it("allow a first paid attempt with balance above the reserve", () => { expect(codes([], {})).toEqual([]); });
  it("one paid job at a time; a stale reservation stops blocking", () => {
    expect(codes([entry({ inputSha256: C })], {})).toEqual(["in_flight"]);
    expect(codes([entry({ inputSha256: C, at: "2026-10-12T20:00:00Z" })], {})).toEqual([]);
  });
  it("never pay twice for the same input; one paid attempt per input unless a NAMED approver rerolls", () => {
    expect(codes([entry({ outcome: "succeeded" })], {})).toEqual(["already_generated"]);
    expect(codes([entry({ outcome: "failed" })], {})).toEqual(["retry_cap"]);
    expect(codes([entry({ outcome: "failed" })], { allowReroll: true })).toEqual(["retry_cap"]);                 // no approver named
    expect(codes([entry({ outcome: "failed" })], { allowReroll: true, approvedBy: "Bon" })).toEqual([]);
    expect(codes([entry({ outcome: "failed", inputSha256: C })], {})).toEqual([]);                              // a new input is a new attempt
  });
  it("Meshy never spends below the reserve, and an unreadable balance fails closed", () => {
    expect(codes([], { balance: null })).toEqual(["balance_unknown"]);
    expect(codes([], { balance: MESHY_RESERVE + 29 })).toEqual(["low_balance"]);
    expect(localGuard([], { who: "newhire", stage: "illustrate", inputSha256: A, balance: null, now })).toEqual([]);   // no balance API for OpenAI
  });
});

describe("the backend authority", () => {
  it("is configured only with a URL and an executor key (env, else backend/.env) — and never exposes the key", () => {
    const d = scratch(), f = path.join(d, ".env"); fs.writeFileSync(f, "OTHER=1\nAVATAR_EXECUTOR_KEY=secret-from-file\n");
    expect(authorityConfig({ env: {}, backendEnvFile: f })).toBeNull();
    expect(authorityConfig({ env: { HB_SPEND_AUTHORITY_URL: "http://localhost:8002/" }, backendEnvFile: f })).toEqual({ url: "http://localhost:8002", key: "secret-from-file" });
    expect(authorityConfig({ env: { HB_SPEND_AUTHORITY_URL: "http://x", HB_EXECUTOR_KEY: "k" }, backendEnvFile: path.join(d, "none") })).toEqual({ url: "http://x", key: "k" });
  });
  it("an unreachable or erroring authority is a refusal (fail closed), never a pass", async () => {
    const cfg = { url: "http://authority", key: "k" };
    const down = await authorize(cfg, {}, { fetchFn: async () => { throw new Error("ECONNREFUSED"); } });
    expect(down.allowed).toBe(false); expect(down.failures[0].code).toBe("authority_unreachable");
    const err = await authorize(cfg, {}, { fetchFn: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
    expect(err.allowed).toBe(false);
    let sent; const ok = await authorize(cfg, { stage: "meshy" }, { fetchFn: async (url, init) => { sent = { url, init }; return { ok: true, status: 200, json: async () => ({ allowed: true, recordId: "r1", failures: [] }) }; } });
    expect(ok).toEqual({ allowed: true, recordId: "r1", failures: [] });
    expect(sent.url).toBe("http://authority/avatar/generation/authorize"); expect(sent.init.headers["x-avatar-executor-key"]).toBe("k");
  });
});

describe("failure evidence", () => {
  it("keeps the exit code, a bounded log tail and the gate's own verdict", () => {
    const d = scratch(), log = path.join(d, "job.log"); fs.writeFileSync(log, Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n"));
    const e = failureEvidence({ exitCode: 1, log, report: { automatedPass: false, failed: ["FC-SKIN-FLAP"], signoffRequired: ["FC-EAR-BOUNDARY"] } });
    expect(e.exitCode).toBe(1); expect(e.logTail.split("\n")).toHaveLength(20); expect(e.logTail.endsWith("line 59")).toBe(true);
    expect(e.report).toEqual({ automatedPass: false, failed: ["FC-SKIN-FLAP"], signoffRequired: ["FC-EAR-BOUNDARY"], failedViews: null });
  });
});
