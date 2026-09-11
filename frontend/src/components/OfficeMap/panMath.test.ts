import { describe, expect, it } from "vitest";
import type { AssetLayer } from "../../types/office";
import { FRAME_HEIGHT, FRAME_WIDTH } from "../../data/office-layout";
import { formatCharacterName, formatShortName } from "../../data/office-layout";
import {
  computeCenterTransform,
  computeRoomFocusTransform,
  layerCenter,
  resolveRenderedLayer,
  greetingAnchor,
  HEAD_LABEL_GAP_FRAME_UNITS,
  characterScreenCenter,
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

describe("resolveRenderedLayer — Search Locate targets the drawn avatar, not the seat", () => {
  const seatAlex: AssetLayer = {
    id: "alex@offshorly.com",
    kind: "character",
    // Alex's ASSIGNED desk (the CEO desk) — what officePeopleToLayers seats them at.
    path: "/alex.png",
    x: 4000,
    y: 500,
    width: 100,
    height: 200,
    transform: null,
  };
  // The same person as actually positioned for render, moved to Central Hub by the offline
  // sidewalk lineup (applyOfflineLineupPositions).
  const renderedAlex: AssetLayer = { ...seatAlex, x: 1200, y: 1600 };

  it("prefers the positioned render layer over the passed seat layer", () => {
    const out = resolveRenderedLayer(seatAlex, [[renderedAlex]], {});
    expect(out.x).toBe(1200);
    expect(out.y).toBe(1600);
  });

  it("lets a live walk position win over both", () => {
    const out = resolveRenderedLayer(seatAlex, [[renderedAlex]], {
      "alex@offshorly.com": { pos: { x: 2222, y: 3333 } },
    });
    expect(out.x).toBe(2222);
    expect(out.y).toBe(3333);
    // Dimensions still come from the resolved layer, so centring stays correct.
    expect(out.width).toBe(100);
    expect(out.height).toBe(200);
  });

  it("falls through the chain in order and matches ids case-insensitively", () => {
    const npcFallback: AssetLayer = { ...seatAlex, x: 77, y: 88 };
    const out = resolveRenderedLayer({ ...seatAlex, id: "ALEX@offshorly.com" }, [[], [npcFallback]], {});
    expect(out.x).toBe(77);
  });

  it("returns the original layer when the person is in no chain and not walking", () => {
    expect(resolveRenderedLayer(seatAlex, [[], []], {})).toBe(seatAlex);
  });

  it("pans to the drawn position, not the seat", () => {
    const seat = computeCenterTransform(seatAlex, 1, 800, 600);
    const drawn = computeCenterTransform(
      resolveRenderedLayer(seatAlex, [[renderedAlex]], {}),
      1,
      800,
      600,
    );
    expect(drawn).not.toEqual(seat);
    expect(drawn).toEqual(computeCenterTransform(renderedAlex, 1, 800, 600));
  });
});

describe("Message + Call aim at the rendered teammate, not the assigned seat", () => {
  // Generic fixture — any employee, no mock/NPC special case, no hardcoded office coordinates.
  const seat: AssetLayer = {
    id: "person@example.com",
    kind: "character",
    path: "/p.png",
    x: 4000,
    y: 500,
    width: 100,
    height: 200,
    transform: null,
  };
  const positioned: AssetLayer = { ...seat, x: 1200, y: 1600 };
  const chain = [[positioned]];

  // What handleChoose now hands to approachCharacter, which aims at layerCenter(target).
  const aimFor = (
    live: Readonly<Record<string, { pos: { x: number; y: number } }>>,
  ) => layerCenter(resolveRenderedLayer(seat, chain, live));

  it("aims at the positioned render layer, never the seat", () => {
    expect(aimFor({})).toEqual(layerCenter(positioned));
    expect(aimFor({})).not.toEqual(layerCenter(seat));
  });

  it("aims at a live walk position when one is in flight", () => {
    const live = { "person@example.com": { pos: { x: 2222, y: 3333 } } };
    expect(aimFor(live)).toEqual({ x: 2222 + 50, y: 3333 + 100 });
  });

  it("uses the identical aim point Locate pans to, so all three agree", () => {
    const live = { "person@example.com": { pos: { x: 900, y: 950 } } };
    const forInteraction = resolveRenderedLayer(seat, chain, live);
    const forLocate = resolveRenderedLayer(seat, chain, live);
    expect(layerCenter(forInteraction)).toEqual(layerCenter(forLocate));
  });

  it("keeps identity intact so DM routing and the DND/attendance gates are unaffected", () => {
    const live = { "person@example.com": { pos: { x: 10, y: 20 } } };
    expect(resolveRenderedLayer(seat, chain, live).id).toBe(seat.id);
  });

  it("falls back to the passed layer when the person is neither positioned nor walking", () => {
    expect(aimFor({})).toEqual(layerCenter(positioned));
    expect(layerCenter(resolveRenderedLayer(seat, [[]], {}))).toEqual(layerCenter(seat));
  });
});

describe("characterScreenCenter", () => {
  const layer = { x: 100, y: 200, width: 60, height: 90 };
  it("maps the layer centre through the wrapper's pan/zoom into screen space", () => {
    expect(characterScreenCenter(layer, { positionX: -50, positionY: -20, scale: 2 }, { left: 10, top: 5 })).toEqual({
      clientX: 10 + -50 + 130 * 2,
      clientY: 5 + -20 + 245 * 2,
    });
  });
  it("moves with the zoom, so an open menu can follow the character", () => {
    const a = characterScreenCenter(layer, { positionX: 0, positionY: 0, scale: 1 }, { left: 0, top: 0 });
    const b = characterScreenCenter(layer, { positionX: 0, positionY: 0, scale: 3 }, { left: 0, top: 0 });
    expect(b.clientX).toBe(a.clientX * 3);
    expect(b.clientY).toBe(a.clientY * 3);
  });
});
