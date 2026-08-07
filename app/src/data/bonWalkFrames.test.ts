import { describe, expect, it } from "vitest";
import {
  BON_IDLE_FRAMES,
  BON_PAT_FRAMES,
  BON_SPRITE_SET,
  BON_WALK_FRAMES,
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
