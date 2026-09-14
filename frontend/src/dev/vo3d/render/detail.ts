// vo3d render — SHARED PROCEDURAL DETAIL MAPS.
//
// One module, one instance per map, handed out BY REFERENCE to every material that wants it. Nothing here
// is cloned per object and nothing is downloaded: these are small canvases drawn once, on first use, from
// a deterministic periodic noise so a rebuild is byte-identical.
//
// WHY ROUGHNESS AND BUMP, NOT COLOUR. The office's colour identity is the PALETTE and the V1 art it was
// measured from — a detail map that tinted anything would redesign the room. A roughness map instead
// multiplies the material's own roughness scalar (three.js reads its .g channel), so the approved value
// stays the CEILING and the map only breaks it up downward: the same colour, lit unevenly, which is the
// whole difference between a plastic slab and a material. Fabric is the one exception that also gets a
// bump map — at roughness 0.98 there is no specular left to modulate, so weave has to arrive as a normal
// perturbation or it does not arrive at all.
//
// COST. Four 256² textures and one 128² alpha, shared by every material in the scene: five GPU uploads
// total, no extra draw calls (materials are still cached and shared, geometry is untouched) and no extra
// geometry. A map is only ever attached to a material that is itself cached, so two objects using the same
// surface still batch exactly as they did before.
import * as THREE from "three";

/** A deterministic PERIODIC value noise. Periodic is the point: the lattice wraps at `period`, so the
 *  canvas tiles seamlessly under RepeatWrapping with no visible edge. */
function noise2(px: number, py: number, seedSalt: number) {
  const hash = (ix: number, iy: number): number => {
    const x = ((ix % px) + px) % px, y = ((iy % py) + py) % py;
    let h = (x * 374761393 + y * 668265263 + seedSalt * 2246822519) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number): number => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    const top = a + (b - a) * fx, bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  };
}

/** Fractal sum of `octaves` periodic noises, each doubling in frequency.
 *
 *  ANISOTROPY IS A PERIOD, NOT A SCALE. Stretching a lattice by multiplying the sample coordinate breaks
 *  tiling the moment the factor is not an integer — the wrap no longer lands on a lattice point and the
 *  canvas grows a seam. Giving X and Y their OWN periods stretches the pattern and keeps every octave
 *  wrapping exactly on the canvas edge, which is what `pu !== pv` below is for. */
function fbm(pu: number, pv: number, octaves: number, salt: number) {
  const layers = Array.from({ length: octaves }, (_, i) => ({ n: noise2(pu * 2 ** i, pv * 2 ** i, salt + i * 17), f: 2 ** i, a: 1 / 2 ** i }));
  const norm = layers.reduce((s, l) => s + l.a, 0);
  return (u: number, v: number): number => layers.reduce((s, l) => s + l.a * l.n(u * pu * l.f, v * pv * l.f), 0) / norm;
}

function canvas(size: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c.getContext("2d");
}

/** Build a greyscale DATA texture (linear, not sRGB) from a per-pixel function returning 0..1. */
function dataTexture(size: number, f: (u: number, v: number) => number, anisotropy = 4, wrap: THREE.Wrapping = THREE.RepeatWrapping): THREE.Texture | null {
  const ctx = canvas(size);
  if (!ctx) return null;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const g = Math.max(0, Math.min(1, f(x / size, y / size)));
      const i = (y * size + x) * 4, b = Math.round(g * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.wrapS = tex.wrapT = wrap;
  tex.colorSpace = THREE.NoColorSpace; // a data map, never colour — sRGB decoding here would be a bug
  tex.anisotropy = anisotropy;
  return tex;
}

const cache = new Map<string, THREE.Texture | null>();
function once(key: string, make: () => THREE.Texture | null): THREE.Texture | null {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) ?? null;
}

/** WOOD PORE. Stretched hard along U so the pores run WITH the grain of render/Materials' wood map rather
 *  than across it; the fine octave is the open pore, the coarse one the sheen band of a sawn board. */
export function woodDetail(kind: "box" | "extrude" = "box"): THREE.Texture | null {
  const base = once("woodPore", () => {
    const coarse = fbm(2, 10, 3, 101);  // low frequency across the board, high along it: sawn-board sheen
    const fine = fbm(3, 24, 2, 211);    // and the open pore itself
    const t = dataTexture(256, (u, v) => 0.74 + 0.18 * coarse(u, v) + 0.08 * fine(u, v));
    if (t) t.repeat.set(3, 3);
    return t;
  });
  if (kind === "box" || !base) return base;
  // An extruded top carries UVs in WORLD UNITS (see build/helpers slab), not per-face 0..1, so the same
  // repeat would put three pore bands in every world unit and alias to mush. One extra clone — it shares
  // the canvas, only the transform differs — is the whole cost of getting both UV conventions right.
  return once("woodPore:extrude", () => { const t = base.clone(); t.repeat.set(0.06, 0.06); t.needsUpdate = true; return t; });
}

/** FABRIC WEAVE. A literal over/under at an 8-texel pitch, softened and dirtied with a fibre octave.
 *  Used as BOTH the roughness and the bump map — see the header for why upholstery needs the bump. */
export function weaveDetail(): THREE.Texture | null {
  return once("weave", () => {
    const fibre = fbm(32, 32, 2, 313);
    const t = dataTexture(256, (u, v) => {
      const P = 8 / 256; // weave pitch in UV
      const wu = Math.sin((u / P) * Math.PI * 2), wv = Math.sin((v / P) * Math.PI * 2);
      // the thread that is ON TOP alternates cell by cell, which is what makes it read as woven
      const over = (Math.floor(u / P) + Math.floor(v / P)) % 2 === 0 ? wu : wv;
      return 0.76 + 0.15 * (0.5 + 0.5 * over) + 0.09 * fibre(u, v);
    });
    if (t) t.repeat.set(6, 6);
    return t;
  });
}

/** STONE / TILE BREAKUP. Deliberately NON-DIRECTIONAL and very low contrast: on a 1440-unit floor any
 *  directional feature lines up across every rect and reads as banding (the same trap render/Materials'
 *  tile canvas documents). Two octaves of blob mottle plus a faint speckle. */
export function stoneDetail(): THREE.Texture | null {
  return once("stone", () => {
    const broad = fbm(3, 3, 2, 419);
    const speck = fbm(24, 24, 2, 523);
    const t = dataTexture(256, (u, v) => 0.82 + 0.13 * broad(u, v) + 0.05 * speck(u, v));
    // Repeat is set at FURNITURE scale, not room scale. At 4 the broad octave gave one cell per ~70 world
    // units, which on a 300-unit plate is a gradient rather than a surface: measured on the live Design
    // Room floor, the pixel standard deviation over a 420 x 240 patch was 1.95 with the map and 1.95
    // without it. At 12 the coarse mottle lands at ~25 units and the speckle at ~3, which is the scale a
    // walker actually reads a floor at, and the mips flatten it back to nothing at whole-office zoom.
    if (t) t.repeat.set(12, 12);
    return t;
  });
}

/** STONE TINT — the same mottle as `stoneDetail`, but as a near-white COLOUR map.
 *
 *  It exists because neither a roughness map nor a bump map is visible on these floors, and that was
 *  measured, not assumed: a 420 x 240 patch of the live Design Room floor came back at a pixel standard
 *  deviation of 1.95 before the maps and 1.95 after them, at two different bump scales and two different
 *  repeats. A large, matt, brightly-lit plate under one soft key has almost no specular for a roughness
 *  map to modulate, and three.js' bump term is a screen-space derivative that vanishes when a texture is
 *  magnified this hard — a floor filling the view is the worst case for both.
 *
 *  What does read is what the office's own tile canvas already does: a low-contrast luminance mottle in
 *  the albedo. This one is centred at white and swings about ±3%, so it multiplies the palette colour
 *  without touching its hue — the floor stays exactly the colour it was measured to be, it just stops
 *  being one flat value across 1400 units. */
export function stoneTint(): THREE.Texture | null {
  return once("stoneTint", () => {
    const broad = fbm(3, 3, 2, 419);   // the same lattice as stoneDetail, so the two maps agree
    const speck = fbm(24, 24, 2, 523);
    const t = dataTexture(256, (u, v) => 0.94 + 0.045 * broad(u, v) + 0.02 * speck(u, v));
    if (t) { t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(10, 10); }
    return t;
  });
}

/** BRUSHED METAL. Anisotropic scratch along U — the difference between "metal" and "chrome ball". */
export function metalDetail(): THREE.Texture | null {
  return once("metal", () => {
    const brush = fbm(1, 24, 3, 617); // scratches run ALONG u: almost no variation across it, plenty down it
    const t = dataTexture(256, (u, v) => 0.70 + 0.26 * brush(u, v), 8);
    if (t) t.repeat.set(2, 2);
    return t;
  });
}

/** SOFT CONTACT FALLOFF, radial — for a disc or a round plate under a chair base or a pot. Alpha only. */
export function contactRoundAlpha(): THREE.Texture | null {
  return once("contactRound", () => dataTexture(128, (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) / 0.5;
    return falloff(r);
  }, 2, THREE.ClampToEdgeWrapping));
}

/** SOFT CONTACT FALLOFF, rounded-rect — for the plate under a desk, sofa or credenza. Alpha only.
 *  The same curve as the radial one, driven by a squircle distance so a long plate keeps a soft edge on
 *  all four sides without the corners going square. */
export function contactRectAlpha(): THREE.Texture | null {
  return once("contactRect", () => dataTexture(128, (u, v) => {
    const ax = Math.abs(u - 0.5) / 0.5, ay = Math.abs(v - 0.5) / 0.5;
    const r = Math.pow(Math.pow(ax, 4) + Math.pow(ay, 4), 1 / 4); // squircle: soft edges, rounded corners
    return falloff(r);
  }, 2, THREE.ClampToEdgeWrapping));
}

/** GLOW FALLOFF — the alpha every additive spill, wash, halo and floor pool is multiplied by.
 *
 *  Without it a "glow" is a rectangle of constant additive colour with a hard border, which is what makes
 *  the Gaming Room's washes read as coloured overlays stuck on the wall rather than light thrown by a
 *  tube. Light does not have an edge. This is a squircle distance (so a long wash keeps soft ends and soft
 *  corners) through a smooth shoulder that starts at the CENTRE, not at 55% like the contact map — a
 *  contact shadow wants a solid core, light wants to be brightest in the middle and gone by the edge. */
export function glowFalloffAlpha(): THREE.Texture | null {
  return once("glowFalloff", () => dataTexture(128, (u, v) => {
    const ax = Math.abs(u - 0.5) / 0.5, ay = Math.abs(v - 0.5) / 0.5;
    const r = Math.min(1, Math.pow(Math.pow(ax, 3) + Math.pow(ay, 3), 1 / 3));
    const t = 1 - r;
    return t * t * (3 - 2 * t); // smoothstep from the middle outward: no plateau, no edge
  }, 2, THREE.ClampToEdgeWrapping));
}

/** TERRAZZO. Warm cream ground with fine aggregate chips, as a near-white COLOUR map so it multiplies the
 *  palette tone instead of replacing it — the Central Hub's plate keeps the measured hubTerrazzo colour and
 *  stops being a flat fill. Chips are drawn, not noised: terrazzo is discrete aggregate in a matrix, and
 *  noise reads as dirt rather than stone. Wrapped at the canvas edge so the field tiles seamlessly. */
export function terrazzoChips(): THREE.Texture | null {
  return once("terrazzo", () => {
    const ctx = canvas(512);
    if (!ctx) return null;
    ctx.fillStyle = "#fbf8f4";
    ctx.fillRect(0, 0, 512, 512);
    let s = 5;
    const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    // three grades of aggregate, all within a few percent of the ground so the floor keeps its own colour
    const grades: [number, number, number, string][] = [
      [260, 1.2, 3.4, "rgba(176,166,152,0.26)"],   // fine warm grey
      [150, 2.6, 6.0, "rgba(206,196,178,0.30)"],   // mid sand
      [70, 4.0, 9.0, "rgba(232,226,214,0.55)"],    // pale chips, lighter than the ground
      [40, 2.0, 5.0, "rgba(150,142,130,0.22)"],    // the occasional dark fleck
    ];
    for (const [n, rMin, rMax, fill] of grades) {
      ctx.fillStyle = fill;
      for (let i = 0; i < n; i++) {
        const cx = r() * 512, cy = r() * 512, rad = rMin + r() * (rMax - rMin);
        // an irregular polygon, and drawn at every wrap offset it can straddle, so no chip is clipped
        for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) {
          ctx.beginPath();
          const sides = 5 + Math.floor(r() * 3);
          for (let k = 0; k <= sides; k++) {
            const a = (k / sides) * Math.PI * 2, rr = rad * (0.7 + 0.5 * ((k * 2654435761) % 97) / 97);
            const px = cx + ox + Math.cos(a) * rr, py = cy + oy + Math.sin(a) * rr;
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.fill();
        }
      }
    }
    // POURED-BAY DIVIDERS. Chips alone are a few centimetres across, so from the office camera they mip
    // away to a flat fill — which is precisely the complaint about the Central Hub's plate. Real cast
    // terrazzo is poured in bays separated by a thin metal divider strip, one bay per canvas tile (~2.7 m
    // at the Hub's scale), and that IS visible from across the room. It is what turns the plate from a
    // filled shape into a laid floor.
    ctx.fillStyle = "rgba(196,186,170,0.55)";
    ctx.fillRect(0, 0, 512, 2);
    ctx.fillRect(0, 0, 2, 512);
    ctx.fillStyle = "rgba(255,253,248,0.5)";
    ctx.fillRect(0, 2, 512, 1);
    ctx.fillRect(2, 0, 1, 512);
    const tex = new THREE.CanvasTexture(ctx.canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  });
}

/** The one shared falloff curve: solid to ~55% of the radius, then a smooth shoulder to nothing.
 *  That flat core is what keeps a soft shadow from looking like a blurry blob instead of a contact. */
function falloff(r: number): number {
  if (r >= 1) return 0;
  const t = Math.max(0, Math.min(1, (1 - r) / 0.45));
  return t * t * (3 - 2 * t);
}

/** Dispose every built map. Only for a full teardown (tests); the scene shares these for its lifetime. */
export function disposeDetailMaps(): void {
  for (const t of cache.values()) t?.dispose();
  cache.clear();
}
