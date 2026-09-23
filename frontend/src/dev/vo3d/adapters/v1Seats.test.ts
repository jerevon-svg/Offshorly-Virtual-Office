// Phase 6C — THE SEAT MAPPING, against the real tables and against synthetic ambiguity.
//
// The production mapping is derived from V1's painted/manifest seats and V2's authored rooms; these pin
// what it must be (every desk chair in the reconstructed team rooms identified, one-to-one, each with the
// chair's own yaw) and what it must refuse (two candidates, a shared seat, a V2-only chair). The refusals
// are exercised on synthetic inputs so the rule is tested, not the accident of today's geometry.
import { describe, expect, it } from "vitest";
import { allV1Seats, anchorForSeatKey, buildSeatMapping, EXPLICIT_SEAT_KEYS, isV2SeatKey, seatMapping, v1SeatForAnchor, v2SeatKey, type V1SeatIdentity } from "./v1Seats";
import { collectSeatAnchors, groundFloorSeatAnchors, parseSeatAnchorId, seatAnchorId, type Vo3dSeatAnchor } from "../app/seats";
import { seatsForRoomId } from "../../../data/roomSeats";
import { seatCentroidKey } from "../../../data/emptySeats";
import { DEV_SEAT_IDS } from "../rooms/dev";
import { AI_SEAT_IDS } from "../rooms/ai";
import { EXECUTIVE_SEAT_IDS, VISITOR_SEAT_IDS } from "../rooms/executive";
import { CMS_SEAT_IDS } from "../rooms/cms";
import { QA_SEAT_IDS } from "../rooms/qa";
import { MEETING_CHAIR_IDS } from "../rooms/meeting";
import { CAFE_CHAIR_IDS } from "../rooms/central-hub";
import { CHAIR_4_ID } from "../rooms/design-room";
import { FACING_YAW, facingForYaw, type Facing } from "../core/coords";

const anchor = (id: string, x: number, z: number, yaw = 0, extra: Partial<Vo3dSeatAnchor> = {}): Vo3dSeatAnchor => ({ id, entityId: id, kind: "seat", point: { x, z }, yaw, ...extra });
const v1 = (x: number, y: number, roomId = "room", extra: Partial<V1SeatIdentity> = {}): V1SeatIdentity => ({ key: seatCentroidKey(x, y), roomId, x, y, direction: "front", ...extra });

describe("anchor ids", () => {
  it("round-trip through the slot separator", () => {
    expect(parseSeatAnchorId(seatAnchorId("dev-room/bay-chair-n1"))).toEqual({ entityId: "dev-room/bay-chair-n1" });
    expect(parseSeatAnchorId(seatAnchorId("executive-room/sofa-west", "sofa-west-north"))).toEqual({ entityId: "executive-room/sofa-west", slotId: "sofa-west-north" });
  });

  it("enumerates one anchor per movable chair and one per lounge cushion, with the chair's own yaw", () => {
    const anchors = collectSeatAnchors([
      { id: "r/chair", kind: "k", roomId: "r", transform: { pos: { x: 10, z: 20 }, yaw: 0 }, capabilities: { seat: { seatedYaw: FACING_YAW.west } as never }, props: {} },
      { id: "r/sofa", kind: "k", roomId: "r", transform: { pos: { x: 100, z: 200 }, yaw: 0 }, capabilities: { lounge: { slots: [
        { id: "a", contactLocal: { x: -10, y: 10, z: 2 }, seatedYaw: FACING_YAW.north, approach: { x: 0, z: 0 }, approachToSeat: [], timings: { sitMs: 1, standMs: 1 } },
        { id: "b", contactLocal: { x: 10, y: 10, z: 2 }, seatedYaw: FACING_YAW.south, approach: { x: 0, z: 0 }, approachToSeat: [], timings: { sitMs: 1, standMs: 1 } },
      ] } }, props: {} },
    ]);
    expect(anchors.map((a) => [a.id, a.kind, a.point.x, a.point.z, a.yaw])).toEqual([
      ["r/chair", "seat", 10, 20, FACING_YAW.west],
      ["r/sofa#a", "lounge", 90, 202, FACING_YAW.north],
      ["r/sofa#b", "lounge", 110, 202, FACING_YAW.south],
    ]);
  });
});

describe("buildSeatMapping — the rules, on synthetic inputs", () => {
  it("maps an anchor with exactly one V1 seat within tolerance, and refuses one with none", () => {
    const m = buildSeatMapping([anchor("a", 100, 100), anchor("b", 500, 500)], [v1(103, 98)]);
    expect(m.byAnchor.get("a")?.key).toBe("103,98");
    expect(m.byKey.get("103,98")?.id).toBe("a");
    expect(m.unsupported).toEqual([{ id: "b", reason: "no-v1-seat" }]);
    expect(m.unmatchedV1Keys).toEqual([]);
  });

  it("REFUSES an anchor with two V1 seats within tolerance, however unequal their distances", () => {
    // Nearest is 2 away, second is 9 away: still ambiguous. Proximity is not allowed to decide.
    const m = buildSeatMapping([anchor("a", 100, 100)], [v1(102, 100), v1(109, 100)]);
    expect(m.byAnchor.size).toBe(0);
    expect(m.unsupported).toEqual([{ id: "a", reason: "ambiguous-v1-seats" }]);
    expect([...m.unmatchedV1Keys].sort()).toEqual(["102,100", "109,100"].sort());
  });

  it("releases a V1 seat two anchors both resolve to, from both — one-to-one or nothing", () => {
    const m = buildSeatMapping([anchor("a", 100, 100), anchor("b", 104, 100)], [v1(102, 100)]);
    expect(m.byAnchor.size).toBe(0);
    expect(m.byKey.size).toBe(0);
    expect(m.unsupported.map((u) => u.reason)).toEqual(["shared-v1-seat", "shared-v1-seat"]);
  });

  it("uses V1 provenance (the manifest layer id) before geometry, and never for a split sofa", () => {
    const seats = [v1(300, 300, "room", { furnitureId: "chair-x" }), v1(600, 605, "room", { furnitureId: "sofa-y" }), v1(600, 625, "room", { furnitureId: "sofa-y" })];
    // The anchor stands 40 units from its own manifest seat (a room shift the test did not undo) — provenance still identifies it.
    const m = buildSeatMapping([anchor("a", 300, 340, 0, { v1LayerId: "chair-x" }), anchor("b", 600, 615, 0, { v1LayerId: "sofa-y" })], seats);
    expect(m.byAnchor.get("a")?.key).toBe("300,300");
    // The sofa id names two sub-seats: refused on provenance, and 10 from both cushions it is ambiguous on geometry too.
    expect(m.byAnchor.has("b")).toBe(false);
    expect(m.unsupported).toEqual([{ id: "b", reason: "ambiguous-v1-seats" }]);
  });

  it("honours an explicit override, still subject to one-to-one", () => {
    const m = buildSeatMapping([anchor("a", 0, 0), anchor("b", 500, 500)], [v1(103, 98)], { explicit: { a: "103,98" } });
    expect(m.byAnchor.get("a")?.key).toBe("103,98");
    expect(m.byAnchor.has("b")).toBe(false);
  });

  it("undoes the room shift before comparing, through the injected conversion", () => {
    const m = buildSeatMapping([anchor("a", 100, 116)], [v1(100, 100)], { toV1Frame: (p) => ({ x: p.x, z: p.z - 16 }) });
    expect(m.byAnchor.get("a")?.key).toBe("100,100");
  });
});

describe("the production mapping", () => {
  const m = seatMapping();

  it("is deterministic and one-to-one", () => {
    const again = buildSeatMapping(groundFloorSeatAnchors(), allV1Seats(), { toV1Frame: (p) => p });
    // Same anchors, same seats, same rule: the only difference allowed is the Design Room's shift, which
    // the identity conversion here does not undo — so compare the unshifted rooms' entries exactly.
    for (const [id, seat] of m.byAnchor) if (!id.startsWith("design-room/")) expect(again.byAnchor.get(id)?.key).toBe(seat.key);
    const keys = [...m.byAnchor.values()].map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [key, a] of m.byKey) expect(m.byAnchor.get(a.id)?.key).toBe(key);
  });

  it("identifies EVERY movable desk chair in the reconstructed team rooms and the Meeting Room", () => {
    for (const id of [...DEV_SEAT_IDS, ...AI_SEAT_IDS, ...EXECUTIVE_SEAT_IDS, ...CMS_SEAT_IDS, ...QA_SEAT_IDS, ...MEETING_CHAIR_IDS]) {
      expect(m.byAnchor.has(id), `${id} should map to a V1 seat`).toBe(true);
    }
    // the Design Room chair, through its manifest provenance
    expect(m.byAnchor.has(CHAIR_4_ID)).toBe(true);
    // the executive visitor chairs are FIXED seating (lounge slots) and identify too
    for (const id of VISITOR_SEAT_IDS) expect(m.byKey.has(m.byAnchor.get(`${id}#${id.split("/")[1]}-seat`)?.key ?? ""), id).toBe(true);
  });

  it("puts each mapped anchor within tolerance of its V1 centroid, in that seat's own room", () => {
    for (const a of groundFloorSeatAnchors()) {
      const seat = m.byAnchor.get(a.id);
      if (!seat || a.id in EXPLICIT_SEAT_KEYS) continue; // a hand decision may name a seat geometry could not (the sofa cushions)
      const shift = a.entityId.startsWith("design-room/") ? 16 : 0;
      const d = Math.hypot(seat.x - a.point.x, seat.y - (a.point.z - shift));
      // provenance matches may sit farther than geometry ones; nothing may sit a chair away
      expect(d, `${a.id} ↔ ${seat.key}`).toBeLessThan(20);
      expect(seatsForRoomId(seat.roomId).some((s) => seatCentroidKey(s.x, s.y) === seat.key)).toBe(true);
    }
  });

  it("clearly identifies the V2-only chairs: every Central Hub café chair, with a reason — and gives each a namespaced key", () => {
    for (const id of CAFE_CHAIR_IDS) {
      expect(m.byAnchor.has(id)).toBe(false);
      expect(m.unsupported.find((u) => u.id === id)?.reason).toBe("no-v1-seat");
      // the key is never a centroid, and resolves back to exactly this anchor
      expect(v2SeatKey(id)).toBe(`v2:${id}`);
      expect(isV2SeatKey(v2SeatKey(id))).toBe(true);
      expect(anchorForSeatKey(v2SeatKey(id))?.id).toBe(id);
    }
    expect(v1SeatForAnchor(CAFE_CHAIR_IDS[0])).toBeNull();
    // every anchor on the floor is therefore sittable AND publishable: a V1 key or a v2: key, never neither
    for (const a of groundFloorSeatAnchors()) expect(anchorForSeatKey(m.byAnchor.get(a.id)?.key ?? v2SeatKey(a.id))?.id).toBe(a.id);
    // a namespaced key naming no anchor is refused, and a V1 key is never mistaken for one
    expect(anchorForSeatKey("v2:nowhere/chair")).toBeNull();
    expect(isV2SeatKey("881,258")).toBe(false);
  });

  it("carries chairs facing all four directions, each with the CHAIR's own yaw, not one sitting yaw", () => {
    const seen = new Map<Facing, string>();
    for (const a of groundFloorSeatAnchors()) {
      if (!m.byAnchor.has(a.id)) continue;
      const f = facingForYaw(a.yaw);
      if (!seen.has(f)) seen.set(f, a.id);
    }
    expect([...seen.keys()].sort()).toEqual(["east", "north", "south", "west"]);
    // Dev room: bay row 1 faces SOUTH into its bench, row 2 faces NORTH — the yaw comes from the chair.
    expect(facingForYaw(m.byKey.get(m.byAnchor.get("dev-room/bay-chair-n1")!.key)!.yaw)).toBe("south");
    expect(facingForYaw(m.byKey.get(m.byAnchor.get("dev-room/bay-chair-s1")!.key)!.yaw)).toBe("north");
  });

  it("resolves a V1 seat key back to its anchor, and null for a key V2 has no chair for", () => {
    const [id, seat] = [...m.byAnchor.entries()][0];
    expect(anchorForSeatKey(seat.key)?.id).toBe(id);
    expect(anchorForSeatKey("1,1")).toBeNull();
    expect(anchorForSeatKey(null)).toBeNull();
  });
});
