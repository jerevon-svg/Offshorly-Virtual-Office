import { mockChatService } from "./MockChatService";
import type { ChatService } from "./types";

export * from "./types";
export { MockChatService, mockChatService } from "./MockChatService";

// Phase 3 swaps this line to pick between mock/real like avatarService does.
export const chatService: ChatService = mockChatService;
