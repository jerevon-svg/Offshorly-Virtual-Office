// vo3d env — THE SKY DOME: the gradient overhead, the night stars and a restrained moon.
//
// WHY A DOME AT ALL, given the camera looks DOWN. At normal office pitch the terrain disc fills the frame
// and no sky is visible — correct, and the reason V1 of the environment got away with a flat background
// colour. But 3D EXPLORE can drop the pitch and pull the zoom out far enough to see past the terrain's
// hill line, and at that point a flat clear-colour reads as a void. The dome gives that view a horizon,
// and at night it gives it a sky worth looking at.
//
// COST. One inverted sphere (24x16, drawn without depth write, fog disabled) plus one THREE.Points cloud.
// Two draw calls, no lights, no textures beyond a 2x64 gradient strip regenerated only when the phase
// changes. The dome follows the camera target so panning can never reach its edge.
import * as THREE from "three";

/** how many stars — plenty, but they are points, so the whole field is one draw call */
const STAR_COUNT = 900;
/** the dome sits outside the terrain (5400) and inside the camera's far plane measured from CAM_DIST */
const RADIUS = 7000;

export type SkyGrade = {
  /** colour at the zenith */
  top: number;
  /** colour at the horizon */
  horizon: number;
  /** 0 = no stars … 1 = full field */
  stars: number;
  /** 0 = no moon … 1 = full */
  moon: number;
  /** THE MOON'S OWN COLOUR. Absent = the ordinary pale disc. A season sets it to make the moon a
   *  hero element — a blood moon is the single most recognisable Halloween sky there is, and it is
   *  two numbers rather than a new object. */
  moonColor?: number;
  /** Multiplier on the moon's drawn size. Absent = 1, the ordinary restrained disc. */
  moonScale?: number;
};

export class Sky {
  readonly root = new THREE.Group();
  private readonly domeMat: THREE.MeshBasicMaterial;
  private readonly starMat: THREE.PointsMaterial;
  private readonly moon: THREE.Mesh;
  private readonly moonHalo: THREE.Mesh;
  private tex: THREE.CanvasTexture | null = null;
  /** the strip is re-PAINTED in place, never re-created — see apply() */
  private canvas: HTMLCanvasElement | null = null;
  /** last painted gradient, so a frame that did not move the grade does not touch the GPU */
  private paintedTop = -1;
  private paintedHorizon = -1;
  private flashAmount = 0;

  constructor() {
    this.root.name = "sky";
    this.root.renderOrder = -1000;
    this.domeMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 24, 16), this.domeMat);
    dome.renderOrder = -1000;
    dome.frustumCulled = false;
    this.root.add(dome);

    // STARS. Scattered over the upper hemisphere only, with per-star brightness baked into vertex colours
    // so the field has depth without a second material or a texture.
    const pos = new Float32Array(STAR_COUNT * 3);
    const col = new Float32Array(STAR_COUNT * 3);
    let seed = 98765;
    const r = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let i = 0; i < STAR_COUNT; i++) {
      // cos-weighted so stars do not bunch at the zenith; kept above the horizon line
      const y = 0.08 + r() * 0.92, ring = Math.sqrt(1 - y * y), a = r() * Math.PI * 2;
      const d = RADIUS * 0.97;
      pos[i * 3] = Math.cos(a) * ring * d;
      pos[i * 3 + 1] = y * d;
      pos[i * 3 + 2] = Math.sin(a) * ring * d;
      // a few bright ones, most faint — and a faint blue/warm cast across the field
      const b = 0.22 + Math.pow(r(), 3) * 0.78;
      col[i * 3] = b * (0.86 + r() * 0.14);
      col[i * 3 + 1] = b * (0.9 + r() * 0.1);
      col[i * 3 + 2] = b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    // SIZE IN PIXELS, NOT WORLD UNITS. three's size attenuation divides by view-space z, which is
    // meaningless under an orthographic camera — with it on, every star drew as a screen-filling square.
    // A fixed 2.4px point is also exactly what a star should be: a pinprick at any zoom.
    this.starMat = new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    const stars = new THREE.Points(g, this.starMat);
    stars.renderOrder = -999;
    stars.frustumCulled = false;
    this.root.add(stars);

    // THE MOON: one small disc plus a soft halo. Restrained on purpose — it is a light source in the
    // fiction, not a feature; the actual moonlight is the renderer's key light.
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xeef2ff, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(230, 28), moonMat);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xbcd0ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    this.moonHalo = new THREE.Mesh(haloGeo(560), haloMat);
    for (const m of [this.moonHalo, this.moon]) {
      m.position.set(-RADIUS * 0.52, RADIUS * 0.56, -RADIUS * 0.56);
      m.lookAt(0, 0, 0);
      m.renderOrder = -998;
      m.frustumCulled = false;
      this.root.add(m);
    }
    this.moonHalo.position.multiplyScalar(0.995);
  }

  /** LIGHTNING'S SHARE OF THE SKY. The dome is a MeshBasicMaterial with a map, so its `color` multiplies
   *  the gradient — and the material is `toneMapped: false`, so a colour above 1 is allowed to blow the
   *  strip out rather than being rolled back by the tone curve. That is the entire implementation: one
   *  Color write per frame of a flash, no second dome, no additive quad, no light.
   *
   *  @param amount 0…1, already multiplied by the phase's visibility gain by the caller */
  setFlash(amount: number): void {
    const a = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
    if (a === this.flashAmount) return;
    this.flashAmount = a;
    if (this.tex) this.applyFlash();
  }
  private applyFlash(): void {
    // 1 → untouched; the ceiling is a strip lit to roughly 2.5x, which reads as a sky that has gone white
    // without the horizon band losing its shape entirely.
    const k = 1 + this.flashAmount * 1.5;
    this.domeMat.color.setRGB(k, k, k);
  }

  /** Keep the dome centred on whatever the camera is looking at, so its edge is unreachable by panning. */
  follow(target: THREE.Vector3): void {
    this.root.position.copy(target);
  }

  apply(grade: SkyGrade): void {
    // ONE CANVAS, ONE TEXTURE, FOR THE LIFE OF THE SKY. This used to dispose and rebuild both on every
    // apply(), which was free when a grade changed twice a day and is not free now that a Clear→Rain
    // transition applies a moving grade every frame. Re-painting 2x64 pixels and flagging the texture is
    // a ~512-byte upload; allocating a canvas, a texture and a GPU object was the cost that mattered.
    if (grade.top !== this.paintedTop || grade.horizon !== this.paintedHorizon) {
      this.paintedTop = grade.top;
      this.paintedHorizon = grade.horizon;
      if (!this.canvas) this.canvas = makeStrip();
      const canvas = this.canvas;
      const painted = canvas ? paintStrip(canvas, grade.top, grade.horizon) : false;
      if (painted && canvas && !this.tex) {
        this.tex = new THREE.CanvasTexture(canvas);
        this.tex.colorSpace = THREE.SRGBColorSpace;
        this.domeMat.map = this.tex;
        this.domeMat.needsUpdate = true; // the only recompile: the frame a map first appears
      } else if (painted && this.tex) {
        this.tex.needsUpdate = true;
      }
      // no 2D context (jsdom, or a browser refusing one): fall back to a flat zenith tone
      if (!painted && !this.tex) this.domeMat.color.setHex(grade.top);
    }
    if (this.tex) this.applyFlash();
    this.starMat.opacity = grade.stars;
    this.starMat.visible = grade.stars > 0.01;
    const moonMat = this.moon.material as THREE.MeshBasicMaterial;
    moonMat.opacity = grade.moon * 0.92;
    this.moon.visible = grade.moon > 0.01;
    // A SEASON MAY RECOLOUR AND RESIZE THE MOON. Both default to the ordinary pale disc when the
    // grade does not ask, so nothing outside a season sees any change at all.
    moonMat.color.setHex(grade.moonColor ?? 0xeef2ff);
    const scale = grade.moonScale ?? 1;
    this.moon.scale.setScalar(scale);
    this.moonHalo.scale.setScalar(scale);
    const haloMaterial = this.moonHalo.material as THREE.MeshBasicMaterial;
    haloMaterial.opacity = grade.moon * 0.3;
    haloMaterial.color.setHex(grade.moonColor ?? 0xbcd0ff);
    this.moonHalo.visible = this.moon.visible;
  }
}

/** A disc whose additive brightness falls off to nothing at the rim (centre vertex = index 0). */
function haloGeo(radius: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(radius, 24);
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3).fill(0);
  col[0] = col[1] = col[2] = 1;
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

function makeStrip(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 64;
  return c;
}

/** Paint a 2 x 64 vertical strip: zenith at the top, horizon at the bottom, eased so the band is not
 *  linear. Returns false when there is no 2D context to paint into. */
function paintStrip(c: HTMLCanvasElement, top: number, horizon: number): boolean {
  const ctx = c.getContext("2d");
  if (!ctx) return false;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  const hex = (v: number) => `#${v.toString(16).padStart(6, "0")}`;
  g.addColorStop(0, hex(top));
  g.addColorStop(0.62, hex(top));
  g.addColorStop(0.88, hex(horizon));
  g.addColorStop(1, hex(horizon));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 64);
  return true;
}
