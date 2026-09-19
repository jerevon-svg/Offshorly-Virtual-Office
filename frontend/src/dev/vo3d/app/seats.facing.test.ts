// Phase 6C — SEAT FACING is configuration: one word per anchor, in V1's four-word vocabulary, checked into
// data/seatFacing.json and read through ONE function by every consumer of a seated yaw.
import { afterEach, describe, expect, it } from "vitest";
import seatFacingConfig from "../data/seatFacing.json";
import {
  __resetSeatFacingForTests, groundFloorSeatAnchors, isSeatFacing, markSeatFacingSaved, SEAT_FACINGS, seatFacingFor, seatFacingTable,
  seatFacingYaw, seatedYawFor, setSeatFacingOverride, subscribeSeatFacing, unsavedSeatFacingCount, type SeatFacing,
} from "./seats";
import { seatMapping } from "../adapters/v1Seats";
import { FACING_YAW } from "../core/coords";

afterEach(() => __resetSeatFacingForTests());

describe("the four words", () => {
  it("are exactly V1's, and each is the yaw whose body forward points that way", () => {
    expect(SEAT_FACINGS).toEqual(["front", "back", "left", "right"]);
    // forward of a +z model rotated by yaw θ about +y is (sin θ, cos θ)
    const forward = (yaw: number) => ({ x: Math.round(Math.sin(yaw)), z: Math.round(Math.cos(yaw)) });
    expect(forward(seatFacingYaw("front"))).toEqual({ x: 0, z: 1 }); // south, toward the camera
    expect(forward(seatFacingYaw("back"))).toEqual({ x: 0, z: -1 }); // north
    expect(forward(seatFacingYaw("left"))).toEqual({ x: -1, z: 0 }); // west, screen-left
    expect(forward(seatFacingYaw("right"))).toEqual({ x: 1, z: 0 }); // east, screen-right
    expect(new Set(SEAT_FACINGS.map(seatFacingYaw)).size).toBe(4);
    // north/south agree with core/coords; east/west deliberately do NOT (its labels are mirrored) — see seats.ts
    expect(seatFacingYaw("front")).toBe(FACING_YAW.south);
    expect(seatFacingYaw("back")).toBe(FACING_YAW.north);
    expect(seatFacingYaw("left")).toBe(FACING_YAW.east);
    expect(isSeatFacing("north")).toBe(false);
  });
});

describe("the project file", () => {
  it("configures EVERY anchor on the floor — chairs, sofa cushions, beanbags, poufs — with a valid word", () => {
    const table = seatFacingConfig as Record<string, string>;
    for (const a of groundFloorSeatAnchors()) {
      expect(isSeatFacing(table[a.id]), `${a.id} must have a facing in data/seatFacing.json`).toBe(true);
      expect(seatFacingFor(a.id)).toBe(table[a.id]);
    }
    // ...and names nothing that is not on the floor (a renamed chair would otherwise keep a ghost entry)
    const ids = new Set(groundFloorSeatAnchors().map((a) => a.id));
    for (const id of Object.keys(table)) expect(ids.has(id), `${id} in seatFacing.json is not an anchor`).toBe(true);
  });

  it("agrees with V1's own per-seat direction table for every mapped seat (the seed rule)", () => {
    const m = seatMapping();
    for (const [id, seat] of m.byAnchor) expect(seatFacingFor(id), id).toBe(seat.direction);
    // and covers all four directions across the floor
    expect(new Set(Object.values(seatFacingConfig as Record<string, string>)).size).toBe(4);
  });

  it("individual cushions of one sofa are configured separately", () => {
    const west = seatFacingFor("executive-room/sofa-west#sofa-west-north");
    const east = seatFacingFor("executive-room/sofa-east#sofa-east-north");
    expect(west).toBe("right"); // V1: the west sofa's sitters look east into the room
    expect(east).toBe("left");
  });
});

describe("resolution", () => {
  it("the configured word wins over the authored yaw; an unknown anchor keeps the authored yaw", () => {
    expect(seatedYawFor("dev-room/bay-chair-n1", 1.234)).toBe(seatFacingYaw("front"));
    // the AI Room's member chair at x 117 has its desk to the WEST (pullDir +x): V1 says "left", and the body must face −x
    expect(seatFacingFor("ai-room/member-chair-2-1")).toBe("left");
    expect(Math.round(Math.sin(seatedYawFor("ai-room/member-chair-2-1", 0)))).toBe(-1);
    expect(seatedYawFor("dev-room/bay-chair-s1", 1.234)).toBe(seatFacingYaw("back"));
    expect(seatedYawFor("nowhere/new-chair", 1.234)).toBe(1.234);
    expect(seatFacingFor("nowhere/new-chair")).toBeNull();
  });

  it("a dev-tool override wins over the file, notifies, counts as unsaved, and becomes the file on save", () => {
    const seen: [string, SeatFacing][] = [];
    const off = subscribeSeatFacing((id, f) => seen.push([id, f]));
    setSeatFacingOverride("dev-room/bay-chair-n1", "left");
    expect(seatFacingFor("dev-room/bay-chair-n1")).toBe("left");
    expect(seatedYawFor("dev-room/bay-chair-n1", 0)).toBe(-Math.PI / 2);
    expect(seen).toEqual([["dev-room/bay-chair-n1", "left"]]);
    expect(unsavedSeatFacingCount()).toBe(1);
    expect(seatFacingTable()["dev-room/bay-chair-n1"]).toBe("left");
    // the table is the whole file, sorted, so it can be written back verbatim
    const keys = Object.keys(seatFacingTable());
    expect(keys).toEqual([...keys].sort());
    expect(keys.length).toBe(groundFloorSeatAnchors().length);
    markSeatFacingSaved();
    expect(unsavedSeatFacingCount()).toBe(0);
    expect(seatFacingFor("dev-room/bay-chair-n1")).toBe("left");
    off();
    // put the file's word back so other tests see the checked-in table
    setSeatFacingOverride("dev-room/bay-chair-n1", (seatFacingConfig as Record<string, SeatFacing>)["dev-room/bay-chair-n1"]);
    markSeatFacingSaved();
  });
});
