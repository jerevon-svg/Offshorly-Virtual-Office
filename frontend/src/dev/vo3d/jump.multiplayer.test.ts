// vo3d — THE JUMP, ACROSS TWO BROWSERS.
//
// The local arc and the Space edge are pinned in parity.test.ts. This file is about the other half:
// the transient `jump` → `peer_jump` relay, and what a REPLICATED body does with it.
//
// The relay carries WHO and WHEN and nothing else, so most of what could go wrong is a receiver
// question — a duplicate, a late one, a body that sat down or vanished mid-arc — and that is what is
// tested here, at the body rather than through the world.
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { AIRBORNE_POSE_PHASE, JUMP_DURATION_MS, PlayerJump } from "./player/PlayerJump";
import { CLIP_IDLE, CLIP_SIT, CLIP_WALK } from "./adapters/v1Avatar";
import { Coworkers } from "./world/Coworkers";
import type { Vo3dCoworker } from "./app/coworkers";

const DT = 1 / 60;

// The GLB loader is stubbed exactly as Coworkers.walk.test.ts stubs it — no asset, no renderer — but
// with REAL AnimationClips, because the airborne pose is a statement about the mixer: it freezes one
// clip at one phase, and a stub with no clips could not tell that apart from doing nothing.
const rig = vi.hoisted(() => ({ clips: ["idle-9", "walking", "sit-on-chair-arms"] }));
vi.mock("./avatar/CastPrototypes", async () => {
  const T = await import("three");
  return {
    prototypeFor: (id: string) => {
      const scene = new T.Group();
      const mesh = new T.Mesh(new T.BoxGeometry(1, 36, 1), new T.MeshStandardMaterial());
      mesh.name = "body";
      scene.add(mesh);
      const clips = rig.clips.map(
        (name) =>
          new T.AnimationClip(name, 1.067, [
            new T.VectorKeyframeTrack("body.position", [0, 1.067], [0, 0, 0, 0, 0, 0]),
          ]),
      );
      return Promise.resolve({ id, gltf: {} as never, scene, clips, triangles: 100, headY: 36 });
    },
    castLabelTexture: () => new T.CanvasTexture(document.createElement("canvas")),
  };
});

const EMAIL = "peer@offshorly.com";
function coworker(overrides: Partial<Vo3dCoworker> = {}): Vo3dCoworker {
  return {
    email: EMAIL,
    displayName: "Peer",
    avatarId: "bon",
    point: { x: 0, z: 0 },
    posSource: "live",
    box: { width: 20, height: 37 },
    facing: "south",
    ...overrides,
  };
}

async function world(
  deps: Partial<ConstructorParameters<typeof Coworkers>[0]> = {},
): Promise<Coworkers> {
  const coworkers = new Coworkers({
    parent: new THREE.Group(),
    canStand: () => true,
    radius: 8,
    toWorld: (p) => p,
    ...deps,
  });
  await coworkers.sync([coworker()]);
  return coworkers;
}

/** The body Coworkers cloned — its root is the group's only child. */
const bodyRoot = (c: Coworkers): THREE.Object3D => c.group.children[0];

describe("vo3d jump — a replicated body", () => {
  beforeEach(() => { rig.clips = [CLIP_IDLE, CLIP_WALK, CLIP_SIT]; });

  it("takes off, rises and comes back to exactly y = 0", async () => {
    const c = await world();
    const root = bodyRoot(c);
    expect(root.position.y).toBe(0);
    expect(c.jump(EMAIL)).toBe(true);
    let apex = 0;
    for (let i = 0; i < 600; i++) {
      c.update(DT);
      apex = Math.max(apex, root.position.y);
    }
    expect(apex).toBeGreaterThan(8);
    expect(apex).toBeLessThan(16);
    expect(root.position.y).toBe(0);
    expect(c.airborneCount).toBe(0);
  });

  it("holds the airborne pose in the air and restores the resting clip on landing", async () => {
    const c = await world();
    c.jump(EMAIL);
    c.update(DT);
    c.update(DT);
    expect(c.restingClips()[EMAIL]).toBe(CLIP_WALK); // the frozen contact pose
    expect(c.positions()[0].airborne).toBe(true);
    for (let i = 0; i < 600; i++) c.update(DT);
    expect(c.restingClips()[EMAIL]).toBe(CLIP_IDLE);
    expect(c.positions()[0].airborne).toBe(false);
  });

  it("REFUSES A DUPLICATE relay while the body is already in the air", async () => {
    const c = await world();
    expect(c.jump(EMAIL)).toBe(true);
    c.update(DT);
    expect(c.jump(EMAIL)).toBe(false);
    expect(c.jump(EMAIL)).toBe(false);
    expect(c.airborneCount).toBe(1);
  });

  it("DROPS A LATE relay rather than drawing a hop that already finished", async () => {
    const c = await world();
    expect(c.jump(EMAIL, JUMP_DURATION_MS + 1)).toBe(false);
    expect(c.airborneCount).toBe(0);
    // …and a merely slow one still plays
    expect(c.jump(EMAIL, JUMP_DURATION_MS / 2)).toBe(true);
  });

  it("ignores a relay for somebody this world has no body for", async () => {
    const c = await world();
    expect(c.jump("nobody@offshorly.com")).toBe(false);
  });

  it("matches the email case-insensitively, as every other V1 join does", async () => {
    const c = await world();
    expect(c.jump("  PEER@Offshorly.com ")).toBe(true);
  });

  it("keeps the horizontal position the movement said — a jump moves only y", async () => {
    const c = await world();
    const root = bodyRoot(c);
    const before = { x: root.position.x, z: root.position.z };
    c.jump(EMAIL);
    for (let i = 0; i < 20; i++) c.update(DT);
    expect(root.position.x).toBe(before.x);
    expect(root.position.z).toBe(before.z);
    expect(root.position.y).toBeGreaterThan(0);
  });

  it("KEEPS WALKING while airborne: the replay advances x/z underneath the arc", async () => {
    const c = await world();
    const root = bodyRoot(c);
    await c.sync([
      coworker({ walk: { movementId: "m1", path: [{ x: 0, z: 0 }, { x: 0, z: 300 }], durationMs: 2000, elapsedMs: 0, pacing: "linear" } }),
    ]);
    c.jump(EMAIL);
    for (let i = 0; i < 12; i++) c.update(DT);
    expect(root.position.z).toBeGreaterThan(0); // the walk did not stop
    expect(root.position.y).toBeGreaterThan(0); // and they are off the floor
  });

  it("does not leave a body floating when they SIT DOWN mid-jump", async () => {
    const seated = await world({
      seatAnchor: () => ({ contact: new THREE.Vector3(0, 14, 0), yaw: 0, kind: "seat" as const }),
    });
    seated.jump(EMAIL);
    seated.update(DT);
    expect(seated.airborneCount).toBe(1);
    await seated.sync([coworker({ seat: "chair-1" })]);
    expect(seated.airborneCount).toBe(0);
    // and a seated body refuses to take off at all
    expect(seated.jump(EMAIL)).toBe(false);
  });

  it("does not leave a body floating when they LEAVE THE ROSTER mid-jump", async () => {
    const c = await world();
    c.jump(EMAIL);
    c.update(DT);
    await c.sync([]);
    expect(c.size).toBe(0);
    expect(c.airborneCount).toBe(0);
  });

  it("does not leave a body floating when a TELEPORT snaps them somewhere else mid-jump", async () => {
    const c = await world();
    const root = bodyRoot(c);
    c.jump(EMAIL);
    c.update(DT);
    await c.sync([coworker({ point: { x: 2000, z: 2000 } })]);
    for (let i = 0; i < 600; i++) c.update(DT);
    expect(root.position.y).toBe(0);
    expect(c.airborneCount).toBe(0);
  });

  it("survives a rig with no walk clip — no pose to freeze, and still no floating", async () => {
    rig.clips = [CLIP_IDLE];
    const c = await world();
    const root = bodyRoot(c);
    expect(c.jump(EMAIL)).toBe(true);
    for (let i = 0; i < 600; i++) c.update(DT);
    expect(root.position.y).toBe(0);
    expect(c.restingClips()[EMAIL]).toBe(CLIP_IDLE);
  });

  it("reports the arc as a transform change, so the shadow composite is invalidated", async () => {
    const c = await world();
    c.jump(EMAIL);
    expect(c.update(DT)).toBe(true);
  });
});

describe("vo3d jump — the arc is the SAME on both sides", () => {
  it("a peer reconstructs the jumper's own physics, not an approximation of it", () => {
    // The replicated body runs player/PlayerJump itself, so this is a statement about one class being
    // shared rather than two implementations agreeing by luck.
    const local = new PlayerJump();
    const remote = new PlayerJump();
    local.start();
    remote.start();
    for (let i = 0; i < 100; i++) {
      local.update(DT);
      remote.update(DT);
      expect(remote.height).toBe(local.height);
    }
  });

  it("the airborne pose phase is one shared constant", () => {
    expect(AIRBORNE_POSE_PHASE).toBeGreaterThanOrEqual(0);
    expect(AIRBORNE_POSE_PHASE).toBeLessThanOrEqual(1);
  });

  it("the staleness window is one whole arc, derived from the physics", () => {
    const j = new PlayerJump();
    j.start();
    let ms = 0;
    while (!j.update(DT)) ms += DT * 1000;
    expect(JUMP_DURATION_MS).toBeGreaterThan(ms - 40);
    expect(JUMP_DURATION_MS).toBeLessThan(ms + 40);
  });
});

// ---- the transport -------------------------------------------------------------------------------
describe("movementSync — the jump relay", () => {
  beforeEach(() => vi.resetModules());

  it("validates peer_jump and drops a malformed one", async () => {
    const handlers = new Map<string, (p?: unknown) => void>();
    const emit = vi.fn();
    vi.doMock("socket.io-client", () => ({
      io: () => ({
        on: (name: string, fn: (p?: unknown) => void) => handlers.set(name, fn),
        emit,
        disconnect: () => {},
      }),
    }));
    vi.doMock("../../services/api/client", () => ({ getAuthToken: () => "t" }));
    const mod = await import("../../services/presence/movementSync");
    const seen: { email: string; at: number }[] = [];
    mod.subscribePeerJump((e) => seen.push(e));
    const fire = handlers.get("peer_jump")!;

    fire(undefined);
    fire({ at: 1 }); // no email
    fire({ email: "", at: 1 });
    fire({ email: "a@b.c" }); // no time
    fire({ email: "a@b.c", at: "soon" });
    fire({ email: "a@b.c", at: Number.NaN });
    expect(seen).toEqual([]);

    fire({ email: "A@B.c", at: 1234 });
    expect(seen).toEqual([{ email: "a@b.c", at: 1234 }]);

    mod.emitJump();
    expect(emit).toHaveBeenCalledWith("jump");
    mod.__resetForTests();
  });
});
