// vo3d render — shared material cache + the office palette (warm cream / wood / olive).
// Promoted from designRoom3d/build.ts (materials block) and layout.ts (PALETTE). ONE cache for the scene.
import * as THREE from "three";

export const PALETTE = {
  floor: 0xf0e8e2,
  exterior: 0xd9cbbf, // ≈ the V1 hall floor (floor.png measures 219,202,187)
  sidewalk: 0x9a9187,
  plinth: 0xbfb6ac,
  wall: 0xfaf8f5,
  wallFace: 0xf1ece7,
  wood: 0xcfa876,
  woodLight: 0xdcb98a,
  green: 0x7b8a45,
  greenDark: 0x66733a,
  greenSeat: 0x8a9a55,
  white: 0xf7f7f4,
  charcoal: 0x2b2b2e,
  potGray: 0x9a9a96,
  potDark: 0x5e5a56,
  foliage: 0x4f8a3a,
  foliageLight: 0x6fa74a,
  rug: 0xc6a36e,
  cushionGray: 0xb9b3ab,
  cushionCream: 0xe9dfcf,
  metal: 0xc9cbcc,
  glass: 0xcfe3f2,
  boardBg: 0xf4efe6,
  boardPin: 0x6f8a3d,
  screen: 0x1f2430,
  tile: 0xefe8de, // reception/front-bar polished floor tile (measured off reception-room.png)
  grout: 0xc4b7a6,
  bronze: 0xa98a63, // the arc counter's champagne/bronze visitor-facing fascia (measured 135,103,71 lit)
  bronzeDark: 0x6f5738,
  gateLed: 0x2f9fe0,
  cyan: 0x6fd8ff, // powered-electronics status light (gates, sensors)
  readyGreen: 0x62e393,
  coveWarm: 0xffc27a, // the counter's architectural LED cove
  uiNavy: 0x14213a, // kiosk / monitor UI ground
  loungeOlive: 0x5f6a38, // reception lounge upholstery — measured (74,65,33)…(90,95,55), darker than PALETTE.green
  loungeOliveSeat: 0x6e7a42,
  tableWood: 0xd6c2a2, // pale oak of the lounge coffee tables (the Design Room's wood reads too orange here)
  walnut: 0x6b4a31, //     dark stained oak of the front-bar credenza runs + slat features (measured 107,74,49)
  walnutDark: 0x4a3222, // the reveals/grooves between their modules, and the slat panels' backing board
  plaster: 0xf3ece2, //    the front-bar cove walls: a warmer cream than PALETTE.wall (measured 243,236,226)

  // ---- GAMING ROOM (Phase 5B) ------------------------------------------------------------------
  // Routed through rooms/gaming.ts THEME, never referenced directly by the builders, so a future
  // colour/material editor only has to rewrite the THEME table.
  gamingViolet: 0x6d43d6, //    accent: chair bolsters, west beanbag, rug inlay (measured 109,67,214)
  gamingBlue: 0x2f6fd0, //      accentAlt: east beanbag, nook pouf, station-B screens
  gamingLed: 0x8257ff, //       the LED tape itself — brighter and bluer than the accent it lights
  gamingDark: 0x1b1b22, //      desk tops, console carcasses, chair frames (measured 27,27,34)
  gamingRug: 0x141a2e, //       the gamepad rug's navy pile (measured 20,26,46)
  gamingSofa: 0x24242e, //      sofa body — near-black charcoal with a blue cast
  gamingSofaSeat: 0x2e2e3a, //  its cushions, one step lighter so the seat reads separately
  neonPink: 0xff5ac8,
  neonCyan: 0x4fe8ff,
  neonGreen: 0x5cf08a,
  gamingPlaster: 0xd2ced3, //   this room's walls: a cooler, darker cream than PALETTE.plaster, so coloured
  //                            spill has something to tint instead of clipping to white
  gamingMood: 0xa5a2ab, //      multiply tint for this room's floor only (see build/gaming moodFloor)

  // ---- CENTRAL HUB (Phase 6B) ------------------------------------------------------------------
  // Routed through rooms/central-hub.ts THEME, never named directly by a builder. The hub's brief is the
  // OPPOSITE of the Gaming Room's: warm, pale, social, no saturated light. Every value measured off
  // src/assets/office/rooms/central-hub.png.
  hubSage: 0xa8b48c, //     the arc benches' sage-green cushions (measured 168,180,140)
  hubCamel: 0xb5854e, //    the middle north armchair's tan leather (measured 181,133,78)
  hubStone: 0xa9a49c, //    the bench/planter shells, shelf carcass and counter plinth — warm grey concrete
  hubStoneDark: 0x7d7872, // their recessed toe-kicks and shadow reveals
  hubMonument: 0xd8d1c6, // the boxing-championship monument: one monochrome warm cast stone
  hubTerrazzo: 0xf2ece3, // the hub's own floor plate: a shade brighter than the hall tile so the plaza
  //                         reads as a defined place without a single wall

  // ---- EXECUTIVE ROOM (Phase 7) ----------------------------------------------------------------
  // Routed through rooms/executive.ts THEME, never named directly by a builder. The brief is PREMIUM:
  // dark stained walnut against warm plaster, cream upholstery, ONE colour accent and brass on the
  // awards. Every value measured off the Executive Room V1 reference.
  execWalnut: 0x4a3526, //      desks, award cabinetry, the media console, the north feature wall
  execWalnutDark: 0x2e2018, //  their reveals, grooves, toe kicks and backing boards
  execCream: 0xd4c6b0, //       sofa FRAMES. Deliberately a shade under the cushions: seen from the
  //                            game camera a cream sofa on a cream rug is one flat slab unless the frame
  //                            reads darker than the cushions sitting in it.
  execCreamSeat: 0xefe7dc, //   the cushions themselves
  execOlive: 0x5d6a3f, //       the two lounge armchairs — the room's single colour accent
  execLeather: 0x262428, //     executive / visitor / workstation chairs: near-black leather
  execBrass: 0xb08d57, //       award metal, cabinet hardware, the display-wall trim
  execRug: 0xd8cdba, //         every rug in the room: a warm sand a shade under the floor tile
  execRugBorder: 0xc7b9a2, //   its one inset border line: a half-tone darker, and that is the whole graphic
  execLeatherSeat: 0x332f2c, // the lighter hide of a seat/back cushion against the frame
  execOliveSeat: 0x6b7849, //   the lounge chairs' cushions, one step up from their shells

  // ---- CMS ROOM (Phase 8) -------------------------------------------------------------------
  // The content team's room is the office's one BLUE space. Every value below is measured off the V1
  // art: rooms/cms-room.png for the architecture and the lounge, and the four separated
  // furniture/cms-team/*.png for the desks and chairs.
  cmsBlue: 0x4f8cc0, //       the signature mid blue: the content credenza band, the library carcass
  cmsBlueDeep: 0x2a5c83, //   drawer pedestals, the lead desks' base, every reveal in the blue joinery
  cmsNavy: 0x1d3f66, //       the lounge pouf: the deepest blue in the room (measured 34,80,133…0,33,62)
  cmsSofa: 0x4c8dbf, //       the three-seat sofa's body (measured 79,142,191)
  cmsSofaSeat: 0x5e9aca, //   its cushions, one step up so the seat reads separately from the frame
  cmsSeat: 0x11466f, //       task-chair upholstery (measured 14,66,111)
  cmsSeatLead: 0x3a7fb3, //   the two lead chairs' lighter blue (measured 55,125,177)
  cmsOak: 0xd8b58c, //        light oak: every desk top, the coffee table, the counter, the east credenza
  cmsOakDark: 0xa87a4c, //    their edges, legs, plinths and reveals
  cmsRug: 0x53749c, //        the lounge rug's dusty blue pile (measured 83,116,156)
  cmsRugBorder: 0x44607f, //  its one inset border line, a half-tone darker — that is the whole graphic
  cmsScreen: 0x465e74, //     the member desks' slate privacy screens (measured 70,94,116)
  cmsPlaster: 0xf2f0f2, //    this room's walls: a COOLER white than PALETTE.plaster (measured 244,242,243)
  cmsFloorTint: 0xe9e9ec, //  multiply tint for THIS room's tile only — the reference floor is cool grey
  cmsBoard: 0xf3f2f1, //      the whiteboard / sticky-wall face
  cmsFrame: 0xc6c6c9, //      chair frames, arms and casters: the light grey the art gives them

  // ---- AI ROOM (Phase 9) -----------------------------------------------------------------------
  // Routed through rooms/ai.ts THEME, never named directly by a builder. The brief is COOL TECH: near-
  // black carbon joinery and ONE electric blue running through every piece of the room, over the palest,
  // coolest floor in the office, with white-and-silver seating. Every value measured off
  // src/assets/office/rooms/ai-room.png and the five separated furniture/ai-team/*.png.
  aiCharcoal: 0x57575c, //    bench and lead desk tops (measured 87,87,92)
  aiCarbon: 0x22242b, //      the north tech band, rack carcasses, screen bezels (measured 34,36,43)
  aiCarbonDeep: 0x111318, //  every reveal, plinth and recess in the carbon joinery
  aiLed: 0x2376e5, //         THE ROOM'S SIGNATURE: every blue LED line in it (measured 35,118,229)
  aiLedDeep: 0x0e4cba, //     the LED's deeper core, where a strip is read edge-on (measured 14,76,186)
  aiSeat: 0xeae5e2, //        the eighteen member task chairs: warm white (measured 234,229,226)
  aiSeatLead: 0xa9a6a6, //    the lead chair's light grey hide (measured 169,166,166)
  aiSeatVisitor: 0xcac7c9, // the two visitor tub chairs (measured 202,199,201)
  aiFrame: 0xccc8ca, //       brushed silver arms, five-star bases, counter shoe (measured 204,200,202)
  aiCounter: 0xf4f5f5, //     the east wall's white lacquer counter run (measured 244,245,245)
  aiPlaster: 0xf6f7fa, //     this room's walls: the coolest white in the office
  aiFloorTint: 0xe6ebfe, //   multiply tint for THIS room's tile only — the reference floor is 216,215,221
  aiScreenUi: 0x0a1526, //    the dark UI ground every display in the room is drawn on
  aiRobot: 0xf2f4f7, //       the service robot's white shell

  // ---- DEV ROOM (Phase 10) ---------------------------------------------------------------------
  // Routed through rooms/dev.ts THEME, never named directly by a builder. The brief is NIGHT WORKSHOP:
  // espresso walnut joinery and BLACK LEATHER seating under a cold blue neon line, against the brightest
  // white walls in the office. It shares no key with the AI Room — that room is carbon + silver + LED,
  // this one is dark WOOD + leather + NEON, which is what keeps two blue rooms reading as two rooms.
  // Every value measured off src/assets/office/rooms/dev-room.png and the eight separated
  // furniture/dev-team/*.png.
  devWalnut: 0x40301f, //     every desk top, the wall units, the pantry counter (measured 64,48,31)
  devWalnutDark: 0x241a10, // their plinths, toe kicks and reveals
  devInk: 0x15161a, //        rack carcasses, screen bezels, the bay desks' base rail (measured 21,22,26)
  devInkDeep: 0x08090c, //    every recess in the black joinery
  devNeon: 0x2f8cff, //       THE ROOM'S SIGNATURE: the cove line, the sign tubes, the desk underglow
  devNeonDeep: 0x0b45b8, //   its deeper core, where a tube is read edge-on
  devLeather: 0x1b1c21, //    the ten black leather chairs (measured 27,28,33)
  devLeatherSeat: 0x2b2d34, // their lighter stitched panels
  devSofa: 0x191a1f, //       the two-seat lounge sofa's black body
  devSofaSeat: 0x44474e, //   its grey bolster cushions (measured 68,71,78)
  devFrame: 0x63666d, //      chair arms, five-star bases, counter shoe
  devPlaster: 0xf7f7f8, //    this room's walls: the brightest white in the office
  devFloorTint: 0xf1f1f3, //  multiply tint for THIS room's tile only — the reference floor is near-white
  devScreenUi: 0x0b1020, //   the dark UI ground every display in the room is drawn on
  devMat: 0x8a8c90, //        the lounge rug's grey pile (measured 138,140,144)
  devMatBorder: 0x74767b, //  its one inset border line
  devTerminal: 0x3ddc84, //   the pantry sign's green terminal type — the room's ONE non-blue light

  // ---- QA ROOM (Phase 11) ----------------------------------------------------------------------
  // Routed through rooms/qa.ts THEME, never named directly by a builder. The brief is CALM STUDIO: a soft
  // MINT floor, cream linen seating, light oak and white worktops, with one deep TEAL running through the
  // accents. QA is the only flat-reference room on the floor and the only GREEN one — nothing here is
  // borrowed from the Design, Dev or CMS palettes. Every value measured off
  // src/assets/office/rooms/qa-room.png.
  qaTeal: 0x2f6f67, //        the signature accent: pouf, storage boxes, screens, book covers (measured 47,111,103)
  qaTealDeep: 0x1e4b45, //    its reveals and the credenza's inset shadows
  qaOak: 0xd5b587, //         light oak: the credenza carcass, the lounge shelf, the coffee table
  qaOakDark: 0xa8814e, //     their edges, legs and plinths
  qaWhite: 0xfbfbf9, //       every desk top and the credenza worktop (measured 251,251,249)
  qaLinen: 0xe7ded0, //       the sofa and all seven task chairs: warm cream linen (measured 231,222,208)
  qaLinenDeep: 0xd2c7b4, //   their piping, seams and the sofa's deck
  qaFrame: 0xc9cac6, //       chair frames, five-star bases, desk legs
  qaPlaster: 0xf8f9f7, //     this room's walls
  qaFloorTint: 0xd8e2d9, //   multiply tint for THIS room's tile only — the reference floor is 216,222,217
  qaRug: 0xded9d0, //         the lounge rug's oatmeal pile
  qaRugBorder: 0xc9c3b8, //   its one inset border line
  qaBoard: 0xf6f7f5, //       the north whiteboard's face
  qaScreenUi: 0x14201e, //    the dark UI ground the room's few displays are drawn on

  // ---- THE CHAMPIONSHIP CAVE (the immersive theatre beneath the hub monument) ----------------
  // A DARK room, which nothing else in this office is. Every tone here is chosen to disappear so the
  // 270° video is the only thing the eye has to look at — the architecture is a frame, not a subject.
  caveVoid: 0x07080c, //      the ceiling, the shell behind the screen, every surface meant to vanish
  caveFloor: 0x141620, //     the floor plate: a hair above the void so a walker can read the ground
  caveGraphite: 0x1b1e28, //  the screen plinth, the truss runs, the vestibule reveal — the one "material"
  caveSteel: 0x3a4050, //     edge trims and the truss webs, where a surface has to catch a highlight
  caveCove: 0x4a7fd6, //      THE ROOM'S ONE ARCHITECTURAL LIGHT: the cool perimeter/threshold line
  caveCushion: 0x23242c, //   the low floor cushions along the back wall
  caveBronze: 0xb8925c, //    the monument's own bronze, carried into the portal threshold
};

// ---- shared materials -------------------------------------------------------------------
export type MatKey = keyof typeof PALETTE;
const materials = new Map<string, THREE.Material>();

export function canvas2d(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c.getContext("2d");
}

// Soft procedural wood grain: warm base + low-contrast streaks. Used at two
// UV scales (rounded boxes have per-face 0..1 UVs; extruded tops have UVs in
// world units).
let woodTex: THREE.CanvasTexture | null | undefined;
function woodTexture(): THREE.CanvasTexture | null {
  if (woodTex !== undefined) return woodTex;
  const ctx = canvas2d(256, 256);
  if (!ctx) return (woodTex = null);
  ctx.fillStyle = "#dab887"; // ≈ production wood (205,165,115) after lighting
  ctx.fillRect(0, 0, 256, 256);
  let s = 3;
  const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let i = 0; i < 70; i++) {
    const y = r() * 256, wdt = 1 + r() * 3, a = 0.05 + r() * 0.08;
    ctx.strokeStyle = `rgba(130,90,50,${a})`;
    ctx.lineWidth = wdt;
    ctx.beginPath();
    ctx.moveTo(-10, y);
    ctx.bezierCurveTo(80, y + (r() - 0.5) * 14, 170, y + (r() - 0.5) * 14, 270, y + (r() - 0.5) * 8);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (woodTex = tex);
}

export function mat(key: MatKey, roughness = 0.9, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const id = `${key}:${roughness}:${JSON.stringify(extra)}`;
  let m = materials.get(id) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: PALETTE[key], roughness, metalness: 0, ...extra });
    materials.set(id, m);
  }
  return m;
}
export function wood(kind: "box" | "extrude" = "box", light = false): THREE.MeshStandardMaterial {
  const id = `wood:${kind}:${light}`;
  let m = materials.get(id) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    const tex = woodTexture();
    let map: THREE.Texture | null = null;
    if (tex) {
      map = tex.clone();
      map.needsUpdate = true;
      if (kind === "extrude") map.repeat.set(0.02, 0.02);
    }
    // with a grain map the map carries the wood colour; tint only lightly so it does not go orange
    const color = map ? (light ? 0xfff8ee : 0xffffff) : light ? PALETTE.woodLight : PALETTE.wood;
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, map });
    materials.set(id, m);
  }
  return m;
}
export const fabric = (key: MatKey = "green") => mat(key, 0.98);
export const plastic = (key: MatKey = "white") => mat(key, 0.45);
export const metal = () => mat("metal", 0.35, { metalness: 0.7 });
export function screenMat(): THREE.MeshStandardMaterial {
  return mat("screen", 0.25, { emissive: 0x3a5a86, emissiveIntensity: 0.55 });
}
// ---- floor tile ------------------------------------------------------------------------------
/** grout pitch of the front-bar floor tile, in world units (measured: 40 × 40 on reception-room.png) */
export const TILE = 40;
/** world coordinate a grout line falls on: x ≡ 0, z ≡ 32 (mod TILE). Anchored to the WORLD, never to a
 *  room rect, so the same grid continues unbroken into Meeting and Project when they are reconstructed. */
export const TILE_PHASE = { x: 0, z: 32 };

let tileTex: THREE.CanvasTexture | null | undefined;
function tileTexture(): THREE.CanvasTexture | null {
  if (tileTex !== undefined) return tileTex;
  const N = 256;
  const ctx = canvas2d(N, N);
  if (!ctx) return (tileTex = null);
  ctx.fillStyle = "#efe8de";
  ctx.fillRect(0, 0, N, N);
  let s = 11;
  const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  // NON-DIRECTIONAL stone mottle: soft radial blobs at random angles. (Horizontal streaks tiled into
  // visible banding across the floor — every tile shares one texture, so any directional feature lines up.)
  for (let i = 0; i < 460; i++) {
    const cx = r() * N, cy = r() * N, rad = 3 + r() * 11;
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    const dark = r() < 0.5;
    gr.addColorStop(0, dark ? "rgba(198,185,168,0.045)" : "rgba(255,253,248,0.055)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  // faint diagonal vein flecks, alternating direction so nothing reads as a stripe
  for (let i = 0; i < 26; i++) {
    const x = r() * N, y = r() * N, len = 10 + r() * 30, a = (r() < 0.5 ? 1 : -1) * (0.5 + r() * 0.7);
    ctx.strokeStyle = `rgba(190,176,157,${0.025 + r() * 0.03})`;
    ctx.lineWidth = 0.8 + r() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  // grout: a darker recessed joint with a light chamfer on the tile side, on two edges only
  ctx.fillStyle = "#c4b7a6";
  ctx.fillRect(0, 0, N, 3);
  ctx.fillRect(0, 0, 3, N);
  ctx.fillStyle = "rgba(255,253,249,0.55)";
  ctx.fillRect(0, 3, N, 1.5);
  ctx.fillRect(3, 0, 1.5, N);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return (tileTex = tex);
}

/** Tile material for ONE floor rect. UVs are world-phased by the caller (build/tile.ts), so each rect needs
 *  its own map instance — the base texture is shared, only the repeat/offset differ. */
export function tileMat(): THREE.MeshStandardMaterial {
  const tex = tileTexture();
  const map = tex ? tex.clone() : null;
  if (map) map.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    color: map ? 0xffffff : PALETTE.tile,
    map,
    roughness: 0.42,
    metalness: 0,
    // NO polygonOffset. It used to be here because the tile's top face is at exactly y = 0, coplanar with
    // the shared ground slab — but polygonOffsetFactor scales with the polygon's SCREEN-SPACE depth slope,
    // which grows as the view widens. At whole-floor zoom the floor was being pulled far enough toward the
    // camera to win the depth test against everything lying on it: the Gaming rug and its print, floor
    // inlays, plate outlines. Measured: at wide zoom the rug region went from saturation 0.45 to 0.24 with
    // the offset on, and was identical with it off at close zoom. The slab is now simply dropped 0.05
    // below the tile (build/floorplan.ts), which is a constant separation that no camera can invert.
  });
}

/** Emissive surface for powered electronics / architectural LEDs. Cached by its parameters. */
export function emissiveMat(key: MatKey, intensity: number, roughness = 0.35, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const id = `emissive:${key}:${intensity}:${roughness}:${JSON.stringify(opts)}`;
  let m = materials.get(id) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: PALETTE[key], emissive: PALETTE[key], emissiveIntensity: intensity, roughness, metalness: 0, ...opts });
    materials.set(id, m);
  }
  return m;
}

/** Like emissiveMat but NOT cached: animated surfaces need their own material so each gate/sensor can carry
 *  its own phase. Used only for the handful of ambient-electronics channels. */
export function emissiveMatUnique(key: MatKey, intensity: number, roughness = 0.35): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: PALETTE[key], emissive: PALETTE[key], emissiveIntensity: intensity, roughness, metalness: 0 });
}

/** Soft additive light-spill plane (floor glow under a cove, screen wash). Transparent, no depth write. */
export function glowMat(key: MatKey, opacity: number): THREE.MeshBasicMaterial {
  const id = `glow:${key}:${opacity}`;
  let m = materials.get(id) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: PALETTE[key], transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    materials.set(id, m);
  }
  return m;
}

/** Like glowMat but NOT cached: an animated glow needs its own material to carry its own opacity/tint. */
export function glowMatUnique(key: MatKey, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: PALETTE[key], transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
}

/** FLOOR OVERLAY STACK — the fix for decoration that vanished depending on camera angle.
 *
 *  Every room stacks flat layers within about a unit of the floor: a multiply tint, contact shadows, then
 *  additive spill/halo/core. three.js sorts TRANSPARENT objects back-to-front by depth, and layers this
 *  close together have almost identical sort keys — so the order flipped as the camera rotated. Additive
 *  blending is commutative and does not care, but a MULTIPLY tint does: every glow drawn before it gets
 *  multiplied down to nothing, and every glow after it survives. Measured on the Gaming rug, the number of
 *  additive layers landing before the tint swung from 10 to 25 across a yaw sweep, which is why the rug
 *  went from vivid to flat grey as you turned the camera.
 *
 *  So the darkening layers get an explicit, NEGATIVE renderOrder and the additives keep the default. That
 *  pins the stack to tint → contact shadow → glows regardless of where the camera is. A material declares
 *  its role here; SceneMirror applies it once per room, so a new room gets this for free.
 *
 *  Additives are deliberately left at 0: they commute, and giving them an order would only add churn. */
export const FLOOR_LAYER = { tint: -20, contact: -10 } as const;
/** Tag a material with the stack slot it belongs to. Read by SceneMirror.applyFloorLayerOrder. */
export function floorLayer<T extends THREE.Material>(m: T, slot: number): T {
  m.userData.floorLayer = slot;
  return m;
}

/** Contact-shadow disc/plate under furniture: a soft dark multiply plane just above the floor. */
export function contactShadowMat(opacity = 0.16): THREE.MeshBasicMaterial {
  const id = `contact:${opacity}`;
  let m = materials.get(id) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = floorLayer(new THREE.MeshBasicMaterial({ color: 0x3a2e24, transparent: true, opacity, depthWrite: false }), FLOOR_LAYER.contact);
    materials.set(id, m);
  }
  return m;
}

/** A powered display: draw the UI into a canvas and use it as the emissive map so it reads lit, not painted.
 *  `draw` receives a 2D context of `w × h`; returns a plain screenMat when no canvas exists (tests). */
export function uiScreenMat(id: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, intensity = 0.9, unique = false): THREE.MeshStandardMaterial {
  const key = `ui:${id}`;
  let m = materials.get(key) as THREE.MeshStandardMaterial | undefined;
  // `unique` clones the cached material so an animated screen owns its emissiveIntensity; the canvas
  // texture itself is still shared (never redrawn per frame)
  if (m) return unique ? new THREE.MeshStandardMaterial({ color: 0x000000, map: m.map, emissive: 0xffffff, emissiveMap: m.emissiveMap, emissiveIntensity: intensity, roughness: 0.18, metalness: 0.05 }) : m;
  const ctx = canvas2d(w, h);
  if (!ctx) return screenMat();
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  m = new THREE.MeshStandardMaterial({ color: 0x000000, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: intensity, roughness: 0.18, metalness: 0.05 });
  materials.set(key, m);
  return unique ? new THREE.MeshStandardMaterial({ color: 0x000000, map: m.map, emissive: 0xffffff, emissiveMap: m.emissiveMap, emissiveIntensity: intensity, roughness: 0.18, metalness: 0.05 }) : m;
}

/** Reception's façade / balustrade glass: the source glass is a cool teal-tinted pane and reads a little
 *  denser than the Design Room's. Separate material so the Design Room is untouched. */
export function facadeGlassMat(): THREE.MeshStandardMaterial {
  let m = materials.get("facadeGlass") as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: 0xbfe0e6, roughness: 0.06, metalness: 0.12, transparent: true, opacity: 0.5, side: THREE.DoubleSide, envMapIntensity: 1.4 });
    materials.set("facadeGlass", m);
  }
  return m;
}

export function glassMat(): THREE.MeshStandardMaterial {
  let m = materials.get("glass") as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.42, side: THREE.DoubleSide, envMapIntensity: 1.2 });
    materials.set("glass", m);
  }
  return m;
}
