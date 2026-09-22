// vo3d season — THE DECORATION LAYER ITSELF. One object, attached over the built world, removable.
//
// WHAT IT IS ALLOWED TO TOUCH: the scene graph (adding its own groups) and the Environment's season
// overlay. Nothing else. It never reads or writes WorldState, never registers a listener, never
// touches an entity, a footprint, a region, a seat or an interaction — so the office it decorates is
// the same office underneath, by construction rather than by care.
//
// DISPOSAL IS THE WHOLE CONTRACT. `dispose()` is idempotent, removes every group it added, frees every
// geometry and material it created, and clears the environment overlay. Because the season owns its
// OWN material set (season/halloween/materials.ts) rather than tinting the shared cache, there is no
// "restore" step to get wrong: what it made, it destroys; what it did not make, it never changed.
import * as THREE from "three";
import { bake } from "../build/helpers";
import type { Rect } from "../core/coords";
import type { DoorOpening } from "../adapters/v1Floor";
import type { EnvOverlay } from "../env/presets";
import type { EnvPhase } from "../env/timeOfDay";
import { HALLOWEEN_AUTO_PHASE, HALLOWEEN_GRADE } from "./halloween/grade";
import { createHalloweenMaterials, type HalloweenMaterials } from "./halloween/materials";
import {
  batFlock, candles, cornerWeb, drapeSwag, floorDecay, ghost, groundFog, jackOLantern, lantern,
  pumpkinCluster, scarecrow, seeded, skull, webSwag, witheredPlant,
  type BatSpec, type CandleSpec, type PumpkinSpec,
} from "./halloween/decor";
import {
  CHARACTER, DENSITY, DEFAULT_PLAN, DOOR_CLEARANCE, HANG_Y, ROOM_DECOR, WALL_HEAD, WALL_HUG,
  clearOfDoors, corners, insideFloor, spread, wallSpots, type Spot,
} from "./placement";
import { CHRISTMAS_AUTO_PHASE, CHRISTMAS_GRADE, CHRISTMAS_SNOWFALL } from "./christmas/grade";
import { createChristmasMaterials, type ChristmasMaterials } from "./christmas/materials";
import {
  TREE_HUG, WINTER_CHARACTER, WINTER_DEFAULT_PLAN, WINTER_DENSITY, WINTER_ROOM_DECOR,
} from "./christmas/placement";
import {
  crystalCluster, fairyLightSwag, frostCarpet, frostedBranches, garlandSwag, giftStack, icicleRun,
  seeded as xseeded, snowDrift, snowTree, snowflakeDrift, sparklePatch, winterLantern, wreath,
  type FlakeSpec, type GiftSpec,
} from "./christmas/decor";
import type { SeasonLayer, SeasonTheme } from "./season";

/** WHAT A SEASON ASKS THE PRECIPITATION CHANNEL FOR — the same four numbers weather already speaks in
 *  (env/weatherGrade's RainParams), so a season needs no new field, no second particle system and no
 *  transition of its own. Structurally typed rather than imported from env so the layer keeps not
 *  depending on the environment's internals. */
export interface SeasonSnowfall {
  perMillion: number;
  opacity: number;
  speed: number;
  length: number;
}

/** The minimum a room must know about itself for the rules to decorate it. Deliberately a structural
 *  type rather than an import of RoomDef: the layer must not become a reason to change WorldState. */
export interface SeasonRoom {
  id: string;
  rect: Rect;
  floorRect: Rect;
}

export interface SeasonLayerDeps {
  scene: THREE.Object3D;
  rooms: readonly SeasonRoom[];
  doors: readonly DoorOpening[];
  /** THE V1 FRAME and the exterior sidewalk, when the caller has them. Optional so a test — and any
   *  future caller with only rooms — still builds a complete interior; a season simply skips its
   *  exterior pass when they are absent rather than inventing coordinates for it. */
  frame?: Rect;
  sidewalk?: Rect;
  /** Called with the overlay to compose onto the resolved weather × phase grade, or null to clear it. */
  setEnvOverlay: (grade: Record<EnvPhase, EnvOverlay> | null, autoPhase: EnvPhase | null) => void;
  /** Ask the environment's PRECIPITATION CHANNEL for a season's own fall — snow — or null to hand it
   *  back to the weather state. Optional so tests and the Halloween layer need not stub it. */
  setSnowfall?: (spec: SeasonSnowfall | null) => void;
  /** Ask the renderer to redraw its cached shadow map. Optional so tests need not stub it. */
  invalidateShadows?: () => void;
}

export interface BuiltSeasonLayer extends SeasonLayer {
  /** Per-frame: turns the upright glow haloes to face the camera. Cheap — a handful of quaternion
   *  copies, no traversal, no allocation. */
  update(camera: THREE.Camera): void;
  /** What was built, for the verification readout and the perf comparison. */
  readonly stats: {
    groups: number; pieces: number; swags: number;
    /** instanced quads in the flock: bats for Halloween, hanging snowflakes for Christmas */
    bats: number;
    glowInstances: number; glowDrawCalls: number; baked: number;
  };
}

/** Build and attach a season's layer. Returns null for "none" — the ordinary office, undecorated. */
export function createSeasonLayer(theme: SeasonTheme, deps: SeasonLayerDeps): BuiltSeasonLayer | null {
  if (theme === "halloween") return buildHalloween(deps);
  if (theme === "christmas") return buildChristmas(deps);
  return null;
}

function buildHalloween(deps: SeasonLayerDeps): BuiltSeasonLayer {
  const root = new THREE.Group();
  root.name = "season:halloween";
  const M = createHalloweenMaterials();
  const billboards: THREE.Object3D[] = [];
  const stats = { groups: 0, pieces: 0, bats: 0, swags: 0, glowInstances: 0, glowDrawCalls: 0, baked: 0 };

  const add = (o: THREE.Object3D | null): void => {
    if (!o) return;
    root.add(o);
    stats.groups++;
  };

  for (const room of deps.rooms) {
    const plan = ROOM_DECOR[room.id] ?? DEFAULT_PLAN;
    const d = DENSITY[plan.density];
    // A stable per-room seed: the same room decorates identically on every load, which is what makes a
    // before/after screenshot comparison mean anything.
    const rng = seeded(hash(room.id));
    const floor = room.floorRect.w > 0 && room.floorRect.d > 0 ? room.floorRect : room.rect;

    const cornerSpots = clearOfDoors(insideFloor(corners(floor, WALL_HUG), floor), deps.doors);
    const edgeSpots = clearOfDoors(insideFloor(wallSpots(floor, 7), floor), deps.doors);

    // ---- pumpkin clusters, in corners first: no furniture, no seats, no traffic ----------------------
    for (const spot of spread(cornerSpots, d.clusters)) {
      add(pumpkinCluster(M, clusterAt(spot, rng)));
      stats.pieces += 3;
    }
    // ---- lit jack-o'-lanterns along the walls: the room's actual light sources ------------------------
    for (const spot of spread(edgeSpots, d.jacks)) {
      add(jackOLantern(M, spot.x, spot.z, 6.2 + rng() * 2.4));
      stats.pieces++;
    }
    // ---- candle rows, offset from the jacks so the two do not stack --------------------------------
    for (const spot of spread(edgeSpots.slice().reverse(), d.candleRows)) {
      add(candles(M, candleRowAt(spot, rng)));
      stats.pieces += 3;
    }
    for (const spot of spread(cornerSpots.slice().reverse(), d.lanterns)) {
      add(lantern(M, spot.x, spot.z, 0, 8 + rng() * 3));
      stats.pieces++;
    }

    // ---- corner webs: the four vertical corners, at the wall head -----------------------------------
    const webSize = Math.min(26, Math.min(floor.w, floor.d) * 0.3);
    corners(floor, 1).forEach((c, i) => {
      // Each corner's web faces into the room along its own diagonal.
      add(cornerWeb(M, c.x, WALL_HEAD - 1.5, c.z, webSize, [Math.PI * 0.25, Math.PI * 0.75, -Math.PI * 0.25, -Math.PI * 0.75][i]));
      stats.pieces++;
    });

    // ---- the hanging band: dark drapes behind, pale webs in front ------------------------------------
    // This is what turns a decorated room into an overtaken one — the reference's entire upper third.
    const spanX = floor.w >= floor.d;
    for (let i = 0; i < d.swags; i++) {
      const t = (i + 1) / (d.swags + 1);
      const y = HANG_Y + 3 + rng() * 3;
      const from = spanX
        ? new THREE.Vector3(floor.x + 2, y, floor.z + floor.d * t)
        : new THREE.Vector3(floor.x + floor.w * t, y, floor.z + 2);
      const to = spanX
        ? new THREE.Vector3(floor.x + floor.w - 2, y, floor.z + floor.d * t)
        : new THREE.Vector3(floor.x + floor.w * t, y, floor.z + floor.d - 2);
      // WEBS ONLY ACROSS THE ROOM. The first render had a dark drape on every other span and from
      // the office camera's look-down they read as black beams laid across the floor — the one thing
      // the reference's ceiling is not. The heavy fabric now hangs only at the WALL LINE (below),
      // where it frames rather than covers.
      add(webSwag(M, from, to, 4.5 + rng() * 3, 6 + rng() * 4));
      stats.swags++;
    }

    // ---- the wall valance: heavy fabric at the wall line, framing rather than covering -------------
    for (const along of [floor.z + 3, floor.z + floor.d - 3]) {
      add(drapeSwag(
        M,
        new THREE.Vector3(floor.x + 2, WALL_HEAD - 3, along),
        new THREE.Vector3(floor.x + floor.w - 2, WALL_HEAD - 3, along),
        2.2,
        7 + rng() * 3,
      ));
    }

    // ---- the bat flock: a rising diagonal up one wall, smaller toward the top ------------------------
    const bats = batSpecs(floor, d.bats, rng);
    const flock = batFlock(M, bats);
    if (flock) { add(flock); stats.bats += bats.length; }

    // ══ THE ROOM'S OWN CHARACTER ══
    //
    // Everything above is the office-wide identity — web, swag, bats, pumpkins, candles — and is the
    // same everywhere so the building reads as ONE transformed place. Everything below is what makes
    // this room different from the room next door: dead greenery, bone, spectral light, fog, decay.
    const c = CHARACTER[plan.character];

    // Dead plants go where the office keeps live ones: against walls, in corners. The single
    // clearest "something happened here" signal, because the real office is full of healthy green.
    for (const spot of spread(edgeSpots, c.withered)) {
      add(witheredPlant(M, spot.x, spot.z, 10 + rng() * 7, rng));
      stats.pieces++;
    }
    // Bone as ornament, low and against the wall line.
    for (const spot of spread(cornerSpots.concat(edgeSpots), c.skulls)) {
      add(skull(M, spot.x + (rng() - 0.5) * 6, spot.z + (rng() - 0.5) * 6, 0, 2.1 + rng() * 1.2));
      stats.pieces++;
    }
    // Ghosts hover OVER the floor rather than against a wall — they are the one piece allowed into
    // open space, because they are above head height and translucent, so they obstruct nothing.
    for (let i = 0; i < c.ghosts; i++) {
      const gx = floor.x + floor.w * (0.25 + 0.5 * rng());
      const gz = floor.z + floor.d * (0.25 + 0.5 * rng());
      add(ghost(M, gx, gz, 20 + rng() * 6, 11 + rng() * 5));
      stats.pieces++;
    }
    // Fog softens corners; decay stains the boards. Both are flat, faint and above the floor, so
    // neither changes a surface, a material or anything about walking on it.
    for (const spot of spread(cornerSpots.concat(edgeSpots), c.fog)) add(groundFog(M, spot.x, spot.z, 70 + rng() * 60));
    for (const spot of spread(edgeSpots.slice().reverse(), c.decay)) add(floorDecay(M, spot.x, spot.z, 34 + rng() * 30));
    for (const spot of spread(cornerSpots, c.scarecrows)) {
      add(scarecrow(M, spot.x, spot.z, 26 + rng() * 6));
      stats.pieces++;
    }

    // ---- hero compositions ---------------------------------------------------------------------------
    if (plan.hero === "hub") add(hubHero(M, floor, rng));
    if (plan.hero === "reception") add(receptionHero(M, floor, rng));
  }

  // ══ THE GLOW PASS: EVERY LIGHT POOL AND HALO COLLAPSED INTO TWO DRAW CALLS ══
  //
  // Measured, not assumed: the first cut cost +927 draw calls over the ordinary office, and almost
  // exactly one per decoration — because every lantern, candle row and lamp carried its OWN floor
  // pool and its own halo quad, and an additive transparent quad cannot be batched with anything.
  //
  // They are all the same two materials and the same unit quad, so they are collapsed here, AFTER
  // the builders have placed them, into one InstancedMesh each. Doing it as a post-process rather
  // than by changing every builder keeps "what a lantern looks like" in one place and "what it
  // costs" in another — and a future season inherits the optimisation for free.
  //
  // NOTHING ABOUT THE LOOK CHANGES. Same positions, same sizes, same materials, same render order.
  // STATIC GEOMETRY FIRST, GLOWS SECOND. The bake merges every opaque prop in the room into one mesh
  // per material; collapsing the glows afterwards then only has the additive quads left to look at.
  stats.baked = bakeStatics(root);
  const instanced = collapseGlows(root, [M.glow, M.glowWarm], "hw");
  for (const mesh of instanced.meshes) root.add(mesh);
  stats.glowInstances = instanced.count;
  stats.glowDrawCalls = instanced.meshes.length;

  // Collect the upright haloes once, rather than traversing the tree every frame.
  billboards.push(...instanced.billboards);
  root.traverse((o) => { if (o.userData.hwBillboard) billboards.push(o); });

  deps.scene.add(root);
  deps.setEnvOverlay(HALLOWEEN_GRADE, HALLOWEEN_AUTO_PHASE);
  deps.invalidateShadows?.();

  let disposed = false;
  return {
    theme: "halloween",
    stats,
    update(camera: THREE.Camera): void {
      if (disposed) return;
      for (const b of billboards) {
        const billboard = b as BillboardTarget;
        if (billboard.hwInstances) billboard.hwInstances(camera.quaternion);
        else b.quaternion.copy(camera.quaternion);
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      deps.setEnvOverlay(null, null);
      root.removeFromParent();
      // GEOMETRY IS OURS AND MUST GO. The materials are disposed once, below, because they are shared
      // by every piece — disposing them per-mesh would free the same object dozens of times.
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      root.clear();
      billboards.length = 0;
      M.dispose();
      deps.invalidateShadows?.();
    },
  };
}

// ---- the rules' own small compositions ----------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A pile, never a single pumpkin: three of different sizes, touching, which is how the reference
 *  stacks them at the foot of every bookcase. */
function clusterAt(spot: Spot, rng: () => number): PumpkinSpec[] {
  const tones: PumpkinSpec["tone"][] = ["pumpkin", "deep", "pale", "cream", "green"];
  return [
    { x: spot.x, z: spot.z, r: 6.2 + rng() * 2, tone: "pumpkin" },
    { x: spot.x + 5.5 + rng() * 2, z: spot.z + 1.5 - rng() * 3, r: 3.1 + rng() * 1.1, tone: tones[Math.floor(rng() * 5)] },
    { x: spot.x - 1.5 + rng() * 3, z: spot.z + 5 + rng() * 2, r: 2.4 + rng() * 1, tone: tones[Math.floor(rng() * 5)] },
  ];
}

/** Three to five candles of staggered heights in a tight group. Uneven heights are the whole read —
 *  a row of identical candles looks like a fence. */
function candleRowAt(spot: Spot, rng: () => number): CandleSpec[] {
  const n = 3 + Math.floor(rng() * 3);
  return Array.from({ length: n }, (_, i) => ({
    x: spot.x + (i - (n - 1) / 2) * (3 + rng() * 1.4),
    z: spot.z + (rng() - 0.5) * 3,
    h: 5 + rng() * 7,
    r: 0.95 + rng() * 0.5,
  }));
}

/** A RISING DIAGONAL up the north wall: the reference's flock reads as bats leaving, which is a
 *  gradient of size and spacing, not a scatter. */
function batSpecs(floor: Rect, n: number, rng: () => number): BatSpec[] {
  const out: BatSpec[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    out.push({
      x: floor.x + floor.w * (0.18 + 0.66 * t) + (rng() - 0.5) * floor.w * 0.1,
      // Rising toward the wall head, never reaching it.
      y: HANG_Y - 4 + t * (WALL_HEAD - HANG_Y - 1) + (rng() - 0.5) * 4,
      z: floor.z + 3.2,
      // Smaller as they go, which is what makes the diagonal read as distance rather than as a line.
      size: 9 - 4.2 * t + rng() * 1.6,
      yaw: 0,
      // Tipped well back toward the office camera so the flock reads from the game view.
      pitch: -0.95 - rng() * 0.25,
      roll: (rng() - 0.5) * 0.9,
    });
  }
  return out;
}

/** CENTRAL HUB — the atrium everybody crosses. A ring of lit lanterns around the open floor and a
 *  dense pumpkin bank on its north edge, so the space reads as decorated from any approach rather
 *  than only from the south. */
function hubHero(M: HalloweenMaterials, floor: Rect, rng: () => number): THREE.Group {
  const g = new THREE.Group();
  g.name = "hw:hero-hub";
  const cx = floor.x + floor.w / 2;
  const cz = floor.z + floor.d / 2;
  const rx = floor.w * 0.36, rz = floor.d * 0.36;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    g.add(jackOLantern(M, cx + Math.cos(a) * rx, cz + Math.sin(a) * rz, 6 + rng() * 2));
  }
  const bank: PumpkinSpec[] = [];
  for (let i = 0; i < 12; i++) {
    bank.push({
      x: floor.x + floor.w * (0.2 + 0.6 * (i / 11)) + (rng() - 0.5) * 6,
      z: floor.z + WALL_HUG + (rng() - 0.5) * 5,
      r: 2.6 + rng() * 3,
      tone: (["pumpkin", "deep", "pale", "cream"] as const)[Math.floor(rng() * 4)],
    });
  }
  g.add(pumpkinCluster(M, bank));
  // THE CENTREPIECE. The hub already has a monument at its middle; the season puts a ring of
  // spectral light and a pair of hovering ghosts over it, so the space everybody crosses has one
  // thing in it you stop and look at. Nothing is placed ON the monument — these hover above and
  // beside it, clear of every walkway and every seat.
  g.add(ghost(M, cx - rx * 0.42, cz - rz * 0.3, 26, 15));
  g.add(ghost(M, cx + rx * 0.42, cz + rz * 0.24, 22, 12));
  g.add(groundFog(M, cx, cz, Math.min(floor.w, floor.d) * 0.85));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(skull(M, cx + Math.cos(a) * rx * 0.55, cz + Math.sin(a) * rz * 0.55, 0, 2.4));
  }
  return g;
}

/** RECEPTION — the first room anybody sees. A flanking pair of big lit lanterns on the approach axis
 *  and a candle bank along the west run, so arriving reads as an entrance rather than a lobby that
 *  happens to have pumpkins in it. */
function receptionHero(M: HalloweenMaterials, floor: Rect, rng: () => number): THREE.Group {
  const g = new THREE.Group();
  g.name = "hw:hero-reception";
  const cx = floor.x + floor.w / 2;
  const zFront = floor.z + floor.d - WALL_HUG - 4;
  g.add(jackOLantern(M, cx - floor.w * 0.2, zFront, 6.6));
  g.add(jackOLantern(M, cx + floor.w * 0.2, zFront, 6.6));
  g.add(lantern(M, cx - floor.w * 0.29, zFront, 0, 13));
  g.add(lantern(M, cx + floor.w * 0.29, zFront, 0, 13));
  const row: CandleSpec[] = Array.from({ length: 7 }, (_, i) => ({
    x: floor.x + WALL_HUG,
    z: floor.z + floor.d * (0.22 + 0.56 * (i / 6)),
    h: 6 + rng() * 8,
    r: 1 + rng() * 0.5,
  }));
  g.add(candles(M, row));
  // THE ENTRANCE STATEMENT. Reception is the first room anybody sees, so it has to land the mood in
  // one look: a pair of scarecrow silhouettes flanking the approach, dead planting where the real
  // lobby keeps its greenery, and fog across the threshold.
  g.add(scarecrow(M, floor.x + WALL_HUG + 2, zFront - 22, 30));
  g.add(scarecrow(M, floor.x + floor.w - WALL_HUG - 2, zFront - 22, 30));
  for (let i = 0; i < 4; i++) {
    g.add(witheredPlant(M, floor.x + floor.w * (0.16 + 0.23 * i), zFront - 6, 13 + rng() * 6, rng));
  }
  g.add(groundFog(M, cx, zFront - 10, floor.w * 0.7));
  return g;
}


// ══════════════════════════════════════════════════════════════════════════════════════════════════
// WHITE CHRISTMAS
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// SAME SHAPE AS HALLOWEEN, DELIBERATELY. One root, one owned material set, geometry placed by the
// shared derived rules, a per-material bake, the glow quads collapsed into instances, an env overlay
// handed to the Environment, and a dispose() that takes all of it away. Nothing about the season
// system learned a second way of doing anything — the only things that differ are WHAT is built and
// WHERE the vocabulary comes from.
//
// THE ONE CAPABILITY CHRISTMAS ADDS: it asks the environment's precipitation channel for SNOW
// (`deps.setSnowfall`). That is a request, not a new system — env/Rain already places its field as
// (camera box − office footprint) decomposed into four strips, so "no snow indoors" is a property of
// where a flake can exist at all, not a per-fragment test, and the office-presentation gate, the
// particle budget and the weather fade all apply to it unchanged.
function buildChristmas(deps: SeasonLayerDeps): BuiltSeasonLayer {
  const root = new THREE.Group();
  root.name = "season:christmas";
  const M = createChristmasMaterials();
  const billboards: THREE.Object3D[] = [];
  const stats = { groups: 0, pieces: 0, bats: 0, swags: 0, glowInstances: 0, glowDrawCalls: 0, baked: 0 };

  const add = (o: THREE.Object3D | null): void => {
    if (!o) return;
    root.add(o);
    stats.groups++;
  };

  // ══ THE FROST SHEEN, FIRST AND UNDERNEATH EVERYTHING ══
  //
  // One quad over the whole floor plate. See christmas/decor.ts's frostCarpet for why this one object
  // is worth more than any hundred props: at the office camera the building is mostly floor, and a
  // floor that stays warm cream keeps the frame reading as the ordinary office whatever is standing
  // on it. It lies at ankle height, writes no depth and hides nothing.
  if (deps.frame) add(frostCarpet(M, deps.frame));

  for (const room of deps.rooms) {
    const plan = WINTER_ROOM_DECOR[room.id] ?? WINTER_DEFAULT_PLAN;
    const d = WINTER_DENSITY[plan.density];
    const c = WINTER_CHARACTER[plan.character];
    // A stable per-room seed, salted differently from Halloween's so the two seasons do not lay their
    // props on exactly the same spots. The same room still decorates identically on every load, which
    // is what makes a before/after screenshot comparison mean anything.
    const rng = xseeded(hash(`${room.id}:winter`));
    const floor = room.floorRect.w > 0 && room.floorRect.d > 0 ? room.floorRect : room.rect;
    const big = Math.min(floor.w, floor.d) > 150;

    const cornerSpots = clearOfDoors(insideFloor(corners(floor, WALL_HUG), floor), deps.doors);
    const edgeSpots = clearOfDoors(insideFloor(wallSpots(floor, 7), floor), deps.doors);
    // TREES GET THEIR OWN, WIDER CORNERS — see christmas/placement.ts for why a tall piece is a corner
    // piece and nothing else.
    const treeSpots = clearOfDoors(insideFloor(corners(floor, TREE_HUG), floor), deps.doors);

    // ---- the trees: the season's signature, in corners only -----------------------------------------
    //
    // SIZED FROM THE FIRST CAPTURE, NOT FROM THE SPEC. At 24–34 units a tree was four white pixels at the
    // office camera and the whole office read as speckle rather than as decoration. A tree has to be an
    // OBJECT at this framing, which at ~2px per world unit means the mid-thirties at minimum, and the
    // ceiling is the 46-unit wall head — nothing may reach it.
    for (const spot of spread(treeSpots, c.trees)) {
      const h = (big ? 34 : 29) + rng() * 8;
      add(snowTree(M, { x: spot.x, z: spot.z, h }, rng));
      stats.pieces++;
      // A pile of white gifts at its foot. Never one box: three sizes, touching, slightly askew.
      add(giftStack(M, giftsAt(spot.x, spot.z, h, rng), rng));
      stats.pieces += 3;
    }

    // ---- the standing lights: lanterns along the wall runs ------------------------------------------
    for (const spot of spread(edgeSpots, d.lanterns)) {
      add(winterLantern(M, spot.x, spot.z, 0, 9 + rng() * 4));
      stats.pieces++;
    }

    // ---- frosted planting where the office keeps live greenery --------------------------------------
    for (const spot of spread(edgeSpots.slice().reverse(), c.branches)) {
      add(frostedBranches(M, spot.x, spot.z, 11 + rng() * 6, rng));
      stats.pieces++;
    }

    // ---- ice crystal in the corners -----------------------------------------------------------------
    for (const spot of spread(cornerSpots.concat(edgeSpots), c.crystals)) {
      add(crystalCluster(M, spot.x + (rng() - 0.5) * 6, spot.z + (rng() - 0.5) * 6, 7 + rng() * 5, rng));
      stats.pieces++;
    }

    // ---- extra gift arrangements away from the trees ------------------------------------------------
    for (const spot of spread(cornerSpots.slice().reverse(), Math.max(0, c.gifts - 2))) {
      add(giftStack(M, giftsAt(spot.x, spot.z, 26, rng), rng));
      stats.pieces += 3;
    }

    // ---- wreaths on the wall faces, well above head height ------------------------------------------
    for (const spot of spread(edgeSpots, c.wreaths)) {
      const { facing } = nearestWall(spot, floor);
      add(wreath(M, spot.x, HANG_Y - 4 + rng() * 5, spot.z, 6 + rng() * 3, facing, rng));
      stats.pieces++;
    }

    // ══ THE HANGING BAND — what turns a decorated room into a transformed one ══
    //
    // The reference's entire upper third is hanging: garland swags, icicles at the ceiling line and a
    // drift of crystal snowflakes at staggered heights. All of it is above HANG_Y, clear of every
    // avatar and nameplate, and below the 46-unit wall head so nothing pokes through a roof.
    const spanX = floor.w >= floor.d;
    for (let i = 0; i < d.garlands; i++) {
      const t = (i + 1) / (d.garlands + 1);
      const y = HANG_Y + 4 + rng() * 3;
      const from = spanX
        ? new THREE.Vector3(floor.x + 2, y, floor.z + floor.d * t)
        : new THREE.Vector3(floor.x + floor.w * t, y, floor.z + 2);
      const to = spanX
        ? new THREE.Vector3(floor.x + floor.w - 2, y, floor.z + floor.d * t)
        : new THREE.Vector3(floor.x + floor.w * t, y, floor.z + floor.d - 2);
      // DROP IS WHAT MAKES A SWAG READ FROM ABOVE. At a 5-unit drop the first capture rendered every
      // garland as a hairline across the room; a swag seen from a 52° look-down is only as visible as
      // it is DEEP, so the band is roughly doubled.
      add(garlandSwag(M, from, to, 6 + rng() * 4, 11 + rng() * 5));
      stats.swags++;
      // Every other span also carries a fairy-light string, hung a little lower so the two read as
      // separate layers rather than as one thick band.
      if (i % 2 === 0) {
        const lift = new THREE.Vector3(0, -7 - rng() * 3, 0);
        add(fairyLightSwag(M, from.clone().add(lift), to.clone().add(lift), 6 + rng() * 4, 10 + Math.floor(rng() * 6), rng));
        stats.swags++;
      }
    }

    // ---- icicles at the wall head, on the runs that are not doorways ---------------------------------
    for (let i = 0; i < d.icicleRuns; i++) {
      const along = i % 2 === 0 ? floor.z + 4 : floor.z + floor.d - 4;
      const t0 = 0.08 + (i >= 2 ? 0.46 : 0);
      add(icicleRun(
        M,
        new THREE.Vector3(floor.x + floor.w * t0, WALL_HEAD - 1.5, along),
        new THREE.Vector3(floor.x + floor.w * (t0 + 0.42), WALL_HEAD - 1.5, along),
        10 + Math.floor(rng() * 6),
        rng,
      ));
      stats.pieces++;
    }

    // ---- the snowflake drift: one instanced mesh for the whole room ----------------------------------
    const flakes = flakeSpecs(floor, d.flakes, rng);
    const drift = snowflakeDrift(M, flakes);
    if (drift) { add(drift); stats.bats += flakes.length; }

    // ---- floor treatments: snow dusting in the corners, sparkle across the boards --------------------
    // Wide and soft rather than small and many: a 40-unit patch is a smudge at the office camera, and
    // a dozen smudges is noise. These are the same quads, spent on fewer, larger washes.
    for (const spot of spread(cornerSpots.concat(edgeSpots), d.drifts)) {
      add(snowDrift(M, spot.x, spot.z, 90 + rng() * 70));
    }
    for (const spot of spread(edgeSpots.slice().reverse(), c.sparkles)) {
      add(sparklePatch(M, spot.x, spot.z, 90 + rng() * 60));
    }

    // ---- hero compositions ---------------------------------------------------------------------------
    if (plan.hero === "hub") add(winterHubHero(M, floor, rng));
    if (plan.hero === "reception") add(winterReceptionHero(M, floor, rng));
  }

  // ══ THE CORRIDORS, AND THE ONE THING HALLOWEEN LEFT UNDONE ══
  //
  // The office's halls are not rooms — they are the space BETWEEN the room rects — so a per-room pass
  // decorates every space in the building except the ones everybody actually walks through. That was
  // the top item on Halloween's deferred list and it is fixed here rather than inherited.
  //
  // The anchors are DERIVED, never typed: a ring of points just OUTSIDE each room's rect, kept only
  // where they are outside every other room too (so they are in the hall), inside the building, and
  // clear of every doorway. That is the hall's own wall line — exactly where a real corridor puts a
  // plant — and it is the one band of a corridor nobody walks down.
  const hall = hallSpots(deps.rooms, deps.doors, deps.frame);
  const hallRng = xseeded(hash("corridors:winter"));
  hall.forEach((spot, i) => {
    if (i % 3 === 0) {
      add(snowTree(M, { x: spot.x, z: spot.z, h: 28 + hallRng() * 7, lit: true }, hallRng));
      stats.pieces++;
    } else if (i % 3 === 1) {
      add(winterLantern(M, spot.x, spot.z, 0, 12 + hallRng() * 4));
      stats.pieces++;
    } else {
      add(frostedBranches(M, spot.x, spot.z, 13 + hallRng() * 6, hallRng));
      stats.pieces++;
    }
    // THE CORRIDOR FLOOR IS THE CORRIDOR. A hall is mostly floor at this camera, so its share of the
    // season has to be carried by what is lying on it — a wide soft drift at every anchor, which is
    // also the one decoration that cannot possibly stand in front of anybody.
    add(snowDrift(M, spot.x, spot.z, 120 + hallRng() * 70));
    if (i % 2 === 0) add(sparklePatch(M, spot.x, spot.z, 130 + hallRng() * 60));
  });

  // ══ THE EXTERIOR: THE SIDEWALK IN FRONT OF RECEPTION ══
  //
  // The only exterior the product view ever shows (render/CameraModes fences the camera to the V1
  // frame, which includes this strip). A stand of snow-covered trees along its SOUTH edge — the far
  // side from the doors — with drifts between them, so arriving at the office is arriving through
  // snow. Nothing is placed in the middle of the walk: the sidewalk is a walkable region.
  if (deps.sidewalk) add(sidewalkStand(M, deps.sidewalk, xseeded(hash("sidewalk:winter")), stats));

  // STATIC GEOMETRY FIRST, GLOWS SECOND — the same order and the same reasons as Halloween's pass.
  stats.baked = bakeStatics(root, "xm");
  const instanced = collapseGlows(root, [M.glow, M.glowWarm], "xm");
  for (const mesh of instanced.meshes) root.add(mesh);
  stats.glowInstances = instanced.count;
  stats.glowDrawCalls = instanced.meshes.length;

  billboards.push(...instanced.billboards);
  root.traverse((o) => { if (o.userData.hwBillboard) billboards.push(o); });

  deps.scene.add(root);
  deps.setEnvOverlay(CHRISTMAS_GRADE, CHRISTMAS_AUTO_PHASE);
  deps.setSnowfall?.({ ...CHRISTMAS_SNOWFALL });
  deps.invalidateShadows?.();

  let disposed = false;
  return {
    theme: "christmas",
    stats,
    update(camera: THREE.Camera): void {
      if (disposed) return;
      for (const b of billboards) {
        const billboard = b as BillboardTarget;
        if (billboard.hwInstances) billboard.hwInstances(camera.quaternion);
        else b.quaternion.copy(camera.quaternion);
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      deps.setEnvOverlay(null, null);
      deps.setSnowfall?.(null);
      root.removeFromParent();
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      root.clear();
      billboards.length = 0;
      M.dispose();
      deps.invalidateShadows?.();
    },
  };
}

// ---- Christmas's own small compositions ----------------------------------------------------------------

/** Three boxes of different sizes at the foot of something, touching and slightly askew. */
function giftsAt(x: number, z: number, h: number, rng: () => number): GiftSpec[] {
  const tones: GiftSpec["tone"][] = ["snow", "pearl", "silver"];
  const s = Math.max(4.5, h * 0.16);
  return [
    { x, z, w: s, h: s * 0.72, tone: "snow" },
    { x: x + s * 0.9 + rng() * 2, z: z + 1.5 - rng() * 3, w: s * 0.66, h: s * 0.56, tone: tones[Math.floor(rng() * 3)] },
    { x: x - 1.5 + rng() * 3, z: z + s * 0.85 + rng() * 2, w: s * 0.54, h: s * 0.44, tone: tones[Math.floor(rng() * 3)] },
  ];
}

/** Which wall a wall-hugging spot belongs to, and the Y rotation that faces a mounted piece INTO the
 *  room from it. Derived from the spot's own distances so it cannot disagree with where it was put. */
function nearestWall(spot: Spot, floor: Rect): { facing: number } {
  const dN = Math.abs(spot.z - floor.z);
  const dS = Math.abs(spot.z - (floor.z + floor.d));
  const dW = Math.abs(spot.x - floor.x);
  const dE = Math.abs(spot.x - (floor.x + floor.w));
  const min = Math.min(dN, dS, dW, dE);
  if (min === dN) return { facing: 0 };
  if (min === dS) return { facing: Math.PI };
  return { facing: min === dW ? Math.PI / 2 : -Math.PI / 2 };
}

/** A DRIFT OF HANGING FLAKES, scattered across the whole ceiling band at staggered heights and sizes.
 *
 *  Unlike the bat flock — which is a rising diagonal up one wall, because bats are LEAVING — snow is
 *  everywhere at once, so this is a spread across the room's whole plan with a depth gradient carried
 *  by size alone. Pitched back toward the camera for the same reason the bats are: a quad hung flat
 *  against the ceiling is edge-on to the office camera and invisible. */
function flakeSpecs(floor: Rect, n: number, rng: () => number): FlakeSpec[] {
  const out: FlakeSpec[] = [];
  // THE BAND A FLAKE MAY OCCUPY, and it is stated in terms of the flake's OWN EXTENT rather than of
  // its centre. A tilted quad reaches roughly 0.72 of its size in every direction from its origin, so
  // placing centres between two heights is not the same as keeping the flakes between them — the
  // first cut did exactly that and put snowflake corners 2 units through the roof.
  const FLOOR_Y = HANG_Y - 6;      // roughly the allowance the bat flock takes below the hanging line
  const CEIL_Y = WALL_HEAD - 0.5;  // and nothing reaches the wall head
  // THE LARGEST FLAKE THE BAND CAN HOLD, derived rather than trusted. A flake wider than the band has
  // no legal centre at all, and the first cut's clamp then pinned it to the band's FLOOR and let its
  // corner punch two units through the roof. Capping the SIZE is the fix, because it makes the
  // invariant hold for any band and any size range somebody picks later.
  const MAX_HALF = (CEIL_Y - FLOOR_Y) / 2;
  for (let i = 0; i < n; i++) {
    // BIGGER THAN THE FIRST CUT. The hanging flakes turned out to be the season's most legible element
    // from the office camera — so they are worth more of the budget each and fewer of them overall.
    const half = Math.min((8 + rng() * 9) * 0.72, MAX_HALF);
    const size = half / 0.72;
    const lo = FLOOR_Y + half;
    const hi = CEIL_Y - half;
    out.push({
      x: floor.x + 8 + rng() * Math.max(1, floor.w - 16),
      y: lo + rng() * Math.max(0, hi - lo),
      z: floor.z + 8 + rng() * Math.max(1, floor.d - 16),
      size,
      yaw: rng() * Math.PI,
      pitch: -0.9 - rng() * 0.35,
      roll: (rng() - 0.5) * 1.2,
    });
  }
  return out;
}

/** THE HALL'S OWN WALL LINE, derived from the room rects rather than typed.
 *
 *  A ring of points offset OUTWARD from every room, kept only where the point is (a) outside every
 *  room — so it is in the hall and not inside the room next door; (b) inside the building frame, so
 *  it is a corridor rather than the street; and (c) clear of every doorway, so nothing is ever parked
 *  where people turn. Then thinned, because the union of eleven rooms' perimeters is far more points
 *  than a corridor wants. */
function hallSpots(rooms: readonly SeasonRoom[], doors: readonly DoorOpening[], frame: Rect | undefined): Spot[] {
  const OUT = 13;              // how far outside a room's rect the hall line sits
  const INSIDE_MARGIN = 3;     // a point this close to a room still counts as that room's own wall
  const out: Spot[] = [];
  for (const room of rooms) {
    const r = room.rect;
    for (const spot of [
      ...[0.22, 0.5, 0.78].map((t) => ({ x: r.x + r.w * t, z: r.z - OUT })),
      ...[0.22, 0.5, 0.78].map((t) => ({ x: r.x + r.w * t, z: r.z + r.d + OUT })),
      ...[0.22, 0.5, 0.78].map((t) => ({ x: r.x - OUT, z: r.z + r.d * t })),
      ...[0.22, 0.5, 0.78].map((t) => ({ x: r.x + r.w + OUT, z: r.z + r.d * t })),
    ]) {
      if (frame && (spot.x < frame.x + 20 || spot.x > frame.x + frame.w - 20 || spot.z < frame.z + 20 || spot.z > frame.z + frame.d - 20)) continue;
      const insideSomeRoom = rooms.some((other) =>
        spot.x > other.rect.x - INSIDE_MARGIN && spot.x < other.rect.x + other.rect.w + INSIDE_MARGIN &&
        spot.z > other.rect.z - INSIDE_MARGIN && spot.z < other.rect.z + other.rect.d + INSIDE_MARGIN);
      if (insideSomeRoom) continue;
      if (out.some((o) => Math.hypot(o.x - spot.x, o.z - spot.z) < 46)) continue; // thin the ring
      out.push(spot);
    }
  }
  return clearOfDoors(out, doors, DOOR_CLEARANCE + 8);
}

/** CENTRAL HUB — the atrium everybody crosses, and the frame a screenshot of "the Christmas office"
 *  is actually a screenshot of.
 *
 *  A RING of snow-covered trees around the open floor with lanterns between them, a crystal ring over
 *  the monument the hub already has at its middle, and a dense fall of hanging flakes over the whole
 *  space. Nothing is placed ON the monument and nothing crosses a walkway: the ring sits at a third of
 *  the floor's radius, which is the band the hub keeps clear of circulation. */
function winterHubHero(M: ChristmasMaterials, floor: Rect, rng: () => number): THREE.Group {
  const g = new THREE.Group();
  g.name = "xm:hero-hub";
  const cx = floor.x + floor.w / 2;
  const cz = floor.z + floor.d / 2;
  const rx = floor.w * 0.37, rz = floor.d * 0.37;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    g.add(snowTree(M, { x: cx + Math.cos(a) * rx, z: cz + Math.sin(a) * rz, h: 33 + rng() * 8 }, rng));
    const b = ((i + 0.5) / 6) * Math.PI * 2 + 0.5;
    g.add(winterLantern(M, cx + Math.cos(b) * rx, cz + Math.sin(b) * rz, 0, 11));
  }
  // THE CENTREPIECE: a ring of ice crystal and a wide sparkle field over the middle, so the space
  // everybody crosses has one thing in it you stop and look at. Both are flat or short; neither
  // stands between anybody and anybody.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(crystalCluster(M, cx + Math.cos(a) * rx * 0.5, cz + Math.sin(a) * rz * 0.5, 9 + rng() * 4, rng));
  }
  g.add(snowDrift(M, cx, cz, Math.min(floor.w, floor.d) * 0.8));
  g.add(sparklePatch(M, cx, cz, Math.min(floor.w, floor.d) * 0.9));
  return g;
}

/** RECEPTION — the first room anybody sees, so it has to land the mood in one look.
 *
 *  A flanking pair of big lit trees on the approach axis, lanterns lining the way in, a wreath over
 *  the threshold and a bank of white gifts along the west run. */
function winterReceptionHero(M: ChristmasMaterials, floor: Rect, rng: () => number): THREE.Group {
  const g = new THREE.Group();
  g.name = "xm:hero-reception";
  const cx = floor.x + floor.w / 2;
  const zFront = floor.z + floor.d - TREE_HUG - 6;
  for (const s of [-1, 1]) {
    g.add(snowTree(M, { x: cx + s * floor.w * 0.24, z: zFront, h: 39 + rng() * 5 }, rng));
    g.add(giftStack(M, giftsAt(cx + s * floor.w * 0.24 + s * 13, zFront + 4, 34, rng), rng));
    g.add(winterLantern(M, cx + s * floor.w * 0.33, zFront, 0, 13));
    g.add(winterLantern(M, cx + s * floor.w * 0.17, zFront - 34, 0, 10));
  }
  g.add(wreath(M, cx, HANG_Y - 2, floor.z + 6, 11, 0, rng));
  for (let i = 0; i < 4; i++) {
    g.add(frostedBranches(M, floor.x + WALL_HUG, floor.z + floor.d * (0.24 + 0.17 * i), 12 + rng() * 6, rng));
  }
  g.add(snowDrift(M, cx, zFront - 12, floor.w * 0.66));
  g.add(sparklePatch(M, cx, zFront - 12, floor.w * 0.7));
  return g;
}

/** THE SIDEWALK STAND: snow-covered trees and drifts along the far edge of the entrance walk.
 *
 *  Pushed to the SOUTH edge — the street side — because the sidewalk is a walkable exterior region
 *  (rooms/ground-floor.ts) and the half of it nearest the doors is the way in. The strip is only a few
 *  tens of units deep, so the trees here are the small ones. */
function sidewalkStand(M: ChristmasMaterials, walk: Rect, rng: () => number, stats: { pieces: number }): THREE.Group {
  const g = new THREE.Group();
  g.name = "xm:exterior";
  // The V1 sidewalk box's top sits a fraction proud of the floor datum (build/floorplan.ts), so the
  // stand is placed at 0 like everything indoors rather than at the exterior grade 40 units away.
  const z = walk.z + walk.d * 0.78;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const x = walk.x + walk.w * ((i + 0.5) / n);
    // NO ROOF OUT HERE, so the exterior trees are the tallest in the season — and they are what makes
    // arriving at the office read as arriving through snow.
    g.add(snowTree(M, { x, z: z + (rng() - 0.5) * 8, h: 36 + rng() * 12 }, rng));
    g.add(snowDrift(M, x, z, 150 + rng() * 80));
    stats.pieces++;
    if (i % 2 === 0) {
      g.add(winterLantern(M, x + walk.w / (n * 2), z - 9, 0, 11));
      stats.pieces++;
    }
  }
  // A continuous dusting along the whole walk, so the ground reads as SNOW-COVERED rather than as
  // paving with trees on it.
  for (let i = 0; i < 9; i++) {
    g.add(snowDrift(M, walk.x + walk.w * ((i + 0.5) / 9), walk.z + walk.d * 0.45, 190 + rng() * 90, 0.6));
  }
  return g;
}

// ---- the glow pass -----------------------------------------------------------------------------

/** An object that knows how to re-billboard a whole InstancedMesh of quads at once. */
type BillboardTarget = THREE.Object3D & { hwInstances?: (q: THREE.Quaternion) => void };

/** Replace every additive glow quad in the tree with two InstancedMeshes.
 *
 *  SEASON-AGNOSTIC BY PARAMETER. The caller names its own additive materials, so a second season
 *  inherits the optimisation without this function learning anything about it.
 *
 *  WHY IT IS SAFE TO DO BY TRAVERSAL. Every glow is a PlaneGeometry on one of the handful of additive
 *  materials passed in, placed in world coordinates by a builder that applies no group
 *  transform — so a mesh's local matrix IS its world matrix, and an instance built from it lands
 *  exactly where the quad was. The two facts are asserted by the layer's own tests rather than
 *  assumed: the collapsed count matches the quad count, and the office still has zero real lights. */
function collapseGlows(
  root: THREE.Object3D,
  glowMaterials: readonly THREE.Material[],
  namePrefix: string,
): { meshes: THREE.InstancedMesh[]; billboards: BillboardTarget[]; count: number } {
  type Entry = { pos: THREE.Vector3; scale: THREE.Vector3; flat: boolean };
  const byMaterial = new Map<THREE.Material, Entry[]>();
  const doomed: THREE.Mesh[] = [];

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.Material;
    if (!glowMaterials.includes(material)) return;
    const geo = mesh.geometry as THREE.PlaneGeometry;
    const w = geo.parameters?.width ?? 1;
    const h = geo.parameters?.height ?? 1;
    const list = byMaterial.get(material) ?? [];
    list.push({
      pos: mesh.position.clone(),
      scale: new THREE.Vector3(w, h, 1),
      // A floor pool was laid flat by its builder; a halo stands up and is billboarded per frame.
      flat: !mesh.userData.hwBillboard,
    });
    byMaterial.set(material, list);
    doomed.push(mesh);
  });

  for (const mesh of doomed) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }

  const meshes: THREE.InstancedMesh[] = [];
  const billboards: BillboardTarget[] = [];
  let count = 0;
  const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

  for (const [material, entries] of byMaterial) {
    for (const flat of [true, false]) {
      const group = entries.filter((e) => e.flat === flat);
      if (group.length === 0) continue;
      // ONE unit quad, shared by every instance. The per-instance scale carries the size the builder
      // asked for, so nothing had to agree on a common size to be batched.
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, group.length);
      const m = new THREE.Matrix4();
      group.forEach((e, i) => m.compose(e.pos, FLAT, e.scale) && mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.renderOrder = 2;
      mesh.frustumCulled = false; // the set spans the building; per-instance culling is not worth it
      mesh.name = flat ? `${namePrefix}:glow-pools` : `${namePrefix}:glow-haloes`;
      if (!flat) {
        // Upright haloes turn to face the camera. Recomposing N matrices is a few microseconds for
        // the couple of hundred instances this office has, and it is EXACT — a single shared
        // rotation would only be right under the orthographic camera.
        const target = mesh as BillboardTarget;
        const scratch = new THREE.Matrix4();
        target.hwInstances = (q: THREE.Quaternion) => {
          group.forEach((e, i) => scratch.compose(e.pos, q, e.scale) && mesh.setMatrixAt(i, scratch));
          mesh.instanceMatrix.needsUpdate = true;
        };
        billboards.push(target);
      }
      meshes.push(mesh);
      count += group.length;
    }
  }
  return { meshes, billboards, count };
}


/** MERGE EVERY STATIC SEASON PROP INTO ONE MESH PER MATERIAL.
 *
 *  THE MEASUREMENT THAT FORCED THIS. Collapsing the glow quads took ~200 draw calls down to four, and
 *  then the haunted vocabulary — withered plants, skulls, ghosts, fog, decay, scarecrows — put more
 *  back than that. Each builder returns its own baked group, so the office was paying roughly one
 *  draw call per DECORATION when it only needs one per MATERIAL.
 *
 *  Nothing here is animated: the season's only moving parts are the billboarded haloes (instanced
 *  and updated by matrix) and the bat flock (already one InstancedMesh). Everything else has sat
 *  still since the moment it was built, which is exactly the precondition for a merge.
 *
 *  SKIPPED, DELIBERATELY: InstancedMesh (already one call, and merging would undo it) and anything
 *  flagged as a billboard (its transform changes every frame). */
function bakeStatics(root: THREE.Object3D, namePrefix = "hw"): number {
  const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    if (mesh.userData.hwBillboard) return;
    const material = mesh.material as THREE.Material;
    if (Array.isArray(mesh.material)) return; // no multi-material prop exists here; refuse rather than guess
    const list = byMaterial.get(material) ?? [];
    list.push(mesh);
    byMaterial.set(material, list);
  });

  let merged = 0;
  for (const [material, meshes] of byMaterial) {
    if (meshes.length < 2) continue; // a lone mesh is already one draw call
    // World transforms are identity for these builders (they measure straight into world space), but
    // `bake` reads each mesh's own matrix anyway, so this stays correct if that ever stops being true.
    for (const mesh of meshes) mesh.updateMatrix();
    const one = bake(meshes, material, `${namePrefix}-baked`);
    if (!one) continue;
    for (const mesh of meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    root.add(one);
    merged++;
  }
  return merged;
}
