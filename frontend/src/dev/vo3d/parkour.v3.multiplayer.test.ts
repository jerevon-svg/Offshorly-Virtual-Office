// vo3d — PARKOUR V3, ACROSS TWO BROWSERS: a peer on the treehouse. The ladder and the zipline replayed from the relay
// (the whole route, at its own pace, on the real Lab routes), a late joiner put where the route has the rider NOW,
// duplicates/stale/out-of-order relays dropped, a halt sent to a safe end; and each body's own vertical continuity
// on the real decks — standing on L1 beneath L2, walking off an edge and falling, never floated by a bad height.

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Coworkers } from "./world/Coworkers";
import type { Vo3dCoworker } from "./app/coworkers";
import { L1, L2, LAB2_FLOOR_Y, LAB_ROUTES, labV2Surfaces } from "./world/ailabV2";
import { StandableIndex } from "./world/standables";
import { routeDuration, routeExit } from "./world/traversalRoutes";

const DT = 1 / 60;
const rig = vi.hoisted(() => ({ clips: ["idle-9", "walking", "sit-on-chair-arms"] }));
vi.mock("./avatar/humanBody", async (orig) => ({ ...(await orig<typeof import("./avatar/humanBody")>()), humanBodyFor: () => null }));
vi.mock("./avatar/CastPrototypes", async () => {
  const T = await import("three");
  return {
    prototypeFor: (id: string) => {
      const scene = new T.Group();
      const mesh = new T.Mesh(new T.BoxGeometry(1, 36, 1), new T.MeshStandardMaterial());
      mesh.name = "body";
      scene.add(mesh);
      const clips = rig.clips.map((name) => new T.AnimationClip(name, 1.067, [new T.VectorKeyframeTrack("body.position", [0, 1.067], [0, 0, 0, 0, 0, 0])]));
      return Promise.resolve({ id, gltf: {} as never, scene, clips, triangles: 100, headY: 36 });
    },
    castLabelTexture: () => new T.CanvasTexture(document.createElement("canvas")),
  };
});

const EMAIL = "peer@offshorly.com";
const coworker = (o: Partial<Vo3dCoworker> = {}): Vo3dCoworker => ({
  email: EMAIL, displayName: "Peer", avatarId: "bon", point: { x: 0, z: 0 }, posSource: "live", box: { width: 20, height: 37 }, facing: "south", ...o,
});
/** a sofa-sized standable top at the origin: 15.6 high, radius 12 */
const SOFA_TOP = 15.6;
const onSofa = (p: { x: number; z: number }) => Math.hypot(p.x, p.z) < 12;
const topAt = (p: { x: number; z: number }, feet: number) => (onSofa(p) && Math.abs(feet - SOFA_TOP) <= 2.5 ? SOFA_TOP : null);

async function world(c: Partial<Vo3dCoworker> = {}, deps: Partial<ConstructorParameters<typeof Coworkers>[0]> = {}) {
  const cw = new Coworkers({ parent: new THREE.Group(), canStand: () => true, radius: 8, toWorld: (p) => p, topAt, ...deps });
  await cw.sync([coworker(c)]);
  return cw;
}
const root = (c: Coworkers): THREE.Object3D => c.group.children[0];
const tumbling = (c: Coworkers): string | null => (c as unknown as { bodies: Map<string, { tumbling: string | null }> }).bodies.get(EMAIL)!.tumbling;
function run(c: Coworkers, frames: number, each?: () => void): number {
  let apex = 0;
  for (let i = 0; i < frames; i++) { c.update(DT); apex = Math.max(apex, root(c).position.y); each?.(); }
  return apex;
}


const FY = LAB2_FLOOR_Y;
const idx = new StandableIndex(labV2Surfaces());
const labDeps = {
  groundY: () => FY,
  topAt: (p: { x: number; z: number }, feet: number) => idx.topMatching(p, 3, feet),
  supportAt: (p: { x: number; z: number }, maxTop: number) => idx.topUnder(p, 3, maxTop),
  routes: (id: string) => LAB_ROUTES.find((r) => r.id === id),
};
const route = (id: string) => LAB_ROUTES.find((r) => r.id === id)!;
const routeOf = (c: Coworkers) => (c as unknown as { bodies: Map<string, { routeState: { id: string; u: number } | null }> }).bodies.get(EMAIL)!.routeState;
const UNDER_L2_ON_L1 = { x: 742, z: -780 };

describe("a relayed LADDER and ZIPLINE", () => {
  it("the ladder is climbed the whole way at its own pace, articulated, and the body is left on L1", async () => {
    const r = route("lab/trunk-ladder");
    const c = await world({ point: { x: r.path[0].x, z: r.path[0].z } }, labDeps);
    run(c, 2);
    expect(c.route(EMAIL, r.id, "a", 0, 9000, 5, 0)).toBe(true);
    expect(tumbling(c)).toBe("ladder");
    const ys: number[] = [];
    run(c, Math.ceil(routeDuration(r) / (DT * 1000)) + 3, () => ys.push(root(c).position.y));
    for (let i = 1; i < ys.length; i++) expect(Math.abs(ys[i] - ys[i - 1])).toBeLessThan(1.5); // climbed, not jumped
    expect(routeOf(c)).toBeNull();
    run(c, 60);
    expect(root(c).position.y).toBeCloseTo(FY + L1.y, 3); // and stays on L1
  });

  it("A LATE JOINER sees the zipline rider part-way along it, moving — not waiting at either end", async () => {
    const z = route("lab/zipline");
    const ms = routeDuration(z);
    const c = await world({ point: { x: z.path[0].x, z: z.path[0].z }, traversal: { routeId: z.id, dir: "a", p0: 0, elapsedMs: ms / 2, key: "777:3" } }, labDeps);
    run(c, 1);
    const st = routeOf(c)!;
    expect(st.id).toBe(z.id);
    expect(st.u).toBeGreaterThan(0.45);
    expect(st.u).toBeLessThan(0.6);
    const x0 = root(c).position.x;
    expect(x0).toBeGreaterThan(z.path[0].x + 60);
    expect(x0).toBeLessThan(routeExit(z, "a").x - 60);
    expect(root(c).position.y).toBeGreaterThan(FY + 20); // in the air, under the cable
    run(c, 10);
    expect(root(c).position.x).toBeGreaterThan(x0); // and riding on
    // the same relay arriving live is not played twice
    expect(c.route(EMAIL, z.id, "a", ms / 2, 777, 3, 0)).toBe(false);
  });

  it("DUPLICATE, STALE and OUT-OF-ORDER route relays are dropped; an undeclared or backwards one-way route is refused", async () => {
    const c = await world({}, labDeps);
    const z = route("lab/zipline");
    expect(c.route(EMAIL, "lab/nowhere", "a", 0, 1000, 1)).toBe(false);
    expect(c.route(EMAIL, z.id, "b", 0, 1000, 1)).toBe(false);
    expect(c.route(EMAIL, z.id, "a", routeDuration(z) + 1000, 1000, 1)).toBe(false); // long over
    expect(c.route(EMAIL, z.id, "a", 0, 2000, 4)).toBe(true);
    expect(c.route(EMAIL, z.id, "a", 0, 2000, 4)).toBe(false);
    expect(c.route(EMAIL, z.id, "a", 0, 1500, 9)).toBe(false);
  });

  it("A HALT sends the body to the same safe end — one of the route's own two ends, never a relayed point", async () => {
    const r = route("lab/ship-stair");
    const c = await world({ point: { x: r.path[0].x, z: r.path[0].z } }, labDeps);
    c.route(EMAIL, r.id, "a", 0, 3000, 1, 0);
    run(c, 40);
    expect(c.routeHalt(EMAIL, "start", 3100, 2)).toBe(true);
    expect(routeOf(c)).toBeNull();
    expect(root(c).position.y).toBeCloseTo(r.path[0].y, 3);
    expect(c.routeHalt(EMAIL, "exit", 3200, 3)).toBe(false); // nothing to halt
  });
});

describe("each peer's own vertical continuity on the treehouse", () => {
  it("published standing on L1 beneath L2: stands on L1 (not lifted to L2, not dropped to the floor)", async () => {
    const c = await world({ point: UNDER_L2_ON_L1, feet: FY + L1.y }, labDeps);
    run(c, 60);
    expect(root(c).position.y).toBeCloseTo(FY + L1.y, 3);
  });

  it("a stale height for L2 while it walks about L1 beneath L2 does not pop it up there", async () => {
    const c = await world({ point: UNDER_L2_ON_L1, feet: FY + L1.y }, labDeps);
    run(c, 30);
    await c.sync([coworker({ point: UNDER_L2_ON_L1, feet: FY + L2.y })]);
    run(c, 20); // under ELEVATION_ADOPT_MS: its own continuity holds
    expect(root(c).position.y).toBeCloseTo(FY + L1.y, 3);
  });

  it("walking off L1's edge on its walk: a real fall with gravity, down to the floor, not a snap", async () => {
    const c = await world({ point: { x: 800, z: -700 }, feet: FY + L1.y }, labDeps);
    run(c, 30);
    expect(root(c).position.y).toBeCloseTo(FY + L1.y, 3);
    await c.sync([coworker({ point: { x: 800, z: -700 }, walk: { movementId: "off", path: [{ x: 800, z: -700 }, { x: 900, z: -660 }], durationMs: 1500, elapsedMs: 0, pacing: "linear" } })]);
    const ys: number[] = [];
    run(c, 120, () => ys.push(root(c).position.y));
    const drops = ys.slice(1).map((y, i) => ys[i] - y);
    expect(Math.max(...drops)).toBeLessThan(10); // a fall frame by frame, never one 48-unit snap
    expect(ys[ys.length - 1]).toBeCloseTo(FY, 3);
  });

  it("a height naming no real surface where it stands is never honoured — nobody floats", async () => {
    const c = await world({ point: { x: 300, z: -560 }, feet: 70 }, labDeps);
    run(c, 60);
    expect(root(c).position.y).toBeCloseTo(FY, 3);
  });
});
