// Phase 4A — real coworkers as static bodies. Tested against V1's REAL roster seating, registry and
// facing tables rather than mocks of them, for the same reason the Phase 2/3 suites are: the whole value
// of this phase is that V2 seats people exactly where V1 does, and a mocked seat table would prove
// nothing about that.
import { describe, expect, it } from "vitest";
import { resolveVo3dCoworkers, emailKey } from "./adapters/v1Coworkers";
import { placeCoworkers, phaseFor } from "./world/Coworkers";
import { officePeopleToLayers } from "../../data/rosterLayers";
import { hasCastLods } from "./adapters/v1Avatar";
import type { OfficePerson } from "../../services/office/floorMerge";
import type { Vo3dCoworker } from "./app/coworkers";
import type { Vec2 } from "./core/coords";

/** A roster row in the shape mergeFloorWithPresence actually produces. */
function person(email: string, over: Partial<OfficePerson> = {}): OfficePerson {
  return {
    email,
    displayName: email.split("@")[0],
    status: "ONLINE",
    departmentName: "Design",
    jobTitle: null,
    currentActivity: null,
    lastMessage: null,
    avatarId: null,
    roomId: "design-team",
    atlasRoomId: null,
    inEphemeralRoom: false,
    ...over,
  };
}

// The real production cast, by the ids data/avatarIdentity resolves for these addresses.
const BON = person("jerevon@offshorly.com", { avatarId: "bon", displayName: "Bon" });
const ALEX = person("alex@offshorly.com", { avatarId: "alex", displayName: "Alex", roomId: "executive-team" });
const MICAH = person("micah@offshorly.com", { avatarId: "micah", displayName: "Micah" });
const JAN = person("jan@offshorly.com", { avatarId: "jan", displayName: "Jan", roomId: "dev-team" });
const GELO = person("angelo@offshorly.com", { avatarId: "angelo", displayName: "Angelo", roomId: "dev-team" });
const LUI = person("lui@offshorly.com", { avatarId: "lui", displayName: "Lui", roomId: "dev-team" });

const NOBODY_OFFLINE = new Set<string>();

describe("resolveVo3dCoworkers", () => {
  it("returns the shipped cast, each with a 3D character V2 can actually draw", () => {
    const { coworkers } = resolveVo3dCoworkers([BON, ALEX, MICAH, JAN, GELO], NOBODY_OFFLINE, "");
    expect(coworkers.map((c) => c.email)).toEqual([
      "alex@offshorly.com",
      "angelo@offshorly.com",
      "jan@offshorly.com",
      "jerevon@offshorly.com",
      "micah@offshorly.com",
    ]);
    for (const c of coworkers) expect(hasCastLods(c.avatarId)).toBe(true);
  });

  it("NEVER includes the local employee — the viewer already has a body", () => {
    const { coworkers } = resolveVo3dCoworkers([BON, ALEX, MICAH], NOBODY_OFFLINE, "jerevon@offshorly.com");
    expect(coworkers.map((c) => c.email)).not.toContain("jerevon@offshorly.com");
    expect(coworkers).toHaveLength(2);
  });

  it("excludes self regardless of the case V1 hands the address over in", () => {
    const { coworkers } = resolveVo3dCoworkers([BON, ALEX], NOBODY_OFFLINE, "  JereVon@Offshorly.COM ");
    expect(coworkers.map((c) => c.email)).toEqual(["alex@offshorly.com"]);
  });

  it("buckets an employee with no consolidated GLB instead of substituting somebody else's body", () => {
    // Lui is the real case: a real employee with a real V1 sprite set and no 3D character.
    const { coworkers, missingAvatar } = resolveVo3dCoworkers([ALEX, LUI], NOBODY_OFFLINE, "");
    expect(coworkers.map((c) => c.email)).toEqual(["alex@offshorly.com"]);
    expect(missingAvatar).toEqual(["Lui"]);
  });

  it("buckets an employee with no registry mapping at all", () => {
    const stranger = person("brand.new@offshorly.com", { avatarId: null, displayName: "Brand New" });
    const { coworkers, missingAvatar } = resolveVo3dCoworkers([ALEX, stranger], NOBODY_OFFLINE, "");
    expect(coworkers).toHaveLength(1);
    expect(missingAvatar).toEqual(["Brand New"]);
  });

  it("honours V1's offline predicate — an offline coworker is omitted, not desked", () => {
    const offline = new Set(["alex@offshorly.com"]);
    const { coworkers } = resolveVo3dCoworkers([ALEX, MICAH], offline, "");
    expect(coworkers.map((c) => c.email)).toEqual(["micah@offshorly.com"]);
  });

  it("collapses Atlas's case-differing duplicate rows into one coworker", () => {
    const shouty = person("MICAH@offshorly.com", { avatarId: "micah", displayName: "Micah" });
    const { coworkers } = resolveVo3dCoworkers([MICAH, shouty], NOBODY_OFFLINE, "");
    expect(coworkers).toHaveLength(1);
    expect(coworkers[0].email).toBe("micah@offshorly.com");
  });

  it("is order-independent: a reshuffled roster produces identical coworkers", () => {
    const a = resolveVo3dCoworkers([BON, ALEX, MICAH, JAN, GELO], NOBODY_OFFLINE, "");
    const b = resolveVo3dCoworkers([GELO, MICAH, BON, JAN, ALEX], NOBODY_OFFLINE, "");
    expect(b).toEqual(a);
  });

  it("gives teammates in one room DISTINCT seats (the resolveHomeDesk trap)", () => {
    // data/homeSeat's resolveHomeDesk hands every person in a room the seat nearest the door — using it
    // here would stack the whole team on one chair. officePeopleToLayers assigns real chairs one each.
    const { coworkers } = resolveVo3dCoworkers([JAN, GELO, MICAH], NOBODY_OFFLINE, "");
    const points = coworkers.map((c) => `${c.point.x},${c.point.z}`);
    expect(new Set(points).size).toBe(points.length);
  });

  it("derives each centroid from THAT person's own layer box, never bonLayer's", () => {
    const layers = officePeopleToLayers([MICAH]);
    const { coworkers } = resolveVo3dCoworkers([MICAH], NOBODY_OFFLINE, "");
    const layer = layers.find((l) => l.id === "micah@offshorly.com")!;
    expect(coworkers[0].point).toEqual({
      x: layer.x + layer.width / 2,
      z: layer.y + layer.height / 2,
    });
  });

  it("carries the seat's own facing, translated out of V1's sprite vocabulary", () => {
    const { coworkers } = resolveVo3dCoworkers([BON, ALEX, MICAH, JAN, GELO], NOBODY_OFFLINE, "");
    for (const c of coworkers) expect(["north", "south", "east", "west"]).toContain(c.facing);
  });

  it("returns an empty set for an empty roster — a failed roster is not an error state here", () => {
    expect(resolveVo3dCoworkers([], NOBODY_OFFLINE, "")).toEqual({ coworkers: [], missingAvatar: [] });
  });
});

describe("emailKey", () => {
  it("normalizes to the form every V1 feed joins on", () => {
    expect(emailKey("  Bon@Offshorly.COM ")).toBe("bon@offshorly.com");
    expect(emailKey(null)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

function coworker(email: string, point: Vec2, posSource: Vo3dCoworker["posSource"] = "desk"): Vo3dCoworker {
  return {
    email,
    displayName: email.split("@")[0],
    avatarId: "bon",
    point,
    box: { width: 26, height: 37 },
    posSource,
    facing: "south",
  };
}

const IDENTITY = (p: Vec2): Vec2 => p;
const ANYWHERE = () => true;

describe("placeCoworkers", () => {
  it("places a body exactly on its seat when the seat itself is standable", () => {
    const list = [coworker("a@x.com", { x: 100, z: 200 })];
    const { placed, unplaced } = placeCoworkers(list, IDENTITY, ANYWHERE, 8);
    expect(unplaced).toEqual([]);
    expect(placed[0].pos).toEqual({ x: 100, z: 200 });
  });

  it("applies the world transform, so a shifted room moves its occupants with it", () => {
    const shift = (p: Vec2): Vec2 => ({ x: p.x, z: p.z + 16 });
    const { placed } = placeCoworkers([coworker("a@x.com", { x: 10, z: 20 })], shift, ANYWHERE, 8);
    expect(placed[0].pos).toEqual({ x: 10, z: 36 });
  });

  it("NEVER stacks two bodies on one point — the second is nudged to a legal ring", () => {
    const list = [coworker("a@x.com", { x: 0, z: 0 }), coworker("b@x.com", { x: 0, z: 0 })];
    const { placed, unplaced } = placeCoworkers(list, IDENTITY, ANYWHERE, 8);
    expect(unplaced).toEqual([]);
    expect(placed).toHaveLength(2);
    const d = Math.hypot(placed[0].pos.x - placed[1].pos.x, placed[0].pos.z - placed[1].pos.z);
    expect(d).toBeGreaterThanOrEqual(8);
  });

  it("REFUSES rather than forces a body into geometry, and names who was refused", () => {
    const { placed, unplaced } = placeCoworkers([coworker("a@x.com", { x: 0, z: 0 })], IDENTITY, () => false, 8);
    expect(placed).toEqual([]);
    expect(unplaced).toEqual(["a"]);
  });

  it("refusing one coworker does not refuse the others", () => {
    // only the second person's desk is legal
    const canStand = (p: Vec2) => p.x > 500;
    const list = [coworker("a@x.com", { x: 0, z: 0 }), coworker("b@x.com", { x: 900, z: 0 })];
    const { placed, unplaced } = placeCoworkers(list, IDENTITY, canStand, 8);
    expect(unplaced).toEqual(["a"]);
    expect(placed.map((p) => p.coworker.email)).toEqual(["b@x.com"]);
  });

  it("is deterministic: the same sorted input always places the same people identically", () => {
    const list = [coworker("a@x.com", { x: 0, z: 0 }), coworker("b@x.com", { x: 0, z: 0 }), coworker("c@x.com", { x: 0, z: 0 })];
    expect(placeCoworkers(list, IDENTITY, ANYWHERE, 8)).toEqual(placeCoworkers(list, IDENTITY, ANYWHERE, 8));
  });

  it("places the whole real cast without stacking anyone", () => {
    const { coworkers } = resolveVo3dCoworkers([BON, ALEX, MICAH, JAN, GELO], NOBODY_OFFLINE, "");
    const { placed, unplaced } = placeCoworkers(coworkers, IDENTITY, ANYWHERE, 8);
    expect(unplaced).toEqual([]);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const d = Math.hypot(placed[i].pos.x - placed[j].pos.x, placed[i].pos.z - placed[j].pos.z);
        expect(d).toBeGreaterThanOrEqual(8);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Placement — live positions (Phase 4B)
// ---------------------------------------------------------------------------

describe("placeCoworkers with live positions", () => {
  it("stands a live body exactly where V1 says, even shoulder to shoulder with somebody else", () => {
    // Two people one unit apart — well inside MIN_SEPARATION. The desk body is placed first and claims
    // the spot; the live body is V1's truth and is drawn as-is rather than corrected.
    const list = [coworker("a@x.com", { x: 100, z: 200 }), coworker("b@x.com", { x: 101, z: 200 }, "live")];
    const { placed, unplaced } = placeCoworkers(list, IDENTITY, ANYWHERE, 8);
    expect(unplaced).toEqual([]);
    expect(placed[1].pos).toEqual({ x: 101, z: 200 });
  });

  it("NEVER lets a moving coworker reposition a stationary one — the whole point of the rule", () => {
    // Sorted by email, so the live body is placed FIRST and would have claimed the spot under the old
    // shared-list rule, pushing the desk body onto a ring it never asked for.
    const alone = placeCoworkers([coworker("z@x.com", { x: 100, z: 200 })], IDENTITY, ANYWHERE, 8);
    const crowded = placeCoworkers(
      [coworker("a@x.com", { x: 100, z: 200 }, "live"), coworker("z@x.com", { x: 100, z: 200 })],
      IDENTITY,
      ANYWHERE,
      8,
    );
    expect(crowded.placed[1].pos).toEqual(alone.placed[0].pos);
  });

  it("draws two live bodies on one point honestly rather than inventing a correction", () => {
    const list = [coworker("a@x.com", { x: 50, z: 50 }, "live"), coworker("b@x.com", { x: 50, z: 50 }, "live")];
    const { placed } = placeCoworkers(list, IDENTITY, ANYWHERE, 8);
    expect(placed[0].pos).toEqual({ x: 50, z: 50 });
    expect(placed[1].pos).toEqual({ x: 50, z: 50 });
  });

  it("keeps the desk-to-desk separation rule exactly as Phase 4A had it", () => {
    const list = [coworker("a@x.com", { x: 100, z: 200 }), coworker("b@x.com", { x: 101, z: 200 })];
    const { placed } = placeCoworkers(list, IDENTITY, ANYWHERE, 8);
    expect(placed[1].pos).not.toEqual({ x: 101, z: 200 });
  });

  it("still refuses a live position V2's own floor cannot stand a body on", () => {
    // A persisted position is V1's truth about V1's floor; V2 has rooms V1 never had. Refusing is the same
    // refusal Phase 3 makes for the signed-in employee's own desk.
    const list = [coworker("a@x.com", { x: 100, z: 200 }, "live")];
    const { placed, unplaced } = placeCoworkers(list, IDENTITY, () => false, 8);
    expect(placed).toEqual([]);
    expect(unplaced).toEqual(["a"]);
  });

  it("applies the world transform to a live point too, so a shifted room moves its occupants", () => {
    const shift = (p: Vec2): Vec2 => ({ x: p.x, z: p.z + 16 });
    const { placed } = placeCoworkers([coworker("a@x.com", { x: 10, z: 20 }, "live")], shift, ANYWHERE, 8);
    expect(placed[0].pos).toEqual({ x: 10, z: 36 });
  });
});

describe("phaseFor", () => {
  it("is stable per person and spread across the cast", () => {
    expect(phaseFor("bon@offshorly.com")).toBe(phaseFor("bon@offshorly.com"));
    const phases = new Set(["a@x.com", "b@x.com", "c@x.com", "d@x.com"].map(phaseFor));
    expect(phases.size).toBeGreaterThan(1);
    for (const p of phases) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
  });
});
