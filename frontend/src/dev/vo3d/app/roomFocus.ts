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

/** EVERY ROOM THAT GETS A LABEL, with the rect it is labelled over.
 *
 *  Derived from the SAME regions the framing reads, so a label can never name a room the camera cannot
 *  frame, and a room can never gain a label without gaining a rect. Ordered by id so the DOM list is
 *  stable across frames and re-renders — a label that reorders under the cursor is a label you cannot
 *  click. Door thresholds are excluded by roomFrameRect, as they are for framing. */
export function roomLabelRects(source: RoomFrameSource): { roomId: string; rect: Rect }[] {
  const ids = new Set<string>();
  for (const r of source.regions) if (r.roomId) ids.add(r.roomId);
  const out: { roomId: string; rect: Rect }[] = [];
  for (const roomId of [...ids].sort()) {
    const rect = roomFrameRect(source, roomId);
    if (rect) out.push({ roomId, rect });
  }
  return out;
}

/** HOW BIG A LABEL IS DRAWN, and on how many lines.
 *
 *  TWO WRONG ANSWERS CAME BEFORE THIS ONE, and the rule is the middle of them:
 *
 *   1. Sizing from the camera scale alone, with a hide floor. At the default OFFICE zoom the type fell
 *      under that floor, so the whole layer was invisible until somebody zoomed in.
 *   2. Sizing each room to its own floor. That fixed the visibility and made the Central Hub grand, but
 *      it gave every room a different size — eleven typographic scales on one screen, which reads as a
 *      mistake rather than as a system.
 *
 *  SO THERE IS ONE SHARED SIZE. It is `units` of cap height in world space, measured through the live
 *  camera, so every room wears the SAME type at a given zoom and the whole set grows and shrinks together
 *  when you zoom — the painted-on-the-floor effect, without the room's own dimensions getting a vote.
 *
 *  A ROOM ONLY DEPARTS FROM IT TO AVOID OVERFLOW, and only by as much as it must:
 *    • first it tries to WRAP — most of these names are "<Something> Room", and two lines fit a narrow
 *      room at the shared size where one line would not;
 *    • only if that still overruns does it shrink, to exactly the size that fits.
 *  Nothing is ever enlarged past the shared size, which is what keeps the set consistent. */
export const ROOM_LABEL = {
  /** THE SHARED SIZE, in world units of cap height. Chosen against the real floorplan: at 40 units the
   *  longest ordinary name ("Executive Room") still sits inside the narrowest room that carries one, so
   *  the shared size is the size almost every room actually gets. */
  units: 40,
  /** mean per-character advance, in em, for the stylesheet's 900-weight uppercase face plus its tracking */
  advanceEm: 0.66,
  /** the stylesheet's own horizontal padding, both sides together, in em */
  paddingEm: 0.68,
  /** how much of the room's projected WIDTH a line may occupy — the margin that keeps it off the walls */
  widthFill: 0.84,
  /** how much of the room's projected DEPTH the whole block of type may occupy */
  depthFill: 0.42,
  /** the shared size is never drawn smaller than this, however far out the camera is */
  minPx: 16,
  /** a sanity ceiling: a framed single room must not set type in the hundreds */
  maxPx: 96,
  /** only a camera a very long way out reaches this, and it is the ONLY thing that hides a label. At any
   *  ordinary zoom — the default office view included — every room is lettered. */
  hidePx: 7,
} as const;

export interface RoomLabelLayout {
  fontPx: number;
  /** one entry per rendered line: the name, or the name split across two */
  lines: string[];
}

/** Split a name across two balanced lines at one of its spaces, or null if it is a single word. */
function twoLines(name: string): [string, string] | null {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return null;
  let best: [string, string] | null = null;
  let bestDelta = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const delta = Math.abs(a.length - b.length);
    if (delta < bestDelta) { bestDelta = delta; best = [a, b]; }
  }
  return best;
}

/** @param footprint the room's projected screen-space box, in CSS pixels
 *  @param name      the room's name as it is drawn
 *  @param unitPx    one world unit in CSS pixels at that room's depth
 *  @returns what to draw, or null to not draw it at all */
export function roomLabelLayout(
  footprint: { widthPx: number; heightPx: number },
  name: string,
  unitPx: number,
): RoomLabelLayout | null {
  const { units, advanceEm, paddingEm, widthFill, depthFill, minPx, maxPx, hidePx } = ROOM_LABEL;
  const target = units * unitPx;
  if (target < hidePx) return null;
  const shared = Math.min(Math.max(target, minPx), maxPx);
  // No measurable floor (a room behind the camera, or a stub that reports none): the shared size stands.
  if (!(footprint.widthPx > 0) || !(footprint.heightPx > 0)) return { fontPx: shared, lines: [name] };

  const fits = (chars: number, lines: number) =>
    Math.min(
      (footprint.widthPx * widthFill) / (Math.max(1, chars) * advanceEm + paddingEm),
      (footprint.heightPx * depthFill) / lines,
    );

  const onOneLine = fits(name.length, 1);
  if (onOneLine >= shared) return { fontPx: shared, lines: [name] };

  // WRAPPING FIRST, shrinking second — a narrow room would rather read at full size on two lines.
  const split = twoLines(name);
  if (split) {
    const wrapped = fits(Math.max(split[0].length, split[1].length), 2);
    if (wrapped > onOneLine) return { fontPx: Math.min(shared, wrapped), lines: split };
  }
  // The minimum adjustment that prevents overflow, and nothing more.
  return { fontPx: onOneLine, lines: [name] };
}
