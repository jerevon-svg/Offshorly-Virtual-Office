// vo3d season/halloween — THE DECORATION BUILDERS. Procedural, baked, nav-inert, visual-only.
//
// ══ THE THREE RULES THESE OBEY, inherited from build/detail-props.ts ══
//
//  1. READABLE AT THE GAME CAMERA. ~2 px per world unit, looking down from the south at 52°. Everything
//     is sized in TENS of world units and puts its information on a south- or up-facing surface. A
//     detail that only reads at eye level is wasted; one that only reads from above is a floor plan.
//  2. CHEAP BY CONSTRUCTION. Repeated pieces are INSTANCED (bats, webs), clustered pieces are BAKED
//     into one mesh per material, and nothing here creates a real-time light — every glow is an
//     emissive surface plus an additive plane, the same trick build/led.ts uses for the whole office.
//  3. WORLD COORDINATES, NAV-INERT. nav/solids.ts never reads a THREE object, so nothing built here can
//     block a cell, narrow a doorway, occupy a seat or move an interaction — whatever it is and wherever
//     it is put. That is a property of the architecture, not of the care taken here.
//
// ══ AND THE ONE VISIBILITY RULE THAT IS NOT AUTOMATIC ══
//
//  Nav-inertness does not stop a decoration STANDING IN FRONT OF SOMEBODY. So every floor-standing piece
//  is short (under ~14 units, well below an avatar's head), every hanging piece is high (above 30, clear
//  of nameplates), and nothing is placed in the middle of a floor — see season/placement.ts, which is
//  where "where" is decided. This module only answers "what".
import * as THREE from "three";
import { Baker, cyl, rbox, shadowed } from "../../build/helpers";
import type { HalloweenMaterials } from "./materials";

/** Deterministic PRNG. A rebuild must be identical or a screenshot comparison means nothing, and
 *  build/helpers' own `rnd` is shared with the room builders' seed — reusing it here would shift every
 *  plant in the office the moment a season was added. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---- pumpkins ---------------------------------------------------------------------------------------

/** One pumpkin body: a squashed sphere at LOW segment count, which is what gives it ribs.
 *  A high-poly sphere reads as a beach ball; twelve segments read as a pumpkin from any distance. */
function pumpkinBody(r: number, material: THREE.Material, x: number, y0: number, z: number, squash = 0.74): THREE.Mesh {
  const geo = new THREE.SphereGeometry(r, 12, 8);
  geo.scale(1, squash, 1);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y0 + r * squash, z);
  return shadowed(mesh, false, true);
}

function pumpkinStem(r: number, material: THREE.Material, x: number, y0: number, z: number, squash = 0.74): THREE.Mesh {
  const h = r * 0.55;
  const stem = cyl(r * 0.17, h, material, x, y0 + r * squash * 1.86, z, r * 0.12);
  stem.rotation.z = 0.22;
  return shadowed(stem, false, true);
}

export interface PumpkinSpec {
  x: number;
  z: number;
  /** body radius in world units. 3–7 is a real pumpkin at this office's scale. */
  r: number;
  y0?: number;
  tone?: "pumpkin" | "deep" | "pale" | "cream" | "green";
}

/** A CLUSTER of plain pumpkins and gourds, baked to one mesh per material.
 *  The reference piles them: never one pumpkin alone, always two or three of different sizes touching. */
export function pumpkinCluster(M: HalloweenMaterials, specs: readonly PumpkinSpec[]): THREE.Group {
  const g = new THREE.Group();
  g.name = "hw:pumpkins";
  const baker = new Baker();
  const tone = (t: PumpkinSpec["tone"]): THREE.Material =>
    t === "deep" ? M.pumpkinDeep : t === "pale" ? M.pumpkinPale : t === "cream" ? M.gourdCream : t === "green" ? M.gourdGreen : M.pumpkin;
  for (const s of specs) {
    const y0 = s.y0 ?? 0;
    baker.add(pumpkinBody(s.r, tone(s.tone), s.x, y0, s.z));
    baker.add(pumpkinStem(s.r, M.stem, s.x, y0, s.z));
  }
  baker.bakeInto(g, "hw-pumpkins");
  return g;
}

/** A LIT JACK-O'-LANTERN: body, carved face, and the pool of light it throws on the floor.
 *
 *  THE POOL IS THE POINT. In the reference the pumpkins are not bright objects in a lit room — they are
 *  the light source, and what sells that is the warm circle on the floorboards around each one. The face
 *  alone, with no pool, reads as a sticker. */
export function jackOLantern(M: HalloweenMaterials, x: number, z: number, r = 5.4, y0 = 0): THREE.Group {
  const g = new THREE.Group();
  g.name = "hw:jack";
  const squash = 0.74;
  g.add(pumpkinBody(r, M.pumpkinLit, x, y0, z, squash));
  g.add(pumpkinStem(r, M.stem, x, y0, z, squash));

  // THE CARVED FACE, on the SOUTH side — the office camera looks from the south, so a face carved
  // anywhere else would be a light the player never sees.
  const cy = y0 + r * squash;
  const face = new THREE.Group();
  const eye = (dx: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(-r * 0.26, -r * 0.2); shape.lineTo(r * 0.26, -r * 0.2); shape.lineTo(0, r * 0.3); shape.closePath();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), M.ember);
    m.position.set(x + dx, cy + r * 0.24, z + r * 1.01);
    return m;
  };
  face.add(eye(-r * 0.32), eye(r * 0.32));
  const mouth = new THREE.Shape();
  mouth.moveTo(-r * 0.52, 0);
  mouth.lineTo(-r * 0.26, -r * 0.28); mouth.lineTo(-r * 0.06, 0);
  mouth.lineTo(r * 0.16, -r * 0.3); mouth.lineTo(r * 0.36, 0);
  mouth.lineTo(r * 0.52, r * 0.17); mouth.lineTo(-r * 0.52, r * 0.17);
  mouth.closePath();
  const mouthMesh = new THREE.Mesh(new THREE.ShapeGeometry(mouth), M.ember);
  mouthMesh.position.set(x, cy - r * 0.3, z + r * 1.01);
  face.add(mouthMesh);
  g.add(face);

  // THE LIGHT ON THE FLOOR. Flat, additive, depth-write off, lifted a hair so it never z-fights the
  // floorboards. Generously wider than the pumpkin: a candle inside a gourd throws a soft wide pool.
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(r * 9.5, r * 9.5), M.glow);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(x, y0 + 0.35, z);
  pool.renderOrder = 2;
  g.add(pool);

  // A HALO AROUND THE LANTERN ITSELF, billboarded upright, so the glow survives being looked at from
  // eye level in Player view where a floor pool is edge-on and nearly invisible.
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(r * 5, r * 5), M.glowWarm);
  halo.position.set(x, cy, z);
  halo.renderOrder = 2;
  halo.userData.hwBillboard = true;
  g.add(halo);
  return g;
}

// ---- candles ----------------------------------------------------------------------------------------

export interface CandleSpec { x: number; z: number; h: number; r?: number; y0?: number }

/** A CANDLE ROW — wax cylinders with emissive flames and one shared pool. The reference lines them
 *  along every ledge and clusters them on the floor; they are the small warm punctuation between the
 *  big pumpkin lights. */
export function candles(M: HalloweenMaterials, specs: readonly CandleSpec[]): THREE.Group {
  const g = new THREE.Group();
  g.name = "hw:candles";
  const waxBaker = new Baker();
  const flameBaker = new Baker();
  for (const s of specs) {
    const r = s.r ?? 1.15;
    const y0 = s.y0 ?? 0;
    waxBaker.add(shadowed(cyl(r, s.h, M.wax, s.x, y0, s.z), false, true));
    // The flame is a tiny cone; at this scale its SHAPE never reads, only its brightness — which is why
    // it is emissive rather than a light, and why it is worth so little geometry.
    const flame = cyl(r * 0.42, r * 1.5, M.ember, s.x, y0 + s.h, s.z, 0.01);
    flameBaker.add(flame);
  }
  waxBaker.bakeInto(g, "hw-wax");
  flameBaker.bakeInto(g, "hw-flame");
  // ONE pool for the whole row rather than one per candle: a dozen overlapping additive quads in a
  // corner turns into a white blob, and costs a dozen draw calls to do it.
  if (specs.length > 0) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, topY = 0;
    for (const s of specs) {
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
      topY = Math.max(topY, (s.y0 ?? 0) + s.h);
    }
    const w = Math.max(maxX - minX, 6) + 26, d = Math.max(maxZ - minZ, 6) + 26;
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M.glowWarm);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set((minX + maxX) / 2, (specs[0].y0 ?? 0) + 0.3, (minZ + maxZ) / 2);
    pool.renderOrder = 2;
    g.add(pool);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 16), M.glowWarm);
    halo.position.set((minX + maxX) / 2, topY, (minZ + maxZ) / 2);
    halo.renderOrder = 2;
    halo.userData.hwBillboard = true;
    g.add(halo);
  }
  return g;
}

// ---- webs -------------------------------------------------------------------------------------------

/** A CORNER WEB: a quarter-disc quad tucked into a vertical corner at 45°, so it spans both walls the
 *  way a real one does. `size` is how far down the walls it reaches. */
export function cornerWeb(M: HalloweenMaterials, x: number, y: number, z: number, size: number, facing: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size);
  // The web texture is anchored at ITS OWN corner (0,0), so the quad is shifted to put that corner at
  // the room corner rather than at the quad's centre.
  geo.translate(size / 2, -size / 2, 0);
  const mesh = new THREE.Mesh(geo, M.web);
  mesh.position.set(x, y, z);
  mesh.rotation.y = facing;
  mesh.renderOrder = 1;
  return mesh;
}

/** A HANGING WEB SWAG: a sagging sheet strung between two ceiling points.
 *
 *  This is the single most important element for matching the reference, whose entire upper third is
 *  draped webbing — it is what turns "a room with pumpkins in it" into "a room that has been taken
 *  over". Built as a catenary ribbon: `segments` quads following a cosh sag, one strip, one draw call. */
export function webSwag(
  M: HalloweenMaterials,
  from: THREE.Vector3,
  to: THREE.Vector3,
  sag: number,
  drop: number,
  segments = 14,
): THREE.Mesh {
  const span = Math.hypot(to.x - from.x, to.z - from.z);
  const repeats = Math.max(1, Math.round(span / 150));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // A parabola is indistinguishable from a catenary over a single span and costs one multiply.
    const y = from.y + (to.y - from.y) * t - sag * 4 * t * (1 - t);
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    pos.push(x, y, z, x, y - drop, z);
    // TILED ALONG THE RUN, not stretched: a 200-unit swag carrying one copy of a 256px net has
    // threads as thick as floorboards. `repeats` keeps a thread the same width on every span.
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
  const mesh = new THREE.Mesh(geo, M.webSheet);
  mesh.renderOrder = 1;
  return mesh;
}

/** A DARK FABRIC SWAG, same geometry as a web swag in the shroud material — the heavy black drapery
 *  that frames the reference's ceiling behind the webs and gives the upper band depth rather than one
 *  flat layer of cobweb. */
export function drapeSwag(M: HalloweenMaterials, from: THREE.Vector3, to: THREE.Vector3, sag: number, drop: number): THREE.Mesh {
  const mesh = webSwag(M, from, to, sag, drop, 10);
  mesh.material = M.shroud;
  mesh.renderOrder = 0;
  return mesh;
}

// ---- bats -------------------------------------------------------------------------------------------

export interface BatSpec { x: number; y: number; z: number; size: number; yaw: number; roll?: number; pitch?: number }

/** A FLOCK as ONE InstancedMesh. The reference scatters dozens up the back wall in a rising diagonal,
 *  smaller toward the top — the classic "flying away" read, and it costs one draw call for all of them. */
export function batFlock(M: HalloweenMaterials, specs: readonly BatSpec[]): THREE.InstancedMesh | null {
  if (specs.length === 0) return null;
  const geo = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geo, M.bat, specs.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  specs.forEach((b, i) => {
    // PITCH IS WHAT MAKES A BAT VISIBLE FROM ABOVE. A wall-flat quad is edge-on to the office
    // camera's 52° look-down and disappears entirely; tipping it back toward the camera keeps the
    // silhouette readable from the game view AND from eye level in Player mode.
    e.set(b.pitch ?? 0, b.yaw, b.roll ?? 0);
    q.setFromEuler(e);
    s.set(b.size, b.size, b.size);
    p.set(b.x, b.y, b.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false; // a flock spans a room; its instance bounds are not worth computing
  mesh.renderOrder = 1;
  mesh.name = "hw:bats";
  return mesh;
}

// ---- lanterns on stands -------------------------------------------------------------------------------

/** A STANDING CANDLE LANTERN: the dark metal-and-glass box the reference puts on side tables and in
 *  corners. A shroud-coloured frame around an emissive core, plus its halo. */
export function lantern(M: HalloweenMaterials, x: number, z: number, y0: number, h = 9): THREE.Group {
  const g = new THREE.Group();
  g.name = "hw:lantern";
  const w = h * 0.52;
  const baker = new Baker();
  baker.add(shadowed(rbox(w, h * 0.09, w, M.shroudDeep, x, y0, z, 0.3), false, true));   // base
  baker.add(shadowed(rbox(w, h * 0.1, w, M.shroudDeep, x, y0 + h * 0.9, z, 0.3), false, true)); // cap
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    baker.add(rbox(w * 0.1, h * 0.82, w * 0.1, M.shroudDeep, x + dx * w * 0.44, y0 + h * 0.08, z + dz * w * 0.44, 0.1));
  }
  baker.bakeInto(g, "hw-lantern");
  const core = cyl(w * 0.2, h * 0.4, M.ember, x, y0 + h * 0.2, z);
  g.add(core);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(h * 2.6, h * 2.6), M.glowWarm);
  halo.position.set(x, y0 + h * 0.42, z);
  halo.renderOrder = 2;
  halo.userData.hwBillboard = true;
  g.add(halo);
  return g;
}

// ---- the haunted vocabulary (Phase 9B final pass) -----------------------------------------------
//
// The first pass proved the architecture but left rooms reading as "an office with pumpkins in it".
// These are the pieces that change the READ: dead vegetation where the office keeps live plants,
// bone where it keeps ornament, and spectral light where it keeps none. Each one still obeys the
// three rules at the top of this file — readable from above, cheap, nav-inert.

/** A WITHERED PLANT: bare crooked stalks and a few curled leaves in a pot-sized footprint.
 *
 *  The single highest-value piece in the set, because the office is FULL of healthy greenery and a
 *  dead one beside a live one is the clearest possible statement that something has happened here. */
export function witheredPlant(M: HalloweenMaterials, x: number, z: number, h = 13, rng: () => number = Math.random): THREE.Group {
  const g = new THREE.Group();
  g.name = "hw:withered";
  const baker = new Baker();
  const stalks = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < stalks; i++) {
    const a = (i / stalks) * Math.PI * 2 + rng();
    const lean = 0.18 + rng() * 0.3;
    const sh = h * (0.55 + rng() * 0.6);
    const stalk = cyl(0.42, sh, M.witheredStalk, x, 0, z, 0.2);
    stalk.rotation.z = Math.cos(a) * lean;
    stalk.rotation.x = Math.sin(a) * lean;
    stalk.position.x += Math.cos(a) * 1.6;
    stalk.position.z += Math.sin(a) * 1.6;
    baker.add(shadowed(stalk, false, true));
    // Two or three curled leaves clinging near the top — what makes it "dying" rather than "sticks".
    if (i % 2 === 0) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1.5 + rng(), 5, 3), M.witheredLeaf);
      leaf.scale.set(1, 0.28, 0.6);
      leaf.position.set(x + Math.cos(a) * (2.2 + lean * sh), sh * 0.82, z + Math.sin(a) * (2.2 + lean * sh));
      leaf.rotation.y = a;
      baker.add(shadowed(leaf, false, true));
    }
  }
  baker.bakeInto(g, "hw-withered");
  return g;
}

/** A SKULL, and optionally a couple of bones beside it. Sized as an ornament, not a prop: it sits on
 *  a shelf edge or at the foot of a wall and is read at a glance. */
export function skull(M: HalloweenMaterials, x: number, z: number, y0 = 0, r = 2.6): THREE.Group {
  const g = new THREE.Group();
  g.name = "hw:skull";
  const baker = new Baker();
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(r, 9, 7), M.bone);
  cranium.scale.set(1, 0.95, 1.06);
  cranium.position.set(x, y0 + r, z);
  baker.add(shadowed(cranium, false, true));
  const jaw = rbox(r * 1.2, r * 0.5, r * 0.9, M.bone, x, y0 + r * 0.12, z + r * 0.34, 0.3);
  baker.add(shadowed(jaw, false, true));
  // Eye sockets: two dark spheres set INTO the face, which is the whole of what makes a pale ball
  // read as a skull at this size.
  for (const dx of [-r * 0.38, r * 0.38]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(r * 0.3, 7, 5), M.shroudDeep);
    socket.position.set(x + dx, y0 + r * 1.12, z + r * 0.82);
    baker.add(socket);
  }
  baker.bakeInto(g, "hw-skull");
  return g;
}

/** A GHOST: a hovering, softly glowing shroud with a spectral pool under it.
 *
 *  Deliberately abstract — a draped teardrop, not a character. It is a LIGHT with a shape, which is
 *  what keeps it eerie instead of cartoonish, and it is the only place the palette's green appears
 *  at strength. */
export function ghost(M: HalloweenMaterials, x: number, z: number, y = 16, h = 13): THREE.Group {
  const g = new THREE.Group();
  g.name = "hw:ghost";
  const body = new THREE.Mesh(new THREE.SphereGeometry(h * 0.42, 10, 8), M.ghost);
  body.scale.set(1, 1.25, 1);
  body.position.set(x, y, z);
  g.add(body);
  // The tattered hem: three shorter lobes below the body so it does not end in a clean ball.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(h * 0.2, 7, 5), M.ghost);
    lobe.scale.set(1, 1.5, 1);
    lobe.position.set(x + Math.cos(a) * h * 0.22, y - h * 0.5, z + Math.sin(a) * h * 0.22);
    g.add(lobe);
  }
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(h * 3.4, h * 3.4), M.glowSpectral);
  halo.position.set(x, y, z);
  halo.renderOrder = 2;
  halo.userData.hwBillboard = true;
  g.add(halo);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(h * 4, h * 4), M.glowSpectral);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(x, 0.4, z);
  pool.renderOrder = 2;
  g.add(pool);
  return g;
}

/** GROUND FOG: a flat, very faint disc lying just above the floor.
 *
 *  Restrained on purpose — the brief's word. Fog that reads as fog from the office camera is fog
 *  that hides the floor, so this is barely-there and used to soften corners, not to fill rooms. */
export function groundFog(M: HalloweenMaterials, x: number, z: number, size: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), M.fog);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.5, z);
  mesh.renderOrder = 1;
  mesh.name = "hw:fog";
  return mesh;
}

/** A SCARECROW: a crossed frame, a sack head with a stitched glow, and a ragged shroud.
 *
 *  One per room at most, and only in the rooms whose composition wants a figure. A silhouette at
 *  avatar height is the most unsettling thing in the vocabulary, so it is also the most rationed —
 *  and it is always placed against a wall, never where it could be mistaken for a coworker. */
export function scarecrow(M: HalloweenMaterials, x: number, z: number, h = 30): THREE.Group {
  const g = new THREE.Group();
  g.name = "hw:scarecrow";
  const baker = new Baker();
  baker.add(shadowed(cyl(0.9, h * 0.78, M.witheredStalk, x, 0, z), false, true));
  const arms = rbox(h * 0.52, 1.5, 1.5, M.witheredStalk, x, h * 0.55, z, 0.3);
  baker.add(shadowed(arms, false, true));
  const shroudBody = new THREE.Mesh(new THREE.SphereGeometry(h * 0.17, 8, 6), M.shroud);
  shroudBody.scale.set(1, 1.5, 0.8);
  shroudBody.position.set(x, h * 0.48, z);
  baker.add(shadowed(shroudBody, false, true));
  baker.bakeInto(g, "hw-scarecrow");
  // The sack head is its own mesh so the emissive stitch can sit proud of it.
  const head = new THREE.Mesh(new THREE.SphereGeometry(h * 0.115, 9, 7), M.gourdCream);
  head.position.set(x, h * 0.83, z);
  g.add(shadowed(head, false, true));
  const eyes = new THREE.Mesh(new THREE.PlaneGeometry(h * 0.13, h * 0.045), M.ember);
  eyes.position.set(x, h * 0.86, z + h * 0.118);
  g.add(eyes);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(h * 0.7, h * 0.7), M.glowWarm);
  halo.position.set(x, h * 0.85, z);
  halo.renderOrder = 2;
  halo.userData.hwBillboard = true;
  g.add(halo);
  return g;
}

/** A FLOOR DECAY PATCH: a dark, irregular stain lying flat on the boards.
 *
 *  A MATERIAL OVERLAY, not a surface change: it is a separate transparent quad above the floor, so
 *  the floor's own material, its collision and everything walking on it are untouched. Kept faint
 *  enough that the floor underneath stays readable, which is the constraint the brief sets. */
export function floorDecay(M: HalloweenMaterials, x: number, z: number, size: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), M.fog);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = (x * 7 + z * 3) % Math.PI;
  mesh.position.set(x, 0.25, z);
  mesh.renderOrder = 1;
  mesh.name = "hw:decay";
  return mesh;
}
