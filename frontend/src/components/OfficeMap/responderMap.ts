// Pure helper for OfficeMap.tsx's characterIsResponderById — kept as a
// standalone, dependency-free function so the id-space remap (the exact
// bug this exists to prevent regressing) is unit-testable without
// mounting the full OfficeMap tree. See OfficeStage.tsx's
// characterIsResponderById doc comment for the full context.
//
// talkingTextById is keyed by chat senderId (an email — see OfficeMap's
// handleTalkingMessage, keyed on ChatMessage.senderId). For peer roster
// layers, layer.id already equals their email (rosterLayers.ts keys id on
// person.email), so those pass straight through. The self layer is the
// one exception: its layer.id is playerLayerId/currentUserId (an avatar
// id like "bon"), never the viewer's own chat id (selfChatId, an email) —
// so its key must be remapped from selfChatId to playerLayerId, or the
// self lookup always misses.
export function buildCharacterIsResponderById(
  talkingTextById: Record<string, string>,
  selfChatId: string,
  playerLayerId: string,
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const [senderId, text] of Object.entries(talkingTextById)) {
    if (!text) continue;
    const layerId = senderId === selfChatId ? playerLayerId : senderId;
    map[layerId] = true;
  }
  return map;
}
