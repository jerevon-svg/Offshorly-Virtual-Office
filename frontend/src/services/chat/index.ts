import { mockChatService } from "./MockChatService";
import { realChatService } from "./RealChatService";
import type { ChatService } from "./types";

export * from "./types";
export { MockChatService, mockChatService } from "./MockChatService";
export { RealChatService, realChatService } from "./RealChatService";

export type ChatMode = "mock" | "real";

// Explicit VITE_CHAT_MODE always wins in both directions (mock or real).
// If it's absent/typo'd, fall back to inferring mode from whether a real
// socket URL is actually configured: a non-empty VITE_CHAT_SOCKET_URL
// implies "real", otherwise "mock". This avoids silently shipping the mock
// chat when someone configures a socket URL but forgets VITE_CHAT_MODE.
// An empty-string or whitespace-only socket URL still counts as "not
// configured" and falls back to mock.
function resolveMode(): ChatMode {
  const raw = import.meta.env.VITE_CHAT_MODE;
  if (raw === "real" || raw === "mock") return raw;
  const socketUrl = import.meta.env.VITE_CHAT_SOCKET_URL;
  return socketUrl && socketUrl.trim() ? "real" : "mock";
}

// Exposed so call sites (e.g. OfficeMap's identity-routing check) can
// branch on mode without re-implementing the env-var check.
export const chatMode: ChatMode = resolveMode();

// Singleton picked once at module load based on the build-time env var —
// mirrors src/services/avatar/index.ts's mock/real switch.
export const chatService: ChatService = chatMode === "real" ? realChatService : mockChatService;
