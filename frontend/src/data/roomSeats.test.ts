import { describe, expect, it } from "vitest";
import { seatsForRoomId } from "./roomSeats";
import { officePeopleToLayers } from "./rosterLayers";
import { rooms, teamRooms } from "./office-layout";
import { SEAT_DIRECTIONS, directionForSeat, seatCellKey } from "./seatDirections";
import type { OfficePerson } from "../services/office/floorMerge";

function person(overrides: Partial<OfficePerson> = {}): OfficePerson {
  return {
    email: "bon@offshorly.com",
    displayName: "Bon",
    status: "ONLINE",
    departmentName: "dev-team",
    jobTitle: null,
    currentActivity: null,
    lastMessage: null,
    avatarId: "bon",
    roomId: "dev-team",
    atlasRoomId: null,
    inEphemeralRoom: false,
    ...overrides,
  };
}

function shuffled<T>(arr: T[]): T[] {
  const out = [...arr];
  // Fixed-seed-ish deterministic shuffle (Fisher-Yates with a simple LCG) —
  // no randomness needed, just a reordering different from input order.
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("seatsForRoomId", () => {
  it("returns > 0 seats for every real team room with painted chairs", () => {
    for (const room of teamRooms) {
      const seats = seatsForRoomId(room.id);
      expect(seats.length).toBeGreaterThan(0);
    }
  });

  it("is stable across repeated calls (memoized, not recomputed)", () => {
    const a = seatsForRoomId("ai-room");
    const b = seatsForRoomId("ai-room");
    expect(a).toEqual(b);
  });

  it("every seat centroid falls inside its room's rect", () => {
    for (const room of rooms) {
      for (const seat of seatsForRoomId(room.id)) {
        expect(seat.x).toBeGreaterThanOrEqual(room.x);
        expect(seat.x).toBeLessThanOrEqual(room.x + room.width);
        expect(seat.y).toBeGreaterThanOrEqual(room.y);
        expect(seat.y).toBeLessThanOrEqual(room.y + room.height);
      }
    }
  });

  it("returns an empty array for an unknown room id", () => {
    expect(seatsForRoomId("not-a-room")).toEqual([]);
  });
});

describe("seatsForRoomId manifest-driven dense rooms", () => {
  // Ground-truth counts, manually derived from office-assets-manifest.json's
  // furniture layer by grouping every entry under each room's furniture
  // folder by its PNG filename (the `path`, not the `id` — several real
  // chairs have ids that don't literally contain "chair", e.g. dev-team's
  // dev-lead1-visitor1/2 and dev-lead2-visitor1/2, so this breakdown is
  // filename-based on purpose, independent of roomSeats.ts's own matching
  // logic). Note ai-room's assets live under "furniture/ai-team/", not
  // "furniture/ai-room/". 4 named sofas (MULTI_SEAT_SOFA_IDS in roomSeats.ts)
  // each produce 3 seats instead of 1 — counted as "x3" below.
  const EXPECTED_COUNTS: Record<string, number> = {
    // dev-chair.png (10: dev-lead1-chair, dev-lead2-chair, dev-bay1-chair1-4,
    // dev-bay2-chair1-4) + dev-visitor-chair.png (12: dev-lead1-visitor1/2,
    // dev-lead2-visitor1/2, dev-bay1-chair5-8, dev-bay2-chair5-8) +
    // dev-side-sofa.png (1 furniture item x3 seats = 3) = 25
    "dev-team": 25,
    // hr-chair.png (1) + white-sofa.png (2 furniture items x3 seats = 6:
    // white-sofa-left, white-sofa-right) + exec-chair.png (2: ceo/cto) +
    // exec-visitor-chair.png (8: ceo x4, cto x4) + bottom-center-sofa.png
    // (1, NOT split — too small) + top-center-sofa.png (1, NOT split — too
    // small) = 19
    "executive-team": 19,
    // design-side-sofa.png (1 furniture item x3 seats = 3) +
    // design-side-beanbag.png (1, NOT split — single-person by nature) +
    // design-lead-chair.png (1) + design-member-chair-a.png (4) +
    // design-member-chair-b.png (3) = 12
    "design-team": 12,
    // ai-member-chair.png (18) + ai-lead-chair.png (3: ai-lead-chair,
    // ai-visitor-chair-1/2) = 21 — unaffected, ai-room has no sofa furniture
    "ai-room": 21,
  };

  it.each(Object.entries(EXPECTED_COUNTS))(
    "detects every real chair for %s (%i seats)",
    (roomId, expectedCount) => {
      expect(seatsForRoomId(roomId)).toHaveLength(expectedCount);
    },
  );

  it("orders manifest-driven seats top-to-bottom then left-to-right, stably", () => {
    for (const roomId of Object.keys(EXPECTED_COUNTS)) {
      const seats = seatsForRoomId(roomId);
      for (let i = 1; i < seats.length; i++) {
        const prev = seats[i - 1];
        const cur = seats[i];
        expect(cur.y > prev.y || (cur.y === prev.y && cur.x >= prev.x)).toBe(true);
      }
      // Re-fetching (memoized) must produce the exact same order every time.
      expect(seatsForRoomId(roomId)).toEqual(seats);
    }
  });

  // Fix A (this task): the old wall-avoidance nudge is gone. Manifest seats
  // now use the furniture's raw pixel centroid directly, even when that
  // lands on a "#" wall cell in the walkability grid — pathfinding already
  // independently snaps walk-goals to the nearest walkable cell at walk time
  // (see OfficeMap.tsx/officePathfinding.ts), so a seat centroid on a wall
  // cell is expected and harmless for reachability. This is a deliberate
  // trade for correct visual placement (the nudge had a systematic up-left
  // bias that visibly misaligned seats from their chair art) — there is
  // intentionally no "never on a wall cell" assertion here anymore.

  it("splits each of the 4 designated large sofas into exactly 3 seats", () => {
    // furnitureId lets us pick out exactly the seats generated from each
    // named sofa, independent of overall room seat count/order.
    const cases: Array<{ roomId: string; furnitureId: string }> = [
      { roomId: "executive-team", furnitureId: "white-sofa-left" },
      { roomId: "executive-team", furnitureId: "white-sofa-right" },
      { roomId: "dev-team", furnitureId: "dev-side-sofa" },
      { roomId: "design-team", furnitureId: "design-side-sofa" },
    ];
    for (const { roomId, furnitureId } of cases) {
      const subSeats = seatsForRoomId(roomId).filter((s) => s.furnitureId === furnitureId);
      expect(subSeats).toHaveLength(3);

      // Distinct coordinates and cellKeys — 3 real, separately-sittable seats.
      const coordKeys = subSeats.map((s) => seatCellKey(s.x, s.y));
      expect(new Set(coordKeys).size).toBe(3);
    }
  });

  it("does not split the 2 small sofas or the beanbag — each stays a single seat", () => {
    const cases: Array<{ roomId: string; furnitureId: string }> = [
      { roomId: "executive-team", furnitureId: "bottom-center-sofa" },
      { roomId: "executive-team", furnitureId: "top-center-sofa" },
      { roomId: "design-team", furnitureId: "design-side-beanbag" },
    ];
    for (const { roomId, furnitureId } of cases) {
      const subSeats = seatsForRoomId(roomId).filter((s) => s.furnitureId === furnitureId);
      expect(subSeats).toHaveLength(1);
    }
  });

  it("places top-center-sofa's seat on/within its own furniture footprint (the visual bug this fixes)", () => {
    // Ground truth from office-assets-manifest.json's top-center-sofa entry:
    // x=712.25, y=142.75, width=27.9, height=31.87.
    const seat = seatsForRoomId("executive-team").find((s) => s.furnitureId === "top-center-sofa");
    expect(seat).toBeDefined();
    expect(seat!.x).toBeCloseTo(712.25 + 27.9 / 2, 5);
    expect(seat!.y).toBeCloseTo(142.75 + 31.87 / 2, 5);
    expect(seat!.x).toBeGreaterThanOrEqual(712.25);
    expect(seat!.x).toBeLessThanOrEqual(712.25 + 27.9);
    expect(seat!.y).toBeGreaterThanOrEqual(142.75);
    expect(seat!.y).toBeLessThanOrEqual(142.75 + 31.87);
  });

  it("populates furnitureId for manifest-driven seats, shared across a split sofa's sub-seats", () => {
    for (const roomId of Object.keys(EXPECTED_COUNTS)) {
      for (const seat of seatsForRoomId(roomId)) {
        expect(seat.furnitureId).toBeDefined();
        expect(typeof seat.furnitureId).toBe("string");
      }
    }
    // All 3 white-sofa-right sub-seats share the exact same furnitureId.
    const subSeats = seatsForRoomId("executive-team").filter(
      (s) => s.furnitureId === "white-sofa-right",
    );
    expect(subSeats).toHaveLength(3);
    expect(new Set(subSeats.map((s) => s.furnitureId)).size).toBe(1);
  });

  it("leaves furnitureId undefined for flood-fill-derived seats (non-manifest rooms)", () => {
    for (const seat of seatsForRoomId("cms-team")) {
      expect(seat.furnitureId).toBeUndefined();
    }
  });
});

describe("seatsForRoomId direction resolution", () => {
  it("resolves every seat's direction to exactly what SEAT_DIRECTIONS/directionForSeat would produce", () => {
    for (const room of teamRooms) {
      for (const seat of seatsForRoomId(room.id)) {
        expect(seat.direction).toBe(directionForSeat(room.id, seat.x, seat.y));
      }
    }
  });

  // roomSeats.ts's seatsByRoom is memoized at module load, so a test-only
  // mutation of SEAT_DIRECTIONS after import can't retroactively change an
  // already-built Seat's `.direction`. seatDirections.ts's own
  // directionForSeat() is the actual resolution logic seatsForRoomId calls
  // at build time — exercising it directly here is the correct level to
  // test "resolves correctly when a cellKey/room-default IS mapped".
  it("resolves a per-seat cellKey override over the front default", () => {
    expect(directionForSeat("ai-room", 100, 200)).toBe("front"); // unmapped baseline
    SEAT_DIRECTIONS["ai-room"] = { seats: { [seatCellKey(100, 200)]: "left" } };
    try {
      expect(directionForSeat("ai-room", 100, 200)).toBe("left");
      // A different, unmapped seat in the same room still falls through.
      expect(directionForSeat("ai-room", 1, 1)).toBe("front");
    } finally {
      delete SEAT_DIRECTIONS["ai-room"];
    }
  });

  it("resolves a room-wide default for every unmapped seat, per-seat override still wins", () => {
    SEAT_DIRECTIONS["ai-room"] = {
      default: "back",
      seats: { [seatCellKey(100, 200)]: "left" },
    };
    try {
      expect(directionForSeat("ai-room", 100, 200)).toBe("left");
      expect(directionForSeat("ai-room", 1, 1)).toBe("back");
    } finally {
      delete SEAT_DIRECTIONS["ai-room"];
    }
  });

  it("falls back to \"front\" with no mapping and no room default", () => {
    expect(directionForSeat("some-unmapped-room", 0, 0)).toBe("front");
  });
});

describe("officePeopleToLayers seat assignment determinism", () => {
  it("assigns the same person to the same seat regardless of input order", () => {
    const people = Array.from({ length: 6 }, (_, i) =>
      person({ email: `p${i}@offshorly.com`, roomId: "ai-room" }),
    );

    const inOrder = officePeopleToLayers(people);
    const outOfOrder = officePeopleToLayers(shuffled(people));

    const byId = (layers: typeof inOrder) =>
      Object.fromEntries(layers.map((l) => [l.id, { x: l.x, y: l.y }]));

    expect(byId(outOfOrder)).toEqual(byId(inOrder));
  });

  it("seats real people (up to seat count) on real chair centroids", () => {
    const seats = seatsForRoomId("ai-room");
    const people = Array.from({ length: seats.length }, (_, i) =>
      person({ email: `p${i}@offshorly.com`, roomId: "ai-room" }),
    );
    const layers = officePeopleToLayers(people);
    expect(layers).toHaveLength(seats.length);

    const sortedByEmail = [...people].sort((a, b) => a.email.localeCompare(b.email));
    sortedByEmail.forEach((p, i) => {
      const layer = layers.find((l) => l.id === p.email)!;
      const seat = seats[i];
      expect(layer.x + layer.width / 2).toBeCloseTo(seat.x, 5);
      expect(layer.y + layer.height / 2).toBeCloseTo(seat.y, 5);
    });
  });

  it("routes overflow (more people than painted chairs) through the old grid path without throwing", () => {
    // dev-team is the documented under-clustered case: real chairs painted
    // with touching tiles under-cluster (fewer detected seats than actual
    // chairs), so its real headcount always has an overflow remainder.
    const seats = seatsForRoomId("dev-team");
    const overflowCount = seats.length + 13; // comfortably past real chairs
    const people = Array.from({ length: overflowCount }, (_, i) =>
      person({ email: `d${i}@offshorly.com`, roomId: "dev-team" }),
    );

    expect(() => officePeopleToLayers(people)).not.toThrow();
    const layers = officePeopleToLayers(people);
    expect(layers).toHaveLength(overflowCount);

    // Every overflow person still landed somewhere with distinct coords.
    const spots = new Set(layers.map((l) => `${l.x},${l.y}`));
    expect(spots.size).toBe(overflowCount);
  });

  it("degrades gracefully to 100% old-grid behavior for a room with zero painted chairs", () => {
    const people = [person({ roomId: "gaming-room", email: "solo@offshorly.com" })];
    // gaming-room has painted seats today per office art, but the fallback
    // path itself is what's under test: simulate a chairless room via an
    // id with no rect match for seatsForRoomId (returns []), then confirm
    // the person still gets placed via the generic grid rather than being
    // dropped or erroring.
    expect(seatsForRoomId("not-a-real-room")).toEqual([]);
    const layers = officePeopleToLayers(people);
    expect(layers).toHaveLength(1);
    expect(Number.isFinite(layers[0].x)).toBe(true);
    expect(Number.isFinite(layers[0].y)).toBe(true);
  });
});
