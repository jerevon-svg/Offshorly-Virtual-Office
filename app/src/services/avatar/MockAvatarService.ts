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

// Stand-in "generated" portraits until a real image-generation provider is
// wired up. Cycled by seed so "Regenerate" visibly returns a different one.
const PREVIEW_IMAGES = [alex, arisha, angelo];

export const AVATAR_STORAGE_KEY = "offshorly.avatars";

// Shared read helper — the office map reads the same localStorage-backed list
// to place saved avatars as static character layers in their chosen room.
export function loadSavedAvatars(): SavedAvatar[] {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return [];
  const raw = window.localStorage.getItem(AVATAR_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SavedAvatar[];
  } catch {
    return [];
  }
}

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
    const saved: SavedAvatar = {
      ...req.avatar,
      outfitId: req.outfitId,
      employeeName: req.employeeName,
      nickname: req.nickname,
      roomId: req.roomId,
      savedAt: new Date().toISOString(),
    };

    if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
      const raw = window.localStorage.getItem(AVATAR_STORAGE_KEY);
      const existing: SavedAvatar[] = raw ? (JSON.parse(raw) as SavedAvatar[]) : [];
      existing.push(saved);
      window.localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(existing));
    }

    return saved;
  }
}

export const mockAvatarService = new MockAvatarService();
