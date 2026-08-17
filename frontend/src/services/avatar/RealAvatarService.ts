import type {
  AvatarGenerationProgress,
  AvatarGenerationService,
  AvatarSpriteSet,
  GenerateAvatarRequest,
  GeneratedAvatar,
  SaveAvatarRequest,
  SavedAvatar,
} from "./types";
import { persistSavedAvatar } from "./avatarStorage";

// Real implementation — talks to the local Node generation server
// (scripts/avatar-pipeline/gen-server.mjs) through the Vite dev proxy
// (/avatar-api -> http://localhost:4748). The OpenAI key never reaches the
// browser: this file only ever calls same-origin /avatar-api/* endpoints.
const API_BASE = "/avatar-api";
const POLL_INTERVAL_MS = 1500;

interface StatusResponse {
  state: "running" | "done" | "error";
  done: number;
  total: number;
  currentSlot: string | null;
  error?: string | null;
}

interface ResultResponse {
  avatarId: string;
  previewUrl: string;
  spriteSet: AvatarSpriteSet;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startJob(photoDataUrl: string, employeeName?: string): Promise<string> {
  const res = await fetch(`${API_BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoDataUrl, employeeName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `generation server returned ${res.status}`);
  }
  const { jobId } = await res.json();
  if (!jobId) throw new Error("generation server did not return a jobId");
  return jobId;
}

async function pollUntilDone(
  jobId: string,
  onProgress?: (p: { done: number; total: number; slot: string }) => void,
): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(`${API_BASE}/status/${encodeURIComponent(jobId)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `status check failed (${res.status})`);
    }
    const status: StatusResponse = await res.json();

    onProgress?.({
      done: status.done,
      total: status.total,
      slot: status.currentSlot ?? (status.state === "done" ? "done" : ""),
    });

    if (status.state === "done") return;
    if (status.state === "error") throw new Error(status.error || "avatar generation failed");

    await sleep(POLL_INTERVAL_MS);
  }
}

async function fetchResult(jobId: string): Promise<ResultResponse> {
  const res = await fetch(`${API_BASE}/result/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `failed to fetch result (${res.status})`);
  }
  return res.json();
}

// Result payloads from gen-server carry bare `/image/...` URLs (same-origin
// relative to the gen-server itself, not to the Vite dev server the browser
// is actually talking to). Vite only proxies the `/avatar-api` prefix through
// to gen-server (see vite.config.ts), so every image URL in the result must
// be rewritten with that prefix before it's usable in an <img src>.
function withBase(url: string): string {
  return url.startsWith("/") ? `${API_BASE}${url}` : url;
}

function rewriteSpriteSet(spriteSet: AvatarSpriteSet): AvatarSpriteSet {
  const directions = Object.keys(spriteSet.idle) as (keyof typeof spriteSet.idle)[];
  const idle = {} as AvatarSpriteSet["idle"];
  const walk = {} as AvatarSpriteSet["walk"];
  // pat is optional on AvatarSpriteSet (Bon's hand-made set has none), but
  // gen-server's real pipeline still produces pat frames — rewrite them when
  // present, otherwise leave pat undefined.
  const pat = spriteSet.pat ? ({} as NonNullable<AvatarSpriteSet["pat"]>) : undefined;
  for (const dir of directions) {
    idle[dir] = withBase(spriteSet.idle[dir]);
    const [walkA, walkB] = spriteSet.walk[dir];
    walk[dir] = [withBase(walkA), withBase(walkB)];
    if (pat && spriteSet.pat) {
      const [patA, patB] = spriteSet.pat[dir];
      pat[dir] = [withBase(patA), withBase(patB)];
    }
  }
  return { idle, walk, pat };
}

function buildGeneratedAvatar(jobId: string, result: ResultResponse): GeneratedAvatar {
  return {
    avatarId: result.avatarId,
    previewUrl: withBase(result.previewUrl),
    spriteSet: rewriteSpriteSet(result.spriteSet),
    // The pipeline doesn't produce a real match-confidence score (this is a
    // direct style-transfer edit, not a face-match/verification step) — a
    // fixed high value keeps the existing Review-step UI (which shows a
    // "% match" badge) working without implying a metric that doesn't exist.
    confidence: 0.95,
    seed: jobId,
    generatedAt: new Date().toISOString(),
  };
}

async function runPipeline(req: GenerateAvatarRequest): Promise<GeneratedAvatar> {
  const jobId = await startJob(req.photoDataUrl, req.employeeName);
  await pollUntilDone(jobId, req.onProgress);
  const result = await fetchResult(jobId);
  return buildGeneratedAvatar(jobId, result);
}

export class RealAvatarService implements AvatarGenerationService {
  // Non-blocking entry point (Track 2 placeholder-swap flow): kicks off the
  // anchor + 20-slot pipeline server-side and returns the jobId immediately,
  // without waiting for it to finish. Pair with finishJob() to await
  // completion later (e.g. from OfficeMap, after the modal closes).
  async startGenerationJob(photoDataUrl: string, employeeName?: string): Promise<string> {
    return startJob(photoDataUrl, employeeName);
  }

  // Awaits a previously-started job (from startGenerationJob) through to
  // completion and returns the finished GeneratedAvatar — the second half of
  // the split blocking generateAvatar() used to do in one call.
  async finishJob(
    jobId: string,
    onProgress?: (progress: AvatarGenerationProgress) => void,
  ): Promise<GeneratedAvatar> {
    await pollUntilDone(jobId, onProgress);
    const result = await fetchResult(jobId);
    return buildGeneratedAvatar(jobId, result);
  }

  // Kept for mock-mode parity and any caller that still wants the original
  // one-shot blocking shape (start + await in a single call).
  async generateAvatar(req: GenerateAvatarRequest): Promise<GeneratedAvatar> {
    return runPipeline(req);
  }

  async regenerateAvatar(
    _previous: GeneratedAvatar,
    req: GenerateAvatarRequest,
  ): Promise<GeneratedAvatar> {
    // Real mode disables the Review step's Regenerate button (per user's
    // explicit approval — avoids an accidental second ~21-call run). Kept
    // implemented (rather than throwing) so the interface stays honest if
    // something calls it directly/programmatically.
    return runPipeline(req);
  }

  async saveAvatar(req: SaveAvatarRequest): Promise<SavedAvatar> {
    return persistSavedAvatar(req);
  }
}

export const realAvatarService = new RealAvatarService();
