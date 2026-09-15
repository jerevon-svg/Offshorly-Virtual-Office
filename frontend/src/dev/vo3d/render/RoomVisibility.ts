// vo3d render — ROOM-LEVEL VISIBILITY. One conservative frustum test per room subtree, per frame.
//
// WHY. After foliage instancing (0e7f479) the ground floor still submits every one of its eleven room
// groups — 224 to 875 meshes each — on every frame, whichever way the camera is pointing. That cost is
// paid more than once: SSAOPass re-draws the whole scene into a normal buffer before it can compute
// anything (see render/Renderer), and the shadow map re-draws every caster when it is invalidated. What
// is left after instancing is shading and geometry cost, and the cheapest geometry is the kind that is
// never submitted.
//
// THE RULE, and it is deliberately the conservative one: a room subtree is hidden only when its WORLD
// BOUNDS, grown by a margin, miss BOTH
//   • the active camera's frustum — what the user is looking at, whichever camera mode is driving; and
//   • the key light's SHADOW frustum — what can still throw a shadow into that view.
// The second half is the whole shadow-safety story. A room standing just off the left edge of the screen
// at four in the afternoon rakes a shadow right across the floor the user IS looking at; culling it on
// camera visibility alone would make that shadow blink out. Testing the light's own frustum answers the
// question exactly: if a room cannot be drawn into the shadow map, it cannot be casting anything.
//
// CAMERA VISIBILITY IS AUTHORITATIVE, never player location. The user can stand in Reception and look
// straight down the hall through four rooms, and the overhead office camera shows most of the floor at
// once. The only concession to gameplay is `keep`: the room the player is standing in is never hidden,
// because that is the one subtree whose disappearance would be unrecoverable rather than merely wrong.
//
// NO POPPING, by construction and then by margin:
//   • BOUNDS ARE MEASURED, not assumed. Box3.setFromObject over the built group (unioned with the room's
//     authored rect, so a room can never end up with an empty box) covers every mesh the builders
//     actually produced, including the foliage InstancedMeshes — Box3 reads an InstancedMesh's OWN
//     bounding box, which is computed across its instance matrices, not the single blade's geometry.
//   • HYSTERESIS. A hidden room comes back the moment its bounds + SHOW_MARGIN touch a frustum; a visible
//     room is only dropped once its bounds + HIDE_MARGIN miss both. The gap between the two margins is
//     what stops a room flickering while the camera sits exactly on its boundary.
//
// WHAT THIS DOES NOT TOUCH. Object3D.visible = false makes three skip the subtree in projectObject, which
// takes it out of the render list, out of SSAO's normal pass and out of the shadow map in one move — and
// nothing else. No geometry is deleted, no material, light or pass is reconfigured, and the sway, foliage
// and ambient systems keep updating a hidden room's nodes so that restoring it is a single boolean with
// no stale frame behind it. The CAVE is not a room group (it is added straight to the scene by
// app/bootstrap and owns its own lifecycle), so it is never registered here and never affected.
import * as THREE from "three";
import type { Rect } from "../core/coords";

/** Bounds are grown by this before the test that brings a hidden room BACK. */
export const SHOW_MARGIN = 120;
/** ...and by this before the test that lets a visible room be hidden. The difference is the hysteresis. */
export const HIDE_MARGIN = 280;

type Room = { id: string; group: THREE.Object3D; rect: Rect; box: THREE.Box3; dirty: boolean; visible: boolean };

export type RoomVisibilityState = { id: string; visible: boolean };

const _m = new THREE.Matrix4();
const _box = new THREE.Box3();
const _rectBox = new THREE.Box3();
const _v = new THREE.Vector3();

/** How far above and below a room's authored rect the fallback box reaches. Only ever UNIONED with the
 *  measured geometry box, so it can widen the bounds (safe) and never narrow them. */
const RECT_BOX_Y = 8;

export class RoomVisibility {
  /** Off restores every subtree immediately — the A/B switch, and the safety valve. */
  enabled = true;
  private readonly rooms = new Map<string, Room>();
  private readonly camFrustum = new THREE.Frustum();
  private readonly lightFrustum = new THREE.Frustum();
  /** a private stand-in for the light's shadow camera, synced per frame (see lightFrustumFor) */
  private readonly shadowCam = new THREE.OrthographicCamera();
  private culledCount = 0;

  /** Register a built room subtree. Bounds are measured lazily on the first update. */
  register(id: string, group: THREE.Object3D, rect: Rect): void {
    this.rooms.set(id, { id, group, rect, box: new THREE.Box3(), dirty: true, visible: true });
    group.visible = true;
  }
  unregister(id: string): void {
    const r = this.rooms.get(id);
    if (r) r.group.visible = true; // never leave a detached subtree hidden
    this.rooms.delete(id);
  }
  /** Re-measure a room's bounds (an entity moved, a room was rebuilt, an async asset landed). */
  invalidate(id?: string): void {
    if (id === undefined) { for (const r of this.rooms.values()) r.dirty = true; return; }
    const r = this.rooms.get(id);
    if (r) r.dirty = true;
  }
  /** Make every registered subtree visible again. Idempotent. */
  restoreAll(): void {
    for (const r of this.rooms.values()) { r.visible = true; r.group.visible = true; }
    this.culledCount = 0;
  }
  get roomCount(): number {
    return this.rooms.size;
  }
  /** room subtrees hidden as of the last update */
  get culled(): number {
    return this.culledCount;
  }
  states(): RoomVisibilityState[] {
    return [...this.rooms.values()].map((r) => ({ id: r.id, visible: r.visible }));
  }
  /** the ids of the subtrees currently skipped — what a capture reports as "rooms culled" */
  hiddenIds(): string[] {
    const out: string[] = [];
    for (const r of this.rooms.values()) if (!r.visible) out.push(r.id);
    return out;
  }
  /** the measured world bounds of a room, for tests and dev tooling (null = never measured) */
  bounds(id: string): THREE.Box3 | null {
    const r = this.rooms.get(id);
    return r && !r.dirty ? r.box : null;
  }

  /** ONE pass over the rooms. `keep` is never hidden; `light` is consulted only while shadows are on. */
  update(camera: THREE.Camera, opts: { light?: THREE.DirectionalLight | null; shadows?: boolean; keep?: string | null } = {}): number {
    if (!this.enabled) {
      this.restoreAll();
      return 0;
    }
    const { light = null, shadows = false, keep = null } = opts;
    camera.updateMatrixWorld();
    this.camFrustum.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const lit = shadows && light ? this.lightFrustumFor(light) : null;
    let culled = 0;
    for (const r of this.rooms.values()) {
      if (r.dirty) this.measure(r);
      let visible: boolean;
      if (keep !== null && keep === r.id) visible = true;
      else {
        _box.copy(r.box).expandByScalar(r.visible ? HIDE_MARGIN : SHOW_MARGIN);
        visible = this.camFrustum.intersectsBox(_box) || (lit !== null && lit.intersectsBox(_box));
      }
      r.visible = visible;
      r.group.visible = visible;
      if (!visible) culled++;
    }
    this.culledCount = culled;
    return culled;
  }

  /** The key light's shadow frustum, rebuilt from the light itself rather than read off three's internal
   *  shadow camera: that camera's matrices are only refreshed inside the shadow pass, which this rig runs
   *  ON DEMAND (Renderer.shadowMap.autoUpdate is off), so on most frames they are stale by construction.
   *  Everything needed is public — the light's position, its target, and the shadow camera's extents. */
  private lightFrustumFor(light: THREE.DirectionalLight): THREE.Frustum {
    const sc = light.shadow.camera;
    const c = this.shadowCam;
    c.left = sc.left; c.right = sc.right; c.top = sc.top; c.bottom = sc.bottom;
    c.near = sc.near; c.far = sc.far;
    c.position.copy(light.position);
    c.up.set(0, 1, 0);
    c.lookAt(light.target.getWorldPosition(_v));
    c.updateMatrixWorld(true);
    c.updateProjectionMatrix();
    this.lightFrustum.setFromProjectionMatrix(_m.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
    return this.lightFrustum;
  }

  /** Measure a room: every mesh the builders produced, unioned with the room's authored footprint. */
  private measure(r: Room): void {
    const wasVisible = r.group.visible;
    r.group.visible = true; // Box3 ignores visibility, but keep the traverse honest either way
    r.group.updateWorldMatrix(true, true);
    r.box.setFromObject(r.group);
    r.group.visible = wasVisible;
    _rectBox.set(
      new THREE.Vector3(r.rect.x, -RECT_BOX_Y, r.rect.z),
      new THREE.Vector3(r.rect.x + r.rect.w, RECT_BOX_Y, r.rect.z + r.rect.d),
    );
    if (r.box.isEmpty()) r.box.copy(_rectBox);
    else r.box.union(_rectBox);
    r.dirty = false;
  }
}
