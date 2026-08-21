import { describe, expect, it } from "vitest";
import { officeAssetLayers, bonLayer } from "../../data/office-layout";
import { slotIndexToPosition } from "./lineupSlots";

const sidewalk = officeAssetLayers.find((layer) => layer.id === "sidewalk")!;
const AVATAR_WIDTH = bonLayer.width;
const AVATAR_HEIGHT = bonLayer.height;

describe("slotIndexToPosition", () => {
  it("is deterministic — same slot always maps to the same position", () => {
    expect(slotIndexToPosition(3)).toEqual(slotIndexToPosition(3));
    expect(slotIndexToPosition(0)).toEqual(slotIndexToPosition(0));
  });

  it("keeps every position within the sidewalk's bounds across a reasonable range of slots", () => {
    for (let slot = 0; slot < 60; slot++) {
      const pos = slotIndexToPosition(slot);
      expect(pos.x).toBeGreaterThanOrEqual(sidewalk.x);
      expect(pos.x + AVATAR_WIDTH).toBeLessThanOrEqual(sidewalk.x + sidewalk.width + 0.01);
      expect(pos.y).toBeGreaterThanOrEqual(sidewalk.y);
      expect(pos.y + AVATAR_HEIGHT).toBeLessThanOrEqual(sidewalk.y + sidewalk.height + 0.01);
    }
  });

  it("never places two distinct slots (within a reasonable range) at overlapping positions", () => {
    const seen: Array<{ x: number; y: number }> = [];
    for (let slot = 0; slot < 60; slot++) {
      const pos = slotIndexToPosition(slot);
      for (const other of seen) {
        const overlapsX = Math.abs(pos.x - other.x) < AVATAR_WIDTH;
        const overlapsY = Math.abs(pos.y - other.y) < AVATAR_HEIGHT;
        expect(overlapsX && overlapsY).toBe(false);
      }
      seen.push(pos);
    }
  });

  it("lays slots out left-to-right within a row before wrapping", () => {
    const first = slotIndexToPosition(0);
    const second = slotIndexToPosition(1);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBe(first.y);
  });
});
