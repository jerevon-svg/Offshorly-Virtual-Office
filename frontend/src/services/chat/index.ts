import { mockChatService } from "./MockChatService";
import { realChatService } from "./RealChatService";
import type { ChatService } from "./types";

export * from "./types";
export { MockChatService, mockChatService } from "./MockChatService";
export { RealChatService, realChatService } from "./RealChatService";

export type ChatMode = "mock" | "real";

function resolveMode(): ChatMode {
  const raw = import.meta.env.VITE_CHAT_MODE;
  return raw === "real" ? "real" : "mock";
}

// Exposed so call sites (e.g. OfficeMap's identity-routing check) can
// branch on mode without re-implementing the env-var check.
export const chatMode: ChatMode = resolveMode();

// Singleton picked once at module load based on the build-time env var —
// mirrors src/services/avatar/index.ts's mock/real switch.
export const chatService: ChatService = chatMode === "real" ? realChatService : mockChatService;
