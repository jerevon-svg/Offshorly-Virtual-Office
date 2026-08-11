import { mockAvatarService } from "./MockAvatarService";
import { realAvatarService } from "./RealAvatarService";
import type { AvatarGenerationService } from "./types";

export * from "./types";
export { MockAvatarService, mockAvatarService } from "./MockAvatarService";
export { RealAvatarService, realAvatarService } from "./RealAvatarService";

export type GenerationMode = "mock" | "real";

function resolveMode(): GenerationMode {
  const raw = import.meta.env.VITE_AVATAR_GENERATION_MODE;
  return raw === "real" ? "real" : "mock";
}

// Exposed so UI (e.g. ReviewStep's Regenerate button) can branch on mode
// without re-implementing the env-var check.
export const avatarGenerationMode: GenerationMode = resolveMode();

// Singleton picked once at module load based on the build-time env var.
export const avatarService: AvatarGenerationService =
  avatarGenerationMode === "real" ? realAvatarService : mockAvatarService;
