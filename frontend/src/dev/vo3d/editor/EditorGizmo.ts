// vo3d editor — the selection + rotation affordance. Pure view: it reads a transform, it never writes one.
//
// Three objects, reused for every selection, never rebuilt per frame:
//   · a boxed outline around the selected piece  → "this is selected"
//   · a floor ring around it                      → the rotation handle (and the raycast target for a turn)
//   · a knob riding the ring at the current yaw   → which way it is facing right now
// Valid / invalid placement is carried by colour, so an illegal drag is visible without reading any text.
import * as THREE from "three";

const VALID = 0xf2b134; // the selection amber NavDebug already uses
const INVALID = 0xd9463b;
const RING_MARGIN = 7;
const MIN_RADIUS = 12;
/** Ceiling on the ring, in world units — a 280-unit-wide piece.
 *
 *  The largest thing the office actually authors is the Executive lounge rug at ~110, so this clamps
 *  nothing real. It exists because the ring is derived from a MEASUREMENT, and a measurement can be wrong:
 *  one child left in world space inside a group that is already positioned drags the bounding box back
 *  toward the world origin and produces a ring hundreds of units across, swallowing the room. That class
 *  of bug is fixed where it happens, but the gizmo should not be the thing that fails when it recurs. */
const MAX_RADIUS = 140;

export class EditorGizmo {
  readonly root = new THREE.Group();
  /** the rotation handle — raycast this BEFORE entities, or a turn reads as a move */
  readonly ring: THREE.Mesh;
  private readonly knob: THREE.Mesh;
  private readonly outline: THREE.LineSegments;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly knobMat: THREE.MeshBasicMaterial;
  private readonly outlineMat: THREE.LineBasicMaterial;
  private readonly box = new THREE.Box3();
  private readonly scratch = new THREE.Box3();
  private readonly toLocal = new THREE.Matrix4();
  private readonly rel = new THREE.Matrix4();
  private radius = MIN_RADIUS;
  private attachedTo: string | null = null;

  constructor(scene: THREE.Scene) {
    this.root.name = "vo3d-editor-gizmo";
    this.root.visible = false;
    this.root.renderOrder = 6;

    this.ringMat = new THREE.MeshBasicMaterial({ color: VALID, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, toneMapped: false });
    const ringGeo = new THREE.RingGeometry(0.94, 1, 72); // unit ring, scaled to the piece
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.name = "editor-rotate-ring";
    this.ring.renderOrder = 6;

    this.knobMat = new THREE.MeshBasicMaterial({ color: VALID, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false });
    const knobGeo = new THREE.SphereGeometry(1, 16, 12);
    this.knob = new THREE.Mesh(knobGeo, this.knobMat);
    this.knob.renderOrder = 7;

    this.outlineMat = new THREE.LineBasicMaterial({ color: VALID, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), this.outlineMat);
    this.outline.renderOrder = 6;

    this.root.add(this.ring, this.knob, this.outline);
    scene.add(this.root);
  }

  /** Hit tolerance for the ring, in world units either side of its radius. */
  static readonly GRAB = 6;
  /** true when `p` (a floor point) lands on the ring band of the current selection */
  onRing(p: { x: number; z: number }, centre: { x: number; z: number }): boolean {
    const d = Math.hypot(p.x - centre.x, p.z - centre.z);
    return Math.abs(d - this.radius) <= EditorGizmo.GRAB;
  }
  get ringRadius(): number { return this.radius; }

  /** Re-measure for a newly selected view. `null` hides everything.
   *  The outline is the piece's own extent, measured once on selection — deliberately the same
   *  axis-aligned reading the logical footprint takes, and cheap enough to never touch a drag frame. */
  attach(view: THREE.Group | null): void {
    this.root.visible = view !== null;
    if (!view) return;
    this.measureLocal(view, this.box);
    const size = new THREE.Vector3();
    this.box.getSize(size);
    const measured = Math.hypot(size.x, size.z) / 2 + RING_MARGIN;
    this.radius = Number.isFinite(measured) ? Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, measured)) : MIN_RADIUS;
    const h = Math.max(size.y, 2);
    this.outline.scale.set(Math.max(size.x, 2), h, Math.max(size.z, 2));
    this.ring.scale.set(this.radius, 1, this.radius);
    this.knob.scale.setScalar(2.2);
    this.outline.position.y = h / 2 + 0.2;
  }

  /** Cheap per-interaction refresh: follow the piece, colour by validity, park the knob at `yaw`. */
  sync(centre: { x: number; z: number }, yaw: number, valid: boolean): void {
    const c = valid ? VALID : INVALID;
    this.ringMat.color.setHex(c); this.knobMat.color.setHex(c); this.outlineMat.color.setHex(c);
    this.ring.position.set(centre.x, 0.9, centre.z);
    this.outline.position.x = centre.x; this.outline.position.z = centre.z;
    // model forward is +z at yaw 0 (core/coords), so the knob shows the piece's facing, not an arbitrary mark
    this.knob.position.set(centre.x + Math.sin(yaw) * this.radius, 1.6, centre.z + Math.cos(yaw) * this.radius);
  }
  /** The selection's extent in ITS OWN frame, not the world's.
   *
   *  `Box3.setFromObject` reads world matrices, so a piece measured that way is only as local as its
   *  geometry happens to be: a child that carries world coordinates inside a group that is already
   *  positioned puts a corner of the box near the world origin, and the ring then spans half the office.
   *  Re-expressing every child in the view's own frame makes the ring describe the OBJECT — the same
   *  number wherever in the building the piece is standing, and the same for a newly placed asset as for
   *  the authored one beside it.
   *
   *  An instanced child is measured by its INSTANCES, not by the one leaf its geometry describes — a
   *  plant is almost entirely instanced foliage, and reading the geometry alone would ring it at the
   *  minimum radius however big it is. Those instance matrices are local to the instanced mesh, so they
   *  are carried into the view's frame with everything else. */
  private measureLocal(view: THREE.Group, into: THREE.Box3): void {
    view.updateWorldMatrix(true, true);
    this.toLocal.copy(view.matrixWorld).invert();
    into.makeEmpty();
    view.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const inst = mesh as unknown as THREE.InstancedMesh;
      if (!mesh.isMesh && !inst.isInstancedMesh) return;
      let bb: THREE.Box3 | null = null;
      if (inst.isInstancedMesh) {
        if (!inst.boundingBox) inst.computeBoundingBox();
        bb = inst.boundingBox;
      } else {
        const geo = mesh.geometry;
        if (!geo) return;
        if (!geo.boundingBox) geo.computeBoundingBox();
        bb = geo.boundingBox;
      }
      // An EMPTY bounding box is +Infinity/-Infinity, and transforming that yields NaN — which then
      // poisons the union, the radius and finally the ring's scale, leaving no gizmo at all. Geometry
      // with no vertices is real (a finalized succulent anchor, a placeholder), so it is skipped here.
      if (!bb || bb.isEmpty()) return;
      this.scratch.copy(bb).applyMatrix4(this.rel.multiplyMatrices(this.toLocal, mesh.matrixWorld));
      into.union(this.scratch);
    });
    if (into.isEmpty()) into.set(new THREE.Vector3(-MIN_RADIUS, 0, -MIN_RADIUS), new THREE.Vector3(MIN_RADIUS, 2, MIN_RADIUS));
  }

  /** Re-measure only when the SELECTION changed — measuring is a traversal and must not touch a drag frame. */
  attachIfNeeded(id: string, view: THREE.Group | null): void {
    if (this.attachedTo === id && this.root.visible) return;
    this.attachedTo = id;
    this.attach(view);
  }
  hide(): void { this.root.visible = false; this.attachedTo = null; }
  dispose(): void {
    this.root.removeFromParent();
    for (const o of [this.ring, this.knob, this.outline]) o.geometry.dispose();
    for (const m of [this.ringMat, this.knobMat, this.outlineMat]) m.dispose();
  }
}

/** The yaw that points from `centre` at a floor point — what a rotation drag means. */
export const yawToward = (centre: { x: number; z: number }, p: { x: number; z: number }): number =>
  Math.atan2(p.x - centre.x, p.z - centre.z);
