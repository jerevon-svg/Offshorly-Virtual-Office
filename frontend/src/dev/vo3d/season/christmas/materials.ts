// vo3d season/christmas — THE WHITE CHRISTMAS MATERIAL SET AND ITS TEXTURES.
//
// IT OWNS EVERY MATERIAL IT USES AND NEVER TOUCHES render/Materials' SHARED CACHE — the same rule
// season/halloween/materials.ts states, for the same reason: `mat("plaster")` hands the SAME object
// to every wall in the building, so a season that wrote into it would repaint eleven rooms with no
// way back. Everything here is constructed on `create()` and destroyed on `dispose()`, so taking the
// decorations away is byte-for-byte the office that was there before.
//
// ══ THE PALETTE, AND WHY IT IS NOT A CHRISTMAS PALETTE ══
//
// This is a WHITE CHRISTMAS, not a red-and-green one. Measured off the reference, which is an almost
// monochrome frame: snow white everywhere, icy blue in the shadows and the lit glass, frosted silver
// on every ornament, and exactly one warm note — a champagne candle glow — used sparingly enough that
// it reads as warmth rather than as gold.
//
// THE THREE RULES THAT KEEP IT PREMIUM RATHER THAN PLASTIC:
//   · NOTHING IS PURE WHITE (#ffffff). A snow cap is #f6fbff and its shadow side is #d8e6f4; pure
//     white has no form under any light and reads as a blown highlight, not as snow.
//   · THE ICE IS A LIGHT, NOT A PAINT. Icy blue appears as emissive and as additive glow — never as a
//     large painted surface, which would turn the office into a swimming pool.
//   · SILVER IS METAL, SNOW IS NOT. The ornaments carry `metalness` and a low roughness so they pick
//     up the environment and glint; the snow is rough and matte. That contrast is the entire reason
//     a white-on-white composition reads as dimensional instead of flat.
//
// COST. Three 256² canvas textures (snowflake, sprig band, frost sheen) and one 128² radial glow,
// each built once and shared by every instance; roughly two dozen materials total. No downloads, no
// glTF, nothing per-object.
import * as THREE from "three";

export const CHRISTMAS_PALETTE = {
  /** the lit face of snow — never #ffffff, which has no form */
  snow: 0xf6fbff,
  /** the shadow side of the same drift: where the icy blue actually lives */
  snowShadow: 0xd8e6f4,
  /** warm-neutral white for gift boxes and pearl ornaments, so the whites are not all one white */
  pearl: 0xf2efe8,
  /** the one warm note in the palette: candle wax, lantern light, fairy-light bulbs */
  champagne: 0xf7ecd6,
  champagneLight: 0xffe6b4,
  /** frosted silver: garland wire, ornament caps, lantern frames, ribbon */
  silver: 0xcfd9e6,
  silverDeep: 0x96a6ba,
  /** ICE — the blue, and it is mostly a light rather than a paint */
  ice: 0xbfe4f8,
  iceDeep: 0x74b9e2,
  iceCore: 0xdcf3ff,
  /** frosted evergreen: a fir seen under snow is a desaturated blue-green, never a forest green */
  fir: 0x7f9a9c,
  firDeep: 0x5f7a80,
  /** bare winter branches, frosted rather than brown */
  branch: 0x8d8a86,
  /** the deep note the whole palette is read against — used only where a dark edge is needed */
  midnight: 0x2b3a4e,
  crystal: 0xe8f6ff,
} as const;

function canvas(size: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c.getContext("2d");
}

/** A SIX-FOLD SNOWFLAKE, drawn once as an alpha map. One quad carries a whole flake, so the hanging
 *  crystal snowflakes cost one instanced draw call for the entire building.
 *
 *  Six arms with two tiers of side-branches and a hex centre: the minimum that still reads as a
 *  snowflake rather than as a star, at the four-or-five pixels the office camera gives it. */
function snowflakeTexture(): THREE.Texture | null {
  const ctx = canvas(256);
  if (!ctx) return null;
  const S = 256, C = S / 2;
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = "#ffffff";
  ctx.lineCap = "round";
  ctx.translate(C, C);
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.rotate((i / 6) * Math.PI * 2);
    // the arm
    ctx.lineWidth = 7;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -C * 0.92);
    ctx.stroke();
    // two tiers of side-branches, shorter as they go out — the cue that makes it a flake
    ctx.lineWidth = 5;
    for (const [at, len] of [[0.42, 0.26], [0.66, 0.18], [0.85, 0.11]] as const) {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, -C * at);
        ctx.lineTo(s * C * len, -C * (at + len * 0.75));
        ctx.stroke();
      }
    }
    // the arm's own tip chevron
    ctx.lineWidth = 4;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, -C * 0.92);
      ctx.lineTo(s * C * 0.09, -C * 0.79);
      ctx.stroke();
    }
    ctx.restore();
  }
  // a solid hex centre, so the flake has a body rather than only spokes
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * 15, y = Math.sin(a) * 15;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** A TILEABLE SPRIG BAND for the garland swags: fir needles hanging off a central rope, with snow
 *  flecks caught in them and gaps so the band reads as foliage rather than as a ribbon.
 *
 *  THE LESSON THIS INHERITS FROM HALLOWEEN'S WEB SHEET: a swag spans a whole room, so the texture
 *  must TILE along the run (the builder sets `repeats`) or a 200-unit garland carries one stretched
 *  copy and reads as a smear. And it must be mostly transparent by area, or at the office camera's
 *  steep look-down it becomes a solid beam laid across the room. */
function sprigTexture(): THREE.Texture | null {
  const ctx = canvas(256);
  if (!ctx) return null;
  const S = 256;
  ctx.clearRect(0, 0, S, S);
  ctx.lineCap = "round";
  // the rope: a dense band across the top third, which is where a garland's mass actually is
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 9;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(0, 30);
  ctx.lineTo(S, 30);
  ctx.stroke();
  // needles: short strokes fanning down and sideways off the rope, irregular in length and angle
  ctx.lineWidth = 3.2;
  for (let x = 2; x < S; x += 5) {
    const n = 2 + ((x * 7) % 3);
    for (let i = 0; i < n; i++) {
      const len = 34 + ((x * 13 + i * 29) % 78);
      const lean = (((x * 17 + i * 11) % 100) / 100 - 0.5) * 46;
      ctx.globalAlpha = 0.34 + ((x * 3 + i * 7) % 40) / 100;
      ctx.beginPath();
      ctx.moveTo(x, 30);
      ctx.quadraticCurveTo(x + lean * 0.4, 30 + len * 0.6, x + lean, 30 + len);
      ctx.stroke();
    }
  }
  // snow caught in the needles: bright flecks along the top edge, which is what makes it SNOWY fir
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  for (let x = 3; x < S; x += 9) {
    const r = 2 + ((x * 5) % 4);
    ctx.beginPath();
    ctx.arc(x + ((x * 3) % 5), 24 + ((x * 7) % 16), r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** A SOFT RADIAL FALLOFF for the additive light pools and haloes. The office has NO real-time point
 *  lights — every glow in the building is an emissive surface plus an additive plane (build/led.ts) —
 *  and a season full of fairy lights is exactly where that convention pays for itself. */
function glowTexture(): THREE.Texture | null {
  const ctx = canvas(128);
  if (!ctx) return null;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.42)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** A SPARKLE FIELD — scattered pinpoints of different sizes on a transparent ground, used as the
 *  alpha map for the faint "frost dust" quads. Cheaper and more controllable than a particle system:
 *  the brief asks for subtle sparkling highlights, and a dozen static quads deliver it for a dozen
 *  triangles instead of for a per-frame simulation. */
function sparkleTexture(): THREE.Texture | null {
  const ctx = canvas(256);
  if (!ctx) return null;
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = "#ffffff";
  let s = 7919;
  const r = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 90; i++) {
    const x = r() * 256, y = r() * 256, rad = 0.7 + r() * 2.6;
    ctx.globalAlpha = 0.35 + r() * 0.65;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    // a few of them get a cross-flare, which is what a highlight on ice actually looks like
    if (r() > 0.78) {
      ctx.globalAlpha *= 0.55;
      ctx.fillRect(x - rad * 4, y - 0.5, rad * 8, 1);
      ctx.fillRect(x - 0.5, y - rad * 4, 1, rad * 8);
    }
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export interface ChristmasMaterials {
  /** lit snow: matte, bright, faintly self-lit so a drift still reads at night */
  snow: THREE.MeshStandardMaterial;
  /** the shadow side of snow, and every under-surface */
  snowShadow: THREE.MeshStandardMaterial;
  pearl: THREE.MeshStandardMaterial;
  /** frosted evergreen — the body of every tree, wreath and garland sprig */
  fir: THREE.MeshStandardMaterial;
  firDeep: THREE.MeshStandardMaterial;
  branch: THREE.MeshStandardMaterial;
  /** POLISHED SILVER. Metal, low roughness: this is what makes a white room dimensional. */
  silver: THREE.MeshStandardMaterial;
  silverDeep: THREE.MeshStandardMaterial;
  /** a pearl bauble — metal too, but warm and softer, so the ornaments are not all one finish */
  ornamentPearl: THREE.MeshStandardMaterial;
  /** an icy-blue bauble: the only saturated colour on any ornament */
  ornamentIce: THREE.MeshStandardMaterial;
  /** ICE AND CRYSTAL: translucent, self-lit, never a large painted surface */
  ice: THREE.MeshStandardMaterial;
  crystal: THREE.MeshStandardMaterial;
  /** a lit bulb, a lantern core, a tree-top star — emissive geometry, never a light */
  lightCore: THREE.MeshStandardMaterial;
  /** hanging snowflake quads — alpha-mapped, double-sided, bright enough to read at night */
  flake: THREE.MeshStandardMaterial;
  /** garland swag sheets: the tileable sprig band */
  sprig: THREE.MeshStandardMaterial;
  /** additive, depth-write off: the COOL pools and haloes (ice, crystal, moonlit snow) */
  glow: THREE.MeshBasicMaterial;
  /** additive, depth-write off: the WARM pools and haloes (lanterns, fairy lights, candles) */
  glowWarm: THREE.MeshBasicMaterial;
  /** snow lying on the floor and frost sheen: a wide, faint, flat wash */
  drift: THREE.MeshBasicMaterial;
  /** scattered pinpoint highlights, as one faint quad rather than as particles */
  sparkle: THREE.MeshBasicMaterial;
  /** THE FROST SHEEN over a whole floor plate — see `frostCarpet` in christmas/decor.ts */
  sheen: THREE.MeshBasicMaterial;
  dispose(): void;
}

export function createChristmasMaterials(): ChristmasMaterials {
  const P = CHRISTMAS_PALETTE;
  const flakeTex = snowflakeTexture();
  const sprigTex = sprigTexture();
  const glowTex = glowTexture();
  const sparkleTex = sparkleTexture();

  const std = (color: number, roughness: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

  const materials = {
    // A FAINT EMISSIVE ON THE SNOW, and it is the single most important number in this file. Night
    // pulls the lit budget to a fraction of day's; snow with no self-illumination goes to a flat
    // blue-grey and the "white Christmas" disappears exactly when the lights come on. A tenth of a
    // unit is invisible at midday and is what keeps a drift reading as SNOW after dark.
    snow: std(P.snow, 0.92, { emissive: new THREE.Color(P.snow), emissiveIntensity: 0.1 }),
    snowShadow: std(P.snowShadow, 0.95, { emissive: new THREE.Color(P.snowShadow), emissiveIntensity: 0.06 }),
    pearl: std(P.pearl, 0.55, { metalness: 0.1 }),
    fir: std(P.fir, 0.86),
    firDeep: std(P.firDeep, 0.9),
    branch: std(P.branch, 0.9),
    // METAL. Roughness under 0.2 and metalness near 1 is what makes an ornament GLINT against a matte
    // white room — the whole reason a monochrome composition reads as dimensional rather than as fog.
    silver: std(P.silver, 0.16, { metalness: 0.92 }),
    silverDeep: std(P.silverDeep, 0.3, { metalness: 0.8 }),
    ornamentPearl: std(P.pearl, 0.24, { metalness: 0.55 }),
    ornamentIce: std(P.ice, 0.14, { metalness: 0.7, emissive: new THREE.Color(P.iceDeep), emissiveIntensity: 0.22 }),
    ice: new THREE.MeshStandardMaterial({
      color: P.ice,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.62,
      // An icicle seen from behind is still an icicle; and it must never punch a hole in what is
      // behind it in the depth buffer.
      side: THREE.DoubleSide,
      depthWrite: false,
      emissive: new THREE.Color(P.iceCore),
      emissiveIntensity: 0.4,
    }),
    crystal: new THREE.MeshStandardMaterial({
      color: P.crystal,
      roughness: 0.05,
      metalness: 0.25,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
      emissive: new THREE.Color(P.iceCore),
      emissiveIntensity: 0.55,
    }),
    // EMISSIVE, NOT BRIGHT-COLOURED — the same trick Halloween's ember uses. The brightness lives in
    // `emissive`, which survives night's very low exposure without the body becoming a flat sticker.
    lightCore: std(P.champagneLight, 0.35, { emissive: new THREE.Color(P.champagneLight), emissiveIntensity: 4.4 }),
    flake: new THREE.MeshStandardMaterial({
      color: P.snow,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false,
      ...(flakeTex ? { alphaMap: flakeTex } : {}),
      emissive: new THREE.Color(P.iceCore),
      emissiveIntensity: 0.5,
    }),
    sprig: new THREE.MeshStandardMaterial({
      color: P.fir,
      roughness: 0.95,
      metalness: 0,
      transparent: true,
      // A GARLAND MUST VEIL, NEVER HIDE. This number is the difference between "swagged ceiling" and
      // "a bar across the room" — the exact correction Halloween's web sheet had to make, and the
      // second capture pulled it down again: at 0.92 a swag seen from above was a solid band.
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
      ...(sprigTex ? { alphaMap: sprigTex } : {}),
      emissive: new THREE.Color(P.snowShadow),
      // LOW. A self-lit garland reads as a glowing tube; the snow flecks in its texture are what is
      // supposed to catch the light, not the needles.
      emissiveIntensity: 0.14,
    }),
    glow: new THREE.MeshBasicMaterial({
      color: P.iceCore,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...(glowTex ? { map: glowTex } : {}),
    }),
    glowWarm: new THREE.MeshBasicMaterial({
      color: P.champagneLight,
      transparent: true,
      // RESTRAINED, and deliberately weaker than Halloween's. There, the warm pools WERE the lighting;
      // here the room is already bright and an additive wash at the same strength blows it out.
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...(glowTex ? { map: glowTex } : {}),
    }),
    drift: new THREE.MeshBasicMaterial({
      color: P.snow,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...(glowTex ? { map: glowTex } : {}),
    }),
    // A WIDE, FLAT, COOL WASH — the one material that is allowed to cover a whole floor.
    //
    // NOT ADDITIVE, unlike every other overlay here, and the difference matters: an additive wash over
    // a cream floor BRIGHTENS it and the office goes milky, while a low-opacity cool white over it
    // SHIFTS ITS HUE — warm cream becomes pearl — which is what turns the building's biggest surface
    // from "an office floor" into "a winter interior" without hiding a single floorboard.
    sheen: new THREE.MeshBasicMaterial({
      color: 0xdcecfa,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    sparkle: new THREE.MeshBasicMaterial({
      color: P.iceCore,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...(sparkleTex ? { map: sparkleTex } : {}),
    }),
  };

  return {
    ...materials,
    dispose(): void {
      for (const m of Object.values(materials)) (m as THREE.Material).dispose();
      flakeTex?.dispose();
      sprigTex?.dispose();
      glowTex?.dispose();
      sparkleTex?.dispose();
    },
  };
}
