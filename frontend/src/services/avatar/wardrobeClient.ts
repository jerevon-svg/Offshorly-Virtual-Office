import { getAuthToken } from "../api/client";
import type { Outfit } from "../../dev/vo3d/avatar/characterRuntime";

// REST client for backend/app/routers/avatar_wardrobe.py — an employee's saved HumanBase outfit (Character Studio EDIT).
//
// The convention every VO-backend client follows (services/attendance/RealAttendanceService.ts, office/experienceCatalog.ts):
// base URL from VITE_CHAT_SOCKET_URL, identity from the dev header when one is set and the bearer token otherwise. The server
// derives WHO from that identity — nothing here names a person, so a save can only ever change the caller's own character.

export type Wardrobe = { nickname: string | null; outfit: Outfit; updatedAt?: string | null };

/** DEV-ONLY, identical to the other VO-backend clients: the bypassed auth gate seeds this (auth/useAuthGate). The backend
 *  honours it only when APP_ENV is development (app/auth/deps.py). */
let devEmail: string | null = null;
export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
}

function backendBase(): string | null {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  return raw ? raw.replace(/\/+$/, "") : null;
}
function identityHeaders(): Headers | null {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (devEmail) { headers.set("x-dev-email", devEmail); return headers; }
  const token = getAuthToken();
  if (!token) return null;
  headers.set("Authorization", `Bearer ${token}`);
  return headers;
}
/** one request to the office backend as the signed-in employee (shared by the avatar clients: wardrobe + generation) */
export async function avatarBackendRequest<T>(path: string, init: RequestInit = {}, failure?: string): Promise<T> {
  return request<T>(path, init, failure);
}
async function request<T>(path: string, init: RequestInit = {}, failure?: string): Promise<T> {
  const base = backendBase(), headers = identityHeaders();
  if (!base) throw new Error("The office backend is not configured (VITE_CHAT_SOCKET_URL).");
  if (!headers) throw new Error("Sign in to the Virtual Office first.");
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown; error?: string };
    throw new Error(typeof body.detail === "string" ? body.detail : body.error ?? `${failure ?? "The office backend did not answer"} (${res.status}).`);
  }
  return (await res.json()) as T;
}

/** the caller's own saved wardrobe ({nickname: null, outfit: {}} when never edited) */
export const getMyWardrobe = (): Promise<Wardrobe> => request<Wardrobe>("/avatar/wardrobe/me");
/** save the caller's own wardrobe — garments and nickname only; no head is regenerated */
export const saveMyWardrobe = (w: Wardrobe): Promise<Wardrobe> =>
  request<Wardrobe>("/avatar/wardrobe/me", { method: "PUT", body: JSON.stringify({ nickname: w.nickname, outfit: w.outfit }) }, "Saving your character failed");
/** every saved outfit, keyed by email, for dressing the office's bodies. NEVER throws: any failure is "nobody has one". */
export async function getAllOutfits(): Promise<Record<string, Outfit>> {
  try {
    const r = await request<{ outfits?: Record<string, Outfit> }>("/avatar/wardrobes");
    return r.outfits && typeof r.outfits === "object" ? r.outfits : {};
  } catch {
    return {};
  }
}
