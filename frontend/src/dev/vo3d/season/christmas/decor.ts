// vo3d season/christmas — THE DECORATION BUILDERS. Procedural, baked, nav-inert, visual-only.
//
// ══ THE THREE RULES THESE OBEY, inherited from build/detail-props.ts and season/halloween/decor.ts ══
//
//  1. READABLE AT THE GAME CAMERA. ~2 px per world unit, looking down from the south at 52°. Everything
//     is sized in TENS of world units and puts its information on a south- or up-facing surface.
//  2. CHEAP BY CONSTRUCTION. Repeated pieces are INSTANCED (snowflakes), everything static is BAKED by
//     the layer into one mesh per material, and nothing here creates a real-time light — every glow is
//     an emissive surface plus an additive plane, the same trick build/led.ts uses for the whole office.
//  3. WORLD COORDINATES, NAV-INERT. nav/solids.ts never reads a THREE object, so nothing built here can
//     block a cell, narrow a doorway, occupy a seat or move an interaction — whatever it is and wherever
//     it is put. That is a property of the architecture, not of the care taken here.
//
// ══ THE ONE VISIBILITY RULE THAT IS NOT AUTOMATIC, AND THE ONE EXCEPTION TO IT ══
//
//  Nav-inertness does not stop a decoration STANDING IN FRONT OF SOMEBODY. So every floor-standing piece
//  is short — under ~14 units, well below an avatar's head — every hanging piece is high, and nothing is
//  placed in the middle of a floor.
//
//  THE TREE IS THE EXCEPTION, and it is a deliberate one. A white Christmas office without a tall
//  snow-covered tree is not the brief; Halloween already took the same exception for its scarecrow, on
//  the same terms. A tree is therefore ALWAYS a corner piece (season/christmas/placement.ts gives it a
//  wider wall hug than anything else and only ever hands it corner spots), it is never placed on an
//  open floor, and it is rationed per room. A tree in a corner cannot stand between the camera and a
//  face; a tree in the middle of a room could, which is why one is allowed and the other is not.
import * as THREE from "three";
import { Baker, cyl, rbox, shadowed } from "../../build/helpers";
import type { ChristmasMaterials } from "./materials";

/** Deterministic PRNG. A rebuild must be identical or a screenshot comparison means nothing, and
 *  build/helpers' own `rnd` is shared with the room builders' seed — reusing it here would shift every
 *  plant in the office the moment a season was added. (The same eight lines Halloween's decor keeps,
 *  duplicated rather than imported so neither season can ever pull the other's module into the bundle.) */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** The shared marker the layer's per-frame pass and its glow-collapse both look for. Same key
 *  Halloween writes, because it is one mechanism in season/SeasonLayer.ts and not one per season. */
const BILLBOARD = "hwBillboard";

// ---- snow-covered trees -------------------------------------------------------------------------------

export interface TreeSpec {
  x: number;
  z: number;
  /** total height in world units. 24–40 is a real tree at this office's scale; under 18 is a tabletop one. */
  h: number;
  y0?: number;
  /** whether it carries lit fairy lights and a glowing topper. Off for the small filler trees. */
  lit?: boolean;
}

/** A SNOW-COVERED CHRISTMAS TREE — the signature piece, and the one thing a viewer will look for.
 *
 *  FOUR THINGS MAKE IT READ AS SNOW-COVERED RATHER THAN AS A GREEN CONE WITH WHITE ON IT, and all four
 *  are visible from the office camera's look-down:
 *    · TIERED, not a single cone. Four overlapping skirts give the silhouette its steps.
 *    · A SNOW CAP ON EVERY TIER, slightly WIDER than the tier under it and sitting just above its
 *      shoulder — snow lies ON branches and overhangs them, it does not paint them.
 *    · ORNAMENTS IN METAL. Silver, pearl and ice baubles at the tier edges, where they catch light.
 *      This is the only place in the season the eye finds a specular highlight, so it is where the
 *      dimensionality comes from.
 *    · A LIT TOPPER AND A POOL. The tree is a light source in the reference, not a lit object. */
export function snowTree(M: ChristmasMaterials, spec: TreeSpec, rng: () => number = Math.random): THREE.Group {
  const g = new THREE.Group();
  g.name = "xm:tree";
  const { x, z, h } = spec;
  const y0 = spec.y0 ?? 0;
  const lit = spec.lit !== false;
  const baker = new Baker();

  // the trunk, barely visible under the lowest skirt — enough that the tree does not float
  baker.add(shadowed(cyl(h * 0.035, h * 0.2, M.branch, x, y0, z), false, true));

  const TIERS = 4;
  const baseR = h * 0.3;
  for (let i = 0; i < TIERS; i++) {
    const t = i / (TIERS - 1);
    // skirts overlap: each starts below the previous one's shoulder, which is what removes the gaps
    const yBase = y0 + h * (0.14 + t * 0.56);
    const r = baseR * (1 - t * 0.62);
    const tierH = h * (0.34 - t * 0.09);
    // LOW SEGMENT COUNT ON PURPOSE. Seven sides read as a stylised fir at any distance; a smooth cone
    // reads as a party hat and costs four times the triangles.
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, tierH, 7), i % 2 === 0 ? M.fir : M.firDeep);
    cone.position.set(x, yBase + tierH / 2, z);
    cone.rotation.y = rng() * Math.PI;
    baker.add(shadowed(cone, false, true));

    // THE SNOW CAP: wider than its tier and lifted onto its shoulder, so it overhangs.
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 1.06, tierH * 0.46, 7), M.snow);
    cap.position.set(x, yBase + tierH * 0.78, z);
    cap.rotation.y = cone.rotation.y;
    baker.add(shadowed(cap, false, true));

    // ornaments at the skirt edge, where they are lit from outside rather than buried in the tree
    const count = 3 + Math.floor(rng() * 3);
    for (let b = 0; b < count; b++) {
      const a = (b / count) * Math.PI * 2 + rng() * 1.4;
      const br = h * (0.022 + rng() * 0.016);
      const bauble = new THREE.Mesh(
        new THREE.SphereGeometry(br, 8, 6),
        b % 3 === 0 ? M.silver : b % 3 === 1 ? M.ornamentPearl : M.ornamentIce,
      );
      bauble.position.set(x + Math.cos(a) * r * 0.88, yBase + tierH * 0.3, z + Math.sin(a) * r * 0.88);
      baker.add(shadowed(bauble, false, true));
    }
  }
  baker.bakeInto(g, "xm-tree");

  if (lit) {
    // THE TOPPER: a crystal star, and the one piece allowed to be genuinely bright.
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(h * 0.055, 0), M.lightCore);
    star.position.set(x, y0 + h * 0.99, z);
    star.rotation.y = 0.5;
    g.add(star);
    const starHalo = new THREE.Mesh(new THREE.PlaneGeometry(h * 0.34, h * 0.34), M.glowWarm);
    starHalo.position.set(x, y0 + h * 0.99, z);
    starHalo.renderOrder = 2;
    starHalo.userData[BILLBOARD] = true;
    g.add(starHalo);

    // FAIRY LIGHTS: bulbs wound around the tiers as emissive specks, plus ONE shared warm halo.
    // One halo rather than one per bulb — a dozen overlapping additive quads on a tree is a white
    // blob, and it costs a dozen draw calls to make one.
    const bulbs = new Baker();
    const n = 14;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const a = t * Math.PI * 7.5;
      const r = baseR * (1 - t * 0.66) * 0.94;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(h * 0.012, 5, 4), M.lightCore);
      bulb.position.set(x + Math.cos(a) * r, y0 + h * (0.18 + t * 0.66), z + Math.sin(a) * r);
      bulbs.add(bulb);
    }
    bulbs.bakeInto(g, "xm-tree-bulbs");
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(h * 0.78, h * 0.9), M.glowWarm);
    halo.position.set(x, y0 + h * 0.52, z);
    halo.renderOrder = 2;
    halo.userData[BILLBOARD] = true;
    g.add(halo);
  }

  // THE POOL ON THE FLOOR. Cool rather than warm: it is moonlit snow around the foot of the tree,
  // and it is what grounds a tall piece so it does not read as pasted onto the room.
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(h * 1.5, h * 1.5), M.glow);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(x, y0 + 0.35, z);
  pool.renderOrder = 2;
  g.add(pool);

  // A RING OF SNOW at the foot — the drift that gathers around anything standing outdoors, and the
  // cue that makes an indoor tree read as brought in from the snow.
  const skirt = new THREE.Mesh(new THREE.CircleGeometry(h * 0.34, 12), M.snow);
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.set(x, y0 + 0.5, z);
  g.add(shadowed(skirt, false, true));
  return g;
}

// ---- frosted branches and winter foliage ---------------------------------------------------------------

/** FROSTED WINTER FOLIAGE: bare pale branches with snow caught on their tips, in a pot-sized footprint.
 *
 *  The counterpart to Halloween's withered plant and the same high-value trick: the office is full of
 *  healthy green planting, so a frosted one standing beside it is the clearest possible statement that
 *  the season has arrived — with no repainting of anything the office already owns. */
export function frostedBranches(M: ChristmasMaterials, x: number, z: number, h = 13, rng: () => number = Math.random): THREE.Group {
  const g = new THREE.Group();
  g.name = "xm:branches";
  const baker = new Baker();
  const stalks = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < stalks; i++) {
    const a = (i / stalks) * Math.PI * 2 + rng();
    const lean = 0.16 + rng() * 0.28;
    const sh = h * (0.6 + rng() * 0.6);
    const stalk = cyl(0.4, sh, M.branch, x, 0, z, 0.18);
    stalk.rotation.z = Math.cos(a) * lean;
    stalk.rotation.x = Math.sin(a) * lean;
    stalk.position.x += Math.cos(a) * 1.5;
    stalk.position.z += Math.sin(a) * 1.5;
    baker.add(shadowed(stalk, false, true));
    // SNOW ON THE TIPS. Two or three per plant — a flattened blob at the top of a branch, which is
    // exactly what snow on a twig looks like and is one sphere to draw.
    if (i % 2 === 0) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(1.5 + rng() * 0.9, 6, 4), M.snow);
      tip.scale.set(1, 0.42, 1);
      tip.position.set(x + Math.cos(a) * (2 + lean * sh), sh * 0.92, z + Math.sin(a) * (2 + lean * sh));
      baker.add(shadowed(tip, false, true));
    }
  }
  // the pot's own snow crust
  const crust = new THREE.Mesh(new THREE.SphereGeometry(3.4, 8, 5), M.snow);
  crust.scale.set(1, 0.3, 1);
  crust.position.set(x, 0.8, z);
  baker.add(shadowed(crust, false, true));
  baker.bakeInto(g, "xm-branches");
  return g;
}

// ---- icicles ------------------------------------------------------------------------------------------

/** A RUN OF CEILING ICICLES along a wall head: downward cones of staggered length and spacing.
 *
 *  UNEVEN LENGTHS ARE THE WHOLE READ — a row of identical spikes is a comb, and real icicles come in
 *  clusters of one long one between several short. Baked to one mesh: a whole wall's worth costs the
 *  same as one icicle. */
export function icicleRun(
  M: ChristmasMaterials,
  from: THREE.Vector3,
  to: THREE.Vector3,
  count: number,
  rng: () => number = Math.random,
): THREE.Group {
  const g = new THREE.Group();
  g.name = "xm:icicles";
  const baker = new Baker();
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count + (rng() - 0.5) * (0.45 / count);
    // every third one is a long one; the rest are short. That 1-in-3 rhythm is what reads as natural.
    const len = (i % 3 === 0 ? 8 : 3.4) + rng() * 5.5;
    const r = 0.5 + len * 0.055;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(r, len, 5), M.ice);
    spike.rotation.x = Math.PI; // point down
    spike.position.set(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t - len / 2,
      from.z + (to.z - from.z) * t,
    );
    baker.add(spike);
  }
  baker.bakeInto(g, "xm-icicles");
  // a faint cool wash behind the run, so the ice reads as lit rather than as grey plastic
  const wash = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.hypot(to.x - from.x, to.z - from.z), 22),
    M.glow,
  );
  wash.position.set((from.x + to.x) / 2, (from.y + to.y) / 2 - 6, (from.z + to.z) / 2);
  wash.renderOrder = 2;
  wash.userData[BILLBOARD] = true;
  g.add(wash);
  return g;
}

// ---- hanging snowflakes --------------------------------------------------------------------------------

export interface FlakeSpec { x: number; y: number; z: number; size: number; yaw: number; roll?: number; pitch?: number }

/** A DRIFT OF HANGING CRYSTAL SNOWFLAKES as ONE InstancedMesh.
 *
 *  Structurally Halloween's bat flock, visually its opposite: the reference hangs dozens of them at
 *  staggered heights over the whole ceiling band, and it is the single element that turns "a room with
 *  a tree in it" into "a room the season has taken over". One draw call for all of them.
 *
 *  PITCH IS WHAT MAKES A FLAKE VISIBLE FROM ABOVE — the same lesson the bats taught. A quad hung flat
 *  against the ceiling is edge-on to the office camera's 52° look-down and disappears entirely. */
export function snowflakeDrift(M: ChristmasMaterials, specs: readonly FlakeSpec[]): THREE.InstancedMesh | null {
  if (specs.length === 0) return null;
  const geo = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geo, M.flake, specs.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  specs.forEach((f, i) => {
    e.set(f.pitch ?? 0, f.yaw, f.roll ?? 0);
    q.setFromEuler(e);
    s.set(f.size, f.size, f.size);
    p.set(f.x, f.y, f.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false; // the set spans a room; its instance bounds are not worth computing
  mesh.renderOrder = 1;
  mesh.name = "xm:flakes";
  return mesh;
}

// ---- swags: garlands and fairy lights --------------------------------------------------------------------

/** The shared catenary ribbon both swag builders hang from: `segments` quads following a parabolic
 *  sag, one strip, one draw call. (A parabola is indistinguishable from a catenary over a single span
 *  and costs one multiply.) */
function ribbon(from: THREE.Vector3, to: THREE.Vector3, sag: number, drop: number, segments: number, repeats: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = from.y + (to.y - from.y) * t - sag * 4 * t * (1 - t);
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    pos.push(x, y, z, x, y - drop, z);
    // TILED ALONG THE RUN, never stretched: a 200-unit garland carrying one copy of a 256px band has
    // needles as thick as floorboards.
    uv.push(t * repeats, 1, t * repeats, 0);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** A FROSTED GARLAND SWAG strung between two ceiling points: the sprig band, sagging. */
export function garlandSwag(
  M: ChristmasMaterials,
  from: THREE.Vector3,
  to: THREE.Vector3,
  sag: number,
  drop: number,
): THREE.Mesh {
  const span = Math.hypot(to.x - from.x, to.z - from.z);
  const mesh = new THREE.Mesh(ribbon(from, to, sag, drop, 14, Math.max(1, Math.round(span / 110))), M.sprig);
  mesh.renderOrder = 1;
  return mesh;
}

/** A DELICATE FAIRY-LIGHT STRING: a thin silver wire following the same sag, with emissive bulbs along
 *  it and one warm halo per few bulbs.
 *
 *  Deliberately thin and deliberately sparse. The reference's lights are PINPOINTS in a bright room,
 *  not a rope of light; a fat glowing string at this office's scale reads as a neon tube. */
export function fairyLightSwag(
  M: ChristmasMaterials,
  from: THREE.Vector3,
  to: THREE.Vector3,
  sag: number,
  bulbs: number,
  rng: () => number = Math.random,
): THREE.Group {
  const g = new THREE.Group();
  g.name = "xm:fairylights";
  const wire = new THREE.Mesh(ribbon(from, to, sag, 0.5, 14, 1), M.silverDeep);
  wire.renderOrder = 1;
  g.add(wire);
  const baker = new Baker();
  for (let i = 0; i < bulbs; i++) {
    const t = (i + 0.5) / bulbs;
    const y = from.y + (to.y - from.y) * t - sag * 4 * t * (1 - t) - 1.2;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.85 + rng() * 0.4, 5, 4), M.lightCore);
    bulb.position.set(from.x + (to.x - from.x) * t, y, from.z + (to.z - from.z) * t);
    baker.add(bulb);
    // ONE HALO EVERY FOURTH BULB. Enough that the string glows; few enough that the additive layers
    // never stack into a bar of white.
    if (i % 4 === 0) {
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), M.glowWarm);
      halo.position.copy(bulb.position);
      halo.renderOrder = 2;
      halo.userData[BILLBOARD] = true;
      g.add(halo);
    }
  }
  baker.bakeInto(g, "xm-bulbs");
  return g;
}

// ---- lanterns, wreaths, gifts, crystal --------------------------------------------------------------------

/** A WINTER LANTERN: a silver-framed glass box with a warm core, standing on the floor or a ledge.
 *
 *  The same shape Halloween's lantern uses, in the opposite finish — polished silver instead of black
 *  iron — because the reference lines its walkways with exactly this and it is the one warm light in a
 *  cold palette. */
export function winterLantern(M: ChristmasMaterials, x: number, z: number, y0 = 0, h = 10): THREE.Group {
  const g = new THREE.Group();
  g.name = "xm:lantern";
  const w = h * 0.5;
  const baker = new Baker();
  baker.add(shadowed(rbox(w, h * 0.09, w, M.silverDeep, x, y0, z, 0.3), false, true));        // base
  baker.add(shadowed(rbox(w, h * 0.1, w, M.silverDeep, x, y0 + h * 0.9, z, 0.3), false, true)); // cap
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    baker.add(rbox(w * 0.09, h * 0.82, w * 0.09, M.silver, x + dx * w * 0.44, y0 + h * 0.08, z + dz * w * 0.44, 0.1));
  }
  // a snow cap on the roof — every outdoor-looking object in this season has one
  const snowCap = new THREE.Mesh(new THREE.SphereGeometry(w * 0.4, 7, 4), M.snow);
  snowCap.scale.set(1, 0.34, 1);
  snowCap.position.set(x, y0 + h * 0.97, z);
  baker.add(shadowed(snowCap, false, true));
  baker.bakeInto(g, "xm-lantern");
  g.add(cyl(w * 0.2, h * 0.42, M.lightCore, x, y0 + h * 0.2, z));
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(h * 2.4, h * 2.4), M.glowWarm);
  halo.position.set(x, y0 + h * 0.42, z);
  halo.renderOrder = 2;
  halo.userData[BILLBOARD] = true;
  g.add(halo);
  return g;
}

/** A FROSTED WREATH mounted flat against a wall: a fir torus dusted with snow, hung with silver
 *  baubles and a cool aura behind it. `facing` is the Y rotation that puts its face into the room. */
export function wreath(M: ChristmasMaterials, x: number, y: number, z: number, r: number, facing: number, rng: () => number = Math.random): THREE.Group {
  const g = new THREE.Group();
  g.name = "xm:wreath";
  const baker = new Baker();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.26, 6, 14), M.fir);
  ring.position.set(x, y, z);
  ring.rotation.y = facing;
  baker.add(shadowed(ring, false, true));
  // snow lying along the TOP of the ring only — snow does not coat the underside of anything
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + (i / 6) * Math.PI;
    const blob = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2 + rng() * r * 0.06, 6, 4), M.snow);
    blob.scale.set(1, 0.6, 1);
    blob.position.set(x + Math.cos(a) * r * Math.cos(facing), y - Math.sin(a) * r, z - Math.cos(a) * r * Math.sin(facing));
    baker.add(shadowed(blob, false, true));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    const bauble = new THREE.Mesh(new THREE.SphereGeometry(r * 0.17, 7, 5), i % 2 ? M.silver : M.ornamentIce);
    bauble.position.set(x + Math.cos(a) * r * 0.92 * Math.cos(facing), y + Math.sin(a) * r * 0.92, z - Math.cos(a) * r * 0.92 * Math.sin(facing));
    baker.add(shadowed(bauble, false, true));
  }
  baker.bakeInto(g, "xm-wreath");
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(r * 3.4, r * 3.4), M.glow);
  halo.position.set(x, y, z);
  halo.renderOrder = 2;
  halo.userData[BILLBOARD] = true;
  g.add(halo);
  return g;
}

export interface GiftSpec { x: number; z: number; w: number; h: number; y0?: number; tone?: "snow" | "pearl" | "silver" }

/** A STACK OF WHITE GIFT BOXES with silver ribbon crosses. Never one box alone — the reference piles
 *  them at the foot of every tree, in three sizes, slightly askew. */
export function giftStack(M: ChristmasMaterials, specs: readonly GiftSpec[], rng: () => number = Math.random): THREE.Group {
  const g = new THREE.Group();
  g.name = "xm:gifts";
  const baker = new Baker();
  for (const s of specs) {
    const y0 = s.y0 ?? 0;
    const body = s.tone === "pearl" ? M.pearl : s.tone === "silver" ? M.silverDeep : M.snow;
    const box = rbox(s.w, s.h, s.w, body, s.x, y0, s.z, 0.4);
    box.rotation.y = (rng() - 0.5) * 0.6;
    baker.add(shadowed(box, false, true));
    // the ribbon: two thin bands crossing the lid, which is the whole of what makes a box a GIFT
    const t = Math.max(0.5, s.w * 0.08);
    baker.add(rbox(t, s.h * 1.04, s.w * 1.02, M.silver, s.x, y0, s.z, 0.1));
    baker.add(rbox(s.w * 1.02, s.h * 1.04, t, M.silver, s.x, y0, s.z, 0.1));
  }
  baker.bakeInto(g, "xm-gifts");
  return g;
}

/** AN ICE-CRYSTAL CLUSTER: three or four shards of different heights rising out of a corner.
 *
 *  The brief's "crystal-like reflections", built as geometry rather than as a shader: an octahedron
 *  stretched tall has hard facets that catch the key light from every angle, which is exactly the
 *  glint a reflection probe would have bought at a hundred times the cost. */
export function crystalCluster(M: ChristmasMaterials, x: number, z: number, h = 9, rng: () => number = Math.random): THREE.Group {
  const g = new THREE.Group();
  g.name = "xm:crystal";
  const n = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng();
    const sh = h * (0.5 + rng() * 0.8);
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(sh * 0.3, 0), M.crystal);
    shard.scale.set(0.55, 1.9, 0.55);
    shard.position.set(x + Math.cos(a) * h * 0.25, sh * 0.42, z + Math.sin(a) * h * 0.25);
    shard.rotation.y = rng() * Math.PI;
    shard.rotation.z = (rng() - 0.5) * 0.3;
    g.add(shard);
  }
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(h * 3.4, h * 3.4), M.glow);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(x, 0.4, z);
  pool.renderOrder = 2;
  g.add(pool);
  return g;
}

// ---- floor treatments -------------------------------------------------------------------------------------

/** A SNOW DRIFT: a flat, soft-edged white disc lying just above the floor.
 *
 *  A MATERIAL OVERLAY, not a surface change — a separate transparent quad above the floor, so the
 *  floor's own material, its collision and everything walking on it are untouched. Used OUTDOORS for
 *  real accumulation and INDOORS, much fainter, as the dusting around a tree's foot. */
export function snowDrift(M: ChristmasMaterials, x: number, z: number, size: number, y = 0.45): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), M.drift);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.renderOrder = 1;
  mesh.name = "xm:drift";
  return mesh;
}

/** THE FROST SHEEN: ONE quad over a whole floor plate.
 *
 *  THE HIGHEST-VALUE SINGLE OBJECT IN THE SEASON, and the first capture is what proved it. At the
 *  office camera the building is mostly FLOOR — and a floor that stays warm cream keeps the whole
 *  frame reading as "the ordinary office with white things in it" no matter how much decoration is
 *  standing on it. One cool wash shifts that entire surface to pearl for one draw call and two
 *  triangles, and it is the cheapest thing here by an order of magnitude.
 *
 *  IT HIDES NOTHING. Low opacity, no depth write, and it lies at ankle height under everything — every
 *  floorboard, rug, decal and shadow underneath still reads through it, and every object standing on
 *  the floor draws in front of it. */
export function frostCarpet(M: ChristmasMaterials, rect: { x: number; z: number; w: number; d: number }, y = 0.28): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(rect.w, rect.d), M.sheen);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(rect.x + rect.w / 2, y, rect.z + rect.d / 2);
  mesh.renderOrder = 1;
  mesh.name = "xm:frost-carpet";
  return mesh;
}

/** A SPARKLE PATCH: scattered pinpoint highlights as ONE faint quad.
 *
 *  The brief asks for subtle sparkling highlights; this is the restrained way to have them. A particle
 *  system would cost a per-frame simulation and a second transparent layer over the whole office for
 *  an effect that, at this camera, is a handful of bright pixels. Twelve static quads is the same
 *  picture for twenty-four triangles. */
export function sparklePatch(M: ChristmasMaterials, x: number, z: number, size: number, y = 0.6): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), M.sparkle);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = (x * 5 + z * 3) % Math.PI;
  mesh.position.set(x, y, z);
  mesh.renderOrder = 2;
  mesh.name = "xm:sparkle";
  return mesh;
}
