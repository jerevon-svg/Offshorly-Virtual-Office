import { ASSET_PATH_TO_SRC, bonLayer, characterLayers, rooms } from "./office-layout";
import type { AssetLayer } from "../types/office";
import type { OfficePerson } from "../services/office/floorMerge";

// Turns a live roster into positioned canvas layers.
//
// This is the seam that lets real people render without touching the
// drawing pipeline: OfficeMap, depthSort and RoomSidebar all consume
// AssetLayer[], so producing AssetLayer[] from OfficePerson[] means none of
// them need to learn about Atlas at all.
//
// Positions are COMPUTED, not authored. The manifest gives every hand-drawn
// character a fixed x/y, but a real roster has an unknown number of people
// per room, so each mapped room gets a simple packed grid inside its rect.

// Keeps bodies clear of the room's own walls/label art. Tuned against the
// room rects in office-layout.ts, not measured from the sprites.
const ROOM_PADDING_X = 24;
const ROOM_PADDING_TOP = 72;
const ROOM_PADDING_BOTTOM = 16;
const SEAT_GAP_X = 12;
const SEAT_GAP_Y = 8;

const roomsById = new Map(rooms.map((room) => [room.id, room]));
const artByAvatarId = new Map(characterLayers.map((layer) => [layer.id, layer]));

// Every seated person is drawn at the same size — the manifest's own
// character footprint — so a room of real people reads as one cast rather
// than a size-jumble of whatever each source sprite happens to measure.
const SEAT_WIDTH = bonLayer.width;
const SEAT_HEIGHT = bonLayer.height;

// Bodies shrink to fit a crowded room rather than spilling through its
// walls. At today's headcount this never actually triggers — the sprites
// are ~26px wide in a 1440x1244 frame, so even the largest team (AI Team,
// 18 people) fits its room at full size with room to spare. It exists as a
// bound: headcount grows, and the failure mode without it is bodies drawn
// through walls, which is much harder to notice than slightly small people.
// Scale is per-room, so one crowded room never shrinks a quiet one.
const MIN_SEAT_SCALE = 0.45;
const SEAT_SCALE_STEP = 0.05;

interface RoomSeating {
  columns: number;
  seatWidth: number;
  seatHeight: number;
  /** True when even MIN_SEAT_SCALE cannot fit everyone. */
  overflows: boolean;
}

function roomSeating(roomId: string, seatCount: number): RoomSeating | null {
  const room = roomsById.get(roomId);
  if (!room) return null;

  const usableWidth = room.width - ROOM_PADDING_X * 2;
  const usableHeight = room.height - ROOM_PADDING_TOP - ROOM_PADDING_BOTTOM;

  // Step down rather than solving analytically: columns is a floor(), so
  // the fit is a step function and the closed form would be wrong at the
  // boundaries.
  for (let scale = 1; scale >= MIN_SEAT_SCALE; scale -= SEAT_SCALE_STEP) {
    const seatWidth = SEAT_WIDTH * scale;
    const seatHeight = SEAT_HEIGHT * scale;
    const columns = Math.max(1, Math.floor(usableWidth / (seatWidth + SEAT_GAP_X)));
    const rows = Math.ceil(seatCount / columns);
    if (rows * (seatHeight + SEAT_GAP_Y) <= usableHeight) {
      return { columns, seatWidth, seatHeight, overflows: false };
    }
  }

  const seatWidth = SEAT_WIDTH * MIN_SEAT_SCALE;
  const seatHeight = SEAT_HEIGHT * MIN_SEAT_SCALE;
  return {
    columns: Math.max(1, Math.floor(usableWidth / (seatWidth + SEAT_GAP_X))),
    seatWidth,
    seatHeight,
    overflows: true,
  };
}

// True when a room cannot hold its people even at the smallest seat size —
// i.e. bodies will render past the room's rect. Exposed so the overflow is
// detectable rather than something you notice as a torso in a wall.
export function seatOverflowsRoom(roomId: string, seatCount: number): boolean {
  return roomSeating(roomId, seatCount)?.overflows ?? false;
}

// One layer per person, positioned in their resolved room.
//
// `id` is the EMAIL, not the sprite id — two people sharing the fallback
// sprite must still be two distinct nodes, or React keys collide and the
// canvas renders one of them. The sprite is carried on `path` (the art
// borrowed from the matched character layer).
//
// People whose room has no rect are dropped, which can only happen if
// roomIdentity resolves to an id that isn't in `rooms` — a bug, not a
// data condition, since resolveRoomId falls back to a real room.
// OfficeStage renders `extraCharacterLayers` from an explicit src map
// rather than ASSET_PATH_TO_SRC — that prop exists for avatars whose image
// is a data URL with no manifest entry. Roster people DO borrow manifest
// art, so this resolves each layer's path back through the same table the
// static cast uses, keyed by the layer id (the person's email).
export function rosterSrcById(layers: AssetLayer[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const layer of layers) {
    const src = ASSET_PATH_TO_SRC[layer.path];
    if (src) map[layer.id] = src;
  }
  return map;
}

export function officePeopleToLayers(people: OfficePerson[]): AssetLayer[] {
  // First pass counts occupancy, because seat size depends on how many
  // people share the room — it cannot be decided one person at a time.
  const countByRoom = new Map<string, number>();
  for (const person of people) {
    countByRoom.set(person.roomId, (countByRoom.get(person.roomId) ?? 0) + 1);
  }

  const seatingByRoom = new Map<string, RoomSeating | null>();
  for (const [roomId, count] of countByRoom) {
    seatingByRoom.set(roomId, roomSeating(roomId, count));
  }

  const seatIndexByRoom = new Map<string, number>();
  const layers: AssetLayer[] = [];

  for (const person of people) {
    const room = roomsById.get(person.roomId);
    const seating = seatingByRoom.get(person.roomId);
    if (!room || !seating) continue;

    const index = seatIndexByRoom.get(person.roomId) ?? 0;
    seatIndexByRoom.set(person.roomId, index + 1);

    const column = index % seating.columns;
    const row = Math.floor(index / seating.columns);
    const position = {
      x: room.x + ROOM_PADDING_X + column * (seating.seatWidth + SEAT_GAP_X),
      y: room.y + ROOM_PADDING_TOP + row * (seating.seatHeight + SEAT_GAP_Y),
    };

    const art = artByAvatarId.get(person.avatarId) ?? bonLayer;

    layers.push({
      id: person.email,
      kind: "character",
      path: art.path,
      x: position.x,
      y: position.y,
      width: seating.seatWidth,
      height: seating.seatHeight,
      transform: null,
      name: person.displayName,
      imgCrop: art.imgCrop ?? null,
      // Deliberately not inheriting art.animatable: the walk/idle sprite
      // sets are keyed to the authored character ids, and a borrowed body
      // has no guarantee of a matching frame set. Static portrait until
      // avatar generation covers real people (see rollout plan, D2).
      animatable: false,
    });
  }

  return layers;
}
