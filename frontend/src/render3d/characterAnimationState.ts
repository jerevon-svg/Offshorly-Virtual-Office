// Pure animation-state resolution for CharacterCanvas's single-model state
// machine. Kept dependency-free (no THREE import) so it's unit testable
// without a real THREE.js/WebGL context, mirroring angleMath.ts.
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
  // Actively moving along a path — every movement source (right-click,
  // check-in/out, room moves, approach, spatial auto-walk, Ask-to-Join,
  // cluster settling) funnels through the same walk gate (see
  // useCharacterWalk's isWalking / OfficeStage's characterIsWalkingById).
  isWalking: boolean;
  // Seated in a real (painted-chair) seat — see OfficeMap's isSitting.
  isSitting: boolean;
  // Has at least one VISIBLE, NON-MINIMIZED remote DM/group window open via
  // Global Chat (OfficeMap's remoteChatWindows). Self: derived locally and
  // OR'd with the server snapshot; peers: server-broadcast
  // `global_chat_activity` (globalChatActivityClient.ts). A spatial chat
  // window never counts. Only meaningful while seated — standing + Global
  // Chat stays idle.
  isGlobalChatActive: boolean;
  // Member of the active spatial conversation/session (>=2 members) —
  // server-broadcast `spatial_sessions`, surfaced as OfficeStage's
  // talkingCharacterIds. "Panel open" alone is NOT typing.
  isSpatialConversation: boolean;
  // Real keystroke activity in the spatial chat, with the existing idle
  // timeout (ConversationView.onTypingChange / chatService.onTyping ->
  // OfficeStage's typingCharacterIds). Never derived from sent-message
  // history. Ignored unless isSpatialConversation.
  isTyping: boolean;
};

// Resolution order (highest priority first) — locked 2026-08-28:
//   1. Walking — overrides everything until arrival.
//   2. Seated + active Global Chat  -> sitting-answering
//   3. Seated                       -> sit-on-chair-arms
//   4. Spatial conversation + typing -> agree-gesture
//   5. Spatial conversation          -> listening-gesture
//   6. Otherwise                     -> idle-9
export function resolveCharacterAnimState(input: CharacterAnimInput): CharacterAnimState {
  const { isWalking, isSitting, isGlobalChatActive, isSpatialConversation, isTyping } = input;
  if (isWalking) return "walking";
  if (isSitting) return isGlobalChatActive ? "sitting-answering" : "sit-on-chair-arms";
  if (isSpatialConversation) return isTyping ? "agree-gesture" : "listening-gesture";
  return "idle-9";
}
