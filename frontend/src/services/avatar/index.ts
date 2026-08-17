import { mockAvatarService } from "./MockAvatarService";
import { realAvatarService } from "./RealAvatarService";
import type { AvatarGenerationService } from "./types";

export * from "./types";
export { MockAvatarService, mockAvatarService } from "./MockAvatarService";
export { RealAvatarService, realAvatarService } from "./RealAvatarService";

export type GenerationMode = "mock" | "real";

// Avatar generation is hard-disabled: Bon replaced AI-generated sprites with
// hand-made ones, and the "real" path calls a paid image-generation API.
// resolveMode() always returns "mock" regardless of VITE_AVATAR_GENERATION_MODE
// so the paid path can't be flipped on by an env var alone — RealAvatarService
// is kept (types/exports intact) in case generation needs to be re-enabled
// deliberately in code later, but it is not reachable via this singleton.
function resolveMode(): GenerationMode {
  return "mock";
}

// Exposed so UI (e.g. ReviewStep's Regenerate button) can branch on mode
// without re-implementing the env-var check.
export const avatarGenerationMode: GenerationMode = resolveMode();

// Singleton picked once at module load based on the build-time env var.
export const avatarService: AvatarGenerationService =
  avatarGenerationMode === "real" ? realAvatarService : mockAvatarService;
