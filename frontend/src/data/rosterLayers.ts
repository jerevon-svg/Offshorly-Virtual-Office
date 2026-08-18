import { ASSET_PATH_TO_SRC, bonLayer, characterLayers, rooms } from "./office-layout";
import { seatsForRoomId } from "./roomSeats";
import { SEAT_DIRECTIONS } from "./seatDirections";
import { SPRITE_SET_BY_AVATAR_ID, characterSprite } from "./bonWalkFrames";
import { PLACEHOLDER_SPRITE_SET } from "../services/avatar/placeholder";
import type { AssetLayer } from "../types/office";
import type { OfficePerson } from "../services/office/floorMerge";

// Sentinel `path` used for roster people with no registry-mapped avatar
// (avatarId null or unrecognized). rosterSrcById resolves this to the
// faceless placeholder sprite instead of ASSET_PATH_TO_SRC, which has no
// entry for it — see Bon's screenshot regression: unmapped people must NOT
// silently fall back to Bon's art.
export const PLACEHOLDER_LAYER_PATH = "__placeholder_avatar__";

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
  const placeholderSrc = characterSprite(PLACEHOLDER_SPRITE_SET, "idle", "front");
  for (const layer of layers) {
    // Seated on a real hand-painted chair (sitDirection set by
    // officePeopleToLayers below): resolve through the same
    // characterSprite() selector the live player uses, picking that
    // person's own sprite set (or the placeholder set for anyone with no
    // registry-mapped sprite set) and the seat's FIXED facing direction —
    // never the manifest's hardcoded front-sit portrait.
    if (layer.sitDirection) {
      const set = layer.avatarId ? SPRITE_SET_BY_AVATAR_ID[layer.avatarId] : undefined;
      map[layer.id] = characterSprite(set ?? PLACEHOLDER_SPRITE_SET, "sitType", layer.sitDirection);
      continue;
    }
    if (layer.path === PLACEHOLDER_LAYER_PATH) {
      map[layer.id] = placeholderSrc;
      continue;
    }
    const src = ASSET_PATH_TO_SRC[layer.path];
    if (src) map[layer.id] = src;
  }
  return map;
}

// Groups people by room and sorts each group by email — a stable identity
// that never reshuffles who sits where across re-renders/reorderings of the
// upstream roster array, unlike array order (which the API/merge is free to
// change call to call).
function groupByRoomSortedByEmail(people: OfficePerson[]): Map<string, OfficePerson[]> {
  const byRoom = new Map<string, OfficePerson[]>();
  for (const person of people) {
    const list = byRoom.get(person.roomId);
    if (list) list.push(person);
    else byRoom.set(person.roomId, [person]);
  }
  for (const list of byRoom.values()) {
    list.sort((a, b) => a.email.localeCompare(b.email));
  }
  return byRoom;
}

export function officePeopleToLayers(people: OfficePerson[]): AssetLayer[] {
  const peopleByRoom = groupByRoomSortedByEmail(people);

  // Seating for the OVERFLOW remainder only (people beyond the room's real
  // painted chairs) depends on how many of THOSE there are, per room — it
  // cannot be decided one person at a time, same reasoning as before.
  const overflowSeatingByRoom = new Map<string, RoomSeating | null>();
  for (const [roomId, roomPeople] of peopleByRoom) {
    const seatCount = seatsForRoomId(roomId).length;
    const overflowCount = Math.max(0, roomPeople.length - seatCount);
    overflowSeatingByRoom.set(roomId, overflowCount > 0 ? roomSeating(roomId, overflowCount) : null);
  }

  const layers: AssetLayer[] = [];

  for (const [roomId, roomPeople] of peopleByRoom) {
    const room = roomsById.get(roomId);
    if (!room) continue;

    const seats = seatsForRoomId(roomId);
    const seatedCount = Math.min(roomPeople.length, seats.length);
    const overflowSeating = overflowSeatingByRoom.get(roomId);

    let overflowIndex = 0;

    roomPeople.forEach((person, i) => {
      // Unmapped avatarId (null, or not found in the manifest) renders the
      // faceless placeholder sprite rather than silently defaulting to
      // Bon's art — see Bon's screenshot regression (roster room full of
      // "Bon" placeholders). Seat/geometry logic below is unchanged; only
      // the art source differs.
      const mappedArt = person.avatarId ? artByAvatarId.get(person.avatarId) : undefined;
      const art = mappedArt
        ? { path: mappedArt.path, imgCrop: mappedArt.imgCrop }
        : { path: PLACEHOLDER_LAYER_PATH, imgCrop: null };

      let position: { x: number; y: number };
      let width: number;
      let height: number;
      // Set for BOTH a real painted-chair seat and the packed-grid overflow
      // fallback below — overflow people have no real seat coordinates to
      // look up a per-seat override for, so they resolve the room's default
      // direction instead (falling through to "front" when the room has no
      // default either), rather than being left undefined and silently
      // rendered with the manifest's static front-sit portrait regardless of
      // any seatDirections.ts entry.
      let sitDirection: AssetLayer["sitDirection"];
      let furnitureId: AssetLayer["furnitureId"];

      if (i < seatedCount) {
        // Real painted chair: center the sprite on the seat centroid, and
        // carry the seat's fixed facing direction so rosterSrcById renders
        // the correct directional sit pose instead of the hardcoded
        // front-sit manifest portrait.
        const seat = seats[i];
        width = SEAT_WIDTH;
        height = SEAT_HEIGHT;
        position = { x: seat.x - width / 2, y: seat.y - height / 2 };
        sitDirection = seat.direction;
        // Only populated for the 4 manifest-driven rooms (see Seat.furnitureId)
        // — undefined for the other 6 rooms' flood-fill seats, which is fine:
        // the back-sit occlusion fix (depthSort.ts) naturally no-ops there.
        furnitureId = seat.furnitureId;
      } else {
        // Overflow: no real chair left for this person, fall back to the
        // existing generic packed-grid logic for just the remainder.
        if (!overflowSeating) return; // shouldn't happen (seatedCount < length implies overflow > 0)
        const index = overflowIndex;
        overflowIndex += 1;

        const column = index % overflowSeating.columns;
        const row = Math.floor(index / overflowSeating.columns);
        width = overflowSeating.seatWidth;
        height = overflowSeating.seatHeight;
        position = {
          x: room.x + ROOM_PADDING_X + column * (width + SEAT_GAP_X),
          y: room.y + ROOM_PADDING_TOP + row * (height + SEAT_GAP_Y),
        };
        sitDirection = SEAT_DIRECTIONS[roomId]?.default ?? "front";
      }

      layers.push({
        id: person.email,
        kind: "character",
        path: art.path,
        x: position.x,
        y: position.y,
        width,
        height,
        transform: null,
        name: person.displayName,
        imgCrop: art.imgCrop ?? null,
        // Deliberately not inheriting art.animatable: the walk/idle sprite
        // sets are keyed to the authored character ids, and a borrowed body
        // has no guarantee of a matching frame set. Static portrait until
        // avatar generation covers real people (see rollout plan, D2).
        animatable: false,
        avatarId: person.avatarId,
        sitDirection,
        furnitureId,
      });
    });
  }

  return layers;
}
