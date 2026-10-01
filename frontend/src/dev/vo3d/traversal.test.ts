// vo3d — TRAVERSAL: stepping, rolling and jumping over the campus's edges (world/exteriorGround
// TraversalState, player/PlayerJump, player/PlayerBody MoveHeights, player/ScooterMotion airborne).
//
// The rule under test: an edge a body can step, roll or jump is crossable; solids, walls, water and the
// world's rim stop it at every height. The simulations below run the same pieces PlayerMode runs — the
// swept body, the arc and the ground model — at a fixed 60 Hz, on the real campus.
import { describe, expect, it } from "vitest";
import { exteriorGround, RIDE_PROFILE, WALK_PROFILE, WORLD_WALK, type GroundProfile, type TraversalState } from "./world/exteriorGround";
import { PlayerBody, type StandContext } from "./player/PlayerBody";
import { PlayerJump } from "./player/PlayerJump";
import { SCOOTER, SCOOTER_JUMP, ScooterMotion } from "./player/ScooterMotion";
import { NAV_RADIUS } from "./nav/clearance";
import type { Vec2 } from "./core/coords";
import mode from "./player/PlayerMode.ts?raw";
import world from "./app/world.ts?raw";

const G = exteriorGround();
const DT = 1 / 60;
const at = (feet: number, airborne = false, from?: Vec2): TraversalState => ({ feet, airborne, from });

// ---- the ground model's traversal rules --------------------------------------------------------
describe("traversal — the ground model judges edges against the feet", () => {
  // the Lab causeway (0.2) stands 8.2 over the lawn (−8) along its south face, z −236
  const LAWN = { x: 1160, z: -226 }, DECK = { x: 1160, z: -246 }, FACE = { x: 1160, z: -233 };
  // the podium front at x 1290: lower walk −7.65 | ledge −3 from z 1292 | sidewalk 0.2 from z 1237.6
  const WALK_BELOW = { x: 1290, z: 1300 }, LEDGE = { x: 1290, z: 1286 };

  it("grounded: a walker steps up the podium's 4.65 but not the deck's 8.2; a deck rolls neither", () => {
    expect(G.canOccupy(LEDGE, WALK_PROFILE.footRadius, WALK_PROFILE, undefined, undefined, at(-7.65, false, WALK_BELOW))).toBe(true);
    expect(G.occupancy(FACE, WALK_PROFILE.footRadius, WALK_PROFILE, undefined, undefined, at(-8, false, LAWN))).toMatchObject({ ok: false, reason: "step" });
    expect(G.occupancy(LEDGE, RIDE_PROFILE.footRadius, RIDE_PROFILE, undefined, undefined, at(-7.65, false, WALK_BELOW))).toMatchObject({ ok: false, reason: "step" });
  });

  it("grounded: a deck rolls UP a kerb-sized 3.2 and DOWN the 4.65 — the directional limits", () => {
    expect(RIDE_PROFILE.stepUp).toBeGreaterThan(3.2);
    expect(RIDE_PROFILE.stepUp).toBeLessThan(4.65);
    expect(RIDE_PROFILE.dropMax).toBeGreaterThanOrEqual(4.65);
    // up the sidewalk step (ledge −3 → sidewalk 0.2) at x 1290, z 1237.6
    expect(G.canOccupy({ x: 1290, z: 1242 }, RIDE_PROFILE.footRadius, RIDE_PROFILE, undefined, undefined, at(-3, false, { x: 1290, z: 1246 }))).toBe(true);
    // down the 4.65 (feet on the ledge, the rim reaching over the lower walk)
    expect(G.canOccupy({ x: 1290, z: 1288 }, RIDE_PROFILE.footRadius, RIDE_PROFILE, undefined, undefined, at(-3, false, { x: 1290, z: 1284 }))).toBe(true);
    // but never down the deck's 8.2
    expect(G.canOccupy(FACE, RIDE_PROFILE.footRadius, RIDE_PROFILE, undefined, undefined, at(0.2, false, DECK))).toBe(false);
  });

  it("airborne: an edge is cleared when the feet clear it (to within airClear), and is a face otherwise", () => {
    const P = WALK_PROFILE;
    expect(G.canOccupy(FACE, P.footRadius, P, undefined, undefined, at(0.2 - P.airClear + 0.1, true))).toBe(true);
    expect(G.occupancy(FACE, P.footRadius, P, undefined, undefined, at(0.2 - P.airClear - 0.5, true))).toMatchObject({ ok: false, reason: "step" });
  });

  it("airborne: solids, water and the world's rim stop a body at ANY height", () => {
    const tree = G.solids.find((s) => s.kind === "tree" && "circle" in s)!;
    const c = "circle" in tree ? tree.circle : { x: 0, z: 0 };
    for (const prof of [WALK_PROFILE, RIDE_PROFILE] as GroundProfile[]) {
      expect(G.occupancy({ x: c.x, z: c.z }, prof.footRadius, prof, undefined, undefined, at(500, true))).toMatchObject({ ok: false, reason: "solid" });
      expect(G.occupancy({ x: 740, z: -1430 }, prof.footRadius, prof, undefined, undefined, at(500, true))).toMatchObject({ ok: false, reason: "surface" });
      expect(G.occupancy({ x: WORLD_WALK.x + WORLD_WALK.r + 1, z: WORLD_WALK.z }, prof.footRadius, prof, undefined, undefined, at(500, true))).toMatchObject({ ok: false, reason: "outside" });
    }
  });

  it("never stuck on an edge: from a footprint already straddling one, a move that straddles no worse is allowed", () => {
    // feet on the deck's top, the footprint hanging over the lawn (a landing that caught the lip)
    const hang = { x: 1160, z: -238 };
    expect(G.canOccupy({ x: 1160, z: -240 }, WALK_PROFILE.footRadius, WALK_PROFILE, undefined, undefined, at(0.2, false, hang))).toBe(true);
    // …and the support it rests on is the lip's top
    expect(G.support(hang, WALK_PROFILE.footRadius)).toBeCloseTo(0.4, 1);
  });
});

// ---- the arc ----------------------------------------------------------------------------------
describe("traversal — PlayerJump in absolute height", () => {
  it("lands on a floor ABOVE its takeoff, only while descending", () => {
    const j = new PlayerJump();
    j.start(-8);
    expect(j.update(DT, 0.2)).toBe(false); // rising past the ledge never snags on it
    let landed = false;
    for (let i = 0; i < 120 && !landed; i++) landed = j.update(DT, 0.2);
    expect(landed).toBe(true);
    expect(j.feet).toBeCloseTo(0.2, 6);
    expect(j.height).toBe(0);
  });
  it("lands on a floor BELOW its takeoff, and a fall starts with no upward speed", () => {
    const j = new PlayerJump();
    j.fall(0.2);
    expect(j.airborne).toBe(true);
    expect(j.verticalSpeed).toBe(0);
    let n = 0;
    while (!j.update(DT, -8) && n < 120) n++;
    expect(j.feet).toBeCloseTo(-8, 6);
    expect(j.start(j.feet)).toBe(true);
    expect(j.start(j.feet)).toBe(false); // no double jump
  });
  it("the scooter's hop is its own arc: ~12.6 high, under half a second", () => {
    const j = new PlayerJump(SCOOTER_JUMP);
    j.start(0);
    let apex = 0, t = 0;
    while (!j.update(DT)) { apex = Math.max(apex, j.feet); t += DT; }
    expect(apex).toBeGreaterThan(11);
    expect(apex).toBeLessThan(13);
    expect(t).toBeGreaterThan(0.4);
    expect(t).toBeLessThan(0.5);
  });
});

// ---- the deck in the air ---------------------------------------------------------------------
describe("traversal — ScooterMotion airborne", () => {
  it("keeps its speed with no drive, brake or surface drag, and steers at a fraction of the ground rate", () => {
    const air = new ScooterMotion(0), ground = new ScooterMotion(0);
    air.speed = ground.speed = 300;
    for (let i = 0; i < 20; i++) {
      air.step({ throttle: -1, steer: 1, boost: false, cap: 0.5, airborne: true }, DT);
      ground.step({ throttle: 1, steer: 1, boost: false }, DT);
    }
    expect(air.speed).toBe(300);
    expect(air.heading / ground.heading).toBeCloseTo(SCOOTER.airSteer, 1);
  });
});

// ---- whole moves on the real campus ------------------------------------------------------------
type Sim = { pos: Vec2; feet: number; air: boolean; apex: number; hops: { from: Vec2; to: Vec2 }[] };
/** PlayerMode's walking or riding frame, minus the drawing: swept move with heights, the arc, landings */
function simulate(prof: GroundProfile, start: Vec2, heading: number, o: { seconds: number; speed?: number; jumpAt?: number; jumpWhen?: (p: Vec2) => boolean; scooter?: boolean; boost?: boolean }): Sim {
  const stand = (p: Vec2, ctx?: StandContext): boolean => G.canOccupy(p, prof.footRadius, prof, undefined, undefined, ctx);
  const sup = (p: Vec2): number => G.support(p, prof.footRadius);
  const body = new PlayerBody(start, NAV_RADIUS, stand);
  const jump = new PlayerJump(o.scooter ? SCOOTER_JUMP : undefined);
  const motion = new ScooterMotion(heading);
  motion.speed = o.speed ?? 0;
  const s: Sim = { pos: start, feet: sup(start), air: false, apex: -Infinity, hops: [] };
  let jumped = false, takeoff: Vec2 | null = null;
  for (let t = 0; t < o.seconds; t += DT) {
    if (!jumped && ((o.jumpAt !== undefined && t >= o.jumpAt) || o.jumpWhen?.(body.pos))) { jumped = jump.start(sup(body.pos)); }
    const air = jump.airborne;
    if (air && !takeoff) takeoff = { ...body.pos };
    let dx: number, dz: number;
    if (o.scooter) ({ dx, dz } = motion.step({ throttle: 1, steer: 0, boost: !!o.boost, airborne: air }, DT));
    else { dx = Math.sin(heading) * (o.speed ?? 70) * DT; dz = -Math.cos(heading) * (o.speed ?? 70) * DT; }
    const res = body.move(dx, dz, { feet: air ? jump.feet : sup(body.pos), airborne: air, support: sup, fallDrop: prof.dropMax });
    if (o.scooter && res.blocked) motion.bumped(res.travelled, DT);
    if (res.fell) jump.fall(res.feet!);
    if (jump.airborne && jump.update(DT, sup(body.pos)) && takeoff) { s.hops.push({ from: takeoff, to: { ...body.pos } }); takeoff = null; }
    s.apex = Math.max(s.apex, jump.feet);
  }
  s.pos = body.pos;
  s.air = jump.airborne;
  s.feet = jump.airborne ? jump.feet : sup(body.pos);
  return s;
}
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

describe("traversal — walking on the campus", () => {
  it("walking into the Lab causeway's 8.2 face is blocked; Space + forward lands on top; Space off it lands on the lawn", () => {
    const blocked = simulate(WALK_PROFILE, { x: 1160, z: -190 }, 0, { seconds: 1.5 });
    expect(blocked.pos.z).toBeGreaterThan(-236);
    expect(blocked.feet).toBeCloseTo(-8, 1);
    const up = simulate(WALK_PROFILE, { x: 1160, z: -200 }, 0, { seconds: 1.4, jumpAt: 0.1 });
    expect(up.pos.z).toBeLessThan(-240);
    expect(up.feet).toBeGreaterThan(0);
    expect(up.air).toBe(false);
    const down = simulate(WALK_PROFILE, { x: 1160, z: -262 }, Math.PI, { seconds: 1.4, jumpAt: 0.05 });
    expect(down.pos.z).toBeGreaterThan(-230);
    expect(down.feet).toBeLessThan(-7); // the lawn, or the planting bed (−7.5) along the face
    expect(down.air).toBe(false);
  });
  it("the podium's steps stay steps (no jump needed), and a jump off the sidewalk lands below", () => {
    const up = simulate(WALK_PROFILE, { x: 1290, z: 1400 }, 0, { seconds: 3 });
    expect(up.feet).toBeCloseTo(0.2, 1);
    const off = simulate(WALK_PROFILE, { x: 1290, z: 1225 }, Math.PI, { seconds: 1.5, jumpAt: 0.1 });
    expect(off.feet).toBeLessThan(-2.9);
  });
  it("a jump never reaches over a tree", () => {
    // the open-lawn tree at (−640, 1400): walking north into it from the sidewalk, jumping on the way
    const s = simulate(WALK_PROFILE, { x: -640, z: 1480 }, 0, { seconds: 1.5, jumpAt: 0.2 });
    expect(s.pos.z).toBeGreaterThan(1400);
  });
});

describe("traversal — the scooter's hop on the campus", () => {
  it("its length is the deck's speed: 0 standing, ~137 at the 300 cruise, ~174 at the 380 boost", () => {
    for (const [v, boost, want] of [[0, false, 0], [300, false, 300 * 0.458], [380, true, 380 * 0.458]] as const) {
      const s = simulate(RIDE_PROFILE, { x: -2380, z: 1620 }, Math.PI / 2, { seconds: 0.8, speed: v, jumpAt: 0, scooter: true, boost });
      expect(s.hops.length, `hop at ${v}`).toBe(1);
      expect(dist(s.hops[0].from, s.hops[0].to)).toBeCloseTo(want, -1);
      expect(s.apex - -9.6).toBeGreaterThan(11);
    }
  });
  it("driving into the podium's 4.65 is blocked; the hop lands on its ledge", () => {
    const blocked = simulate(RIDE_PROFILE, { x: 1290, z: 1420 }, 0, { seconds: 2, scooter: true });
    expect(blocked.pos.z).toBeGreaterThan(1292);
    const hop = simulate(RIDE_PROFILE, { x: 1290, z: 1420 }, 0, { seconds: 1.6, scooter: true, jumpWhen: (p) => p.z < 1330 });
    expect(hop.hops.length).toBe(1);
    expect(hop.pos.z).toBeLessThan(1292);
  });
  it("at the 380 boost a hop never tunnels through a lamp (the swept body checks every sub-step in the air)", () => {
    // north from road-main at x −2040 toward the street light at (−2040, 1470), hopping before the kerb
    const s = simulate(RIDE_PROFILE, { x: -2040, z: 1715 }, 0, { seconds: 1, speed: 380, scooter: true, boost: true, jumpAt: 0.3 });
    expect(s.hops.length).toBe(1);
    expect(s.pos.z).toBeGreaterThan(1470);
  });
  it("the world's rim holds in the air", () => {
    const s = simulate(RIDE_PROFILE, { x: WORLD_WALK.x + WORLD_WALK.r - 120, z: WORLD_WALK.z }, Math.PI / 2, { seconds: 1.5, speed: 190, scooter: true, jumpAt: 0.05 });
    expect(Math.hypot(s.pos.x - WORLD_WALK.x, s.pos.z - WORLD_WALK.z)).toBeLessThanOrEqual(WORLD_WALK.r);
  });
});

describe("traversal — wiring", () => {
  it("Space while riding is the deck's hop (no longer refused), and E is not taken in mid-air", () => {
    expect(mode).not.toContain("no jumping off a moving deck");
    expect(mode).toContain("if (this.ride) { this.ride.jump.start(this.ride.y); return; }");
    expect(mode).toContain('if (this.ride) { if (!this.ride.jump.airborne) this.ride.hooks.forceEnd("dismount"); return; }');
  });
  it("the walker and the deck are handed their support and limits; the deck's leading wheel meets edges first", () => {
    expect(world).toContain("support: playerSupport, dropMax: WALK_PROFILE.dropMax,");
    expect(world).toContain("support: (p) => ground.support(p, RIDE_PROFILE.footRadius),");
    expect(world).toContain("const lead = (p.x - motion.from.x) * fx + (p.z - motion.from.z) * fz >= 0 ? wheelsAt(p, h).front : wheelsAt(p, h).rear;");
  });
});
