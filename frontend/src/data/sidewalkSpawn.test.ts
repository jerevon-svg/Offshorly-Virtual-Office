import { describe, expect, it } from "vitest";
import manifest from "./office-assets-manifest.json";
import { bonLayer } from "./office-layout";
import { isWalkable, worldToCell } from "./officeGrid";

// Regression guard for the checkout-exit-walk destination: bon's spawn
// layer (bonLayer, also used as the CHECKOUT_SUCCESS exit-walk goal — see
// OfficeMap.tsx's proceedWithExitWalk) must always land on the sidewalk
// decor zone, and that spot must be walkable. If a future manifest
// re-export silently drifts bonLayer or the sidewalk rect, this test fails
// loudly instead of leaving checked-out avatars stranded off the sidewalk.
describe("bonLayer spawn sits on the sidewalk", () => {
  const sidewalk = (manifest as Array<Record<string, unknown>>).find(
    (layer) => layer.id === "sidewalk",
  ) as { x: number; y: number; width: number; height: number } | undefined;

  it("manifest still has a sidewalk decor layer", () => {
    expect(sidewalk).toBeDefined();
  });

  it("bonLayer's center falls within the sidewalk's y-band", () => {
    if (!sidewalk) throw new Error("sidewalk layer missing from manifest");
    const centerY = bonLayer.y + bonLayer.height / 2;
    expect(centerY).toBeGreaterThanOrEqual(sidewalk.y);
    expect(centerY).toBeLessThanOrEqual(sidewalk.y + sidewalk.height);
  });

  it("bonLayer's center falls within the sidewalk's x-span", () => {
    if (!sidewalk) throw new Error("sidewalk layer missing from manifest");
    const centerX = bonLayer.x + bonLayer.width / 2;
    expect(centerX).toBeGreaterThanOrEqual(sidewalk.x);
    expect(centerX).toBeLessThanOrEqual(sidewalk.x + sidewalk.width);
  });

  it("bonLayer's spawn cell is walkable", () => {
    const cell = worldToCell({
      x: bonLayer.x + bonLayer.width / 2,
      y: bonLayer.y + bonLayer.height / 2,
    });
    expect(isWalkable(cell.cx, cell.cy)).toBe(true);
  });
});
