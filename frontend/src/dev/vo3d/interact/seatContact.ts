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

/** Hips translation of a clip's first keyframe, in world units. */
export function clipHips(avatar: Avatar, clipName: string): THREE.Vector3 | null {
  const g = avatar.gltf;
  if (!g) return null;
  const arm = g.scene.getObjectByName("Armature");
  const scale = (arm?.scale.x ?? 1) * g.scene.scale.x;
  const clip = g.animations.find((c) => c.name === clipName);
  const track = clip?.tracks.find((t) => /Hips\.position$/.test(t.name)) as THREE.VectorKeyframeTrack | undefined;
  return track ? new THREE.Vector3(track.values[0], track.values[1], track.values[2]).multiplyScalar(scale) : null;
}

/**
 * Avatar ROOT transform that lands the seated body on `contact` (a world point ON the seat surface).
 * `sink` lets a soft cushion take the body a little below the surface; 0 rests exactly on top.
 * The x/z correction removes the sit clip's own hip translation so the pelvis, not the root, hits the mark.
 */
export function seatedRoot(avatar: Avatar, contact: THREE.Vector3, seatedYaw: number, sink = 0): THREE.Vector3 {
  const sit = clipHips(avatar, CLIP_SIT), idle = clipHips(avatar, CLIP_IDLE);
  if (!sit || !idle) return contact.clone();
  const dx = sit.x - idle.x, dz = sit.z - idle.z;
  const wx = dx * Math.cos(seatedYaw) + dz * Math.sin(seatedYaw);
  const wz = -dx * Math.sin(seatedYaw) + dz * Math.cos(seatedYaw);
  return new THREE.Vector3(contact.x - wx, contact.y - sink + PELVIS_BELOW_HIPS - sit.y, contact.z - wz);
}

/** Height of the foot soles above the avatar root in the seated pose — reported so a seat can be judged. */
export const SOLE_ABOVE_ROOT = 0.273;
