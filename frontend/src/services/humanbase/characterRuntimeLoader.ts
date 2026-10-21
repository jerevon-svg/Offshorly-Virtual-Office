// CHARACTER RUNTIME LOADER (DEV-ONLY until validated, 2026-10-13) — fills avatar/characterRuntime before the office builds its
// bodies: the approved, unpromoted heads HumanBase Studio may deliver (getRuntimeAvatars) and every employee's saved outfit
// (VO backend /avatar/wardrobes). Bounded and best-effort: it never rejects, never waits longer than LOAD_BUDGET_MS, and with
// Character Studio off (every production build) it resolves at once and changes nothing — the office is exactly what it was.
import { useSyncExternalStore } from "react";
import { avatarIdForEmail } from "../../data/avatarIdentity";
import { characterStudioAvailable, candidateUrl, getRuntimeAvatars, runtimeAvatarsAvailable } from "./characterStudio";
import { getAllOutfits } from "../avatar/wardrobeClient";
import { HUMANBASE_ENABLED } from "../../dev/vo3d/avatar/humanBodyRoster";
import {
  characterRuntimeVersion,
  registerRuntimeAvatars,
  runtimeCastIdForEmail,
  setOutfits,
  subscribeCharacterRuntime,
  type Outfit,
} from "../../dev/vo3d/avatar/characterRuntime";

const LOAD_BUDGET_MS = 2000;
const within = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((res) => setTimeout(() => res(fallback), LOAD_BUDGET_MS))]);

/** the office's cast id for an email: the app's own registry rule first, then the runtime head that email owns */
export const castIdForEmail = (email: string | null | undefined): string | null => avatarIdForEmail(email) ?? runtimeCastIdForEmail(email);

let prepared: Promise<void> | null = null;
/** load once per page; later calls share the same promise */
export function prepareCharacterRuntime(): Promise<void> {
  if (!runtimeAvatarsAvailable()) return Promise.resolve();
  prepared ??= (async () => {
    // saved outfits are Character Studio customization: loaded only with it on (approved-avatar delivery alone wears the defaults)
    const outfitsOn = characterStudioAvailable();
    const [avatars, outfits] = await Promise.all([
      within(getRuntimeAvatars(), []),
      outfitsOn ? within(getAllOutfits(), {} as Record<string, Outfit>) : Promise.resolve({} as Record<string, Outfit>),
    ]);
    registerRuntimeAvatars(
      avatars
        // an owner whose own app identity is SOMEONE ELSE'S character is never handed this one (no cross-employee heads)
        .filter((a) => !a.email || (avatarIdForEmail(a.email) ?? a.castId) === a.castId)
        .map((a) => ({ castId: a.castId, email: a.email, url: candidateUrl(a.file), head: a.head })),
      (id) => HUMANBASE_ENABLED.has(id),
    );
    // outfits are keyed by email on the server; a body is keyed by cast id. An email with no cast id (no character) dresses nobody,
    // and two emails resolving to one cast id is ambiguous — that character keeps its default rather than wear a stranger's choice.
    const byCast = new Map<string, Outfit>(), clash = new Set<string>();
    for (const [email, outfit] of Object.entries(outfits)) {
      const id = castIdForEmail(email); if (!id) continue;
      if (byCast.has(id)) clash.add(id); else byCast.set(id, outfit);
    }
    for (const id of clash) byCast.delete(id);
    setOutfits(byCast);
  })();
  return prepared;
}

/** re-render when the runtime registry changes (the office re-resolves its roster with it) */
export function useCharacterRuntimeVersion(): number {
  return useSyncExternalStore(subscribeCharacterRuntime, characterRuntimeVersion, characterRuntimeVersion);
}

/** load again (a head was just approved while this page was open): the Profile shows it at once; the office's own bodies pick it
 *  up on their next build (the world was built from the earlier answer) */
export function refreshCharacterRuntime(): Promise<void> { prepared = null; return prepareCharacterRuntime(); }

export function resetCharacterRuntimeLoaderForTests(): void { prepared = null; }
