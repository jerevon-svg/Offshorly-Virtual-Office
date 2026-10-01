// vo3d build — AI LAB V2 MATERIALS, SCREENS AND ENVIRONMENT RESPONSE.
//
// THE LAB IS OPEN-AIR, so it is lit and graded exactly like the campus around it: every material made here is
// REGISTERED the way build/exterior registers its own — tintable (the time-of-day grade multiplies its base
// colour), practical (lanterns, windows and fixtures are off by day and come up after dusk), wettable (rain
// drops roughness and lifts the environment response) and, for foliage, wind (the shared two-uniform sway).
// `responder` is the same five-call interface as ExteriorScenery, so the world simply forwards the
// environment's calls to it (app/world.ts).
//
// ONE SCREEN ATLAS. Every display, window, sign and status panel in the Lab samples ONE canvas texture, cut
// into cells by kind of content (design boards, code, review comparisons, orchestration graphs, artifact
// frames, warm residence interiors…). A ScreenBank merges every screen quad into one mesh — one draw — and keeps
// each station's quads addressable, so a station's screens can change state (active / idle / offline) later
// without new materials: the seam for future state-driven content.
import * as THREE from "three";
import { windByVertex, groundFinish, type GroundFinish } from "./exteriorShaders";

type Tint = { m: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial; base: THREE.Color };
type Practical = { m: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial; emissive: number; opacity: number };
type Wet = { m: THREE.MeshStandardMaterial; dryR: number; wetR: number; dryEnv: number; wetEnv: number };

export class LabMaterials {
  readonly tint: Tint[] = [];
  readonly practicals: Practical[] = [];
  readonly wet: Wet[] = [];
  readonly windGain = { value: 0 };
  readonly windTime = { value: 0 };
  private readonly cache = new Map<string, THREE.Material>();
  /** every material this Lab owns (for the material count) */
  get count(): number { return this.cache.size; }

  private once<T extends THREE.Material>(key: string, make: () => T): T {
    let m = this.cache.get(key) as T | undefined;
    if (!m) { m = make(); this.cache.set(key, m); }
    return m;
  }
  /** a tintable vertex-coloured surface (every modelled piece: timber, plaster, stone, fabric, equipment) */
  painted(key: string, roughness = 0.85, extra: Partial<THREE.MeshStandardMaterialParameters> = {}, wetR?: number): THREE.MeshStandardMaterial {
    return this.once(`p:${key}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness, metalness: 0, ...extra });
      this.tint.push({ m, base: new THREE.Color(0xffffff) });
      if (wetR !== undefined) this.wet.push({ m, dryR: roughness, wetR, dryEnv: m.envMapIntensity, wetEnv: 1.35 });
      return m;
    });
  }
  /** a floor: painted + the exterior's world-space finish (joints, bond, soil grain) + rain-wettable.
   *  NO polygonOffset: a depth bias grows with screen-space slope, so at grazing angles and wide zooms a biased
   *  floor swallows the inlays, rugs and borders lying on it (build/floorplan learned the same). Lab floors are
   *  instead a CONSTANT-GAP layer stack (labShell LAYER), unambiguous at every angle and zoom. */
  floor(key: string, finish: GroundFinish | null, roughness = 0.82, wetR = 0.3): THREE.MeshStandardMaterial {
    return this.once(`f:${key}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness, metalness: 0 });
      if (finish) groundFinish(m, finish);
      this.tint.push({ m, base: new THREE.Color(0xffffff) });
      this.wet.push({ m, dryR: roughness, wetR, dryEnv: m.envMapIntensity, wetEnv: 1.45 });
      return m;
    });
  }
  /** foliage: painted, faceted, bending in the shared wind */
  leaves(key: string, flutter = 1): THREE.MeshStandardMaterial {
    return this.once(`l:${key}`, () => {
      const m = windByVertex(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.88, flatShading: true }), this.windGain, this.windTime, flutter);
      this.tint.push({ m, base: new THREE.Color(0xffffff) });
      this.wet.push({ m, dryR: 0.88, wetR: 0.55, dryEnv: m.envMapIntensity, wetEnv: 1.25 });
      return m;
    });
  }
  /** a PRACTICAL: a vertex-coloured emissive that is dark by day and lit after dusk (windows, lanterns) */
  practical(key: string, emissive: number, emissiveHex: number): THREE.MeshStandardMaterial {
    return this.once(`x:${key}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, emissive: emissiveHex, emissiveIntensity: 0, roughness: 0.5 });
      this.tint.push({ m, base: new THREE.Color(0xffffff) });
      this.practicals.push({ m, emissive, opacity: 0 });
      return m;
    });
  }
  /** an always-on indicator (status lamps, LED strips): restrained, emissive from vertex colour */
  indicator(key: string, intensity = 0.9): THREE.MeshBasicMaterial {
    return this.once(`i:${key}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity), vertexColors: true }));
  }
  /** the additive light pool a lantern throws after dusk */
  spill(key: string, opacity: number): THREE.MeshBasicMaterial {
    return this.once(`s:${key}`, () => {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      this.practicals.push({ m, emissive: 0, opacity });
      return m;
    });
  }
  /** contact darkening: black with per-vertex alpha (RGBA vertex colour), drawn just over the floor */
  contact(): THREE.MeshBasicMaterial {
    return this.once("contact", () => new THREE.MeshBasicMaterial({ color: 0x000000, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  }
  /** the ONE screen material: the shared atlas, brightness from vertex colour */
  readonly screenTime = { value: 0 };
  screen(): THREE.MeshBasicMaterial {
    return this.once("screen", () => {
      const m = new THREE.MeshBasicMaterial({ map: screenAtlas(), vertexColors: true });
      const uTime = this.screenTime;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = uTime;
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nattribute vec2 aLocal; attribute vec4 aCell; attribute vec3 aFx; varying vec2 vLocal; varying vec4 vCell; varying vec3 vFx;")
          .replace("#include <uv_vertex>", "#include <uv_vertex>\nvLocal = aLocal; vCell = aCell; vFx = aFx;");
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform float uTime; varying vec2 vLocal; varying vec4 vCell; varying vec3 vFx;\n" + SCREEN_GLSL)
          .replace("#include <map_fragment>", "diffuseColor.rgb *= screenColor(map, vLocal, vCell, vFx, uTime);");
      };
      m.customProgramCacheKey = () => "lab-screen-v1";
      return m;
    });
  }

  /** GLAZING: the residence's windows — the atlas's interior cells, read as glass by day, glowing warm after dusk */
  glazing(): THREE.MeshStandardMaterial {
    return this.once("glazing", () => {
      const map = screenAtlas();
      const m = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffd2a0, emissiveIntensity: 0, roughness: 0.25, metalness: 0 });
      this.tint.push({ m, base: new THREE.Color(0xffffff) });
      this.practicals.push({ m, emissive: 1.25, opacity: 0 });
      this.wet.push({ m, dryR: 0.25, wetR: 0.12, dryEnv: m.envMapIntensity, wetEnv: 1.4 });
      return m;
    });
  }
  /** PRINTED surfaces from the atlas (pinboards, whiteboards, signs, sample cards): lit by the scene like paper */
  printed(): THREE.MeshStandardMaterial {
    return this.once("printed", () => {
      const m = new THREE.MeshStandardMaterial({ map: screenAtlas(), roughness: 0.9, metalness: 0 });
      this.tint.push({ m, base: new THREE.Color(0xffffff) });
      return m;
    });
  }

  /** ADOPT a material made elsewhere (the vegetation ladder's cards and dissolving cuts) into the Lab's tint
   *  and wetness response */
  adopt<T extends THREE.MeshStandardMaterial>(key: string, m: T, wetR?: number): T {
    return this.once(`a:${key}`, () => {
      this.tint.push({ m, base: m.color.clone() });
      if (wetR !== undefined) this.wet.push({ m, dryR: m.roughness, wetR, dryEnv: m.envMapIntensity, wetEnv: 1.3 });
      return m;
    });
  }
  /** the five calls the Environment makes on the exterior, for the Lab (app/world forwards them) */
  readonly responder = {
    applyTint: (t: number) => { for (const { m, base } of this.tint) m.color.copy(base).multiplyScalar(t); },
    applyPracticals: (level: number) => {
      const l = Math.max(0, Math.min(2, level));
      for (const p of this.practicals) {
        if (p.emissive) (p.m as THREE.MeshStandardMaterial).emissiveIntensity = p.emissive * l;
        if (p.opacity) { p.m.opacity = Math.min(1, p.opacity * l); p.m.visible = l > 0.01; }
      }
    },
    applyWetness: (w: number) => {
      const t = Number.isFinite(w) ? Math.max(0, Math.min(1, w)) : 0;
      for (const x of this.wet) { x.m.roughness = x.dryR + (x.wetR - x.dryR) * t; x.m.envMapIntensity = x.dryEnv + (x.wetEnv - x.dryEnv) * t; }
    },
    applyWind: (gain: number) => { this.windGain.value = Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 0; },
    windTick: (sec: number) => { if (this.windGain.value > 0.001) this.windTime.value = sec; },
  };
}

/** A LIGHT POOL for the additive spill material: a flat disc whose colour falls off from `hex` at the centre to
 *  black (= no light added) at the rim, so lantern and task light reads as light, not as a painted disc */
export function pool(r: number, hex: number, seg = 24): THREE.BufferGeometry {
  const c = new THREE.Color(hex), pos: number[] = [], col: number[] = [];
  const rings = [[0, 1], [0.35, 0.72], [0.68, 0.3], [1, 0]] as const;
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const [r0, i0] = rings[i], [r1, i1] = rings[i + 1];
    const P = (a: number, rr: number) => [Math.cos(a) * rr * r, 0, Math.sin(a) * rr * r];
    const quad = [[P(a0, r0), i0], [P(a1, r1), i1], [P(a1, r0), i0], [P(a0, r0), i0], [P(a0, r1), i1], [P(a1, r1), i1]] as const;
    for (const [p, it] of quad) { pos.push(...p); col.push(c.r * it, c.g * it, c.b * it); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ============================== THE SCREEN ATLAS ==============================================================
/** the atlas cells, 8 × 4 of 256² — one per kind of content (and its idle / offline variants) */
export const CELLS = [
  "design", "reference", "code", "terminal", "review", "compare", "devices", "general",
  "orchestration", "status", "job", "artifact-ready", "artifact-empty", "artifact-input", "artifact-approval", "off",
  "window-warm", "window-bunks", "window-lounge", "window-hall", "sign-lab", "sign-results", "lighttable", "pinboard",
  "design-idle", "code-idle", "review-idle", "general-idle", "orchestration-idle", "devices-idle", "whiteboard", "map",
] as const;
export type Cell = (typeof CELLS)[number];
const AW = 2048, AH = 1024, CW = 256, CH = 256;
let atlas: THREE.CanvasTexture | null = null;
export function cellUV(cell: Cell, inset = 6): { u0: number; v0: number; u1: number; v1: number } {
  const i = CELLS.indexOf(cell), cx = (i % 8) * CW, cy = Math.floor(i / 8) * CH;
  return { u0: (cx + inset) / AW, u1: (cx + CW - inset) / AW, v1: 1 - (cy + inset) / AH, v0: 1 - (cy + CH - inset) / AH };
}

/** deterministic little PRNG for the drawings */
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

export function screenAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const c = document.createElement("canvas"); c.width = AW; c.height = AH;
  const g = c.getContext("2d")!;
  CELLS.forEach((cell, i) => {
    const x = (i % 8) * CW, y = Math.floor(i / 8) * CH;
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, CW, CH); g.clip();
    drawCell(g, cell, rng(i * 977 + 13));
    g.restore();
  });
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  return atlas;
}

const bar = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
function chrome(g: CanvasRenderingContext2D, bg: string, accent: string) {
  bar(g, 0, 0, CW, CH, bg);
  bar(g, 0, 0, CW, 20, "rgba(255,255,255,0.08)");
  for (const [k, col] of [[0, "#ff7a6b"], [1, "#ffcf5a"], [2, "#6fd48a"]] as const) { g.fillStyle = col; g.beginPath(); g.arc(12 + k * 12, 10, 3.5, 0, Math.PI * 2); g.fill(); }
  bar(g, 52, 7, 90, 6, accent);
}
function drawCell(g: CanvasRenderingContext2D, cell: Cell, r: () => number): void {
  const idle = cell.endsWith("-idle");
  const kind = idle ? cell.replace("-idle", "") : cell;
  if (idle) {
    // a calm idle screen: the work's own colour, dimmed, one slow card — "powered, waiting"
    const base: Record<string, string> = { design: "#3b3247", code: "#1d2530", review: "#24342e", general: "#2a3038", orchestration: "#1f2a3a", devices: "#222830" };
    // a STANDBY screen, like a real workstation's lock screen: a deep gradient in the work's own hue, the Lab's
    // leaf mark, the station's role and a quiet status line (the shader breathes it and drifts a soft glow)
    const top = base[kind] ?? "#262b33";
    const grd = g.createLinearGradient(0, 0, CW, CH); grd.addColorStop(0, top); grd.addColorStop(1, "#14181e");
    g.fillStyle = grd; g.fillRect(0, 0, CW, CH);
    g.fillStyle = "rgba(230,180,90,0.85)"; g.beginPath(); g.ellipse(128, 104, 9, 15, 0.6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(20,24,30,0.9)"; g.lineWidth = 2; g.beginPath(); g.moveTo(122, 114); g.lineTo(134, 94); g.stroke();
    g.textAlign = "center"; g.fillStyle = "rgba(240,236,228,0.82)"; g.font = "bold 17px sans-serif";
    g.fillText({ design: "Design", code: "Build", review: "Review", general: "Workspace", orchestration: "Orchestration", devices: "Devices" }[kind] ?? "Station", 128, 146);
    g.fillStyle = "rgba(240,236,228,0.45)"; g.font = "11px sans-serif"; g.fillText("standby  ·  ready for work", 128, 164);
    g.fillStyle = "rgba(127,224,200,0.7)"; g.beginPath(); g.arc(94, 186, 3, 0, Math.PI * 2); g.fill();
    bar(g, 102, 184, 60, 3, "rgba(240,236,228,0.18)");
    return;
  }
  switch (kind as Cell) {
    case "design": {
      chrome(g, "#f4efe8", "#e0a46a");
      const sw = ["#e8826c", "#f2c06b", "#7fb7a4", "#6b8fd6", "#c58fd8", "#3f4a5c"];
      for (let i = 0; i < 6; i++) bar(g, 14 + i * 38, 30, 32, 32, sw[i]);
      for (let k = 0; k < 4; k++) { g.fillStyle = ["#d9cfc4", "#cdd9e6", "#e6d3cf", "#d6e2d6"][k]; g.beginPath(); g.roundRect(14 + (k % 2) * 116, 74 + Math.floor(k / 2) * 86, 108, 78, 8); g.fill(); }
      g.strokeStyle = "#e0a46a"; g.lineWidth = 3; g.beginPath(); g.moveTo(30, 200); g.bezierCurveTo(70, 130, 120, 230, 220, 120); g.stroke();
      return;
    }
    case "reference": {
      bar(g, 0, 0, CW, CH, "#1f242c");
      const grd = g.createLinearGradient(0, 0, 0, 160); grd.addColorStop(0, "#9fc6e8"); grd.addColorStop(1, "#e9d7b8");
      g.fillStyle = grd; g.fillRect(16, 16, 224, 150);
      g.fillStyle = "#5f8a54"; g.beginPath(); g.ellipse(128, 150, 110, 30, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#7a5338"; g.fillRect(122, 80, 12, 70);
      g.fillStyle = "#6fa05b"; g.beginPath(); g.arc(128, 74, 34, 0, Math.PI * 2); g.fill();
      for (let k = 0; k < 4; k++) bar(g, 16, 180 + k * 16, 140 + r() * 80, 7, "rgba(255,255,255,0.55)");
      return;
    }
    case "code": case "terminal": {
      const term = kind === "terminal";
      bar(g, 0, 0, CW, CH, term ? "#0d1210" : "#1b2129");
      if (!term) { bar(g, 0, 0, 40, CH, "#151a21"); bar(g, 0, 0, CW, 18, "#232a34"); }
      const palette = term ? ["#7ee08f", "#7ee08f", "#a8b3ad"] : ["#7fb7ff", "#f2c06b", "#c58fd8", "#9fd6a1", "#e8826c", "#d6dde6"];
      let yy = 26;
      for (let line = 0; line < 22; line++) {
        let xx = (term ? 10 : 50) + Math.floor(r() * 3) * 14;
        const n = 1 + Math.floor(r() * 4);
        for (let k = 0; k < n; k++) { const w = 12 + r() * 46; bar(g, xx, yy, w, 5, palette[Math.floor(r() * palette.length)]); xx += w + 6; }
        if (!term) bar(g, 14, yy, 14, 5, "#3a4452");
        yy += 10;
      }
      if (term) bar(g, 10, yy, 9, 8, "#7ee08f");
      return;
    }
    case "review": case "compare": {
      bar(g, 0, 0, CW, CH, "#eef1f0");
      for (const k of [0, 1]) {
        g.fillStyle = "#ffffff"; g.fillRect(10 + k * 122, 14, 114, 168);
        bar(g, 10 + k * 122, 14, 114, 22, k ? "#7fb7a4" : "#6b8fd6");
        for (let i = 0; i < 5; i++) bar(g, 18 + k * 122, 46 + i * 24, 70 + r() * 26, 8, "#cfd6dc");
        bar(g, 18 + k * 122, 160, 50, 14, k ? "#f2c06b" : "#e8826c");
      }
      if (kind === "review") for (let i = 0; i < 4; i++) { g.fillStyle = i < 3 ? "#5fc27e" : "#d6dde6"; g.beginPath(); g.arc(28 + i * 30, 214, 10, 0, Math.PI * 2); g.fill(); }
      return;
    }
    case "devices": {
      bar(g, 0, 0, CW, CH, "#1a1f26");
      g.fillStyle = "#f3f5f7"; g.beginPath(); g.roundRect(20, 24, 70, 140, 10); g.fill();
      g.fillStyle = "#6b8fd6"; g.fillRect(28, 40, 54, 30);
      for (let i = 0; i < 4; i++) bar(g, 28, 80 + i * 16, 54, 8, "#d6dde6");
      g.fillStyle = "#f3f5f7"; g.beginPath(); g.roundRect(104, 24, 132, 96, 8); g.fill();
      g.fillStyle = "#7fb7a4"; g.fillRect(112, 32, 116, 40);
      for (let i = 0; i < 3; i++) bar(g, 112, 80 + i * 12, 90, 6, "#d6dde6");
      return;
    }
    case "general": {
      chrome(g, "#fafafa", "#8aa2c4");
      for (let i = 0; i < 14; i++) bar(g, 18, 32 + i * 14, 120 + r() * 100, 6, i % 5 === 0 ? "#6b8fd6" : "#c9d0d8");
      return;
    }
    case "orchestration": {
      bar(g, 0, 0, CW, CH, "#16202c");
      const nodes = [[128, 40], [52, 120], [128, 120], [204, 120], [90, 200], [166, 200]];
      g.strokeStyle = "rgba(143,190,255,0.6)"; g.lineWidth = 3;
      for (const [a, b] of [[0, 1], [0, 2], [0, 3], [1, 4], [2, 4], [2, 5], [3, 5]]) { g.beginPath(); g.moveTo(nodes[a][0], nodes[a][1]); g.lineTo(nodes[b][0], nodes[b][1]); g.stroke(); }
      nodes.forEach(([x, y], i) => { g.fillStyle = i === 0 ? "#f2c06b" : ["#6b8fd6", "#7fb7a4", "#e8826c", "#c58fd8", "#9fd6a1"][i - 1]; g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill(); });
      return;
    }
    case "status": {
      bar(g, 0, 0, CW, CH, "#20262e");
      for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) { g.fillStyle = (i * 6 + k) % 7 === 0 ? "#f2c06b" : (i * 6 + k) % 5 === 0 ? "#3a4452" : "#5fc27e"; g.beginPath(); g.arc(30 + k * 39, 44 + i * 56, 13, 0, Math.PI * 2); g.fill(); }
      return;
    }
    case "job": {
      bar(g, 0, 0, CW, CH, "#fbf6ec");
      bar(g, 0, 0, CW, 46, "#2d6b5a");
      g.fillStyle = "#ffffff"; g.font = "bold 22px sans-serif"; g.fillText("NEW JOB", 16, 31);
      g.fillStyle = "#f2c06b"; g.beginPath(); g.arc(226, 23, 10, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 6; i++) bar(g, 16, 66 + i * 22, 160 + r() * 60, 9, i === 0 ? "#2d6b5a" : "#cfc6b6");
      for (let k = 0; k < 3; k++) { g.fillStyle = ["#e8826c", "#6b8fd6", "#7fb7a4"][k]; g.beginPath(); g.arc(30 + k * 34, 224, 12, 0, Math.PI * 2); g.fill(); }
      return;
    }
    case "artifact-ready": {
      bar(g, 0, 0, CW, CH, "#ffffff");
      bar(g, 0, 0, CW, 70, "#6b8fd6"); bar(g, 18, 22, 120, 12, "#ffffff"); bar(g, 18, 42, 80, 8, "#dfe8ff");
      for (let k = 0; k < 3; k++) { g.fillStyle = "#eef1f6"; g.fillRect(14 + k * 80, 88, 70, 70); bar(g, 22 + k * 80, 96, 54, 30, ["#f2c06b", "#7fb7a4", "#e8826c"][k]); }
      for (let i = 0; i < 3; i++) bar(g, 18, 176 + i * 16, 200 - i * 40, 7, "#cfd6dc");
      return;
    }
    case "artifact-empty": { bar(g, 0, 0, CW, CH, "#232930"); g.strokeStyle = "rgba(255,255,255,0.22)"; g.lineWidth = 4; g.setLineDash([14, 10]); g.strokeRect(30, 30, 196, 196); g.setLineDash([]); return; }
    case "artifact-input": { bar(g, 0, 0, CW, CH, "#3a2f1c"); g.fillStyle = "#f2b04a"; g.beginPath(); g.arc(128, 116, 46, 0, Math.PI * 2); g.fill(); bar(g, 122, 92, 12, 32, "#3a2f1c"); bar(g, 122, 132, 12, 10, "#3a2f1c"); return; }
    case "artifact-approval": { bar(g, 0, 0, CW, CH, "#1c2a3a"); g.strokeStyle = "#7fb7ff"; g.lineWidth = 12; g.beginPath(); g.moveTo(80, 130); g.lineTo(116, 166); g.lineTo(180, 92); g.stroke(); return; }
    case "off": { const grd = g.createLinearGradient(0, 0, CW, CH); grd.addColorStop(0, "#1a1e24"); grd.addColorStop(1, "#2a3038"); g.fillStyle = grd; g.fillRect(0, 0, CW, CH); bar(g, 30, 20, 70, 220, "rgba(255,255,255,0.04)"); return; }
    case "window-warm": case "window-bunks": case "window-lounge": case "window-hall": {
      // a lit interior glimpsed through glass: warm wall, a lamp's pool, furniture silhouettes — never modelled
      const grd = g.createRadialGradient(150, 90, 10, 128, 128, 200); grd.addColorStop(0, "#ffe2a8"); grd.addColorStop(0.5, "#e8a85c"); grd.addColorStop(1, "#7a4a28");
      g.fillStyle = grd; g.fillRect(0, 0, CW, CH);
      g.fillStyle = "rgba(60,32,16,0.55)";
      if (kind === "window-bunks") { g.fillRect(20, 120, 216, 14); g.fillRect(20, 200, 216, 14); g.fillRect(20, 110, 10, 140); g.fillRect(226, 110, 10, 140); }
      else if (kind === "window-lounge") { g.beginPath(); g.roundRect(30, 170, 150, 50, 14); g.fill(); g.fillRect(190, 120, 40, 100); }
      else if (kind === "window-hall") { for (let k = 0; k < 4; k++) g.fillRect(24 + k * 58, 60, 40, 150); }
      else { g.fillRect(30, 60, 70, 150); for (let k = 0; k < 4; k++) g.fillRect(34, 70 + k * 36, 62, 4); g.beginPath(); g.arc(180, 90, 22, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = "rgba(255,240,200,0.5)"; g.beginPath(); g.arc(160, 70, 18, 0, Math.PI * 2); g.fill();
      return;
    }
    case "sign-lab": case "sign-results": {
      bar(g, 0, 0, CW, CH, "#20352e");
      // a WIDE BAND (y 108–148): signs are long and low, and crop the cell to their own aspect
      g.fillStyle = "#e6b45a"; g.beginPath(); g.ellipse(30, 128, 7, 12, 0.6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#20352e"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(25, 136); g.lineTo(35, 120); g.stroke();
      g.fillStyle = "#f6efe0"; g.font = "bold 25px sans-serif"; g.textAlign = "center";
      g.fillText(kind === "sign-lab" ? "AI LAB" : "RESULTS", 142, 131);
      g.font = "bold 9px sans-serif"; g.fillStyle = "#cfe3d6"; g.fillText(kind === "sign-lab" ? "OFFSHORLY  ·  MONKEYAGENTS" : "READY  ·  REVIEW  ·  DELIVER", 142, 145);
      return;
    }
    case "lighttable": { bar(g, 0, 0, CW, CH, "#fff8ec"); for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(110,90,70,${0.12 + r() * 0.12})`; g.fillRect(20 + (k % 3) * 76, 30 + Math.floor(k / 3) * 100, 64, 84); } return; }
    case "pinboard": {
      bar(g, 0, 0, CW, CH, "#c9a77c");
      for (let k = 0; k < 14; k++) { const w = 34 + r() * 30, h = 26 + r() * 30; g.fillStyle = ["#fbf6ec", "#f2c06b", "#9fc6e8", "#e8826c", "#7fb7a4", "#ffffff"][k % 6]; g.save(); g.translate(16 + r() * 200, 16 + r() * 200); g.rotate((r() - 0.5) * 0.3); g.fillRect(0, 0, w, h); g.restore(); }
      return;
    }
    case "whiteboard": { bar(g, 0, 0, CW, CH, "#fbfcfd"); g.strokeStyle = "#6b8fd6"; g.lineWidth = 3; for (let k = 0; k < 4; k++) { g.strokeRect(20 + k * 56, 40 + (k % 2) * 60, 40, 30); } g.strokeStyle = "#e8826c"; g.beginPath(); g.moveTo(40, 200); g.lineTo(220, 170); g.stroke(); return; }
    case "map": { bar(g, 0, 0, CW, CH, "#e9efe6"); g.fillStyle = "#9fc6e8"; g.beginPath(); g.ellipse(170, 60, 70, 34, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = "#6fa05b"; g.beginPath(); g.arc(120, 140, 30, 0, Math.PI * 2); g.fill(); return; }
    default: bar(g, 0, 0, CW, CH, "#222");
  }
}

// ============================== THE SCREEN BANK ===============================================================
export type ScreenState = "active" | "idle" | "offline" | "working" | "done";
/** what kind of motion a screen's content runs (the shader's per-quad program; 0 = still) */
const KIND: Partial<Record<Cell, number>> = {
  design: 1, reference: 2, code: 3, terminal: 4, review: 5, compare: 6, devices: 7, general: 8, orchestration: 9, status: 10, job: 11,
  "artifact-ready": 12, "artifact-input": 12, "artifact-approval": 12, map: 13,
};
const MODE: Record<ScreenState, number> = { offline: 0, idle: 1, active: 2, working: 3, done: 4 };
/** ONE MESH FOR EVERY SCREEN IN THE LAB. Quads are added with an owner (a station id, or "lab"), their content
 *  cell and an idle cell; `setState(owner, state)` rewrites only that owner's UVs, brightness and MODE. The screen
 *  material's shader turns the mode into functional motion (labMaterials `screen()`): ambient activity when a
 *  station is merely on, clearly busier while an agent WORKS it, a calm standby when idle, a settled completed
 *  card when DONE — all from the one atlas, one draw. */
export class ScreenBank {
  private readonly quads: { owner: string; cell: Cell; idle: Cell; p: THREE.Vector3[]; bright: number; seed: number }[] = [];
  private geo: THREE.BufferGeometry | null = null;
  private readonly ranges = new Map<string, number[]>();
  private readonly states = new Map<string, ScreenState>();
  /** add a screen face: its four world corners (bottom-left, bottom-right, top-right, top-left as seen) */
  add(owner: string, cell: Cell, corners: THREE.Vector3[], idle: Cell = cell, bright = 1): void {
    this.quads.push({ owner, cell, idle, p: corners, bright, seed: (this.quads.length * 0.6180339) % 1 });
  }
  /** an upright screen facing `yaw` (0 = its face looks +z), centred at (x, y, z); `tilt` leans its top back */
  upright(owner: string, cell: Cell, x: number, y: number, z: number, w: number, h: number, yaw: number, idle: Cell = cell, bright = 1, tilt = 0): void {
    const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(w / 2);
    const up = new THREE.Vector3(0, Math.cos(tilt), 0).addScaledVector(n, -Math.sin(tilt)).multiplyScalar(h / 2), c = new THREE.Vector3(x, y, z);
    this.add(owner, cell, [c.clone().sub(r).sub(up), c.clone().add(r).sub(up), c.clone().add(r).add(up), c.clone().sub(r).add(up)], idle, bright);
  }
  mesh(material: THREE.Material): THREE.Mesh {
    const n = this.quads.length;
    const pos = new Float32Array(n * 18), uv = new Float32Array(n * 12), col = new Float32Array(n * 18);
    const local = new Float32Array(n * 12), rect = new Float32Array(n * 24), fx = new Float32Array(n * 18);
    const L = [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.quads.forEach((q, i) => {
      const order = [0, 1, 2, 0, 2, 3];
      order.forEach((k, j) => { pos.set([q.p[k].x, q.p[k].y, q.p[k].z], (i * 6 + j) * 3); local.set(L[k], (i * 6 + j) * 2); });
      const list = this.ranges.get(q.owner) ?? []; list.push(i); this.ranges.set(q.owner, list);
    });
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    this.geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.geo.setAttribute("aLocal", new THREE.BufferAttribute(local, 2));
    this.geo.setAttribute("aCell", new THREE.BufferAttribute(rect, 4));
    this.geo.setAttribute("aFx", new THREE.BufferAttribute(fx, 3));
    this.geo.computeVertexNormals();
    for (const owner of this.ranges.keys()) this.setState(owner, this.states.get(owner) ?? "active");
    const m = new THREE.Mesh(this.geo, material);
    m.name = "ai-lab-v2-screens";
    return m;
  }
  state(owner: string): ScreenState | undefined { return this.states.get(owner); }
  /** STATE-DRIVEN CONTENT: an owner's screens show their work (active / working / done), standby, or are off */
  setState(owner: string, state: ScreenState): void {
    this.states.set(owner, state);
    if (!this.geo) return;
    const uv = this.geo.getAttribute("uv") as THREE.BufferAttribute, col = this.geo.getAttribute("color") as THREE.BufferAttribute;
    const rect = this.geo.getAttribute("aCell") as THREE.BufferAttribute, fx = this.geo.getAttribute("aFx") as THREE.BufferAttribute;
    for (const i of this.ranges.get(owner) ?? []) {
      const q = this.quads[i];
      const cell = state === "offline" ? "off" : state === "idle" ? q.idle : q.cell;
      const u = cellUV(cell);
      const corners = [[u.u0, u.v0], [u.u1, u.v0], [u.u1, u.v1], [u.u0, u.v0], [u.u1, u.v1], [u.u0, u.v1]];
      const b = (state === "offline" ? 0.55 : state === "idle" ? 0.7 : 1) * q.bright;
      const kind = state === "idle" || state === "offline" ? 0 : KIND[q.cell] ?? 0;
      corners.forEach(([a, c], j) => {
        const v = i * 6 + j;
        uv.setXY(v, a, c); col.setXYZ(v, b, b, b); rect.setXYZW(v, u.u0, u.v0, u.u1, u.v1); fx.setXYZ(v, kind, q.seed, MODE[state]);
      });
    }
    uv.needsUpdate = true; col.needsUpdate = true; rect.needsUpdate = true; fx.needsUpdate = true;
  }
  get owners(): string[] { return [...this.ranges.keys()]; }
}

// ============================== THE SCREEN SHADER =============================================================
/** FUNCTIONAL MOTION on every Lab screen, from the one atlas. Per quad: its content KIND (which program), a SEED
 *  (so neighbours never move in step) and a MODE (0 off · 1 standby · 2 ambient · 3 working · 4 done). Motion is
 *  deliberately quiet: stepped scrolling, a cursor, a moving selection, a scan band, progress — no flashing. */
const SCREEN_GLSL = /* glsl */ `
float sbox(vec2 p, vec2 a, vec2 b) { vec2 d = step(a, p) * step(p, b); return d.x * d.y; }
float scirc(vec2 p, vec2 c, float r) { return 1.0 - smoothstep(r * 0.82, r, length(p - c)); }
float sring(vec2 p, vec2 c, float r, float w) { return 1.0 - smoothstep(w * 0.5, w, abs(length(p - c) - r)); }
float sseg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
vec2 cp(float x, float y) { return vec2(x / 256.0, 1.0 - y / 256.0); }
float shash(float n) { return fract(sin(n) * 43758.5453); }
vec3 sampleCell(sampler2D m, vec4 cell, vec2 l) { return texture2D(m, mix(cell.xy, cell.zw, clamp(l, 0.0, 1.0))).rgb; }
vec3 screenColor(sampler2D m, vec2 l, vec4 cell, vec3 fx, float t) {
  float seed = fx.y, mode = fx.z;
  int k = int(fx.x + 0.5);
  float working = step(2.5, mode) * step(mode, 3.5), done = step(3.5, mode), on = step(1.5, mode), idle = step(0.5, mode) * (1.0 - on);
  float T = t + seed * 23.0;
  float ph = done > 0.5 ? seed * 40.0 : T * mix(0.4, 1.0, working);
  vec2 c = l;
  if (k == 3 || k == 4) {
    // CODE / TERMINAL: the body scrolls a line at a time (eased), the title bar stays put
    float top = 1.0 - 20.0 / 256.0, lh = 10.0 / 256.0, q = ph * (k == 4 ? 1.6 : 0.6);
    float st = floor(q) + smoothstep(0.7, 1.0, fract(q));
    if (c.y < top) c.y = mod(c.y + st * lh, top - 4.0 / 256.0);
  } else if (k == 2) {
    // REFERENCE: a slow pan and zoom across the board
    c = 0.5 + (c - 0.5) * (0.93 + 0.04 * sin(ph * 0.21)) + vec2(0.02 * sin(ph * 0.13), 0.0);
  }
  vec3 col = sampleCell(m, cell, c);
  if (on > 0.5) {
    if (k == 1) {
      // DESIGN: a selection hopping between artboards, a cursor working inside it
      float sel = mod(floor(ph / 3.2 + seed * 4.0), 4.0);
      vec2 a0 = cp(14.0 + mod(sel, 2.0) * 116.0, 152.0 + floor(sel / 2.0) * 86.0), a1 = a0 + vec2(108.0, 78.0) / 256.0;
      float rim = sbox(c, a0 - 0.008, a1 + 0.008) - sbox(c, a0 + 0.004, a1 - 0.004);
      col = mix(col, vec3(0.88, 0.64, 0.42), rim * 0.85);
      vec2 cur = mix(a0, a1, vec2(0.5 + 0.38 * sin(ph * 0.9), 0.5 + 0.34 * sin(ph * 0.67 + 1.3)));
      vec2 d = c - cur;
      col = mix(col, vec3(0.12), step(0.0, -d.y) * step(0.0, d.x) * step(d.x, -d.y * 0.62) * step(-d.y, 0.05));
    } else if (k == 3) {
      // CODE: a caret blinking at the line being edited
      float x = 0.3 + 0.25 * shash(floor(ph * 0.25) + seed * 9.0);
      col = mix(col, vec3(0.95), sbox(c, vec2(x, 0.46), vec2(x + 0.012, 0.5)) * step(0.5, fract(T * 0.9)));
    } else if (k == 4) {
      // TERMINAL: the build's progress bar along the bottom
      float p = fract(ph / 14.0);
      col = mix(col, vec3(0.16, 0.2, 0.18), sbox(c, vec2(0.04, 0.03), vec2(0.96, 0.06)));
      col = mix(col, vec3(0.49, 0.88, 0.56), sbox(c, vec2(0.045, 0.036), vec2(0.045 + 0.91 * p, 0.054)));
    } else if (k == 5 || k == 6) {
      // REVIEW / COMPARE: a scan band moving down both pages; the checklist filling in
      float y = 1.0 - fract(ph / 7.0) * 0.72 - 0.06;
      col = mix(col, vec3(0.42, 0.56, 0.84), sbox(c, vec2(0.04, y - 0.03), vec2(0.96, y)) * 0.2);
      if (k == 5) {
        float n = floor(fract(ph / 18.0) * 5.0);
        for (int i = 0; i < 4; i++) { float fi = float(i); col = mix(col, fi < n ? vec3(0.37, 0.76, 0.49) : vec3(0.84, 0.87, 0.9), scirc(c, cp(28.0 + fi * 30.0, 214.0), 10.0 / 256.0)); }
      }
    } else if (k == 7) {
      // DEVICES: the app under test loading, a slow status pulse
      float p = fract(ph / 6.0 + seed);
      col = mix(col, vec3(0.42, 0.56, 0.84), sbox(c, cp(28.0, 158.0), cp(28.0 + 54.0 * p, 152.0)));
      col = mix(col, vec3(0.37, 0.76, 0.49), scirc(c, cp(228.0, 140.0), 0.03) * (0.6 + 0.4 * sin(T * 1.4)));
    } else if (k == 8 || k == 10) {
      // GENERAL / STATUS: one row highlighted in turn
      float row = mod(floor(ph / 2.4), 12.0);
      col = mix(col, vec3(0.55, 0.65, 0.85), sbox(c, vec2(0.05, 1.0 - (36.0 + row * 14.0) / 256.0), vec2(0.6, 1.0 - (30.0 + row * 14.0) / 256.0)) * 0.6);
    } else if (k == 9) {
      // ORCHESTRATION: a work packet travelling the graph, the root node breathing
      vec2 n0 = cp(128.0, 40.0), n1 = cp(52.0, 120.0), n2 = cp(128.0, 120.0), n3 = cp(204.0, 120.0), n4 = cp(90.0, 200.0), n5 = cp(166.0, 200.0);
      float e = mod(floor(ph / 2.6 + seed * 7.0), 4.0), u = smoothstep(0.0, 1.0, fract(ph / 2.6 + seed * 7.0));
      vec2 a = n0, b = n1;
      if (e > 0.5 && e < 1.5) { a = n2; b = n4; } else if (e > 1.5 && e < 2.5) { a = n0; b = n3; } else if (e > 2.5) { a = n3; b = n5; }
      col = mix(col, vec3(1.0, 0.93, 0.7), scirc(c, mix(a, b, u), 0.022));
      col = mix(col, vec3(0.95, 0.75, 0.42), sring(c, n0, 0.07 + 0.012 * sin(T * 1.3), 0.008) * 0.8);
    } else if (k >= 11) {
      // JOB / ARTIFACT / MAP: a slow sheen every ~9 s and a calm status dot
      float x = fract(T / 9.0) * 2.4 - 0.7;
      col += vec3(0.07) * sbox(c, vec2(x, 0.0), vec2(x + 0.08, 1.0));
      col = mix(col, vec3(0.37, 0.76, 0.49), scirc(c, vec2(0.92, 0.9), 0.025) * (0.55 + 0.45 * sin(T * 1.1)));
    }
    if (working > 0.5 && k != 4 && k != 0 && k < 11) {
      // WORKING: the task's own progress along the bottom edge
      col = mix(col, vec3(0.3), sbox(c, vec2(0.0), vec2(1.0, 0.018)));
      col = mix(col, vec3(0.55, 0.83, 0.94), sbox(c, vec2(0.0), vec2(fract(ph / 16.0), 0.018)));
    }
    if (done > 0.5 && k != 0) {
      // DONE: settled — a full bar and a check badge
      vec2 bc = vec2(0.88, 0.14);
      col = mix(col, vec3(0.37, 0.76, 0.49), sbox(c, vec2(0.0), vec2(1.0, 0.018)));
      col = mix(col, vec3(0.37, 0.76, 0.49), scirc(c, bc, 0.075));
      float tk = min(sseg(c, bc + vec2(-0.032, 0.0), bc + vec2(-0.008, -0.024)), sseg(c, bc + vec2(-0.008, -0.024), bc + vec2(0.034, 0.028)));
      col = mix(col, vec3(1.0), (1.0 - smoothstep(0.006, 0.011, tk)) * scirc(c, bc, 0.075));
    }
  }
  if (idle > 0.5) {
    // STANDBY: breathing softly, a slow drifting glow — powered, waiting
    vec2 g = vec2(0.5 + 0.3 * sin(T * 0.11), 0.5 + 0.25 * cos(T * 0.08));
    col += vec3(0.06, 0.07, 0.09) * exp(-dot(l - g, l - g) / 0.06);
    col *= 0.94 + 0.05 * sin(T * 0.5);
  }
  // the glass: a slight edge falloff and a soft sheen toward the top
  float ed = min(min(l.x, 1.0 - l.x), min(l.y, 1.0 - l.y));
  col *= 0.9 + 0.1 * smoothstep(0.0, 0.08, ed);
  col += vec3(0.03) * smoothstep(0.55, 1.0, l.y) * (1.0 - l.x * 0.5);
  return col;
}
`;
