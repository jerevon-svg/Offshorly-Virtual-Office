// THE MESSENGER-STYLE FLOATING CHAT STACK — pure layout, shared by V1's office and the V2 world.
//
// Windows are laid out right-to-left along the bottom edge: an expanded window reserves
// FLOATING_CHAT_EXPANDED_WIDTH, a minimized (header-only) one the narrower MINIMIZED_WIDTH, so
// minimizing or restoring a window shifts everything to its left without overlap.
//
// EXTRACTED, NOT REWRITTEN. Every value and the function body came out of OfficeMap.tsx unchanged. It
// lives here because dev/vo3d's overlay stacks the same windows against the same dock, and a second copy
// of this arithmetic is how the two surfaces end up disagreeing about where a chat window sits.
export const FLOATING_CHAT_EDGE_MARGIN = 16;
export const FLOATING_CHAT_EXPANDED_WIDTH = 320;
export const FLOATING_CHAT_MINIMIZED_WIDTH = 220;
export const FLOATING_CHAT_GAP = 12;

/** Synthetic key for the single spatial ("Character -> Chat") slot in the combined floating layout —
 *  distinct from any real conversationId / peer-email key a remote window could have. */
export const SPATIAL_WINDOW_KEY = "__spatial__";
/** Synthetic key for the Toucan assistant panel's slot in the same layout. */
export const TOUCAN_WINDOW_KEY = "__toucan__";
/** Minimized remote DM/group windows collapse to a circular avatar in a vertical rail (bottom-right).
 *  While the rail has anything in it the horizontal window stack starts to its left. */
export const CHAT_BUBBLE_SIZE = 52;
export const CHAT_BUBBLE_RAIL_GAP = 12;

/** Pure layout pass: given an ordered list (index 0 = rightmost/newest) of {key, minimized}, returns
 *  each key's `right` CSS offset in px so windows stack without overlapping. */
export function computeFloatingChatRightOffsets(
  items: { key: string; minimized: boolean }[],
  baseMargin: number = FLOATING_CHAT_EDGE_MARGIN,
): Map<string, number> {
  const offsets = new Map<string, number>();
  let cursor = baseMargin;
  for (const item of items) {
    offsets.set(item.key, cursor);
    cursor += (item.minimized ? FLOATING_CHAT_MINIMIZED_WIDTH : FLOATING_CHAT_EXPANDED_WIDTH) + FLOATING_CHAT_GAP;
  }
  return offsets;
}
