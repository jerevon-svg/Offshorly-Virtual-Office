import { describe, expect, it } from "vitest";
import { AI_LAB_PLACE_ID, resolveEmployeeLocation, resolveEmployeeLocations, UNKNOWN_LOCATION } from "./employeeLocation";
import { CAVE_PLACE_ID } from "./coworkers";
import type { Zone } from "./access";

const roomName = (id: string) => (id === "design-room" ? "Design Room" : id);
const outsideBeyond = (limit: number) => (_x: number, z: number): Zone => (z > limit ? "outside" : "office");
const base = { viewerInsideCave: false, roomName, zoneAt: outsideBeyond(1150) };

describe("resolveEmployeeLocation", () => {
  it("refuses to call a DESK a location — the rule the whole module exists for", () => {
    // A desk row is everybody V1 has never seen move. Naming their desk would state a guess as a fact.
    expect(resolveEmployeeLocation({ posSource: "desk", place: "design-room", point: { x: 10, z: 10 } }, base))
      .toEqual(UNKNOWN_LOCATION);
    expect(UNKNOWN_LOCATION.label).toBe("Location unavailable");
    expect(UNKNOWN_LOCATION.locatable).toBe(false);
  });

  it("names an office room from the id riding beside the live position", () => {
    const r = resolveEmployeeLocation({ posSource: "live", place: "design-room", point: { x: 10, z: 10 } }, base);
    expect(r).toEqual({ label: "Design Room", kind: "room", locatable: true });
  });

  it("falls back to the raw id rather than inventing a room name", () => {
    expect(resolveEmployeeLocation({ posSource: "live", place: "nope-room", point: { x: 1, z: 1 } }, base).label)
      .toBe("nope-room");
  });

  it("says In AI Lab for the Lab's own place id", () => {
    expect(resolveEmployeeLocation({ posSource: "live", place: AI_LAB_PLACE_ID, point: { x: 740, z: -420 } }, base))
      .toEqual({ label: "In AI Lab", kind: "aiLab", locatable: true });
  });

  it("says In Championship Cave, and keys off the SAME id the volume filter uses", () => {
    expect(CAVE_PLACE_ID).toBe("championship-cave");
    const r = resolveEmployeeLocation({ posSource: "live", place: CAVE_PLACE_ID, point: { x: 2880, z: 710 } }, base);
    expect(r.label).toBe("In Championship Cave");
    expect(r.kind).toBe("cave");
  });

  it("says Outside the Office from the ZONE, overriding a stale room id", () => {
    // Live regression: a body walked out of Reception onto the street still published roomId
    // "reception-room", because the id is only rewritten on a boundary crossing.
    const r = resolveEmployeeLocation(
      { posSource: "live", place: "reception-room", point: { x: 728, z: 1223 } }, base);
    expect(r).toEqual({ label: "Outside the Office", kind: "outside", locatable: true });
  });

  it("stays coarse rather than guessing when the world cannot answer the zone", () => {
    const r = resolveEmployeeLocation({ posSource: "live", place: null, point: { x: 728, z: 1223 } },
      { ...base, zoneAt: undefined });
    expect(r).toEqual({ label: "In the Office", kind: "office", locatable: true });
  });

  it("treats a live person in no named room as In the Office, not as unknown", () => {
    expect(resolveEmployeeLocation({ posSource: "live", place: null, point: { x: 500, z: 400 } }, base))
      .toEqual({ label: "In the Office", kind: "office", locatable: true });
  });
});

describe("Locate, across a sealed volume", () => {
  const inCave = { posSource: "live" as const, place: CAVE_PLACE_ID, point: { x: 2880, z: 710 } };
  const inOffice = { posSource: "live" as const, place: "design-room", point: { x: 10, z: 10 } };

  it("a Cave occupant is NAMED but NOT locatable from the office", () => {
    const r = resolveEmployeeLocation(inCave, base);
    expect(r.label).toBe("In Championship Cave");
    expect(r.locatable).toBe(false);
  });

  it("…and IS locatable once the viewer is in the Cave too", () => {
    expect(resolveEmployeeLocation(inCave, { ...base, viewerInsideCave: true }).locatable).toBe(true);
  });

  it("the office is unreachable in the other direction, from inside the Cave", () => {
    const r = resolveEmployeeLocation(inOffice, { ...base, viewerInsideCave: true });
    expect(r.label).toBe("Design Room");
    expect(r.locatable).toBe(false);
  });

  it("an unknown location is never locatable, from either side", () => {
    expect(resolveEmployeeLocation({ posSource: "desk" }, base).locatable).toBe(false);
    expect(resolveEmployeeLocation({ posSource: "desk" }, { ...base, viewerInsideCave: true }).locatable).toBe(false);
  });
});

describe("resolveEmployeeLocations", () => {
  it("keys every person by email, including the ones the world is not drawing", () => {
    const map = resolveEmployeeLocations([
      { email: "a@x.com", posSource: "live", place: "design-room", point: { x: 1, z: 1 } },
      { email: "b@x.com", posSource: "live", place: CAVE_PLACE_ID, point: { x: 2880, z: 710 } },
      { email: "c@x.com", posSource: "desk", point: { x: 1, z: 1 } },
    ], base);
    expect(Object.keys(map).sort()).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    // The Cave occupant is present in the map even though no body is drawn for them — this is what
    // keeps them SEARCHABLE while the rendering stays isolated.
    expect(map["b@x.com"].label).toBe("In Championship Cave");
    expect(map["c@x.com"]).toEqual(UNKNOWN_LOCATION);
  });
});
