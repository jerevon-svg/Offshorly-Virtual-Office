// vo3d build — THE EXTERIOR WORLD. Everything outside the office: terrain, the street grid, the Offshorly
// campus's own landscaping, the three vacant company parcels, and the distant horizon.
//
// SCENERY ONLY. Not one mesh here is an entity, a region, a footprint or a nav cell. The avatar's world
// still ends at the V1 frame; this is what it looks OUT at.
//
// PERFORMANCE CONTRACT (M1 8GB / 60fps):
//   • ZERO new real-time lights. Every exterior lamp is an emissive mesh plus an additive spill plane,
//     driven as a group by the environment's `practicals` level.
//   • Flat ground (terrain, lawns, roads, paving, markings) is PlaneGeometry and is BAKED with the shared
//     Baker into one mesh per material — the whole ground layer is a handful of draw calls.
//   • Everything repeated (trees, shrubs, lamps, bollards, benches, cars, hills) is ONE InstancedMesh per
//     part, built from a merged low-poly geometry.
//   • Distant scenery is deliberately cruder than near scenery and casts no shadow.
//   • Shadow casting is opt-in and narrow: near trees, benches, cars, lamp posts and the sign only.
//
// MATERIALS. This module owns its OWN material set and never touches render/Materials' shared cache.
// That is what lets the environment darken the whole exterior at night (EnvPreset.exteriorTint) without
// reaching into a single interior material.
import * as THREE from "three";
import { Baker, bake, cyl, rbox, shadowed } from "./helpers";
import { canvas2d } from "../render/Materials";
import {
  CROSSINGS, DROP_OFF, ENTRY_STAIR, ENTRY_X, EXPANSION_LOTS, GRADE, LOTS, MARK_Y, PARK_DRIVE,
  GROVES, PARKING, PAVING_Y, POND, POND_BENCHES, POND_PATH, POND_SHORE, PODIUM, PODIUM_TOP, ROAD_Y, ROADS,
  SIDEWALK_W, SPECIMENS, STALL_BANKS, STALL_D, STALL_W, TREE_LINES, VEHICLES, WALKS, WORLD_CENTRE,
  WORLD_RADIUS, benchSpots, pathLightSpots, roadById, roadRect, streetLightSpots, type VehicleKind,
} from "../world/campus";
import type { Lot } from "../world/campus";
import type { Rect } from "../core/coords";

// ---- palette ----------------------------------------------------------------------------------------
// Sampled to sit with the office's warm cream/olive language rather than fight it: muted greens, a warm
// grey asphalt, bone-coloured paving. Nothing saturated — the building is the subject.
const EX = {
  terrain: 0x81a163, lawn: 0x8cb067, lawnDark: 0x74985a, meadow: 0x9cae6a, pad: 0xa9b489,
  asphalt: 0x585862, asphaltEdge: 0x4a4a53, line: 0xdfd8c6, crossing: 0xe8e2d2,
  paving: 0xcdc5b7, pavingWarm: 0xd8d0c1, curb: 0xb3aca0, soil: 0x5d5545,
  trunk: 0x7b5f45, canopy: 0x568f3c, canopyLight: 0x6fa74a, canopyDeep: 0x40723a, conifer: 0x3f6b4b,
  beltNear: 0x4f7a4c, beltFar: 0x5d8270, hill: 0x6d8f63, hillFar: 0x7e9a84,
  hedge: 0x557a3e, pole: 0x474c53, lamp: 0xffe6bd, bollard: 0xb8b1a6,
  bench: 0xc09a6a, benchFrame: 0x4a4f55, stone: 0x6e6a62, stoneDark: 0xb9b1a3, signPlinth: 0x4c4944, signFace: 0x22302a,
  glass: 0x2a3944, tyre: 0x25262c, water: 0x5f93a8, shore: 0xa79b85,
} as const;

/** Scratch material for geometry construction only. Merging discards per-mesh materials, so the pieces a
 *  variant is assembled from must NOT allocate (or register) real materials — one instanced mesh gets one
 *  material, applied after the merge. */
const TMP = new THREE.MeshStandardMaterial();

/** A material this module owns, remembered with its base colour so the environment can tint it. */
type Tintable = { m: THREE.MeshStandardMaterial; base: THREE.Color };
/** A practical light surface: an emissive fixture or an additive spill plane. */
type Practical = { m: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial; emissive: number; opacity: number };
/** A surface that changes when it is WET. Roughness and environment response only — never colour. */
type Wettable = { m: THREE.MeshStandardMaterial; dryR: number; wetR: number; dryEnv: number; wetEnv: number };

class ExteriorMaterials {
  readonly tintable: Tintable[] = [];
  readonly practicals: Practical[] = [];
  readonly wettable: Wettable[] = [];
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();

  /** a plain, tintable exterior surface */
  surface(hex: number, roughness = 0.95, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const id = `${hex}:${roughness}:${JSON.stringify(extra)}`;
    let m = this.cache.get(id);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: hex, roughness, metalness: 0, ...extra });
      this.cache.set(id, m);
      this.tintable.push({ m, base: new THREE.Color(hex) });
    }
    return m;
  }
  /** The pond. A smooth low-roughness surface with a touch of metalness so the IBL and the sun actually
   *  land on it — that sheen is the whole reason it reads as water and not as blue paint. Tintable like
   *  every other exterior surface, so it goes deep and cold with the rest of the world at night. */
  water(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: EX.water, roughness: 0.08, metalness: 0.35, envMapIntensity: 1.6 });
    this.tintable.push({ m, base: new THREE.Color(EX.water) });
    // THE POND GOES THE OTHER WAY. Rain on still water is a million micro-ripples, so the surface gets
    // ROUGHER, not smoother: the mirror breaks up and the sheen turns from a hard highlight into a broad
    // dull one. Same one-line mechanism as the roads, opposite direction — which is the argument for
    // making wetness a per-material registration rather than one global roughness multiplier.
    this.wettable.push({ m, dryR: 0.08, wetR: 0.34, dryEnv: 1.6, wetEnv: 1.15 });
    return m;
  }
  /** REGISTER A SURFACE AS ONE THAT VISIBLY WETS. Rain drops its roughness and lifts its environment
   *  response, so the sky and the street lamps start to sheen off it — which is the whole read of "wet
   *  asphalt" and costs no new material, no second map and no shader.
   *
   *  COLOUR IS DELIBERATELY UNTOUCHED. Wet ground is also DARKER, but darkening the exterior is already
   *  exteriorTint's job (see env/presets) and the weather grade already pulls it down. Two levers writing
   *  the same colour channel would fight the moment either is re-graded, so wetness owns roughness and
   *  tint owns colour, with no overlap. */
  wet(m: THREE.MeshStandardMaterial, wetRoughness: number, wetEnv = 1.3): THREE.MeshStandardMaterial {
    if (!this.wettable.some((x) => x.m === m)) this.wettable.push({ m, dryR: m.roughness, wetR: wetRoughness, dryEnv: m.envMapIntensity, wetEnv });
    return m;
  }
  /** Re-declare a registered material's tint base (used where a canvas map supplies the colour). */
  setBase(m: THREE.MeshStandardMaterial, hex: number): void {
    const t = this.tintable.find((x) => x.m === m);
    if (t) t.base.setHex(hex);
  }
  /** faceted low-poly foliage/rock */
  facet(hex: number, roughness = 0.9): THREE.MeshStandardMaterial {
    return this.surface(hex, roughness, { flatShading: true });
  }
  /** a lamp lens / lit sign face: tintable like any other surface, but its EMISSIVE is owned by the
   *  practicals level so the fixture is genuinely off at midday and genuinely lit at night */
  lamp(hex: number, emissive: number, emissiveHex = hex): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: hex, emissive: emissiveHex, emissiveIntensity: 0, roughness: 0.4, metalness: 0 });
    this.tintable.push({ m, base: new THREE.Color(hex) });
    this.practicals.push({ m, emissive, opacity: 0 });
    return m;
  }
  /** the additive spill under a fixture — invisible by day, a pool of warm light after dusk */
  spill(hex: number, opacity: number): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color: hex, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.practicals.push({ m, emissive: 0, opacity });
    return m;
  }
}

// ---- flat ground helpers ------------------------------------------------------------------------------
function flat(w: number, d: number, m: THREE.Material, cx: number, y: number, cz: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, y, cz);
  return shadowed(mesh, false, true);
}
const flatRect = (r: Rect, m: THREE.Material, y: number): THREE.Mesh => flat(r.w, r.d, m, r.x + r.w / 2, y, r.z + r.d / 2);

/** A light POOL: an additive disc whose brightness falls off to nothing at the rim. CircleGeometry's
 *  first vertex is its centre, so one vertex-colour attribute (white centre → black rim) turns a hard
 *  additive disc into a soft pool — no texture, no shader, no extra draw call. */
function poolDisc(radius: number, segments: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(radius, segments).rotateX(-Math.PI / 2);
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  col[0] = col[1] = col[2] = 1; // the centre vertex; every rim vertex stays at 0
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/** Merge a set of meshes into ONE geometry (for an InstancedMesh). Reuses the build-time baker. */
function mergedGeo(meshes: THREE.Mesh[]): THREE.BufferGeometry {
  const one = bake(meshes, meshes[0].material as THREE.Material);
  if (!one) throw new Error("exterior: merge failed");
  return one.geometry;
}
/** Place instances from a list of (x, z, yaw, scale) records. */
type Spot = { x: number; z: number; yaw?: number; s?: number; y?: number };
function instance(geo: THREE.BufferGeometry, m: THREE.Material, spots: Spot[], cast: boolean, name: string, colours?: number[]): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, m, spots.length);
  im.name = name;
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  const col = new THREE.Color();
  spots.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw ?? 0);
    pos.set(s.x, s.y ?? GRADE, s.z);
    sc.setScalar(s.s ?? 1);
    im.setMatrixAt(i, mtx.compose(pos, q, sc));
    if (colours) im.setColorAt(i, col.setHex(colours[i % colours.length]));
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = cast;
  im.receiveShadow = true;
  im.frustumCulled = false; // one draw call either way; culling a world-spanning instance set never helps
  return im;
}

// ---- deterministic scatter ----------------------------------------------------------------------------
// Its own LCG, NOT build/helpers' shared seed: the exterior must never shift a room's procedural detail by
// consuming random numbers from the same stream.
let xseed = 20260913;
const rx = (): number => ((xseed = (xseed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const resetScatter = (): void => void (xseed = 20260913);

// ---- repeated pieces ----------------------------------------------------------------------------------
const ico = (r: number, detail = 0) => new THREE.IcosahedronGeometry(r, detail);
function blob(m: THREE.Material, x: number, y: number, z: number, rxs: number, ry = rxs, rzs = rxs): THREE.Mesh {
  const mesh = new THREE.Mesh(ico(1), m);
  mesh.scale.set(rxs, ry, rzs);
  mesh.position.set(x, y, z);
  return shadowed(mesh);
}

/** Three broadleaf silhouettes + one conifer. Each returns trunk geometry and canopy geometry separately
 *  so a variant costs exactly two instanced draw calls however many of it stand in the world. */
function treeGeos(): Record<string, { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry }> {
  const round = {
    trunk: mergedGeo([cyl(4.4, 30, TMP, 0, 0, 0, 3.4)]),
    canopy: mergedGeo([blob(TMP, 0, 46, 0, 26, 22, 26), blob(TMP, -14, 58, 5, 16), blob(TMP, 13, 56, -6, 15), blob(TMP, 2, 68, 3, 12)]),
  };
  const tall = {
    trunk: mergedGeo([cyl(3.6, 46, TMP, 0, 0, 0, 2.8)]),
    canopy: mergedGeo([blob(TMP, 0, 58, 0, 17, 26, 17), blob(TMP, 0, 78, 0, 13, 18, 13), blob(TMP, 1, 94, -1, 9, 11, 9)]),
  };
  const broad = {
    trunk: mergedGeo([cyl(5.2, 22, TMP, 0, 0, 0, 4)]),
    canopy: mergedGeo([blob(TMP, 0, 36, 0, 31, 17, 29), blob(TMP, -16, 44, -8, 17, 12, 17), blob(TMP, 17, 43, 8, 16, 12, 16)]),
  };
  const cone = (r: number, h: number, y: number) => { const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), TMP); c.position.y = y; return shadowed(c); };
  const conifer = {
    trunk: mergedGeo([cyl(3, 20, TMP, 0, 0, 0, 2.4)]),
    canopy: mergedGeo([cone(20, 34, 32), cone(15, 28, 52), cone(10, 24, 70)]),
  };
  return { round, tall, broad, conifer };
}

function shrubGeo(): THREE.BufferGeometry {
  return mergedGeo([blob(TMP, 0, 8, 0, 13, 10, 13), blob(TMP, 7, 13, -4, 8), blob(TMP, -6, 12, 5, 7)]);
}

/** A stylized parked car: one body geometry (per-instance colour) + one dark geometry (glass + tyres). */
function carGeos(): { body: THREE.BufferGeometry; dark: THREE.BufferGeometry } {
  const body = mergedGeo([rbox(46, 16, 104, TMP, 0, 8, 0, 5, 1), rbox(40, 15, 50, TMP, 0, 23, -4, 5, 1)]);
  const wheels = [-18, 18].flatMap((x) => [-34, 34].map((z) => { const w = cyl(9, 7, TMP, x, 0, z); w.rotation.z = Math.PI / 2; w.position.y = 9; return w; }));
  const dark = mergedGeo([
    rbox(37, 11, 20, TMP, 0, 25, -22, 3, 1), // windscreen band
    rbox(37, 11, 16, TMP, 0, 25, 12, 3, 1), // rear glass
    ...wheels,
  ]);
  return { body, dark };
}

/** The pond outline: a closed catmull-rom through eight radii-jittered points, so the water reads as a
 *  landscaped body rather than a stamped ellipse. `grow` scales it for the shore band. Deterministic. */
function pondShape(grow: number): THREE.Shape {
  const pts: THREE.Vector2[] = [];
  const wob = [1.0, 0.86, 1.08, 0.92, 1.04, 0.82, 1.1, 0.9];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push(new THREE.Vector2(Math.cos(a) * POND.rx * grow * wob[i], Math.sin(a) * POND.rz * grow * wob[(i + 3) % 8]));
  }
  const curve = new THREE.SplineCurve(pts);
  const sh = new THREE.Shape();
  const n = 64;
  for (let i = 0; i <= n; i++) {
    // SplineCurve is open; wrapping the sample index closes the loop smoothly
    const p = curve.getPoint((i % n) / n);
    if (i === 0) sh.moveTo(p.x, p.y); else sh.lineTo(p.x, p.y);
  }
  sh.closePath();
  return sh;
}

/** THE JEEPNEY. Silhouette first: a long flat-roofed passenger cabin, a short snouted bonnet, the roof
 *  rack, and the deep chrome front bar. No livery, no detailing — it has to read at diorama scale. */
function jeepneyGeos(): { body: THREE.BufferGeometry; dark: THREE.BufferGeometry } {
  const body = mergedGeo([
    rbox(56, 44, 150, TMP, 0, 16, 14, 4, 1), //   passenger cabin
    rbox(60, 5, 158, TMP, 0, 60, 12, 2, 1), //    flat roof, slightly proud of the body
    rbox(46, 9, 58, TMP, 0, 65, 26, 2, 1), //     roof rack
    rbox(50, 28, 50, TMP, 0, 16, -78, 4, 1), //   bonnet
    rbox(54, 11, 10, TMP, 0, 10, -102, 3, 1), //  front bar
    rbox(8, 22, 8, TMP, -20, 42, -104, 2, 1), //  the two bonnet-top mirrors/lamps
    rbox(8, 22, 8, TMP, 20, 42, -104, 2, 1),
  ]);
  const wheels = [-29, 29].flatMap((x) => [-70, 48].map((z) => { const w = cyl(16, 10, TMP, x, 0, z); w.rotation.z = Math.PI / 2; w.position.y = 16; return w; }));
  const dark = mergedGeo([
    rbox(50, 26, 6, TMP, 0, 28, -56, 2, 1), //    windscreen
    rbox(6, 24, 140, TMP, -28.5, 26, 16, 2, 1), // the long open side openings
    rbox(6, 24, 140, TMP, 28.5, 26, 16, 2, 1),
    ...wheels,
  ]);
  return { body, dark };
}

/** THE TRICYCLE. A small motorcycle with a roofed sidecar bolted to its right — the read is the roof
 *  overhanging one wheel while the bike leans out the other side. */
function tricycleGeos(): { body: THREE.BufferGeometry; dark: THREE.BufferGeometry } {
  const body = mergedGeo([
    rbox(32, 32, 70, TMP, 20, 12, 2, 5, 1), //    sidecar cab
    rbox(36, 5, 62, TMP, 20, 48, 0, 2, 1), //     its roof — over the SIDECAR only, so the bike reads
    rbox(4, 16, 4, TMP, 6, 32, -26, 1, 1), //     roof stanchions
    rbox(4, 16, 4, TMP, 6, 32, 26, 1, 1),
    rbox(15, 15, 30, TMP, -16, 21, 2, 4, 1), //   the bike's tank + seat, clear of the roof
    rbox(11, 13, 14, TMP, -16, 23, -20, 3, 1), // its headstock
    rbox(26, 5, 6, TMP, -16, 36, -24, 2, 1), //   handlebars
  ]);
  const wheels = [
    { x: -16, z: -32 }, { x: -16, z: 28 }, { x: 30, z: 24 },
  ].map((w) => { const m = cyl(12, 6, TMP, w.x, 0, w.z); m.rotation.z = Math.PI / 2; m.position.y = 12; return m; });
  const dark = mergedGeo([rbox(28, 18, 4, TMP, 20, 22, -34, 2, 1), ...wheels]);
  return { body, dark };
}

/** A MOTORCYCLE: tank, seat, two wheels, a fork. Small enough that anything more would be invisible. */
function motorcycleGeos(): { body: THREE.BufferGeometry; dark: THREE.BufferGeometry } {
  const body = mergedGeo([
    rbox(15, 17, 40, TMP, 0, 20, -2, 4, 1), // tank + seat mass
    rbox(19, 4, 7, TMP, 0, 38, -26, 2, 1), //  handlebars
    rbox(8, 20, 7, TMP, 0, 18, -28, 2, 1), //  fork
  ]);
  const wheels = [-32, 28].map((z) => { const w = cyl(11, 5, TMP, 0, 0, z); w.rotation.z = Math.PI / 2; w.position.y = 11; return w; });
  return { body, dark: mergedGeo(wheels) };
}

/** A street lamp: post + arm + head (one geometry), and its lens (a second, emissive). */
function lampGeos(): { post: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const post = mergedGeo([
    cyl(5.5, 5, TMP, 0, 0, 0),
    cyl(3.4, 128, TMP, 0, 4, 0, 2.6),
    rbox(4, 4, 40, TMP, 0, 128, -18, 1.4, 1),
    rbox(13, 6, 30, TMP, 0, 122, -34, 2.4, 1),
  ]);
  const lens = mergedGeo([rbox(10, 2.4, 24, TMP, 0, 120.4, -34, 1, 1)]);
  return { post, lens };
}

function bollardGeos(): { post: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  return {
    post: mergedGeo([cyl(6, 3, TMP, 0, 0, 0), cyl(4.4, 30, TMP, 0, 2, 0), cyl(5.4, 3, TMP, 0, 35, 0)]),
    lens: mergedGeo([cyl(4.6, 4, TMP, 0, 31, 0)]),
  };
}

function benchGeos(): { wood: THREE.BufferGeometry; frame: THREE.BufferGeometry } {
  const slats = [-9, -2.5, 4].map((z) => rbox(74, 3, 5.5, TMP, 0, 18, z, 1.2, 1));
  const back = [24, 30].map((y) => rbox(74, 4.5, 3, TMP, 0, y, 7.5, 1.2, 1));
  return {
    wood: mergedGeo([...slats, ...back]),
    frame: mergedGeo([rbox(5, 18, 26, TMP, -32, 0, -2, 1.2, 1), rbox(5, 18, 26, TMP, 32, 0, -2, 1.2, 1), rbox(5, 18, 3.4, TMP, -32, 18, 7.5, 1, 1), rbox(5, 18, 3.4, TMP, 32, 18, 7.5, 1, 1)]),
  };
}

// ---- the build ----------------------------------------------------------------------------------------
export type ExteriorScenery = {
  root: THREE.Group;
  /** multiply every exterior surface's base colour (EnvPreset.exteriorTint) */
  applyTint(t: number): void;
  /** 0 = practicals dark, 1 = full (EnvPreset.practicals) */
  applyPracticals(level: number): void;
  /** 0 = bone dry, 1 = soaked. Roughness/env response only — colour stays with applyTint. */
  applyWetness(w: number): void;
  stats: { draws: number; instanced: number; instances: number; trees: number; vehicles: number };
};

export function buildExterior(): ExteriorScenery {
  resetScatter();
  const M = new ExteriorMaterials();
  const root = new THREE.Group();
  root.name = "exterior-world";

  const ground = new Baker();
  const terrainM = M.surface(EX.terrain), lawnM = M.surface(EX.lawn), lawnDarkM = M.surface(EX.lawnDark);
  const meadowM = M.surface(EX.meadow), padM = M.surface(EX.pad);
  // THE WET SET: everything a shower actually pools on. Asphalt goes furthest (a wet road is nearly a
  // mirror), paving is restrained, the curb barely moves. Lawns, soil and planting are NOT registered —
  // grass does not gloss, and making it do so is the single fastest way to make rain look like plastic.
  const roadM = M.wet(M.surface(EX.asphalt, 0.85), 0.3, 1.45), lineM = M.wet(M.surface(EX.line, 0.7), 0.34, 1.3), crossM = M.wet(M.surface(EX.crossing, 0.7), 0.34, 1.3);
  const pavingM = M.wet(M.surface(EX.paving, 0.9), 0.46, 1.25), pavingWarmM = M.wet(M.surface(EX.pavingWarm, 0.88), 0.46, 1.25), curbM = M.wet(M.surface(EX.curb, 0.85), 0.6, 1.15);
  const soilM = M.surface(EX.soil, 1);

  // 1. TERRAIN. One disc, wide enough that no normal gameplay view — at any rotation, at the widest
  //    zoom — can see its edge. Rings of distant planting sit inside it, so the silhouette reads as
  //    countryside rather than as a plate.
  const terrain = new THREE.Mesh(new THREE.CircleGeometry(WORLD_RADIUS, 56), terrainM);
  terrain.rotation.x = -Math.PI / 2;
  // BELOW the carriageway, not above it: the roads are already a curb below the lawn (ROAD_Y), so a
  // terrain plate at grade would bury them. Kept close (2.6 units under a 1244-unit floor) so the step
  // where a lot's lawn meets open country is invisible at gameplay pitch.
  terrain.position.set(WORLD_CENTRE.x, ROAD_Y - 1, WORLD_CENTRE.z);
  root.add(shadowed(terrain, false, true));

  // 2. LOTS. Every parcel gets its lawn first; paving is laid over it afterwards.
  for (const lot of LOTS) ground.add(flatRect(lot.rect, lot.kind === "field" ? meadowM : lot.id === "lot-offshorly" ? lawnM : lawnDarkM, GRADE));

  // 3. THE STREET GRID. Carriageway, curb band, sidewalks, centre dashes; then the crossings on top.
  for (const r of ROADS) {
    const rect = roadRect(r);
    ground.add(flatRect(rect, roadM, ROAD_Y));
    for (const side of [-1, 1] as const) {
      const at = r.at + (side * (r.width + SIDEWALK_W)) / 2;
      const walk: Rect = r.axis === "x"
        ? { x: r.from, z: at - SIDEWALK_W / 2, w: r.to - r.from, d: SIDEWALK_W }
        : { x: at - SIDEWALK_W / 2, z: r.from, w: SIDEWALK_W, d: r.to - r.from };
      ground.add(flatRect(walk, pavingM, PAVING_Y));
      const curbAt = r.at + (side * r.width) / 2;
      const curb: Rect = r.axis === "x"
        ? { x: r.from, z: curbAt - 5, w: r.to - r.from, d: 10 }
        : { x: curbAt - 5, z: r.from, w: 10, d: r.to - r.from };
      ground.add(flatRect(curb, curbM, GRADE + 0.1));
    }
    // dashed centre line
    for (let t = r.from + 60; t < r.to; t += 180) {
      const seg: Rect = r.axis === "x" ? { x: t, z: r.at - 2, w: 84, d: 4 } : { x: r.at - 2, z: t, w: 4, d: 84 };
      ground.add(flatRect(seg, lineM, MARK_Y));
    }
  }
  for (const c of CROSSINGS) {
    const r = roadById(c.roadId);
    for (let i = -3; i <= 3; i++) {
      const off = i * 18;
      const stripe: Rect = r.axis === "x"
        ? { x: c.at + off - 6, z: r.at - r.width / 2, w: 12, d: r.width }
        : { x: r.at - r.width / 2, z: c.at + off - 6, w: r.width, d: 12 };
      ground.add(flatRect(stripe, crossM, MARK_Y + 0.06));
    }
  }

  // 4. THE OFFSHORLY CAMPUS. Perimeter walk, podium skirt, entry stair, drop-off, parking.
  for (const w of [...WALKS, POND_PATH]) ground.add(flatRect(w, pavingM, PAVING_Y));
  ground.add(flatRect(DROP_OFF, pavingWarmM, PAVING_Y));
  ground.add(flatRect(PARK_DRIVE, roadM, PAVING_Y - 0.3));
  ground.add(flatRect(PARKING, roadM, PAVING_Y - 0.3));
  // stall lines: two rows either side of the central aisle
  const stalls = Math.floor(PARKING.d / STALL_W);
  for (const bank of STALL_BANKS)
    for (let i = 0; i <= stalls; i++)
      ground.add(flatRect({ x: bank.x, z: PARKING.z + i * STALL_W - 1.5, w: STALL_D, d: 3 }, lineM, PAVING_Y - 0.18));
  // The podium skirt: a slightly wider base band UNDER the V1 plinth (whose own base is exactly at GRADE),
  // so the office reads as sitting IN the site rather than resting on it. It must stay entirely below
  // grade — anything above it would cover the ground floor it is supposed to support.
  const skirt = rbox(PODIUM.w + 26, 4.8, PODIUM.d + 26, M.surface(EX.stoneDark, 0.9), PODIUM.x + PODIUM.w / 2, GRADE - 5, PODIUM.z + PODIUM.d / 2, 2, 1);
  root.add(shadowed(skirt, false, true));
  // The entry stair down to the drop-off: SOLID treads. A flat plane at tread height has nothing beneath
  // it and reads as a floating slab the moment the camera rotates, so each step is a box standing on grade.
  const treads = 4;
  const stairM = M.surface(EX.pavingWarm, 0.88);
  for (let i = 0; i < treads; i++) {
    const top = PODIUM_TOP - ((i + 1) * (PODIUM_TOP - GRADE)) / treads;
    const z0 = ENTRY_STAIR.z + (i * ENTRY_STAIR.d) / treads;
    const step = rbox(ENTRY_STAIR.w + i * 22, top - GRADE + 1, ENTRY_STAIR.d - (i * ENTRY_STAIR.d) / treads + 16, stairM, ENTRY_STAIR.x + ENTRY_STAIR.w / 2, GRADE - 1, z0 + (ENTRY_STAIR.d - (i * ENTRY_STAIR.d) / treads + 16) / 2, 1.2, 1);
    root.add(shadowed(step, false, true));
  }

  // 5. PLANTING BEDS along the podium and the drop-off.
  const beds: Rect[] = [
    { x: ENTRY_X - 470, z: PODIUM.z + PODIUM.d + 8, w: 190, d: 62 },
    { x: ENTRY_X + 280, z: PODIUM.z + PODIUM.d + 8, w: 190, d: 62 },
    { x: PODIUM.x - 132, z: 180, w: 66, d: 420 },
    { x: PODIUM.x - 132, z: 700, w: 66, d: 420 },
    { x: PODIUM.x + PODIUM.w + 66, z: 260, w: 66, d: 700 },
    { x: 260, z: PODIUM.z - 132, w: 900, d: 66 },
  ];
  for (const b of beds) ground.add(flatRect(b, soilM, GRADE + 0.5));

  // 6. THE VACANT PARCELS. Each one reads as intentional, maintained, open land waiting for a campus:
  //    a mown pad set back from its frontage, a service drive stub off the road it fronts, a hedge line
  //    along the street and groves in the back corners. No building, no sign, no "for sale" language.
  for (const lot of EXPANSION_LOTS) {
    const r = lot.rect;
    const inset = 190;
    ground.add(flatRect({ x: r.x + inset, z: r.z + inset, w: r.w - 2 * inset, d: r.d - 2 * inset }, padM, GRADE + 0.12));
    const stub: Rect =
      lot.frontage === "north" ? { x: r.x + r.w / 2 - 70, z: r.z, w: 140, d: inset }
      : lot.frontage === "west" ? { x: r.x, z: r.z + r.d / 2 - 70, w: inset, d: 140 }
      : { x: r.x + r.w - inset, z: r.z + r.d / 2 - 70, w: inset, d: 140 };
    ground.add(flatRect(stub, roadM, PAVING_Y - 0.3));
  }
  const groundDraws = ground.bakeInto(root, "exterior-ground");

  // 7. PLANTING — COMPOSED, NOT SCATTERED. Every tree comes from world/campus's TREE_LINES, GROVES or
  //    SPECIMENS: tidy rows on the four stretches that frame the block, a handful of organic clusters, a
  //    few feature trees, and large areas of grass left deliberately empty. Nothing is distributed
  //    uniformly across a field any more. Everything below is instanced.
  const trees = treeGeos();
  const treeSpots: Record<string, Spot[]> = { round: [], tall: [], broad: [], conifer: [] };
  const jitter = (n: number) => (rx() - 0.5) * n;
  // ROWS: evenly spaced, barely jittered — a planted verge should read as planted, not as undergrowth
  for (const line of TREE_LINES) {
    for (let t = line.from; t <= line.to; t += line.spacing) {
      const s2 = 0.92 + rx() * 0.16, yaw = rx() * 6.28;
      treeSpots[line.kind].push(line.axis === "x" ? { x: t, z: line.at + jitter(8), s: s2, yaw } : { x: line.at + jitter(8), z: t, s: s2, yaw });
    }
  }
  // GROVES: densest at the centre (sqrt keeps the cluster from reading as a ring) and thinning outward
  for (const g of GROVES) {
    for (let i = 0; i < g.count; i++) {
      const a = rx() * Math.PI * 2, rr = Math.sqrt(rx());
      treeSpots[g.kind].push({ x: g.x + Math.cos(a) * g.rx * rr, z: g.z + Math.sin(a) * g.rz * rr, s: 0.82 + rx() * 0.5, yaw: rx() * 6.28 });
    }
  }
  for (const sp of SPECIMENS) treeSpots[sp.kind].push({ x: sp.x, z: sp.z, s: sp.s, yaw: rx() * 6.28 });

  let instanced = 0, instances = 0;
  // One canopy TONE per variant: merging discards per-blob materials, so variety comes from the four
  // silhouettes and their four greens rather than from per-leaf colour. That is the price of one draw call
  // per variant part, and at diorama scale it reads as a mixed planting.
  const CANOPY_TONE: Record<string, number> = { round: EX.canopy, tall: EX.canopyLight, broad: EX.canopyDeep, conifer: EX.conifer };
  const addPair = (geos: { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry }, spots: Spot[], kind: string) => {
    if (!spots.length) return;
    root.add(instance(geos.trunk, M.facet(EX.trunk, 0.95), spots, true, `tree-${kind}-trunk`));
    root.add(instance(geos.canopy, M.facet(CANOPY_TONE[kind]), spots, true, `tree-${kind}-canopy`));
    instanced += 2;
    instances += spots.length * 2;
  };
  addPair(trees.round, treeSpots.round, "round");
  addPair(trees.tall, treeSpots.tall, "tall");
  addPair(trees.broad, treeSpots.broad, "broad");
  addPair(trees.conifer, treeSpots.conifer, "conifer");
  const treeCount = Object.values(treeSpots).reduce((n, l) => n + l.length, 0);

  // SHRUBS: the campus's own beds, the pond shore, the parking screen, and a SHORT hedge marking the
  //   centre of each vacant parcel's frontage — enough to say "maintained", far short of edging the plot.
  const shrubs: Spot[] = [];
  for (const b of beds) for (let i = 0; i < Math.max(4, Math.round((b.w * b.d) / 3600)); i++) shrubs.push({ x: b.x + 14 + rx() * (b.w - 28), z: b.z + 14 + rx() * (b.d - 28), s: 0.8 + rx() * 0.5, yaw: rx() * 6.28 });
  for (const lot of EXPANSION_LOTS) {
    const r = lot.rect, n = 9;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1) - 0.5) * 0.42; // the middle 42% of the frontage only
      if (lot.frontage === "north") shrubs.push({ x: r.x + r.w * (0.5 + t), z: r.z + 46 + jitter(10), s: 0.7 + rx() * 0.3, yaw: rx() * 6.28 });
      else if (lot.frontage === "west") shrubs.push({ x: r.x + 46 + jitter(10), z: r.z + r.d * (0.5 + t), s: 0.7 + rx() * 0.3, yaw: rx() * 6.28 });
      else shrubs.push({ x: r.x + r.w - 46 + jitter(10), z: r.z + r.d * (0.5 + t), s: 0.7 + rx() * 0.3, yaw: rx() * 6.28 });
    }
  }
  for (let z = PARKING.z; z < PARKING.z + PARKING.d; z += 76) shrubs.push({ x: PARKING.x - 30 + jitter(10), z, s: 0.75 + rx() * 0.3, yaw: rx() * 6.28 });
  // reeds around the pond: three short arcs, not a continuous fringe
  for (const [a0, a1] of [[0.3, 1.15], [2.5, 3.2], [4.3, 5.1]] as const)
    for (let i = 0; i < 7; i++) {
      const a = a0 + (a1 - a0) * (i / 6);
      shrubs.push({ x: POND.x + Math.cos(a) * (POND.rx + 16), z: POND.z + Math.sin(a) * (POND.rz + 14), s: 0.5 + rx() * 0.28, yaw: rx() * 6.28 });
    }
  root.add(instance(shrubGeo(), M.facet(EX.hedge), shrubs, true, "shrubs"));
  instanced++; instances += shrubs.length;

  // 7b. THE POND. The one water feature in the world: an organic body of water on the Offshorly lot's
  //     north lawn, with a shallow shore band, a short path spur and two benches looking over it. The rest
  //     of that lawn is left as open grass on purpose — this is the only thing out there.
  //     BOTH PLANES SIT ABOVE GRADE. The lot's lawn is one unbroken plane at GRADE, so water sunk below
  //     it is simply covered — the lawn has no hole to sink into. Stacking the shore just proud of the
  //     grass and the water just proud of the shore gives the same read (a rimmed body of water) with no
  //     geometry surgery, which is also how the reflecting-pool version of this brief would be built.
  const shore = new THREE.Mesh(new THREE.ShapeGeometry(pondShape(1 + POND_SHORE / POND.rx), 1), M.surface(EX.shore, 0.98));
  shore.rotation.x = -Math.PI / 2;
  shore.position.set(POND.x, GRADE + 0.3, POND.z);
  root.add(shadowed(shore, false, true));
  const pond = new THREE.Mesh(new THREE.ShapeGeometry(pondShape(1), 1), M.water());
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(POND.x, GRADE + 0.55, POND.z);
  root.add(shadowed(pond, false, false));

  // 8. THE HORIZON. Two belts of distant planting and a low hill line — cruder geometry, no shadows,
  //    placed so the world never presents a hard edge or an empty void at the widest gameplay zoom.
  const belt: Spot[] = [];
  for (const [radius, count, spread] of [[4000, 190, 300], [4620, 150, 320]] as const) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rx() * 0.03;
      const rr = radius + (rx() - 0.5) * spread;
      belt.push({ x: WORLD_CENTRE.x + Math.cos(a) * rr, z: WORLD_CENTRE.z + Math.sin(a) * rr, s: 1.1 + rx() * 0.9, yaw: rx() * 6.28 });
    }
  }
  const beltGeo = mergedGeo([blob(TMP, 0, 26, 0, 26, 30, 26), blob(TMP, 14, 44, -8, 15)]);
  root.add(instance(beltGeo, M.facet(EX.beltNear), belt, false, "distant-belt"));
  instanced++; instances += belt.length;
  const hills: Spot[] = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rx() * 0.12;
    const rr = 4950 + rx() * 320;
    hills.push({ x: WORLD_CENTRE.x + Math.cos(a) * rr, z: WORLD_CENTRE.z + Math.sin(a) * rr, s: 1, yaw: rx() * 6.28, y: GRADE - 60 });
  }
  const hillGeo = mergedGeo([blob(TMP, 0, 0, 0, 520, 190, 460)]);
  root.add(instance(hillGeo, M.facet(EX.hillFar), hills, false, "distant-hills"));
  instanced++; instances += hills.length;

  // 9. THE TRANSPORT MIX. Cars, one jeepney, two tricycles and three motorcycles — eleven vehicles in
  //    total, each placed BY HAND in world/campus's VEHICLES table. Stylized miniatures: the brief is a
  //    recognisable SILHOUETTE at diorama scale, not a model. Static; no traffic, no pedestrians.
  //    Two instanced meshes per kind (painted body with per-instance colour, one dark set for glass,
  //    tyres and trim), so the whole fleet is eight draw calls however many are parked.
  const VEHICLE_GEOS: Record<VehicleKind, { body: THREE.BufferGeometry; dark: THREE.BufferGeometry }> = {
    car: carGeos(), jeepney: jeepneyGeos(), tricycle: tricycleGeos(), motorcycle: motorcycleGeos(),
  };
  const bodyMat = M.surface(0xffffff, 0.45);
  const darkMat = M.surface(EX.glass, 0.35);
  for (const kind of ["car", "jeepney", "tricycle", "motorcycle"] as VehicleKind[]) {
    const picks = VEHICLES.filter((v) => v.kind === kind);
    if (!picks.length) continue;
    const spots: Spot[] = picks.map((v) => ({ x: v.x, z: v.z, yaw: v.yaw }));
    root.add(instance(VEHICLE_GEOS[kind].body, bodyMat, spots, true, `${kind}-body`, picks.map((v) => v.colour)));
    root.add(instance(VEHICLE_GEOS[kind].dark, darkMat, spots, false, `${kind}-dark`));
    instanced += 2; instances += spots.length * 2;
  }

  // 9b. FUTURE COMPANY LOT MARKERS. Offshorly is the first company in a world built to hold others, and
  //     these say so out loud: one low marker per vacant parcel, set just inside the frontage beside its
  //     service drive, facing the road a visitor would arrive on. Deliberately small and singular — the
  //     point of the parcel is the clean buildable ground behind the sign, not the sign.
  //     NOT a "for sale" board and NOT a building: no company, no gameplay, no ownership model.
  for (const lot of EXPANSION_LOTS) root.add(buildLotMarker(M, lot));

  // 10. PRACTICAL LIGHTING. Emissive lenses plus additive ground pools — no real-time lights anywhere.
  const lamps = streetLightSpots();
  const lg = lampGeos();
  root.add(instance(lg.post, M.surface(EX.pole, 0.55, { metalness: 0.25 }), lamps, true, "lamp-posts"));
  const lensMat = M.lamp(EX.lamp, 2.6);
  root.add(instance(lg.lens, lensMat, lamps, false, "lamp-lenses"));
  const poolGeo = poolDisc(96, 20);
  const poolSpots = lamps.map((l) => ({ x: l.x + Math.sin(l.yaw) * -34, z: l.z + Math.cos(l.yaw) * -34, y: ROAD_Y + 0.9 }));
  root.add(instance(poolGeo, M.spill(EX.lamp, 0.55), poolSpots, false, "lamp-pools"));
  // A soft additive bulb at each head. A billboard would need re-orienting every frame; a low-poly sphere
  // reads as a glow from any orbit angle and costs one more instanced draw call for the whole street grid.
  const haloGeoM = new THREE.IcosahedronGeometry(26, 1);
  root.add(instance(haloGeoM, M.spill(EX.lamp, 0.16), lamps.map((l) => ({ ...l, y: GRADE + 120 })), false, "lamp-halos"));
  instanced += 4; instances += lamps.length * 4;

  const bollards = pathLightSpots();
  const bg = bollardGeos();
  root.add(instance(bg.post, M.surface(EX.bollard, 0.7), bollards, true, "bollard-posts"));
  root.add(instance(bg.lens, M.lamp(EX.lamp, 2.2), bollards, false, "bollard-lenses"));
  root.add(instance(poolDisc(33, 14), M.spill(EX.lamp, 0.4), bollards.map((b) => ({ ...b, y: PAVING_Y + 0.5 })), false, "bollard-pools"));
  instanced += 3; instances += bollards.length * 3;

  const benches = [...benchSpots(), ...POND_BENCHES];
  const bng = benchGeos();
  root.add(instance(bng.wood, M.surface(EX.bench, 0.8), benches, true, "bench-wood"));
  root.add(instance(bng.frame, M.surface(EX.benchFrame, 0.5, { metalness: 0.2 }), benches, true, "bench-frames"));
  instanced += 2; instances += benches.length * 2;

  // 11. IDENTITY. One monument sign at the visitor approach — the only exterior branding, lit after dusk.
  const sign = buildMonumentSign(M);
  root.add(sign);

  const draws = groundDraws + instanced + 5 + treads + EXPANSION_LOTS.length * 6; // + terrain, skirt, sign, pond, shore, treads, lot markers
  return {
    root,
    stats: { draws, instanced, instances, trees: treeCount, vehicles: VEHICLES.length },
    applyTint(t: number) {
      for (const { m, base } of M.tintable) m.color.copy(base).multiplyScalar(t);
    },
    applyWetness(w: number) {
      // Number.isFinite first: Math.max(0, Math.min(1, NaN)) is NaN, and a NaN roughness is not a clamp,
      // it is a material that renders black.
      const t = Number.isFinite(w) ? Math.max(0, Math.min(1, w)) : 0;
      for (const x of M.wettable) {
        x.m.roughness = x.dryR + (x.wetR - x.dryR) * t;
        x.m.envMapIntensity = x.dryEnv + (x.wetEnv - x.dryEnv) * t;
      }
      // roughness and envMapIntensity are plain uniforms: no recompile, no needsUpdate, no rebuild.
    },
    applyPracticals(level: number) {
      // NOT clamped to 1: the night preset deliberately drives the fixtures past nominal so the pools and
      // the lit signage carry a much darker world. 2 is the ceiling before emissives start to clip.
      const l = Math.max(0, Math.min(2, level));
      for (const p of M.practicals) {
        if (p.emissive) (p.m as THREE.MeshStandardMaterial).emissiveIntensity = p.emissive * l;
        if (p.opacity) p.m.opacity = Math.min(1, p.opacity * l);
        p.m.visible = p.opacity ? l > 0.01 : true;
      }
    },
  };
}

/** A future-lot marker: a slim post-and-panel board on a low plinth, wordmark-free and unbranded, lit to
 *  the same practical level as the street lamps so it reads at night without becoming signage clutter. */
function buildLotMarker(M: ExteriorMaterials, lot: Lot): THREE.Group {
  const g = new THREE.Group();
  g.name = `lot-marker:${lot.id}`;
  const r = lot.rect;
  // stand it beside the service drive, one panel-width in from the frontage, facing the road
  const INSET = 120;
  let x = r.x + r.w / 2, z = r.z + r.d / 2, yaw = 0;
  if (lot.frontage === "north") { x = r.x + r.w / 2 - 210; z = r.z + INSET; yaw = 0; }
  else if (lot.frontage === "west") { x = r.x + INSET; z = r.z + r.d / 2 - 210; yaw = -Math.PI / 2; }
  else { x = r.x + r.w - INSET; z = r.z + r.d / 2 - 210; yaw = Math.PI / 2; }
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  const stone = M.surface(EX.stone, 0.85), post = M.surface(EX.pole, 0.55, { metalness: 0.25 });
  g.add(shadowed(rbox(190, 9, 40, M.surface(EX.signPlinth, 0.9), 0, GRADE, 0, 2, 1)));
  g.add(shadowed(rbox(9, 54, 9, post, -72, GRADE + 9, 0, 2, 1)));
  g.add(shadowed(rbox(9, 54, 9, post, 72, GRADE + 9, 0, 2, 1)));
  g.add(shadowed(rbox(176, 52, 10, stone, 0, GRADE + 40, 0, 3, 1)));
  const face = M.lamp(0x2b3a33, 1.6, 0x9fe08a);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(162, 44), lotMarkerMat(face, M));
  plate.position.set(0, GRADE + 66, 5.6);
  g.add(shadowed(plate, false, false));
  const back = plate.clone();
  back.position.z = -5.6;
  back.rotation.y = Math.PI;
  g.add(back);
  return g;
}

/** The marker's face. One shared canvas for every parcel: the label is about the WORLD, not the lot. */
function lotMarkerMat(base: THREE.MeshStandardMaterial, M: ExteriorMaterials): THREE.MeshStandardMaterial {
  const ctx = canvas2d(512, 140);
  if (!ctx) return base;
  ctx.fillStyle = "#22302a";
  ctx.fillRect(0, 0, 512, 140);
  ctx.fillStyle = "#9fe08a";
  ctx.fillRect(0, 0, 512, 5);
  ctx.textAlign = "center";
  ctx.fillStyle = "#eef6e6";
  ctx.font = "600 40px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText("FUTURE COMPANY LOT", 256, 62);
  ctx.fillStyle = "#9bb4a4";
  ctx.font = "400 27px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText("Reserved for Client Company", 256, 104);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  base.map = tex;
  base.emissiveMap = tex;
  base.emissive = new THREE.Color(0xffffff);
  base.color = new THREE.Color(0xffffff);
  base.needsUpdate = true;
  M.setBase(base, 0xffffff);
  return base;
}

/** The Offshorly monument sign: a low stone blade on the drop-off lawn, wordmark lit from within. */
function buildMonumentSign(M: ExteriorMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = "offshorly-monument-sign";
  const x = ENTRY_X - 430, z = DROP_OFF.z + 16;
  // Dark stone, deliberately: the podium, the paving and the drop-off apron are all cream, and a pale
  // blade in front of them disappears. A graphite monument reads at a glance and gives the lit wordmark
  // something to sit on after dusk.
  const stone = M.surface(EX.stone, 0.85), dark = M.surface(EX.signPlinth, 0.9);
  g.add(shadowed(rbox(260, 12, 54, dark, x, GRADE, z, 3, 1)));
  g.add(shadowed(rbox(236, 74, 38, stone, x, GRADE + 12, z, 4, 1)));
  const face = M.lamp(0x2b3a33, 2.2, 0x9fe08a);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(214, 56), signTextMat(face, M));
  plate.position.set(x, GRADE + 50, z - 19.4);
  plate.rotation.y = Math.PI;
  g.add(shadowed(plate, false, false));
  const plate2 = plate.clone();
  plate2.position.z = z + 19.4;
  plate2.rotation.y = 0;
  g.add(plate2);
  return g;
}

/** The wordmark, drawn once into a canvas and used as BOTH map and emissive map, so the sign reads as a
 *  lit face at night and as printed vinyl by day. Falls back to the plain lamp material in a test runner. */
function signTextMat(base: THREE.MeshStandardMaterial, M: ExteriorMaterials): THREE.MeshStandardMaterial {
  const ctx = canvas2d(512, 128);
  if (!ctx) return base;
  ctx.fillStyle = "#22302a";
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = "#eef6e6";
  ctx.font = "600 60px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("OFFSHORLY", 256, 62);
  ctx.fillStyle = "#9fe08a";
  ctx.fillRect(150, 100, 212, 5);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  base.map = tex;
  base.emissiveMap = tex;
  base.emissive = new THREE.Color(0xffffff);
  base.color = new THREE.Color(0xffffff);
  base.needsUpdate = true;
  M.setBase(base, 0xffffff); // the canvas map now carries the colour; the night tint must not re-darken it
  return base;
}
