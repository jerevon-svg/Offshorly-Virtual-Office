// Live-3D character registry: which avatar ids have an APPROVED, shipped
// set of Meshy-pipeline GLBs eligible to replace the 2D sprite in
// production, subject to the viewer's device tier / crowd budget (see
// OfficeStage.tsx's gating logic and services/render/tierBudgets.ts).
//
// Presence of an entry here means "this character CAN be shown live-3D if
// the viewer's device permits it" — it is the eligibility half of the
// gating decision, not the permission half. This is deliberately separate
// from OfficeStage's dev-only `?live3d=` override map, which exists purely
// to preview NOT-yet-eligible characters (e.g. Alex) without shipping them.
//
// All GLB paths are BASE_URL-relative and live under `public/avatars/` —
// Vite only copies `public/` into a production build (unlike the rest of
// the project root, which `vite dev` happens to also serve, silently
// masking this requirement in dev). Every path here MUST resolve under
// `public/` or it will 404 in a real `vite build`.
//
// Adding employee #2 (once they've gone through the same Meshy pipeline and
// been approved) is a single new entry here — no other code changes.

export type Live3dAssetSet = {
  walkingGlbUrl: string;
  // Optional dedicated idle-pose GLB — see CharacterCanvas.tsx Props doc.
  idleGlbUrl?: string;
  // Optional looping-gesture GLBs (shrug/thinking), shown instead of
  // idle/walking while this character is in an active chat/call — see
  // OfficeStage.tsx's talkingCharacterIds and CharacterCanvas's
  // gestureActive prop.
  shrugGlbUrl?: string;
  thinkingGlbUrl?: string;
  // Fixed offscreen render resolution, matched to this character's
  // office-assets-manifest aspect ratio for a crisp result regardless of
  // the wrapper div's current on-screen (percentage/zoom-scaled) size.
  renderWidth: number;
  renderHeight: number;
};

const BASE = import.meta.env.BASE_URL;

// One entry per avatar id with an approved, shipped live-3D asset set.
// Bon/Jerevon is the only real employee through the pipeline so far.
export const LIVE_3D_CHARACTERS: Record<string, Live3dAssetSet> = {
  // Manifest aspect ratio: width 26.23 / height 37.2.
  bon: {
    walkingGlbUrl: `${BASE}avatars/jerevon/jerevon-basic-walking_glb_url.glb`,
    idleGlbUrl: `${BASE}avatars/jerevon/jerevon-basic-idle.glb`,
    shrugGlbUrl: `${BASE}avatars/jerevon/jerevon-basic-shrug.glb`,
    thinkingGlbUrl: `${BASE}avatars/jerevon/jerevon-basic-thinking.glb`,
    renderWidth: 210,
    renderHeight: 298,
  },
};

export function isLive3dEligible(avatarId: string | null | undefined): boolean {
  return !!avatarId && avatarId in LIVE_3D_CHARACTERS;
}
