import { describe, expect, it } from "vitest";
import { applyOfflineLineupPositions } from "./offlineLineupPlacement";
import { slotIndexToPosition } from "./lineupSlots";
import { bonLayer } from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";
import type { OfficePerson } from "../office/floorMerge";
import type { OfflineLineupEntry } from "./offlineLineupClient";

function makeLayer(email: string, overrides: Partial<AssetLayer> = {}): AssetLayer {
  return {
    id: email,
    kind: "character",
    path: "some-path",
    x: 100,
    y: 100,
    width: 10,
    height: 10,
    transform: null,
    name: email,
    avatarId: null,
    sitDirection: "front",
    furnitureId: "chair-1",
    ...overrides,
  };
}

function makePerson(email: string, status: OfficePerson["status"]): OfficePerson {
  return {
    email,
    displayName: email,
    status,
    departmentName: null,
    jobTitle: null,
    currentActivity: null,
    lastMessage: null,
    avatarId: null,
    roomId: "room-1",
  } as OfficePerson;
}

describe("applyOfflineLineupPositions", () => {
  it("places a single Atlas-OFFLINE peer at slot 0 and clears seat fields", () => {
    const layers = [makeLayer("a@x.com")];
    const people = [makePerson("a@x.com", "OFFLINE" as OfficePerson["status"])];
    const result = applyOfflineLineupPositions(layers, people, []);

    const expected = slotIndexToPosition(0);
    expect(result[0].x).toBe(expected.x);
    expect(result[0].y).toBe(expected.y);
    expect(result[0].width).toBe(bonLayer.width);
    expect(result[0].height).toBe(bonLayer.height);
    expect(result[0].sitDirection).toBeUndefined();
    expect(result[0].furnitureId).toBeUndefined();
  });

  it("assigns distinct, non-overlapping slots to multiple simultaneously-offline peers in localeCompare email order", () => {
    const layers = [makeLayer("zed@x.com"), makeLayer("amy@x.com")];
    const people = [
      makePerson("zed@x.com", "OFFLINE" as OfficePerson["status"]),
      makePerson("amy@x.com", "OFFLINE" as OfficePerson["status"]),
    ];
    const result = applyOfflineLineupPositions(layers, people, []);

    const amyLayer = result.find((l) => l.id === "amy@x.com")!;
    const zedLayer = result.find((l) => l.id === "zed@x.com")!;
    // amy sorts before zed, so amy gets slot 0, zed gets slot 1.
    expect({ x: amyLayer.x, y: amyLayer.y }).toEqual(slotIndexToPosition(0));
    expect({ x: zedLayer.x, y: zedLayer.y }).toEqual(slotIndexToPosition(1));
    expect(amyLayer.x === zedLayer.x && amyLayer.y === zedLayer.y).toBe(false);
  });

  it("prefers the server-assigned slot over a client-computed one when both signals apply", () => {
    const layers = [makeLayer("a@x.com")];
    const people = [makePerson("a@x.com", "OFFLINE" as OfficePerson["status"])];
    const serverLineup: OfflineLineupEntry[] = [{ email: "a@x.com", slot: 7 }];
    const result = applyOfflineLineupPositions(layers, people, serverLineup);

    const expected = slotIndexToPosition(7);
    expect(result[0].x).toBe(expected.x);
    expect(result[0].y).toBe(expected.y);
  });

  it("skips a slot already taken by a server-lineup entry when computing a client-only peer's slot", () => {
    const layers = [makeLayer("client-only@x.com")];
    const people = [makePerson("client-only@x.com", "OFFLINE" as OfficePerson["status"])];
    // Someone else (not in peerLayers here, e.g. the viewer) already holds slot 0 server-side.
    const serverLineup: OfflineLineupEntry[] = [{ email: "someone-else@x.com", slot: 0 }];
    const result = applyOfflineLineupPositions(layers, people, serverLineup);

    const expected = slotIndexToPosition(1);
    expect(result[0].x).toBe(expected.x);
    expect(result[0].y).toBe(expected.y);
  });

  it("passes a non-OFFLINE peer through completely unchanged", () => {
    const layer = makeLayer("a@x.com");
    const layers = [layer];
    const people = [makePerson("a@x.com", "ONLINE" as OfficePerson["status"])];
    const result = applyOfflineLineupPositions(layers, people, []);

    expect(result[0]).toEqual(layer);
  });

  it("never reasons about 'self' — only touches emails present in peerLayers/people, self-exclusion is the caller's contract", () => {
    // No special-casing for any particular email: passing an already-self-excluded
    // peerLayers array (the caller's job) is enough for correct behavior. Simulate that by
    // including only non-self peers and confirming nothing beyond those is touched.
    const layers = [makeLayer("peer1@x.com"), makeLayer("peer2@x.com")];
    const people = [
      makePerson("peer1@x.com", "OFFLINE" as OfficePerson["status"]),
      makePerson("peer2@x.com", "AWAY" as OfficePerson["status"]),
    ];
    const result = applyOfflineLineupPositions(layers, people, []);

    expect(result).toHaveLength(2);
    expect(result.map((l) => l.id).sort()).toEqual(["peer1@x.com", "peer2@x.com"]);
    // peer2 (not OFFLINE) is unchanged; peer1 (OFFLINE) is repositioned.
    const peer2 = result.find((l) => l.id === "peer2@x.com")!;
    expect(peer2).toEqual(layers[1]);
  });
});
