// PARKOUR V3 — THE LOCAL PLAYER IN THE TREEHOUSE, on the real Lab geometry (world/ailabV2): stacked decks under the
// feet, the ladder and the zipline taken from their ends with E (never from the wrong place or level), climbed and
// ridden the whole way, reversed, cut short at a safe end; falls caught by the deck below; the landing tiers; and the
// target facing (the mirrored formula fixed here).
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Avatar } from "./avatar/Avatar";
import { ControllerStack } from "./avatar/Controller";
import { PlayerMode, type ParkourKind, type RouteEvent } from "./player/PlayerMode";
import { WorldState } from "./world/WorldState";
import { HARD_FALL } from "./avatar/parkourPose";
import { JUMP_PAD, L1, L2, LAB2_FLOOR_Y, LAB_ROUTES, aiLabV3StandTest, labV2Surfaces, polar } from "./world/ailabV2";
import { StandableIndex } from "./world/standables";
import { BODY } from "./world/heightSolids";
import { routeDuration, routeExit } from "./world/traversalRoutes";
import type { Vec2 } from "./core/coords";
import type { Candidate } from "./player/PlayerTargeting";

const DT = 1 / 60, FY = LAB2_FLOOR_Y;
const idx = new StandableIndex(labV2Surfaces());
const ground = (p: Vec2, feet?: number) => Math.max(FY, idx.topUnder(p, 3, feet === undefined ? Infinity : feet + BODY.stepUp));
const key = (type: "keydown" | "keyup", code: string) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
afterEach(() => { key("keyup", "KeyW"); });
const route = (id: string) => LAB_ROUTES.find((r) => r.id === id)!;

function lab(at: { x: number; z: number }, feet = FY, extra: { candidates?: () => readonly Candidate[] } = {}) {
  const av = new Avatar({ height: 36, lit: true });
  const stack = new ControllerStack();
  const pm = new PlayerMode({
    avatar: av, stack, world: new WorldState(), cameraProbe: () => true,
    canStand: (p, ctx) => aiLabV3StandTest(p, 8, ctx ?? { feet: ground(p, feet), airborne: false }),
    camera: new THREE.PerspectiveCamera(), canvas: document.createElement("canvas"), overlayRoot: new THREE.Scene(),
    radius: 8, avatarHeight: 36, speed: () => 54.6, activate: vi.fn(() => true), canStandUp: () => false, standUp: () => {},
    yieldAvatar: vi.fn(), guided: () => false, freeLook: () => false,
    support: ground, groundAt: ground, dropMax: 5, headroom: (p, f) => idx.ceilingAbove(p, 7, f ?? FY) - (BODY.height + 1),
    routes: LAB_ROUTES, dynamicCandidates: extra.candidates,
  });
  const events: ParkourKind[] = [], routes: RouteEvent[] = [];
  pm.onJumped = (k) => events.push(k);
  pm.onRouteEvent = (e) => routes.push(e);
  av.setPosition(at, feet);
  expect(pm.enter()).toBe(true);
  pm.body.pos = { ...at };
  pm.update(DT); // settles the followed ground onto the surface under the feet
  const step = (n = 1, each?: () => void) => { for (let i = 0; i < n; i++) { pm.update(DT); av.update(DT); each?.(); } };
  return { av, pm, events, routes, step };
}
/** stand the body at a route's end (as a body walking up to it would) */
const atEnd = (id: string, dir: "a" | "b") => { const r = route(id); const q = dir === "a" ? r.path[0] : r.path[r.path.length - 1]; return lab({ x: q.x, z: q.z }, q.y); };

describe("stacked decks under the feet", () => {
  it("a body on L1 under L2 stands on L1 — and on the floor under L1 it stands on the floor", () => {
    const onL1 = lab({ x: 742, z: -780 }, FY + L1.y);
    onL1.step(30);
    expect(onL1.av.root.position.y).toBeCloseTo(FY + L1.y, 3);
    const under = lab(polar(45, 60), FY);
    under.step(30);
    expect(under.av.root.position.y).toBeCloseTo(FY, 3);
  });

  it("HEADROOM: on L1 under L2 a jump is capped below L2's underside and the double jump is refused", () => {
    const { av, pm, events, step } = lab({ x: 742, z: -780 }, FY + L1.y);
    pm.jump();
    let top = 0;
    step(10, () => { top = Math.max(top, av.root.position.y); });
    pm.jump();
    step(60, () => { top = Math.max(top, av.root.position.y); });
    expect(top + BODY.height).toBeLessThan(FY + L2.y - L2.t);
    expect(events).toEqual(["jump"]);
    expect(av.root.position.y).toBeCloseTo(FY + L1.y, 3); // and back on L1, not the floor
  });

  it("ABOVE A LOWER SURFACE with nothing underfoot: a real fall, caught by the FIRST surface below (the stump), not the floor", () => {
    const { av, pm, step } = lab({ x: JUMP_PAD.x, z: JUMP_PAD.z }, FY + L1.y);
    let airborneSeen = false;
    step(90, () => { if (pm.airborne) airborneSeen = true; });
    expect(airborneSeen).toBe(true); // it fell — it was not snapped down
    expect(av.root.position.y).toBeCloseTo(FY + JUMP_PAD.y, 3);
  });

  it("WALKING OFF A DECK at the jump gap falls — short of the stump at a walk, past its side, to the floor", () => {
    // L1's east edge is open at the jump gap; the stump stands 24 below it
    const start = polar(337, 88), gap = { x: 846, z: -780 };
    const { av, pm, step } = lab(start, FY + L1.y);
    const dx = gap.x - start.x, dz = gap.z - start.z;
    pm.camera.yaw = Math.atan2(dx, -dz); // the camera looks at the gap (forward = (sin, −cos))
    key("keydown", "KeyW");
    let airborneSeen = false, landedAt = Infinity;
    step(150, () => { if (pm.airborne) airborneSeen = true; else if (airborneSeen && landedAt === Infinity) landedAt = av.root.position.y; });
    key("keyup", "KeyW");
    expect(airborneSeen).toBe(true);
    expect(landedAt).toBeCloseTo(FY, 3);
  });
});

describe("the ladder", () => {
  it("E at its foot climbs it the whole way — not a jump between its ends — and lets go on L1", () => {
    const { av, pm, routes, step } = atEnd("lab/trunk-ladder", "a");
    expect(pm.enterRoute("lab/trunk-ladder", "a")).toBe(true);
    expect(routes[0]).toMatchObject({ type: "start", dir: "a", p0: 0 });
    expect(av.tumbling).toBe("ladder");
    const ys: number[] = [];
    step(Math.ceil(routeDuration(route("lab/trunk-ladder")) / (DT * 1000)) + 4, () => ys.push(av.root.position.y));
    // every height on the way up is visited, a little at a time
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeLessThan(1.5);
    expect(Math.max(...ys)).toBeGreaterThan(FY + L1.y);
    expect(pm.onRoute).toBe(false);
    const exit = routeExit(route("lab/trunk-ladder"), "a");
    expect(pm.body.pos.x).toBeCloseTo(exit.x, 3);
    expect(av.root.position.y).toBeCloseTo(FY + L1.y, 3);
    step(30);
    expect(av.root.position.y).toBeCloseTo(FY + L1.y, 3); // standing on L1 afterwards, not dropped to the floor
  });

  it("is offered only from an end, level with it: not from far away, not from the floor under its top", () => {
    const r = route("lab/trunk-ladder");
    const far = lab({ x: r.path[0].x + 60, z: r.path[0].z }, FY);
    expect(far.pm.enterRoute(r.id, "a")).toBe(false);
    const top = r.path[r.path.length - 1];
    const under = lab({ x: top.x, z: top.z }, FY);
    expect(under.pm.enterRoute(r.id, "b")).toBe(false);
    expect(under.pm.enterRoute(r.id, "a")).toBe(false);
  });

  it("E part-way up climbs back down from there; climbing down from L1 works the same way", () => {
    const { av, pm, routes, step } = atEnd("lab/trunk-ladder", "a");
    pm.enterRoute("lab/trunk-ladder", "a");
    step(90);
    const mid = av.root.position.y;
    expect(mid).toBeGreaterThan(FY + 10);
    pm.interact(); // E on the ladder
    expect(routes.at(-1)).toMatchObject({ type: "start", dir: "b" });
    expect((routes.at(-1) as { p0: number }).p0).toBeGreaterThan(0.2);
    step(Math.ceil(routeDuration(route("lab/trunk-ladder")) / (DT * 1000)));
    expect(pm.onRoute).toBe(false);
    expect(av.root.position.y).toBeCloseTo(FY, 3);
    const down = atEnd("lab/trunk-ladder", "b");
    expect(down.pm.enterRoute("lab/trunk-ladder", "b")).toBe(true);
    down.step(Math.ceil(routeDuration(route("lab/trunk-ladder")) / (DT * 1000)) + 4);
    expect(down.av.root.position.y).toBeCloseTo(FY, 3);
  });

  it("CUT SHORT (Player View left) part-way: the body goes to the nearer end — never left on the ladder", () => {
    const { pm, av, routes, step } = atEnd("lab/ship-stair", "a");
    expect(pm.enterRoute("lab/ship-stair", "a")).toBe(true);
    step(150); // well up the stair
    pm.exit();
    const halt = routes.at(-1)!;
    expect(halt.type).toBe("halt");
    expect(["start", "exit"]).toContain((halt as { end: string }).end);
    expect([FY + L1.y, FY + L2.y]).toContain(Math.round((av.root.position.y) * 100) / 100);
  });
});

describe("the zipline", () => {
  it("rides the whole cable from L2 to the work floor — pulling away, running, braking — and lands", () => {
    const { av, pm, step } = atEnd("lab/zipline", "a");
    expect(pm.enterRoute("lab/zipline", "a")).toBe(true);
    expect(av.tumbling).toBe("zipline");
    const xs: number[] = [];
    const frames = Math.ceil(routeDuration(route("lab/zipline")) / (DT * 1000));
    step(frames + 2, () => xs.push(pm.body.pos.x));
    const v = xs.slice(1).map((x, i) => x - xs[i]);
    // it accelerates from rest and slows again before the end (never a constant slide, never a jump)
    expect(Math.max(...v)).toBeGreaterThan(v[2] * 3);
    expect(v[v.length - 6]).toBeLessThan(Math.max(...v) / 2);
    expect(Math.max(...v)).toBeLessThan(5);
    expect(pm.onRoute).toBe(false);
    expect(av.root.position.y).toBeCloseTo(FY, 3);
    expect(av.tumbling).toBe("land");
  });

  it("is one-way, and E on it does nothing: there is no safe place to let go before its end", () => {
    const { pm, routes, step } = atEnd("lab/zipline", "a");
    pm.enterRoute("lab/zipline", "a");
    step(60);
    pm.interact();
    expect(routes.length).toBe(1);
    expect(pm.onRoute).toBe(true);
    const end = lab(routeExit(route("lab/zipline"), "a"), FY);
    expect(end.pm.enterRoute("lab/zipline", "b")).toBe(false);
  });
});

describe("falls and landings", () => {
  it("a fall too big for a roll is a HARD landing: no roll, a controlled recovery before the keys work again", () => {
    // off L2's open pole ledge, straight down to the floor (~96)
    const { av, pm, events, step } = lab({ x: 870, z: -757 }, FY + L2.y);
    pm.camera.yaw = Math.PI / 2; // looking east, off the ledge
    key("keydown", "KeyW");
    let hard = false;
    step(200, () => { if (av.tumbling === "hard") hard = true; });
    key("keyup", "KeyW");
    expect(hard).toBe(true);
    expect(events).not.toContain("roll");
    expect(HARD_FALL).toBeLessThan(L2.y);
    expect(av.root.position.y).toBeCloseTo(FY, 3);
  });
});

describe("target facing (fixed: it was mirrored along z in third person)", () => {
  it("facing north offers what is north, not what is behind", () => {
    const cands: Candidate[] = [
      { id: "ahead", kind: "person", pos: { x: 400, z: -760 }, label: "ahead", roomId: "" },
      { id: "behind", kind: "person", pos: { x: 400, z: -680 }, label: "behind", roomId: "" },
    ];
    const { av, pm, step } = lab({ x: 400, z: -700 }, FY, { candidates: () => cands });
    key("keydown", "KeyW");
    step(30);
    key("keyup", "KeyW");
    step(3);
    expect(Math.cos(av.yaw)).toBeLessThan(-0.9); // facing north (−z)
    expect(pm.state.target).toBe("ahead");
  });
});
