import { describe, expect, it } from "vitest";
import { FRAME_HEIGHT, FRAME_WIDTH } from "../../data/office-layout";
import { formatCharacterName, formatShortName } from "../../data/office-layout";
import {
  computeCenterTransform,
  computeRoomFocusTransform,
  greetingAnchor,
  HEAD_LABEL_GAP_FRAME_UNITS,
} from "./panMath";

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

describe("computeRoomFocusTransform", () => {
  const opts = {
    viewportW: 1440,
    viewportH: 900,
    sidebarW: 340,
    minScale: 1.0,
    maxScale: 5.0,
  };

  it("centers a wide room and clamps y to the cover lower bound (default side='right')", () => {
    // reception-room manifest coords.
    const layer = { x: 332.33, y: 838.47, width: 748.96, height: 399.1 };
    const result = computeRoomFocusTransform(layer, { ...opts, side: "right" });
    expect(result.scale).toBeCloseTo(1.322, 2);
    expect(result.x).toBeCloseTo(-384.4, 0);
    const contentH = FRAME_HEIGHT * result.scale;
    expect(result.y).toBeCloseTo(opts.viewportH - contentH, 1);
  });

  it("clamps a small corner room to (0, 0)", () => {
    // ai-room manifest coords.
    const layer = { x: 7.97, y: 8.01, width: 336.26, height: 290.57 };
    const result = computeRoomFocusTransform(layer, opts);
    expect(result.scale).toBeCloseTo(2.787, 2);
    expect(result.x).toBeCloseTo(0, 1);
    expect(result.y).toBeCloseTo(0, 1);
  });

  it("centers the room in the left region (availW / 2) when unclamped", () => {
    // Constructed layer/viewport so the fit-scale result lands well inside
    // the cover bounds on both axes (no clamping engaged).
    const layer = { x: 520, y: 400, width: 400, height: 300 };
    const wideOpts = {
      viewportW: 3000,
      viewportH: 3000,
      sidebarW: 340,
      minScale: 1.0,
      maxScale: 5.0,
      fill: 0.5,
    };
    const result = computeRoomFocusTransform(layer, wideOpts);
    const availW = wideOpts.viewportW - wideOpts.sidebarW;
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    const contentW = FRAME_WIDTH * result.scale;
    const contentH = FRAME_HEIGHT * result.scale;
    // Sanity-check the result is genuinely unclamped on both axes before
    // asserting the centering invariant.
    expect(result.x).toBeGreaterThan(wideOpts.viewportW - contentW);
    expect(result.x).toBeLessThan(0);
    expect(result.y).toBeGreaterThan(wideOpts.viewportH - contentH);
    expect(result.y).toBeLessThan(0);
    expect(result.x + cx * result.scale).toBeCloseTo(availW / 2, 1);
    expect(result.y + cy * result.scale).toBeCloseTo(wideOpts.viewportH / 2, 1);
  });

  it("centers the room in the right-hand region (sidebarW + availW / 2) when docked left and unclamped", () => {
    // Mirrors the right-dock centering-invariant test above, but with
    // side: "left" — the sidebar occupies the LEFT edge, so the free
    // region (and thus the centering target) is the remaining right-hand
    // span of the viewport.
    const layer = { x: 520, y: 400, width: 400, height: 300 };
    const wideOpts = {
      viewportW: 3000,
      viewportH: 3000,
      sidebarW: 340,
      minScale: 1.0,
      maxScale: 5.0,
      fill: 0.5,
      side: "left" as const,
    };
    const result = computeRoomFocusTransform(layer, wideOpts);
    const availW = wideOpts.viewportW - wideOpts.sidebarW;
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    const contentW = FRAME_WIDTH * result.scale;
    const contentH = FRAME_HEIGHT * result.scale;
    // Sanity-check the result is genuinely unclamped on both axes before
    // asserting the centering invariant.
    expect(result.x).toBeGreaterThan(wideOpts.viewportW - contentW);
    expect(result.x).toBeLessThan(0);
    expect(result.y).toBeGreaterThan(wideOpts.viewportH - contentH);
    expect(result.y).toBeLessThan(0);
    expect(result.x + cx * result.scale).toBeCloseTo(wideOpts.sidebarW + availW / 2, 1);
    expect(result.y + cy * result.scale).toBeCloseTo(wideOpts.viewportH / 2, 1);
  });

  it("docks a real right-side room (cms-room) left and clamps x to the cover left bound", () => {
    // cms-room manifest coords.
    const layer = { x: 1140.89, y: 346.98, width: 291.266, height: 257.348 };
    const result = computeRoomFocusTransform(layer, { ...opts, side: "left" });
    expect(result.scale).toBeCloseTo(3.1475, 3);
    // x-centering (sidebarW + availW/2 - cx*scale) falls below the cover
    // left bound (viewportW - contentW), so it clamps there.
    const contentW = FRAME_WIDTH * result.scale;
    expect(result.x).toBeCloseTo(opts.viewportW - contentW, 1);
    // y is unclamped for this room/viewport combo.
    expect(result.y).toBeCloseTo(-1047.12, 1);
  });
});

describe("greetingAnchor", () => {
  it("centers horizontally and, with no head measurement, still anchors at the layer top", () => {
    // sprite-only people / NPCs / saved avatars keep the original behaviour
    const layer = { x: 126.31, y: 490.07, width: 22.149, height: 31.323 };
    const result = greetingAnchor(layer);
    expect(result.leftPct).toBeCloseTo(((126.31 + 22.149 / 2) / FRAME_WIDTH) * 100, 6);
    expect(result.topPct).toBeCloseTo((490.07 / FRAME_HEIGHT) * 100, 6);
  });

  it("anchors a live-3D character off its measured head, not the layer's top edge", () => {
    const layer = { x: 0, y: 100, width: 28.18, height: 39.85 };
    const headTopAboveCenter = 14.437; // angelo, measured
    const result = greetingAnchor(layer, headTopAboveCenter);
    const headTopY = 100 + 39.85 / 2 - 14.437;
    expect(result.topPct).toBeCloseTo(((headTopY - HEAD_LABEL_GAP_FRAME_UNITS) / FRAME_HEIGHT) * 100, 6);
    // horizontal centring is untouched by the head anchor
    expect(result.leftPct).toBeCloseTo(((0 + 28.18 / 2) / FRAME_WIDTH) * 100, 6);
  });

  it("the head anchor is independent of layer-box headroom", () => {
    // same character, two different layer boxes (own manifest layer vs bon's
    // roster seat box): the gap between head and label must not move.
    const headTopAboveCenter = 14.864; // micah, measured
    const gapFor = (height: number) => {
      const { topPct } = greetingAnchor({ x: 0, y: 0, width: 10, height }, headTopAboveCenter);
      const labelY = (topPct / 100) * FRAME_HEIGHT;
      const headY = height / 2 - headTopAboveCenter;
      return headY - labelY;
    };
    expect(gapFor(39.1)).toBeCloseTo(gapFor(37.2), 10);
    expect(gapFor(39.1)).toBeCloseTo(HEAD_LABEL_GAP_FRAME_UNITS, 10);
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

describe("formatShortName", () => {
  it("keeps only the first name from a two-word name", () => {
    expect(formatShortName({ id: "aina", name: "Aina Perez" })).toBe("Aina");
  });

  it("keeps only the first name from a three-word name", () => {
    expect(formatShortName({ id: "rhendel", name: "Rhendel Khey Cayaco" })).toBe("Rhendel");
  });

  it("leaves a single-word nickname unchanged", () => {
    expect(formatShortName({ id: "lui", name: "Lui" })).toBe("Lui");
  });

  it("falls back to the id-derived, title-cased name when no name is set", () => {
    expect(formatShortName({ id: "alex", name: undefined })).toBe("Alex");
  });

  it("never returns blank for an empty/whitespace-only name", () => {
    expect(formatShortName({ id: "alex", name: "   " })).toBe(
      formatCharacterName({ id: "alex", name: "   " }),
    );
  });
});
