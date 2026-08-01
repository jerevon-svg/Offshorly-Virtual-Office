import walkLeft1 from "../assets/office/characters/bon-walk-norm/left-1.png";
import walkLeft2 from "../assets/office/characters/bon-walk-norm/left-2.png";
import walkRight1 from "../assets/office/characters/bon-walk-norm/right-1.png";
import walkRight2 from "../assets/office/characters/bon-walk-norm/right-2.png";
import walkFront1 from "../assets/office/characters/bon-walk-norm/front-1.png";
import walkFront2 from "../assets/office/characters/bon-walk-norm/front-2.png";
import walkBack1 from "../assets/office/characters/bon-walk-norm/back-1.png";
import walkBack2 from "../assets/office/characters/bon-walk-norm/back-2.png";

import idleLeft from "../assets/office/characters/bon-idle-norm/left.png";
import idleRight from "../assets/office/characters/bon-idle-norm/right.png";
import idleFront from "../assets/office/characters/bon-idle-norm/front.png";
import idleBack from "../assets/office/characters/bon-idle-norm/back.png";

import patLeft1 from "../assets/office/characters/bon-pat-norm/left-1.png";
import patLeft2 from "../assets/office/characters/bon-pat-norm/left-2.png";
import patRight1 from "../assets/office/characters/bon-pat-norm/right-1.png";
import patRight2 from "../assets/office/characters/bon-pat-norm/right-2.png";
import patFront1 from "../assets/office/characters/bon-pat-norm/front-1.png";
import patFront2 from "../assets/office/characters/bon-pat-norm/front-2.png";
import patBack1 from "../assets/office/characters/bon-pat-norm/back-1.png";
import patBack2 from "../assets/office/characters/bon-pat-norm/back-2.png";

export type WalkDirection = "left" | "right" | "front" | "back";

// index 0 = stride frame 1, index 1 = stride frame 2
export const BON_WALK_FRAMES: Record<WalkDirection, readonly [string, string]> = {
  left: [walkLeft1, walkLeft2],
  right: [walkRight1, walkRight2],
  front: [walkFront1, walkFront2],
  back: [walkBack1, walkBack2],
};

export const BON_IDLE_FRAMES: Record<WalkDirection, string> = {
  left: idleLeft,
  right: idleRight,
  front: idleFront,
  back: idleBack,
};

export const BON_PAT_FRAMES: Record<WalkDirection, readonly [string, string]> = {
  left: [patLeft1, patLeft2],
  right: [patRight1, patRight2],
  front: [patFront1, patFront2],
  back: [patBack1, patBack2],
};

// Selects bon's current sprite for the given state/direction/frame.
export function bonSprite(
  state: "idle" | "walk" | "pat",
  direction: WalkDirection,
  frameIndex: 0 | 1 = 0,
): string {
  if (state === "walk") return BON_WALK_FRAMES[direction][frameIndex];
  if (state === "pat") return BON_PAT_FRAMES[direction][frameIndex];
  return BON_IDLE_FRAMES[direction];
}
