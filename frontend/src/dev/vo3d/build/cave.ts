// vo3d build — THE CHAMPIONSHIP CAVE, built in WORLD coordinates.
//
// A dark box with a 270° picture wrapped round three of its sides. The architecture is deliberately
// almost nothing: a floor, a ceiling with a service truss, a shell that disappears, a threshold, and a
// cool cove line at ankle height so the room still reads when the screen is black. Everything else the
// eye is meant to find is the video.
//
// DRAW-CALL BUDGET, because this room is entered while the whole office is still loaded:
//   1  the screen ribbon      (one mesh, one material, the shared VideoTexture)
//   1  its floor reflection   (one mesh, the SAME texture, additive, no second decode)
//   1  the screen's plinth + bezel + truss + vestibule reveal   (one bake, one material)
//   1  the shell: floor, ceiling, four walls                    (one bake, one material)
//   1  the cove line + threshold glow                           (one bake, one emissive material)
//   1  the back-wall cushion run                                (one bake, one material)
//   + a screen-wash glow plane
// Seven-ish meshes for a 28 × 22 m theatre. That is the point of building it as a ribbon rather than as
// three quads and a pile of trim.
//
// Procedural three.js only. No generated assets. The ONLY external file is the video (media/CaveMedia).
import * as THREE from "three";
import { Baker, rbox, shadowed } from "./helpers";
import { canvas2d, glowMat, emissiveMat, mat, type MatKey } from "../render/Materials";
import {
  FRONT_CHORD, ROOM, SCREEN, THEME, THRESHOLD, VIDEO_WIDTH, ORIGIN, screenPath, type ScreenSegment,
} from "../rooms/cave";

const key = (k: keyof typeof THEME): MatKey => THEME[k] as MatKey;

// ---- the screen path, sampled --------------------------------------------------------------------
/** One sample of the screen's plan path: where it is, which way the picture faces, and how far along
 *  the ribbon it sits. `s` is what makes the 270° mapping continuous — it is arc length, not an index,
 *  so the straight wings and the curved corners share one ruler. */
export type PathSample = { x: number; z: number; nx: number; nz: number; s: number };

/** Walk the path once, accumulating arc length. Interior-local. */
export function samplePath(segments: ScreenSegment[] = screenPath()): PathSample[] {
  const out: PathSample[] = [];
  let s = 0;
  const push = (x: number, z: number, tx: number, tz: number): void => {
    const len = Math.hypot(tx, tz) || 1;
    // INWARD normal = the tangent turned a quarter (see rooms/cave.ts screenPath). One rule, every segment.
    out.push({ x, z, nx: -tz / len, nz: tx / len, s });
  };
  for (const seg of segments) {
    if (seg.kind === "line") {
      const dx = seg.to.x - seg.from.x, dz = seg.to.z - seg.from.z;
      const len = Math.hypot(dx, dz);
      // the first sample of a segment repeats the last of the previous one only in POSITION; the normal
      // differs across a corner join, and duplicating the vertex is what keeps the shading crisp there
      if (out.length === 0) push(seg.from.x, seg.from.z, dx, dz);
      s += len;
      push(seg.to.x, seg.to.z, dx, dz);
      continue;
    }
    const steps = SCREEN.arcSegments;
    for (let i = 0; i <= steps; i++) {
      const a = seg.from + (seg.to - seg.from) * (i / steps);
      const x = seg.centre.x + Math.cos(a) * seg.r;
      const z = seg.centre.z + Math.sin(a) * seg.r;
      if (i > 0) s += (Math.abs(seg.to - seg.from) * seg.r) / steps;
      push(x, z, -Math.sin(a), Math.cos(a));
    }
  }
  return out;
}

/** THE 270° MAPPING, part one: WHERE ALONG THE PICTURE a point on the wrap sits.
 *
 *  `u = (s − s0) / VIDEO_WIDTH`, where s0 puts u = 0…1 exactly on the flat front chord. Because the
 *  video is 16:9 and the screen band is 180 tall, VIDEO_WIDTH is 320 — which IS the front chord — so
 *  the picture lands on the front panel at true aspect and no face is stretched. Everything left of the
 *  west corner and right of the east corner falls outside 0…1, and is folded back by `screenTexU`. */
export function screenU(s: number, total: number): number {
  const s0 = (total - VIDEO_WIDTH) / 2;
  return (s - s0) / VIDEO_WIDTH;
}

/** THE 270° MAPPING, part two: the actual texture coordinate — the FOLD, done here rather than by the
 *  sampler's MirroredRepeat.
 *
 *  A triangle wave takes u to 0…1 and back, so the picture runs out along the front panel and reflects
 *  along the wings; the result is then squeezed into the CROPPED frame (SCREEN.edgeCrop), so the fold
 *  happens on live picture instead of on the source's dark outermost columns. MirroredRepeat cannot do
 *  that second half — it always folds at texture coordinate 0 and 1 — which is why this is on the CPU.
 *
 *  It is exact only if every fold point (every integer u) is a real VERTEX; `foldVertices` guarantees
 *  that, and `ribbonGeometry` refuses to build without it. */
export function screenTexU(u: number): number {
  const wrapped = ((u % 2) + 2) % 2; // 0…2
  const tri = 1 - Math.abs(1 - wrapped); // 0…1…0
  const c = SCREEN.edgeCrop;
  return c + tri * (1 - 2 * c);
}

/** SPLIT EVERY QUAD THAT STRADDLES A FOLD.
 *
 *  `screenTexU` is a triangle wave: continuous everywhere, but its DERIVATIVE flips at each integer u.
 *  A GPU interpolates uv linearly across a triangle, so a quad whose two ends sit either side of a fold
 *  gets a straight line where the picture should turn round — a smeared band, in the middle of a wing,
 *  that no amount of tessellation fixes because the error is in the shape of the function rather than
 *  in its resolution. Putting a real vertex ON each fold makes every quad monotonic in u, and linear
 *  interpolation is then exactly right on both sides of it.
 *
 *  Two of the four folds (u = 0 and u = 1) are already the corner-arc joins; the other two land in the
 *  straight wings, where lerping a position between neighbours is exact. */
export function foldVertices(samples: PathSample[]): PathSample[] {
  const out: PathSample[] = [];
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i];
    out.push(a);
    const b = samples[i + 1];
    if (!b) break;
    const total = samples[samples.length - 1].s;
    const ua = screenU(a.s, total), ub = screenU(b.s, total);
    if (ub <= ua) continue; // a duplicated join vertex: nothing to split
    for (let k = Math.ceil(Math.min(ua, ub) + 1e-9); k <= Math.floor(Math.max(ua, ub) - 1e-9); k++) {
      const f = (k - ua) / (ub - ua);
      if (f <= 1e-9 || f >= 1 - 1e-9) continue; // already a vertex
      const nx = a.nx + (b.nx - a.nx) * f, nz = a.nz + (b.nz - a.nz) * f;
      const len = Math.hypot(nx, nz) || 1;
      out.push({
        x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f,
        nx: nx / len, nz: nz / len, s: a.s + (b.s - a.s) * f,
      });
    }
  }
  return out;
}

/** The ribbon: a strip of quads standing on the path, `height` tall, facing inward. ONE geometry. */
function ribbonGeometry(samples: PathSample[], y0: number, height: number, flipV = false): THREE.BufferGeometry {
  const total = samples[samples.length - 1].s;
  const n = samples.length;
  const pos = new Float32Array(n * 2 * 3);
  const nor = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    const p = samples[i];
    const u = screenTexU(screenU(p.s, total));
    for (let k = 0; k < 2; k++) {
      const o = (i * 2 + k) * 3;
      pos[o] = ORIGIN.x + p.x;
      pos[o + 1] = k === 0 ? y0 : y0 + height;
      pos[o + 2] = ORIGIN.z + p.z;
      nor[o] = p.nx; nor[o + 1] = 0; nor[o + 2] = p.nz;
      const q = (i * 2 + k) * 2;
      uv[q] = u;
      uv[q + 1] = flipV ? 1 - k : k;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** The floor reflection: the SAME ribbon laid flat, running inward from the screen's foot. Same path,
 *  same `u`, same texture object — so it is the same picture, upside down on the floor, for the price of
 *  one extra draw call and zero extra decoding. This is the CAVE's "video lights the room", V1. */
function reflectionGeometry(samples: PathSample[], depth: number, y: number): THREE.BufferGeometry {
  const total = samples[samples.length - 1].s;
  const n = samples.length;
  const pos = new Float32Array(n * 2 * 3);
  const nor = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    const p = samples[i];
    const u = screenTexU(screenU(p.s, total));
    for (let k = 0; k < 2; k++) {
      const o = (i * 2 + k) * 3;
      pos[o] = ORIGIN.x + p.x + p.nx * depth * k;
      pos[o + 1] = y;
      pos[o + 2] = ORIGIN.z + p.z + p.nz * depth * k;
      nor[o] = 0; nor[o + 1] = 1; nor[o + 2] = 0;
      const q = (i * 2 + k) * 2;
      uv[q] = u;
      // v runs UP the picture as the strip runs AWAY from the screen: the foot of the wall samples the
      // very bottom of the frame and the far edge samples 42% up it, which is what a reflection in a
      // floor actually does. (The other way round reads as a second, unrelated copy of the video lying
      // on the ground — same pixels, wrong mirror.)
      uv[q + 1] = k === 0 ? 0 : 0.42;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A one-dimensional fade, as an alpha map: opaque at the screen, gone `fade` of the way out. Used to
 *  stop the floor reflection ending on a hard line. Null without a DOM (tests) — the reflection then
 *  simply carries a flat low opacity, which is correct, just less pretty. */
function fadeAlpha(): THREE.CanvasTexture | null {
  const ctx = canvas2d(4, 64);
  if (!ctx) return null;
  const grad = ctx.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, "#000000"); // v = 0 → the far edge, gone
  grad.addColorStop(0.55, "#6a6a6a");
  grad.addColorStop(1, "#ffffff"); // v = 1 → hard against the screen
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(ctx.canvas);
  t.wrapS = THREE.MirroredRepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** A soft round wash, for the screen's spill on the floor. */
function washAlpha(): THREE.CanvasTexture | null {
  const ctx = canvas2d(128, 128);
  if (!ctx) return null;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.22)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(ctx.canvas);
}

export type CaveBuild = {
  group: THREE.Group;
  /** the two surfaces that sample the video, so the volume can hand them the texture on first entry */
  videoMaterials: THREE.Material[];
  /** PRESENTATION MODE: the flat front panel a live screen share is shown on. Hidden — and holding
   *  no texture at all — unless somebody in the call is actually sharing. */
  presentation: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial };
};

/** Build the whole volume. Returns it HIDDEN — interact/CaveTransition owns when it is drawn. */
export function buildCave(): CaveBuild {
  const g = new THREE.Group();
  g.name = "cave-theater";
  const W = ROOM.w, D = ROOM.d, H = ROOM.ceiling, T = ROOM.wallT;
  const wx = (x: number): number => ORIGIN.x + x;
  const wz = (z: number): number => ORIGIN.z + z;

  // ---- shell: floor, ceiling, four walls --------------------------------------------------------
  // One bake, one material. The walls are on the OUTSIDE of the interior rect, so the interior is
  // exactly ROOM.w × ROOM.d — which is what rooms/cave.ts measures walkability against.
  const shell = new Baker();
  const voidMat = mat(key("void"), 0.95);
  const floorMat = mat(key("floor"), 0.88);
  shell.add(rbox(W + 2 * T, T, D + 2 * T, floorMat, wx(W / 2), -T, wz(D / 2), 0)).receiveShadow = true;
  shell.add(rbox(W + 2 * T, T, D + 2 * T, voidMat, wx(W / 2), H, wz(D / 2), 0)); // ceiling slab
  shell.add(rbox(T, H, D + 2 * T, voidMat, wx(-T / 2), 0, wz(D / 2), 0)); // west
  shell.add(rbox(T, H, D + 2 * T, voidMat, wx(W + T / 2), 0, wz(D / 2), 0)); // east
  shell.add(rbox(W, H, T, voidMat, wx(W / 2), 0, wz(-T / 2), 0)); // north (behind the screen)
  // the south wall is the ENTRANCE wall: two returns either side of the vestibule, plus a header over it
  const sideW = (W - THRESHOLD.w) / 2;
  for (const sx of [-1, 1]) shell.add(rbox(sideW, H, T, voidMat, wx(W / 2 + sx * (THRESHOLD.w + sideW) / 2), 0, wz(D + T / 2), 0));
  shell.add(rbox(THRESHOLD.w, H - THRESHOLD.h, T, voidMat, wx(W / 2), THRESHOLD.h, wz(D + T / 2), 0));
  shell.bakeInto(g, "cave-shell");

  // ---- the vestibule: the pocket the player arrives in and leaves through ------------------------
  // A recess in the south wall, deep enough to hide the fact that the Central Hub is not on the other
  // side of it. Its back face is the "tunnel" the transition fades through.
  const vest = new Baker();
  const graphite = mat(key("graphite"), 0.82);
  const vw = THRESHOLD.w, vh = THRESHOLD.h, vd = THRESHOLD.depth;
  vest.add(rbox(vw + 2 * T, vh, T, graphite, wx(W / 2), 0, wz(D + vd + T / 2), 0)); // the tunnel's blind end
  for (const sx of [-1, 1]) vest.add(rbox(T, vh, vd, graphite, wx(W / 2 + sx * (vw + T) / 2), 0, wz(D + vd / 2), 0));
  vest.add(rbox(vw, T, vd, graphite, wx(W / 2), vh, wz(D + vd / 2), 0)); // its soffit
  vest.add(rbox(vw + 2 * T, T, vd, graphite, wx(W / 2), -T, wz(D + vd / 2), 0)); // its floor

  // ---- the screen's own body: plinth, bezel, and the truss overhead ------------------------------
  const samples = foldVertices(samplePath());
  // plinth under the picture, and a slim bezel over it: the two lines that make a ribbon read as a
  // BUILT screen rather than as a floating decal
  const plinthPts = samples.filter((_, i) => i % 2 === 0 || i === samples.length - 1);
  for (let i = 0; i < plinthPts.length - 1; i++) {
    const a = plinthPts[i], b = plinthPts[i + 1];
    const mxLocal = (a.x + b.x) / 2, mzLocal = (a.z + b.z) / 2;
    const len = Math.hypot(b.x - a.x, b.z - a.z) + 1.2;
    // rotation.y = θ maps local +x to (cos θ, 0, −sin θ), so aligning a box's length with a plan
    // direction (dx, dz) is atan2(−dz, dx) — NOT atan2(dx, dz), which is the world's FACING convention
    // and would lay every bar across its own run.
    const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
    for (const [y0, h, m] of [[0, SCREEN.bottom, graphite], [SCREEN.bottom + SCREEN.height, 5, graphite]] as const) {
      const bar = rbox(len, h, 7, m, 0, 0, 0, 0.6);
      bar.position.set(wx(mxLocal) - a.nx * 2, y0 + h / 2, wz(mzLocal) - a.nz * 2);
      bar.rotation.y = yaw;
      vest.add(bar);
    }
  }
  // service truss: six runs across the ceiling, the reference's exposed black tech deck
  for (let i = 0; i < 6; i++) {
    const z = 40 + i * ((D - 80) / 5);
    vest.add(rbox(W - 16, 6, 10, mat(key("steel"), 0.6), wx(W / 2), H - 14, wz(z), 0.8));
  }
  vest.bakeInto(g, "cave-structure");

  // ---- the one architectural light: a cool cove line -----------------------------------------------
  // Ankle height, round the whole walkable perimeter, plus the threshold's own frame. It is what stops
  // a black room from being an unreadable void when the video cuts to a dark frame.
  const cove = new Baker();
  const coveMat = emissiveMat(key("cove"), 1.5, 0.4);
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z) + 1.0;
    if (len < 0.2) continue;
    const bar = rbox(len, 1.4, 1.6, coveMat, 0, 0, 0, 0.4);
    bar.position.set(wx((a.x + b.x) / 2) + a.nx * 5, 1.6, wz((a.z + b.z) / 2) + a.nz * 5);
    bar.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
    bar.castShadow = false;
    cove.add(bar);
  }
  // the threshold frame: a bronze-warm jamb line, the one colour carried over from the monument
  const bronzeMat = emissiveMat(key("bronze"), 1.1, 0.4);
  for (const sx of [-1, 1]) cove.add(shadowed(rbox(2, vh - 4, 2, bronzeMat, wx(W / 2 + sx * (vw / 2 - 2)), 2, wz(D + 1), 0.4), false, false));
  cove.add(shadowed(rbox(vw - 6, 2, 2, bronzeMat, wx(W / 2), vh - 4, wz(D + 1), 0.4), false, false));
  cove.bakeInto(g, "cave-cove");

  // ---- the back-wall cushion run -------------------------------------------------------------------
  // Two short rows of low floor cushions flush against the south wall, exactly as the reference frames
  // them. They sit INSIDE the screen standoff band — outside the walkable area by construction — so they
  // are scenery that dresses the back of the room and can never obstruct a crowd. Sitting on them is
  // deliberately deferred (see the report's polish list).
  const cush = new Baker();
  const cushMat = mat(key("cushion"), 0.96);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const x = W / 2 + side * (THRESHOLD.w / 2 + 22 + i * 32);
      if (x < 26 || x > W - 26) continue;
      cush.add(rbox(26, 7, 20, cushMat, wx(x), 0, wz(D - 16), 2.4));
    }
  }
  cush.bakeInto(g, "cave-cushions");

  // ---- the video surfaces ---------------------------------------------------------------------------
  // ONE shared texture, injected on first entry (the CAVE never decodes anything until someone walks in).
  // Unlit MeshBasic: the picture IS the light source, so running it through the standard lighting model
  // would only let a dark room dim it. `fog: false` for the same reason.
  const screenMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false, side: THREE.FrontSide });
  const screen = new THREE.Mesh(ribbonGeometry(samples, SCREEN.bottom, SCREEN.height), screenMaterial);
  screen.name = "cave-screen";
  screen.castShadow = screen.receiveShadow = false;
  g.add(screen);

  const reflectMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000, toneMapped: false, fog: false, transparent: true, opacity: 0.22,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  });
  const fade = fadeAlpha();
  if (fade) { reflectMaterial.alphaMap = fade; reflectMaterial.opacity = 0.3; }
  const reflect = new THREE.Mesh(reflectionGeometry(samples, SCREEN.reflect, 0.6), reflectMaterial);
  reflect.name = "cave-screen-reflection";
  reflect.castShadow = reflect.receiveShadow = false;
  g.add(reflect);

  // a soft wash on the floor in front of the picture — the cheap half of "the screen lights the room"
  const wash = washAlpha();
  const washMat = wash
    ? new THREE.MeshBasicMaterial({ color: 0x9fc2ff, alphaMap: wash, transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false })
    : glowMat(key("cove"), 0.035);
  // kept to the front half and kept FAINT: this is spill from a screen, and a wash strong enough to read
  // as a layer of haze over the whole floor takes the room's darkness away, which is the one thing the
  // picture needs from it
  const washPlane = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, D * 0.55), washMat);
  washPlane.rotation.x = -Math.PI / 2;
  washPlane.position.set(wx(W / 2), 0.4, wz(D * 0.3));
  washPlane.name = "cave-screen-wash";
  washPlane.castShadow = washPlane.receiveShadow = false;
  g.add(washPlane);

  // ---- PRESENTATION MODE: the front panel ----------------------------------------------------------
  // ONE extra mesh, built once, hidden by default and carrying no map until a share exists — so a
  // session that never presents pays for a quad's worth of vertices and nothing else, ever.
  //
  // WHY IT IS A SEPARATE MESH rather than a second material on the ribbon. The ribbon's uv is the
  // 270° fold (screenTexU): it runs the picture out along the front chord and MIRRORS it round both
  // wings. That is exactly right for a video of a boxing ring and exactly wrong for a spreadsheet —
  // a mirrored copy of someone's slides on each wing is unreadable, and stretching one share across
  // 270° of curve is worse. So a share gets the flat front chord, at true aspect, and the wings get
  // to be dark; the ribbon's own geometry and uvs are never touched.
  //
  // It is FLUSH to the front chord, a hair in front of the ribbon (no z-fighting), exactly
  // VIDEO_WIDTH × SCREEN.height — the 320 × 180 16:9 panel the room was measured around.
  const presentMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000, toneMapped: false, fog: false, side: THREE.FrontSide,
  });
  const present = new THREE.Mesh(new THREE.PlaneGeometry(VIDEO_WIDTH, SCREEN.height), presentMaterial);
  present.name = "cave-presentation-panel";
  // The front chord is the NORTH straight run of the screen path, at z = SCREEN.inset, facing south
  // into the room — which is +z, and a PlaneGeometry's front face is already +z. No rotation.
  present.position.set(wx(W / 2), SCREEN.bottom + SCREEN.height / 2, wz(SCREEN.inset) + 0.7);
  present.castShadow = present.receiveShadow = false;
  present.visible = false;
  g.add(present);

  g.visible = false; // NOTHING here is drawn until someone is inside — see interact/CaveTransition
  return {
    group: g,
    videoMaterials: [screenMaterial, reflectMaterial],
    presentation: { mesh: present, material: presentMaterial },
  };
}

/** Hand the one shared VideoTexture to every surface that shows it. Called once, on first entry.
 *  `color` goes white at the same time: a MeshBasic map is MULTIPLIED by the colour, and the surfaces
 *  are built black so that an un-sourced screen reads as an off screen rather than as a white wall. */
export function attachCaveVideo(build: CaveBuild, texture: THREE.Texture): void {
  for (const m of build.videoMaterials) {
    const basic = m as THREE.MeshBasicMaterial;
    if (basic.map === texture) continue;
    basic.map = texture;
    basic.color.setHex(0xffffff);
    basic.needsUpdate = true;
  }
}

/** Where along the ribbon the FLAT FRONT CHORD sits, on samplePath's own arc-length ruler. The one
 *  place "the middle of the screen" is defined for anything that lays things out on the wrap. */
export function frontChordRange(samples: PathSample[]): { s0: number; s1: number; total: number } {
  const total = samples[samples.length - 1].s;
  const s0 = (total - VIDEO_WIDTH) / 2;
  return { s0, s1: s0 + VIDEO_WIDTH, total };
}

/** The path point at an ARBITRARY arc length — the ribbon's samples are dense but finite, and a
 *  tile edge lands wherever the layout says it does. Linear between neighbours, which is exact for
 *  the straight runs and well within a pixel on a 96-radius corner at 14 segments per quadrant. */
export function sampleAt(samples: PathSample[], s: number): PathSample {
  const total = samples[samples.length - 1].s;
  const t = Math.min(Math.max(s, 0), total);
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    if (b.s < t) continue;
    const span = b.s - a.s;
    if (span <= 1e-9) return { ...a, s: t }; // a duplicated corner-join vertex
    const f = (t - a.s) / span;
    const nx = a.nx + (b.nx - a.nx) * f, nz = a.nz + (b.nz - a.nz) * f;
    const len = Math.hypot(nx, nz) || 1;
    return {
      x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f,
      nx: nx / len, nz: nz / len, s: t,
    };
  }
  return { ...samples[samples.length - 1], s: t };
}

/** A STRIP OF THE RIBBON between two arc lengths, with uv running 0…1 across it — the geometry a
 *  meeting tile is drawn on.
 *
 *  WHY A STRIP AND NOT A QUAD. A flat quad wide enough to be a cinematic tile cuts through the
 *  corner arcs (96 radius) and floats off the wall on the straights' far side. A strip follows the
 *  real path, so a tile hugs the screen wherever it lands and the gallery can reflow across the
 *  curve without anybody noticing there is a curve. `lift` floats it just proud of the ribbon along
 *  the INWARD normal, which is what keeps it out of z-fighting with the wrap behind it.
 *
 *  There is no fold here on purpose: screenTexU's mirror belongs to the ONE 270° picture, and a
 *  participant's face must never be mirrored back on itself. */
export function ribbonStripGeometry(
  samples: PathSample[], s0: number, s1: number, y0: number, height: number, lift = 0.9,
): THREE.BufferGeometry {
  const span = Math.max(s1 - s0, 1e-6);
  const pts: PathSample[] = [
    sampleAt(samples, s0),
    ...samples.filter((p) => p.s > s0 + 1e-6 && p.s < s1 - 1e-6),
    sampleAt(samples, s1),
  ];
  const n = pts.length;
  const pos = new Float32Array(n * 2 * 3);
  const nor = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const u = (p.s - s0) / span;
    for (let k = 0; k < 2; k++) {
      const o = (i * 2 + k) * 3;
      pos[o] = ORIGIN.x + p.x + p.nx * lift;
      pos[o + 1] = k === 0 ? y0 : y0 + height;
      pos[o + 2] = ORIGIN.z + p.z + p.nz * lift;
      nor[o] = p.nx; nor[o + 1] = 0; nor[o + 2] = p.nz;
      const q = (i * 2 + k) * 2;
      uv[q] = u;
      uv[q + 1] = k;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** THE WRAP, AS AMBIENT LIGHT rather than as the picture.
 *
 *  Used in two meeting states. With a texture (the single-speaker view) the 270° wrap carries a
 *  DIMMED, mirrored continuation of the same camera — the room fills with the speaker without the
 *  speaker's face being stretched three metres wide, because the true-aspect copy is on the front
 *  panel and this is only spill. With null it is the plain dark surround the gallery and the
 *  presentation sit against.
 *
 *  The texture is SHARED with whatever is showing it properly — one decode, two samplers. */
export function setCaveWrapAmbient(build: CaveBuild, texture: THREE.Texture | null): void {
  for (const m of build.videoMaterials) {
    const basic = m as THREE.MeshBasicMaterial;
    const colour = texture ? WRAP_AMBIENT_LIT : WING_AMBIENT;
    if (basic.map === texture && basic.color.getHex() === colour) continue;
    basic.map = texture;
    basic.color.setHex(colour);
    basic.needsUpdate = true;
  }
}

/** THE WINGS IN PRESENTATION MODE: a dark ambient surround, not a picture.
 *
 *  Not black — a black 270° wrap makes the room read as a void and loses the CAVE entirely — and not
 *  the video either, which would fight the slide for attention and keep a second decode running. A
 *  low cool grey, lit by nothing, at roughly the luminance the reference cave's unlit panels sit at. */
const WING_AMBIENT = 0x0c1016;

/** The multiplier the wrap carries when it is showing a dimmed continuation of a live camera.
 *  Bright enough to light the room, far too dark to compete with the true-aspect copy in front. */
const WRAP_AMBIENT_LIT = 0x3d4654;

/** SWITCH THE CAVE BETWEEN ITS VIDEO AND A LIVE SHARE.
 *
 *  `texture` non-null  → PRESENTATION MODE: the share on the front panel at TRUE ASPECT, the 270°
 *                        ribbon and its floor reflection dropped to a dark ambient surround.
 *  `texture` null      → back to normal: the panel is hidden and cleared, and the caller re-attaches
 *                        the CAVE's own video with attachCaveVideo (which is what restores the
 *                        ribbon's map and its white multiplier).
 *
 *  ASPECT IS FITTED, NEVER STRETCHED. The panel is 16:9; a share rarely is (16:10 and 3:2 laptops,
 *  a portrait window, a single app). The picture is scaled to fit INSIDE the panel on its tight axis
 *  and centred, so text keeps its proportions and the unused strip is simply the dark wall behind.
 *  Scaling the MESH rather than juggling texture repeat/offset is what keeps that true for a source
 *  whose shape changes mid-share (a presenter switching monitors): one scale, no uv rebuild.
 *
 *  Allocation-free on every call: it assigns a map, a colour and a scale on materials that already
 *  exist, and is called only when something actually changed (CavePresentation.consumeChange). */
export function setCavePresentation(build: CaveBuild, texture: THREE.Texture | null, aspect = 16 / 9): void {
  const { mesh, material } = build.presentation;
  if (!texture) {
    mesh.visible = false;
    if (material.map) { material.map = null; material.color.setHex(0x000000); material.needsUpdate = true; }
    mesh.scale.set(1, 1, 1);
    return;
  }
  if (material.map !== texture) {
    material.map = texture;
    material.color.setHex(0xffffff);
    material.needsUpdate = true;
  }
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const panel = VIDEO_WIDTH / SCREEN.height;
  // wider than the panel → letterbox (lose height); taller → pillarbox (lose width)
  if (a >= panel) mesh.scale.set(1, panel / a, 1);
  else mesh.scale.set(a / panel, 1, 1);
  mesh.visible = true;
  for (const m of build.videoMaterials) {
    const basic = m as THREE.MeshBasicMaterial;
    if (basic.map === null && basic.color.getHex() === WING_AMBIENT) continue;
    // The map is DROPPED, not just darkened: a material that still samples the video texture keeps
    // the GPU uploading a frame it no longer shows.
    basic.map = null;
    basic.color.setHex(WING_AMBIENT);
    basic.needsUpdate = true;
  }
}

/** The measured numbers this room advertises, for the dev readout and the tests. */
export const CAVE_METRICS = {
  interior: `${ROOM.w} × ${ROOM.d} × ${ROOM.ceiling}`,
  frontChord: FRONT_CHORD,
  videoWidth: VIDEO_WIDTH,
  wrapLength: () => samplePath()[samplePath().length - 1].s,
};
