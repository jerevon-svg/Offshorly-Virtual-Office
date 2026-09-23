// vo3d — THE SHARED ROOM-DRESSING DETAIL (V2 final room art pass).
//
// build/detail-props.ts is deliberately SMALL: after the live art review, the pass's rule became
// "architecture, furniture, materials and lighting carry the richness; props are secondary", and the
// builders that survived are the ones an architect would have drawn. Four things about them are testable
// rather than a matter of taste:
//
//  1. `counterNosing`'s TOP FACE. It is the one builder here with an arithmetic contract — the NOSING
//     profile's top sits 1.8 above its own y0, so the helper takes the counter's FINISHED top and does
//     that subtraction once. Six call sites would otherwise do it by hand and one would be wrong.
//  2. THE HEIGHT RULE. Every room on this floor has a 46-unit wall head and NO ceiling — the game camera
//     looks in OVER the walls, so anything taller is seen sticking out of the roof from outside, and the
//     failure is invisible from inside the room. It is how a 62-unit lamp and a 13-unit bunting pennant
//     both shipped past the first draft.
//  3. `pinBoard`'s CARDS STAYING ON THE BOARD. The field is laid out from the frame's span by two
//     deterministic strides; a card that walks off the edge is a card floating on plaster.
//  4. DETERMINISM. Every builder here is called during a room rebuild, and a rebuild that differs from
//     the last one is a rebuild the editor and the scene mirror cannot reason about.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buntingRun, counterNosing, cupStack, pinBoard, toeKick, trophyRow } from "./build/detail-props";
import { runSegments } from "./build/arch";

const box = (o: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(o);

/** the office's wall head (rooms/reception STRUCT.wallHeight); every room on the floor uses it */
const WALL_HEAD = 46;

describe("counterNosing — the one builder with arithmetic", () => {
  it("lands its top face on the counter's finished top, on the side `dir` names", () => {
    for (const axis of ["x", "z"] as const)
      for (const dir of [1, -1] as const) {
        const b = box(counterNosing({ axis, at: 500, dir, from: 100, to: 200, top: 26, key: "white" }));
        expect(b.max.y, `${axis}/${dir} top`).toBeCloseTo(26, 4);
        const across = axis === "x" ? { lo: b.min.z, hi: b.max.z } : { lo: b.min.x, hi: b.max.x };
        // the bullnose projects into the room and returns a little way back into the carcass
        if (dir === 1) expect(across.hi).toBeGreaterThan(500);
        else expect(across.lo).toBeLessThan(500);
      }
  });

  it("runs exactly from `from` to `to`", () => {
    const b = box(counterNosing({ axis: "x", at: 0, dir: 1, from: 120, to: 260, top: 26, key: "white" }));
    expect(b.min.x).toBeCloseTo(120, 4);
    expect(b.max.x).toBeCloseTo(260, 4);
  });

  it("stands a toe-kick on the floor with its shadow line above it", () => {
    const b = box(toeKick({ axis: "x", at: 0, dir: 1, from: 0, to: 100, key: "charcoal" }));
    expect(b.min.y).toBeCloseTo(0, 4);
    expect(b.max.y).toBeCloseTo(3.6, 4); // the PLINTH profile's full height
  });
});

describe("the height rule — nothing pokes out of the roof, nothing hangs into a head", () => {
  it("keeps counter dressing on the counter and under the wall head", () => {
    for (const [name, o] of [
      ["cupStack", cupStack({ x: 0, y0: 26, z: 0, key: "white" })],
      ["trophyRow", trophyRow(0, 30, 26, 0, 3, "bronze")],
    ] as const) {
      const b = box(o);
      expect(b.min.y, `${name} sinks into the worktop`).toBeGreaterThanOrEqual(25.9);
      expect(b.max.y, `${name} punches the wall head`).toBeLessThanOrEqual(WALL_HEAD);
    }
  });

  it("hangs bunting clear of a walking body and under the wall head", () => {
    // Bon is 36 units tall; a cord that dips into head height is a cord the player walks through
    const b = box(buntingRun({ axis: "x", at: 100, from: 0, to: 200, y: 45, sag: 1.6, drop: 6, colors: ["cyan", "neonPink"] }));
    expect(b.max.y).toBeLessThanOrEqual(WALL_HEAD);
    expect(b.min.y).toBeGreaterThan(36);
  });

  it("spans bunting from end to end on either axis", () => {
    const x = box(buntingRun({ axis: "x", at: 40, from: 10, to: 210, y: 45, colors: ["cyan"] }));
    expect(x.min.x).toBeLessThanOrEqual(10.5);
    expect(x.max.x).toBeGreaterThanOrEqual(209.5);
    const z = box(buntingRun({ axis: "z", at: 40, from: 10, to: 210, y: 45, colors: ["cyan"] }));
    expect(z.min.z).toBeLessThanOrEqual(10.5);
    expect(z.max.z).toBeGreaterThanOrEqual(209.5);
  });
});

describe("pinBoard — the cards stay on the board", () => {
  const spec = {
    axis: "x" as const, at: 400, dir: 1 as const, from: 100, to: 200, y0: 14, y1: 38,
    frame: "walnut" as const, board: "boardBg" as const, cards: ["cyan", "readyGreen"] as const,
  };

  it("keeps every card inside the frame's span and inside its height", () => {
    const g = pinBoard({ ...spec, cols: 5, rows: 3, name: "t" });
    const cards = g.children.filter((c) => c.name.startsWith("t-cards"));
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      const b = box(c);
      expect(b.min.x).toBeGreaterThanOrEqual(spec.from);
      expect(b.max.x).toBeLessThanOrEqual(spec.to);
      expect(b.min.y).toBeGreaterThanOrEqual(spec.y0);
      expect(b.max.y).toBeLessThanOrEqual(spec.y1);
    }
  });

  it("bakes the whole card field to one mesh per colour", () => {
    const g = pinBoard({ ...spec, cols: 5, rows: 3, name: "t" });
    expect(g.children.filter((c) => c.name.startsWith("t-cards")).length).toBe(spec.cards.length);
  });

  it("stands the board proud of its wall on the room side only", () => {
    const b = box(pinBoard({ ...spec, name: "t" }));
    expect(b.min.z).toBeGreaterThanOrEqual(spec.at - 0.01);
    const behind = box(pinBoard({ ...spec, dir: -1, name: "t2" }));
    expect(behind.max.z).toBeLessThanOrEqual(spec.at + 0.01);
  });
});

describe("runSegments — a moulding routes around what is already on the wall", () => {
  // A cornice hangs in the top 7 units of the wall, which is exactly where the Design Room's mantra
  // whiteboard, its left-hand boards, Meeting's framed artwork and Project's wall display all reach. A
  // run drawn straight through one of them is drawn across its FACE, and the review caught it cutting
  // "ALWAYS GIVE" in half. These are the four cases that matter.
  it("returns the whole run when nothing is in the way", () => {
    expect(runSegments(0, 100, [])).toEqual([{ from: 0, to: 100 }]);
  });

  it("splits around a gap, leaving `clear` on each side", () => {
    expect(runSegments(0, 100, [{ from: 40, to: 60 }], 3)).toEqual([{ from: 0, to: 37 }, { from: 63, to: 100 }]);
  });

  it("drops the stub when a gap runs to the end of the wall", () => {
    // 98…100 would be a 2-unit crumb of moulding; a run that short reads as debris, not as trim
    expect(runSegments(0, 100, [{ from: 50, to: 95 }], 3)).toEqual([{ from: 0, to: 47 }]);
  });

  it("handles several gaps, and merges the run away entirely when they cover it", () => {
    expect(runSegments(0, 100, [{ from: 20, to: 40 }, { from: 60, to: 80 }], 3))
      .toEqual([{ from: 0, to: 17 }, { from: 43, to: 57 }, { from: 83, to: 100 }]);
    expect(runSegments(0, 40, [{ from: 0, to: 40 }], 3)).toEqual([]);
  });
});

describe("determinism — a rebuild is identical", () => {
  it("builds the same bounds twice, for every surviving builder", () => {
    const make = () => [
      counterNosing({ axis: "z", at: 500, dir: 1, from: 0, to: 90, top: 28, key: "white" }),
      toeKick({ axis: "x", at: 0, dir: 1, from: 0, to: 80, key: "charcoal" }),
      pinBoard({ axis: "x", at: 0, dir: 1, from: 0, to: 90, y0: 14, y1: 36, frame: "walnut", board: "boardBg", cards: ["cyan", "readyGreen"], name: "d" }),
      buntingRun({ axis: "x", at: 0, from: 0, to: 200, y: 45, colors: ["cyan", "neonPink"], name: "d" }),
      cupStack({ x: 0, y0: 26, z: 0, key: "white" }),
      trophyRow(0, 30, 26, 0, 3, "bronze"),
    ];
    const a = make().map((o) => box(o));
    const b = make().map((o) => box(o));
    for (let i = 0; i < a.length; i++) {
      expect(a[i].min.toArray()).toEqual(b[i].min.toArray());
      expect(a[i].max.toArray()).toEqual(b[i].max.toArray());
    }
  });
});
