import type { RoomPresenceEntry } from "../services/presence/roomPresenceClient";

// Pure DND-room-lock derivation: a room is locked iff at least one of its current live
// occupants is DND (feature spec section 2). Both inputs are already-live client state (the
// room-presence broadcast and the DND-emails broadcast — see roomPresenceClient.ts/dndClient.ts)
// so this needs no extra round trip; it's the same computation the backend's
// app/realtime/socket.py:is_room_locked does server-side for REST authorization, kept in sync
// deliberately so the client's gate (stop at the door) and the server's gate (reject the
// request) never disagree about whether a room is locked.

export function isRoomLocked(roomId: string | null, rooms: RoomPresenceEntry[], dndEmails: Set<string>): boolean {
  if (!roomId) return false;
  const entry = rooms.find((r) => r.roomId === roomId);
  if (!entry) return false;
  return entry.members.some((email) => dndEmails.has(email));
}
