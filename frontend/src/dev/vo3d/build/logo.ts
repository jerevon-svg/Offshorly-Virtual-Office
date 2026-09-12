// vo3d build — the OFFSHORLY logo as a genuine architectural FLOOR INLAY.
//
// The geometry comes from the brand SVG itself (src/assets/brand/offshorly-logo.svg, copied verbatim from
// Offshorly-Branding/Offshorly-SVG-Logo.svg). Nothing here redraws, traces or approximates the mark:
// Vite inlines the file as a string at BUILD time (`?raw` — no network, no runtime fetch), three's SVGLoader
// parses the real path data, and each path's shapes are extruded into solid geometry. Parsing happens once,
// lazily, and the result is cached for the process.
//
// Construction (outside → in), all real meshes, nothing floating and nothing camera-dependent:
//   • bronze trim curb     y 0 … 0.55   the visible edge of the inlay, set flush into the tile
//   • recessed pan         y 0 … 0.22   dark graphite base a step below the curb top → reads as a recess
//   • warm light wash      y 0.24       a whisper of backlight across the pan floor
//   • letterforms          y 0.34 … 0.79 brand-coloured tops with EMISSIVE EXTRUDED SIDES, i.e. the light
//                                        escapes around each letter's return — halo-lit, as in the source
// Deliberately low-key: the counter is the room's hero, so the inlay reads as architecture, not signage.
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import logoSvg from "../../../assets/brand/offshorly-logo.svg?raw";
import { rbox } from "./helpers";
import { emissiveMat, glowMat, mat } from "../render/Materials";
import type { Rect } from "../core/coords";

/** One fill colour's worth of shapes, straight from the SVG. */
export type LogoShapeGroup = { colorHex: number; shapes: THREE.Shape[] };

let parsed: { groups: LogoShapeGroup[]; box: THREE.Box2 } | null | undefined;

/** Parse the brand SVG once. Returns null where no DOM parser exists (non-browser test runners). */
export function logoShapes(): { groups: LogoShapeGroup[]; box: THREE.Box2 } | null {
  if (parsed !== undefined) return parsed;
  if (typeof DOMParser === "undefined") return (parsed = null);
  try {
    // three's bundled types declare Loader.parse() with no arguments; the SVGLoader runtime takes the text
    const data = (new SVGLoader() as unknown as { parse(text: string): { paths: THREE.ShapePath[] } }).parse(logoSvg);
    const byColor = new Map<number, THREE.Shape[]>();
    const box = new THREE.Box2();
    for (const path of data.paths) {
      const shapes = path.toShapes();
      if (!shapes.length) continue;
      const hex = path.color.getHex();
      const list = byColor.get(hex) ?? [];
      for (const s of shapes) {
        list.push(s);
        for (const p of s.getPoints(12)) box.expandByPoint(p);
      }
      byColor.set(hex, list);
    }
    if (byColor.size === 0) return (parsed = null);
    parsed = { groups: [...byColor].map(([colorHex, shapes]) => ({ colorHex, shapes })), box };
    return parsed;
  } catch {
    return (parsed = null);
  }
}

/** SVG-unit content bounds, for tests and for placement maths. */
export function logoAspect(): number | null {
  const p = logoShapes();
  if (!p) return null;
  const s = p.box.getSize(new THREE.Vector2());
  return s.x / s.y;
}

export type LogoInlaySpec = {
  /** the region the inlay is centred in; the lockup keeps the SVG's own aspect and is fitted inside it */
  area: Rect;
  /** trim curb width */
  curb?: number;
};

/**
 * The floor inlay. World-space; the caller adds it as-is.
 * The lockup is NEVER distorted — it is scaled uniformly to fit `area` and centred on it.
 */
export function offshorlyInlay(spec: LogoInlaySpec): THREE.Group {
  const g = new THREE.Group();
  g.name = "reception-logo-inlay";
  const p = logoShapes();
  const { area } = spec;
  const curb = spec.curb ?? 1.6;
  const cx = area.x + area.w / 2, cz = area.z + area.d / 2;
  if (!p) return g; // no DOM parser (tests): the inlay contributes no geometry rather than a fake stand-in

  const size = p.box.getSize(new THREE.Vector2());
  // uniform fit inside `area`, leaving room for the trim curb and a margin of quiet pan around the lockup
  const inner = { w: area.w - 2 * (curb + 4), d: area.d - 2 * (curb + 4) };
  const s = Math.min(inner.w / size.x, inner.d / size.y);
  const lockW = size.x * s, lockD = size.y * s;
  // the pan hugs the lockup (plus a quiet margin); the curb frames the pan
  const panW = lockW + 2 * 4, panD = lockD + 2 * 4;

  // ---- recessed pan + trim curb ------------------------------------------------------------------
  // Dark graphite recess, NOT a lit panel: the light in this piece comes only from the letters' returns.
  // (A bright pan read as an orange sign lying on the floor and competed with the hero counter.)
  const pan = rbox(panW, 0.22, panD, mat("bronzeDark", 0.52, { metalness: 0.4 }), cx, 0, cz, 0.35);
  pan.castShadow = false;
  g.add(pan);
  const wash = rbox(panW - 1.2, 0.04, panD - 1.2, glowMat("coveWarm", 0.06), cx, 0.24, cz, 0.25);
  wash.castShadow = wash.receiveShadow = false;
  g.add(wash);
  // trim: four slim bronze bars framing the pan, set flush into the tile and standing barely proud
  const trim = mat("bronze", 0.32, { metalness: 0.65 });
  for (const [dx, dz, w, d] of [
    [0, -(panD + curb) / 2, panW + 2 * curb, curb],
    [0, (panD + curb) / 2, panW + 2 * curb, curb],
    [-(panW + curb) / 2, 0, curb, panD],
    [(panW + curb) / 2, 0, curb, panD],
  ] as const) {
    const bar = rbox(w, 0.55, d, trim, cx + dx, 0, cz + dz, 0.18);
    bar.castShadow = false;
    g.add(bar);
  }

  // ---- the letterforms ---------------------------------------------------------------------------
  // ExtrudeGeometry emits group 0 = cap faces, group 1 = extruded sides → a two-material array lets the
  // SIDES glow (the light escaping around each letter's return) while the caps stay solid brand colour.
  const LETTER_H = 0.45, LETTER_Y = 0.34;
  const halo = emissiveMat("coveWarm", 0.85, 0.45);
  for (const grp of p.groups) {
    const geo = new THREE.ExtrudeGeometry(grp.shapes, { depth: LETTER_H, bevelEnabled: false, curveSegments: 10 });
    // SVG space (y down) → floor plane: rotateX(+π/2) maps shape y → world +z and the extrude depth to
    // world −y, so the piece is lifted by its own depth. Then scale uniformly and centre on the area.
    geo.rotateX(Math.PI / 2);
    geo.translate(0, LETTER_H, 0);
    geo.scale(s, 1, s);
    geo.translate(cx - (p.box.min.x + size.x / 2) * s, LETTER_Y, cz - (p.box.min.y + size.y / 2) * s);
    const face = new THREE.MeshStandardMaterial({ color: grp.colorHex, roughness: 0.34, metalness: 0.15 });
    const m = new THREE.Mesh(geo, [face, halo]);
    m.castShadow = true;
    m.receiveShadow = false;
    g.add(m);
  }
  return g;
}

/** World rect the inlay occupies (curb included), for tests/placement checks. */
export function inlayFootprint(spec: LogoInlaySpec): Rect {
  const p = logoShapes();
  const curb = spec.curb ?? 1.6;
  const { area } = spec;
  if (!p) return area;
  const size = p.box.getSize(new THREE.Vector2());
  const s = Math.min((area.w - 2 * (curb + 4)) / size.x, (area.d - 2 * (curb + 4)) / size.y);
  const panW = size.x * s + 8, panD = size.y * s + 8;
  const w = panW + 2 * curb, d = panD + 2 * curb;
  return { x: area.x + area.w / 2 - w / 2, z: area.z + area.d / 2 - d / 2, w, d };
}

/** the two fills the brand SVG actually uses (asserted in tests so a swapped asset is caught) */
export const LOGO_BRAND_GREEN = 0x5dd9b3;
export const LOGO_BRAND_DARK = 0x1c1c22;
