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
  CHARACTER, DENSITY, DEFAULT_PLAN, HANG_Y, ROOM_DECOR, WALL_HEAD, WALL_HUG,
  clearOfDoors, corners, insideFloor, spread, wallSpots, type Spot,
} from "./placement";
import type { SeasonLayer, SeasonTheme } from "./season";

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
  /** Called with the overlay to compose onto the resolved weather × phase grade, or null to clear it. */
  setEnvOverlay: (grade: Record<EnvPhase, EnvOverlay> | null, autoPhase: EnvPhase | null) => void;
  /** Ask the renderer to redraw its cached shadow map. Optional so tests need not stub it. */
  invalidateShadows?: () => void;
}

export interface BuiltSeasonLayer extends SeasonLayer {
  /** Per-frame: turns the upright glow haloes to face the camera. Cheap — a handful of quaternion
   *  copies, no traversal, no allocation. */
  update(camera: THREE.Camera): void;
  /** What was built, for the verification readout and the perf comparison. */
  readonly stats: { groups: number; pieces: number; bats: number; swags: number; glowInstances: number; glowDrawCalls: number; baked: number };
}

/** Build and attach the Halloween layer. Returns null for "none" — the ordinary office, undecorated. */
export function createSeasonLayer(theme: SeasonTheme, deps: SeasonLayerDeps): BuiltSeasonLayer | null {
  if (theme !== "halloween") return null;
  return buildHalloween(deps);
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
  const instanced = collapseGlows(root, M);
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

// ---- the glow pass -----------------------------------------------------------------------------

/** An object that knows how to re-billboard a whole InstancedMesh of quads at once. */
type BillboardTarget = THREE.Object3D & { hwInstances?: (q: THREE.Quaternion) => void };

/** Replace every additive glow quad in the tree with two InstancedMeshes.
 *
 *  WHY IT IS SAFE TO DO BY TRAVERSAL. Every glow is a PlaneGeometry on one of exactly two materials
 *  (`M.glow`, `M.glowWarm`), placed in world coordinates by a builder that applies no group
 *  transform — so a mesh's local matrix IS its world matrix, and an instance built from it lands
 *  exactly where the quad was. The two facts are asserted by the layer's own tests rather than
 *  assumed: the collapsed count matches the quad count, and the office still has zero real lights. */
function collapseGlows(
  root: THREE.Object3D,
  M: HalloweenMaterials,
): { meshes: THREE.InstancedMesh[]; billboards: BillboardTarget[]; count: number } {
  type Entry = { pos: THREE.Vector3; scale: THREE.Vector3; flat: boolean };
  const byMaterial = new Map<THREE.Material, Entry[]>();
  const doomed: THREE.Mesh[] = [];

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.Material;
    if (material !== M.glow && material !== M.glowWarm) return;
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
      mesh.name = flat ? "hw:glow-pools" : "hw:glow-haloes";
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
function bakeStatics(root: THREE.Object3D): number {
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
    const one = bake(meshes, material, "hw-baked");
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
