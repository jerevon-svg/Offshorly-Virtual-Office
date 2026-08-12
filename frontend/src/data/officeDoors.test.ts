import { describe, expect, it } from "vitest";
import { officeAssetLayers, rooms } from "./office-layout";
import { DOOR_LAYERS_BY_ROOM, DOOR_SLIDE_DIRECTION } from "./officeDoors";

describe("officeDoors wiring", () => {
  const layerIds = new Set(officeAssetLayers.map((l) => l.id));
  const roomIds = new Set(rooms.map((r) => r.id));

  it("every DOOR_SLIDE_DIRECTION key is a real office asset layer id", () => {
    for (const id of Object.keys(DOOR_SLIDE_DIRECTION)) {
      expect(layerIds.has(id)).toBe(true);
    }
  });

  it("every DOOR_LAYERS_BY_ROOM array value is a real office asset layer id", () => {
    for (const ids of Object.values(DOOR_LAYERS_BY_ROOM)) {
      for (const id of ids) {
        expect(layerIds.has(id)).toBe(true);
      }
    }
  });

  it("every DOOR_LAYERS_BY_ROOM key is a real room id", () => {
    for (const roomId of Object.keys(DOOR_LAYERS_BY_ROOM)) {
      expect(roomIds.has(roomId)).toBe(true);
    }
  });
});
