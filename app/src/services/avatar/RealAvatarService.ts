import type {
  AvatarGenerationService,
  GenerateAvatarRequest,
  GeneratedAvatar,
  SaveAvatarRequest,
  SavedAvatar,
} from "./types";

// Real implementation placeholder — swap MockAvatarService for this once an
// actual image-generation provider is connected. Every method intentionally
// throws until then.
export class RealAvatarService implements AvatarGenerationService {
  async generateAvatar(_req: GenerateAvatarRequest): Promise<GeneratedAvatar> {
    // TODO(provider): call OpenAI Images / Flux / Stable Diffusion / ComfyUI here
    throw new Error("RealAvatarService not implemented");
  }

  async regenerateAvatar(
    _previous: GeneratedAvatar,
    _req: GenerateAvatarRequest,
  ): Promise<GeneratedAvatar> {
    // TODO(provider): call OpenAI Images / Flux / Stable Diffusion / ComfyUI here
    throw new Error("RealAvatarService not implemented");
  }

  async saveAvatar(_req: SaveAvatarRequest): Promise<SavedAvatar> {
    // TODO(provider): call OpenAI Images / Flux / Stable Diffusion / ComfyUI here
    throw new Error("RealAvatarService not implemented");
  }
}

export const realAvatarService = new RealAvatarService();
