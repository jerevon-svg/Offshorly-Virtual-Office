// vo3d devtools — grid / blocked / unbuilt / dynamic / regions / openings / path / destination / selection
// visuals over the WHOLE ground floor. Never a dependency of nav.
import * as THREE from "three";
import { CELL, cellCentre, isDoorCell, isStandCell, worldToCell, type Cell } from "../adapters/v1Grid";
import { pointInRect, type Rect, type Vec2 } from "../core/coords";
import type { NavResult } from "../nav/planner";
import type { CellPredicate } from "../nav/pathfind";
import type { Walkability } from "../nav/Walkability";
import type { DoorCapability, WorldRegion } from "../world/WorldState";
import type { Bucket, DiagnosticReport } from "../nav/diagnostics";
import type { DoorOpening } from "../adapters/v1Floor";

export type NavDebugWorld = {
  bounds: Rect;
  /** the composed static layer (V1 grid AND inside a walkable region) */
  walkable: CellPredicate;
  /** the raw V1 grid, to show interiors V1 knows but the world does not model yet */
  v1: CellPredicate;
  regions: readonly WorldRegion[];
  openings: readonly DoorOpening[];
  /** automatic doors: crossing band (blue), trigger (amber), clearance solids (red) */
  doors?: readonly DoorCapability[];
};

const REGION_COLOUR: Record<string, number> = { "room-floor": 0xd23fbf, "shared-floor": 0xfaf8f5, exterior: 0x27b0c4 };

export class NavDebug {
  readonly group = new THREE.Group();
  private readonly walkableMesh: THREE.InstancedMesh;
  private readonly blockedMesh: THREE.InstancedMesh;
  private readonly unbuiltMesh: THREE.InstancedMesh;
  private readonly dynMesh: THREE.InstancedMesh;
  private readonly regionLines = new THREE.Group();
  private readonly pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x2f6fd6 }));
  private readonly pathDots = new THREE.Group();
  private readonly destRing: THREE.Mesh;
  readonly selRing: THREE.Mesh;
  /** V1 ↔ derived-V2 comparison, one instanced layer per bucket (nav/diagnostics.ts) */
  private readonly diagMeshes: Record<Bucket, THREE.InstancedMesh>;
  private readonly strandedMesh: THREE.InstancedMesh;
  private readonly dotGeo = new THREE.SphereGeometry(1.1, 10, 8);
  private readonly dotMat = new THREE.MeshBasicMaterial({ color: 0x2f6fd6 });
  cells = 0; walkable = 0; unbuilt = 0;

  constructor(scene: THREE.Scene, world: NavDebugWorld, selRadius: number) {
    this.group.name = "nav-debug";
    scene.add(this.group);
    const cellGeo = new THREE.PlaneGeometry(CELL - 1.2, CELL - 1.2); cellGeo.rotateX(-Math.PI / 2);
    const cells: (Cell & { kind: "w" | "b" | "s" | "u" })[] = [];
    const f = world.bounds;
    const c0 = worldToCell({ x: f.x, z: f.z }), c1 = worldToCell({ x: f.x + f.w - 1e-6, z: f.z + f.d - 1e-6 });
    for (let cy = c0.cy; cy <= c1.cy; cy++) for (let cx = c0.cx; cx <= c1.cx; cx++) {
      const c = { cx, cy }; if (!pointInRect(cellCentre(c), f)) continue;
      const kind = world.walkable(cx, cy) ? (isStandCell(c) || isDoorCell(c) ? "s" : "w") : world.v1(cx, cy) ? "u" : "b";
      cells.push({ ...c, kind });
    }
    this.cells = cells.length; this.walkable = cells.filter((c) => c.kind === "w" || c.kind === "s").length; this.unbuilt = cells.filter((c) => c.kind === "u").length;
    const mk = (color: number, opacity: number, n: number) => new THREE.InstancedMesh(cellGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }), Math.max(1, n));
    this.walkableMesh = mk(0x4caf50, 0.28, cells.length); this.blockedMesh = mk(0xd9463b, 0.28, cells.length); this.unbuiltMesh = mk(0x8d8d8d, 0.32, cells.length);
    const m = new THREE.Matrix4(); let wi = 0, bi = 0, ui = 0;
    for (const c of cells) {
      const p = cellCentre(c); m.makeTranslation(p.x, 0.35, p.z);
      if (c.kind === "b") this.blockedMesh.setMatrixAt(bi++, m); else if (c.kind === "u") this.unbuiltMesh.setMatrixAt(ui++, m); else this.walkableMesh.setMatrixAt(wi++, m);
    }
    this.walkableMesh.count = wi; this.blockedMesh.count = bi; this.unbuiltMesh.count = ui;
    this.walkableMesh.instanceMatrix.needsUpdate = true; this.blockedMesh.instanceMatrix.needsUpdate = true; this.unbuiltMesh.instanceMatrix.needsUpdate = true;
    const sGeo = new THREE.PlaneGeometry(CELL * 0.45, CELL * 0.45); sGeo.rotateX(-Math.PI / 2);
    const special = new THREE.InstancedMesh(sGeo, new THREE.MeshBasicMaterial({ color: 0x2f6fd6, transparent: true, opacity: 0.55, depthWrite: false }), Math.max(1, cells.length));
    let si = 0; for (const c of cells) if (c.kind === "s") { const p = cellCentre(c); special.setMatrixAt(si++, m.makeTranslation(p.x, 0.4, p.z)); } special.count = si; special.instanceMatrix.needsUpdate = true;
    this.walkableMesh.add(special);
    this.dynMesh = mk(0xf2b134, 0.5, 64);
    // THE MIGRATION'S SAFETY NET, drawn: agreement is muted, disagreement is loud. Amber = floor the 2D
    // painting wrongly blocked and geometry gives back; RED = floor V1 allowed and geometry refuses, the
    // only bucket that ever needs auditing. Magenta = walkable but unreachable, which is a bug either way.
    this.diagMeshes = {
      "agree-walk": mk(0x2fbf71, 0.20, cells.length),
      "agree-block": mk(0x5a5a5a, 0.18, cells.length),
      "legacy-open": mk(0xf2b134, 0.55, cells.length),
      "v2-obstruction": mk(0xd9463b, 0.60, cells.length),
    };
    this.strandedMesh = mk(0xd23fbf, 0.75, 256);
    // regions: outline per region (holes too); openings: blue frames across the wall band; bounds: white
    for (const r of world.regions) {
      const col = r.kind === "room-floor" && r.walkable ? 0x2fbf71 : REGION_COLOUR[r.kind] ?? 0xffffff;
      this.regionLines.add(loop(r.rect, col, r.walkable ? 1.2 : 1.0));
      for (const h of r.holes ?? []) this.regionLines.add(loop(h, 0xd23fbf, 1.1));
    }
    this.regionLines.add(loop(world.bounds, 0xffffff, 1.4));
    for (const o of world.openings) {
      const along = o.to - o.from, band = 10;
      const rect: Rect = o.side === "north" || o.side === "south" ? { x: o.from, z: o.centre.z - band / 2, w: along, d: band } : { x: o.centre.x - band / 2, z: o.from, w: band, d: along };
      this.regionLines.add(loop(rect, 0x2f6fd6, 1.6));
    }
    for (const d of world.doors ?? []) {
      this.regionLines.add(loop(d.trigger, 0xf2b134, 1.3));
      this.regionLines.add(loop(d.crossing, 0x2f6fd6, 1.5));
      for (const s of d.clearance.solids) this.regionLines.add(loop(s, 0xd9463b, 1.5));
    }
    this.destRing = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.4, 32), new THREE.MeshBasicMaterial({ color: 0x2f6fd6, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    this.destRing.rotation.x = -Math.PI / 2; this.destRing.visible = false;
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(selRadius - 0.8, selRadius + 0.6, 40), new THREE.MeshBasicMaterial({ color: 0xf2b134, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    this.selRing.rotation.x = -Math.PI / 2; this.selRing.visible = false;
    this.walkableMesh.visible = false; this.blockedMesh.visible = false; this.unbuiltMesh.visible = false; this.dynMesh.visible = false; this.regionLines.visible = false;
    for (const m2 of Object.values(this.diagMeshes)) m2.visible = false;
    this.strandedMesh.visible = false;
    this.group.add(this.walkableMesh, this.blockedMesh, this.unbuiltMesh, this.dynMesh, this.regionLines, this.pathLine, this.pathDots, this.destRing, this.selRing, ...Object.values(this.diagMeshes), this.strandedMesh);
  }
  set showGrid(v: boolean) { this.walkableMesh.visible = v; this.unbuiltMesh.visible = v; }
  set showBlocked(v: boolean) { this.blockedMesh.visible = v; this.dynMesh.visible = v; }
  set showRegions(v: boolean) { this.regionLines.visible = v; }
  set showDiagnostic(v: boolean) { for (const m of Object.values(this.diagMeshes)) m.visible = v; this.strandedMesh.visible = v; }
  /** paint the V1 ↔ derived comparison over the governed cells */
  setDiagnostic(report: DiagnosticReport, verdicts: { cell: Cell; bucket: Bucket }[]): void {
    const m = new THREE.Matrix4();
    const n: Record<Bucket, number> = { "agree-walk": 0, "agree-block": 0, "legacy-open": 0, "v2-obstruction": 0 };
    for (const v of verdicts) {
      const p = cellCentre(v.cell);
      this.diagMeshes[v.bucket].setMatrixAt(n[v.bucket]++, m.makeTranslation(p.x, 0.5, p.z));
    }
    for (const [k, mesh] of Object.entries(this.diagMeshes)) { mesh.count = n[k as Bucket]; mesh.instanceMatrix.needsUpdate = true; }
    report.strandedCells.slice(0, 256).forEach((c, i) => { const p = cellCentre(c); this.strandedMesh.setMatrixAt(i, m.makeTranslation(p.x, 0.55, p.z)); });
    this.strandedMesh.count = Math.min(256, report.strandedCells.length);
    this.strandedMesh.instanceMatrix.needsUpdate = true;
  }
  set showPath(v: boolean) { this.pathLine.visible = v; this.pathDots.visible = v; }
  showDestination = true;
  refreshDynamic(w: Walkability): number {
    const keys = w.dynamicBlockedKeys; const m = new THREE.Matrix4();
    keys.slice(0, 64).forEach((k, i) => { const [cx, cy] = k.split(",").map(Number); const p = cellCentre({ cx, cy }); this.dynMesh.setMatrixAt(i, m.makeTranslation(p.x, 0.45, p.z)); });
    this.dynMesh.count = Math.min(64, keys.length); this.dynMesh.instanceMatrix.needsUpdate = true;
    return keys.length;
  }
  showNav(from: Vec2, result: NavResult): void {
    this.pathDots.clear(); this.pathLine.geometry.dispose();
    if (result.ok) {
      this.pathLine.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(from.x, 0.8, from.z), ...result.path.map((p) => new THREE.Vector3(p.x, 0.8, p.z))]);
      for (const p of result.path) { const d = new THREE.Mesh(this.dotGeo, this.dotMat); d.position.set(p.x, 0.9, p.z); this.pathDots.add(d); }
      this.destRing.position.set(result.destination.x, 0.6, result.destination.z); (this.destRing.material as THREE.MeshBasicMaterial).color.set(0x2f6fd6); this.destRing.visible = this.showDestination;
    } else {
      this.pathLine.geometry = new THREE.BufferGeometry();
      if (result.destination) { this.destRing.position.set(result.destination.x, 0.6, result.destination.z); (this.destRing.material as THREE.MeshBasicMaterial).color.set(0xd9463b); this.destRing.visible = this.showDestination; }
      else this.destRing.visible = false;
    }
  }
  clearNav(): void { this.destRing.visible = false; this.pathDots.clear(); this.pathLine.geometry.dispose(); this.pathLine.geometry = new THREE.BufferGeometry(); }
  showSelection(pos: Vec2 | null, valid: boolean): void {
    this.selRing.visible = pos !== null;
    if (pos) { this.selRing.position.set(pos.x, 0.7, pos.z); (this.selRing.material as THREE.MeshBasicMaterial).color.set(valid ? 0xf2b134 : 0xd9463b); }
  }
}

function loop(r: Rect, color: number, y: number): THREE.LineLoop {
  const pts = [new THREE.Vector3(r.x, y, r.z), new THREE.Vector3(r.x + r.w, y, r.z), new THREE.Vector3(r.x + r.w, y, r.z + r.d), new THREE.Vector3(r.x, y, r.z + r.d)];
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
}
