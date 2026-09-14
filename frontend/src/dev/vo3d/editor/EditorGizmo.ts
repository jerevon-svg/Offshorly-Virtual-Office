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
   *  The outline is the piece's WORLD-aligned extent, measured once on selection — deliberately the same
   *  axis-aligned reading the logical footprint takes, and cheap enough to never touch a drag frame. */
  attach(view: THREE.Group | null): void {
    this.root.visible = view !== null;
    if (!view) return;
    this.box.setFromObject(view);
    const size = new THREE.Vector3();
    this.box.getSize(size);
    this.radius = Math.max(MIN_RADIUS, Math.hypot(size.x, size.z) / 2 + RING_MARGIN);
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
