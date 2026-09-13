// vo3d build — the OFFSHORLY logo as a PREMIUM FLOATING ACRYLIC SIGN set into the reception floor.
//
// The geometry comes from the brand SVG itself (src/assets/brand/offshorly-logo.svg, copied verbatim from
// Offshorly-Branding/Offshorly-SVG-Logo.svg). Nothing here redraws, traces or approximates the mark:
// Vite inlines the file as a string at BUILD time (`?raw` — no network, no runtime fetch), three's SVGLoader
// parses the real path data, and each path's shapes are extruded into solid geometry. Parsing happens once,
// lazily, and the result is cached for the process. The lockup is never distorted.
//
// 7D REDESIGN. The old treatment framed the mark in a bronze-trimmed graphite pan — a brown plaque lying on
// the floor. That backing board is GONE: no pan, no wash, no trim bars. The letters now mount straight onto
// the tile and are lit from behind, so the mark reads as dimensional acrylic signage rather than a plaque.
//
// The stack under each letterform, bottom → top:
//   • contact shadow   y 0.02   soft dark silhouette, grown a little, on FLOOR_LAYER.contact — the dark
//                               that sells "lifted off the tile" and keeps the mark anchored
//   • back halo        y 0.07   an additive silhouette grown further: WHITE behind the dark wordmark (the
//                               controlled backlight that makes the letters float), GREEN behind the symbol
//   • body             y 0.10 … 0.78  extruded with a small bevel:
//                               – symbol:   translucent green acrylic, faintly lit from inside, with its
//                                           extruded RETURN emissive so the edges glow like lit acrylic
//                               – wordmark: dark acrylic, matte face, with a soft light return so the edge
//                                           picks up the backlight rather than emitting on its own
//
// Restraint is the brief: this is architectural signage, not neon. Every emissive here is well under a real
// LED strip's intensity, the halos are thin, and the whole piece is lit by materials plus three flat
// silhouette meshes per fill — NO additional real-time lights.
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import logoSvg from "../../../assets/brand/offshorly-logo.svg?raw";
import { FLOOR_LAYER, contactShadowMat, floorLayer } from "../render/Materials";
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
  /** the region the sign is centred in; the lockup keeps the SVG's own aspect and is fitted inside it */
  area: Rect;
  /** kept for source compatibility; the trim curb it used to size no longer exists */
  curb?: number;
};

/** margin the lockup keeps inside `area`, replacing the old curb + pan margin */
const FIT_MARGIN = 4;
/** how far the contact shadow and the back halo grow past each letterform, in world units */
const SHADOW_GROW = 0.9;
const HALO_GROW = 1.8;
/** the body: base just off the tile, so the bevel's underside catches the halo */
const BODY_Y = 0.1;
const BODY_H = 0.68;

/** Is this fill the green symbol (rather than the dark wordmark)? Compared against the brand's own values. */
const isBrandGreen = (hex: number): boolean => {
  const d = (a: number, b: number) => Math.abs(((a >> 16) & 255) - ((b >> 16) & 255)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255));
  return d(hex, LOGO_BRAND_GREEN) <= d(hex, LOGO_BRAND_DARK);
};

/** Flat silhouette of `shapes`, each grown about ITS OWN centre so the result reads as a per-letter outline
 *  rather than the whole lockup scaled up (which would slide the outer letters outward and the inner ones
 *  barely at all). Returns geometry already in the sign's local, lockup-centred space. */
function silhouette(shapes: THREE.Shape[], s: number, grow: number, y: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const shape of shapes) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.01, bevelEnabled: false, curveSegments: 10 });
    geo.rotateX(Math.PI / 2);
    geo.scale(s, 1, s);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const kx = 1 + (2 * grow) / Math.max(1e-3, b.max.x - b.min.x);
    const kz = 1 + (2 * grow) / Math.max(1e-3, b.max.z - b.min.z);
    geo.translate(-cx, 0, -cz);
    geo.scale(kx, 1, kz);
    geo.translate(cx, y, cz);
    out.push(geo);
  }
  return out;
}

/**
 * The reception floor sign. World-space; the caller adds it as-is.
 * The lockup is NEVER distorted — it is scaled uniformly to fit `area` and centred on it.
 */
export function offshorlyInlay(spec: LogoInlaySpec): THREE.Group {
  const g = new THREE.Group();
  g.name = "reception-logo-inlay";
  const p = logoShapes();
  const { area } = spec;
  const cx = area.x + area.w / 2, cz = area.z + area.d / 2;
  if (!p) return g; // no DOM parser (tests): the sign contributes no geometry rather than a fake stand-in

  const size = p.box.getSize(new THREE.Vector2());
  const s = Math.min((area.w - 2 * FIT_MARGIN) / size.x, (area.d - 2 * FIT_MARGIN) / size.y);
  // everything is authored around the lockup's own centre and carried into the room by this group, which is
  // what lets the halo and shadow grow about each letter instead of about the world origin
  const sign = new THREE.Group();
  sign.position.set(cx, 0, cz);
  g.add(sign);
  // SVG space is y-down; rotateX(+π/2) lays the shape on the floor and maps shape y → world +z
  const centreShape = (geo: THREE.BufferGeometry) => geo.translate(-(p.box.min.x + size.x / 2) * s, 0, -(p.box.min.y + size.y / 2) * s);

  for (const grp of p.groups) {
    const green = isBrandGreen(grp.colorHex);

    // ---- contact shadow: what stops the mark looking pasted on -----------------------------------
    for (const geo of silhouette(grp.shapes, s, SHADOW_GROW, 0.02)) {
      const m = new THREE.Mesh(centreShape(geo), contactShadowMat(0.2));
      m.castShadow = m.receiveShadow = false;
      sign.add(m);
    }
    // ---- back halo: WHITE behind the wordmark, GREEN behind the symbol ----------------------------
    // additive and thin, so in daytime light it reads as a lit edge rather than a glowing panel
    const haloMat = floorLayer(new THREE.MeshBasicMaterial({
      color: green ? LOGO_BRAND_GREEN : 0xffffff,
      transparent: true, opacity: green ? 0.3 : 0.34, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }), FLOOR_LAYER.contact + 1);
    for (const geo of silhouette(grp.shapes, s, HALO_GROW, 0.07)) {
      const m = new THREE.Mesh(centreShape(geo), haloMat);
      m.castShadow = m.receiveShadow = false;
      sign.add(m);
    }

    // ---- the body --------------------------------------------------------------------------------
    // ExtrudeGeometry emits group 0 = cap faces, group 1 = the extruded sides, so a two-material array
    // lets the RETURN behave differently from the face — which is exactly how lit acrylic reads.
    const body = new THREE.ExtrudeGeometry(grp.shapes, {
      depth: BODY_H, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.1, bevelSegments: 2, curveSegments: 10,
    });
    body.rotateX(Math.PI / 2);
    body.translate(0, BODY_H, 0); // extrude runs to world −y; lift it back onto its own base
    body.scale(s, 1, s);
    centreShape(body);
    body.translate(0, BODY_Y, 0);

    const face = green
      ? new THREE.MeshStandardMaterial({
          color: LOGO_BRAND_GREEN, roughness: 0.12, metalness: 0.0,
          transparent: true, opacity: 0.82, // translucent acrylic, not glass: the tile reads faintly through
          emissive: LOGO_BRAND_GREEN, emissiveIntensity: 0.3, // lit from within, restrained
        })
      : new THREE.MeshStandardMaterial({ color: LOGO_BRAND_DARK, roughness: 0.28, metalness: 0.05 });
    const edge = green
      ? new THREE.MeshStandardMaterial({
          color: LOGO_BRAND_GREEN, roughness: 0.1, metalness: 0.0,
          emissive: LOGO_BRAND_GREEN, emissiveIntensity: 0.95, // the acrylic's lit return
        })
      : new THREE.MeshStandardMaterial({
          color: 0x2a2a30, roughness: 0.22, metalness: 0.05,
          emissive: 0xffffff, emissiveIntensity: 0.12, // catches the backlight; never glows on its own
        });
    const m = new THREE.Mesh(body, [face, edge]);
    m.castShadow = true;
    m.receiveShadow = false;
    sign.add(m);
  }
  return g;
}

/** World rect the sign occupies (lockup plus its halo), for tests/placement checks. */
export function inlayFootprint(spec: LogoInlaySpec): Rect {
  const p = logoShapes();
  const { area } = spec;
  if (!p) return area;
  const size = p.box.getSize(new THREE.Vector2());
  const s = Math.min((area.w - 2 * FIT_MARGIN) / size.x, (area.d - 2 * FIT_MARGIN) / size.y);
  const w = size.x * s + 2 * HALO_GROW, d = size.y * s + 2 * HALO_GROW;
  return { x: area.x + area.w / 2 - w / 2, z: area.z + area.d / 2 - d / 2, w, d };
}

/** the two fills the brand SVG actually uses (asserted in tests so a swapped asset is caught) */
export const LOGO_BRAND_GREEN = 0x5dd9b3;
export const LOGO_BRAND_DARK = 0x1c1c22;
