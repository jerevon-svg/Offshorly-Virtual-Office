import { teamRooms } from "./office-layout";
import type { SavedAvatar } from "../services/avatar/types";
import type { AssetLayer } from "../types/office";

// Same footprint as the existing static-portrait NPCs (see officeAssetLayers'
// "character" entries), so saved avatars sit at a consistent scale next to
// alex/arisha/angelo etc.
const CHAR_WIDTH = 20;
const CHAR_HEIGHT = 32;

// Simple grid spread so multiple avatars saved into the same room don't
// stack exactly on top of each other. Wraps after a few columns.
const SPREAD_STEP = 26;
const SPREAD_COLS = 4;

// Builds one "character" AssetLayer per saved avatar, positioned inside its
// chosen team room (from `teamRooms`, itself filtered from office-layout's
// `rooms`). No generator produces a real per-employee spriteSet yet, so most
// avatars fall back to `avatar.previewUrl` — the mock preview portrait
// already produced by the AvatarCreator flow — same as the 19 existing
// static-portrait NPCs. If/when an avatar does carry a `spriteSet`, the
// layer is flagged `animatable` so OfficeMap.tsx can resolve its src through
// characterSprite() instead (idle-front frame only — see that file).
export function savedAvatarsToLayers(avatars: SavedAvatar[]): AssetLayer[] {
  const countByRoom: Record<string, number> = {};

  return avatars.flatMap((avatar) => {
    const room = teamRooms.find((r) => r.id === avatar.roomId);
    if (!room) return []; // unknown/legacy roomId — skip rather than mis-place

    const index = countByRoom[room.id] ?? 0;
    countByRoom[room.id] = index + 1;
    const col = index % SPREAD_COLS;
    const row = Math.floor(index / SPREAD_COLS);

    const cx = room.x + room.width / 2 - CHAR_WIDTH / 2 + col * SPREAD_STEP;
    const cy = room.y + room.height / 2 - CHAR_HEIGHT / 2 + row * SPREAD_STEP;

    const layer: AssetLayer = {
      id: `saved-avatar-${avatar.avatarId}`,
      kind: "character",
      path: "", // no manifest asset — src is resolved via extraCharacterSrcById
      x: cx,
      y: cy,
      width: CHAR_WIDTH,
      height: CHAR_HEIGHT,
      transform: null,
      name: avatar.nickname,
      // Marks whether OfficeMap can resolve this layer's src through
      // characterSprite() (idle-front frame) instead of the static
      // previewUrl portrait. Full walk-cycle animation for NPCs is out of
      // scope for this slice — this only flags the capability.
      animatable: Boolean(avatar.spriteSet),
    };
    return [layer];
  });
}
