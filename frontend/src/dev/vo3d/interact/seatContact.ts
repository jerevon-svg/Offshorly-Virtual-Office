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
import type { Avatar } from "../avatar/Avatar";
import { CLIP_IDLE, CLIP_SIT } from "../adapters/v1Avatar";

/** distance from the Hips bone down to the pelvis/thigh underside in the seated pose (world units) */
export const PELVIS_BELOW_HIPS = 2.887;

/** The clips and scale a seated-root computation needs — the hero Avatar's own GLTF, or a coworker
 *  body's shared prototype (world/Coworkers.ts), which carries the same consolidated clips. Phase 6C
 *  reads the pose from THIS so a peer's seated body lands exactly where the local one does. */
export interface SeatedRig {
  clips: readonly THREE.AnimationClip[];
  /** Armature scale × scene scale — what the clip's Hips translation is multiplied by in world units */
  scale: number;
}

/** The rig of a loaded Avatar, or null before its GLTF has landed. */
export function avatarRig(avatar: Avatar): SeatedRig | null {
  const g = avatar.gltf;
  if (!g) return null;
  const arm = g.scene.getObjectByName("Armature");
  return { clips: g.animations, scale: (arm?.scale.x ?? 1) * g.scene.scale.x };
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
  return new THREE.Vector3(contact.x - wx, contact.y - sink + PELVIS_BELOW_HIPS - sit.y, contact.z - wz);
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
  return new THREE.Vector3(seat.x - wx, Math.max(0, seat.y - hs.y - 0.6), seat.z - wz);
}

/** THE CUSHION POINT of a movable chair — the same read interact/Seat.ts's seatWorld makes, over the
 *  chair's CURRENT world matrix (a chair a peer occupies is tucked, and the point moves with it). */
export function deskSeatContact(chair: THREE.Object3D, spec: { cushionLocal: { x: number; z: number }; cushionTopY: number; sitDepth: number }): THREE.Vector3 {
  chair.updateMatrixWorld(true);
  return new THREE.Vector3(spec.cushionLocal.x, spec.cushionTopY, spec.cushionLocal.z + spec.sitDepth).applyMatrix4(chair.matrixWorld);
}

/** Height of the foot soles above the avatar root in the seated pose — reported so a seat can be judged. */
export const SOLE_ABOVE_ROOT = 0.273;
