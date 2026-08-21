// Pure animation-state resolution for CharacterCanvas's Phase A single-model
// state machine. Kept dependency-free (no THREE import) so it's unit
// testable without a real THREE.js/WebGL context, mirroring angleMath.ts.
//
// Every returned value is exactly one of the 6 clip names baked into the
// consolidated per-character GLB (see build-character-lods.mjs's
// CLIP_SOURCES / MESHY_CLIP_MAPPING.md) — CharacterCanvas looks up an
// AnimationClip by this exact string on the loaded gltf.animations array.

export type CharacterAnimState =
  | "idle-9"
  | "walking"
  | "agree-gesture"
  | "listening-gesture"
  | "sit-on-chair-arms"
  | "sitting-answering";

export const CHARACTER_ANIM_STATES: readonly CharacterAnimState[] = [
  "idle-9",
  "walking",
  "agree-gesture",
  "listening-gesture",
  "sit-on-chair-arms",
  "sitting-answering",
];

export type CharacterAnimInput = {
  // Sprite-path's existing walk-gate (see useCharacterWalk's isWalking).
  isWalking: boolean;
  // Seated in a real (painted-chair) seat — see OfficeMap's isSitting.
  isSitting: boolean;
  // This character is a participant in an active chat/call (see
  // OfficeStage's talkingCharacterIds) — meaningless on its own without
  // isResponder to disambiguate the two chat sub-roles.
  isChatting: boolean;
  // Within an active chat, this character recently sent a message (within
  // the bubble-display window — see OfficeMap's characterIsResponderById /
  // OfficeStage's talkingTextById, cleared ~4500ms after send). This is a
  // heuristic, not a real active-speaker/turn-taking signal: during fast
  // back-and-forth both participants can be isResponder=true at once (both
  // show agree-gesture; listening-gesture may rarely appear) — an accepted
  // interim limitation, not a bug. Ignored when isChatting is false.
  isResponder: boolean;
};

// Resolution order (highest priority first):
//   1. Seated — sitting-answering while responding, else sit-on-chair-arms
//      (covers seated+listening AND seated+idle, there is no dedicated
//      "seated listening" clip).
//   2. Walking (can't be seated and walking at once, so this only matters
//      once seated is ruled out).
//   3. Chatting while standing — agree-gesture for the responder,
//      listening-gesture for the listener.
//   4. Otherwise — idle-9.
export function resolveCharacterAnimState(input: CharacterAnimInput): CharacterAnimState {
  const { isWalking, isSitting, isChatting, isResponder } = input;
  if (isSitting) {
    return isChatting && isResponder ? "sitting-answering" : "sit-on-chair-arms";
  }
  if (isWalking) return "walking";
  if (isChatting) return isResponder ? "agree-gesture" : "listening-gesture";
  return "idle-9";
}
