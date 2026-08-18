import { describe, expect, it } from "vitest";
import type { AssetLayer } from "../types/office";
import { backrestCropLayerId, computeBackSitOccupantBaselines } from "./backSitOccupancy";

// Matches backSitOccupancy.ts's backrestCropLayerId — kept as a local literal
// here (not imported) so these tests fail loudly if the suffix convention
// ever drifts unnoticed.
const crop = (furnitureId: string) => `${furnitureId}-backrest-crop`;

function rosterLayer(overrides: Partial<AssetLayer> & { id: string }): AssetLayer {
  return {
    kind: "character",
    path: `${overrides.id}.png`,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    transform: null,
    ...overrides,
  };
}

describe("computeBackSitOccupantBaselines", () => {
  it("produces an entry keyed by the synthetic backrest-crop layer id (not the base furnitureId directly)", () => {
    const layer = rosterLayer({ id: "jona@x.com", sitDirection: "back", furnitureId: "dev-side-sofa", y: 100, height: 20 });

    const map = computeBackSitOccupantBaselines([layer]);

    expect(map).toEqual({ [crop("dev-side-sofa")]: 120 });
    expect(map).not.toHaveProperty("dev-side-sofa");
  });

  it("does not produce an entry for front/left/right-facing occupants", () => {
    const front = rosterLayer({ id: "a@x.com", sitDirection: "front", furnitureId: "chair-1", y: 0, height: 10 });
    const left = rosterLayer({ id: "b@x.com", sitDirection: "left", furnitureId: "chair-2", y: 0, height: 10 });
    const right = rosterLayer({ id: "c@x.com", sitDirection: "right", furnitureId: "chair-3", y: 0, height: 10 });

    const map = computeBackSitOccupantBaselines([front, left, right]);

    expect(map).toEqual({});
  });

  it("does not produce an entry for a back-facing occupant with no furnitureId (non-manifest room)", () => {
    const layer = rosterLayer({ id: "d@x.com", sitDirection: "back", y: 0, height: 10 });

    const map = computeBackSitOccupantBaselines([layer]);

    expect(map).toEqual({});
  });

  it("does not produce an entry for an unoccupied seat (no roster layer at all)", () => {
    const map = computeBackSitOccupantBaselines([]);

    expect(map).toEqual({});
  });

  it("adds an entry for the live player when back-sitting on a manifest seat, keyed by the crop-layer id", () => {
    const map = computeBackSitOccupantBaselines([], {
      isSitting: true,
      sitDirection: "back",
      furnitureId: "ceo-chair",
      baseline: 150,
    });

    expect(map).toEqual({ [crop("ceo-chair")]: 150 });
  });

  it("does not add an entry for the live player when not sitting, not back-facing, or missing furnitureId", () => {
    expect(
      computeBackSitOccupantBaselines([], { isSitting: false, sitDirection: "back", furnitureId: "chair", baseline: 1 }),
    ).toEqual({});
    expect(
      computeBackSitOccupantBaselines([], { isSitting: true, sitDirection: "front", furnitureId: "chair", baseline: 1 }),
    ).toEqual({});
    expect(
      computeBackSitOccupantBaselines([], { isSitting: true, sitDirection: "back", baseline: 1 }),
    ).toEqual({});
  });

  it("combines roster and live-player entries, with the live player able to override the same furnitureId", () => {
    const roster = rosterLayer({ id: "e@x.com", sitDirection: "back", furnitureId: "shared-sofa", y: 10, height: 10 });

    const map = computeBackSitOccupantBaselines([roster], {
      isSitting: true,
      sitDirection: "back",
      furnitureId: "other-chair",
      baseline: 200,
    });

    expect(map).toEqual({ [crop("shared-sofa")]: 20, [crop("other-chair")]: 200 });
  });
});

describe("backrestCropLayerId", () => {
  it("suffixes a furniture id with -backrest-crop", () => {
    expect(backrestCropLayerId("dev-lead1-visitor1")).toBe("dev-lead1-visitor1-backrest-crop");
  });
});
