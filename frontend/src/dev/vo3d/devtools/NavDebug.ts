// vo3d devtools — grid / blocked / dynamic / path / destination / selection visuals. Never a dependency of nav.
import * as THREE from "three";
import { CELL, cellCentre, isDoorCell, isStandCell, v1Static, worldToCell, type Cell } from "../adapters/v1Grid";
import { pointInRect, type Rect, type Vec2 } from "../core/coords";
import type { NavResult } from "../nav/planner";
import type { Walkability } from "../nav/Walkability";

export class NavDebug {
  readonly group = new THREE.Group();
  private readonly walkableMesh: THREE.InstancedMesh;
  private readonly blockedMesh: THREE.InstancedMesh;
  private readonly dynMesh: THREE.InstancedMesh;
  private readonly pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x2f6fd6 }));
  private readonly pathDots = new THREE.Group();
  private readonly destRing: THREE.Mesh;
  readonly selRing: THREE.Mesh;
  private readonly dotGeo = new THREE.SphereGeometry(1.1, 10, 8);
  private readonly dotMat = new THREE.MeshBasicMaterial({ color: 0x2f6fd6 });
  cells = 0; walkable = 0;

  constructor(scene: THREE.Scene, floors: Rect[], selRadius: number) {
    this.group.name = "nav-debug";
    scene.add(this.group);
    const cellGeo = new THREE.PlaneGeometry(CELL - 1.2, CELL - 1.2); cellGeo.rotateX(-Math.PI / 2);
    const cells: (Cell & { kind: "w" | "b" | "s" })[] = [];
    for (const f of floors) {
      const c0 = worldToCell({ x: f.x, z: f.z }), c1 = worldToCell({ x: f.x + f.w, z: f.z + f.d });
      for (let cy = c0.cy; cy <= c1.cy; cy++) for (let cx = c0.cx; cx <= c1.cx; cx++) {
        const c = { cx, cy }; if (!pointInRect(cellCentre(c), f)) continue;
        cells.push({ ...c, kind: v1Static(cx, cy) ? (isStandCell(c) || isDoorCell(c) ? "s" : "w") : "b" });
      }
    }
    this.cells = cells.length; this.walkable = cells.filter((c) => c.kind !== "b").length;
    const mk = (color: number, opacity: number, n: number) => new THREE.InstancedMesh(cellGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }), Math.max(1, n));
    this.walkableMesh = mk(0x4caf50, 0.28, cells.length); this.blockedMesh = mk(0xd9463b, 0.28, cells.length);
    const m = new THREE.Matrix4(); let wi = 0, bi = 0;
    for (const c of cells) { const p = cellCentre(c); m.makeTranslation(p.x, 0.35, p.z); if (c.kind === "b") this.blockedMesh.setMatrixAt(bi++, m); else this.walkableMesh.setMatrixAt(wi++, m); }
    this.walkableMesh.count = wi; this.blockedMesh.count = bi; this.walkableMesh.instanceMatrix.needsUpdate = true; this.blockedMesh.instanceMatrix.needsUpdate = true;
    const sGeo = new THREE.PlaneGeometry(CELL * 0.45, CELL * 0.45); sGeo.rotateX(-Math.PI / 2);
    const special = new THREE.InstancedMesh(sGeo, new THREE.MeshBasicMaterial({ color: 0x2f6fd6, transparent: true, opacity: 0.55, depthWrite: false }), Math.max(1, cells.length));
    let si = 0; for (const c of cells) if (c.kind === "s") { const p = cellCentre(c); special.setMatrixAt(si++, m.makeTranslation(p.x, 0.4, p.z)); } special.count = si; special.instanceMatrix.needsUpdate = true;
    this.walkableMesh.add(special);
    this.dynMesh = mk(0xf2b134, 0.5, 64);
    this.destRing = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.4, 32), new THREE.MeshBasicMaterial({ color: 0x2f6fd6, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    this.destRing.rotation.x = -Math.PI / 2; this.destRing.visible = false;
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(selRadius - 0.8, selRadius + 0.6, 40), new THREE.MeshBasicMaterial({ color: 0xf2b134, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    this.selRing.rotation.x = -Math.PI / 2; this.selRing.visible = false;
    this.walkableMesh.visible = false; this.blockedMesh.visible = false; this.dynMesh.visible = false;
    this.group.add(this.walkableMesh, this.blockedMesh, this.dynMesh, this.pathLine, this.pathDots, this.destRing, this.selRing);
  }
  set showGrid(v: boolean) { this.walkableMesh.visible = v; }
  set showBlocked(v: boolean) { this.blockedMesh.visible = v; this.dynMesh.visible = v; }
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
