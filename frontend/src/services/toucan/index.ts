import { mockToucanService } from "./MockToucanService";
import { realToucanService } from "./RealToucanService";
import type { ToucanService } from "./types";

export * from "./types";
export {
  MockToucanService,
  mockToucanService,
  resetMockToucanConversations,
} from "./MockToucanService";
export { RealToucanService, realToucanService, setDevIdentity } from "./RealToucanService";
export { subscribeDelegationEnded, type DelegationEndedEvent } from "./delegationClient";
export {
  applyToucanStatus,
  canApplyToucanStatus,
  type ToucanApplyResult,
  type ToucanStatusEffect,
} from "./applyAction";

export type ToucanMode = "mock" | "real";

// Mirrors services/office/index.ts's switch, with one deliberate difference from
// services/chat/index.ts: mode is NEVER inferred from VITE_CHAT_SOCKET_URL being
// set. Toucan shares that base URL with chat, so inferring would silently flip
// every existing environment (and every test run) from the canned bird to the
// live endpoint. Only an explicit VITE_TOUCAN_MODE=real enables it.
function resolveMode(): ToucanMode {
  return import.meta.env.VITE_TOUCAN_MODE === "real" ? "real" : "mock";
}

export const toucanMode: ToucanMode = resolveMode();

// Singleton picked once at module load from the build-time env var — a static
// bundle has no runtime env, so this cannot be flipped after build.
export const toucanService: ToucanService =
  toucanMode === "real" ? realToucanService : mockToucanService;
