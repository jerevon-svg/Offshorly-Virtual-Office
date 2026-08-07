import alex from "../../assets/office/characters/alex.png";
import arisha from "../../assets/office/characters/arisha.png";
import angelo from "../../assets/office/characters/angelo.png";
import type {
  AvatarGenerationService,
  GenerateAvatarRequest,
  GeneratedAvatar,
  SaveAvatarRequest,
  SavedAvatar,
} from "./types";
import { AVATAR_STORAGE_KEY, loadSavedAvatars, persistSavedAvatar } from "./avatarStorage";

// Stand-in "generated" portraits until a real image-generation provider is
// wired up. Cycled by seed so "Regenerate" visibly returns a different one.
const PREVIEW_IMAGES = [alex, arisha, angelo];

// Re-exported for backward compatibility — persistence itself now lives in
// avatarStorage.ts (shared with RealAvatarService) so both services persist
// identically without duplicating the logic.
export { AVATAR_STORAGE_KEY, loadSavedAvatars };

function delay(minMs: number, maxMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));
}

function randomConfidence(): number {
  return Math.round((0.82 + Math.random() * (0.97 - 0.82)) * 100) / 100;
}

let seedCounter = 0;

function nextSeed(): string {
  seedCounter += 1;
  return `seed-${seedCounter}`;
}

function previewForSeed(seed: string): string {
  const index = Number(seed.replace("seed-", "")) % PREVIEW_IMAGES.length;
  return PREVIEW_IMAGES[index];
}

export class MockAvatarService implements AvatarGenerationService {
  async generateAvatar(_req: GenerateAvatarRequest): Promise<GeneratedAvatar> {
    await delay(1200, 2000);
    const seed = nextSeed();
    return {
      avatarId: `avatar-${seed}`,
      previewUrl: previewForSeed(seed),
      confidence: randomConfidence(),
      seed,
      generatedAt: new Date().toISOString(),
    };
  }

  async regenerateAvatar(
    _previous: GeneratedAvatar,
    _req: GenerateAvatarRequest,
  ): Promise<GeneratedAvatar> {
    await delay(1200, 2000);
    const seed = nextSeed();
    return {
      avatarId: `avatar-${seed}`,
      previewUrl: previewForSeed(seed),
      confidence: randomConfidence(),
      seed,
      generatedAt: new Date().toISOString(),
    };
  }

  async saveAvatar(req: SaveAvatarRequest): Promise<SavedAvatar> {
    await delay(500, 800);
    return persistSavedAvatar(req);
  }
}

export const mockAvatarService = new MockAvatarService();
