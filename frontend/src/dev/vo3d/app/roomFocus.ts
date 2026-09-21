// vo3d app — WHAT FRAMING A ROOM DECIDES. A pure leaf, imported by app/world.ts, so the three decisions
// behind "click a room and the camera goes there" are testable without booting a renderer.
//
// It decides three things and touches nothing:
//   1. WHICH VIEW MAY BE REFRAMED AT ALL, and how.
//   2. WHICH RECT a room is framed against.
//   3. HOW FAR IN the 3D Explore rig may dolly to fit it.
//
// The OFFICE framing itself is deliberately NOT here: that is render/CameraModes.focus, the shipped
// policy (pitch, yaw, dolly ceiling and the pan fence), and app/world.ts re-runs it rather than
// re-deriving it. A second copy of that arithmetic is exactly what this file exists to avoid.
import type { Rect } from "../core/coords";

/** How much of the viewport a framed room fills. Under 1 so the room keeps a margin of floor around it and
 *  reads as part of the office rather than as a cropped tile. */
export const ROOM_FRAME_FILL = 0.82;

/** WHAT A GIVEN VIEW DOES WITH A ROOM SELECTION.
 *
 *   "office"  re-run the shipped OFFICE framing and ease into it. Pitch and yaw are pinned in that mode,
 *             so the camera may be rebuilt wholesale; the existing fence still has the last word.
 *   "pan"     3D EXPLORE. Ease the orbit TARGET and the dolly only. The orbit angle is the user's and this
 *             is the mode whose entire purpose is free orbit, so nothing may be rebuilt from the camera
 *             policy — that would snap their pitch and yaw back.
 *   "none"    PLAYER, and a dropped selection. In PLAYER the camera belongs to the body: opening the panel
 *             must not teleport, zoom or detach it, so the view is left exactly as it is. */
export type RoomFrameMode = "office" | "pan" | "none";

export function roomFrameMode(cameraMode: string, playerActive: boolean, roomId: string | null): RoomFrameMode {
  if (!roomId || playerActive) return "none";
  if (cameraMode === "office") return "office";
  if (cameraMode === "explore") return "pan";
  return "none";
}

/** A minimal structural view of what app/world.ts holds, so this module stays a leaf. */
export interface RoomFrameSource {
  /** reconstructed rooms: their own walkable floor */
  floorRectOf(roomId: string): Rect | undefined;
  /** every world region, for the footprint stand-in an unreconstructed room has instead */
  regions: readonly { id: string; rect: Rect; roomId?: string }[];
}

/** THE RECT A ROOM IS FRAMED AGAINST.
 *
 *  A reconstructed room answers with its own walkable floor; a room V2 has not rebuilt yet has only the
 *  footprint region standing in for its art box. Door-THRESHOLD regions carry the same roomId and are
 *  deliberately ignored: they are slivers out in the neighbouring corridor and would drag the framing off
 *  the room. Null for anything this world has no rect for — which is simply not framed. */
export function roomFrameRect(source: RoomFrameSource, roomId: string): Rect | null {
  const floor = source.floorRectOf(roomId);
  if (floor) return floor;
  const footprint = source.regions.find((r) => r.roomId === roomId && r.id.startsWith("footprint:"));
  return footprint?.rect ?? null;
}

/** THE 3D EXPLORE DOLLY that fits `rect`.
 *
 *  The fit is taken from the rect's LONGER SIDE rather than from its depth and width separately, because
 *  out here yaw is free and "depth" is not reliably the screen's vertical axis. That fits the room at any
 *  orbit angle instead of at yaw 0 only, and it errs WIDE — the right way to err when the brief is "no
 *  excessive zoom". Clamped by the mode's own OrbitControls limits, so nothing new decides how far the
 *  inspection rig may go. */
export function exploreFrameZoom(
  rect: Rect,
  cameraTop: number,
  fill: number,
  minZoom: number,
  maxZoom: number,
): number {
  const needHalf = Math.max(rect.w, rect.d) / 2 / fill;
  const want = cameraTop / Math.max(needHalf, 1e-6);
  return Math.min(Math.max(want, minZoom), maxZoom);
}
