import { describe, expect, it } from "vitest";
import { applyOfflineLineupPositions, computeOfflineEmailSet, computeServerLineupEmailSet } from "./offlineLineupPlacement";
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

// Mock-mode offline predicate (2026-08-29): MockOfficeService hard-codes Bon
// OFFLINE and nothing updates it, so in mock mode OfficeMap derives "offline"
// from the app's own server lineup (explicit checkout) via
// computeServerLineupEmailSet and passes that ONE set into
// applyOfflineLineupPositions. Real mode keeps the Atlas-status default.
describe("mock-mode offline predicate: server lineup instead of the fixed mock Atlas status", () => {
  const BON = "jerevon@offshorly.com";
  const mockOfflineBon = [makePerson(BON, "OFFLINE" as OfficePerson["status"])];

  it("1. mock Bon checked out (in the server lineup) -> exactly one Bon, placed in the offline lineup", () => {
    const lineup: OfflineLineupEntry[] = [{ email: BON, slot: 0 }];
    const offline = computeServerLineupEmailSet(lineup);
    const result = applyOfflineLineupPositions([makeLayer(BON)], mockOfflineBon, lineup, offline);

    expect(result).toHaveLength(1);
    const expected = slotIndexToPosition(0);
    expect(result[0].x).toBe(expected.x);
    expect(result[0].y).toBe(expected.y);
    expect(result[0].sitDirection).toBeUndefined();
  });

  it("2. mock Bon checks in (come_online removed him from the server lineup) -> not in the offline set despite mock status OFFLINE", () => {
    const offline = computeServerLineupEmailSet([]);
    expect(offline.has(BON)).toBe(false);
    // Contrast: the Atlas-status predicate would still call him offline.
    expect(computeOfflineEmailSet(mockOfflineBon).has(BON)).toBe(true);

    const layer = makeLayer(BON, { x: 640, y: 420 });
    const result = applyOfflineLineupPositions([layer], mockOfflineBon, [], offline);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(layer); // untouched: desk/synced position stands
  });

  it("5. checkout returns Bon to the lineup: the moment go_offline lands in the server lineup he is offline again and slotted", () => {
    const before = applyOfflineLineupPositions([makeLayer(BON, { x: 640, y: 420 })], mockOfflineBon, [], computeServerLineupEmailSet([]));
    expect(before[0].x).toBe(640);

    const lineup: OfflineLineupEntry[] = [{ email: "Jerevon@Offshorly.com", slot: 2 }]; // mixed case from the wire
    const after = applyOfflineLineupPositions([makeLayer(BON, { x: 640, y: 420 })], mockOfflineBon, lineup, computeServerLineupEmailSet(lineup));
    const expected = slotIndexToPosition(2);
    expect(after).toHaveLength(1);
    expect(after[0].x).toBe(expected.x);
    expect(after[0].y).toBe(expected.y);
  });

  it("6. real-mode offline behavior unchanged: the 3-arg call still uses the Atlas-status predicate (OFFLINE -> lineup, ONLINE -> untouched)", () => {
    const online = makePerson("alex@offshorly.com", "ONLINE" as OfficePerson["status"]);
    const layers = [makeLayer(BON), makeLayer("alex@offshorly.com", { x: 300, y: 300 })];
    const threeArg = applyOfflineLineupPositions(layers, [...mockOfflineBon, online], []);
    const explicitAtlas = applyOfflineLineupPositions(layers, [...mockOfflineBon, online], [], computeOfflineEmailSet([...mockOfflineBon, online]));
    expect(threeArg).toEqual(explicitAtlas);

    const expected = slotIndexToPosition(0);
    expect(threeArg[0].x).toBe(expected.x); // Atlas-OFFLINE Bon -> lineup, as before
    expect(threeArg[1]).toBe(layers[1]); // ONLINE Alex untouched
  });
});
