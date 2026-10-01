// vo3d devtools — THE EXTERIOR GROUND OVERLAY. A flat, see-through map of world/exteriorGround laid over
// the campus: what each surface is, or where a WALK / RIDE footprint may stand, with every solid and the
// campus boundary outlined. Development only — app/world.ts imports this module lazily, the first time
// the toggle is switched on, so it costs nothing until somebody asks for it.
import * as THREE from "three";
import { RIDE_PROFILE, WALK_PROFILE, WORLD_WALK, exteriorGround, type SurfaceKind } from "../world/exteriorGround";

export type GroundOverlayMode = "surface" | "walk" | "ride";

const KIND_COLOUR: Record<SurfaceKind, string> = {
  building: "#b0302a", "lab-interior": "#b0302a", "facade-ledge": "#e8d9b0", sidewalk: "#f3e6c0", ledge: "#c9b27a",
  stair: "#f08a24", ramp: "#f0c024", paving: "#d9d9d9", asphalt: "#555a60", deck: "#d2a86a", lawn: "#5fae4a",
  shore: "#c7b98d", bed: "#6b4a2b", hedge: "#3e5a2a", island: "#7a5a2e", water: "#2f7fd6", kerb: "#999999",
  road: "#222222", terrain: "#00000000",
};

/** world units per texel on the overlay map */
const PITCH = 12;
/** the map covers the whole walkable world (Phase 3B), not just the Offshorly lot */
const MAP = { x: WORLD_WALK.x - WORLD_WALK.r, z: WORLD_WALK.z - WORLD_WALK.r, w: 2 * WORLD_WALK.r, d: 2 * WORLD_WALK.r };

export class GroundOverlay {
  readonly group = new THREE.Group();
  private readonly tex: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cols: number;
  private readonly rows: number;
  constructor() {
    const G = exteriorGround();
    const b = MAP;
    this.group.name = "ground-overlay";
    this.cols = Math.ceil(b.w / PITCH);
    this.rows = Math.ceil(b.d / PITCH);
    const canvas = document.createElement("canvas");
    canvas.width = this.cols;
    canvas.height = this.rows;
    this.ctx = canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(b.w, b.d),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false }),
    );
    // PlaneGeometry lies in x/y; rotating −90° about x puts canvas row 0 (its top) at the plane's −z edge
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(b.x + b.w / 2, 2, b.z + b.d / 2);
    plane.renderOrder = 999;
    this.group.add(plane);

    // every solid, and the campus boundary, as lines
    const pts: number[] = [];
    const seg = (a: THREE.Vector2Like, c: THREE.Vector2Like) => pts.push(a.x, 3, a.y, c.x, 3, c.y);
    for (const s of G.solids) {
      if ("circle" in s) {
        const { x, z, r } = s.circle;
        for (let i = 0; i < 12; i++) {
          const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
          seg({ x: x + Math.cos(a0) * r, y: z + Math.sin(a0) * r }, { x: x + Math.cos(a1) * r, y: z + Math.sin(a1) * r });
        }
      } else {
        const { x, z, hx, hz, cos, sin } = s.box;
        const c = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([lx, lz]) => ({ x: x + lx * cos + lz * sin, y: z - lx * sin + lz * cos }));
        for (let i = 0; i < 4; i++) seg(c[i], c[(i + 1) % 4]);
      }
    }
    // the walkable world's edge
    for (let i = 0; i < 96; i++) {
      const a0 = (i / 96) * Math.PI * 2, a1 = ((i + 1) / 96) * Math.PI * 2;
      seg({ x: WORLD_WALK.x + Math.cos(a0) * WORLD_WALK.r, y: WORLD_WALK.z + Math.sin(a0) * WORLD_WALK.r }, { x: WORLD_WALK.x + Math.cos(a1) * WORLD_WALK.r, y: WORLD_WALK.z + Math.sin(a1) * WORLD_WALK.r });
    }
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.LineBasicMaterial({ color: 0xff2bd6, depthTest: false, transparent: true }),
    );
    lines.renderOrder = 1000;
    this.group.add(lines);
    this.paint("surface");
  }

  /** repaint the map for a mode — surface kinds, or where a footprint of the given radius may stand */
  paint(mode: GroundOverlayMode): void {
    const G = exteriorGround();
    const b = MAP;
    const profile = mode === "ride" ? RIDE_PROFILE : WALK_PROFILE;
    const img = this.ctx.createImageData(this.cols, this.rows);
    const rgba = (hex: string): [number, number, number, number] => {
      const n = parseInt(hex.slice(1, 7), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, hex.length > 7 ? 0 : 255];
    };
    for (let j = 0; j < this.rows; j++)
      for (let i = 0; i < this.cols; i++) {
        const p = { x: b.x + (i + 0.5) * PITCH, z: b.z + (j + 0.5) * PITCH };
        let c: [number, number, number, number];
        if (mode === "surface") c = rgba(KIND_COLOUR[G.groundAt(p).kind]);
        else {
          const o = G.occupancy(p, profile.footRadius, profile);
          c = o.ok ? (profile.slow.has(G.groundAt(p).kind) ? [240, 200, 40, 255] : [40, 200, 90, 255]) : o.reason === "solid" ? [255, 43, 214, 255] : o.reason === "step" ? [240, 120, 30, 255] : [200, 40, 40, 255];
        }
        img.data.set(c, (j * this.cols + i) * 4);
      }
    this.ctx.putImageData(img, 0, 0);
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
    this.tex.dispose();
    this.group.removeFromParent();
  }
}
