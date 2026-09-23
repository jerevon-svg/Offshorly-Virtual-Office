// Phase 5 — the working-office boundary, tested against the REAL V1 art and the REAL V1 walkability grid.
//
// The zone cases are geometry. The connectivity case is the one that matters most: the whole gate rests on
// the assumption that Reception's three lanes are the ONLY walkable crossing between the public side of the
// building and the working office. If that is ever false — a new painted door, a re-cut wall — closing the
// lanes stops being a boundary and silently becomes decoration, and nothing else in the code would say so.
import { describe, expect, it } from "vitest";
import { gateRects, mayEnterOffice, routeEntersOffice, zoneAt, type AccessGeometry } from "./access";
import { FACADE_Z, FRAME, v1Rooms } from "../adapters/v1Floor";
import { GATE, RECEPTION_ROOM_ID } from "../rooms/reception";
import { CELL, cellKey, v1Static, worldToCell, type Cell } from "../adapters/v1Grid";
import { floodFill } from "../nav/pathfind";
import { SPAWN as CAVE_SPAWN } from "../rooms/cave";
import { PATH_W } from "../world/ailab";
import type { Vec2 } from "../core/coords";

const GEOM: AccessGeometry = {
  frame: FRAME,
  facadeZ: FACADE_Z,
  receptionRect: v1Rooms().find((r) => r.id === RECEPTION_ROOM_ID)!.rect,
  gateZ: GATE.z,
};

/** The gate cells, rasterised exactly as app/world.ts does it. */
function gateCells(): Cell[] {
  const out: Cell[] = [];
  for (const r of gateRects(GATE.lanes, { z0: GATE.bandZ0, z1: GATE.bandZ1 }))
    for (let cy = Math.floor(r.z / CELL); cy <= Math.floor((r.z + r.d - 0.001) / CELL); cy++)
      for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w - 0.001) / CELL); cx++) out.push({ cx, cy });
  return out;
}

// Probe points, all on cells V1's own grid actually paints as walkable (the connectivity cases below
// would be vacuous otherwise).
/** Deep inside the working office — the west corridor, well north of Reception. */
const OFFICE_DEEP: Vec2 = { x: 400, z: 400 };
/** The office side of the gate band: the corridor row immediately north of the lanes. */
const OFFICE_AT_GATE: Vec2 = { x: 660, z: 820 };
/** The street, in front of Reception's entrance door. */
const STREET: Vec2 = { x: 720, z: 1200 };
/** Reception's public half — south of the gate line, north of the façade. */
const RECEPTION_PUBLIC: Vec2 = { x: 600, z: 1050 };
/** The strip of Reception NORTH of the gates: already past the sensor. Geometry only — every walkable
 *  cell in that strip IS a gate lane, which is the point. */
const RECEPTION_PAST_GATES: Vec2 = { x: 660, z: 860 };

describe("zoneAt", () => {
  it("puts the hub, the corridors and every team room in the working office", () => {
    expect(zoneAt(OFFICE_DEEP, GEOM)).toBe("office");
    expect(zoneAt(OFFICE_AT_GATE, GEOM)).toBe("office");
    // Meeting and Project are FRONT-ROW rooms at the same latitude as Reception's public half, and they
    // are still working office — they open onto the corridor past the gates, not onto the street. This is
    // the case a plain z-line would get wrong.
    expect(zoneAt({ x: 150, z: 1000 }, GEOM)).toBe("office"); // meeting-room
    expect(zoneAt({ x: 1250, z: 1000 }, GEOM)).toBe("office"); // project-room
  });

  it("puts Reception's public half on the open side, and its far strip past the sensor", () => {
    expect(zoneAt(RECEPTION_PUBLIC, GEOM)).toBe("reception");
    expect(zoneAt(RECEPTION_PAST_GATES, GEOM)).toBe("office");
  });

  it("puts the street, the campus legs, the AI Lab and the CAVE outside", () => {
    expect(zoneAt(STREET, GEOM)).toBe("outside");
    // The AI Lab approach runs east then north of the frame — never through the office.
    expect(zoneAt({ x: PATH_W.x + PATH_W.w / 2, z: PATH_W.z + PATH_W.d / 2 }, GEOM)).toBe("outside");
    expect(zoneAt({ x: 1460, z: 600 }, GEOM)).toBe("outside"); // the east leg, x past the frame
    expect(zoneAt(CAVE_SPAWN, GEOM)).toBe("outside");
  });
});

describe("mayEnterOffice", () => {
  it("opens for a confirmed check-in and for nothing else", () => {
    expect(mayEnterOffice("permitted")).toBe(true);
    expect(mayEnterOffice("denied")).toBe(false);
    // An unresolved read is not a permission. Failing closed is the only safe direction here.
    expect(mayEnterOffice("unknown")).toBe(false);
  });
});

describe("routeEntersOffice", () => {
  it("catches a planned route that crosses in, and passes one that stays outside", () => {
    expect(routeEntersOffice([RECEPTION_PUBLIC, RECEPTION_PAST_GATES, OFFICE_DEEP], GEOM)).toBe(true);
    expect(routeEntersOffice([STREET, RECEPTION_PUBLIC], GEOM)).toBe(false);
    expect(routeEntersOffice([], GEOM)).toBe(false);
  });
});

describe("the gate is the only crossing (against V1's own grid)", () => {
  const cells = gateCells();

  it("rasterises to the three lanes and nothing else", () => {
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(60); // a boundary, not a region
    // Every cell is inside the gate band, so the reservation can never touch Reception's seating, the
    // street, the corridors or anything else a denied employee is entitled to walk on.
    for (const c of cells) {
      const centre = { x: (c.cx + 0.5) * CELL, z: (c.cy + 0.5) * CELL };
      expect(centre.z).toBeGreaterThanOrEqual(GATE.bandZ0);
      expect(centre.z).toBeLessThanOrEqual(GATE.bandZ1);
      expect(GATE.lanes.some((l) => centre.x >= l.x0 && centre.x <= l.x1)).toBe(true);
    }
  });

  const shut = new Set(cells.map(cellKey));
  const gated = (cx: number, cy: number): boolean => v1Static(cx, cy) && !shut.has(`${cx},${cy}`);

  it("connects the street to the office while the lanes are open", () => {
    const region = floodFill(v1Static, worldToCell(STREET), 20000);
    expect(region.has(cellKey(worldToCell(RECEPTION_PUBLIC)))).toBe(true);
    expect(region.has(cellKey(worldToCell(OFFICE_AT_GATE)))).toBe(true);
    expect(region.has(cellKey(worldToCell(OFFICE_DEEP)))).toBe(true);
  });

  it("DISCONNECTS the office once the lanes are closed, and leaves the public side whole", () => {
    // THE BYPASS TEST. With the gate shut there is no walkable route from the street or from Reception
    // into the working office at all — so no walk, no A* path and no Player Mode step can get there,
    // because all three are judged by this same predicate.
    const fromStreet = floodFill(gated, worldToCell(STREET), 20000);
    expect(fromStreet.has(cellKey(worldToCell(OFFICE_DEEP)))).toBe(false);
    expect(fromStreet.has(cellKey(worldToCell(OFFICE_AT_GATE)))).toBe(false);
    // ...and the employee is not confined. Reception's public half is still theirs, which is what keeps
    // this a boundary rather than a global block: outdoor exploration begins by walking out of here.
    expect(fromStreet.has(cellKey(worldToCell(RECEPTION_PUBLIC)))).toBe(true);

    const fromReception = floodFill(gated, worldToCell(RECEPTION_PUBLIC), 20000);
    expect(fromReception.has(cellKey(worldToCell(OFFICE_DEEP)))).toBe(false);
    expect(fromReception.has(cellKey(worldToCell(STREET)))).toBe(true);
  });

  it("REOPENS the office the moment the lanes are released — re-entry needs nothing else", () => {
    const reopened = floodFill(v1Static, worldToCell(RECEPTION_PUBLIC), 20000);
    expect(reopened.has(cellKey(worldToCell(OFFICE_DEEP)))).toBe(true);
  });

  it("leaves the office internally whole, so a shut gate partitions the building and not a room", () => {
    const fromOffice = floodFill(gated, worldToCell(OFFICE_DEEP), 20000);
    expect(fromOffice.has(cellKey(worldToCell(OFFICE_AT_GATE)))).toBe(true);
    // The lanes are shut in BOTH directions — a cell reservation has no sense of travel. That is why a
    // confirmed checkout does not merely close the gate but also stands the body back on the public side
    // (app/world.ts ejectFromOffice): without it, an employee inside when the answer changed would be
    // sealed in behind their own gate. This assertion is what makes that requirement visible.
    expect(fromOffice.has(cellKey(worldToCell(RECEPTION_PAST_GATES)))).toBe(false);
  });
});
