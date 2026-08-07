import { describe, expect, it } from "vitest";
import {
  ALEX_IDLE_FRAMES,
  ALEX_PAT_FRAMES,
  ALEX_SPRITE_SET,
  ALEX_WALK_FRAMES,
  BON_IDLE_FRAMES,
  BON_PAT_FRAMES,
  BON_SPRITE_SET,
  BON_WALK_FRAMES,
  MICAH_IDLE_FRAMES,
  MICAH_PAT_FRAMES,
  MICAH_SPRITE_SET,
  MICAH_WALK_FRAMES,
  bonSprite,
  characterSprite,
  type WalkDirection,
} from "./bonWalkFrames";

const DIRECTIONS: WalkDirection[] = ["left", "right", "front", "back"];

describe("characterSprite", () => {
  it("returns the correct walk frame per direction/frameIndex", () => {
    for (const dir of DIRECTIONS) {
      expect(characterSprite(BON_SPRITE_SET, "walk", dir, 0)).toBe(BON_WALK_FRAMES[dir][0]);
      expect(characterSprite(BON_SPRITE_SET, "walk", dir, 1)).toBe(BON_WALK_FRAMES[dir][1]);
    }
  });

  it("returns the correct pat frame per direction/frameIndex", () => {
    for (const dir of DIRECTIONS) {
      expect(characterSprite(BON_SPRITE_SET, "pat", dir, 0)).toBe(BON_PAT_FRAMES[dir][0]);
      expect(characterSprite(BON_SPRITE_SET, "pat", dir, 1)).toBe(BON_PAT_FRAMES[dir][1]);
    }
  });

  it("returns the idle frame regardless of frameIndex (idle has no second frame)", () => {
    for (const dir of DIRECTIONS) {
      expect(characterSprite(BON_SPRITE_SET, "idle", dir, 0)).toBe(BON_IDLE_FRAMES[dir]);
      expect(characterSprite(BON_SPRITE_SET, "idle", dir, 1)).toBe(BON_IDLE_FRAMES[dir]);
    }
  });

  it("defaults frameIndex to 0 when omitted", () => {
    for (const dir of DIRECTIONS) {
      expect(characterSprite(BON_SPRITE_SET, "walk", dir)).toBe(BON_WALK_FRAMES[dir][0]);
      expect(characterSprite(BON_SPRITE_SET, "pat", dir)).toBe(BON_PAT_FRAMES[dir][0]);
    }
  });
});

describe("bonSprite (backward-compat shim)", () => {
  it("produces identical output to characterSprite(BON_SPRITE_SET, ...) for every state/direction/frame", () => {
    const states = ["idle", "walk", "pat"] as const;
    const frames = [0, 1] as const;
    for (const state of states) {
      for (const dir of DIRECTIONS) {
        for (const frame of frames) {
          expect(bonSprite(state, dir, frame)).toBe(characterSprite(BON_SPRITE_SET, state, dir, frame));
        }
      }
    }
  });

  it("matches the pre-refactor hardcoded frame tables directly", () => {
    expect(bonSprite("walk", "left", 0)).toBe(BON_WALK_FRAMES.left[0]);
    expect(bonSprite("walk", "left", 1)).toBe(BON_WALK_FRAMES.left[1]);
    expect(bonSprite("pat", "back", 1)).toBe(BON_PAT_FRAMES.back[1]);
    expect(bonSprite("idle", "right")).toBe(BON_IDLE_FRAMES.right);
  });
});

describe.each([
  ["ALEX_SPRITE_SET", ALEX_SPRITE_SET, ALEX_WALK_FRAMES, ALEX_IDLE_FRAMES, ALEX_PAT_FRAMES],
  ["MICAH_SPRITE_SET", MICAH_SPRITE_SET, MICAH_WALK_FRAMES, MICAH_IDLE_FRAMES, MICAH_PAT_FRAMES],
] as const)("characterSprite with %s", (_label, spriteSet, walkFrames, idleFrames, patFrames) => {
  it("returns the correct walk frame per direction/frameIndex", () => {
    for (const dir of DIRECTIONS) {
      expect(characterSprite(spriteSet, "walk", dir, 0)).toBe(walkFrames[dir][0]);
      expect(characterSprite(spriteSet, "walk", dir, 1)).toBe(walkFrames[dir][1]);
    }
  });

  it("returns the correct pat frame per direction/frameIndex", () => {
    for (const dir of DIRECTIONS) {
      expect(characterSprite(spriteSet, "pat", dir, 0)).toBe(patFrames[dir][0]);
      expect(characterSprite(spriteSet, "pat", dir, 1)).toBe(patFrames[dir][1]);
    }
  });

  it("returns the idle frame regardless of frameIndex (idle has no second frame)", () => {
    for (const dir of DIRECTIONS) {
      expect(characterSprite(spriteSet, "idle", dir, 0)).toBe(idleFrames[dir]);
      expect(characterSprite(spriteSet, "idle", dir, 1)).toBe(idleFrames[dir]);
    }
  });

  it("defaults frameIndex to 0 when omitted", () => {
    for (const dir of DIRECTIONS) {
      expect(characterSprite(spriteSet, "walk", dir)).toBe(walkFrames[dir][0]);
      expect(characterSprite(spriteSet, "pat", dir)).toBe(patFrames[dir][0]);
    }
  });

  it("sprite frames are distinct module instances from Bon's (no accidental sharing/aliasing)", () => {
    for (const dir of DIRECTIONS) {
      expect(walkFrames[dir][0]).not.toBe(BON_WALK_FRAMES[dir][0]);
      expect(idleFrames[dir]).not.toBe(BON_IDLE_FRAMES[dir]);
      expect(patFrames[dir][0]).not.toBe(BON_PAT_FRAMES[dir][0]);
    }
  });
});
