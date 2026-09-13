// vo3d build — THE BOXING CHAMPIONSHIP MONUMENT: the Central Hub's hero centrepiece.
//
// A commemorative company monument, NOT a functional ring: a miniature stepped ring platform with four
// corner posts and three ropes a side, two chibi "boss" statues squaring up inside it, and a plaque set
// into the floor in front. Everything is one monochrome cast-stone material, exactly as the reference is.
//
// SCALE IS THE WHOLE POINT. The reference reads as a sculpture on a plinth, so the ring is sized to sit
// well inside the bench island with a walkable apron all round it — see MONUMENT in rooms/central-hub.ts
// for the numbers and why the footprint is what it is.
//
// ⚠ THE TWO BOSS STATUES ARE TEMPORARY PLACEHOLDERS. Everything else here — the plinth, the stepped base,
// the canvas, the posts, the ropes and the plaque — is the real, final procedural asset. The figures are
// primitives standing in for sculpted GLB statues, and they live in their own ANCHOR GROUPS so that swap
// costs one call (see bossAnchor / replaceBossStatue) and rebuilds no ring geometry. They are deliberately
// NOT part of the ring's bake.
//
// Procedural three.js only. No generated assets.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { Baker, cyl, rbox, shadowed } from "./helpers";
import { flatRing, ringShape } from "./arc";
import { canvas2d, contactShadowMat, mat, type MatKey } from "../render/Materials";
import { BOSS_SLOTS, MONUMENT, THEME, bossUrl, type BossSlot } from "../rooms/central-hub";
import { DRACO_PATH } from "../adapters/v1Avatar";

const key = (k: keyof typeof THEME): MatKey => THEME[k] as MatKey;
const stoneMat = () => mat(key("monument"), 0.82);
const stoneDeep = () => mat(key("shellDark"), 0.88);

/** A sphere. helpers.sphereGeo is an 80-face icosahedron (chair castors); a chibi head needs to read round. */
function ball(r: number, x: number, y: number, z: number, m: THREE.Material, seg = 16): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4)), m);
  mesh.position.set(x, y, z);
  return shadowed(mesh);
}
/** A capsule-ish limb spanning two points. Building an arm by rotating a cylinder about one axis puts the
 *  glove wherever the trigonometry lands; spanning shoulder → elbow → glove puts it where the pose needs
 *  it, which is the difference between a boxer's guard and two planks sticking out sideways. */
function strut(a: [number, number, number], bp: [number, number, number], r: number, m: THREE.Material): THREE.Mesh {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...bp);
  const dir = to.clone().sub(from);
  const len = dir.length();
  const mesh = cyl(r, len, m, 0, 0, 0);
  mesh.geometry = mesh.geometry.clone();
  mesh.geometry.translate(0, len / 2, 0); // base at the origin, running up +y
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.position.copy(from);
  return mesh;
}

/** A horizontal bar (rope / rail) running along one axis. */
function bar(axis: "x" | "z", len: number, r: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = cyl(r, len, m, 0, 0, 0);
  mesh.geometry = mesh.geometry.clone();
  mesh.rotation[axis === "x" ? "z" : "x"] = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

// ---- the two bosses -------------------------------------------------------------------------------
/** PLACEHOLDER boss statue: primitives standing in for a sculpted GLB, facing LOCAL −z. Big head, stubby
 *  limbs, gloves up in a guard. It carries the slot's distinguishing features (wavy hair / bald + glasses)
 *  so the composition reads while the real asset is outstanding — it is not, and is not trying to be, the
 *  reference's fidelity. Normalised to the slot's height so the swap changes nothing about the layout. */
function bossPlaceholder(opts: { wavyHair: boolean; glasses: boolean }): THREE.Group {
  const g = new THREE.Group();
  const b = new Baker();
  const s = stoneMat();
  // stance: feet apart, the lead foot forward
  for (const sx of [-1, 1]) {
    const fz = sx < 0 ? -1.4 : 1.2;
    b.add(rbox(4.4, 2.4, 6.6, s, sx * 2.7, 0, fz, 1.0, 3)); // boot
    b.add(rbox(4.6, 0.8, 6.8, s, sx * 2.7, 2.0, fz, 0.3)); // boot cuff
    b.add(cyl(1.6, 3.8, s, sx * 2.7, 2.4, fz * 0.5, 1.9)); // shin
  }
  b.add(rbox(8.2, 4.2, 6.2, s, 0, 5.6, 0, 2.0, 3)); // shorts
  b.add(rbox(8.6, 1.1, 6.6, s, 0, 8.6, 0, 0.4)); // waistband
  b.add(rbox(7.4, 4.8, 5.6, s, 0, 9.6, 0, 2.2, 3)); // torso
  b.add(cyl(1.3, 1.2, s, 0, 14.2, 0.2, 1.4)); // neck
  // ARMS IN A GUARD: shoulder → elbow tucked low and in → forearm up and forward → glove at the chin,
  // which is the pose the reference holds. Both gloves sit in front of the face, not out to the sides.
  for (const sx of [-1, 1]) {
    const shoulder: [number, number, number] = [sx * 3.6, 12.9, 0.2];
    const elbow: [number, number, number] = [sx * 4.0, 9.6, -1.4];
    const glove: [number, number, number] = [sx * 2.2, 14.1, -3.2];
    b.add(ball(2.1, shoulder[0], shoulder[1], shoulder[2], s, 12));
    b.add(strut(shoulder, elbow, 1.45, s)); // upper arm
    b.add(ball(1.5, elbow[0], elbow[1], elbow[2], s, 10));
    b.add(strut(elbow, glove, 1.4, s)); // forearm
    b.add(ball(2.6, glove[0], glove[1], glove[2], s, 14)); // glove
    b.add(rbox(2.0, 1.6, 2.0, s, glove[0], glove[1] - 2.9, glove[2] + 0.6, 0.6)); // wrist wrap
  }
  const headY = 18.0, headR = 3.6;
  b.add(ball(headR, 0, headY, 0, s, 18));
  b.add(rbox(1.6, 1.0, 0.9, s, 0, headY - 1.2, -headR + 0.2, 0.4)); // nose
  for (const sx of [-1, 1]) b.add(ball(0.9, sx * headR * 0.92, headY - 0.4, 0.2, s, 10)); // ears
  if (opts.wavyHair) {
    // a cap of overlapping lobes over the crown and down the back — the reference's full wavy mop
    const lobes: [number, number, number, number][] = [
      [2.3, 0, 3.0, 0.3], [2.0, -2.3, 2.4, -0.6], [2.0, 2.3, 2.4, -0.6], [1.9, -2.0, 2.0, 2.2],
      [1.9, 2.0, 2.0, 2.2], [1.7, 0, 1.4, 3.1], [1.5, -3.1, 0.6, 1.0], [1.5, 3.1, 0.6, 1.0],
      [1.4, -1.5, 3.0, -2.0], [1.4, 1.5, 3.0, -2.0],
    ];
    for (const [r, dx, dy, dz] of lobes) b.add(ball(r, dx, headY + dy, dz, s, 10));
  }
  if (opts.glasses) {
    const lens = new THREE.TorusGeometry(1.15, 0.22, 8, 16);
    for (const sx of [-1, 1]) {
      const l = shadowed(new THREE.Mesh(lens.clone(), s));
      l.position.set(sx * 1.35, headY - 0.3, -headR + 0.35);
      b.add(l);
      b.add(rbox(0.3, 0.28, 2.6, s, sx * 2.4, headY - 0.4, -headR + 1.6, 0.12)); // temple arm
    }
    b.add(rbox(1.1, 0.26, 0.26, s, 0, headY - 0.3, -headR + 0.35, 0.1)); // bridge
  }
  b.bakeInto(g, "boss-placeholder");
  g.scale.setScalar(MONUMENT.statueScale);
  return g;
}

/** A boss ANCHOR: an empty, stably-named Group carrying nothing but the slot's transform, with whatever
 *  currently represents that boss as its ONLY child. This is the seam. The anchor is what the ring
 *  contains; the figure is what the anchor contains.
 *
 *  Marked on `userData` so tooling (and the future GLB loader) can find every outstanding placeholder
 *  without knowing anything about the Central Hub. */
export function bossAnchor(slot: BossSlot): THREE.Group {
  const a = new THREE.Group();
  a.name = slot.id;
  a.position.set(slot.x, MONUMENT.deckY, slot.z);
  a.rotation.y = slot.yaw;
  a.userData.bossSlot = slot.id;
  a.userData.placeholder = true;
  const fig = bossPlaceholder({ wavyHair: slot.hair === "wavy", glasses: slot.glasses });
  fig.name = `${slot.id}/placeholder`;
  a.add(fig);
  return a;
}

/** DROP-IN REPLACEMENT. Hand it the scene (or the monument group) and a loaded statue, and the placeholder
 *  in that slot is swapped out — transform, facing and footprint untouched, no monument geometry rebuilt.
 *  The model is scaled so its bounding box stands `slot.height` tall with its feet on the deck, so a GLB's
 *  own authored units never leak into the layout.
 *
 *  Nothing calls this yet: it is the seam the sculpted statues land on. */
export function replaceBossStatue(root: THREE.Object3D, slot: BossSlot, model: THREE.Object3D): THREE.Group {
  const anchor = root.getObjectByName(slot.id) as THREE.Group | undefined;
  if (!anchor) throw new Error(`hub monument: no boss anchor "${slot.id}"`);
  for (const child of [...anchor.children]) anchor.remove(child);
  const box = new THREE.Box3().setFromObject(model);
  const h = box.max.y - box.min.y;
  if (h > 0) model.scale.multiplyScalar(slot.height / h);
  model.position.y -= box.min.y * (h > 0 ? slot.height / h : 1); // stand it ON the deck, not through it
  model.name = `${slot.id}/statue`;
  anchor.add(model);
  anchor.userData.placeholder = false;
  return anchor;
}

// ---- the plaque -----------------------------------------------------------------------------------
function plaqueTexture(): THREE.CanvasTexture | null {
  const W = 1400, H = 170;
  const ctx = canvas2d(W, H);
  if (!ctx) return null;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#4a443c";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "600 74px Georgia, 'Times New Roman', serif";
  ctx.letterSpacing = "8px";
  // measure and shrink to fit rather than trusting one hard-coded size: a clipped monument plaque reading
  // "NG CHAMPION" is the kind of thing a screenshot catches and a unit test never will
  let size = 74;
  while (ctx.measureText("BOXING CHAMPIONSHIP").width > W - 300 && size > 30) { size -= 2; ctx.font = `600 ${size}px Georgia, 'Times New Roman', serif`; }
  ctx.fillText("BOXING CHAMPIONSHIP", W / 2, H / 2 + 4);
  ctx.letterSpacing = "0px";
  ctx.font = `${Math.round(size * 0.8)}px Georgia, serif`;
  ctx.fillText("★", 110, H / 2);
  ctx.fillText("★", W - 110, H / 2);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** The commemorative plaque, set FLAT into the floor just south of the ring — where the reference puts it
 *  on the plinth's front edge, and where the game camera (pitch 52, looking north) actually reads it. */
function plaque(): THREE.Group {
  const g = new THREE.Group();
  g.name = "hub-monument-plaque";
  const p = MONUMENT.plaque;
  const band = rbox(p.w, 0.5, p.d, mat(key("shell"), 0.8), 0, MONUMENT.discY, p.z, 0.6);
  band.castShadow = false;
  g.add(band);
  const tex = plaqueTexture();
  if (tex) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(p.w - 2, (p.w - 2) * (170 / 1400)), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    face.rotation.x = -Math.PI / 2;
    face.position.set(0, MONUMENT.discY + 0.55, p.z);
    face.castShadow = face.receiveShadow = false;
    g.add(face);
  }
  return g;
}

// ---- the monument ----------------------------------------------------------------------------------
export function hubMonument(): THREE.Group {
  const g = new THREE.Group();
  g.name = "hub-monument";
  const M = MONUMENT;
  g.position.set(M.centre.x, 0, M.centre.z);
  const s = stoneMat();
  const b = new Baker();

  // the flush stone medallion the monument stands on. It is FLOOR — 0.35 proud, never a step — so the
  // apron inside the bench ring stays walkable right up to the ring's own base.
  const disc = cyl(M.discR, M.discY, mat(key("plate"), 0.6), 0, 0, 0);
  disc.castShadow = false;
  g.add(disc);
  // its edge trim. MUST be a ring: cyl()'s rTop only TAPERS a solid cylinder, so using it here paints a
  // 42-radius bronze disc over the whole medallion instead of a 1.1-wide line around it.
  const discRim = flatRing(ringShape(0, 0, M.discR - 1.1, M.discR, 0, Math.PI * 2), 0.14, mat(key("inlay"), 0.35, { metalness: 0.55 }), M.discY, 56);
  discRim.castShadow = false;
  g.add(discRim);

  // stepped base
  b.add(rbox(M.base, M.baseH, M.base, s, 0, M.discY, 0, 1.0));
  b.add(rbox(M.step, M.stepH, M.step, s, 0, M.discY + M.baseH, 0, 0.9));
  // the canvas, very slightly proud of the step with a shadow reveal under its lip
  b.add(rbox(M.canvas + 1.6, 0.7, M.canvas + 1.6, stoneDeep(), 0, M.deckY - M.canvasH - 0.7, 0, 0.3));
  b.add(rbox(M.canvas, M.canvasH, M.canvas, s, 0, M.deckY - M.canvasH, 0, 0.7));

  // four corner posts with turned collars and caps
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * M.post, z = sz * M.post;
      b.add(cyl(M.postR + 0.7, 1.1, s, x, M.deckY, z)); // foot collar
      b.add(cyl(M.postR, M.postH, s, x, M.deckY, z, M.postR * 0.92));
      b.add(cyl(M.postR + 0.9, 1.4, s, x, M.deckY + M.postH - 1.4, z)); // head collar
      b.add(ball(M.postR + 0.6, x, M.deckY + M.postH + 0.5, z, s, 12)); // cap knob
    }
  // three ropes a side, strung post to post
  for (const h of M.ropes)
    for (const sn of [-1, 1]) {
      b.add(bar("x", M.post * 2, M.ropeR, s, 0, M.deckY + h, sn * M.post));
      b.add(bar("z", M.post * 2, M.ropeR, s, sn * M.post, M.deckY + h, 0));
    }
  b.bakeInto(g, "ring");

  // The two bosses, squaring up across the canvas. Added as ANCHORS, after the ring's bake and outside it,
  // so replaceBossStatue() can swap either figure for a sculpted GLB without touching a single rope.
  for (const slot of BOSS_SLOTS) g.add(bossAnchor(slot));

  g.add(plaque());
  const sh = cyl(M.base * 0.78, 0.02, contactShadowMat(0.16), 0, M.discY + 0.02, 0);
  sh.castShadow = sh.receiveShadow = false;
  g.add(sh);
  return g;
}

// ---- the sculpted asset ----------------------------------------------------------------------------
// Each boss is its own generated GLB, dropped into its own anchor. A statue arrives at whatever scale and
// origin the generator chose, so it is normalised here: scaled to the slot height, centred on the anchor
// and stood on the deck. The ring never knows any of this happened.

let loader: GLTFLoader | null = null;
function gltfLoader(): GLTFLoader {
  if (loader) return loader;
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}

/** The generator exports its subject facing +Z (it reconstructs what the camera saw, pointing out of the
 *  screen). The anchors are authored for the PLACEHOLDER's −Z forward, so a loaded statue needs a half
 *  turn — without it both bosses stand back to back, squaring up to the benches. */
export const STATUE_YAW_OFFSET = Math.PI;

/** Seat a loaded statue in its anchor: half-turned to the anchor's forward, one uniform scale to the slot
 *  height, centred in x/z, feet on the deck. Exported so the swap can be tested without a network fetch. */
export function applyBossStatue(root: THREE.Object3D, slot: BossSlot, statue: THREE.Object3D): THREE.Group {
  const anchor = root.getObjectByName(slot.id) as THREE.Group | undefined;
  if (!anchor) throw new Error(`hub monument: no boss anchor "${slot.id}"`);
  for (const child of [...anchor.children]) anchor.remove(child);
  statue.position.set(0, 0, 0);
  statue.rotation.y = STATUE_YAW_OFFSET;
  statue.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(statue);
  const h = box.max.y - box.min.y;
  if (h > 0) statue.scale.multiplyScalar(slot.height / h);
  statue.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(statue);
  statue.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  statue.name = `${slot.id}/statue`;
  // Make it the SAME STONE as the ring it stands in. The generated asset carries its own sculpt shading in
  // a baseColor map and that map is the detail worth keeping, so the stone tone is levelled INTO the map at
  // build time (scripts/vo3d/tone-boss-glb.mjs) rather than tinted here — `color` only ever multiplies, so
  // tinting a mid-grey map toward cream just darkens it into mud. Single-sided too: a solid statue never
  // needs back faces, and this is the one piece in the room with six-figure triangle counts.
  statue.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const std = mat as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial) continue;
      std.color.setHex(0xffffff); // the stone tone lives in the baked map (brightened at build time), not here
      std.roughness = 0.86;
      std.metalness = 0;
      std.side = THREE.FrontSide;
      std.needsUpdate = true;
    }
  });
  anchor.add(statue);
  anchor.userData.placeholder = false;
  return anchor;
}

/** Load both sculpted bosses and swap them in for the placeholders. Resolves false — leaving the
 *  placeholders standing — if an asset is missing: the monument must never depend on a file being there. */
export async function loadBossStatues(root: THREE.Object3D): Promise<boolean> {
  try {
    const scenes = await Promise.all(BOSS_SLOTS.map((s) => gltfLoader().loadAsync(bossUrl(s))));
    BOSS_SLOTS.forEach((slot, i) => applyBossStatue(root, slot, scenes[i].scene));
    return true;
  } catch (err) {
    console.warn("[vo3d] boss statues unavailable, keeping placeholders:", err);
    return false;
  }
}
