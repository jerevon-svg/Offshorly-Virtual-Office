// PARKOUR V2 — THE VAULT AND THE MANTLE: the planner's rules (player/traversal) on small worlds and on the real
// ground floor (the Reception rail, the room walls, the furniture), the Meeting Floor's new tops, the local player's
// Space priority / grab / cancellation, and the door lookahead's direction.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Avatar } from "./avatar/Avatar";
import { ControllerStack } from "./avatar/Controller";
import { doorLookahead, PlayerMode, type ParkourKind } from "./player/PlayerMode";
import { MANTLE, VAULT, planMantle, planVault, traverseHeight, traverseProgress, type TraversalWorld, type TraversePlan } from "./player/traversal";
import { StandableIndex, VAULT_KINDS, standableFromEntity, standableFromRect, type Standable } from "./world/standables";
import { WorldState } from "./world/WorldState";
import { CORRIDOR_BANDS, registerGroundFloor } from "./rooms/ground-floor";
import { makeStandTest } from "./player/standTest";
import { DESIGN_ROOM, DESIGN_SOLIDS, designRoomEntities } from "./rooms/design-room";
import { GATE, RECEPTION_ROOM, RECEPTION_ROOM_ID, RECEPTION_VAULT_RAILS, receptionEntities } from "./rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "./rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "./rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "./rooms/gaming";
import { CENTRAL_HUB, centralHubEntities, OPEN_BANDS as HUB_BANDS } from "./rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "./rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "./rooms/cms";
import { AI_ROOM, aiRoomEntities } from "./rooms/ai";
import { DEV_ROOM, devRoomEntities } from "./rooms/dev";
import { QA_ROOM, qaRoomEntities } from "./rooms/qa";
import { Walkability, composeStatic } from "./nav/Walkability";
import { NAV_RADIUS, clearanceLayer, worldClearances } from "./nav/clearance";
import { DerivedNav } from "./nav/derived";
import { openedLayer, v2Static } from "./nav/v2Open";
import { v1Static } from "./adapters/v1Grid";
import { FACADE_Z, FRAME, v1Rooms } from "./adapters/v1Floor";
import { zoneAt, type AccessGeometry } from "./app/access";
import { WALK_PROFILE } from "./world/exteriorGround";
import { meetingFloorStandables } from "./rooms/floor2Meeting";
import { floor2StandTest } from "./rooms/floor2";
import { headingFor, type Vec2 } from "./core/coords";
import type { StandContext } from "./player/PlayerBody";

const DT = 1 / 60;
const R = 8;
const union = (a?: ReadonlySet<string>, b?: ReadonlySet<string>): ReadonlySet<string> | undefined => (!b ? a : !a ? b : new Set([...a, ...b]));

// ---- a small world: flat floor, pieces as rects, the same "cleared tops" rule the real world uses ---------------
type Piece = Standable & { wall?: boolean };
function small(pieces: Piece[], opts: { permitted?: boolean; headroom?: number; mayEnter?: (from: Vec2, to: Vec2) => boolean } = {}): TraversalWorld {
  const idx = new StandableIndex(pieces.filter((p) => !p.wall));
  const blocks = (p: Vec2, ctx?: StandContext, ignore?: ReadonlySet<string>): boolean => pieces.some((s) => {
    if (s.dist(p) >= R) return false;
    if (s.wall) return true; // a wall blocks at every height, and can never be excused
    if (ignore?.has(s.id)) return false;
    return !(ctx && s.stand !== false && s.top <= ctx.feet + (ctx.airborne ? WALK_PROFILE.airClear : WALK_PROFILE.stepUp));
  });
  return {
    stand: (p, ctx, ignore) => !blocks(p, ctx, ignore),
    vaultables: (p, r) => idx.vaultables(p, r),
    ground: (p) => Math.max(0, idx.topUnder(p, 3)),
    headroom: () => opts.headroom ?? Infinity,
    mayEnter: opts.mayEnter ?? (() => opts.permitted ?? true),
  };
}
const rect = (id: string, top: number, x: number, z: number, w: number, d: number, flags: { stand?: boolean; vault?: boolean } = {}): Piece => standableFromRect(id, top, { x, z, w, d }, flags);
const wall = (id: string, x: number, z: number, w: number, d: number): Piece => ({ ...standableFromRect(id, 46, { x, z, w, d }), wall: true });
const NORTH = { x: 0, z: -1 };
/** a waist-high rail across z −3…0, vault-only */
const RAIL = rect("rail", 22, -100, -3, 200, 3, { stand: false, vault: true });

describe("player/traversal — the vault planner", () => {
  it("vaults a thin, eligible rail onto a stand point on the far side, arcing over its top", () => {
    const plan = planVault(small([RAIL]), { x: 0, z: 14 }, NORTH, 0, R)!;
    expect(plan).not.toBeNull();
    expect(plan.kind).toBe("vault");
    expect(plan.obstacle).toBe("rail");
    expect(plan.to.z).toBeLessThanOrEqual(-3 - R);
    expect(plan.apex).toBe(22 + VAULT.clear);
    expect(plan.ms).toBeGreaterThanOrEqual(VAULT.ms.min);
    expect(plan.ms).toBeLessThanOrEqual(VAULT.ms.max);
    // the feet clear the top while the body is over it
    const over = [0.4, 0.5, 0.6].map((u) => traverseHeight("vault", u, 0, 0, plan.apex));
    for (const y of over) expect(y).toBeGreaterThan(22);
    expect(traverseHeight("vault", 1, 0, 0, plan.apex)).toBeCloseTo(0, 6);
  });

  it("refuses what is not eligible: a wall of the same height, too tall, too deep, out of reach", () => {
    expect(planVault(small([wall("w", -100, -3, 200, 3)]), { x: 0, z: 14 }, NORTH, 0, R)).toBeNull(); // walls are never vault items
    expect(planVault(small([rect("tall", 40, -100, -3, 200, 3, { vault: true })]), { x: 0, z: 14 }, NORTH, 0, R)).toBeNull();
    expect(planVault(small([rect("deep", 15, -100, -60, 200, 60, { vault: true })]), { x: 0, z: 14 }, NORTH, 0, R)).toBeNull();
    expect(planVault(small([RAIL]), { x: 0, z: 40 }, NORTH, 0, R)).toBeNull();
    expect(planVault(small([rect("plain", 22, -100, -3, 200, 3)]), { x: 0, z: 14 }, NORTH, 0, R)).toBeNull(); // no `vault` flag
  });

  it("refuses when ANYTHING else is in the way: a wall behind the rail, or no landing", () => {
    expect(planVault(small([RAIL, wall("behind", -100, -12, 200, 4)]), { x: 0, z: 14 }, NORTH, 0, R)).toBeNull();
    expect(planVault(small([RAIL], { headroom: 20 }), { x: 0, z: 14 }, NORTH, 0, R)).toBeNull();
  });

  it("ACCESS: a vault that would land inside a place the body may not enter is refused", () => {
    const into = (from: Vec2, to: Vec2) => !(to.z < 0 && from.z > 0);
    expect(planVault(small([RAIL], { mayEnter: into }), { x: 0, z: 14 }, NORTH, 0, R)).toBeNull();
    expect(planVault(small([RAIL], { permitted: false }), { x: 0, z: 14 }, NORTH, 0, R)).toBeNull();
  });
});

describe("player/traversal — the mantle planner", () => {
  /** a table-height block, z −40…0 */
  const BLOCK = rect("block", 24, -30, -40, 60, 40);

  it("hauls the body onto a ledge within reach: the landing is on the top, flat, and stands there", () => {
    const w = small([BLOCK]);
    const plan = planMantle(w, { x: 0, z: 9 }, NORTH, 0, R)!;
    expect(plan).not.toBeNull();
    expect(plan.endFeet).toBe(24);
    expect(w.ground(plan.to)).toBe(24);
    expect(w.stand(plan.to, { feet: 24, airborne: false, from: plan.to })).toBe(true);
    // reach and pull first, then over the edge: the height leads the travel
    expect(traverseHeight("mantle", 0.45, 0, 24, 24)).toBeGreaterThan(12);
    expect(traverseProgress("mantle", 0.45)).toBeLessThan(0.2);
    expect(traverseHeight("mantle", 1, 0, 24, 24)).toBeCloseTo(24, 6);
    expect(traverseProgress("mantle", 1)).toBeCloseTo(1, 6);
  });

  it("NO WALL CLIMBING: a wall has no top; a ledge too high is out of reach; a wall in front of a ledge stops it", () => {
    expect(planMantle(small([wall("w", -30, -40, 60, 40)]), { x: 0, z: 9 }, NORTH, 0, R)).toBeNull();
    expect(planMantle(small([rect("high", 24 + MANTLE.maxRise, -30, -40, 60, 40)]), { x: 0, z: 9 }, NORTH, 0, R)).toBeNull();
    expect(planMantle(small([rect("low", 8, -30, -40, 60, 40)]), { x: 0, z: 9 }, NORTH, 0, R)).toBeNull(); // a hop's business
    // glass between the body and the ledge
    expect(planMantle(small([BLOCK, wall("glass", -30, 2, 60, 2)]), { x: 0, z: 14 }, NORTH, 0, R)).toBeNull();
    // no headroom over the top
    expect(planMantle(small([BLOCK], { headroom: 10 }), { x: 0, z: 9 }, NORTH, 0, R)).toBeNull();
  });

  it("in the air the hands reach a ledge just above the feet", () => {
    const plan = planMantle(small([BLOCK]), { x: 0, z: 9 }, NORTH, 10, R, true)!;
    expect(plan.startFeet).toBe(10);
    expect(plan.endFeet).toBe(24);
  });
});

// ---- the real ground floor -------------------------------------------------------------------------------------
const ROOMS = [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM];
function office() {
  const world = new WorldState();
  for (const r of ROOMS) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(), ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(), ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities()]) world.addEntity(e);
  DESIGN_SOLIDS.forEach((r, i) => world.addEntity({ id: `${DESIGN_ROOM.id}/solid-${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {}, source: { baked: true } }));
  registerGroundFloor(world);
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer([...HUB_BANDS, ...CORRIDOR_BANDS])), (p: Vec2) => world.walkableAt(p), clearanceLayer(worldClearances(world))));
  const derived = new DerivedNav(world, { roomIds: new Set(ROOMS.map((r) => r.id)) });
  walkability.attachDerived(derived, world);
  const stand = makeStandTest({ world, walkability, derived, radius: NAV_RADIUS, allowExterior: true });
  const items = [...world.entities.values()].map(standableFromEntity).filter((s): s is NonNullable<typeof s> => s !== null);
  // exactly as app/world.ts indexes them
  const idx = new StandableIndex([...items, ...RECEPTION_VAULT_RAILS.map((r) => standableFromRect(r.id, r.top, r.rect, { stand: false, vault: true }))]);
  const geom: AccessGeometry = { frame: FRAME, facadeZ: FACADE_Z, receptionRect: v1Rooms().find((r) => r.id === RECEPTION_ROOM_ID)!.rect, gateZ: GATE.z };
  const cleared = (p: Vec2, ctx?: StandContext) => (ctx ? idx.cleared(p, NAV_RADIUS + 0.5, ctx.feet + (ctx.airborne ? WALK_PROFILE.airClear : WALK_PROFILE.stepUp)) : undefined);
  const traversal = (permitted: boolean): TraversalWorld => ({
    stand: (p, ctx, ignore) => stand(p, undefined, union(cleared(p, ctx), ignore)),
    vaultables: (p, r) => idx.vaultables(p, r),
    ground: (p) => Math.max(0, idx.topUnder(p, 3)),
    headroom: () => Infinity,
    mayEnter: (_from, to) => permitted || zoneAt(to, geom) !== "office",
  });
  return { world, stand, idx, geom, traversal };
}

describe("the Reception rail — on the real ground floor", () => {
  const o = office();
  const start = { x: 500, z: 905 }; // Reception's public side, south of the west rail

  it("a CHECKED-IN employee vaults the approved rail section into the office", () => {
    const plan = planVault(o.traversal(true), start, NORTH, 0, NAV_RADIUS)!;
    expect(plan).not.toBeNull();
    expect(plan.obstacle).toBe(`${RECEPTION_ROOM_ID}#wall0`);
    expect(zoneAt(plan.to, o.geom)).toBe("office");
    expect(o.stand(plan.to)).toBe(true); // an ordinary stand point, nothing excused
    // and back out again the same way
    const back = planVault(o.traversal(true), plan.to, { x: 0, z: 1 }, 0, NAV_RADIUS)!;
    expect(back?.obstacle).toBe(`${RECEPTION_ROOM_ID}#wall0`);
    expect(zoneAt(back.to, o.geom)).toBe("reception");
  });

  it("an employee WITHOUT a confirmed check-in can never bypass Reception: no vault, no mantle, no jump over it", () => {
    for (const x of [360, 450, 560, 860, 960, 1060]) {
      expect(planVault(o.traversal(false), { x, z: 905 }, NORTH, 0, NAV_RADIUS)).toBeNull();
      expect(planMantle(o.traversal(false), { x, z: 905 }, NORTH, 0, NAV_RADIUS)).toBeNull();
    }
    // a jump's cleared set never names the rail at ANY height, so it stays solid to a body in the air
    for (const r of RECEPTION_VAULT_RAILS) {
      const c = { x: r.rect.x + r.rect.w / 2, z: r.rect.z + r.rect.d / 2 };
      expect(o.idx.cleared(c, NAV_RADIUS + 0.5, 1000).has(r.id)).toBe(false);
      expect(o.stand(c, undefined, o.idx.cleared(c, NAV_RADIUS + 0.5, 1000))).toBe(false);
    }
  });

  it("the rail is VAULT-ONLY: far too narrow for the body's footprint, so it is never a top", () => {
    for (const r of RECEPTION_VAULT_RAILS) {
      expect(r.rect.d).toBeLessThan(2 * NAV_RADIUS);
      expect(o.idx.topUnder({ x: r.rect.x + 40, z: r.rect.z + r.rect.d / 2 }, 3)).toBe(-Infinity);
    }
  });

  it("ROOM FRONT WALLS (and every other wall) are never vaultable, whatever their height", () => {
    const approved = new Set(RECEPTION_VAULT_RAILS.map((r) => r.id));
    expect(approved).toEqual(new Set([`${RECEPTION_ROOM_ID}#wall0`, `${RECEPTION_ROOM_ID}#wall1`]));
    let walls = 0;
    for (const room of ROOMS) (room.wallSolids ?? []).forEach((w, i) => {
      if (approved.has(`${room.id}#wall${i}`)) return;
      walls++;
      expect(o.idx.vaultables({ x: w.x + w.w / 2, z: w.z + w.d / 2 }, NAV_RADIUS + 0.5)).toEqual([]);
    });
    expect(walls).toBeGreaterThan(20);
  });

  it("the gate lanes stay the only floor-level way through", () => {
    expect(o.stand({ x: 500, z: 890 })).toBe(false);
    expect(o.stand({ x: 960, z: 890 })).toBe(false);
  });
});

describe("furniture on the real ground floor", () => {
  const o = office();
  const w = o.traversal(true);
  const DIRS = [{ x: 0, z: -1 }, { x: 0, z: 1 }, { x: 1, z: 0 }, { x: -1, z: 0 }];

  it("low tables are vaultable where the way over and the landing are clear — and every vault lands on a stand point", () => {
    let tried = 0, vaulted = 0;
    for (const e of o.world.entities.values()) {
      if (!VAULT_KINDS.has(e.kind)) continue;
      const s = standableFromEntity(e)!;
      const c = e.transform.pos, ext = Math.max(s.bounds.x1 - s.bounds.x0, s.bounds.z1 - s.bounds.z0) / 2;
      for (const d of DIRS) {
        const from = { x: c.x - d.x * (ext + NAV_RADIUS + 4), z: c.z - d.z * (ext + NAV_RADIUS + 4) };
        if (!o.stand(from) || w.ground(from) !== 0) continue;
        tried++;
        const plan = planVault(w, from, d, 0, NAV_RADIUS);
        if (!plan) continue;
        vaulted++;
        expect(o.stand(plan.to)).toBe(true);
        expect(plan.to.x * d.x + plan.to.z * d.z).toBeGreaterThan(c.x * d.x + c.z * d.z);
      }
    }
    expect(tried).toBeGreaterThan(10);
    expect(vaulted).toBeGreaterThan(0);
  });

  it("a sofa is mantled onto (not vaulted): the body ends standing on its cushion", () => {
    const sofa = [...o.world.entities.values()].find((e) => e.kind === "sofa" && e.roomId === RECEPTION_ROOM.id)!;
    const s = standableFromEntity(sofa)!;
    expect(s.vault).toBeUndefined();
    let plan: TraversePlan | null = null;
    for (const d of DIRS) {
      for (let k = 0; k < 20 && !plan; k++) {
        const from = { x: sofa.transform.pos.x - d.x * (NAV_RADIUS + 2 + k * 2), z: sofa.transform.pos.z - d.z * (NAV_RADIUS + 2 + k * 2) };
        if (s.dist(from) < NAV_RADIUS || !o.stand(from)) continue;
        plan = planMantle(w, from, d, 0, NAV_RADIUS);
        break;
      }
      if (plan) break;
    }
    expect(plan).not.toBeNull();
    expect(plan!.endFeet).toBe(s.top);
    expect(o.idx.topUnder(plan!.to, 3)).toBe(s.top);
  });
});

describe("the Meeting Floor's tops (floor 2)", () => {
  const items = meetingFloorStandables();
  const byId = (suffix: string) => items.find((s) => s.id.endsWith(suffix))!;

  it("its seating and low tables are indexed with their measured tops; its planters are vault-only", () => {
    expect(items.some((s) => s.id.endsWith("/sofa-ne") && s.stand !== false)).toBe(true);
    expect(byId("/table-ne").vault).toBe(true);
    expect(byId("/cafe-0").vault).toBe(true);
    const planter = byId("/planter-ne");
    expect(planter.stand).toBe(false);
    expect(new StandableIndex(items).topUnder({ x: (planter.bounds.x0 + planter.bounds.x1) / 2, z: (planter.bounds.z0 + planter.bounds.z1) / 2 }, 3)).toBe(-Infinity);
  });

  it("its stand test excuses exactly the ids it is told — a cleared top, never anything else", () => {
    const t = byId("/table-ne");
    const c = { x: (t.bounds.x0 + t.bounds.x1) / 2, z: (t.bounds.z0 + t.bounds.z1) / 2 };
    expect(floor2StandTest(c, NAV_RADIUS)).toBe(false);
    expect(floor2StandTest(c, NAV_RADIUS, new Set([t.id]))).toBe(true);
    expect(floor2StandTest(c, NAV_RADIUS, new Set(["something-else"]))).toBe(false);
  });
});

// ---- the local player ------------------------------------------------------------------------------------------
const key = (type: "keydown" | "keyup", code: string) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
afterEach(() => { key("keyup", "KeyW"); });

function player(pieces: Piece[], opts: { permitted?: boolean } = {}) {
  const w = small(pieces, opts);
  const av = new Avatar({ height: 36, lit: true });
  const stack = new ControllerStack();
  const pm = new PlayerMode({
    avatar: av, stack, world: new WorldState(), canStand: (p, ctx) => w.stand(p, ctx), cameraProbe: () => true,
    camera: new THREE.PerspectiveCamera(), canvas: document.createElement("canvas"), overlayRoot: new THREE.Scene(),
    radius: R, avatarHeight: 36, speed: () => 54.6, activate: vi.fn(() => true), canStandUp: () => false, standUp: () => {},
    yieldAvatar: vi.fn(), guided: () => false, freeLook: () => false,
    support: w.ground, dropMax: 5, groundAt: w.ground,
    traversal: { stand: w.stand, vaultables: w.vaultables, mayEnter: w.mayEnter },
  });
  const events: { kind: ParkourKind; plan?: TraversePlan }[] = [];
  pm.onJumped = (kind, _roll, plan) => events.push({ kind, plan });
  expect(pm.enter()).toBe(true);
  av.setPosition({ x: 0, z: 40 }, 0);
  pm.body.pos = { x: 0, z: 40 };
  const step = (n = 1, each?: () => void) => { for (let i = 0; i < n; i++) { pm.update(DT); av.update(DT); each?.(); } };
  return { av, pm, events, step };
}

describe("the local player — Space is contextual", () => {
  it("RUNNING AT THE RAIL: Space vaults it (articulated), over the top, landing on the far side, still running", () => {
    const { av, pm, events, step } = player([RAIL]);
    key("keydown", "KeyW");
    for (let i = 0; i < 200 && pm.body.pos.z > 14; i++) step();
    pm.jump();
    expect(events.map((e) => e.kind)).toEqual(["vault"]);
    expect(av.tumbling).toBe("vault");
    let top = 0;
    step(80, () => { top = Math.max(top, av.root.position.y); });
    expect(top).toBeGreaterThan(22);
    expect(pm.traversing).toBe(false);
    expect(pm.body.pos.z).toBeLessThan(-3 - R + 1);
    expect(av.root.position.y).toBe(0);
    expect(pm.state.speed).toBeGreaterThan(0); // the run carries on
  });

  it("WITHOUT ACCESS to the far side, the same Space is an ordinary jump — the rail stays solid", () => {
    const { pm, events, step } = player([RAIL], { permitted: false });
    key("keydown", "KeyW");
    for (let i = 0; i < 200 && pm.body.pos.z > 14; i++) step();
    pm.jump();
    step(20);
    pm.jump();
    step(120);
    expect(events.map((e) => e.kind)).toEqual(["jump", "double"]);
    expect(pm.body.pos.z).toBeGreaterThanOrEqual(R - 0.01);
  });

  it("STANDING AT A LEDGE: Space mantles onto it; leaving Player View steps down beside it", () => {
    const { av, pm, events, step } = player([rect("block", 24, -30, -40, 60, 40)]);
    key("keydown", "KeyW");
    for (let i = 0; i < 200 && pm.body.pos.z > 9; i++) step();
    key("keyup", "KeyW");
    step(30);
    pm.jump();
    expect(events.map((e) => e.kind)).toEqual(["mantle"]);
    step(90);
    expect(pm.traversing).toBe(false);
    expect(pm.body.pos.z).toBeLessThan(-4); // well onto the top, not perched on its rim
    expect(av.root.position.y).toBeCloseTo(24, 5);
    pm.exit();
    expect(pm.body.pos.z).toBeGreaterThan(R - 0.01); // stepped down beside it
    expect(av.root.position.y).toBe(0);
  });

  it("JUMPING INTO A LEDGE: falling against it while pushing toward it grabs it and hauls up", () => {
    const { av, pm, events, step } = player([rect("block", 24, -30, -40, 60, 40)]);
    key("keydown", "KeyW");
    // from beyond a standing mantle's reach: a hop (11.7) cannot clear 24, and the descent into the face is a grab
    for (let i = 0; i < 200 && pm.body.pos.z > 28; i++) step();
    pm.jump();
    for (let i = 0; i < 120 && !pm.traversing; i++) step();
    key("keyup", "KeyW"); // (held on, the run would carry on across the top and off its far side)
    step(90);
    expect(events.map((e) => e.kind)).toEqual(["jump", "mantle"]);
    expect(av.root.position.y).toBeCloseTo(24, 5);
  });

  it("the double jump and flip are untouched in the open", () => {
    const { av, pm, events, step } = player([]);
    pm.jump();
    step(16);
    pm.jump();
    expect(av.tumbling).toBe("flip");
    expect(events.map((e) => e.kind)).toEqual(["jump", "double"]);
  });

  it("CUT SHORT (Player View left mid-vault): the body finishes at the landing, never inside the rail", () => {
    const { pm, events, step } = player([RAIL]);
    key("keydown", "KeyW");
    for (let i = 0; i < 200 && pm.body.pos.z > 14; i++) step();
    pm.jump();
    step(12);
    const to = events[0].plan!.to;
    pm.exit();
    expect(pm.body.pos).toEqual(to);
  });
});

describe("the door lookahead (the mirrored formula flagged in V1)", () => {
  it("points AHEAD of the body along headingFor's convention, for every direction of travel", () => {
    for (const d of [{ x: 0, z: -1 }, { x: 0, z: 1 }, { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0.6, z: -0.8 }]) {
      const ahead = doorLookahead({ x: 100, z: 100 }, headingFor(d.x, d.z), 46);
      expect(ahead.x - 100).toBeCloseTo(d.x * 46, 6);
      expect(ahead.z - 100).toBeCloseTo(d.z * 46, 6);
    }
  });

  it("a player walking north tells the doors to expect them to the north", () => {
    const { pm, step } = player([]);
    key("keydown", "KeyW");
    step(20);
    expect(pm.body.pos.z).toBeLessThan(40);
    expect(pm.doorIntent[0].z).toBeLessThan(pm.body.pos.z);
  });
});
