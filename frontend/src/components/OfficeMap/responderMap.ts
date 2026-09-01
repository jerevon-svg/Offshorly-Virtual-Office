// Pure id-space helper for OfficeMap.tsx: remaps a chat-senderId/email-keyed
// map into character LAYER-id key-space. For peer roster layers, layer.id
// already equals their email (rosterLayers.ts keys id on person.email), so
// those pass straight through. The self layer is the one exception: its
// layer.id is playerLayerId/currentUserId (an avatar id like "bon"), never
// the viewer's own chat id (selfChatId, an email) — so its key must be
// remapped from selfChatId to playerLayerId, or the self lookup always
// misses. Used for talkingTextById (overhead sent-text bubbles).
//
// History: this module also held buildCharacterIsResponderById, the
// "recently sent a message" heuristic that used to drive the agree-gesture
// animation. Removed 2026-08-28 — animation now keys off real typing
// (typingCharacterIds) and Global Chat activity, never sent-message history.
export function remapSelfKey<T>(
  map: Record<string, T>,
  selfChatId: string,
  playerLayerId: string,
): Record<string, T> {
  const remapped: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) {
    const layerId = key === selfChatId ? playerLayerId : key;
    remapped[layerId] = value;
  }
  return remapped;
}
