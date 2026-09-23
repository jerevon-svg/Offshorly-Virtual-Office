// vo3d — THE HIGH-DETAIL ENVIRONMENT FOUNDATION (V2 shared detail pass).
//
// Three things are worth a test here, and the rest is art:
//
//  1. `profileRun`'s AXIS MAPPING. A moulding is a cross-section extruded along a wall, so it has a front
//     and a back — and the arithmetic that lands it on the room side of its wall has four cases (two axes
//     × two directions) whose failure mode is silent: a skirting built inside its own wall looks like no
//     skirting at all. Every existing moulding in the office now comes out of that one function, so this
//     is the single highest-value assertion in the pass.
//  2. `doorCasing` NOT ENTERING THE OPENING. Every door on this floor has a leaf sized to its clear
//     opening; a casing member inside the reveal would be geometry for a leaf to drive through.
//  3. THE CORRIDORS standing only where V1 already reserved the floor. The vending banks, the corner
//     plants and the north window are placed from the V1 art boxes, and V1's own walkability grid blocks
//     exactly those bands — so the grid itself is the assertion, and nothing is taken from a player.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import manifest from "../../data/office-assets-manifest.json";
import { CORNICE, PLINTH, SKIRTING, cornice, doorCasing, profileRun, skirting } from "./build/arch";
import { buildCorridors } from "./build/corridors";
import { VENDING_SIZE, vendingMachine } from "./build/vending";
import { buildFurniture } from "./build/furniture";
import { mat } from "./render/Materials";
import { CELL } from "./adapters/v1Grid";
import { isWalkable } from "../../data/officeGrid";

type Layer = { id: string; kind: string; x: number; y: number; width: number; height: number };
const layer = (id: string): Layer => (manifest as Layer[]).find((l) => l.id === id)!;

const box = (o: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(o);

describe("profileRun — the shared moulding extrusion", () => {
  // The profile is a 1-wide, 2-tall rectangle projecting from 0 to 1 across the mounting plane, so the
  // expected bounds are exact and readable rather than inferred from a real moulding's steps.
  const FLAG = [[0, 0], [1, 0], [1, 2], [0, 2]] as const;

  it("lands the profile on the side of the plane `dir` names, for all four orientations", () => {
    const cases = [
      { axis: "x" as const, dir: 1 as const, expect: { lo: 50, hi: 51 } },
      { axis: "x" as const, dir: -1 as const, expect: { lo: 49, hi: 50 } },
      { axis: "z" as const, dir: 1 as const, expect: { lo: 50, hi: 51 } },
      { axis: "z" as const, dir: -1 as const, expect: { lo: 49, hi: 50 } },
    ];
    for (const c of cases) {
      const m = profileRun(FLAG, { axis: c.axis, at: 50, from: 10, to: 40, y0: 3, dir: c.dir, material: mat("wall") });
      const b = box(m);
      // across the plane: exactly the projected span, on the named side
      const across = c.axis === "x" ? { lo: b.min.z, hi: b.max.z } : { lo: b.min.x, hi: b.max.x };
      expect(across.lo).toBeCloseTo(c.expect.lo, 4);
      expect(across.hi).toBeCloseTo(c.expect.hi, 4);
      // along the run: from → to, whichever axis it runs on
      const along = c.axis === "x" ? { lo: b.min.x, hi: b.max.x } : { lo: b.min.z, hi: b.max.z };
      expect(along.lo).toBeCloseTo(10, 4);
      expect(along.hi).toBeCloseTo(40, 4);
      // and vertically it sits ON y0, never through it
      expect(b.min.y).toBeCloseTo(3, 4);
      expect(b.max.y).toBeCloseTo(5, 4);
    }
  });

  it("is ONE mesh whatever the silhouette — the whole reason a profile beats a box stack", () => {
    for (const p of [SKIRTING, CORNICE, PLINTH]) {
      const m = profileRun(p, { axis: "x", at: 0, from: 0, to: 100, y0: 0, material: mat("wall") });
      expect(m.isMesh).toBe(true);
      expect(m.children).toHaveLength(0);
      // a real profile has more than the four corners a box has
      expect(m.geometry.attributes.position.count).toBeGreaterThan(24);
    }
  });

  it("normalises winding, so a mirrored run is not built inside-out", () => {
    // the two directions must enclose the same volume; a flipped winding shows up as inverted normals,
    // and the cheapest stable proxy for that is the summed normal against the projection direction
    const outward = (dir: 1 | -1): number => {
      const m = profileRun(SKIRTING, { axis: "z", at: 0, from: 0, to: 10, y0: 0, dir, material: mat("wall") });
      const n = m.geometry.attributes.normal;
      let sum = 0;
      for (let i = 0; i < n.count; i++) sum += n.getX(i);
      return sum * dir;
    };
    // the face pointing OUT of the wall dominates either way round
    expect(outward(1)).toBeGreaterThan(0);
    expect(outward(-1)).toBeGreaterThan(0);
  });

  it("skirting sits on the floor and cornice hangs from the wall top", () => {
    const run = { axis: "x" as const, at: 100, from: 0, to: 200, y0: 0, dir: 1 as const, key: "wall" as const };
    expect(box(skirting(run)).min.y).toBeCloseTo(0, 4);
    const c = box(cornice({ ...run, wallHeight: 46 }));
    expect(c.max.y).toBeCloseTo(46, 4);
    expect(c.min.y).toBeCloseTo(39, 4);
  });
});

describe("doorCasing — an architrave that never enters the opening", () => {
  const spec = { axis: "x" as const, at: 300, thickness: 12, from: 688, to: 768, height: 36, casing: "wood" as const, threshold: "metal" as const };

  it("puts no vertex at all inside the clear opening — the leaf's own volume", () => {
    // the casing is BAKED by material, so a per-child bounding box is the union of several members and
    // says nothing. The claim is about the reveal being EMPTY, so the vertices are what to ask.
    const g = doorCasing(spec);
    const v = new THREE.Vector3();
    let checked = 0;
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position;
      m.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        checked++;
        const inOpeningSpan = v.x > spec.from + 0.01 && v.x < spec.to - 0.01;
        const belowHead = v.y > 0.35 && v.y < spec.height - 0.01; // above the flush threshold strip
        expect(inOpeningSpan && belowHead).toBe(false);
      }
    });
    expect(checked).toBeGreaterThan(50);
  });

  it("lays the threshold flush, so a sliding leaf still clears it", () => {
    const g = doorCasing(spec);
    const strip = g.children.find((c) => box(c).max.y <= 0.35);
    expect(strip).toBeDefined();
    const b = box(strip!);
    expect(b.max.y).toBeLessThanOrEqual(0.35);
    expect(b.min.x).toBeCloseTo(spec.from, 4);
    expect(b.max.x).toBeCloseTo(spec.to, 4);
  });

  it("bakes the casing, so a whole doorway is a couple of draw calls", () => {
    const meshes: THREE.Mesh[] = [];
    doorCasing(spec).traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeLessThanOrEqual(3); // six members on two faces + the strip, baked
  });
});

describe("the vending machine — stock that reads as stock", () => {
  const machine = vendingMachine({ axis: "z", at: 344, dir: 1, along: 91, kind: "drinks" });

  it("stands in its declared footprint against the wall it is given", () => {
    const b = box(machine);
    expect(b.min.x).toBeGreaterThanOrEqual(344 - 0.6);
    expect(b.max.x).toBeLessThanOrEqual(344 + VENDING_SIZE.d + 2.5); // the case frame stands proud
    expect(b.max.y).toBeLessThanOrEqual(VENDING_SIZE.h + 1.5);
    expect(b.max.z - b.min.z).toBeLessThanOrEqual(VENDING_SIZE.w + 2);
  });

  it("models the goods rather than painting them — several colourways, real geometry, few draw calls", () => {
    const meshes: THREE.Mesh[] = [];
    machine.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const stock = meshes.filter((m) => m.name.includes("-stock"));
    expect(stock.length).toBeGreaterThanOrEqual(3); // one bake per colourway: organised rows, not one blob
    const tris = stock.reduce((n, m) => n + (m.geometry.attributes.position.count / 3), 0);
    expect(tris).toBeGreaterThan(300); // cans with seamed rims and tapered necks, not boxes
    // and the whole machine still costs about what a piece of furniture costs
    // carcass + racks + three stock bakes + glass + strip + wash + UI + LED + the bay's own pieces
    expect(meshes.length).toBeLessThanOrEqual(16);
  });

  it("puts racks behind glass with real depth, and one warm strip light inside", () => {
    const meshes: THREE.Mesh[] = [];
    machine.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.some((m) => m.name.includes("-racks"))).toBe(true);
    const glass = meshes.find((m) => (m.material as THREE.MeshStandardMaterial).transparent);
    expect(glass).toBeDefined();
    const b = box(glass!);
    expect(b.max.x - b.min.x).toBeGreaterThan(0.5); // a BOX, not a zero-thickness plane
    const lit = meshes.filter((m) => {
      const mm = m.material as THREE.MeshStandardMaterial;
      return mm.emissiveIntensity !== undefined && mm.emissiveIntensity > 0.5;
    });
    expect(lit.length).toBeGreaterThan(0);
  });

  it("sells all three kinds the V1 panels show", () => {
    for (const kind of ["snack", "drinks", "combo"] as const) {
      const m = vendingMachine({ axis: "x", at: 100, dir: -1, along: 50, kind });
      expect(box(m).max.y).toBeGreaterThan(30);
    }
  });
});

describe("the service corridors — V1's composition, on floor V1 already blocked", () => {
  const corridors = buildCorridors();
  const groups = corridors.children.filter((c) => c.name.startsWith("corridor:"));

  it("builds both of V1's corridors, between the room faces the art box spans", () => {
    expect(groups.map((g) => g.name)).toEqual(["corridor:ai-executive", "corridor:executive-dev"]);
    // the two manifest decor boxes ARE these two corridors, which is what makes the placement V1's
    for (const [id, x0, x1] of [["vendo-machine-left", 344, 494], ["vendo-machine-right", 958, 1111]] as const) {
      const l = layer(id);
      expect(l.x).toBeLessThanOrEqual(x0);
      expect(l.x + l.width).toBeGreaterThanOrEqual(x1);
    }
  });

  it("stands four machines per corridor, two against each side wall", () => {
    const names: string[] = [];
    // only the machine GROUPS: `Baker.bakeInto` names its output `<group name>-N`, so a plain prefix
    // match over traverse() would count every bake as another machine
    corridors.traverse((o) => { if ((o as THREE.Group).isGroup && o.name.startsWith("vending:")) names.push(o.name); });
    expect(names).toHaveLength(8);
    for (const c of ["ai-executive", "executive-dev"]) {
      expect(names.filter((n) => n.includes(`${c}:west:`))).toHaveLength(2);
      expect(names.filter((n) => n.includes(`${c}:east:`))).toHaveLength(2);
    }
  });

  it("takes NO walkable floor: every machine stands on cells V1 already blocks", () => {
    const machines: THREE.Object3D[] = [];
    corridors.traverse((o) => { if ((o as THREE.Group).isGroup && o.name.startsWith("vending:")) machines.push(o); });
    for (const m of machines) {
      const b = box(m);
      // sample the machine's own plan footprint on the V1 lattice
      for (let x = b.min.x + 1; x < b.max.x - 1; x += CELL / 2) {
        for (let z = b.min.z + 1; z < b.max.z - 1; z += CELL / 2) {
          const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
          expect(isWalkable(cx, cy)).toBe(false);
        }
      }
    }
  });

  it("closes each corridor's north elevation with a framed glass run on the rooms' own wall band", () => {
    for (const g of groups) {
      const run = g.children.find((c) => c.name === "glass-run");
      expect(run).toBeDefined();
      const b = box(run!);
      // the whole assembly — including glassRun's deliberately wide capping rail — stays inside the
      // band the rooms either side put their own north wall in, so the elevation is continuous
      expect(b.min.z).toBeGreaterThanOrEqual(8);
      expect(b.max.z).toBeLessThanOrEqual(20);
      expect(b.max.y).toBeGreaterThan(40); //          full height, not a balustrade
      // and the planting V1 shows through it sits OUTSIDE the glass
      const hedge = g.children.find((c) => c.name === "corridor-hedge");
      expect(hedge).toBeDefined();
      expect(box(hedge!).max.z).toBeLessThanOrEqual(b.min.z);
    }
  });

  it("plants the two north corners of each corridor, and hands its sway up for the shared system", () => {
    expect((corridors.userData.sway as unknown[]).length).toBeGreaterThan(0);
    for (const g of groups) {
      // mediumPlant returns an un-named group; a plant is the thing with a sway-bearing stem subtree
      const plants = g.children.filter((c) => c.name === "" && c.children.length >= 5);
      expect(plants.length).toBeGreaterThanOrEqual(2);
      for (const p of plants) expect(box(p).min.z).toBeGreaterThan(20);
    }
  });

  it("instances every machine-top pot, so the whole floor's top planting is three draw calls", () => {
    const instanced: THREE.InstancedMesh[] = [];
    corridors.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) instanced.push(o as THREE.InstancedMesh); });
    expect(instanced).toHaveLength(3); // pots, soil, leaves — finalizeSucculents' triple
    expect(instanced[0].count).toBe(16); // two per machine, eight machines
  });
});

describe("furniture detail — the contracts the new geometry must not break", () => {
  it("keeps the desk top surface at DESK_H, now that it is an extruded slab and not a box", () => {
    const desk = buildFurniture({ kind: "member-desk", rect: { x: 0, z: 0, w: 60, d: 40 }, facing: "north", mirrored: false });
    // `slab` puts the TOP face at y0 + t, and every laptop, mug and pot on a desk is placed at DESK_H
    const top = desk.children.find((c) => (c as THREE.Mesh).isMesh && box(c).max.y > 23 && box(c).max.y < 25);
    expect(top).toBeDefined();
    expect(box(top!).max.y).toBeCloseTo(24, 1);
  });

  it("gives a rug a visible edge instead of a flat plate", () => {
    for (const shape of [undefined, "rect" as const]) {
      const rug = buildFurniture({ kind: "rug", rect: { x: 0, z: 0, w: 120, d: 90 }, facing: "north", mirrored: false, shape });
      const b = box(rug);
      expect(b.max.y).toBeGreaterThan(0.9); // was 0.7 of plate with a 1.6 radius: no edge at all
      expect(b.max.y).toBeLessThan(1.6); //    still a rug, not a plinth
    }
  });

  it("never lets a chair grow past its declared plan radius, whatever the new base detail", () => {
    const rect = { x: 0, z: 0, w: 30, d: 30 };
    const chair = buildFurniture({ kind: "chair-a", rect, facing: "north", mirrored: false });
    const b = box(chair);
    const seatW = Math.min(rect.w, rect.d) * 0.8;
    const limit = seatW * 0.52 * 0.97 + 1.2; // chairPlanRadius, plus the caster's own tyre
    expect(Math.max(b.max.x - 15, 15 - b.min.x)).toBeLessThanOrEqual(limit);
  });
});
