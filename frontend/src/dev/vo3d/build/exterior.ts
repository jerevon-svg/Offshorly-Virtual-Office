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
import { Baker, bake, rbox, shadowed } from "./helpers";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { prng, triCount } from "./exteriorGeo";
import { TREE_VARIANTS, flowerClump, fern, grassTuft, reedClump, shrubGeometry, stone, treeLibrary } from "./exteriorFoliage";
import { leafCardMaterial } from "./vegetation";
import { groundFinish, waterMaterial, waterUniforms, windByVertex } from "./exteriorShaders";
import {
  bedEdgingGeometry, beltGeometries, beltSpots, coverSpots, decalGeometry, drainageGeometry, kerbGeometry, lakeGeometry,
  rampEdgeGeometry, rampStripGeometry, ridgeGeometry, shoreGeometry, terrainGeometry, type CoverKind,
} from "./exteriorDetail";
import { buildConstructionSite } from "./constructionSite";
import { CONSTRUCTION_SITES } from "../world/construction";
import { campusTrees } from "../world/exteriorGround";
import { canvas2d } from "../render/Materials";
import {
  CROSSINGS, DROP_OFF, EXPANSION_LOTS, GRADE, LOTS, MARK_Y, PARK_DRIVE,
  PARKING, PAVING_Y, POND_BENCHES, POND_PATH, POND_SHORE, PODIUM, ROAD_Y, ROADS,
  STALL_BANKS, STALL_D, STALL_W, VEHICLES, WALKS,
  benchSpots, roadById, roadRect, streetLightSpots,   PARK_ACCESSIBLE, PARK_AISLE, PARK_CROSSINGS, PARK_ISLANDS, PARK_LAMPS, PARK_PATHS, PARK_SCREEN, stallRect,
  LAYBY, LAYBY_WALK, LAYBY_Y,
  BED_Y, ISLAND_H, MONUMENT_SIGN, PLANTING_BEDS, SCATTER_SEED, WATER_Y,
  RAMPS, type Ramp, LOT_MARKER_PLINTH, VACANT_PAD_Y, vacantLotGround, bollardSpots, campusShrubSpots, campusTreeSpots, lotMarkerSpot, roadVerges, entryStairTreads, scatterStep,
  roadVisibleSpan, type TreeKind,
} from "../world/campus";
import { scooterDockGeos, vehicleGeos, type VehicleGeos } from "./vehicles";
import { SCOOTER_COLOUR, type ScooterStation } from "../world/scooters";
import { TRAFFIC_LOOPS, buildLoopPath, poseAt } from "../world/traffic";
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
  accessible: 0x3f6fae,
  hedge: 0x557a3e, pole: 0x474c53, lamp: 0xffe6bd, bollard: 0xb8b1a6, puddle: 0x2b3a42,
  bench: 0xc09a6a, benchFrame: 0x4a4f55, stone: 0x6e6a62, stoneDark: 0xb9b1a3, signPlinth: 0x4c4944, signFace: 0x22302a,
  glass: 0x2a3944, tyre: 0x25262c, water: 0x5f93a8, shore: 0xa79b85,
  // the lake's depth range and its lapping edge (build/exteriorShaders waterMaterial)
  waterShallow: 0x7fb9b0, waterDeep: 0x2f6680, foam: 0xe4efe9, utility: 0x45484c,
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
  /** THE WIND, as two shared uniform objects. Every foliage material's compiled program points at THESE
   *  two objects, so "the wind picked up" is one float write for the whole campus — not a traversal, not
   *  a per-material loop, and not one matrix per tree. */
  readonly windGain = { value: 0 };
  readonly windTime = { value: 0 };
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
  /** THE LAKE'S LIVE STATE: time, rain and wind as shared uniform objects (build/exteriorShaders) */
  readonly lake = waterUniforms();
  /** THE LAKE. A smooth, slightly metallic standard surface (so the IBL and the sun land on it) with the
   *  living-water patch on top: moving waves and glints, shallow/deep colour from world/water's shoreline
   *  distance, a lapping edge, and rain rings. Tintable like every exterior surface, so it goes deep and cold
   *  at night; registered wet, so rain roughens the mirror into a broad dull sheen. */
  water(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.07, metalness: 0.22, envMapIntensity: 1.5 });
    this.tintable.push({ m, base: new THREE.Color(0xffffff) });
    this.wettable.push({ m, dryR: 0.07, wetR: 0.22, dryEnv: 1.5, wetEnv: 1.2 });
    return waterMaterial(m, this.lake, { shallow: EX.waterShallow, deep: EX.waterDeep, foam: EX.foam });
  }
  /** a tintable surface whose colour lives in its VERTICES (white base) — every modelled exterior piece */
  painted(roughness = 0.9, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    return this.surface(0xffffff, roughness, { vertexColors: true, ...extra });
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
  /** REGISTER A MATERIAL AS FOLIAGE THAT BENDS IN THE WIND.
   *
   *  WHY A SHADER AND NOT THE SWAY SYSTEM. render/Sway already animates planting — by writing a rotation
   *  onto an Object3D per node, per frame. That is exactly right for the dozen potted plants inside the
   *  rooms and exactly wrong out here, where the planting is several hundred trees living inside four
   *  InstancedMeshes: swaying them on the CPU would mean recomposing and re-uploading a whole instance
   *  matrix buffer every frame, for four buffers, forever. So the bend is moved into the vertex shader,
   *  where it costs two sines per vertex, touches no buffer, and scales to any number of instances.
   *
   *  BENDING, NOT SLIDING. The offset is proportional to HEIGHT ABOVE THE INSTANCE ORIGIN (the geometry
   *  is authored with its base at y=0), so trunks stay planted and only the crown travels — the whole
   *  difference between a tree in wind and a tree on a conveyor belt. `flex` is how far the top of a
   *  100-unit tree moves at full wind, in world units.
   *
   *  DECORRELATED PER INSTANCE. The phase seed comes from the instance's own translation column, so two
   *  trees standing side by side are never in step; without it a row of street trees pumps in unison and
   *  the whole campus reads as one object.
   *
   *  SHADOWS. The depth material is deliberately NOT patched. Shadow maps here are drawn on demand
   *  (Renderer.shadowMap.autoUpdate = false), so a canopy's shadow is a still frame whatever the crown
   *  does — patching depth as well would buy a matching shadow only on the frames the map happened to be
   *  redrawn, at the price of a second shader variant per foliage material. At diorama scale, with a
   *  crown travelling a few units, the mismatch is not findable by eye. */
  foliage(m: THREE.MeshStandardMaterial, flex: number): THREE.MeshStandardMaterial {
    if (m.userData.windFlex !== undefined) return m; // already patched — the cache hands out shared materials
    m.userData.windFlex = flex;
    const gain = this.windGain, time = this.windTime;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uWindGain = gain;
      shader.uniforms.uWindTime = time;
      shader.vertexShader = `uniform float uWindGain;\nuniform float uWindTime;\n${shader.vertexShader}`.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          float wHeight = max(transformed.y, 0.0);
          float wSeed = 0.0;
          #ifdef USE_INSTANCING
            wSeed = instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.021;
          #endif
          float wAmp = uWindGain * wHeight * ${flex.toFixed(5)};
          transformed.x += wAmp * (sin(uWindTime * 1.7 + wSeed) + 0.42 * sin(uWindTime * 4.1 + wSeed * 1.9));
          transformed.z += wAmp * 0.55 * cos(uWindTime * 1.31 + wSeed * 0.7);
        }`,
      );
    };
    // the program is keyed per flex value, or three canopies patched with three flexes would share one
    m.customProgramCacheKey = () => `wind:${flex}`;
    return m;
  }
  /** STANDING WATER. One material for every puddle on the campus: near-mirror roughness and a lifted
   *  environment response, so what it actually shows is the sky and the street lamps — which is what
   *  makes a puddle read as water rather than as a dark sticker. Opacity is owned by wetness (0 when dry,
   *  and the whole mesh is then hidden), colour by tint like every other exterior surface. */
  puddle(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color: EX.puddle, roughness: 0.06, metalness: 0.22, envMapIntensity: 2.1,
      transparent: true, opacity: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const alpha = puddleAlphaMap();
    if (alpha) m.alphaMap = alpha; // soft rim: a hard-edged disc reads as a decal, not as water
    this.tintable.push({ m, base: new THREE.Color(EX.puddle) });
    return m;
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

/** A flat unit-ish puddle disc, UV-mapped so the shared radial alpha ramp lands centred on it. Slightly
 *  oval rather than round: nothing on a road is a perfect circle. */
function puddleDisc(radius: number): THREE.BufferGeometry {
  return new THREE.CircleGeometry(radius, 14).rotateX(-Math.PI / 2).scale(1, 1, 0.72);
}

/** ONE 64x64 radial alpha ramp, shared by every puddle. Opaque at the centre, gone at the rim, so the
 *  edge of a puddle dissolves into the road instead of cutting a circle out of it. Built once; null when
 *  there is no 2D canvas to build it in (jsdom), in which case the discs simply have hard edges. */
let puddleAlpha: THREE.CanvasTexture | null | undefined;
function puddleAlphaMap(): THREE.CanvasTexture | null {
  if (puddleAlpha !== undefined) return puddleAlpha;
  puddleAlpha = null;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.55, "#e0e0e0");
  g.addColorStop(1, "#000000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  puddleAlpha = new THREE.CanvasTexture(c);
  return puddleAlpha;
}

const UP_Y = new THREE.Vector3(0, 1, 0);
/** Flatten a built group (a marker, the monument sign) into the ground Baker: each mesh takes its world
 *  transform (the group's own) so it can merge with every other piece of the same material. */
function bakeGroup(b: Baker, g: THREE.Group): void {
  g.updateMatrixWorld(true);
  for (const c of [...g.children]) {
    if (!(c instanceof THREE.Mesh)) continue;
    const m = c.clone();
    m.geometry = c.geometry.clone().applyMatrix4(c.matrixWorld);
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
    b.add(m);
  }
}
/** THE CONSTRUCTION SIGN's face: the canvas as map and emissive map, lit to the practicals like the lot
 *  markers — readable by day, glowing softly after dusk */
function constructionSignMat(M: ExteriorMaterials, canvas: HTMLCanvasElement | null): THREE.Material {
  const base = M.lamp(0x22302a, 1.2, 0xffffff);
  if (!canvas) return base;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  base.map = tex; base.emissiveMap = tex; base.color = new THREE.Color(0xffffff);
  base.needsUpdate = true;
  M.setBase(base, 0xffffff);
  return base;
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
let xseed = SCATTER_SEED;
const rx = (): number => (xseed = scatterStep(xseed)) / 4294967296;
const resetScatter = (): void => void (xseed = SCATTER_SEED);

/** A RAMP as a solid wedge: its sloped top from `fromY` to `toY` along its axis, down to below grade. */
function rampWedge(r: Ramp, m: THREE.Material): THREE.Mesh {
  const along = r.axis === "x" ? r.rect.w : r.rect.d, across = r.axis === "x" ? r.rect.d : r.rect.w;
  const base = GRADE - 0.5;
  const sh = new THREE.Shape();
  sh.moveTo(0, r.fromY); sh.lineTo(along, r.toY); sh.lineTo(along, base); sh.lineTo(0, base); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: across, bevelEnabled: false });
  const mesh = new THREE.Mesh(geo, m);
  // shape x runs along the ramp; the extrusion (+z) runs across it
  if (r.axis === "x") mesh.position.set(r.rect.x, 0, r.rect.z);
  else { mesh.rotation.y = -Math.PI / 2; mesh.position.set(r.rect.x + r.rect.w, 0, r.rect.z); }
  mesh.updateMatrix();
  return shadowed(mesh, false, true);
}

/** A street lamp: post + arm + head (one geometry), and its lens (a second, emissive). REPLACED, not added
 *  to (EXTERIOR POLISH): the old post was 376 triangles of 20-sided cylinders and rounded boxes — a third
 *  of a tree each, 115 times over. Eight sides and plain boxes give the same silhouette at under a fifth. */
function lampGeos(): { post: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const box = (w: number, h: number, d: number, x: number, y0: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y0 + h / 2, z);
  const post = mergeGeometries([
    new THREE.CylinderGeometry(4.6, 6, 6, 8, 1).translate(0, 3, 0), //            the cast base
    new THREE.CylinderGeometry(2.1, 3.3, 124, 8, 1, true).translate(0, 66, 0), //  the tapered shaft
    new THREE.CylinderGeometry(2.6, 2.6, 3, 8, 1).translate(0, 27.5, 0), //        a collar
    box(3.4, 3.4, 38, 0, 126, -17), //                                           the arm
    box(12, 5.5, 30, 0, 121, -34), //                                            the head
  ].map((g) => g.toNonIndexed()), false)!;
  return { post, lens: box(10, 1.2, 24, 0, 120.6, -34).toNonIndexed() };
}

function bollardGeos(): { post: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  return {
    post: mergedGeo([cylLow(6, 3, 0, 8), cylLow(4.4, 30, 2, 8, true), cylLow(5.4, 3, 35, 8)]),
    lens: mergedGeo([cylLow(4.6, 4, 31, 8, true)]),
  };
}
/** a low-sided cylinder mesh for the posts (helpers' cyl is 20-sided) */
function cylLow(r: number, h: number, y0: number, seg: number, open = false): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg, 1, open).translate(0, y0 + h / 2, 0), TMP);
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
  /** 0 = bone dry, 1 = soaked. Roughness/env response, plus whether the puddles are there at all —
   *  colour stays with applyTint. */
  applyWetness(w: number): void;
  /** 0 = still air, 1 = the hardest the planting bends (env/weatherGrade WIND). One uniform write. */
  applyWind(gain: number): void;
  /** Advance the foliage animation. Seconds. */
  windTick(elapsedSeconds: number): void;
  /** PLACE THE MOVING TRAFFIC for a moment in time (world/traffic). Pass WALL-CLOCK seconds so every client
   *  sees the same vehicles in the same places. The caller skips it while the exterior is not drawn. */
  trafficTick(timeSec: number): void;
  /** THE SHARED SCOOTERS (world/scooters): hide a docked one while it is being ridden, and place the one
   *  under the rider. Present only when the builder was given stations. */
  scooters: {
    setDocked(dockId: string, docked: boolean): void;
    showRidden(on: boolean): void;
    /** the ridden scooter: origin on the ground at (x, y, z), yawed, pitched nose-up by `pitch` about its own
     *  lateral axis, then leaned by `lean` about its forward axis */
    placeRidden(x: number, z: number, yaw: number, lean: number, y?: number, pitch?: number): void;
  } | null;
  /** 0 = no rain, 1 = the heaviest: rings on the lake (wetness says how wet things ARE; this is whether
   *  drops are falling NOW, so the rings stop when the rain does even while the ground stays wet) */
  applyRain(intensity: number): void;
  /** DETAIL FOLLOWS THE CAMERA: trees swap to their near cut close to it, ground cover beyond its range is
   *  culled. `camLocal` is the camera in this root's own frame (the exterior may be anchored upstairs).
   *  Cheap, and it does its work only when the camera has moved a meaningful distance. */
  detailTick(camLocal: THREE.Vector3): void;
  stats: {
    draws: number; instanced: number; instances: number; trees: number; vehicles: number; traffic: number; docks: number;
    /** the near-cut tree budget: how many may be near at once, and the most triangles that adds */
    treeLod: { nearCap: number; nearExtraTris: number; nearNow: number };
    cover: number;
    construction: { tris: number; draws: number };
    /** the lot markers baked into the ground layer, by name (lot-marker:<lot id>) */
    lotMarkers: string[];
  };
};

/** TREE LOD: a tree within NEAR_IN of the camera takes its near cut, and keeps it out to NEAR_OUT; at most
 *  NEAR_CAP trees (the closest) are near at once, which bounds the worst case whatever the camera does */
const NEAR_IN = 620, NEAR_OUT = 700, NEAR_CAP = 26;
/** ground cover is drawn within this distance of the camera */
const COVER_RANGE = 1350;

export function buildExterior(opts: { scooterStations?: readonly ScooterStation[] } = {}): ExteriorScenery {
  const stations = opts.scooterStations ?? [];
  const docks = stations.flatMap((st) => st.docks);
  resetScatter();
  const M = new ExteriorMaterials();
  const root = new THREE.Group();
  root.name = "exterior-world";

  const ground = new Baker();
  // THE GROUND FINISHES (build/exteriorShaders): mottled, mown and dry-patched grass, slab joints in the
  // paving, aggregate in the asphalt, joints in the kerbs, mulch in the beds — shader detail on the same
  // materials, so no draw call and no texture is added
  const terrainM = groundFinish(M.surface(EX.terrain), "terrain"), lawnM = groundFinish(M.surface(EX.lawn), "lawn-mown"), lawnDarkM = groundFinish(M.surface(EX.lawnDark), "lawn");
  const meadowM = groundFinish(M.surface(EX.meadow), "lawn"), padM = groundFinish(M.surface(EX.pad, 0.96), "lawn");
  // THE WET SET: everything a shower actually pools on. Asphalt goes furthest (a wet road is nearly a
  // mirror), paving is restrained, the curb barely moves. Lawns, soil and planting are NOT registered —
  // grass does not gloss, and making it do so is the single fastest way to make rain look like plastic.
  const roadM = groundFinish(M.wet(M.surface(EX.asphalt, 0.85), 0.3, 1.45), "asphalt"), lineM = M.wet(M.surface(EX.line, 0.7), 0.34, 1.3), crossM = M.wet(M.surface(EX.crossing, 0.7), 0.34, 1.3);
  const pavingM = groundFinish(M.wet(M.surface(EX.paving, 0.9), 0.46, 1.25), "paving"), pavingWarmM = groundFinish(M.wet(M.surface(EX.pavingWarm, 0.88), 0.46, 1.25), "paving-warm"), curbM = groundFinish(M.wet(M.surface(EX.curb, 0.85), 0.6, 1.15), "kerb");
  const soilM = groundFinish(M.surface(EX.soil, 1), "soil");
  const utilM = M.wet(M.surface(EX.utility, 0.55, { metalness: 0.3 }), 0.2, 1.4);

  // 1. TERRAIN. Open country at grade (world/campus TERRAIN_Y), built as cells that never overlap a lot or a
  //    street corridor (build/exteriorDetail) — it used to be one disc under the carriageways, 2.6 below the
  //    lawns and 2.95 below the far sidewalks, and that lip was visible all round every parcel.
  {
    const t = new THREE.Mesh(terrainGeometry(), terrainM);
    t.name = "terrain";
    root.add(shadowed(t, false, true));
  }

  // 2. LOTS. Every parcel gets its lawn first; paving is laid over it afterwards.
  for (const lot of LOTS) ground.add(flatRect(lot.rect, lot.kind === "field" ? meadowM : lot.id === "lot-offshorly" ? lawnM : lawnDarkM, GRADE));

  // 3. THE STREET GRID. Carriageway, sidewalks, centre dashes and real kerb stones; then the crossings. Each
  //    street is drawn only over its VISIBLE span (world/campus roadVisibleSpan): it runs out through the
  //    distant belt and ends at the ridge's foot instead of across the world's rim.
  for (const r of ROADS) {
    const span = roadVisibleSpan(r);
    const clip = (x: Rect): Rect => r.axis === "x" ? { ...x, x: span.from, w: span.to - span.from } : { ...x, z: span.from, d: span.to - span.from };
    ground.add(flatRect(clip(roadRect(r)), roadM, ROAD_Y));
    for (const v of roadVerges(r)) ground.add(flatRect(clip(v.walk), pavingM, PAVING_Y));
    // dashed centre line
    for (let t = r.from + 60; t < r.to; t += 180) {
      if (t < span.from || t + 84 > span.to) continue;
      const seg: Rect = r.axis === "x" ? { x: t, z: r.at - 2, w: 84, d: 4 } : { x: r.at - 2, z: t, w: 4, d: 84 };
      ground.add(flatRect(seg, lineM, MARK_Y));
    }
  }
  // THE KERB STONES: a chamfered profile where every carriageway meets its curb band, replacing the flat
  // band that floated 1.7 over the road's edge (top at CURB_Y — the ground model's kerb height)
  ground.add(new THREE.Mesh(kerbGeometry(), curbM));
  // drainage gullies at the gutters and manhole covers, near the block
  ground.add(new THREE.Mesh(drainageGeometry(), utilM));
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
  // THE LAY-BY (world/campus): the sidewalk diverted behind it, the bay itself in the sidewalk band — laid
  // just above the sidewalk it replaces — and a kerb line between walkers and waiting vehicles
  ground.add(flatRect(LAYBY_WALK, pavingM, PAVING_Y));
  ground.add(flatRect(LAYBY, roadM, LAYBY_Y));
  ground.add(flatRect({ x: LAYBY.x, z: LAYBY.z - 2, w: LAYBY.w, d: 4 }, curbM, LAYBY_Y + 0.06));
  for (const x of [LAYBY.x - 2, LAYBY.x + LAYBY.w - 2]) ground.add(flatRect({ x, z: LAYBY.z, w: 4, d: LAYBY.d }, curbM, LAYBY_Y + 0.06));
  ground.add(flatRect(PARK_DRIVE, roadM, PAVING_Y - 0.3));
  ground.add(flatRect(PARKING, roadM, PAVING_Y - 0.3));
  // stall lines: two rows either side of the central aisle
  const stalls = Math.floor(PARKING.d / STALL_W);
  for (const bank of STALL_BANKS)
    for (let i = 0; i <= stalls; i++)
      ground.add(flatRect({ x: bank.x, z: PARKING.z + i * STALL_W - 1.5, w: STALL_D, d: 3 }, lineM, PAVING_Y - 0.18));
  // THE CAR PARK'S COMPOSITION (world/campus PARK_*). Paint, paving and kerbs only — all of it lands in
  // this baked ground layer, so the only new submission is the accessible-bay blue.
  //   the planted screen between the west street's sidewalk and the stalls (the hedge moved here)
  ground.add(flatRect(PARK_SCREEN, soilM, GRADE + 0.5));
  //   the pedestrian paths: the walk band through the east bank and on across the lawn, and the apron
  //   head carried past the drive to the perimeter walk
  for (const r of PARK_PATHS) ground.add(flatRect(r, pavingM, PAVING_Y));
  //   crossings: bars run the way a pedestrian walks, 12 wide on an 18 pitch like the street crossings
  for (const c of PARK_CROSSINGS) {
    const r = c.rect, span = c.along === "x" ? r.d : r.w, n = Math.floor((span + 6) / 18), off0 = (span - (n * 18 - 6)) / 2;
    for (let i = 0; i < n; i++) {
      const o = off0 + i * 18;
      ground.add(flatRect(c.along === "x" ? { x: r.x, z: r.z + o, w: r.w, d: 12 } : { x: r.x + o, z: r.z, w: 12, d: r.d }, crossM, PAVING_Y - 0.12));
    }
  }
  //   a stop bar where the aisle meets the apron crossing
  ground.add(flatRect({ x: PARK_AISLE.x, z: PARK_AISLE.z + PARK_AISLE.d - 10, w: PARK_AISLE.w, d: 4 }, lineM, PAVING_Y - 0.18));
  //   accessible bays beside the walk: a blue field and a white badge at the aisle end
  const accessibleM = M.wet(M.surface(EX.accessible, 0.75), 0.34, 1.3);
  for (const i of PARK_ACCESSIBLE) {
    const r = stallRect(1, i);
    ground.add(flatRect({ x: r.x + 6, z: r.z + 5, w: r.w - 12, d: r.d - 10 }, accessibleM, PAVING_Y - 0.24));
    ground.add(flatRect({ x: r.x + 22, z: r.z + r.d / 2 - 11, w: 22, d: 22 }, lineM, PAVING_Y - 0.14));
  }
  //   kerbed islands: a low kerb box standing on the asphalt, lawn on top
  for (const isl of PARK_ISLANDS) {
    const r = stallRect(isl.bank, isl.stall);
    ground.add(rbox(r.w - 8, ISLAND_H + 0.4, r.d - 8, curbM, r.x + r.w / 2, PAVING_Y - 0.4, r.z + r.d / 2, 0));
    ground.add(flatRect({ x: r.x + 8, z: r.z + 8, w: r.w - 16, d: r.d - 16 }, lawnM, PAVING_Y + ISLAND_H + 0.1));
  }
  // The podium skirt: a slightly wider base band UNDER the V1 plinth (whose own base is exactly at GRADE),
  // so the office reads as sitting IN the site rather than resting on it. It must stay entirely below
  // grade — anything above it would cover the ground floor it is supposed to support. Baked with the ground.
  ground.add(shadowed(rbox(PODIUM.w + 26, 4.8, PODIUM.d + 26, M.surface(EX.stoneDark, 0.9), PODIUM.x + PODIUM.w / 2, GRADE - 5, PODIUM.z + PODIUM.d / 2, 2, 1), false, true));
  // The entry stair down to the drop-off: SOLID treads, each a box standing on grade, baked with the ground
  for (const t of entryStairTreads()) ground.add(shadowed(rbox(t.rect.w, t.top - t.base, t.rect.d, pavingWarmM, t.rect.x + t.rect.w / 2, t.base, t.rect.z + t.rect.d / 2, 1.2, 1), false, true));

  // THE RAMPS (world/campus RAMPS, Phase 4): solid wedges in the entry flight's warm paving, each standing on
  // grade (or sunk into the plinth ring it crosses) and falling along its axis — the same slope the ground
  // model walks and rides. FINISHED (EXTERIOR POLISH): a stone edge kerb rides each long side 1.1 proud of the
  // slope, and a tactile strip marks its top and foot. All baked with the ground: no new draw.
  for (const r of RAMPS) ground.add(rampWedge(r, pavingWarmM));
  ground.add(new THREE.Mesh(rampEdgeGeometry(), curbM));
  ground.add(new THREE.Mesh(rampStripGeometry(), lineM));

  // 5. PLANTING BEDS along the podium and the drop-off: mulched soil inside a low stone edging
  const beds = PLANTING_BEDS;
  for (const b of beds) ground.add(flatRect(b, soilM, BED_Y));
  ground.add(new THREE.Mesh(bedEdgingGeometry(), curbM));

  // 6. THE VACANT PARCELS. Each one reads as intentional, maintained, open land waiting for a campus:
  //    a mown pad set back from its frontage, a service drive stub off the road it fronts, a hedge line
  //    along the street and groves in the back corners. No building, no sign, no "for sale" language.
  for (const lot of EXPANSION_LOTS) {
    const { pad, stub } = vacantLotGround(lot); // world/campus: the ground model walks the same pad and stub
    ground.add(flatRect(pad, padM, VACANT_PAD_Y));
    ground.add(flatRect(stub, roadM, PAVING_Y - 0.3));
  }
  // the lot markers and the monument sign join the bake too: a marker was six draws of its own, the sign three
  const lotMarkers: string[] = [];
  for (const lot of EXPANSION_LOTS) { const g = buildLotMarker(M, lot); bakeGroup(ground, g); lotMarkers.push(g.name); }
  bakeGroup(ground, buildMonumentSign(M));
  const groundDraws = ground.bakeInto(root, "exterior-ground");

  // SOFT DECALS: worn verges along every path and contact shading round the Lab's plinth and causeways —
  // one transparent, vertex-alpha mesh, lit and tinted like the ground under it
  {
    const m = M.surface(0xffffff, 1, { vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const d = new THREE.Mesh(decalGeometry(), m);
    d.name = "ground-decals";
    d.renderOrder = 1;
    d.receiveShadow = true;
    root.add(d);
  }

  // 7. PLANTING — COMPOSED, NOT SCATTERED, AND NOW MODELLED (build/exteriorFoliage). Every tree still comes
  //    from world/campus's TREE_LINES, GROVES or SPECIMENS (less any that stood in a paved path — world/
  //    exteriorGround campusTrees), but each is a built tree: grooved, root-flared trunk, branches, layered
  //    leaf masses, two seeds per species. ALL OF THEM ARE TWO DRAWS: one BatchedMesh of trunks (bark) and one
  //    of crowns (leaf, swaying), each holding every species/seed in a NEAR and a FAR cut; detailTick swaps a
  //    tree to its near cut as the camera comes close, for at most NEAR_CAP trees at a time.
  // the placements are world/campus campusTreeSpots — the FIRST draws after resetScatter, reproduced from
  // the seed so the ground model reads the very trees drawn here; the stream then resumes where it ended
  xseed = campusTreeSpots().seedAfter;
  const planted = campusTrees();
  const lib = treeLibrary();
  let instanced = 0, instances = 0;
  const KINDS: TreeKind[] = ["round", "tall", "broad", "conifer"];
  type TreeInst = { kind: TreeKind; v: number; spot: Spot & { s: number; yaw: number }; trunk: number; canopy: number; near: boolean; cards: number };
  const treeList: TreeInst[] = [];
  for (const kind of KINDS) planted[kind].forEach((t, i) => treeList.push({ kind, v: (i + Math.round(Math.abs(t.x))) % TREE_VARIANTS, spot: t, trunk: -1, canopy: -1, near: false, cards: -1 }));
  const treeCount = treeList.length;
  // SHRUBS ride in the crown batch (same leaf material): the campus's own beds, the parking screen, and a
  // SHORT hedge marking the centre of each vacant parcel's frontage. world/campus campusShrubSpots — the
  // same draws in the same order, resuming the stream where the trees left it, so the ground model's solids
  // are the very shrubs drawn here. (The pond reeds moved to the ground cover.)
  const planting = campusShrubSpots(xseed);
  xseed = planting.seedAfter;
  const shrubs: Spot[] = [...planting.beds, ...planting.frontage, ...planting.screen, ...planting.islands];
  const shrubGeos = [shrubGeometry(5), shrubGeometry(9, { base: 0x5f8443, dark: 0x34532a, light: 0x88a95a })];
  const barkM = M.painted(0.93);
  const leafM = windByVertex(M.painted(0.86, { flatShading: true }), M.windGain, M.windTime);
  const vcount = (g: THREE.BufferGeometry) => g.getAttribute("position").count;
  let trunkVerts = 0, crownVerts = 0;
  for (const kind of KINDS) for (const v of lib[kind]) { trunkVerts += vcount(v.near.trunk) + vcount(v.far.trunk); crownVerts += vcount(v.near.canopy) + vcount(v.far.canopy); }
  for (const g of shrubGeos) crownVerts += vcount(g);
  const trunks = new THREE.BatchedMesh(treeCount, trunkVerts, 0, barkM);
  const crowns = new THREE.BatchedMesh(treeCount + shrubs.length, crownVerts, 0, leafM);
  trunks.name = "trees-trunks"; crowns.name = "trees-crowns";
  const geoIds = new Map<string, { trunk: [number, number]; canopy: [number, number] }>();
  for (const kind of KINDS) lib[kind].forEach((v, i) => geoIds.set(`${kind}:${i}`, {
    trunk: [trunks.addGeometry(v.near.trunk), trunks.addGeometry(v.far.trunk)],
    canopy: [crowns.addGeometry(v.near.canopy), crowns.addGeometry(v.far.canopy)],
  }));
  const shrubIds = shrubGeos.map((g) => crowns.addGeometry(g));
  // THE VEGETATION LADDER (`?veg=2`): the near cut's LEAF CARDS in a third batch, each tree's instance shown only
  // while it is near — one more draw, bounded by NEAR_CAP trees
  let leafCards: THREE.BatchedMesh | null = null;
  const cardIds = new Map<string, number>();
  {
    let cardVerts = 0;
    for (const kind of KINDS) for (const v of lib[kind]) if (v.near.cards) cardVerts += vcount(v.near.cards);
    if (cardVerts > 0) {
      const cardM = leafCardMaterial(M.windGain, M.windTime, 1.5);
      M.tintable.push({ m: cardM, base: new THREE.Color(0xffffff) });
      M.wet(cardM, 0.5, 1.25);
      leafCards = new THREE.BatchedMesh(treeCount, cardVerts, 0, cardM);
      leafCards.name = "trees-leaf-cards";
      for (const kind of KINDS) lib[kind].forEach((v, i) => { if (v.near.cards) cardIds.set(`${kind}:${i}`, leafCards!.addGeometry(v.near.cards)); });
    }
  }
  // CONTROLLED VARIATION: a per-tree tint within a narrow band (bark and leaf), and the scatter's own scale/yaw
  const varRnd = prng(0x7ee5);
  const tm = new THREE.Matrix4(), tq = new THREE.Quaternion(), tp = new THREE.Vector3(), ts = new THREE.Vector3(), tc = new THREE.Color();
  for (const t of treeList) {
    const id = geoIds.get(`${t.kind}:${t.v}`)!;
    t.trunk = trunks.addInstance(id.trunk[1]);
    t.canopy = crowns.addInstance(id.canopy[1]);
    tm.compose(tp.set(t.spot.x, t.spot.y ?? GRADE, t.spot.z), tq.setFromAxisAngle(UP_Y, t.spot.yaw), ts.setScalar(t.spot.s));
    trunks.setMatrixAt(t.trunk, tm).setColorAt(t.trunk, tc.setRGB(1, 1, 1).multiplyScalar(0.9 + varRnd() * 0.2));
    crowns.setMatrixAt(t.canopy, tm).setColorAt(t.canopy, tc.setHSL(0.25 + (varRnd() - 0.5) * 0.04, 0.12 + varRnd() * 0.18, 0.5).lerp(new THREE.Color(1, 1, 1), 0.72));
    const cid = cardIds.get(`${t.kind}:${t.v}`);
    if (leafCards && cid !== undefined) { t.cards = leafCards.addInstance(cid); leafCards.setMatrixAt(t.cards, tm).setColorAt(t.cards, tc); leafCards.setVisibleAt(t.cards, false); }
  }
  shrubs.forEach((sp, i) => {
    const inst = crowns.addInstance(shrubIds[i % 2]);
    tm.compose(tp.set(sp.x, sp.y ?? GRADE, sp.z), tq.setFromAxisAngle(UP_Y, sp.yaw ?? 0), ts.setScalar(sp.s ?? 1));
    crowns.setMatrixAt(inst, tm).setColorAt(inst, tc.setRGB(1, 1, 1).multiplyScalar(0.88 + varRnd() * 0.22));
  });
  for (const b of [trunks, crowns]) { b.castShadow = true; b.receiveShadow = true; b.frustumCulled = false; root.add(b); }
  if (leafCards) { leafCards.receiveShadow = true; leafCards.frustumCulled = false; root.add(leafCards); }
  instanced += 2; instances += treeCount * 2 + shrubs.length;
  const nearExtra = Math.max(...KINDS.flatMap((k) => lib[k].map((v) => triCount(v.near.trunk) + triCount(v.near.canopy) - triCount(v.far.trunk) - triCount(v.far.canopy))));

  // 7a. GROUND COVER (build/exteriorDetail coverSpots): grass tufts, flowers, ferns, reeds, pebbles, stones —
  //     round tree bases, along path edges, in meadow drifts, at the water's edge and in the beds. ONE draw:
  //     a BatchedMesh of a dozen small geometries, swaying by per-vertex weight (stones never move), culled
  //     beyond COVER_RANGE of the camera by detailTick.
  const COVER_GEOS: Record<CoverKind, THREE.BufferGeometry> = {
    tuft: grassTuft(1, 7, 7, 2.6, { root: 0x4f7a34, tip: 0x9cc25e }),
    tuftTall: grassTuft(2, 9, 12, 3.2, { root: 0x557a36, tip: 0xb3c46a }),
    tuftWide: grassTuft(3, 11, 6, 5, { root: 0x4b7332, tip: 0x8fb858 }),
    flowerWhite: flowerClump(4, 4, 0xf3f0e6, 0xf2c94c),
    flowerYellow: flowerClump(5, 4, 0xf2c94c, 0xd98a2b),
    flowerViolet: flowerClump(6, 4, 0xa58ad8, 0xf2e6a0),
    fern: fern(7, 7, 10, { root: 0x3f6b2e, tip: 0x7fae4f }),
    reed: reedClump(8),
    pebble: stone(9, 2.2, 1.2),
    stone: stone(10, 4.2, 2.6),
    boulder: stone(11, 11, 7.5, { base: 0x8f897d, dark: 0x5f5a52, light: 0xb7b0a3 }),
  };
  const cover = coverSpots();
  const coverM = windByVertex(M.painted(0.92, { side: THREE.DoubleSide }), M.windGain, M.windTime, 1.6);
  const coverBatch = new THREE.BatchedMesh(cover.length, Object.values(COVER_GEOS).reduce((n, g) => n + vcount(g), 0), 0, coverM);
  coverBatch.name = "ground-cover";
  const coverIds = new Map<CoverKind, number>((Object.keys(COVER_GEOS) as CoverKind[]).map((k) => [k, coverBatch.addGeometry(COVER_GEOS[k])]));
  const coverInst = cover.map((c) => {
    const id = coverBatch.addInstance(coverIds.get(c.kind)!);
    tm.compose(tp.set(c.x, c.y, c.z), tq.setFromAxisAngle(UP_Y, c.yaw), ts.setScalar(c.s));
    coverBatch.setMatrixAt(id, tm).setColorAt(id, tc.setRGB(1, 1, 1).multiplyScalar(0.86 + varRnd() * 0.26));
    return id;
  });
  coverBatch.castShadow = false; coverBatch.receiveShadow = true; coverBatch.frustumCulled = false;
  root.add(coverBatch);
  instanced++; instances += cover.length;

  // 7b. THE LAKE (world/water LAKE). A ring mesh whose every vertex knows how far it is from the waterline,
  //     so the living-water shader shades the shelf shallow and the middle deep from the same number a future
  //     swimming phase will read; and a graded beach under and round it, wet at the water and feathering into
  //     the lawn. Both sit above grade — the lot's lawn has no hole to sink into — exactly as before.
  {
    const lake = new THREE.Mesh(lakeGeometry(), M.water());
    lake.name = "lake";
    lake.position.y = WATER_Y;
    lake.renderOrder = 0;
    root.add(shadowed(lake, false, false));
    const shoreM = M.wet(groundFinish(M.painted(0.97), "shore"), 0.55, 1.2);
    const beach = new THREE.Mesh(shoreGeometry(POND_SHORE), shoreM);
    beach.name = "lake-shore";
    root.add(shadowed(beach, false, true));
  }

  // 8. THE HORIZON. A continuous ridge ring (no gaps for the eye to find) and three staggered rows of cheap,
  //    recognisable distant trees kept off the street corridors — so each road runs out between them and
  //    ends at the ridge's foot. No shadows; one draw each.
  {
    const ridge = new THREE.Mesh(ridgeGeometry(), M.painted(1, { flatShading: true }));
    ridge.name = "distant-ridge";
    root.add(shadowed(ridge, false, false));
    const [firG, broadG] = beltGeometries();
    const spots = beltSpots();
    const belt = new THREE.BatchedMesh(spots.length, vcount(firG) + vcount(broadG), 0, M.painted(0.95, { flatShading: true }));
    belt.name = "distant-belt";
    const ids = [belt.addGeometry(firG), belt.addGeometry(broadG)];
    for (const b of spots) {
      const id = belt.addInstance(ids[b.kind]);
      tm.compose(tp.set(b.x, GRADE, b.z), tq.setFromAxisAngle(UP_Y, b.yaw), ts.setScalar(b.s));
      belt.setMatrixAt(id, tm).setColorAt(id, tc.setRGB(1, 1, 1).multiplyScalar(0.85 + varRnd() * 0.25));
    }
    belt.castShadow = false; belt.receiveShadow = false; belt.frustumCulled = false;
    root.add(belt);
    instanced += 2; instances += spots.length + 1;
  }

  // 8b. CONSTRUCTION (world/construction): the AI Lab's yard, scaffold and sign — four draws a site
  const constructionStats = { tris: 0, draws: 0 };
  const sitePoolGeo = poolDisc(60, 16);
  for (const site of CONSTRUCTION_SITES) {
    const built = buildConstructionSite(site, {
      body: M.painted(0.82),
      lens: M.lamp(0xfff4dc, 3.2),
      spill: M.spill(EX.lamp, 0.5),
      sign: (canvas) => constructionSignMat(M, canvas),
    }, sitePoolGeo);
    root.add(built.group);
    constructionStats.tris += built.tris; constructionStats.draws += built.draws;
  }

  // 9. THE PARKED FLEET (build/vehicles). Sports and premium cars in the staff car park, the Philippine
  //    street set in the lay-by — each placed BY HAND in world/campus's VEHICLES table.
  //
  //    TWO DRAW CALLS FOR THE WHOLE FLEET, whatever it holds. Every kind is three geometries (paint, gloss
  //    detail, matte detail) with one attribute layout, so the fleet is one BatchedMesh per material: the
  //    GLOSS batch holds every vehicle's paint (tinted per instance with its own colour) and its glass,
  //    chrome and lamps (instance colour white, so the baked vertex colours show); the MATTE batch holds
  //    tyres, trim, grilles, fabric and the horse. Both materials are ordinary tintable exterior surfaces,
  //    so night darkens them with everything else, and the gloss one wets in the rain.
  const trafficKinds = TRAFFIC_LOOPS.flatMap((l) => l.vehicles.map((v) => v.kind));
  const fleetKinds = [...new Set([...VEHICLES.map((v) => v.kind), ...trafficKinds, ...(docks.length ? ["scooter" as const] : [])])];
  const fleetGeos = new Map<string, VehicleGeos>(fleetKinds.map((k) => [k, vehicleGeos(k)]));
  // the scooter racks ride in the same batches as the fleet: one geometry per rack size
  for (const st of stations) if (!fleetGeos.has(`dock:${st.base.count}`)) fleetGeos.set(`dock:${st.base.count}`, scooterDockGeos(st.base.count, st.base.spacing));
  const verts = (pick: (g: VehicleGeos) => THREE.BufferGeometry[]) => [...fleetGeos.values()].reduce((n, g) => n + pick(g).reduce((m, x) => m + x.getAttribute("position").count, 0), 0);
  const glossM = M.wet(M.surface(0xffffff, 0.32, { vertexColors: true, metalness: 0.16 }), 0.12, 1.5);
  const matteM = M.surface(0xffffff, 0.84, { vertexColors: true });
  const white = new THREE.Color(0xffffff);
  const vm = new THREE.Matrix4(), vq = new THREE.Quaternion(), vp = new THREE.Vector3(), vs = new THREE.Vector3(1, 1, 1), vc = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0);
  /** one gloss + one matte batch holding every kind's geometry, `slots` vehicles deep */
  const makeBatches = (slots: number, name: string, withLights: boolean) => {
    const gloss = new THREE.BatchedMesh(slots * (withLights ? 3 : 2), verts((g) => (withLights ? [g.paint, g.gloss, g.lights] : [g.paint, g.gloss])), 0, glossM);
    const matte = new THREE.BatchedMesh(slots, verts((g) => [g.matte]), 0, matteM);
    gloss.name = `${name}-gloss`;
    matte.name = `${name}-matte`;
    const ids = new Map<string, { paint: number; gloss: number; matte: number; lights: number }>();
    for (const [k, g] of fleetGeos) ids.set(k, { paint: gloss.addGeometry(g.paint), gloss: gloss.addGeometry(g.gloss), matte: matte.addGeometry(g.matte), lights: withLights ? gloss.addGeometry(g.lights) : -1 });
    return { gloss, matte, ids };
  };

  // 9a. PARKED: lamps drawn with the gloss detail (they are off, they are just coloured glass)
  const parked = makeBatches(VEHICLES.length + docks.length + stations.length, "vehicles", true);
  /** place one parked thing (a vehicle, a docked scooter, a rack); returns its four instance ids */
  const park = (key: string, x: number, y: number, z: number, yaw: number, colour: number): number[] => {
    const id = parked.ids.get(key)!;
    vm.compose(vp.set(x, y, z), vq.setFromAxisAngle(UP, yaw), vs);
    const out: number[] = [];
    for (const [geo, c] of [[id.paint, vc.setHex(colour)], [id.gloss, white], [id.lights, white]] as const) {
      const inst = parked.gloss.addInstance(geo);
      parked.gloss.setMatrixAt(inst, vm).setColorAt(inst, c);
      out.push(inst);
    }
    const m = parked.matte.addInstance(id.matte);
    parked.matte.setMatrixAt(m, vm).setColorAt(m, white);
    out.push(m);
    return out;
  };
  for (const v of VEHICLES) park(v.kind, v.x, v.y ?? GRADE, v.z, v.yaw, v.colour);
  // SCOOTER STATIONS stand at the WALKING level (the pavement and the Lab's raised walks are at y 0)
  for (const st of stations) park(`dock:${st.base.count}`, st.base.x, 0, st.base.z, st.base.yaw, SCOOTER_COLOUR);
  const dockInstances = new Map<string, number[]>();
  for (const d of docks) dockInstances.set(d.id, park("scooter", d.x, 1.4, d.z, d.yaw, SCOOTER_COLOUR));
  for (const b of [parked.gloss, parked.matte]) { b.castShadow = true; b.receiveShadow = true; root.add(b); }
  instanced += 2; instances += VEHICLES.length * 4;

  // 9c. MOVING TRAFFIC (world/traffic): the SAME geometry and materials, in batches of their own because
  //     the shadow map is drawn on demand (Renderer: autoUpdate = false) — a moving caster would leave its
  //     shadow behind. So traffic casts nothing and stands on a soft contact disc instead. Its lamps are a
  //     third, UNLIT batch: bright by day as any lamp lens is, and genuinely glowing after dark, with an
  //     additive pool on the road ahead driven by the same practicals level as the street lamps.
  const paths = TRAFFIC_LOOPS.map(buildLoopPath);
  const movers = paths.flatMap((path, li) => path.loop.vehicles.map((v, vi) => ({ path, li, vi, v })));
  // one spare slot at the end of every traffic batch is the RIDDEN scooter (it moves, so it casts no shadow
  // either, and stands on the same contact disc)
  const rideSlot = docks.length ? 1 : 0;
  const moving = makeBatches(movers.length + rideSlot, "traffic", false);
  const lampsBatch = new THREE.BatchedMesh(movers.length + rideSlot, verts((g) => [g.lights]), 0, new THREE.MeshBasicMaterial({ vertexColors: true }));
  lampsBatch.name = "traffic-lamps";
  const lampIds = new Map<string, number>();
  for (const [k, g] of fleetGeos) lampIds.set(k, lampsBatch.addGeometry(g.lights));
  // the contact disc: soft-edged (vertex alpha, centre 1 → rim 0), stretched to each vehicle's footprint
  const blobGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  {
    const n = blobGeo.getAttribute("position").count, c = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { c[i * 4] = c[i * 4 + 1] = c[i * 4 + 2] = 0; c[i * 4 + 3] = i === 0 ? 1 : 0; }
    blobGeo.setAttribute("color", new THREE.BufferAttribute(c, 4));
  }
  const blobM = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const blobs = new THREE.InstancedMesh(blobGeo, blobM, movers.length + rideSlot);
  blobs.name = "traffic-shadows";
  const pools = new THREE.InstancedMesh(poolDisc(1, 18), M.spill(EX.lamp, 0.42), movers.length + rideSlot);
  pools.name = "traffic-headlight-pools";
  const slot = movers.map((mv) => {
    const id = moving.ids.get(mv.v.kind)!;
    const paint = moving.gloss.addInstance(id.paint), detail = moving.gloss.addInstance(id.gloss), matte = moving.matte.addInstance(id.matte);
    const lamp = lampsBatch.addInstance(lampIds.get(mv.v.kind)!);
    moving.gloss.setColorAt(paint, vc.setHex(mv.v.colour));
    moving.gloss.setColorAt(detail, white);
    moving.matte.setColorAt(matte, white);
    lampsBatch.setColorAt(lamp, white);
    const box = new THREE.Box3();
    const g = fleetGeos.get(mv.v.kind)!;
    for (const part of [g.paint, g.gloss, g.matte]) { part.computeBoundingBox(); box.union(part.boundingBox!); }
    return { paint, detail, matte, lamp, half: { w: (box.max.x - box.min.x) / 2, l: (box.max.z - box.min.z) / 2, front: -box.min.z } };
  });
  for (const b of [moving.gloss, moving.matte, lampsBatch]) {
    b.castShadow = false; b.receiveShadow = true;
    // the whole-batch bound is computed once, from wherever the instances first stood; they move, so only
    // the per-instance test (perObjectFrustumCulled, on by default) is allowed to cull
    b.frustumCulled = false;
    root.add(b);
  }
  blobs.frustumCulled = false; pools.frustumCulled = false;
  blobs.renderOrder = 1; pools.renderOrder = 2;
  root.add(blobs, pools);
  instanced += 5; instances += movers.length * 6;
  const pose = { x: 0, z: 0, yaw: 0, heading: 0, speed: 0 };
  const bs = new THREE.Vector3(), bp = new THREE.Vector3();
  const trafficTick = (timeSec: number): void => {
    for (let k = 0; k < movers.length; k++) {
      const mv = movers[k], sl = slot[k];
      poseAt(mv.path, mv.vi, timeSec, pose);
      vq.setFromAxisAngle(UP, pose.yaw);
      vm.compose(vp.set(pose.x, ROAD_Y, pose.z), vq, vs);
      moving.gloss.setMatrixAt(sl.paint, vm).setMatrixAt(sl.detail, vm);
      moving.matte.setMatrixAt(sl.matte, vm);
      lampsBatch.setMatrixAt(sl.lamp, vm);
      blobs.setMatrixAt(k, vm.compose(bp.set(pose.x, ROAD_Y + 0.3, pose.z), vq, bs.set(sl.half.w * 1.05, 1, sl.half.l * 0.98)));
      // the headlight pool: an oval a little ahead of the nose, along the heading
      const fx = Math.cos(pose.heading), fz = Math.sin(pose.heading);
      pools.setMatrixAt(k, vm.compose(bp.set(pose.x + fx * (sl.half.front + 30), ROAD_Y + 0.35, pose.z + fz * (sl.half.front + 30)), vq, bs.set(sl.half.w * 1.2, 1, 38)));
    }
    blobs.instanceMatrix.needsUpdate = true;
    pools.instanceMatrix.needsUpdate = true;
  };
  trafficTick(0);

  // THE RIDDEN SCOOTER: hidden until somebody mounts one
  let scooters: ExteriorScenery["scooters"] = null;
  if (rideSlot) {
    const id = moving.ids.get("scooter")!;
    const r = { paint: moving.gloss.addInstance(id.paint), detail: moving.gloss.addInstance(id.gloss), matte: moving.matte.addInstance(id.matte), lamp: lampsBatch.addInstance(lampIds.get("scooter")!) };
    moving.gloss.setColorAt(r.paint, vc.setHex(SCOOTER_COLOUR));
    moving.gloss.setColorAt(r.detail, white);
    moving.matte.setColorAt(r.matte, white);
    lampsBatch.setColorAt(r.lamp, white);
    const k = movers.length;
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    const roll = new THREE.Quaternion(), FWD = new THREE.Vector3(0, 0, -1), tilt = new THREE.Quaternion(), SIDE = new THREE.Vector3(1, 0, 0);
    const setVisible = (on: boolean) => {
      moving.gloss.setVisibleAt(r.paint, on); moving.gloss.setVisibleAt(r.detail, on);
      moving.matte.setVisibleAt(r.matte, on); lampsBatch.setVisibleAt(r.lamp, on);
      if (!on) { blobs.setMatrixAt(k, hide); pools.setMatrixAt(k, hide); blobs.instanceMatrix.needsUpdate = true; pools.instanceMatrix.needsUpdate = true; }
    };
    setVisible(false);
    scooters = {
      setDocked(dockId, docked) {
        const ids = dockInstances.get(dockId);
        if (!ids) return;
        for (let i = 0; i < 3; i++) parked.gloss.setVisibleAt(ids[i], docked);
        parked.matte.setVisibleAt(ids[3], docked);
      },
      showRidden: setVisible,
      placeRidden(x, z, yaw, lean, y = 0, pitch = 0) {
        // yaw about up, then the pitch about the deck's lateral axis (nose up +), then the lean as a roll
        // about its forward axis
        vq.setFromAxisAngle(UP, yaw).multiply(tilt.setFromAxisAngle(SIDE, pitch)).multiply(roll.setFromAxisAngle(FWD, lean));
        vm.compose(vp.set(x, y, z), vq, vs);
        moving.gloss.setMatrixAt(r.paint, vm).setMatrixAt(r.detail, vm);
        moving.matte.setMatrixAt(r.matte, vm);
        lampsBatch.setMatrixAt(r.lamp, vm);
        vq.setFromAxisAngle(UP, yaw);
        blobs.setMatrixAt(k, vm.compose(bp.set(x, y + 0.3, z), vq, bs.set(8, 1, 23)));
        pools.setMatrixAt(k, vm.compose(bp.set(x + Math.sin(yaw) * -38, y + 0.35, z + Math.cos(yaw) * -38), vq, bs.set(12, 1, 22)));
        blobs.instanceMatrix.needsUpdate = true;
        pools.instanceMatrix.needsUpdate = true;
      },
    };
  }

  // 9b. FUTURE COMPANY LOT MARKERS. Offshorly is the first company in a world built to hold others, and
  //     these say so out loud: one low marker per vacant parcel, set just inside the frontage beside its
  //     service drive, facing the road a visitor would arrive on. Deliberately small and singular — the
  //     point of the parcel is the clean buildable ground behind the sign, not the sign.
  //     NOT a "for sale" board and NOT a building: no company, no gameplay, no ownership model.
  // (baked into the ground layer above — see bakeGroup)

  // 10. PRACTICAL LIGHTING. Emissive lenses plus additive ground pools — no real-time lights anywhere.
  // the lot lamps are the street lamp's own model, scaled (world/campus PARK_LAMPS): same posts, lenses,
  // pools and halos, driven by the same practicals — three more instances in each existing mesh
  const lamps: (Spot & { yaw: number; poolY: number })[] = [
    ...streetLightSpots().map((l) => ({ ...l, poolY: ROAD_Y + 0.9 })),
    ...PARK_LAMPS.map((l) => ({ ...l, poolY: PAVING_Y + 0.6 })),
  ];
  const lg = lampGeos();
  root.add(instance(lg.post, M.surface(EX.pole, 0.55, { metalness: 0.25 }), lamps, true, "lamp-posts"));
  const lensMat = M.lamp(EX.lamp, 2.6);
  root.add(instance(lg.lens, lensMat, lamps, false, "lamp-lenses"));
  const poolGeo = poolDisc(96, 20);
  const poolSpots = lamps.map((l) => {
    const s = l.s ?? 1;
    return { x: l.x + Math.sin(l.yaw) * -34 * s, z: l.z + Math.cos(l.yaw) * -34 * s, y: l.poolY, s };
  });
  root.add(instance(poolGeo, M.spill(EX.lamp, 0.55), poolSpots, false, "lamp-pools"));
  // A soft additive bulb at each head. A billboard would need re-orienting every frame; a low-poly sphere
  // reads as a glow from any orbit angle and costs one more instanced draw call for the whole street grid.
  const haloGeoM = new THREE.IcosahedronGeometry(26, 0);
  root.add(instance(haloGeoM, M.spill(EX.lamp, 0.16), lamps.map((l) => ({ ...l, y: GRADE + 120 * (l.s ?? 1) })), false, "lamp-halos"));
  instanced += 4; instances += lamps.length * 4;

  // two low bollards along the mid-lot path, on the lawn stretch between the lot and the building
  const bollards = bollardSpots();
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
  // (the monument sign is baked into the ground layer above)

  // 12. STANDING WATER. The wet SET above (roughness + environment response on the asphalt and paving)
  //     says "this surface is damp"; what it cannot say is "water has collected HERE and not there", and
  //     an evenly glossed road reads as polished stone rather than as a wet one. These are the puddles
  //     that break it up — flat discs lying on the carriageways, the parking apron and the drop-off,
  //     placed once at build time from the same road data the roads themselves were laid from.
  //
  //     ONE DRAW CALL, AND NONE WHEN IT IS DRY. Every puddle on the campus is one InstancedMesh sharing
  //     one material; when wetness is 0 the mesh is hidden and costs nothing at all. This is deliberately
  //     NOT a reflection: no planar reflector, no second render pass, no SSR. What a puddle shows is the
  //     scene's existing environment map at a high envMapIntensity and a near-zero roughness, which at
  //     this scale — and especially under street lamps at night — is the read we were after for free.
  const puddleM = M.puddle();
  const puddleSpots: Spot[] = [];
  const PUDDLE_Y = 0.35; // just proud of the surface it lies on; polygonOffset does the rest
  for (const road of ROADS) {
    // only over the drawn span of the street
    const span = roadVisibleSpan(road), full = roadRect(road);
    const r: Rect = road.axis === "x" ? { ...full, x: span.from, w: span.to - span.from } : { ...full, z: span.from, d: span.to - span.from };
    const along = road.axis === "x" ? r.w : r.d;
    // one every ~340 units of carriageway, nudged off the crown toward the gutters where water actually
    // sits, and skipped a third of the time so the spacing never reads as a pattern
    for (let t = 180; t < along - 180; t += 340) {
      if (rx() < 0.34) continue;
      const across = (rx() < 0.5 ? -1 : 1) * (0.2 + rx() * 0.26);
      const sx = 0.62 + rx() * 0.9;
      if (road.axis === "x") puddleSpots.push({ x: r.x + t, z: r.z + r.d * (0.5 + across), y: ROAD_Y + PUDDLE_Y, s: sx, yaw: rx() * 6.28 });
      else puddleSpots.push({ x: r.x + r.w * (0.5 + across), z: r.z + t, y: ROAD_Y + PUDDLE_Y, s: sx, yaw: rx() * 6.28 });
    }
  }
  for (let i = 0; i < 9; i++) puddleSpots.push({ x: PARKING.x + 30 + rx() * (PARKING.w - 60), z: PARKING.z + 40 + rx() * (PARKING.d - 80), y: PAVING_Y - 0.3 + PUDDLE_Y, s: 0.5 + rx() * 0.55, yaw: rx() * 6.28 });
  for (let i = 0; i < 4; i++) puddleSpots.push({ x: DROP_OFF.x + 40 + rx() * (DROP_OFF.w - 80), z: DROP_OFF.z + 14 + rx() * (DROP_OFF.d - 28), y: PAVING_Y + PUDDLE_Y, s: 0.42 + rx() * 0.4, yaw: rx() * 6.28 });
  for (let i = 0; i < 5; i++) puddleSpots.push({ x: PARK_DRIVE.x + 20 + rx() * (PARK_DRIVE.w - 40), z: PARK_DRIVE.z + 20 + rx() * (PARK_DRIVE.d - 40), y: PAVING_Y - 0.3 + PUDDLE_Y, s: 0.45 + rx() * 0.45, yaw: rx() * 6.28 });
  const puddles = instance(puddleDisc(42), puddleM, puddleSpots, false, "puddles");
  puddles.visible = false; // dry until a weather grade says otherwise
  puddles.receiveShadow = false;
  puddles.renderOrder = 3; // after the ground it lies on, before the rain field (950)
  root.add(puddles);
  instanced++; instances += puddleSpots.length;

  const draws = groundDraws + instanced + 5 + constructionStats.draws; // + terrain, decals, ridge, lake, shore
  const lastCam = new THREE.Vector3(0, Infinity, 0);
  const coverVisible = cover.map(() => true);
  return {
    root,
    trafficTick,
    scooters,
    stats: {
      draws, instanced, instances, trees: treeCount, vehicles: VEHICLES.length, traffic: movers.length, docks: docks.length,
      treeLod: { nearCap: NEAR_CAP, nearExtraTris: NEAR_CAP * nearExtra, get nearNow() { return treeList.filter((t) => t.near).length; } },
      cover: cover.length,
      construction: constructionStats,
      lotMarkers,
    },
    applyRain(intensity: number) {
      M.lake.uRain.value = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0;
    },
    detailTick(camLocal: THREE.Vector3) {
      // only when the camera has really moved: a still camera costs one distance test a frame
      if (lastCam.distanceToSquared(camLocal) < 30 * 30 && lastCam.y !== Infinity) return;
      lastCam.copy(camLocal);
      // TREES: rank by distance, the closest NEAR_CAP within reach take (or keep) their near cut
      const d2 = (t: TreeInst) => (t.spot.x - camLocal.x) ** 2 + (t.spot.z - camLocal.z) ** 2 + ((t.spot.y ?? GRADE) + 40 - camLocal.y) ** 2;
      const ranked = treeList.map((t) => ({ t, d: d2(t) })).sort((a, b) => a.d - b.d);
      ranked.forEach(({ t, d }, rank) => {
        const want = rank < NEAR_CAP && d < (t.near ? NEAR_OUT : NEAR_IN) ** 2;
        if (want === t.near) return;
        t.near = want;
        const id = geoIds.get(`${t.kind}:${t.v}`)!;
        trunks.setGeometryIdAt(t.trunk, id.trunk[want ? 0 : 1]);
        crowns.setGeometryIdAt(t.canopy, id.canopy[want ? 0 : 1]);
        if (leafCards && t.cards >= 0) leafCards.setVisibleAt(t.cards, want);
      });
      // GROUND COVER: only within reach of the camera (and not at all from high overhead)
      const r2 = COVER_RANGE * COVER_RANGE;
      cover.forEach((c, i) => {
        const dd = (c.x - camLocal.x) ** 2 + (c.z - camLocal.z) ** 2 + (c.y - camLocal.y) ** 2 * 0.6;
        const show = dd < r2;
        if (coverVisible[i] !== show) { coverVisible[i] = show; coverBatch.setVisibleAt(coverInst[i], show); }
      });
    },
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
      // PUDDLES ARRIVE LATE. They stay at nothing until the ground is already damp and only then fade in,
      // because water that stands has to have had time to collect: a puddle appearing the instant the
      // first streak lands is the tell that this is a slider and not weather.
      puddleM.opacity = Math.max(0, (t - 0.32) / 0.68) * 0.72;
      puddles.visible = puddleM.opacity > 0.01;
      // roughness, envMapIntensity and opacity are plain uniforms: no recompile, no needsUpdate, no rebuild.
    },
    applyWind(gain: number) {
      M.windGain.value = Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 0;
    },
    windTick(elapsedSeconds: number) {
      // ONE FLOAT, ONCE A FRAME, FOR EVERY TREE ON THE CAMPUS. Skipped entirely in still air, so a clear
      // day does not pay for an animation nobody can see.
      if (M.windGain.value > 0.001) M.windTime.value = elapsedSeconds;
      // THE LAKE NEVER STOPS: its clock always runs (water in still air still moves), and the weather's
      // wind lifts its chop
      M.lake.uTime.value = elapsedSeconds;
      M.lake.uWind.value = M.windGain.value;
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
  // stand it beside the service drive, one panel-width in from the frontage, facing the road (world/campus)
  const { x, z, yaw } = lotMarkerSpot(lot);
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  const stone = M.surface(EX.stone, 0.85), post = M.surface(EX.pole, 0.55, { metalness: 0.25 });
  g.add(shadowed(rbox(LOT_MARKER_PLINTH.w, 9, LOT_MARKER_PLINTH.d, M.surface(EX.signPlinth, 0.9), 0, GRADE, 0, 2, 1)));
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
  const { x, z } = MONUMENT_SIGN;
  // Dark stone, deliberately: the podium, the paving and the drop-off apron are all cream, and a pale
  // blade in front of them disappears. A graphite monument reads at a glance and gives the lit wordmark
  // something to sit on after dusk.
  const stone = M.surface(EX.stone, 0.85), dark = M.surface(EX.signPlinth, 0.9);
  g.add(shadowed(rbox(MONUMENT_SIGN.w, 12, MONUMENT_SIGN.d, dark, x, GRADE, z, 3, 1)));
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
