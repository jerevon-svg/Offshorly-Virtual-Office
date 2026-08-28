import { bonLayer } from "../../data/office-layout";
import { mapAtlasToOfficeStatus } from "./status";
import { slotIndexToPosition } from "./lineupSlots";
import type { AssetLayer } from "../../types/office";
import type { OfficePerson } from "../office/floorMerge";
import type { OfflineLineupEntry } from "./offlineLineupClient";

// Phase 2: drives OTHER roster peers' sidewalk placement off Atlas OFFLINE status, not just
// this app's own explicit-checkout signal (Phase 0/1). Pure function, no React/socket
// dependencies — caller (OfficeMap.tsx) supplies peerLayers with self already excluded, the
// live roster (source of Atlas status), and the server-assigned lineup (email -> slot, from
// useOfflineLineup()).
//
// Precedence: a peer who is BOTH Atlas-OFFLINE AND already holds a server-assigned slot (they
// explicitly checked out through this app too) uses the SERVER slot — it's authoritative and
// shared across every client, whereas a client-computed slot for someone the server doesn't
// know about is this client's own best guess. Only peers with no server slot need one computed
// locally, and that computation must be deterministic (same email set -> same slots) across
// every viewer's client, since there's no server round-trip for Atlas-only offline peers.

// Every character sprite in this office shares one footprint (see rosterLayers.ts's
// SEAT_WIDTH/SEAT_HEIGHT and lineupSlots.ts's AVATAR_WIDTH/AVATAR_HEIGHT) — reused here to
// undo any overflow-grid shrinking a peer's seated layer may have had.
const AVATAR_WIDTH = bonLayer.width;
const AVATAR_HEIGHT = bonLayer.height;

// Extracted so movement-sync consumers (OfficeMap.tsx's peer-override
// merge) can apply the EXACT SAME "is this person Atlas-offline" predicate
// this module's own placement logic uses, instead of duplicating (and
// risking drift from) the mapAtlasToOfficeStatus check below. A peer who is
// offline must never render at a synced-movement desk position — see
// applyOfflineLineupPositions's own precedence doc comment.
export function computeOfflineEmailSet(people: OfficePerson[]): Set<string> {
  return new Set(
    people
      .filter((person) => mapAtlasToOfficeStatus(person.status) === "OFFLINE")
      .map((person) => person.email.trim().toLowerCase()),
  );
}

export function applyOfflineLineupPositions(
  peerLayers: AssetLayer[],
  people: OfficePerson[],
  serverLineup: OfflineLineupEntry[],
): AssetLayer[] {
  const offlineEmails = computeOfflineEmailSet(people);

  if (offlineEmails.size === 0) return peerLayers;

  const serverSlotByEmail = new Map<string, number>();
  const takenSlots = new Set<number>();
  for (const entry of serverLineup) {
    const email = entry.email.trim().toLowerCase();
    serverSlotByEmail.set(email, entry.slot);
    takenSlots.add(entry.slot);
  }

  // Offline peers with no server-assigned slot need one computed client-side. Sorted by
  // email (matches rosterLayers.ts's groupByRoomSortedByEmail sort convention) so every
  // client assigns the same slot to the same person, independent of roster array order.
  const needsClientSlot = peerLayers
    .filter((layer) => offlineEmails.has(layer.id.toLowerCase()) && !serverSlotByEmail.has(layer.id.toLowerCase()))
    .sort((a, b) => a.id.localeCompare(b.id));

  const clientSlotByEmail = new Map<string, number>();
  let nextSlot = 0;
  for (const layer of needsClientSlot) {
    while (takenSlots.has(nextSlot)) nextSlot += 1;
    clientSlotByEmail.set(layer.id.toLowerCase(), nextSlot);
    takenSlots.add(nextSlot);
    nextSlot += 1;
  }

  return peerLayers.map((layer) => {
    const email = layer.id.toLowerCase();
    if (!offlineEmails.has(email)) return layer;

    const slot = serverSlotByEmail.get(email) ?? clientSlotByEmail.get(email);
    if (slot === undefined) return layer;

    const position = slotIndexToPosition(slot);
    return {
      ...layer,
      x: position.x,
      y: position.y,
      width: AVATAR_WIDTH,
      height: AVATAR_HEIGHT,
      sitDirection: undefined,
      furnitureId: undefined,
    };
  });
}
