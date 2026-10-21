// vo3d interact — where a seated avatar's body actually meets a seat surface.
//
// MEASURED, not eyeballed. With the production GLB playing CLIP_SIT, the skinned vertices whose dominant
// bone is Hips / UpLeg / Spine were transformed by applyBoneTransform and the lowest one taken — that is
// the pelvis/thigh underside, i.e. the part that touches a cushion. In that pose it sits
// PELVIS_BELOW_HIPS units under the Hips bone:
//
//     Hips bone (world)      12.722
//     pelvis underside        9.835   →  2.887 below the Hips bone
//
// The old model placed the HIPS BONE 0.6 below the cushion top, so the body hung 3.27 units INSIDE the
// cushion. Placing the pelvis underside on the surface instead is what this module computes.
import * as THREE from "three";
import type { SeatCapability } from "../world/WorldState";
import type { Avatar } from "../avatar/Avatar";
import { CLIP_IDLE, CLIP_SIT } from "../adapters/v1Avatar";

/** distance from the Hips bone down to the pelvis/thigh underside in the seated pose (world units) */
export const PELVIS_BELOW_HIPS = 2.887;
/** THE SAME DEPTH FOR THE SHARED HUMANBASE BODY, measured on it in the seated clip (the lowest pelvis / upper-thigh skin
 *  under the Hips bone; pinned by human/seatedWork.test.ts). Its pelvis is much deeper under the Hips bone than the
 *  legacy GLB's, so the legacy desk formula below (Hips 0.6 under the cushion top) sank a HumanBase body ~4.4 u into the
 *  chair — low shoulders, the desk at chin height. A rig that carries this rests its pelvis ON the cushion instead. */
export const HUMANBASE_PELVIS_BELOW_HIPS = 3.8;
/** HOW FAR THE OCCUPIED CHAIR PARKS from its rest, along its pull direction: under a HumanBase body at a WORK desk, pulled
 *  up to the desk — the seat's own `humanTuck`, or measured off the room (humanDeskTuck) for a `workstation` seat — and its
 *  `seatedTuck` otherwise. The ONE rule the local sit (interact/Seat) and a peer's seat (app/world peerSeatAnchor) both
 *  read, over the same chair view and the same room, so a coworker sits exactly where the local body would. */
export function seatedTuckFor(spec: SeatCapability, humanBase: boolean, chair?: RestingChair): number {
  if (!humanBase) return spec.seatedTuck;
  if (spec.humanTuck !== undefined) return spec.humanTuck;
  return spec.workstation && chair ? humanDeskTuck(chair, spec) ?? spec.seatedTuck : spec.seatedTuck;
}

/** furniture, not an effect: a glow decal, a light pool or a pane of glass (transparent or additive) is never a desk */
export function isSolidSurface(m: THREE.Mesh): boolean {
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  return mats.every((x) => x && !x.transparent && x.blending !== THREE.AdditiveBlending);
}
/** a chair's view and its REST transform (the tuck is measured from rest, whatever the view is doing now) */
export type RestingChair = { view: THREE.Object3D; restPos: THREE.Vector3; restQuat: THREE.Quaternion; /** the seat's CONFIGURED facing (app/seats) when it differs from the authored seatedYaw */ yaw?: number };
/** the seated HumanBase hips' distance behind a work desk's near edge: the upright typing torso clears the edge by ~1.3,
 *  the chin clears the top and a keyboard at the desk's front is in natural reach (measured on the Dev Room's desks —
 *  human/seatedWork.devdesk.test.ts; the Dev Room's own humanTuck figures are this same rule) */
export const HUMAN_DESK_HIPS_TO_EDGE = 6.2;
const tuckCache = new WeakMap<THREE.Object3D, number | null>();
/**
 * THE TUCK THAT PUTS A HUMANBASE BODY AT ITS WORK DESK, measured once per chair off the room the chair stands in: from the
 * cushion point of the chair parked at its ordinary seatedTuck, look along the seated facing for the desk's near edge (the
 * first level surface between the lap and just above the shoulders), then move the chair along its pull axis until the
 * hips are HUMAN_DESK_HIPS_TO_EDGE behind it. Null when no desk is found (the seat keeps its own tuck).
 */
export function humanDeskTuck(chair: RestingChair, spec: SeatCapability): number | null {
  const hit = tuckCache.get(chair.view);
  if (hit !== undefined) return hit;
  let scene: THREE.Object3D = chair.view;
  while (scene.parent) scene = scene.parent;
  scene.updateMatrixWorld(true);
  const meshes: THREE.Object3D[] = [];
  scene.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || !isSolidSurface(m)) return;
    for (let a: THREE.Object3D | null = o; a; a = a.parent) if (a === chair.view) return;
    meshes.push(o);
  });
  const probe = new THREE.Object3D();
  const pull = new THREE.Vector3(spec.pullDir.x, 0, spec.pullDir.z);
  probe.position.copy(chair.restPos).addScaledVector(pull, spec.seatedTuck); probe.quaternion.copy(chair.restQuat); probe.updateMatrixWorld(true);
  const yaw = chair.yaw ?? spec.seatedYaw;
  const from = deskSeatContact(probe, spec), f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const lo = spec.cushionTopY + 5, hi = spec.cushionTopY + 14, ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  let edge: number | null = null;
  for (let d = 0; d <= 34 && edge === null; d += 0.25) {
    ray.set(from.clone().addScaledVector(f, d).setY(hi + 1), down); ray.far = hi + 1 - lo;
    // ANY surface in the band starts the desk — a radiused front's bevel included (skipping it put the edge, and so the
    // body, up to a bevel's width too far in, the pelvis under the lip)
    if (ray.intersectObjects(meshes, false).length) edge = d;
  }
  const along = -pull.dot(f);   // how far the cushion point moves toward the desk per unit of tuck taken off
  const t = edge === null || along < 0.5 ? null : spec.seatedTuck - (edge - HUMAN_DESK_HIPS_TO_EDGE) / along;
  tuckCache.set(chair.view, t);
  return t;
}
/** how far a HumanBase pelvis settles into a desk chair's cushion (world units) */
const HUMANBASE_DESK_SINK = 0.3;

/** The clips and scale a seated-root computation needs — the hero Avatar's own GLTF, or a coworker
 *  body's shared prototype (world/Coworkers.ts), which carries the same consolidated clips. Phase 6C
 *  reads the pose from THIS so a peer's seated body lands exactly where the local one does. */
export interface SeatedRig {
  clips: readonly THREE.AnimationClip[];
  /** Armature scale × scene scale — what the clip's Hips translation is multiplied by in world units */
  scale: number;
  /** the body's own pelvis depth under its Hips bone when seated (the HumanBase body's); absent = the legacy GLB's */
  pelvisBelowHips?: number;
}

/** The rig of a loaded Avatar, or null before its GLTF has landed. */
export function avatarRig(avatar: Avatar): SeatedRig | null {
  const g = avatar.gltf;
  if (!g) return null;
  const arm = g.scene.getObjectByName("Armature");
  return { clips: g.animations, scale: (arm?.scale.x ?? 1) * g.scene.scale.x, ...(avatar.human ? { pelvisBelowHips: HUMANBASE_PELVIS_BELOW_HIPS } : {}) };
}

/** The rig of a cast prototype's scene and clips — the same reading avatarRig makes of a hero GLTF. */
export function sceneRig(scene: THREE.Object3D, clips: readonly THREE.AnimationClip[]): SeatedRig {
  const arm = scene.getObjectByName("Armature");
  return { clips, scale: (arm?.scale.x ?? 1) * scene.scale.x };
}

/** Hips translation of a clip's first keyframe, in world units. */
export function rigClipHips(rig: SeatedRig, clipName: string): THREE.Vector3 | null {
  const clip = rig.clips.find((c) => c.name === clipName);
  const track = clip?.tracks.find((t) => /Hips\.position$/.test(t.name)) as THREE.VectorKeyframeTrack | undefined;
  return track ? new THREE.Vector3(track.values[0], track.values[1], track.values[2]).multiplyScalar(rig.scale) : null;
}

/** Hips translation of a clip's first keyframe, in world units. */
export function clipHips(avatar: Avatar, clipName: string): THREE.Vector3 | null {
  const rig = avatarRig(avatar);
  return rig ? rigClipHips(rig, clipName) : null;
}

/**
 * Avatar ROOT transform that lands the seated body on `contact` (a world point ON the seat surface).
 * `sink` lets a soft cushion take the body a little below the surface; 0 rests exactly on top.
 * The x/z correction removes the sit clip's own hip translation so the pelvis, not the root, hits the mark.
 */
export function seatedRoot(avatar: Avatar, contact: THREE.Vector3, seatedYaw: number, sink = 0): THREE.Vector3 {
  const rig = avatarRig(avatar);
  return rig ? seatedRootForRig(rig, contact, seatedYaw, sink) : contact.clone();
}

/** seatedRoot over an explicit rig — the FIXED-seating (lounge) pose, for the hero and for a peer alike. */
export function seatedRootForRig(rig: SeatedRig, contact: THREE.Vector3, seatedYaw: number, sink = 0): THREE.Vector3 {
  const sit = rigClipHips(rig, CLIP_SIT), idle = rigClipHips(rig, CLIP_IDLE);
  if (!sit || !idle) return contact.clone();
  const dx = sit.x - idle.x, dz = sit.z - idle.z;
  const wx = dx * Math.cos(seatedYaw) + dz * Math.sin(seatedYaw);
  const wz = -dx * Math.sin(seatedYaw) + dz * Math.cos(seatedYaw);
  return new THREE.Vector3(contact.x - wx, contact.y - sink + (rig.pelvisBelowHips ?? PELVIS_BELOW_HIPS) - sit.y, contact.z - wz);
}

/** THE MOVABLE DESK-CHAIR POSE — byte-for-byte the arithmetic interact/Seat.ts's seatedRootFor has always
 *  used (the Hips bone 0.6 below the cushion top, x/z corrected by the sit clip's own hip translation),
 *  lifted out so a peer seated on the same chair (Phase 6C) is put where the local body would be, by the
 *  same formula rather than a second one. `seat` is the cushion point interact/Seat.ts's seatWorld yields. */
export function deskSeatedRootForRig(rig: SeatedRig, seat: THREE.Vector3, seatedYaw: number): THREE.Vector3 {
  const hs = rigClipHips(rig, CLIP_SIT), hi = rigClipHips(rig, CLIP_IDLE);
  if (!hs || !hi) return seat.clone();
  const dx = hs.x - hi.x, dz = hs.z - hi.z, h = seatedYaw;
  const wx = dx * Math.cos(h) + dz * Math.sin(h), wz = -dx * Math.sin(h) + dz * Math.cos(h);
  const y = rig.pelvisBelowHips !== undefined ? seat.y - hs.y + rig.pelvisBelowHips - HUMANBASE_DESK_SINK : seat.y - hs.y - 0.6;
  return new THREE.Vector3(seat.x - wx, Math.max(0, y), seat.z - wz);
}

/** THE CUSHION POINT of a movable chair — the same read interact/Seat.ts's seatWorld makes, over the
 *  chair's CURRENT world matrix (a chair a peer occupies is tucked, and the point moves with it). */
export function deskSeatContact(chair: THREE.Object3D, spec: { cushionLocal: { x: number; z: number }; cushionTopY: number; sitDepth: number }): THREE.Vector3 {
  chair.updateMatrixWorld(true);
  return new THREE.Vector3(spec.cushionLocal.x, spec.cushionTopY, spec.cushionLocal.z + spec.sitDepth).applyMatrix4(chair.matrixWorld);
}

/** Height of the foot soles above the avatar root in the seated pose — reported so a seat can be judged. */
export const SOLE_ABOVE_ROOT = 0.273;
