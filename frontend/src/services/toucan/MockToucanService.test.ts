import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MockToucanService, MOCK_REPLY_DELAY_MS } from "./MockToucanService";
import { toucanMode, toucanService, mockToucanService } from "./index";

// Focused coverage that mock mode's behaviour survived the move out of
// ToucanAssistantPanel.tsx unchanged. The panel's own tests
// (ToucanAssistantPanel.test.tsx) cover the same strings through the UI.

describe("MockToucanService", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  const service = new MockToucanService();

  async function askAfterDelay(question: string, history: { role: "user" | "toucan"; text: string }[] = []) {
    const promise = service.ask({ question, history });
    await vi.advanceTimersByTimeAsync(MOCK_REPLY_DELAY_MS);
    return promise;
  }

  it("greets with the existing demo line", () => {
    expect(service.greeting()).toMatch(/I'm the office toucan/);
    expect(service.greeting()).toMatch(/Demo replies for now/);
  });

  it("returns the keyword reply after the existing 1100ms delay", async () => {
    const answer = await askAfterDelay("hello toucan");
    expect(answer.text).toBe("Hello! Nice to perch beside you.");
  });

  it("rotates fallback replies deterministically by prior user turns", async () => {
    const first = await askAfterDelay("xyzzy");
    const second = await askAfterDelay("xyzzy", [{ role: "user", text: "xyzzy" }]);
    expect(first.text).not.toBe(second.text);
    // Same input, same history -> same reply. No Math.random.
    const repeat = await askAfterDelay("xyzzy");
    expect(repeat.text).toBe(first.text);
  });

  it("rejects with an AbortError when the signal fires", async () => {
    const controller = new AbortController();
    const promise = service.ask({ question: "hello", history: [] }, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("toucan service selection", () => {
  // Re-imported per case so each one observes its own env, rather than the value that happened
  // to be set when this module was first evaluated.
  async function modeFor(value: string | undefined) {
    vi.resetModules();
    if (value === undefined) vi.stubEnv("VITE_TOUCAN_MODE", "");
    else vi.stubEnv("VITE_TOUCAN_MODE", value);
    // Always set, in every environment — the point is that it must not influence the choice.
    vi.stubEnv("VITE_CHAT_SOCKET_URL", "http://localhost:8001");
    const mod = await import("./index");
    return { mode: mod.toucanMode, service: mod.toucanService, mod };
  }

  afterEach(() => vi.unstubAllEnvs());

  it("uses the real service only when VITE_TOUCAN_MODE is exactly 'real'", async () => {
    const real = await modeFor("real");
    expect(real.mode).toBe("real");
    expect(real.service).toBe(real.mod.realToucanService);
  });

  it("defaults to the mock bird when unset or unrecognised, even with a socket URL configured", async () => {
    for (const value of [undefined, "nonsense", "REAL", "Mock"]) {
      const resolved = await modeFor(value);
      expect(resolved.mode).toBe("mock");
      expect(resolved.service).toBe(resolved.mod.mockToucanService);
    }
  });

  it("wires the default singleton to the mock bird under the test env", () => {
    expect(toucanMode).toBe("mock");
    expect(toucanService).toBe(mockToucanService);
  });
});
