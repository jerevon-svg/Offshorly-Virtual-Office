import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Guards resolveMode() in ./index — the function that decides mock vs real
// chat at module load. This has shipped a mock chat to production twice
// (VITE_CHAT_MODE unset, socket URL configured) so every branch is a real
// failure mode, not filler. Mirrors RealChatService.test.ts's env-var
// stub/restore pattern.

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

vi.mock("../api/client", () => ({
  getAuthToken: vi.fn(() => "fake-token"),
}));

const originalEnv = { ...import.meta.env };

function setEnv(mode: string | undefined, socketUrl: string | undefined) {
  const env = import.meta.env as Record<string, string | undefined>;
  if (mode === undefined) delete env.VITE_CHAT_MODE;
  else env.VITE_CHAT_MODE = mode;
  if (socketUrl === undefined) delete env.VITE_CHAT_SOCKET_URL;
  else env.VITE_CHAT_SOCKET_URL = socketUrl;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  const env = import.meta.env as Record<string, string | undefined>;
  for (const key of Object.keys(env)) {
    if (!(key in originalEnv)) delete env[key];
  }
  Object.assign(import.meta.env, originalEnv);
});

describe("resolveMode via ./index chatMode", () => {
  it("explicit VITE_CHAT_MODE=real wins regardless of socket URL", async () => {
    setEnv("real", undefined);
    const { chatMode } = await import("./index");
    expect(chatMode).toBe("real");
  });

  it("explicit VITE_CHAT_MODE=mock wins even when a socket URL is set (deliberate override)", async () => {
    setEnv("mock", "http://localhost:4800");
    const { chatMode } = await import("./index");
    expect(chatMode).toBe("mock");
  });

  it("mode unset + socket URL set infers real (the bug this change fixes: no longer silently mocks)", async () => {
    setEnv(undefined, "http://localhost:4800");
    const { chatMode } = await import("./index");
    expect(chatMode).toBe("real");
  });

  it("mode unset + socket URL empty string infers mock", async () => {
    setEnv(undefined, "");
    const { chatMode } = await import("./index");
    expect(chatMode).toBe("mock");
  });

  it("mode unset + whitespace-only socket URL infers mock (guards .trim(), matches frontend/.env.local's empty VITE_* values)", async () => {
    setEnv(undefined, "   ");
    const { chatMode } = await import("./index");
    expect(chatMode).toBe("mock");
  });

  it("mode unset + socket URL absent/undefined infers mock", async () => {
    setEnv(undefined, undefined);
    const { chatMode } = await import("./index");
    expect(chatMode).toBe("mock");
  });

  it("typo'd/garbage VITE_CHAT_MODE falls through to URL inference (real)", async () => {
    setEnv("Real", "http://localhost:4800");
    const { chatMode } = await import("./index");
    expect(chatMode).toBe("real");
  });
});

describe("resolveMode selects the matching chatService singleton", () => {
  it("chatMode=real also binds chatService to the real implementation", async () => {
    setEnv("real", undefined);
    const { chatMode, chatService, realChatService } = await import("./index");
    expect(chatMode).toBe("real");
    expect(chatService).toBe(realChatService);
  });

  it("chatMode=mock also binds chatService to the mock implementation", async () => {
    setEnv("mock", undefined);
    const { chatMode, chatService, mockChatService } = await import("./index");
    expect(chatMode).toBe("mock");
    expect(chatService).toBe(mockChatService);
  });
});
