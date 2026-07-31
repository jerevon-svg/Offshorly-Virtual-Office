import { describe, expect, it } from "vitest";
import { FRAME_HEIGHT, FRAME_WIDTH } from "../../data/office-layout";
import { formatCharacterName } from "../../data/office-layout";
import { computeCenterTransform } from "./panMath";

describe("computeCenterTransform", () => {
  it("centers a layer with no clamping when content exceeds the viewport", () => {
    // Layer near the frame's center, content (frame * scale) larger than the
    // viewport on both axes, so the centered position falls within bounds.
    const layer = { x: FRAME_WIDTH / 2 - 20, y: FRAME_HEIGHT / 2 - 20, width: 40, height: 40 };
    const scale = 2;
    const vw = 2000;
    const vh = 2000;
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    const result = computeCenterTransform(layer, scale, vw, vh);
    expect(result.x).toBe(vw / 2 - cx * scale);
    expect(result.y).toBe(vh / 2 - cy * scale);
  });

  it("clamps a far-right layer with a small viewport to the right bound", () => {
    const layer = { x: 1400, y: 600, width: 40, height: 40 };
    const scale = 3;
    const vw = 200;
    const vh = 200;
    const contentW = FRAME_WIDTH * scale;
    const result = computeCenterTransform(layer, scale, vw, vh);
    expect(result.x).toBe(vw - contentW);
  });

  it("clamps a far-left/top layer with a small viewport to zero", () => {
    const layer = { x: 0, y: 0, width: 40, height: 40 };
    const scale = 3;
    const vw = 200;
    const vh = 200;
    const result = computeCenterTransform(layer, scale, vw, vh);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });
});

describe("formatCharacterName", () => {
  it("titlecases a simple id", () => {
    expect(formatCharacterName({ id: "alex" })).toBe("Alex");
  });

  it("titlecases a hyphenated id", () => {
    expect(formatCharacterName({ id: "jan-carlo" })).toBe("Jan Carlo");
  });

  it("prefers an explicit name over the id", () => {
    expect(formatCharacterName({ id: "x", name: "Zed" })).toBe("Zed");
  });
});
