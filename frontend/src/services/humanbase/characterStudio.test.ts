import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({ apiUrl: (p: string) => `http://localhost:8002/${p}`, getAuthToken: () => "tok-123" }));

import { characterStudioAvailable, createPhaseOf, getCharacterStatus, getRuntimeAvatars, type CharacterStatus, type StudioCandidate } from "./characterStudio";

const status = (over: Partial<CharacterStatus> = {}): CharacterStatus => ({
  personId: "newhire", email: "new.hire@offshorly.com", approvedAvatar: false, records: true,
  photo: null, photoTrace: null, photoTraceJob: null, pipeline: null, plan: null, simulated: [], gate: null, candidate: null, ...over,
});
const candidate = (automatedPass = true): StudioCandidate => ({
  file: "scripts/x/newhire-v1.glb", tag: "corr-v1", mount: { scale: 1, pitchDeg: 0 }, bodyPreset: "standard", automatedPass,
  artifactHash: "a", pipelineVersion: "p", bindingHash: "b", builtAt: "2026-10-13T00:00:00Z",
});
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, headers: { get: () => "application/json" }, json: async () => body });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("createPhaseOf — the person's state comes only from real pipeline events", () => {
  it("starts from the photo: none → being read → read", () => {
    expect(createPhaseOf(null)).toBe("no-photo");
    expect(createPhaseOf(status())).toBe("no-photo");
    expect(createPhaseOf(status({ photo: "u.jpg", photoTraceJob: "running" }))).toBe("reading-photo");
    expect(createPhaseOf(status({ photo: "u.jpg", photoTraceJob: "done", photoTrace: "t.png" }))).toBe("ready-to-generate");
  });
  it("a paid stage waits for an admin — it is never shown as generating", () => {
    const s = status({ photo: "u.jpg", pipeline: { status: "awaiting-approval:illustrate", error: null }, plan: { stage: "illustrate", action: "needs-approval", reason: "", cost: "x" } });
    expect(createPhaseOf(s)).toBe("awaiting-approval");
    expect(createPhaseOf(status({ photo: "u.jpg", pipeline: { status: "running", error: null } }))).toBe("generating");
  });
  it("stops are stops: failed, blocked and stuck", () => {
    expect(createPhaseOf(status({ photo: "u.jpg", pipeline: { status: "failed:meshy", error: "x" } }))).toBe("failed");
    expect(createPhaseOf(status({ photo: "u.jpg", pipeline: { status: "blocked:identity", error: null } }))).toBe("blocked");
    expect(createPhaseOf(status({ photo: "u.jpg", pipeline: { status: "stuck:build", error: null } }))).toBe("blocked");
  });
  it("review only with a candidate that passed every automatic check; approved wins over everything", () => {
    const done = { stage: null, action: "complete" as const, reason: "" };
    expect(createPhaseOf(status({ photo: "u.jpg", pipeline: { status: "complete", error: null }, plan: done, candidate: candidate(true) }))).toBe("review");
    expect(createPhaseOf(status({ photo: "u.jpg", pipeline: { status: "complete", error: null }, plan: done, candidate: candidate(false) }))).toBe("blocked");
    expect(createPhaseOf(status({ approvedAvatar: true, pipeline: { status: "running", error: null } }))).toBe("approved");
  });
  it("an interrupted run resumes from where it stopped", () => {
    expect(createPhaseOf(status({ photo: "u.jpg", pipeline: { status: "interrupted", error: null } }))).toBe("ready-to-generate");
  });
});

describe("the client never names a person", () => {
  it("sends only the VO session token and the backend the app is configured with", async () => {
    const f = vi.fn(async () => json(status()));
    vi.stubGlobal("fetch", f);
    await getCharacterStatus();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/hb-studio/api/self/status");
    expect(init.headers).toEqual({ Authorization: "Bearer tok-123", "x-vo-api": "http://localhost:8002" });
  });
  it("reads the runtime-approved heads with the same session headers, and nothing on a refusal", async () => {
    const f = vi.fn(async () => json({ avatars: [{ castId: "newhire", email: "new.hire@offshorly.com", file: "scripts/x.glb", tag: "corr-v1", head: {} }] }));
    vi.stubGlobal("fetch", f);
    expect((await getRuntimeAvatars()).map((a) => a.castId)).toEqual(["newhire"]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/hb-studio/api/runtime/avatars");
    expect(init.headers).toEqual({ Authorization: "Bearer tok-123", "x-vo-api": "http://localhost:8002" });
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "sign in" }, 401)));
    await expect(getRuntimeAvatars()).rejects.toThrow("401");
  });
  it("is off unless switched on in a dev build", () => {
    vi.stubEnv("VITE_CHARACTER_STUDIO", "");
    expect(characterStudioAvailable()).toBe(false);
    vi.stubEnv("VITE_CHARACTER_STUDIO", "1");
    expect(characterStudioAvailable()).toBe(true);
  });
});
