// vo3d env — THE RAIN FIELD. One draw call, one mesh, no per-frame CPU work worth the name.
//
// WHAT IT IS. A pool of camera-following quads in ONE InstancedBufferGeometry. Every streak's position,
// fall, wrap, fade and billboard is computed in the vertex shader from a static 4-float seed and a handful
// of uniforms. Per frame the CPU writes about twenty floats and nothing else: no attribute upload, no
// scene traversal, no per-particle loop, no allocation, no buffer rebuild — switching CLEAR↔RAIN moves one
// integer.
//
// WHY NOT THREE.Points. Rain is elongated ALONG WORLD-UP, and a point sprite is square and screen-aligned.
// Worse, three's size attenuation divides by view-space z, which is meaningless under the orthographic
// camera OFFICE and EXPLORE both use — env/Sky already hit exactly that and had to pin its stars to a
// fixed pixel size. Instanced quads billboard around the vertical axis instead, which is correct in the
// ortho rig and in PLAYER's perspective rig with no branch between them.
//
// ── THE OFFICE IS DRY, AND IT IS DRY BY CONSTRUCTION ────────────────────────────────────────────────
// No streak is ever PLACED over the building. The field is not a box with a hole tested per fragment; it
// is the box MINUS the footprint, decomposed into four strips whose areas are known, and each streak picks
// a strip in proportion to its area and lands uniformly inside it. So:
//
//   • there is no height, angle or zoom at which a drop can appear inside a room — the drop does not exist
//     there. Nothing relies on a wall being in front of it, on depth order, or on the camera's pitch;
//   • no streak is wasted. A culling mask throws away exactly the streaks the camera is looking at when
//     the office fills the frame, which is the one time rain matters most;
//   • density is uniform in the part of the world it actually rains on, at every framing.
//
// Two earlier cuts of this are worth recording, because both looked correct in code and failed on screen.
// Culling the footprint deleted the ENTIRE field at any framing tight enough to fill the screen with the
// office (the box is smaller than the building) — a downpour rendering 2,000 invisible quads. Letting rain
// land on the roof line fixed that, but at OFFICE pitch the column standing above a 46-unit roof still
// projects onto the rooms behind it, so faint streaks crossed the interiors. Only placement solves it.
//
// SHADOWS. castShadow and receiveShadow are both false and nothing here ever calls invalidateShadows().
// The renderer's shadow map is drawn on demand (Renderer.shadowMap.autoUpdate = false) and rain is
// deliberately outside that system — a downpour must not cost a shadow pass a frame.
import * as THREE from "three";
import type { Rect } from "../core/coords";
import type { RainParams } from "./weatherGrade";

/** The pool ceiling. Never re-allocated; the drawn count is a prefix of it. 9000 quads = 18,000 triangles,
 *  against a ground floor of ~1.1M — the cost of rain is fill rate, not geometry. */
const MAX_STREAKS = 9000;
/** world units, at length multiplier 1 — a stylized streak, not a photographic one */
const BASE_LENGTH = 30;
const BASE_WIDTH = 1.05;
/** THE MINIMUM A STREAK MAY BE ON SCREEN, in pixels.
 *
 *  A streak is about a world unit wide, and under the ORTHOGRAPHIC camera a world unit is worth whatever
 *  the current zoom says — at the office framing it is under a pixel, so the quad falls between pixel
 *  centres and a full downpour rasterizes to almost nothing. (env/Sky hit the same wall from the other
 *  side: three's size attenuation is meaningless under ortho, so its stars had to be pinned to a fixed
 *  pixel size.) The caller measures world-units-per-pixel for whichever camera is drawing, and the width
 *  is widened to hold this floor. */
const MIN_WIDTH_PX = 2.4;
/** how far the field must reach beyond the office before there is anywhere for it to rain */
const RING_MARGIN = 220;

const VERT = /* glsl */ `
attribute vec4 aSeed;      // strip pick + x placement · z placement · fall phase · per-streak variation
// THE FOUR STRIPS of (field box − office footprint), each vec4(x0, z0, x1, z1). Any may be empty.
uniform vec4  uRegA;       // everything left of the office
uniform vec4  uRegB;       // everything right of it
uniform vec4  uRegC;       // the band in front of it, between those two
uniform vec4  uRegD;       // the band behind it
uniform vec4  uCdf;        // cumulative AREA fractions, so a strip is picked in proportion to its size
uniform float uTop;        // world Y a column starts from
uniform float uHeight;     // how far it falls before it recycles
uniform float uGround;     // world Y it lands on
uniform float uTime;
uniform float uSpeed;
uniform float uLength;
uniform float uWidth;
uniform float uOpacity;
varying vec2  vQuad;
varying float vAlpha;

void main() {
  // PICK A STRIP BY AREA, then place uniformly inside it. Because the strips tile the box minus the
  // office exactly once, and the pick is area-weighted, the result is a uniform field over everywhere it
  // is allowed to rain — and nowhere it is not.
  float s = aSeed.x;
  vec4 R; float lo; float hi;
  if (s < uCdf.x)      { R = uRegA; lo = 0.0;    hi = uCdf.x; }
  else if (s < uCdf.y) { R = uRegB; lo = uCdf.x; hi = uCdf.y; }
  else if (s < uCdf.z) { R = uRegC; lo = uCdf.y; hi = uCdf.z; }
  else                 { R = uRegD; lo = uCdf.z; hi = 1.0; }
  float u = (s - lo) / max(hi - lo, 1e-6);
  vec2 xz = vec2(mix(R.x, R.z, u), mix(R.y, R.w, aSeed.y));

  float speed = uSpeed * (0.82 + aSeed.w * 0.36);
  float fall = fract(aSeed.z + uTime * speed / uHeight);
  float y = uTop - fall * uHeight;

  // fade in under the cloud base and out where it lands, so nothing pops into or out of existence
  float ends = smoothstep(uTop, uTop - uHeight * 0.18, y) * smoothstep(uGround - 4.0, uGround + 46.0, y);

  // BILLBOARD AROUND THE VERTICAL ONLY: rain is elongated along world-up, never along the view direction.
  // World-up in view space, projected to the screen plane, is the axis a streak is drawn along.
  vec3 up = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  float fl = length(up.xy);
  vec2 dirUp = fl > 1e-4 ? up.xy / fl : vec2(0.0, 1.0);
  vec2 dirRight = vec2(dirUp.y, -dirUp.x);
  // Looking straight down the rain, streaks collapse to specks. Let them go rather than draw confetti.
  float axis = smoothstep(0.06, 0.34, fl);

  // Per-streak brightness, decorrelated from speed so the field has depth rather than a visible ordering.
  float shade = 0.62 + fract(aSeed.z * 7.31) * 0.62;
  vAlpha = uOpacity * ends * axis * shade;
  // A streak that would contribute nothing is collapsed to a point: zero-area triangles, zero fragments.
  float live = step(0.002, vAlpha);

  vec4 mv = viewMatrix * vec4(xz.x, y, xz.y, 1.0);
  mv.xy += (dirRight * (position.x * uWidth) + dirUp * (position.y * uLength * (0.75 + aSeed.w * 0.5))) * live;
  vQuad = position.xy;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vQuad;
varying float vAlpha;

void main() {
  if (vAlpha <= 0.0) discard;
  // soft along the streak and soft across it — a stylized taper, no texture
  float a = vAlpha;
  a *= smoothstep(-0.5, -0.2, vQuad.y);
  a *= 1.0 - smoothstep(0.24, 0.5, vQuad.y);
  a *= 1.0 - smoothstep(0.32, 0.5, abs(vQuad.x));
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

export class Rain {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly ground: number;
  /** the office, padded — the one rectangle it never rains on */
  private readonly dry: { x0: number; z0: number; x1: number; z1: number };
  private t = 0;
  private wanted = false;
  private params: RainParams = { perMillion: 0, opacity: 0, speed: 0, length: 1 };
  /** area of (box − office) at the last follow(), in world units² — what the streak count is drawn from */
  private usable = 0;

  /** @param dry the office footprint @param groundY the world Y rain lands on @param pad how far past the
   *  footprint to keep rain, covering wall thickness and the podium lip */
  constructor(dry: Rect, groundY: number, pad = 12) {
    this.ground = groundY;
    this.dry = { x0: dry.x - pad, z0: dry.z - pad, x1: dry.x + dry.w + pad, z1: dry.z + dry.d + pad };
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute("position", quad.getAttribute("position"));

    // THE SEEDS. Generated once from a fixed LCG so the field is identical run to run (a benchmark that
    // measures a different rain each time measures nothing) and never touched again.
    const seeds = new Float32Array(MAX_STREAKS * 4);
    let s = 20260914;
    const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let i = 0; i < MAX_STREAKS * 4; i++) seeds[i] = r();
    this.geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    this.geo.instanceCount = 0;

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false, // rain never occludes what is behind it...
      depthTest: true, //  ...but a wall in front of it still does
      fog: false,
      toneMapped: false,
      uniforms: {
        uRegA: { value: new THREE.Vector4() },
        uRegB: { value: new THREE.Vector4() },
        uRegC: { value: new THREE.Vector4() },
        uRegD: { value: new THREE.Vector4() },
        uCdf: { value: new THREE.Vector4(0.25, 0.5, 0.75, 1) },
        uTop: { value: groundY + 400 },
        uHeight: { value: 400 },
        uGround: { value: groundY },
        uTime: { value: 0 },
        uSpeed: { value: 0 },
        uLength: { value: BASE_LENGTH },
        uWidth: { value: BASE_WIDTH },
        uOpacity: { value: 0 },
        // A MEDIUM cool slate, not white. The office is a cream miniature under a bright key, and a pale
        // streak at a believable opacity simply disappears against it; a mid-tone reads as rain over the
        // building AND still reads as a bright streak against night asphalt, which one colour has to do
        // because one blend mode cannot darken over light and lighten over dark.
        uColor: { value: new THREE.Color(0x93afc9) },
      },
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = "weather-rain";
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // The geometry is authored in world space by the shader, so its bounds mean nothing to the CPU.
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 950; // after the scene's own transparents (light spills, glass)
    this.mesh.visible = false;
    quad.dispose();
  }

  /** Switch weather. Uniforms and one integer — no buffer is rebuilt and no world is reloaded. */
  setParams(p: RainParams): void {
    this.params = p;
    this.mat.uniforms.uOpacity.value = p.opacity;
    this.mat.uniforms.uSpeed.value = p.speed;
    this.mat.uniforms.uLength.value = BASE_LENGTH * p.length;
    this.count();
    this.sync();
  }
  /** Presentation gate — OFFICE/EXPLORE decide this, not the weather state. */
  set visible(on: boolean) {
    this.wanted = on;
    this.sync();
  }
  get visible(): boolean {
    return this.mesh.visible;
  }
  /** SHOULD it be raining — the presentation wants rain and the state has some. Distinct from `visible`,
   *  which additionally needs a streak count, and that is only known once follow() has measured the field.
   *  The caller drives follow() off THIS, or the two would wait on each other forever. */
  get active(): boolean {
    return this.wanted && this.params.opacity > 0 && this.params.perMillion > 0;
  }
  private sync(): void {
    this.mesh.visible = this.wanted && this.geo.instanceCount > 0 && this.params.opacity > 0;
  }
  /** Streaks are spent per unit of ground it is actually raining on, so the field looks the same density
   *  whether the camera is inside the lobby or looking at the whole campus. The pool is the ceiling. */
  private count(): void {
    const n = Math.round((this.usable / 1e6) * this.params.perMillion);
    this.geo.instanceCount = Math.max(0, Math.min(MAX_STREAKS, n));
  }

  /** THE SMALLEST FIELD that still has somewhere to rain: the box must clear the office on every side, or
   *  a camera framed on the building would be asking for rain in a box that is entirely roof. */
  minHalf(centre: THREE.Vector3): number {
    const d = this.dry;
    return Math.max(Math.abs(centre.x - d.x0), Math.abs(centre.x - d.x1), Math.abs(centre.z - d.z0), Math.abs(centre.z - d.z1)) + RING_MARGIN;
  }

  /** Ride the camera: rebuild the four strips around the office and re-spend the streak budget over them.
   *  @param half the field's XZ half-extent @param worldPerPixel keeps a streak above the pixel floor */
  follow(centre: THREE.Vector3, half: number, worldPerPixel = 0): void {
    const u = this.mat.uniforms;
    const h = Math.max(half, this.minHalf(centre));
    const bx0 = centre.x - h, bx1 = centre.x + h, bz0 = centre.z - h, bz1 = centre.z + h;
    // the office, clipped to the box — the part of it that is actually in the way
    const d = this.dry;
    const dx0 = Math.max(bx0, Math.min(bx1, d.x0)), dx1 = Math.max(bx0, Math.min(bx1, d.x1));
    const dz0 = Math.max(bz0, Math.min(bz1, d.z0)), dz1 = Math.max(bz0, Math.min(bz1, d.z1));
    // four strips that tile (box − office) exactly once: left, right, then the near and far bands between
    const A = [bx0, bz0, dx0, bz1], B = [dx1, bz0, bx1, bz1], C = [dx0, bz0, dx1, dz0], D = [dx0, dz1, dx1, bz1];
    const area = (r: number[]) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
    const aA = area(A), aB = area(B), aC = area(C), aD = area(D);
    const total = aA + aB + aC + aD;
    this.usable = total;
    const inv = total > 0 ? 1 / total : 0;
    (u.uRegA.value as THREE.Vector4).set(A[0], A[1], A[2], A[3]);
    (u.uRegB.value as THREE.Vector4).set(B[0], B[1], B[2], B[3]);
    (u.uRegC.value as THREE.Vector4).set(C[0], C[1], C[2], C[3]);
    (u.uRegD.value as THREE.Vector4).set(D[0], D[1], D[2], D[3]);
    (u.uCdf.value as THREE.Vector4).set(aA * inv, (aA + aB) * inv, (aA + aB + aC) * inv, 1);

    u.uWidth.value = Math.max(BASE_WIDTH, worldPerPixel * MIN_WIDTH_PX);
    // A taller column for a wider field, so the rain reads as depth rather than as a low ceiling of drops.
    const ht = Math.max(340, Math.min(760, h * 0.62));
    u.uHeight.value = ht;
    u.uTop.value = this.ground + ht;
    this.count();
    this.sync();
  }

  /** The entire per-frame animation cost: one float. */
  update(dtSeconds: number): void {
    if (!this.mesh.visible) return;
    this.t += dtSeconds;
    this.mat.uniforms.uTime.value = this.t;
  }

  get stats(): { draws: number; instances: number; triangles: number } {
    const n = this.mesh.visible ? this.geo.instanceCount : 0;
    return { draws: n > 0 ? 1 : 0, instances: n, triangles: n * 2 };
  }
  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

export const RAIN_POOL = MAX_STREAKS;
