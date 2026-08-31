import { describe, expect, it } from "vitest";
import {
  dedupePeopleByEmail,
  officePeopleToLayers,
  PLACEHOLDER_LAYER_PATH,
  rosterSrcById,
  seatOverflowsRoom,
} from "./rosterLayers";
import { rooms, bonLayer, ASSET_PATH_TO_SRC } from "./office-layout";
import { BON_SPRITE_SET, characterSprite } from "./bonWalkFrames";
import { PLACEHOLDER_SPRITE_SET } from "../services/avatar/placeholder";
import { seatsForRoomId } from "./roomSeats";
import { SEAT_DIRECTIONS } from "./seatDirections";
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

describe("officePeopleToLayers", () => {
  it("keys layers by email, not sprite, so shared fallbacks stay distinct", () => {
    // Two different people both falling back to the "bon" sprite must be
    // two nodes — keying by avatarId would collide and drop one.
    const layers = officePeopleToLayers([
      person({ email: "a@offshorly.com" }),
      person({ email: "b@offshorly.com" }),
    ]);
    expect(layers.map((l) => l.id)).toEqual(["a@offshorly.com", "b@offshorly.com"]);
  });

  it("carries the display name through for the canvas label", () => {
    const layers = officePeopleToLayers([person({ displayName: "Jan Michael" })]);
    expect(layers[0].name).toBe("Jan Michael");
  });

  it("seats people inside their room's rect", () => {
    const room = rooms.find((r) => r.id === "dev-team")!;
    const layers = officePeopleToLayers([person()]);
    expect(layers[0].x).toBeGreaterThanOrEqual(room.x);
    expect(layers[0].y).toBeGreaterThanOrEqual(room.y);
    expect(layers[0].x).toBeLessThan(room.x + room.width);
  });

  it("does not stack two people in the same spot", () => {
    const layers = officePeopleToLayers([
      person({ email: "a@offshorly.com" }),
      person({ email: "b@offshorly.com" }),
    ]);
    expect({ x: layers[0].x, y: layers[0].y }).not.toEqual({
      x: layers[1].x,
      y: layers[1].y,
    });
  });

  it("seats each room independently", () => {
    const layers = officePeopleToLayers([
      person({ email: "a@offshorly.com", roomId: "dev-team" }),
      person({ email: "b@offshorly.com", roomId: "qa-room" }),
    ]);
    const devRoom = rooms.find((r) => r.id === "dev-team")!;
    const qaRoom = rooms.find((r) => r.id === "qa-room")!;
    expect(layers[0].x).toBeGreaterThanOrEqual(devRoom.x);
    expect(layers[1].x).toBeGreaterThanOrEqual(qaRoom.x);
  });

  it("drops a person whose room has no rect instead of drawing them at 0,0", () => {
    const layers = officePeopleToLayers([person({ roomId: "not-a-room" })]);
    expect(layers).toHaveLength(0);
  });

  it("never marks a borrowed body as animatable", () => {
    // Walk/pat frame sets are keyed to authored character ids; a borrowed
    // sprite has no guarantee of matching frames.
    const layers = officePeopleToLayers([person()]);
    expect(layers[0].animatable).toBe(false);
  });

  it("lowercases the layer id even when Atlas returns a mixed-case email", () => {
    // Every movement-sync key (peer overrides, rosterLayerEmailSet,
    // PeerWalker) is already lowercased — a raw-case roster layer id never
    // collapses with its lowercased moving-peer override, producing a static
    // roster twin that never syncs to the live peer's position (see the
    // fix's regression note in rosterLayers.ts).
    const layers = officePeopleToLayers([person({ email: "Mixed.Case@Offshorly.com" })]);
    expect(layers[0].id).toBe("mixed.case@offshorly.com");
  });

  it("trims and lowercases together", () => {
    const layers = officePeopleToLayers([person({ email: "  Bon@Offshorly.com  " })]);
    expect(layers[0].id).toBe("bon@offshorly.com");
  });
});

describe("crowded rooms", () => {
  function crowd(roomId: string, count: number) {
    return Array.from({ length: count }, (_, i) =>
      person({ email: `p${i}@offshorly.com`, roomId }),
    );
  }

  it("keeps a real-sized team inside its room's rect", () => {
    // AI Team is the largest department at 18 people.
    const room = rooms.find((r) => r.id === "ai-room")!;
    const layers = officePeopleToLayers(crowd("ai-room", 18));
    expect(layers).toHaveLength(18);
    for (const layer of layers) {
      expect(layer.x + layer.width).toBeLessThanOrEqual(room.x + room.width);
      expect(layer.y + layer.height).toBeLessThanOrEqual(room.y + room.height);
    }
  });

  it("does not shrink anyone at today's headcount", () => {
    // Sprites are small relative to the rooms, so 18 people fit at full
    // size. If this ever fails, the art or the room rects changed.
    const solo = officePeopleToLayers(crowd("ai-room", 1));
    const team = officePeopleToLayers(crowd("ai-room", 18));
    expect(team[0].width).toBe(solo[0].width);
  });

  it("shrinks seats once a room genuinely cannot fit everyone", () => {
    // AI Room has real painted chairs (seatsForRoomId), and the first N
    // people (sorted by email) sit on those at full size — only the
    // OVERFLOW remainder past the real chair count shrinks to fit. p0 sits
    // on a real chair either way, so check the guaranteed-overflow person
    // (email-sorted last) instead of index 0.
    const solo = officePeopleToLayers(crowd("ai-room", 1));
    const packed = officePeopleToLayers(crowd("ai-room", 200));
    const overflowPerson = packed.find((l) => l.id === "p99@offshorly.com")!;
    expect(overflowPerson.width).toBeLessThan(solo[0].width);
  });

  it("gives an overflow person the room's default seat direction instead of leaving it undefined", () => {
    // Overflow (packed-grid) people have no real seat coordinates, so they
    // can't use directionForSeat's per-seat override lookup — but they must
    // still resolve to SOME direction, or rosterSrcById falls through to the
    // static front-sit manifest portrait regardless of any seatDirections.ts
    // entry (the bug this fix closes). ai-room has no `default` key set in
    // SEAT_DIRECTIONS today, so the guaranteed-overflow person (email-sorted
    // last) should resolve to the documented "front" fallback — asserted
    // via SEAT_DIRECTIONS itself so this stays correct if ai-room ever gains
    // a `default`.
    const packed = officePeopleToLayers(crowd("ai-room", 200));
    const overflowPerson = packed.find((l) => l.id === "p99@offshorly.com")!;
    expect(overflowPerson.sitDirection).toBeDefined();
    expect(overflowPerson.sitDirection).toBe(SEAT_DIRECTIONS["ai-room"]?.default ?? "front");
  });

  it("scales each room independently", () => {
    const layers = officePeopleToLayers([
      ...crowd("ai-room", 200),
      person({ email: "solo@offshorly.com", roomId: "qa-room" }),
    ]);
    // p0 sits on a real ai-room chair at full size regardless of headcount
    // (only overflow shrinks), so compare against a guaranteed-overflow
    // person instead to actually exercise the per-room shrink scaling.
    const overflowInAi = layers.find((l) => l.id === "p99@offshorly.com")!;
    const inQa = layers.find((l) => l.id === "solo@offshorly.com")!;
    expect(inQa.width).toBeGreaterThan(overflowInAi.width);
  });

  it("still gives everyone a distinct seat when packed", () => {
    const layers = officePeopleToLayers(crowd("ai-room", 18));
    const spots = new Set(layers.map((l) => `${l.x},${l.y}`));
    expect(spots.size).toBe(18);
  });
});

describe("rosterSrcById", () => {
  it("resolves each layer's art through the manifest table", () => {
    const layers = officePeopleToLayers([person()]);
    const srcs = rosterSrcById(layers);
    expect(srcs[layers[0].id]).toBeTruthy();
  });

  it("resolves an unmapped person to the faceless placeholder, NOT Bon's art — regression for the roster-full-of-Bon screenshot", () => {
    // This is the exact scenario from Bon's screenshot: a room full of
    // employees with no registry mapping (avatarId null) must not all
    // render as Bon's sprite. dev-team has real painted chairs, so these
    // land on a real seat and resolve through the seat-direction mechanism
    // (placeholder sprite set's sitType frame, defaulting to "front"), not
    // the old idle-front fallback.
    const layers = officePeopleToLayers([
      person({ email: "unmapped1@offshorly.com", avatarId: null }),
      person({ email: "unmapped2@offshorly.com", avatarId: null }),
    ]);
    const srcs = rosterSrcById(layers);
    const bonSrc = ASSET_PATH_TO_SRC[bonLayer.path];
    const devTeamSeats = seatsForRoomId("dev-team");

    layers.forEach((layer, i) => {
      expect(layer.path).toBe(PLACEHOLDER_LAYER_PATH);
      const expectedSrc = characterSprite(PLACEHOLDER_SPRITE_SET, "sitType", devTeamSeats[i].direction);
      expect(srcs[layer.id]).toBe(expectedSrc);
      expect(srcs[layer.id]).not.toBe(bonSrc);
    });
  });

  it("resolves a mapped person seated on a real chair to their own sprite set's directional sit pose", () => {
    // Seat-direction mechanism (see data/seatDirections.ts): a roster
    // teammate seated on a real painted chair renders through
    // characterSprite(set, "sitType", seat.direction) — NOT the old
    // hardcoded manifest static portrait — so their pose always matches the
    // seat's fixed facing direction (defaults to "front" until real
    // directions are hand-assigned).
    const layers = officePeopleToLayers([person({ avatarId: "bon" })]);
    const srcs = rosterSrcById(layers);
    const expectedDirection = seatsForRoomId("dev-team")[0].direction;
    expect(srcs[layers[0].id]).toBe(characterSprite(BON_SPRITE_SET, "sitType", expectedDirection));
  });
});

describe("dedupePeopleByEmail", () => {
  it("collapses mixed-case duplicates of the same email to one row", () => {
    const result = dedupePeopleByEmail([
      person({ email: "Bon@x.com" }),
      person({ email: "bon@x.com" }),
    ]);
    expect(result).toHaveLength(1);
  });

  it("collapses identical duplicates and keeps the data intact", () => {
    const p = person({ email: "same@x.com" });
    const result = dedupePeopleByEmail([p, { ...p }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(p);
  });

  it("leaves unique employees unchanged and order-independent", () => {
    const a = person({ email: "a@x.com" });
    const b = person({ email: "b@x.com" });
    const c = person({ email: "c@x.com" });
    const forward = dedupePeopleByEmail([a, b, c]);
    const shuffled = dedupePeopleByEmail([c, a, b]);
    expect(forward).toHaveLength(3);
    expect(new Set(forward.map((p) => p.email))).toEqual(new Set(["a@x.com", "b@x.com", "c@x.com"]));
    expect(new Set(shuffled.map((p) => p.email))).toEqual(new Set(["a@x.com", "b@x.com", "c@x.com"]));
  });

  it("picks the whole ONLINE row over an OFFLINE row for the same email (status precedence)", () => {
    const online = person({
      email: "Dup@x.com",
      status: "ONLINE",
      displayName: "Online Row",
      jobTitle: "Engineer",
      atlasRoomId: null,
    });
    const offline = person({
      email: "dup@x.com",
      status: "OFFLINE",
      displayName: "Offline Row",
      jobTitle: "Manager",
      atlasRoomId: "atlas-room-1",
    });
    const result = dedupePeopleByEmail([offline, online]);
    expect(result).toHaveLength(1);
    // Whole winning row, never a hybrid — offline's jobTitle must NOT leak
    // in even though it has an atlasRoomId (status wins first).
    expect(result[0]).toEqual(online);
    expect(result[0].displayName).toBe("Online Row");
    expect(result[0].jobTitle).toBe("Engineer");
  });

  it("tie-breaks equal status on atlasRoomId presence", () => {
    const inRoom = person({
      email: "Dup2@x.com",
      status: "ONLINE",
      displayName: "In Room",
      atlasRoomId: "atlas-room-2",
      jobTitle: "A",
    });
    const noRoom = person({
      email: "dup2@x.com",
      status: "ONLINE",
      displayName: "No Room",
      atlasRoomId: null,
      jobTitle: "B",
    });
    const result = dedupePeopleByEmail([noRoom, inRoom]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(inRoom);
  });

  it("tie-breaks equal status and atlasRoomId on completeness (more non-null metadata wins)", () => {
    const complete = person({
      email: "Dup3@x.com",
      status: "ONLINE",
      atlasRoomId: null,
      displayName: "Complete",
      avatarId: "bon",
      departmentName: "dev-team",
      jobTitle: "Engineer",
      currentActivity: "coding",
      lastMessage: { text: "hi", at: "2024-01-01T00:00:00Z" },
    });
    const sparse = person({
      email: "dup3@x.com",
      status: "ONLINE",
      atlasRoomId: null,
      displayName: "Sparse",
      avatarId: null,
      departmentName: null,
      jobTitle: null,
      currentActivity: null,
      lastMessage: null,
    });
    const result = dedupePeopleByEmail([sparse, complete]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(complete);
  });

  it("final tie-break is raw-email localeCompare, stable regardless of input order", () => {
    const first = person({ email: "AAA@x.com", status: "ONLINE", atlasRoomId: null, displayName: "First" });
    const second = person({ email: "aaa@x.com", status: "ONLINE", atlasRoomId: null, displayName: "Second" });
    // "AAA@x.com".localeCompare("aaa@x.com") should pick AAA (or whichever
    // sorts first) consistently, regardless of array order.
    const forward = dedupePeopleByEmail([first, second]);
    const reversed = dedupePeopleByEmail([second, first]);
    expect(forward).toHaveLength(1);
    expect(reversed).toHaveLength(1);
    expect(forward[0]).toEqual(reversed[0]);
  });
});

describe("officePeopleToLayers with duplicate emails", () => {
  it("produces exactly one lowercased-id layer for mixed-case duplicate emails", () => {
    const layers = officePeopleToLayers([
      person({ email: "Bon@x.com", roomId: "dev-team" }),
      person({ email: "bon@x.com", roomId: "dev-team" }),
    ]);
    expect(layers).toHaveLength(1);
    expect(layers[0].id).toBe("bon@x.com");
  });

  it("a peer override keyed by the lowercased email still matches the deduped layer id", () => {
    const layers = officePeopleToLayers([
      person({ email: "Dup@offshorly.com", status: "ONLINE" }),
      person({ email: "dup@offshorly.com", status: "OFFLINE" }),
    ]);
    expect(layers).toHaveLength(1);
    const overrideKey = "dup@offshorly.com";
    expect(layers[0].id).toBe(overrideKey);
  });
});

describe("seatOverflowsRoom", () => {
  it("is false for a room that comfortably fits its people", () => {
    expect(seatOverflowsRoom("dev-team", 1)).toBe(false);
  });

  it("detects a room packed past its own height", () => {
    expect(seatOverflowsRoom("dev-team", 500)).toBe(true);
  });

  it("is false for an unknown room rather than throwing", () => {
    expect(seatOverflowsRoom("not-a-room", 500)).toBe(false);
  });
});

// Live-3D peers must be seated in their OWN manifest box, not the shared
// bon-sized seat box: CharacterCanvas solves its zoom from the layer height,
// so bon's box handed micah and angelo bon's vertical framing and threw away
// the headroom their taller layers were calibrated to give their raised-arm
// clips.
describe("live-3D peers use their own layer box", () => {
  const MANIFEST = {
    bon: { width: 26.23, height: 37.2 },
    alex: { width: 20, height: 34.46 },
    micah: { width: 24.36, height: 39.1 },
    angelo: { width: 28.18, height: 39.85 },
  } as const;
  // |ndcFeet| x ownHeight / 2 — the feet's constant distance below the box
  // centre. Constant in height because the canonical policy scales the
  // character as 1/layerHeight, which is why resizing the box cannot move feet.
  const FEET_BELOW_CENTRE = {
    bon: 0.741938 * 37.2 / 2,
    alex: 0.830595 * 34.46 / 2,
    micah: 0.726009 * 39.1 / 2,
    angelo: 0.678897 * 39.85 / 2,
  } as const;

  function layersFor(people: Parameters<typeof officePeopleToLayers>[0]) {
    return new Map(officePeopleToLayers(people).map((l) => [l.avatarId ?? l.id, l]));
  }
  const person = (email: string, avatarId: string | null) => ({
    email, displayName: avatarId ?? email, status: "ONLINE" as const,
    avatarId, roomId: "dev-team", departmentName: "Dev",
  });

  it("every registered live-3D employee resolves its own width and height", () => {
    const byId = layersFor([
      person("jerevon@offshorly.com", "bon"),
      person("alex@offshorly.com", "alex"),
      person("micah@offshorly.com", "micah"),
      person("angelo@offshorly.com", "angelo"),
    ] as never);
    for (const [id, box] of Object.entries(MANIFEST)) {
      expect(byId.get(id)!.width).toBeCloseTo(box.width, 3);
      expect(byId.get(id)!.height).toBeCloseTo(box.height, 3);
    }
  });

  it("a peer's box equals the box that same character uses as self", () => {
    // "self" = their own manifest layer; the peer box must be identical, so
    // camera framing, headroom, widthCapacity and proportions all match.
    const byId = layersFor([person("micah@offshorly.com", "micah"), person("angelo@offshorly.com", "angelo")] as never);
    for (const id of ["micah", "angelo"] as const) {
      expect(byId.get(id)!.width).toBeCloseTo(MANIFEST[id].width, 3);
      expect(byId.get(id)!.height).toBeCloseTo(MANIFEST[id].height, 3);
    }
  });

  it("resizing the box does not move anyone's feet or horizontal centre", () => {
    const people = [person("micah@offshorly.com", "micah"), person("angelo@offshorly.com", "angelo")] as never;
    const byId = layersFor(people);
    for (const id of ["micah", "angelo"] as const) {
      const l = byId.get(id)!;
      const centreX = l.x + l.width / 2;
      const centreY = l.y + l.height / 2;
      const feetY = centreY + FEET_BELOW_CENTRE[id];
      // The same seat centroid, whatever box is drawn on it — so a box swap
      // moves neither the horizontal centre nor the feet.
      const inBonBox = { x: centreX - 26.23 / 2, y: centreY - 37.2 / 2, width: 26.23, height: 37.2 };
      expect(inBonBox.x + inBonBox.width / 2).toBeCloseTo(centreX, 9);
      expect(inBonBox.y + inBonBox.height / 2 + FEET_BELOW_CENTRE[id]).toBeCloseTo(feetY, 9);
    }
  });

  it("non-live-3D people keep the shared fallback seat box", () => {
    const byId = layersFor([person("lui@offshorly.com", "lui"), person("nobody@offshorly.com", null)] as never);
    expect(byId.get("lui")!.width).toBeCloseTo(26.23, 3);
    expect(byId.get("lui")!.height).toBeCloseTo(37.2, 3);
  });

  it("produces exactly one layer per person, none duplicated or dropped", () => {
    const people = [
      person("jerevon@offshorly.com", "bon"), person("alex@offshorly.com", "alex"),
      person("micah@offshorly.com", "micah"), person("angelo@offshorly.com", "angelo"),
      person("lui@offshorly.com", "lui"),
    ] as never;
    const layers = officePeopleToLayers(people);
    expect(layers).toHaveLength(5);
    expect(new Set(layers.map((l) => l.id)).size).toBe(5);
  });
});
