// Character Studio client (DEV-ONLY, 2026-10-13) — the Virtual Office side of the HumanBase Studio bridge.
//
// Every call goes same-origin to /hb-studio (the Vite dev proxy to the local HumanBase Studio) with the employee's OWN VO session
// token and the backend this app is configured with. The Studio asks that backend who the token belongs to and acts only on that
// person: this client never names a person, so it cannot reach anyone else's photo, generated head or records. Paid generation
// is never approved from here — it waits for an admin in HumanBase Studio.
import { apiUrl, getAuthToken } from "../api/client";

export type PipelinePlan = { stage: string | null; action: "run" | "needs-approval" | "blocked" | "complete"; reason: string; cost?: string };
export type { OutfitSlot } from "../../dev/vo3d/avatar/characterRuntime";
export type StudioCandidate = { file: string; tag: string; mount: { scale: number; pitchDeg: number }; bodyPreset: "standard" | "feminine"; automatedPass: boolean; artifactHash: string; pipelineVersion: string; bindingHash: string; builtAt: string };
export type CharacterStatus = {
  personId: string; email: string; approvedAvatar: boolean; records: boolean;
  photo: string | null; photoTrace: string | null; photoTraceJob: string | null;
  pipeline: { status: string; error: string | null; reason?: string | null } | null; plan: PipelinePlan | null; simulated: string[];
  gate: { automatedPass: boolean; failed: string[]; signoff: string[] } | null; candidate: StudioCandidate | null;
};
/** an approved, unpromoted head the Studio may deliver to the office (studio/runtime-avatars.mjs — promotion's checks, no copy) */
export type RuntimeAvatarRecord = { castId: string; email: string | null; file: string; tag: string; head: { artifactHash: string; pipelineVersion: string; mount: { scale: number; pitchDeg: number }; bindingHash: string; validatedAt: string; bodyPreset?: "standard" | "feminine" } };

/** the Character Studio exists only in a dev build, and only when switched on (VITE_CHARACTER_STUDIO=1 — it talks to the local
 *  HumanBase Studio, which other developers do not run). Off, the Profile is exactly the production one. */
export const characterStudioAvailable = (): boolean => import.meta.env.DEV === true && import.meta.env.VITE_CHARACTER_STUDIO === "1";
/** APPROVED-AVATAR DELIVERY ONLY (no Character Studio UI, no outfits): the normal mock VO (`npm run dev:mock`) draws approved,
 *  unpromoted heads from the local runtime-only Studio (`npm run hb:runtime`). Mock mode in a dev build only — never real mode or a
 *  production build; VITE_HUMANBASE_RUNTIME=0 switches it off. With the Studio not running the list is just empty. */
export const runtimeAvatarsAvailable = (): boolean =>
  characterStudioAvailable() || (import.meta.env.DEV === true && import.meta.env.MODE === "mock" && import.meta.env.VITE_HUMANBASE_RUNTIME !== "0");

const BASE = "/hb-studio/api/self";
function headers(extra: Record<string, string> = {}): Record<string, string> {
  const token = getAuthToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), "x-vo-api": apiUrl("").replace(/\/+$/, ""), ...extra };
}
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${BASE}/${path}`, { ...init, headers: headers((init.headers as Record<string, string>) ?? {}) });
  const body = r.headers.get("content-type")?.includes("application/json") ? await r.json() : null;
  if (!r.ok) throw new Error((body as { error?: string } | null)?.error ?? `Character Studio answered ${r.status}`);
  return body as T;
}

export const getCharacterStatus = (): Promise<CharacterStatus> => call<CharacterStatus>("status");
export const uploadCharacterPhoto = (file: Blob, opts: { hair?: string; body?: "standard" | "feminine" } = {}): Promise<CharacterStatus> =>
  // the employee's own statement travels with the photo; the Studio refuses a photo without it and records it against the bytes
  call<CharacterStatus>(`photo?hair=${encodeURIComponent(opts.hair ?? "natural")}&body=${opts.body ?? "standard"}&consent=self-photo-v1`, { method: "POST", body: file });
export const startCharacterPipeline = (): Promise<CharacterStatus> => call<CharacterStatus>("pipeline", { method: "POST" });
/** the approved heads the office may draw at runtime (any verified session; every employee sees these characters anyway) */
export async function getRuntimeAvatars(): Promise<RuntimeAvatarRecord[]> {
  const r = await fetch("/hb-studio/api/runtime/avatars", { headers: headers() });
  if (!r.ok) throw new Error(`Character Studio answered ${r.status}`);
  const body = (await r.json()) as { avatars?: RuntimeAvatarRecord[] };
  return Array.isArray(body.avatars) ? body.avatars : [];
}
/** the photo's face trace (a real MediaPipe read of the uploaded photo), served only to its owner */
export async function fetchPhotoTraceUrl(): Promise<string | null> {
  const r = await fetch(`${BASE}/trace`, { headers: headers() }); if (!r.ok) return null; return URL.createObjectURL(await r.blob());
}

/** where a candidate GLB is served in a dev build (the Vite dev server serves the frontend root) */
export const candidateUrl = (file: string): string => `${import.meta.env.BASE_URL}${file.replace(/^\/+/, "")}`;

/** the honest, human state of the person's generation, derived ONLY from real pipeline events */
export type CreatePhase = "no-photo" | "reading-photo" | "ready-to-generate" | "generating" | "awaiting-approval" | "blocked" | "failed" | "review" | "approved";
export function createPhaseOf(s: CharacterStatus | null): CreatePhase {
  if (!s) return "no-photo";
  if (s.approvedAvatar) return "approved";
  const ps = s.pipeline?.status ?? "";
  if (ps === "running") return "generating";
  // a finished run is only ever "review" with a candidate that passed every automatic check; anything else at the end is a stop
  if (s.plan?.action === "complete") return s.candidate?.automatedPass ? "review" : "blocked";
  // before a generation was ever started, the state is the photo's (the planner already knows the next stage would be paid)
  if (!s.pipeline) return !s.photo ? "no-photo" : s.photoTraceJob === "running" ? "reading-photo" : "ready-to-generate";
  if (ps.startsWith("awaiting-approval:") || s.plan?.action === "needs-approval") return "awaiting-approval";
  if (ps.startsWith("failed")) return "failed";
  if (ps.startsWith("blocked") || ps.startsWith("stuck") || s.plan?.action === "blocked") return "blocked";
  return s.photo ? "ready-to-generate" : "no-photo";
}
