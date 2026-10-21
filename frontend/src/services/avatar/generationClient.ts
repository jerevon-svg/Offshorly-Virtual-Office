import { avatarBackendRequest } from "./wardrobeClient";

// REST client for backend/app/routers/avatar_generation.py — the employee's side of photo → character: their own consent for
// THIS photo (by hash) and a read of their own runs and spending. Same base + identity as every VO-backend client; the server
// derives whose consent it is from the session, so nothing here can speak for anyone else.

export type MyGeneration = {
  autospendEnabled: boolean;
  consents: { photoSha256: string; statement: string; attestedAt: string }[];
  spend: { id: string; stage: string; status: string; estimate: number; unit: string | null; reason: { code: string; message: string }[] | null; createdAt: string }[];
  runs: { personId: string; photoSha256: string; stage: string; status: string; artifacts: Record<string, { sha256: string; path: string }>; error: string | null; updatedAt: string }[];
  runsThisMonth: number;
  maxRunsPerMonth: number;
};

/** SHA-256 of the exact bytes that will be uploaded, as lowercase hex */
export async function sha256Hex(file: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("This browser cannot fingerprint the photo — try a current Chrome, Edge or Safari.");
  const digest = await subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** record the employee's own consent that this exact photo is of them and may be used to create their character */
export const recordPhotoConsent = (photoSha256: string): Promise<{ photoSha256: string; statement: string; attestedAt: string }> =>
  avatarBackendRequest("/avatar/generation/consent", { method: "PUT", body: JSON.stringify({ photoSha256, statement: "self-photo-v1" }) });

export const getMyGeneration = (): Promise<MyGeneration> => avatarBackendRequest<MyGeneration>("/avatar/generation/me");
