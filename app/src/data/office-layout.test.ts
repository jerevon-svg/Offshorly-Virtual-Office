import { describe, expect, it } from "vitest";
import { formatRoomName, officeAssetLayers, roomContainingPoint, roomMembersById } from "./office-layout";

// Count derived from the Figma-verified furniture-crop table used to seed
// imgCrop on the manifest (Fix A) — kept in sync manually with that source.
const EXPECTED_IMG_CROP_COUNT = 103;

describe("roomMembersById", () => {
  it("assigns npcs whose center point falls inside design-room's bounding box", () => {
    const ids = roomMembersById["design-room"].map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["angelo", "micah", "clang", "france"]));
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain("bon");
  });

  it("gives every room a guaranteed real empty array, not undefined", () => {
    expect(roomMembersById["ai-room"]).toEqual([]);
    expect(roomMembersById["ai-room"]).not.toBeUndefined();
  });
});

describe("roomContainingPoint", () => {
  it("returns the design-room layer for a point inside its bounds", () => {
    // design-room manifest coords: x=9.14, y=316.02, width=309.53, height=262.902.
    const room = roomContainingPoint({ x: 100, y: 400 });
    expect(room?.id).toBe("design-room");
  });

  it("returns null for a point clearly outside every room's bounds", () => {
    // Far outside the 1440x1244 frame entirely.
    const room = roomContainingPoint({ x: -500, y: -500 });
    expect(room).toBeNull();
  });
});

describe("formatRoomName", () => {
  it("uses the explicit override for ai-room", () => {
    expect(formatRoomName("ai-room")).toBe("AI Room");
  });

  it("uses the explicit override for cms-room", () => {
    expect(formatRoomName("cms-room")).toBe("CMS Room");
  });

  it("uses the explicit override for qa-room", () => {
    expect(formatRoomName("qa-room")).toBe("QA Room");
  });

  it("titlecases non-override ids", () => {
    expect(formatRoomName("dev-room")).toBe("Dev Room");
    expect(formatRoomName("central-hub")).toBe("Central Hub");
  });
});

describe("imgCrop (Fix A: per-instance furniture crop fidelity)", () => {
  it("has a valid shape wherever present in the manifest", () => {
    for (const layer of officeAssetLayers) {
      if (layer.imgCrop == null) continue;
      expect(typeof layer.imgCrop.wPct).toBe("number");
      expect(typeof layer.imgCrop.hPct).toBe("number");
      expect(typeof layer.imgCrop.leftPct).toBe("number");
      expect(typeof layer.imgCrop.topPct).toBe("number");
    }
  });

  it("never appears on a floor-kind layer", () => {
    for (const layer of officeAssetLayers) {
      if (layer.kind === "floor") {
        expect(layer.imgCrop).toBeUndefined();
      }
    }
  });

  it("is present on exactly the number of entries in the crop table", () => {
    const count = officeAssetLayers.filter((l) => l.imgCrop != null).length;
    expect(count).toBe(EXPECTED_IMG_CROP_COUNT);
  });
});
