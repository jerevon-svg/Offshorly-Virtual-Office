import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BadgeMedallion } from "./BadgeMedallion";

// The point of this component is that a badge is a physical object: the TIER changes the metal the
// whole thing is struck in, and the EMBLEM changes what is struck onto it. Both are asserted here
// because either one silently collapsing (every tier the same colour, every badge the same glyph)
// is exactly the failure that made the old pinned badges read as plain icons.
describe("BadgeMedallion", () => {
  const stopsFor = (tier: number) => {
    const { container, unmount } = render(<BadgeMedallion emblem="regular" tier={tier} />);
    const stops = Array.from(container.querySelectorAll("stop")).map((s) => s.getAttribute("stop-color"));
    unmount();
    return stops.join("|");
  };

  const glyphFor = (emblem: string) => {
    const { container, unmount } = render(<BadgeMedallion emblem={emblem} tier={3} />);
    // svg > g is the emblem wrapper; its first child is the shade pass, whose markup is the raw
    // glyph (it paints with currentColor, so this comparison is colour-independent).
    const markup = container.querySelector("svg > g > g")?.innerHTML ?? "";
    unmount();
    return markup;
  };

  it("strikes every tier in its own metal", () => {
    const perTier = [0, 1, 2, 3, 4].map(stopsFor);
    expect(perTier.every(Boolean)).toBe(true);
    expect(new Set(perTier).size).toBe(5);
  });

  it("gives each instance its own gradient ids, so three on one sidebar cannot cross-apply", () => {
    const { container } = render(
      <>
        <BadgeMedallion emblem="regular" tier={3} badgeId="a" />
        <BadgeMedallion emblem="streak" tier={1} badgeId="b" />
      </>,
    );
    const ids = Array.from(container.querySelectorAll("defs > *")).map((n) => n.getAttribute("id"));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("draws a recognisable emblem per badge rather than one shared glyph", () => {
    const seen = ["regular", "streak", "pathfinder", "cheerleader", "connector"].map(glyphFor);
    expect(seen.every(Boolean)).toBe(true);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("still renders a medallion for an emblem key it has no artwork for", () => {
    render(<BadgeMedallion emblem="not-a-real-emblem" tier={2} badgeId="x" />);
    const svg = screen.getByTestId("medallion-x");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("data-tier", "2");
  });

  it("clamps an out-of-range tier instead of drawing nothing", () => {
    const { container } = render(<BadgeMedallion emblem="regular" tier={99} />);
    expect(container.querySelectorAll("stop").length).toBeGreaterThan(0);
  });
});
