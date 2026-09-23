import { describe, expect, it } from "vitest";
import { CELL, isWalkable } from "../../data/officeGrid";
import { ROOM, FURNITURE } from "./layout";
import { ROUTE, blockedRects, pointInRect } from "./avatar";
import { frameCentreToGround, groundToFrameCentre, groundToTopLeft, planWalk, roomGridCells, topLeftToGround } from "./nav";

describe("design room 3d — production A* adapter", () => {
  it("maps ground ↔ frame ↔ top-left losslessly", () => {
    const g = { x: 123.4, z: 56.7 };
    const rt = frameCentreToGround(groundToFrameCentre(g));
    expect(rt.x).toBeCloseTo(g.x, 9);
    expect(rt.z).toBeCloseTo(g.z, 9);
    const back = topLeftToGround(groundToTopLeft(g));
    expect(back.x).toBeCloseTo(g.x, 9);
    expect(back.z).toBeCloseTo(g.z, 9);
    expect(groundToFrameCentre({ x: 0, z: 0 })).toEqual({ x: ROOM.x, y: ROOM.y });
  });

  it("exposes this room's window of the production grid with walkable cells clear of 3D furniture", () => {
    const cells = roomGridCells();
    expect(cells.length).toBeGreaterThan(150);
    const walkable = cells.filter((c) => c.kind !== "blocked");
    expect(walkable.length).toBeGreaterThanOrEqual(90); // 95 cells incl. stand/door cells
    // production walkability was authored against the same manifest footprints the 3D furniture uses.
    // KNOWN TOLERANCE: the 2D grid treats the sprite CENTRE as the occupied point, so a walkable cell
    // centre may sit right at a furniture edge (row 32 grazes the bottom cabinets' front by < 1 unit);
    // in 3D that reads as the character's body clipping the cabinet front. Assert nothing deeper.
    const solid = blockedRects(-1).filter((r) => !FURNITURE.some((f) => f.kind === "rug" && f.rect === r));
    const deep = walkable.filter((c) => c.kind === "walkable" && solid.some((r) => pointInRect(c.centre.x, c.centre.z, r)));
    expect(deep.map((c) => `${c.cx},${c.cy}`)).toEqual([]);
    expect(cells.some((c) => c.kind === "door")).toBe(true);
    expect(cells.some((c) => c.kind === "stand")).toBe(true);
  });

  it("rejects clicks outside the room and on blocked cells, and resolves valid clicks to the cell centre", () => {
    const from = ROUTE[0];
    expect(planWalk(from, { x: -20, z: 100 })).toMatchObject({ ok: false, reason: "outside-room" });
    // lead desk footprint is blocked
    const lead = FURNITURE.find((f) => f.kind === "lead-desk")!.rect;
    const onDesk = planWalk(from, { x: lead.x + lead.w / 2, z: lead.z + lead.d / 2 });
    expect(onDesk.ok).toBe(false);
    if (!onDesk.ok) expect(onDesk.reason).toBe("unwalkable");
    // open floor south-east
    const r = planWalk(from, { x: 270, z: 190 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const c = groundToFrameCentre(r.destination);
      expect(c.x % CELL).toBeCloseTo(CELL / 2, 6);
      expect(c.y % CELL).toBeCloseTo(CELL / 2, 6);
      expect(isWalkable(r.cell.cx, r.cell.cy)).toBe(true);
      expect(r.path.length).toBeGreaterThan(0);
      const last = r.path[r.path.length - 1];
      expect(last.x).toBeCloseTo(r.destination.x, 6);
      expect(last.z).toBeCloseTo(r.destination.z, 6);
    }
  });

  it("routes around the desk U instead of through it (multi-waypoint A* path, every leg on walkable cells)", () => {
    // from the south-east floor to the north aisle: a straight line crosses the right desk column
    const r = planWalk({ x: 270, z: 190 }, { x: 155, z: 56 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path.length).toBeGreaterThanOrEqual(2);
    const pts = [{ x: 270, z: 190 }, ...r.path];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      for (let d = 0; d <= len; d += 2) {
        const t = len === 0 ? 0 : d / len;
        const f = groundToFrameCentre({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
        expect(isWalkable(Math.floor(f.x / CELL), Math.floor(f.y / CELL)), `leg ${i} leaves the walkable grid`).toBe(true);
      }
    }
  });

  it("classifies the production grid's islanded stand cells as unreachable (not unwalkable) — a production quirk, unchanged", () => {
    // Row 30, cells 4 and 5 (the sofa/side-desk stand spot and its neighbour) are walkable in the
    // production grid but 4-connected to nothing else; production classifyDestination reports them
    // invalid and the adapter surfaces that as "unreachable". Every other walkable cell is reachable.
    const cells = roomGridCells().filter((c) => c.kind !== "blocked");
    const results = cells.map((c) => ({ key: `${c.cx},${c.cy}`, r: planWalk(ROUTE[0], c.centre) }));
    const bad = results.filter((x) => !x.r.ok);
    expect(bad.map((x) => x.key).sort()).toEqual(["4,30", "5,30"]);
    expect(bad.every((x) => !x.r.ok && x.r.reason === "unreachable")).toBe(true);
  });
});
