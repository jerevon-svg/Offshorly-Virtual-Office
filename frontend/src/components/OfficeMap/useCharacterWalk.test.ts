import { describe, it, expect } from "vitest";
import { directionBetween } from "./useCharacterWalk";

describe("directionBetween", () => {
  it("faces right when target is to the right", () => {
    expect(directionBetween({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe("right");
  });

  it("faces left when target is to the left", () => {
    expect(directionBetween({ x: 0, y: 0 }, { x: -10, y: 0 })).toBe("left");
  });

  it("faces front (viewer) when target is below (y grows downward)", () => {
    expect(directionBetween({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe("front");
  });

  it("faces back when target is above", () => {
    expect(directionBetween({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe("back");
  });

  it("breaks diagonal ties in favor of horizontal axis when |dx| > |dy|", () => {
    expect(directionBetween({ x: 0, y: 0 }, { x: 10, y: 3 })).toBe("right");
  });

  it("breaks diagonal ties in favor of vertical axis when |dy| > |dx|", () => {
    expect(directionBetween({ x: 0, y: 0 }, { x: 3, y: 10 })).toBe("front");
  });
});
