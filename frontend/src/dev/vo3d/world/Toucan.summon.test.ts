// PHASE 7G — THE BIRD YOU CALL, as a lifecycle.
//
// What is asserted here is the part that is NEW: the mode machine, the altitude rule and the way home.
// The summon DECISIONS are V1's and already have their own tests (components/OfficeMap/toucanSummon.
// test.ts), and the wing rhythm is V1's and already has its own (toucanWingRhythm.test.ts) — neither is
// re-tested, only reached.
//
// The GLB is stubbed at the loader boundary: a real load needs WebGL and a 1.5 MB asset, and nothing here
// is about the asset. The stub carries what the flyer actually looks for — a measurable box and the two
// arm bones the Meshy biped rig puts the wings on.
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

// The stub's PROPORTIONS AND AXES are the shipped asset's, read off public/toucan/toucan.glb with
// gltf-transform rather than assumed:
//   mesh bbox      1.70 x 1.07 x 1.26  (so the WIDEST dimension is the wingspan, on x)
//   Hips -> Head        (0, 0.999, 0.031)   — it stands up its local +Y
//   Head -> headfront   (0, 0,     1.000)   — ITS BEAK POINTS LOCAL +Z
// That last line is the one the backward-flight bug turned on, so the two bones are here and the
// orientation assertions below measure the real composed transform through them.
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    async loadAsync() {
      const scene = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.07, 1.26), new THREE.MeshBasicMaterial());
      scene.add(body);
      for (const [name, at] of [
        ["Hips", [0, 0.386, -0.014]],
        ["headfront", [0, 0.654, 0.257]],
        ["LeftArm", [0.238, 0.568, -0.02]],
        ["RightArm", [-0.231, 0.557, -0.02]],
      ] as [string, number[]][]) {
        const node = new THREE.Object3D();
        node.name = name;
        node.position.set(at[0], at[1], at[2]);
        scene.add(node);
      }
      return { scene };
    }
  },
}));

const { Toucan } = await import("./Toucan");
import type { WeatherState } from "../env/weather";

/** A clear day, so the ambient lap is allowed to fly and the summon is never confused with weather. */
const CLEAR = { state: "clear", wind: 0.1, wetness: 0 } as unknown as WeatherState;
/** V1's own office frame, which is also this world's, 1:1. */
const FRAME = { x: 0, z: 0, w: 1440, d: 1280 };
const PERCH = { x: 727, z: 556, y: 12 };
/** Somewhere a body could plausibly be standing, inside the building. */
const BODY = { x: 400, z: 500 };

/** Run the flight for `seconds` at 60 Hz, which is what the world's own loop does. */
function run(bird: InstanceType<typeof Toucan>, seconds: number, outdoors = true): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) bird.update(1 / 60, CLEAR, "day", outdoors);
}

/** WHICH WAY THE BEAK IS POINTING, in world space, on the XZ plane.
 *
 *  Measured through the REAL chain — root -> the forward-fix node -> the model -> the bones — rather than
 *  from the root's own axes, because the bug this pins was precisely a mismatch between those two. */
function beakDir(t: InstanceType<typeof Toucan>): THREE.Vector3 {
  t.root.updateMatrixWorld(true);
  const find = (name: string) => {
    let found: THREE.Object3D | null = null;
    t.root.traverse((o) => { if (o.name === name) found = o; });
    if (!found) throw new Error(`missing ${name}`);
    return (found as THREE.Object3D).getWorldPosition(new THREE.Vector3());
  };
  const dir = find("headfront").sub(find("Hips"));
  dir.y = 0;
  return dir.normalize();
}

/** How well the beak agrees with a direction: 1 = dead on, -1 = flying backwards. */
function agreement(t: InstanceType<typeof Toucan>, direction: THREE.Vector3): number {
  const want = direction.clone();
  want.y = 0;
  return beakDir(t).dot(want.normalize());
}

async function bird(perch?: { x: number; z: number; y: number }) {
  const t = new Toucan(FRAME, perch);
  expect(await t.load()).toBe(true);
  return t;
}

describe("the ambient lap", () => {
  it("is untouched: it flies the ring and reports roaming", async () => {
    const t = await bird(PERCH);
    run(t, 1);
    expect(t.summonState).toBe("roaming");
    expect(t.summonActive).toBe(false);
    // Well above the 46-unit wall heads and outside the building — the ring's own geometry.
    expect(t.worldPosition.y).toBeGreaterThan(80);
  });

  it("is hidden when the exterior is not being drawn, exactly as before", async () => {
    const t = await bird(PERCH);
    run(t, 0.5, false);
    expect(t.flying).toBe(false);
  });
});

describe("calling it", () => {
  it("flies to the body, parks beside it and reports V1's three states in order", async () => {
    const t = await bird(PERCH);
    run(t, 1);
    const seen: string[] = [];
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12; i++) {
      t.update(1 / 60, CLEAR, "day", true);
      if (seen[seen.length - 1] !== t.summonState) seen.push(t.summonState);
      if (t.summonState === "attending") break;
    }
    expect(seen).toEqual(["approaching", "attending"]);
    // PARKED BESIDE THE BODY, on V1's own lateral offset (32 units) — beside it, never on top of it.
    const gap = Math.hypot(t.worldPosition.x - BODY.x, t.worldPosition.z - BODY.z);
    expect(gap).toBeGreaterThan(20);
    expect(gap).toBeLessThan(60);
    // AT HEAD HEIGHT, not at the ring's altitude and not on the floor.
    expect(t.worldPosition.y).toBeGreaterThan(24);
    expect(t.worldPosition.y).toBeLessThan(44);
  });

  it("comes even in the OFFICE presentation, where its own lap is not drawn", async () => {
    const t = await bird(PERCH);
    run(t, 0.5, false);
    expect(t.flying).toBe(false);
    t.setSummonTarget(BODY);
    run(t, 0.5, false);
    // THE ONE OVERRIDE. A bird you called comes, whatever the camera is drawing.
    expect(t.flying).toBe(true);
    expect(t.summonActive).toBe(true);
  });

  it("descends rather than teleporting — it is never above the ring or below the floor on any frame", async () => {
    const t = await bird(PERCH);
    run(t, 1);
    const startY = t.worldPosition.y;
    t.setSummonTarget(BODY);
    let previous = startY;
    let worstJump = 0;
    for (let i = 0; i < 60 * 12; i++) {
      t.update(1 / 60, CLEAR, "day", true);
      worstJump = Math.max(worstJump, Math.abs(t.worldPosition.y - previous));
      previous = t.worldPosition.y;
      expect(t.worldPosition.y).toBeGreaterThan(0);
      if (t.summonState === "attending") break;
    }
    // No frame moves it more than a plausible glide: the altitude is EASED, never written.
    expect(worstJump).toBeLessThan(4);
  });

  it("crosses the building ABOVE the wall heads, and only comes down at the end", async () => {
    const t = await bird(PERCH);
    run(t, 1);
    t.setSummonTarget(BODY);
    let lowestWhileFar = Infinity;
    for (let i = 0; i < 60 * 12; i++) {
      t.update(1 / 60, CLEAR, "day", true);
      const far = Math.hypot(t.worldPosition.x - BODY.x, t.worldPosition.z - BODY.z) > 200;
      if (far) lowestWhileFar = Math.min(lowestWhileFar, t.worldPosition.y);
      if (t.summonState === "attending") break;
    }
    // 46 is the tallest wall head in the building. While it is still crossing the floorplan it stays
    // clear of them, which is the whole of "does not clip through walls where practical".
    expect(lowestWhileFar).toBeGreaterThan(46);
  });

  it("follows a body that walks properly away, and ignores one that merely shuffles", async () => {
    const t = await bird(PERCH);
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    expect(t.summonState).toBe("attending");

    // A shuffle, well inside V1's own follow-break hysteresis: the bird stays put.
    t.setSummonTarget({ x: BODY.x + 12, z: BODY.z + 8 });
    run(t, 0.5);
    expect(t.summonState).toBe("attending");

    // A real walk: it goes back in the air after them.
    t.setSummonTarget({ x: BODY.x + 500, z: BODY.z });
    t.update(1 / 60, CLEAR, "day", true);
    expect(t.summonState).toBe("approaching");
  });
});

describe("releasing it", () => {
  it("flies home to the perch, sits there, then rejoins its lap — and never just vanishes", async () => {
    const t = await bird(PERCH);
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);

    t.setSummonTarget(null);
    t.update(1 / 60, CLEAR, "day", true);
    // Reported as roaming AT ONCE — the host's panel closes with the release, not when the bird lands.
    expect(t.summonState).toBe("roaming");
    // …but the bird is still busy, which is why it is still drawn.
    expect(t.summonActive).toBe(true);
    expect(t.state.phase).toBe("returning");

    run(t, 4);
    expect(t.state.phase).toBe("perched");
    expect(Math.hypot(t.worldPosition.x - PERCH.x, t.worldPosition.z - PERCH.z)).toBeLessThan(20);

    // The perch is a pause, not a parking space: it rejoins the ring on its own.
    run(t, 30);
    expect(t.summonActive).toBe(false);
    expect(t.state.phase).toBe("roaming");
  });

  it("rejoins directly when it has no perch to go home to", async () => {
    const t = await bird();
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    t.setSummonTarget(null);
    t.update(1 / 60, CLEAR, "day", true);
    expect(t.state.phase).toBe("rejoining");
    run(t, 25);
    expect(t.state.phase).toBe("roaming");
  });

  it("is ONE bird: calling, releasing and calling again re-uses the same object and the same model", async () => {
    const t = await bird(PERCH);
    const root = t.worldPosition;
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    t.setSummonTarget(null);
    run(t, 2);
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    expect(t.summonState).toBe("attending");
    // The same Vector3 instance the whole way through — there is no second root and no second model, so
    // "no duplicate birds across a view switch" is structural rather than policed.
    expect(t.worldPosition).toBe(root);
    // A second load is a no-op on the same model.
    expect(await t.load()).toBe(true);
  });

  it("restarting the lap from the dev panel drops the summon rather than stranding it", async () => {
    const t = await bird(PERCH);
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    t.reset();
    expect(t.summonState).toBe("roaming");
    expect(t.summonActive).toBe(false);
  });
});

describe("the wings", () => {
  it("beat on V1's rhythm while flying, and fold away on the perch", async () => {
    const t = await bird(PERCH);
    const wings = () => {
      const found: THREE.Object3D[] = [];
      t.root.traverse((o) => { if (/^(left|right)arm$/i.test(o.name)) found.push(o); });
      return found;
    };
    run(t, 4);
    // A GLIDE IS SUPPOSED TO BE STILL — V1's rhythm holds the glide pose for up to 5 seconds and then
    // bursts, so a short window can legitimately show one value. Eight seconds cannot: it must contain a
    // burst, and a burst is a whole number of wingbeats through the stroke curve.
    const samples = new Set<number>();
    let peak = 0;
    for (let i = 0; i < 60 * 8; i++) {
      t.update(1 / 60, CLEAR, "day", true);
      const z = wings()[0].rotation.z;
      samples.add(Number(z.toFixed(4)));
      peak = Math.max(peak, Math.abs(z));
    }
    expect(samples.size).toBeGreaterThan(20);
    // Inside the rhythm's own documented band (GLIDE_SPREAD_ANGLE -0.15 … +0.55), so the flap is the
    // shared module's and not a second amplitude invented here.
    expect(peak).toBeLessThan(0.6);
    // MIRRORED, which is what this asset's bind quaternions need — V1's invariant 1, unchanged.
    expect(wings()[1].rotation.z).toBeCloseTo(-wings()[0].rotation.z, 5);

    // PERCHED: the spread blends out, so the wings come back to the bind pose instead of freezing
    // mid-beat. (Released with a perch → returning → perched.)
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    t.setSummonTarget(null);
    run(t, 4);
    expect(t.state.phase).toBe("perched");
    run(t, 2);
    expect(Math.abs(wings()[0].rotation.z)).toBeLessThan(0.05);
  });
});

// THE BACKWARD-FLIGHT REGRESSION.
//
// The asset's beak points local +Z (measured — see the loader stub above), and THREE's Matrix4.lookAt is
// the CAMERA convention: it orients local -Z at the target. Driving the root straight off it therefore
// pointed the bird's tail along its direction of travel, and pointed its back at whoever it was
// attending. One root cause, every state.
//
// These assertions are written against the DIRECTION OF TRAVEL rather than against any rotation value, so
// they hold however the correction is expressed — and they fail loudly if a future asset flips its axes.
describe("which way it is facing", () => {
  /** Where it moved between two frames — the only definition of "forward" that cannot be fudged. */
  function travelDirection(t: InstanceType<typeof Toucan>): THREE.Vector3 {
    const before = t.worldPosition.clone();
    for (let i = 0; i < 6; i++) t.update(1 / 60, CLEAR, "day", true);
    return t.worldPosition.clone().sub(before);
  }

  it("points its BEAK along the ambient lap, not its tail", async () => {
    const t = await bird(PERCH);
    run(t, 3);
    expect(agreement(t, travelDirection(t))).toBeGreaterThan(0.9);
  });

  it("points its beak along a SUMMONED approach", async () => {
    const t = await bird(PERCH);
    run(t, 2);
    t.setSummonTarget(BODY);
    // Past the turn-in, mid-leg, where the heading has settled onto the line of flight.
    for (let i = 0; i < 90 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    expect(t.summonState).toBe("approaching");
    expect(agreement(t, travelDirection(t))).toBeGreaterThan(0.85);
  });

  it("TURNS TOWARD the avatar while attending, rather than showing it its back", async () => {
    const t = await bird(PERCH);
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    expect(t.summonState).toBe("attending");
    run(t, 2); // let the slerp settle
    const toBody = new THREE.Vector3(BODY.x - t.worldPosition.x, 0, BODY.z - t.worldPosition.z);
    expect(agreement(t, toBody)).toBeGreaterThan(0.95);
  });

  it("follows the avatar round WITHOUT spinning or snapping", async () => {
    const t = await bird(PERCH);
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    run(t, 2);
    // Walk properly round to the far side, which re-aims the park point and the facing with it.
    t.setSummonTarget({ x: BODY.x - 300, z: BODY.z + 300 });
    let worstTurn = 0;
    let previous = beakDir(t);
    for (let i = 0; i < 60 * 12; i++) {
      t.update(1 / 60, CLEAR, "day", true);
      const now = beakDir(t);
      worstTurn = Math.max(worstTurn, previous.angleTo(now));
      previous = now;
    }
    // No frame turns it more than a real bird could — the heading is slerped, never written.
    expect(worstTurn).toBeLessThan(0.35);
  });

  it("points its beak along the flight HOME and along the REJOIN", async () => {
    const t = await bird(PERCH);
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    t.setSummonTarget(null);
    run(t, 0.6);
    expect(t.state.phase).toBe("returning");
    expect(agreement(t, travelDirection(t))).toBeGreaterThan(0.8);

    // …and again on the way back out to the ring.
    for (let i = 0; i < 60 * 30 && t.state.phase !== "rejoining"; i++) t.update(1 / 60, CLEAR, "day", true);
    expect(t.state.phase).toBe("rejoining");
    run(t, 0.4);
    expect(agreement(t, travelDirection(t))).toBeGreaterThan(0.8);
  });

  it("keeps a natural resting heading on the perch — no snap on landing", async () => {
    const t = await bird(PERCH);
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    t.setSummonTarget(null);
    for (let i = 0; i < 60 * 20 && t.state.phase !== "perched"; i++) t.update(1 / 60, CLEAR, "day", true);
    expect(t.state.phase).toBe("perched");
    const landed = beakDir(t);
    run(t, 3);
    // Still upright and still pointing where it landed: a perched bird is not re-aimed at anything.
    expect(beakDir(t).angleTo(landed)).toBeLessThan(0.25);
    expect(t.root.up.y).toBe(1);
  });
});

describe("how big it is", () => {
  it("is a toucan beside a person, not a sparrow — and its click target follows its size", async () => {
    const t = await bird(PERCH);
    const box = new THREE.Box3().setFromObject(t.root);
    const size = new THREE.Vector3();
    box.getSize(size);
    // The widest dimension is the wingspan, fitted to LENGTH. Bon is 36 tall, so this reads as a large
    // bird without competing with the avatar.
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(17, 0);
    // ASKED FOR, not duplicated: the pick sphere is derived from the same number, so a scale change can
    // never leave the click target behind.
    expect(t.pickRadius).toBeGreaterThan(Math.max(size.x, size.z) / 2);
  });

  it("parks clear of the avatar's body at V1's own offset", async () => {
    const t = await bird(PERCH);
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    const gap = Math.hypot(t.worldPosition.x - BODY.x, t.worldPosition.z - BODY.z);
    const box = new THREE.Box3().setFromObject(t.root);
    const size = new THREE.Vector3();
    box.getSize(size);
    // Beside the shoulder with the nearest wingtip still well clear of a body about 12 units across.
    expect(gap - Math.max(size.x, size.z) / 2).toBeGreaterThan(8);
  });
});

// AMBIENT LIFE INSIDE THE BUILDING.
//
// The bird used to fly its exterior ring and nothing else, so the office it lives in never actually had
// a bird in it — you only ever met one by summoning it. What is pinned here is that it lets itself in,
// hovers where the office says its rooms are, keeps clear of the wall heads on the way, and that a
// summon still interrupts all of it and brings back THE SAME bird.
describe("roaming through the office", () => {
  /** The office's own room centres — in the real world these are the rects Room Discovery letters. */
  const ROOMS = [
    { x: 200, z: 450 },
    { x: 1250, z: 200 },
    { x: 700, z: 1000 },
  ];

  /** Fly until it reaches `phase`, or give up. Returns the frames it took. */
  function runUntil(t: InstanceType<typeof Toucan>, phase: string, seconds = 90): number {
    for (let i = 0; i < seconds * 60; i++) {
      t.update(1 / 60, CLEAR, "day", true);
      if (t.state.phase === phase) return i;
    }
    throw new Error(`never reached ${phase} (stuck in ${t.state.phase})`);
  }

  it("goes indoors on its own and hovers over the office's OWN rooms", async () => {
    const t = new Toucan(FRAME, PERCH, ROOMS);
    expect(await t.load()).toBe(true);
    runUntil(t, "visiting");
    run(t, 1.5); // the altitude is EASED, so let the hover settle rather than reading it mid-descent
    // Over one of the rooms it was given — no route is authored in the flyer, so it can only ever be
    // somewhere the office itself declared.
    const over = ROOMS.some((r) => Math.hypot(t.worldPosition.x - r.x, t.worldPosition.z - r.z) < 25);
    expect(over).toBe(true);
    // ABOVE THE AVATARS (36 tall) and BELOW THE WALL HEADS (46): that is the whole of "no clipping", and
    // it is geometry rather than a collision test.
    expect(t.worldPosition.y).toBeGreaterThan(36);
    expect(t.worldPosition.y).toBeLessThan(46);
  });

  it("crosses the building ABOVE the walls, and comes back out to its lap afterwards", async () => {
    const t = new Toucan(FRAME, PERCH, ROOMS);
    expect(await t.load()).toBe(true);
    runUntil(t, "touring");
    let lowestWhileCrossing = Infinity;
    for (let i = 0; i < 60 * 20 && t.state.phase === "touring"; i++) {
      t.update(1 / 60, CLEAR, "day", true);
      // Only sample while it is genuinely BETWEEN rooms — the last stretch is the descent, which is
      // supposed to drop below the wall line because that is it arriving.
      const nearARoom = ROOMS.some((r) => Math.hypot(t.worldPosition.x - r.x, t.worldPosition.z - r.z) < 180);
      if (!nearARoom) lowestWhileCrossing = Math.min(lowestWhileCrossing, t.worldPosition.y);
    }
    // While it is between rooms it stays over the 46-unit wall heads; it only drops in at the end.
    if (lowestWhileCrossing !== Infinity) expect(lowestWhileCrossing).toBeGreaterThan(46);
    // And the wander ends: it returns to the exterior lap rather than living in the ceiling.
    runUntil(t, "roaming", 200);
    expect(t.summonActive).toBe(false);
  });

  it("is INTERRUPTED by a summon, and it is the same bird that arrives", async () => {
    const t = new Toucan(FRAME, PERCH, ROOMS);
    expect(await t.load()).toBe(true);
    runUntil(t, "visiting");
    const root = t.worldPosition;
    t.setSummonTarget(BODY);
    t.update(1 / 60, CLEAR, "day", true);
    // The wander is dropped mid-hover — a called bird comes.
    expect(t.state.phase).toBe("approaching");
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    expect(t.summonState).toBe("attending");
    // The SAME object, never a second one spawned for the summon.
    expect(t.worldPosition).toBe(root);
  });

  it("resumes its ambient life through the existing return lifecycle after a release", async () => {
    const t = new Toucan(FRAME, PERCH, ROOMS);
    expect(await t.load()).toBe(true);
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    t.setSummonTarget(null);
    // Unchanged: home to the perch, then back onto the lap — and only then indoors again on its own.
    runUntil(t, "perched", 30);
    runUntil(t, "roaming", 60);
    runUntil(t, "visiting", 120);
  });

  it("keeps to its exterior lap when the office declares no rooms at all", async () => {
    const t = new Toucan(FRAME, PERCH, []);
    expect(await t.load()).toBe(true);
    run(t, 60);
    expect(t.state.phase).toBe("roaming");
  });
});

// THE TWO BODY POSES.
//
// This asset is a standing biped rig, so left alone it hovers bolt upright — which is what it was doing.
// The pitch is its OWN node, below the forward fix and above the model, so it can never be confused with
// the heading: these assertions check the pose while the beak-forward ones above still check the
// direction, and both hold at once.
describe("how it carries itself", () => {
  it("leans into the flight, and stands up to attend somebody", async () => {
    const t = await bird(PERCH);
    run(t, 3);
    const flying = t.bodyPitch;
    // Plainly leaning, not upright.
    expect(flying).toBeGreaterThan(0.6);

    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    run(t, 3);
    // Conversational: upright, with only the slight forward tilt of something paying attention.
    expect(t.bodyPitch).toBeLessThan(0.25);
    expect(t.bodyPitch).toBeGreaterThanOrEqual(0);
  });

  it("leans back into the flying pose before it departs", async () => {
    const t = await bird(PERCH);
    t.setSummonTarget(BODY);
    for (let i = 0; i < 60 * 12 && t.summonState !== "attending"; i++) t.update(1 / 60, CLEAR, "day", true);
    run(t, 3);
    expect(t.bodyPitch).toBeLessThan(0.25);
    t.setSummonTarget(null);
    run(t, 2);
    expect(t.state.phase).toBe("returning");
    expect(t.bodyPitch).toBeGreaterThan(0.6);
  });

  it("changes pose smoothly — no frame snaps between the two", async () => {
    const t = await bird(PERCH);
    t.setSummonTarget(BODY);
    let worst = 0;
    let previous = t.bodyPitch;
    for (let i = 0; i < 60 * 20; i++) {
      t.update(1 / 60, CLEAR, "day", true);
      worst = Math.max(worst, Math.abs(t.bodyPitch - previous));
      previous = t.bodyPitch;
    }
    expect(worst).toBeLessThan(0.05);
  });

  it("does NOT let the pose disturb the heading — the beak still leads the flight", async () => {
    const t = await bird(PERCH);
    run(t, 3);
    const before = t.worldPosition.clone();
    for (let i = 0; i < 6; i++) t.update(1 / 60, CLEAR, "day", true);
    // Pitch moves the body in the vertical plane only, so the beak's horizontal direction is untouched.
    expect(agreement(t, t.worldPosition.clone().sub(before))).toBeGreaterThan(0.9);
  });
});
