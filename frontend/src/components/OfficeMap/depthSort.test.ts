import { describe, expect, it } from "vitest";
import type { AssetLayer } from "../../types/office";
import { depthCompare } from "./depthSort";

function layer(overrides: Partial<AssetLayer> & { id: string; kind: AssetLayer["kind"] }): AssetLayer {
  return {
    path: `${overrides.id}.png`,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    transform: null,
    ...overrides,
  };
}

describe("depthCompare", () => {
  it("sorts character behind desk when character feet-Y is less than desk bottom-Y", () => {
    const character = layer({ id: "angelo", kind: "character", y: 0, height: 10 }); // feet-Y 10
    const desk = layer({ id: "desk-1", kind: "furniture", y: 5, height: 10 }); // feet-Y 15

    const sorted = [desk, character].sort(depthCompare);

    expect(sorted.map((l) => l.id)).toEqual(["angelo", "desk-1"]);
  });

  it("sorts character in front of desk when character feet-Y is greater than desk bottom-Y", () => {
    const character = layer({ id: "angelo", kind: "character", y: 20, height: 10 }); // feet-Y 30
    const desk = layer({ id: "desk-1", kind: "furniture", y: 0, height: 10 }); // feet-Y 10

    const sorted = [character, desk].sort(depthCompare);

    expect(sorted.map((l) => l.id)).toEqual(["desk-1", "angelo"]);
  });

  it("keeps floor/room/decor before furniture/character regardless of baseline values", () => {
    const floor = layer({ id: "floor-1", kind: "floor", y: 1000, height: 1000 });
    const room = layer({ id: "room-1", kind: "room", y: 1000, height: 1000 });
    const decor = layer({ id: "decor-1", kind: "decor", y: 1000, height: 1000 });
    const desk = layer({ id: "desk-1", kind: "furniture", y: 0, height: 1 });
    const character = layer({ id: "angelo", kind: "character", y: 0, height: 1 });

    const sorted = [character, desk, decor, room, floor].sort(depthCompare);

    // room and decor share the same fixed bucket (1); stable sort preserves
    // their relative input order (decor before room, matching input order).
    expect(sorted.map((l) => l.id)).toEqual(["floor-1", "decor-1", "room-1", "desk-1", "angelo"]);
  });

  it("draws furniture before character when baselines are equal (character appears on top)", () => {
    const desk = layer({ id: "desk-1", kind: "furniture", y: 0, height: 10 }); // feet-Y 10
    const character = layer({ id: "angelo", kind: "character", y: 0, height: 10 }); // feet-Y 10

    const sortedA = [character, desk].sort(depthCompare);
    const sortedB = [desk, character].sort(depthCompare);

    expect(sortedA.map((l) => l.id)).toEqual(["desk-1", "angelo"]);
    expect(sortedB.map((l) => l.id)).toEqual(["desk-1", "angelo"]);
  });

  it("sorts sidewalk after floor but before room/decor, regardless of baseline/y-position", () => {
    const floor = layer({ id: "floor-1", kind: "floor", y: 5000, height: 5000 });
    const sidewalk = layer({ id: "sidewalk", kind: "sidewalk", y: 0, height: 1 });
    const room = layer({ id: "room-1", kind: "room", y: 0, height: 1 });
    const decor = layer({ id: "decor-1", kind: "decor", y: 0, height: 1 });

    const sorted = [room, decor, floor, sidewalk].sort(depthCompare);

    // room and decor share the same fixed bucket (1); stable sort preserves
    // their relative input order (room before decor, matching input order).
    expect(sorted.map((l) => l.id)).toEqual(["floor-1", "sidewalk", "room-1", "decor-1"]);
  });

  it("sorts a seated character in front of its chair even when the character's baseline is less than the chair's (real ceo-chair/alex numbers)", () => {
    const ceoChair = layer({
      id: "ceo-chair",
      kind: "furniture",
      path: "assets/office/furniture/executive-team/exec-chair.png",
      y: 69.22,
      height: 39.36,
    }); // baseline 108.58
    const alex = layer({
      id: "alex",
      kind: "character",
      path: "assets/office/characters/alex.png",
      y: 70.44,
      height: 29.38,
    }); // baseline 99.82

    const sorted = [alex, ceoChair].sort(depthCompare);

    expect(sorted.map((l) => l.id)).toEqual(["ceo-chair", "alex"]);
  });

  it("still sorts a character behind a desk when the desk's baseline is larger (real ceo-desk/alex numbers, no regression)", () => {
    const ceoDesk = layer({
      id: "ceo-desk",
      kind: "furniture",
      path: "assets/office/furniture/executive-team/ceo-desk.png",
      y: 93.17,
      height: 57.07,
    }); // baseline 150.24
    const alex = layer({
      id: "alex",
      kind: "character",
      path: "assets/office/characters/alex.png",
      y: 70.44,
      height: 29.38,
    }); // baseline 99.82

    const sorted = [ceoDesk, alex].sort(depthCompare);

    expect(sorted.map((l) => l.id)).toEqual(["alex", "ceo-desk"]);
  });

  it("keeps a character behind a chair when comparing a mixed desk/chair/character array (transitive-safe, floor/room/decor unaffected)", () => {
    const ceoDesk = layer({
      id: "ceo-desk",
      kind: "furniture",
      path: "assets/office/furniture/executive-team/ceo-desk.png",
      y: 93.17,
      height: 57.07,
    });
    const ceoChair = layer({
      id: "ceo-chair",
      kind: "furniture",
      path: "assets/office/furniture/executive-team/exec-chair.png",
      y: 69.22,
      height: 39.36,
    });
    const alex = layer({
      id: "alex",
      kind: "character",
      path: "assets/office/characters/alex.png",
      y: 70.44,
      height: 29.38,
    });

    const sorted = [alex, ceoChair, ceoDesk].sort(depthCompare);

    // chair (baseline 108.58) sorts before desk (baseline 150.24) by normal
    // furniture-vs-furniture baseline rules; alex sorts after the chair via
    // the seat-override rule, but still before the desk via normal baseline
    // (99.82 < 150.24) — net order: chair, alex, desk.
    expect(sorted.map((l) => l.id)).toEqual(["ceo-chair", "alex", "ceo-desk"]);
  });

  it("sorts a character in front of a sofa via real .sort() even when the sort algorithm never directly compares that pair (key-based, not pairwise-conditional)", () => {
    // Regression: france's baseline (60) is LESS than the sofa's baseline
    // (200) — exactly the case the seat-override rule targets. Padding the
    // array with several other characters/furniture increases the odds
    // that a real sort algorithm's internal comparison sequence never
    // directly pits france against the sofa, which is what broke the old
    // pairwise-conditional implementation. The key-based fix must still
    // resolve this correctly because -Infinity < any real baseline holds
    // transitively.
    const sofa = layer({
      id: "lounge-sofa",
      kind: "furniture",
      path: "assets/office/furniture/lounge/sofa.png",
      y: 150,
      height: 50,
    }); // baseline 200
    const france = layer({ id: "france", kind: "character", y: 50, height: 10 }); // baseline 60
    const deskA = layer({ id: "desk-a", kind: "furniture", y: 80, height: 10 }); // baseline 90
    const deskB = layer({ id: "desk-b", kind: "furniture", y: 100, height: 10 }); // baseline 110
    const charA = layer({ id: "char-a", kind: "character", y: 90, height: 10 }); // baseline 100
    const charB = layer({ id: "char-b", kind: "character", y: 120, height: 10 }); // baseline 130

    const sorted = [sofa, charB, deskB, france, charA, deskA].sort(depthCompare);

    expect(sorted.map((l) => l.id)).toEqual([
      "lounge-sofa",
      "france",
      "desk-a",
      "char-a",
      "desk-b",
      "char-b",
    ]);
  });

  it("sorts a 4+ element mixed array (desk, chair, 2 characters at different baselines) end-to-end", () => {
    const desk = layer({ id: "desk-1", kind: "furniture", y: 100, height: 20 }); // baseline 120
    const chair = layer({
      id: "chair-1",
      kind: "furniture",
      path: "assets/office/furniture/chair-1.png",
      y: 40,
      height: 20,
    }); // baseline 60, but seat -> key -Infinity
    const lowChar = layer({ id: "low-char", kind: "character", y: 10, height: 10 }); // baseline 20
    const highChar = layer({ id: "high-char", kind: "character", y: 130, height: 10 }); // baseline 140

    const sorted = [highChar, desk, lowChar, chair].sort(depthCompare);

    expect(sorted.map((l) => l.id)).toEqual(["chair-1", "low-char", "desk-1", "high-char"]);
  });

  it("sorts characters among themselves by feet-Y when a room has zero furniture layers", () => {
    const a = layer({ id: "micah", kind: "character", y: 30, height: 10 }); // feet-Y 40
    const b = layer({ id: "clang", kind: "character", y: 5, height: 10 }); // feet-Y 15
    const c = layer({ id: "france", kind: "character", y: 20, height: 10 }); // feet-Y 30

    const sorted = [a, b, c].sort(depthCompare);

    expect(sorted.map((l) => l.id)).toEqual(["clang", "france", "micah"]);
    for (const l of sorted) {
      expect(Number.isFinite(l.y + l.height)).toBe(true);
    }
  });

  describe("cms-room occlusion-line override", () => {
    // Real dev-room corridor crossing: character feet-baseline ~351-363.
    it("sorts a corridor character (feet-baseline 355, below the 390 line) behind cms-room", () => {
      const cmsRoom = layer({ id: "cms-room", kind: "room", y: 100, height: 500 }); // real bbox baseline 600, irrelevant here
      const corridorCharacter = layer({ id: "walker", kind: "character", y: 345, height: 10 }); // baseline 355

      const sorted = [corridorCharacter, cmsRoom].sort(depthCompare);

      expect(sorted.map((l) => l.id)).toEqual(["walker", "cms-room"]);
    });

    // Real cms-room occupant: jona, feet ~426.9.
    it("sorts jona (feet-baseline ~426.9, above the 390 line) in front of cms-room", () => {
      const cmsRoom = layer({ id: "cms-room", kind: "room", y: 100, height: 500 });
      const jona = layer({ id: "jona", kind: "character", y: 400, height: 26.9 }); // baseline 426.9

      const sorted = [jona, cmsRoom].sort(depthCompare);

      expect(sorted.map((l) => l.id)).toEqual(["cms-room", "jona"]);
    });

    it("applies the occlusion line against furniture the same way as against characters", () => {
      const cmsRoom = layer({ id: "cms-room", kind: "room", y: 100, height: 500 });
      const lowDesk = layer({ id: "cms-desk", kind: "furniture", y: 300, height: 50 }); // baseline 350

      const sorted = [lowDesk, cmsRoom].sort(depthCompare);

      expect(sorted.map((l) => l.id)).toEqual(["cms-desk", "cms-room"]);
    });

    it("does not affect a room with no override entry (dev-room), regardless of character baseline", () => {
      const devRoom = layer({ id: "dev-room", kind: "room", y: 100, height: 500 });
      const belowLine = layer({ id: "walker-low", kind: "character", y: 345, height: 10 }); // baseline 355
      const aboveLine = layer({ id: "walker-high", kind: "character", y: 1000, height: 10 }); // baseline 1010

      const sortedLow = [belowLine, devRoom].sort(depthCompare);
      const sortedHigh = [aboveLine, devRoom].sort(depthCompare);

      // Original fixed-bucket rule: room (bucket 1) always before character (bucket 3),
      // unchanged by baseline in either direction.
      expect(sortedLow.map((l) => l.id)).toEqual(["dev-room", "walker-low"]);
      expect(sortedHigh.map((l) => l.id)).toEqual(["dev-room", "walker-high"]);
    });

    it("does not affect a second room with no override entry (executive-room), regardless of character baseline", () => {
      const execRoom = layer({ id: "executive-room", kind: "room", y: 0, height: 50 });
      const belowLine = layer({ id: "alex-low", kind: "character", y: 60, height: 10 }); // baseline 70
      const aboveLine = layer({ id: "alex-high", kind: "character", y: 500, height: 10 }); // baseline 510

      const sortedLow = [belowLine, execRoom].sort(depthCompare);
      const sortedHigh = [aboveLine, execRoom].sort(depthCompare);

      expect(sortedLow.map((l) => l.id)).toEqual(["executive-room", "alex-low"]);
      expect(sortedHigh.map((l) => l.id)).toEqual(["executive-room", "alex-high"]);
    });

    it("leaves cms-room vs another room comparison on the original fixed-bucket rule (room override never applies room-to-room)", () => {
      const cmsRoom = layer({ id: "cms-room", kind: "room", y: 100, height: 500 });
      const devRoom = layer({ id: "dev-room", kind: "room", y: 0, height: 10 });

      const sorted = [devRoom, cmsRoom].sort(depthCompare);

      // Same fixed bucket (1); stable sort preserves input order.
      expect(sorted.map((l) => l.id)).toEqual(["dev-room", "cms-room"]);
    });

    it("leaves cms-room vs floor and cms-room vs decor comparisons on the original fixed-bucket rule", () => {
      const cmsRoom = layer({ id: "cms-room", kind: "room", y: 100, height: 500 });
      const floor = layer({ id: "floor-1", kind: "floor", y: 5000, height: 5000 });
      const decor = layer({ id: "decor-1", kind: "decor", y: 0, height: 1 });

      const sorted = [cmsRoom, decor, floor].sort(depthCompare);

      expect(sorted.map((l) => l.id)).toEqual(["floor-1", "cms-room", "decor-1"]);
    });
  });
});
