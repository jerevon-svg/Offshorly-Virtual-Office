// vo3d env — THE LITERAL BOLT. One line object, for the whole life of the world.
//
// WHY THIS IS CHEAP ENOUGH TO EXIST. The obvious lightning bolt is particles, a shader, or a fresh
// geometry per strike — all three of which this is not. There is ONE THREE.LineSegments here, its vertex
// buffer is allocated once at construction, and a strike REWRITES those floats in place. No allocation
// per strike, no material recompile, no light, no shadow invalidation: 56 vertices and one draw call,
// drawn only on the ~300 ms a year the sky is actually lit.
//
// IT HAS NO CLOCK. The bolt does not decide when it appears or how long it lasts — it is handed the
// environment's existing `flash` number every frame and sets its own opacity from it. So it is
// synchronised with the exposure pop, the sky flash and the ThunderEvent by construction rather than by
// agreement, and a double strike lights it twice because the flash itself does.
import * as THREE from "three";

/** segments down the main channel, and the two branches that come off it */
const TRUNK = 18;
const BRANCH = 5;
const BRANCHES = 2;
const VERTS = (TRUNK + BRANCH * BRANCHES) * 2;

/** how far out the fiction puts a bolt, in world units, at its nearest and its furthest */
const RANGE = { near: 2600, far: 9000 };
/** the top of the channel and the ground it reaches, in world units */
const SKY_Y = 2400;
const GROUND_Y = -40;
/** below this flash the bolt is not drawn at all — most of a flash's tail is not worth a draw call */
const VISIBLE_AT = 0.06;

export class Bolt {
  readonly object: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly material: THREE.LineBasicMaterial;
  private seed = 0x1a2b3c4d;
  /** how bright THIS bolt is allowed to get — a far strike draws a thinner, dimmer channel */
  private peak = 0;
  private shown = -1;

  constructor() {
    this.positions = new Float32Array(VERTS * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    // a bounding sphere big enough for anywhere the channel can be drawn, computed once: without it
    // three recomputes one from the buffer on every write, which is the only per-strike cost worth avoiding
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, SKY_Y / 2, 0), RANGE.far + SKY_Y);
    this.material = new THREE.LineBasicMaterial({
      color: 0xdce8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.object = new THREE.LineSegments(geo, this.material);
    this.object.frustumCulled = false; // one 56-vertex line; culling it costs more than drawing it
    this.object.visible = false;
    this.object.renderOrder = 5;
  }

  /** DRAW A NEW CHANNEL. Called from the strike, with the same distance the ThunderEvent carries, so the
   *  bolt you see is at the distance the clap you hear is delayed by. Writes floats; allocates nothing. */
  strike(distanceKm: number, centre: THREE.Vector3): void {
    const far = Math.min(1, Math.max(0, (distanceKm - 0.8) / 11));
    const dist = RANGE.near + (RANGE.far - RANGE.near) * far;
    const bearing = this.rand() * Math.PI * 2;
    const x0 = centre.x + Math.sin(bearing) * dist;
    const z0 = centre.z + Math.cos(bearing) * dist;
    // the channel wanders more the closer it is — a distant bolt is a near-straight thread
    const wander = 130 * (1 - far) + 35;
    const p = this.positions;
    let v = 0;
    const put = (x: number, y: number, z: number): void => { p[v++] = x; p[v++] = y; p[v++] = z; };

    let x = x0, z = z0, y = SKY_Y;
    const step = (SKY_Y - GROUND_Y) / TRUNK;
    // remember a couple of points on the trunk to hang branches from
    const forks: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < TRUNK; i++) {
      const nx = x + (this.rand() - 0.5) * wander;
      const nz = z + (this.rand() - 0.5) * wander * 0.4;
      const ny = y - step;
      put(x, y, z);
      put(nx, ny, nz);
      if (i === 5 || i === 10) forks.push({ x: nx, y: ny, z: nz });
      x = nx; y = ny; z = nz;
    }
    for (let b = 0; b < BRANCHES; b++) {
      const f = forks[b] ?? { x, y, z };
      let bx = f.x, by = f.y, bz = f.z;
      const dir = this.rand() < 0.5 ? -1 : 1;
      for (let i = 0; i < BRANCH; i++) {
        const nx = bx + dir * (40 + this.rand() * wander * 0.6);
        const ny = by - step * (0.35 + this.rand() * 0.4);
        const nz = bz + (this.rand() - 0.5) * wander * 0.3;
        put(bx, by, bz);
        put(nx, ny, nz);
        bx = nx; by = ny; bz = nz;
      }
    }
    (this.object.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    // a far bolt is dimmer AND thinner-looking; opacity is the only channel a LineBasicMaterial gives us
    this.peak = 0.35 + 0.65 * (1 - far);
  }

  /** RIDE THE EXISTING FLASH. One comparison on a frame where nothing changed, one opacity write when it
   *  did. `presentable` is false wherever there is no sky to draw a bolt against — OFFICE and the sealed
   *  CAVE — and the bolt is simply not shown there. */
  setFlash(flash: number, presentable: boolean): void {
    const want = presentable ? flash * this.peak : 0;
    if (Math.abs(want - this.shown) < 0.004) return;
    this.shown = want;
    const on = want > VISIBLE_AT;
    this.object.visible = on;
    if (on) this.material.opacity = Math.min(1, want);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.material.dispose();
  }

  /** the same LCG everything deterministic in this folder uses */
  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }
}
