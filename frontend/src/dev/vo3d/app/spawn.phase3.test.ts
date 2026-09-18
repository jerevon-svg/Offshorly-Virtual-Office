// Phase 3 — the structural promises no runtime test can make, asserted against the source.
//
// Each one is about something that must NOT be there. A behavioural test can show that Bon lands at his
// desk; it cannot show that the standalone page still gets its own spawn, that no attendance was read on
// the way, or that the Design Room's 16 units were not copied into a second file where they would rot.
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) and
// pulling in @types/node here would change global setTimeout typing for the whole app — the same
// exemption identity.phase2.test.ts and graphics-flash.test.ts take. vitest runs in Node with
// cwd = frontend/, so the reads below are plain relative paths.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const world = readFileSync("src/dev/vo3d/app/world.ts", "utf8");
const bootstrap = readFileSync("src/dev/vo3d/app/bootstrap.ts", "utf8");
const spawn = readFileSync("src/dev/vo3d/app/spawn.ts", "utf8");
const adapter = readFileSync("src/dev/vo3d/adapters/v1HomeDesk.ts", "utf8");
const homeSeat = readFileSync("src/data/homeSeat.ts", "utf8");
const officeMap = readFileSync("src/components/OfficeMap/OfficeMap.tsx", "utf8");

/** Source with its comments removed. Several promises below are about what the CODE reaches for, and
 *  these files explain themselves at length — a prose mention of attendance, or of the Design Room's 16
 *  units, is the documentation doing its job, not the module doing the thing. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the standalone world is untouched", () => {
  it("takes the home desk as an OPTIONAL third parameter", () => {
    // Phase 5 appended a fourth optional parameter (the self-movement sink) — the point of this case is
    // that the desk is still optional and still third, so the standalone page's zero-argument call is
    // unchanged. spawn.phase5.test.ts owns the fourth one.
    expect(world).toContain("identity?: Vo3dIdentity, homeDesk?: Vo3dHomeDesk");
  });

  it("still gives the dev page its own default spawn, unconditionally", () => {
    // The Design Room chair's approach point, set beside the avatar's construction and never guarded.
    expect(world).toContain("avatar.setPosition(chairSeat.approach);");
    expect(bootstrap).toContain("createVo3dWorld(document.getElementById(\"stage\") as HTMLCanvasElement)");
  });

  it("only moves the body when a desk was actually handed over", () => {
    const start = world.indexOf("if (homeDesk) {");
    expect(start).toBeGreaterThan(-1);
    // Everything the spawn does is inside that one guard — including the refusal path.
    const block = world.slice(start, world.indexOf("\n  }\n", start));
    expect(block).toContain("playerMode.body.placeNear(target)");
    expect(block).toContain("kept the default spawn");
  });
});

describe("placement is V2's own collision answer", () => {
  it("uses the player body's existing placeNear rather than writing a position straight in", () => {
    // placeNear is judged by playerStand — the same predicate every WASD step goes through.
    expect(world).toMatch(/if \(playerMode\.body\.placeNear\(target\)\) \{/);
    expect(world).toContain("avatar.setPosition(placed)");
  });

  it("never forces a body that has nowhere legal to stand", () => {
    expect(world).not.toMatch(/placeNear\(target\);\s*\n\s*avatar\.setPosition/);
  });
});

describe("the Design Room's world shift has one source", () => {
  it("is applied from the floor plan's table, not copied as a number", () => {
    expect(world).toContain("homeDeskWorldPoint(homeDesk.point, v1Rooms(), ROOM_WORLD_SHIFT_Z)");
    expect(code(spawn)).not.toMatch(/\b16\b/);
    expect(code(adapter)).not.toMatch(/\b16\b/);
  });

  it("is never mentioned by the V1 side at all", () => {
    // The adapter reads V1 coordinates and hands them over unshifted; a room that moved is V2's fact.
    expect(code(adapter)).not.toContain("WORLD_SHIFT");
    expect(code(adapter)).not.toContain("design-room");
  });
});

describe("a desk is not an arrival", () => {
  it("reads no attendance, no movement sync and no persisted position", () => {
    for (const forbidden of ["attendance", "movementSync", "positions_snapshot", "employee_positions", "checkout", "apiFetch"]) {
      expect(code(adapter), `adapter must not reach for ${forbidden}`).not.toContain(forbidden);
      expect(code(spawn), `contract must not reach for ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("never substitutes Reception for an unresolved employee", () => {
    // roomIdForPerson returning null is the refusal; FALLBACK_ROOM_ID must not appear as a rescue.
    expect(adapter).toContain("if (!assigned) return null;");
    expect(code(adapter)).not.toContain("FALLBACK_ROOM_ID");
  });
});

describe("nobody borrows Bon's body box", () => {
  it("does no sprite top-left conversion, and names no employee's dimensions", () => {
    for (const src of [code(spawn), code(adapter)]) {
      expect(src).not.toContain("bonLayer");
      expect(src).not.toContain("playerCharacterLayer");
      expect(src).not.toMatch(/\/\s*2\b/); // no half-width/half-height offsetting of any kind
    }
  });
});

describe("V1 keeps exactly one seat rule", () => {
  it("resolves its own seat through the shared module", () => {
    expect(officeMap).toContain('import { resolveHomeDesk } from "../../data/homeSeat";');
    expect(officeMap).toContain("return resolveHomeDesk(currentUser?.email, currentUser?.team ?? null).seat;");
    // The old private copies are gone — not duplicated, not left behind to drift.
    expect(officeMap).not.toContain("function nearestSeatTo(");
  });

  it("is the same module the V2 adapter reads", () => {
    expect(adapter).toContain('import { resolveHomeDesk } from "../../../data/homeSeat";');
    expect(homeSeat).toContain("export function resolveHomeDesk(");
  });

  it("kept V1's rule verbatim: door-in stand point first, room centre second, null last", () => {
    expect(homeSeat).toContain("const doorPair = doorStandForRoom(roomId);");
    expect(homeSeat).toContain("if (doorPair) return { roomId, seat: nearestSeatTo(roomId, doorPair.inStand) };");
    expect(homeSeat).toContain("const center = { x: flatRoom.x + flatRoom.width / 2, y: flatRoom.y + flatRoom.height / 2 };");
  });
});
