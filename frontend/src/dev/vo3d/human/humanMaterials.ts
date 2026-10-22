// vo3d human — THE HUMANBASE MATERIALS. Every piece of a modular employee shades with the roster's own recipe
// (MeshStandardMaterial, roughness ~0.9 — avatar/CastPrototypes), extended through onBeforeCompile so editing an
// appearance is a uniform change, never a new texture or a new file:
//   · BODY — the base skin: its texture's LUMINANCE carries Alex's skin shading, the identity's skin tone carries
//     the colour; regions hidden by worn garments are discarded (`_region` against a 32-bit mask).
//   · IDENTITY HEAD — the identity's own texture, with the rebuilt surfaces (the face under the removed frames,
//     the scalp) painted from a per-vertex `_paint` layer.
//   · GARMENTS — one fabric shader: a main / trim / accent colourway, rib bands (`_band`), a printed decal (uv),
//     and per-fabric surface (fleece, jersey, denim twill, clog vents).
//   · FACE — eye and mouth shells: sclera, iris, pupil, highlights, a moving eyelid with its own lash line, and an
//     open-mouth shape. No morph targets, no extra bones, works for any identity that publishes landmarks.
import * as THREE from "three";

export type SkinUniforms = { uHide: { value: number }; uSkin: { value: THREE.Color }; uLumRef: { value: number } };

/** Base body skin. `lumRef` is the base texture's own skin luminance (Alex's forearm), so a texel at that
 *  luminance renders exactly the identity's tone and darker/lighter texels keep their shading. */
export function bodySkinMaterial(map: THREE.Texture | null, skin: THREE.ColorRepresentation, lumRef: number): { material: THREE.MeshStandardMaterial; uniforms: SkinUniforms } {
  const uniforms: SkinUniforms = { uHide: { value: 0 }, uSkin: { value: new THREE.Color(skin) }, uLumRef: { value: lumRef } };
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.88, metalness: 0 });
  if (m.map) m.map.anisotropy = 8;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float _region;\nvarying float vRegion;\n${shader.vertexShader}`
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vRegion = _region;");
    shader.fragmentShader = `uniform int uHide;\nuniform vec3 uSkin;\nuniform float uLumRef;\nvarying float vRegion;\n${shader.fragmentShader}`
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
  int region = int(vRegion + 0.5);
  if (((uHide >> region) & 1) == 1) discard;`)
      .replace("#include <map_fragment>", `#include <map_fragment>
  float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  // V1.2 CLEAN SKIN CONTRACT: the base texture only carries gentle large-scale variation (±10%) — a wide clamp turned every
  // stray texel into a dark speck and every UV-seam bleed into a white crack line on hands, arms and legs
  diffuseColor.rgb = uSkin * clamp(lum / uLumRef, 0.9, 1.1);`);
  };
  m.customProgramCacheKey = () => "humanbase-skin";
  return { material: m, uniforms };
}

/** Identity head: the identity's own texture, the `_paint` layer over it (rebuilt surfaces). `_paint` is stored
 *  sRGB (sampled from the same texture), so it is linearised in the vertex stage. */
/** `hair` (V1.1 layered hair meshes): the INSIDE of a hair shell (seen from below / behind) is shaded as the hair's own
 *  shadowed underside, so an open shell reads as intended hair volume rather than a flat copy of its outside */
/** `hair` (V1.1 layered hair meshes): the INSIDE of a hair shell (seen from below / behind) is shaded as the hair's own
 *  shadowed underside, and the hairstyle's FLOW HIGHLIGHTS are drawn: an anisotropic (Kajiya-Kay style) highlight along
 *  the per-vertex flow tangent (`_flow`, root → tip, from the identity build), masked to a few broad lock lanes (`_clump`),
 *  tinted as a lighter variation of the person's hair (`m.userData.hairHL`, set from landmarks.hairHighlight). Assets
 *  without flow data render exactly as before. */
export function identityHeadMaterial(map: THREE.Texture | null, hair = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0 });
  if (m.map) m.map.anisotropy = 8;
  const hl = { uHL: { value: new THREE.Color(0.36, 0.37, 0.4) }, uHLs: { value: 0 } };
  if (hair) m.userData.hairHL = hl;
  m.onBeforeCompile = (shader) => {
    if (hair) Object.assign(shader.uniforms, hl);
    shader.vertexShader = `attribute vec4 _paint;\nvarying vec4 vPaint;\n${hair ? "attribute vec3 _flow;\nattribute float _clump;\nvarying vec3 vFlow;\nvarying float vClump;\n" : ""}${shader.vertexShader}`
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vPaint = vec4(pow(_paint.rgb, vec3(2.2)), _paint.a);");
    if (hair) shader.vertexShader = shader.vertexShader.replace("#include <defaultnormal_vertex>", `#include <defaultnormal_vertex>
  vec3 hbF = _flow;
  #ifdef USE_SKINNING
    hbF = (skinMatrix * vec4(hbF, 0.0)).xyz;
  #endif
  vFlow = normalMatrix * hbF; vClump = _clump;`);
    shader.fragmentShader = `varying vec4 vPaint;\n${hair ? "varying vec3 vFlow;\nvarying float vClump;\nuniform vec3 uHL;\nuniform float uHLs;\n" : ""}${shader.fragmentShader}`
      .replace("#include <map_fragment>", `#include <map_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vPaint.rgb, vPaint.a);${hair ? "\n  if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;" : ""}`);
    if (hair) shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
  #if NUM_DIR_LIGHTS > 0
  if (uHLs > 0.0 && length(vFlow) > 0.5 && gl_FrontFacing) {
    vec3 hbT = normalize(vFlow), hbV = normalize(vViewPosition), hbL = normalize(directionalLights[0].direction), hbH = normalize(hbL + hbV);
    float hbC = dot(hbT, hbH), hbS = sqrt(max(0.0, 1.0 - hbC * hbC));
    float hbSpec = pow(hbS, 40.0) * 0.6 + pow(hbS, 10.0) * 0.1;
    float hbLane = smoothstep(0.2, 0.8, vClump), hbLit = clamp(dot(normal, hbL) * 0.6 + 0.4, 0.0, 1.0);
    reflectedLight.directSpecular += uHL * hbSpec * hbLane * hbLit * uHLs * directionalLights[0].color * 0.12;
  }
  #endif`);
  };
  m.customProgramCacheKey = () => (hair ? "humanbase-identity-hair-v2" : "humanbase-identity-head");
  return m;
}

export type Fabric = "fleece" | "jersey" | "denim" | "clog" | "sneaker";
const FABRIC_ID: Readonly<Record<Fabric, number>> = { fleece: 0, jersey: 1, denim: 2, clog: 3, sneaker: 4 };
export type GarmentUniforms = {
  uMain: { value: THREE.Color }; uTrim: { value: THREE.Color }; uAccent: { value: THREE.Color };
  uDecal: { value: THREE.Texture | null }; uHasDecal: { value: number }; uFabric: { value: number }; uDecalTint: { value: number }; uDecalLight: { value: number };
  /** the wearer's skin (band 5: skin seen through a shoe opening) */
  uSkinG: { value: THREE.Color };
};
export type GarmentLook = { main: string; trim?: string; accent?: string };

/** One shader for every garment and shoe. `_band`: 0 body of the garment, 1 rib/cuff/sole, 2 stitch/strap,
 *  3 rivet/aglet. The decal is a printed graphic over the fabric (alpha). */
/** `decalTint`: the print is single-colour artwork (white on transparent) coloured by the colourway's accent */
/** dark fabric → light print (1), light fabric → the artwork's own dark ink (0): by the fabric's relative luminance */
export function decalLightFor(main: string): number { const c = new THREE.Color(main); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.18 ? 1 : 0; }

export function garmentMaterial(fabric: Fabric, look: GarmentLook, decal: THREE.Texture | null, roughness = 0.92, decalTint = false): { material: THREE.MeshStandardMaterial; uniforms: GarmentUniforms } {
  const uniforms: GarmentUniforms = {
    uMain: { value: new THREE.Color(look.main) }, uTrim: { value: new THREE.Color(look.trim ?? look.main) },
    uAccent: { value: new THREE.Color(look.accent ?? look.trim ?? look.main) },
    uDecal: { value: decal }, uHasDecal: { value: decal ? 1 : 0 }, uFabric: { value: FABRIC_ID[fabric] }, uDecalTint: { value: decalTint ? 1 : 0 }, uDecalLight: { value: decalLightFor(look.main) }, uSkinG: { value: new THREE.Color("#e9b08e") },
  };
  const m = new THREE.MeshStandardMaterial({ roughness, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float _band;\nvarying float vBand;\nvarying vec3 vObj;\nvarying vec3 vObjN;\nvarying vec2 vDecalUv;\nvarying float vDecalOk;\n${shader.vertexShader}`
      .replace("#include <begin_vertex>", `#include <begin_vertex>
  vBand = _band; vObj = position; vObjN = normal; vDecalUv = uv; vDecalOk = uv.x < -0.5 ? 0.0 : 1.0;`);
    shader.fragmentShader = `uniform vec3 uMain; uniform vec3 uTrim; uniform vec3 uAccent; uniform sampler2D uDecal; uniform int uHasDecal; uniform int uFabric; uniform int uDecalTint; uniform int uDecalLight; uniform vec3 uSkinG;
varying float vBand; varying vec3 vObj; varying vec3 vObjN; varying vec2 vDecalUv; varying float vDecalOk;
float hb_hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
${shader.fragmentShader}`.replace("vec4 diffuseColor = vec4( diffuse, opacity );", `
  vec3 col = uMain;
  float grain = hb_hash(floor(vObj * 900.0));
  if (uFabric <= 1) {
    // knit: soft grain; ribbed bands are the trim colour with fine vertical ribs
    col *= 0.965 + 0.05 * grain;
    if (vBand > 0.25 && vBand < 0.75) col = uMain * 0.78 + vec3(0.05); // the hood's lining at its rim
    if (vBand > 0.75 && vBand < 1.5) { float rib = 0.5 + 0.5 * sin((vObj.x * 0.8 + vObj.z) * 520.0); col = uTrim * (0.9 + 0.1 * rib); }
    if (vBand > 1.5 && vBand < 2.5) col = uTrim * 0.9;
    if (vBand > 2.5) col = uAccent;
    if (uHasDecal == 1 && vDecalOk > 0.999 && vDecalUv.x >= 0.0 && vDecalUv.x <= 1.0 && vDecalUv.y >= 0.0 && vDecalUv.y <= 1.0) {
      vec4 d = texture2D(uDecal, vDecalUv);
      // light print on dark fabric: the artwork's dark ink (e.g. a wordmark) turns light; coloured marks are kept
      vec3 dc = d.rgb; if (uDecalLight == 1 && dot(dc, vec3(0.3, 0.59, 0.11)) < 0.3) dc = vec3(0.95, 0.94, 0.91);
      col = mix(col, uDecalTint == 1 ? uAccent * dc : dc, d.a);
    }
  } else if (uFabric == 2) {
    // denim: a diagonal twill, lighter wear across the front of the thighs, a lighter rolled cuff, orange topstitch
    float tw = 0.5 + 0.5 * sin((vObj.x * 0.9 + vObj.y) * 1500.0);
    col = mix(uMain * 0.84, uMain * 1.06, tw) * (0.96 + 0.06 * grain);
    float wear = smoothstep(0.1, 0.9, vObjN.z) * smoothstep(0.42, 0.3, vObj.y) * smoothstep(0.17, 0.26, vObj.y);
    col = mix(col, uAccent, 0.32 * wear);
    if (vBand > 0.5 && vBand < 1.5) col = mix(uAccent, uMain, 0.35) * (0.93 + 0.1 * tw);
    if (vBand > 1.5) col = uTrim;
  } else if (uFabric == 4) {
    // sneaker: smooth leather upper, overlay panels (toe cap / heel counter) a shade off, a rubber midsole with a
    // foxing line and tread underneath, laces, a darker lining inside the collar
    col = uMain * (0.975 + 0.03 * grain);
    if (vBand > 0.5 && vBand < 1.5) { col = uTrim; if (vObjN.y < -0.6) col = uTrim * (0.8 + 0.06 * step(0.5, fract(vObj.z * 140.0))); else if (abs(vObj.y - 0.0135) < 0.0011) col = uTrim * 0.8; }
    if (vBand > 1.5 && vBand < 2.5) col = uMain * 0.955;
    if (vBand > 2.5 && vBand < 3.5) col = uAccent * 0.97;
    if (vBand > 3.5 && vBand < 4.5) col = uMain * 0.62;
  } else {
    // clog: moulded foam, vent holes over the toe box, a darker sole, the strap and its rivets
    col = uMain * (0.97 + 0.03 * grain);
    if (vBand > 0.5 && vBand < 1.5) col = uTrim;
    if (vBand > 1.5 && vBand < 2.5) col = uMain * 0.94;
    if (vBand > 2.5 && vBand < 3.5) col = uAccent;
    if (vBand > 3.5 && vBand < 4.5) col = uMain * 0.5;    // the footbed
    if (vBand > 4.5) col = uSkinG * 0.94;                // the seated foot
    if (vBand > 0.5 && vBand < 1.5) col = uTrim * (0.92 + 0.08 * step(0.5, fract(vObj.y * 160.0)));   // the sole's tread lines
    // side vents: a row of rounded slots along the wall above the sole
    if (vBand < 0.5 && abs(vObjN.x) > 0.55 && vObj.y > 0.034 && vObj.y < 0.054) {
      float f = fract(vObj.z / 0.036 + 0.25); vec2 q = vec2((f - 0.5) * 0.036 / 0.011, (vObj.y - 0.044) / 0.007);
      if (length(q) < 1.0) col = uMain * mix(0.3, 0.55, length(q));
    }
    if (vBand < 0.5 && vObjN.y > 0.35 && vDecalUv.y > 0.52) {
      vec2 g = vDecalUv * vec2(7.0, 11.0);
      g.x += 0.5 * mod(floor(g.y), 2.0);
      vec2 f = fract(g) - 0.5;
      float r = length(f);
      if (r < 0.2) col = uMain * mix(0.32, 0.6, smoothstep(0.0, 0.2, r));
      else if (r < 0.26) col = uMain * 1.04;
    }
  }
  vec4 diffuseColor = vec4( col, opacity );`);
  };
  m.customProgramCacheKey = () => `humanbase-garment-${fabric}`;
  return { material: m, uniforms };
}

/** Hair, glasses frames, sneakers: their own vertex colours on the roster's standard material. */
export function vertexColourMaterial(roughness: number, doubleSided = false): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
}

// ---- the face ------------------------------------------------------------------------------------------------

export type FaceUniforms = {
  uLook: { value: THREE.Vector2 }; uClose: { value: number }; uLower: { value: number }; uWide: { value: number };
  uIris: { value: THREE.Color }; uSkin: { value: THREE.Color }; uLash: { value: THREE.Color }; uLashTop: { value: number };
  uOpen: { value: number }; uMouthWide: { value: number };
  /** identity: eye scale, spacing (outward, in eye half-widths), openness, tilt (outer corner up +) */
  uEyeP: { value: THREE.Vector4 }; uIrisSize: { value: number };
  /** the talking mouth follows the identity's mouth offset (shell uv units) */
  uMouthDY: { value: number };
};

export function faceUniforms(skin: string, iris: string, lashTop: number): FaceUniforms {
  return {
    uLook: { value: new THREE.Vector2() }, uClose: { value: 0 }, uLower: { value: 0 }, uWide: { value: 0 },
    uIris: { value: new THREE.Color(iris) }, uSkin: { value: new THREE.Color(skin) }, uLash: { value: new THREE.Color(0x0b0a0a) },
    uLashTop: { value: lashTop }, uOpen: { value: 0 }, uMouthWide: { value: 1 },
    uEyeP: { value: new THREE.Vector4(1, 0, 1, 0) }, uIrisSize: { value: 1 }, uMouthDY: { value: 0 },
  };
}

/** THE HUMAN EYE, in opening-normalised coordinates (|x|,|y| ≈ 1 at the edge of the white; +x = outer corner).
 *  Almond opening, a thick upper lash line that rides the lid, the skin of the lid above it and below the lower
 *  edge. Everything inside the shell is redrawn, so the identity's painted lash line never stays behind a blink. */
const EYE_FRAG = /* glsl */ `
  vec2 p = vFaceUv; p.x *= vSide;
  // identity: spacing (outward), tilt (outer corner up), scale, openness
  p.x -= uEyeP.y;
  p = vec2(p.x * cos(uEyeP.w) + p.y * sin(uEyeP.w), -p.x * sin(uEyeP.w) + p.y * cos(uEyeP.w));
  p /= uEyeP.x; p.y /= uEyeP.z;
  // LOCKED FAMILY EYE: a clean almond (fuller upper arc peaking slightly inboard, a flatter lower arc), the outer
  // corner a touch lifted; a large but controlled iris whose top tucks under the upper lid
  float ax = abs(p.x);
  float k = max(0.0, 1.0 - ax * ax);
  float top0 = pow(k, 0.62) * (0.92 + 0.12 * uWide) + 0.06 - 0.08 * (p.x - 0.1) * (p.x - 0.1) * 0.0 + 0.05 * p.x;
  float bot0 = -pow(k, 0.85) * (0.66 + 0.1 * uWide) + 0.06 * p.x;
  float closedY = mix(bot0, top0, 0.32) - 0.02;
  float topEdge = mix(top0, closedY, uClose);
  float botEdge = min(mix(mix(bot0, closedY - 0.03, uLower), closedY + 0.002, uClose * uClose), topEdge);
  // family: a HEAVY dark upper lash line, thickest at the outer half
  float lash = (0.2 + 0.1 * smoothstep(-0.4, 0.8, p.x)) * mix(1.0, 0.6, uClose);
  vec3 col;
  bool inAlmond = ax < 1.0 && p.y < top0 && p.y > bot0;
  if (ax < 1.04 && p.y >= topEdge && p.y < topEdge + lash) {
    col = uLash;                                                              // the upper lash line rides the lid
  } else if (inAlmond && p.y > topEdge) {
    col = uSkin * (0.93 - 0.08 * smoothstep(topEdge + 0.35, topEdge, p.y));   // the closing lid, its edge in shade
  } else if (inAlmond && p.y < botEdge) {
    col = uSkin * 0.97;
  } else if (inAlmond) {
    vec2 ic = vec2(-0.03, 0.02) + vec2(uLook.x * vSide, uLook.y) * vec2(0.36, 0.2);
    float d = length((p - ic) * vec2(1.0, 0.95));
    // family: a large dark iris that fills most of the opening's height
    float R = 0.78 * uIrisSize;
    // sclera: clean, cooler and darker under the lid (the lid's own shadow), soft corners
    col = vec3(0.95, 0.95, 0.94) * (1.0 - 0.32 * smoothstep(topEdge - 0.5, topEdge, p.y)) * (1.0 - 0.12 * smoothstep(0.6, 1.0, ax));
    if (d < R) {
      vec3 iris = mix(uIris * 2.2 + 0.04, uIris * 0.9, smoothstep(0.1, R, d));
      iris *= 1.0 - 0.45 * smoothstep(topEdge - 0.55, topEdge, p.y);          // the lid shades the iris top
      col = d > R - 0.06 ? uIris * 0.45 : iris;                               // limbal ring
      if (d < 0.36 * uIrisSize) col = vec3(0.015);                            // pupil
    }
    if (length(p - ic - vec2(-0.24, 0.26)) < 0.17) col = mix(col, vec3(1.0), 0.95);   // key highlight
    if (length(p - ic - vec2(0.18, -0.2)) < 0.05) col = mix(col, vec3(1.0), 0.7);   // fill highlight
    col = mix(col, uSkin * 0.8, smoothstep(botEdge + 0.07, botEdge, p.y) * 0.55);   // the lower lid's soft rim
  } else if (p.x > 0.93 && p.x < 1.16 && abs(p.y - mix(top0 * 0.0 + 0.12, closedY, uClose) - 0.22 * (p.x - 0.93)) < 0.06) {
    col = uLash;                                                              // the outer flick
  } else {
    discard;
  }
  vec4 diffuseColor = vec4(col, opacity);
`;
const MOUTH_FRAG = /* glsl */ `
  vec2 p = vFaceUv;
  if (uOpen < 0.02) discard;
  float ry = 0.08 + 0.5 * uOpen, rx = 0.5 * uMouthWide;
  vec2 c = vec2(0.0, 0.08 - ry * 0.85 + uMouthDY);
  vec2 q = (p - c) / vec2(rx, ry);
  float e = length(q);
  if (e > 1.0) discard;
  vec3 col = e > 0.82 ? vec3(0.32, 0.1, 0.09) : vec3(0.16, 0.035, 0.04);
  if (q.y > 0.45 && e <= 0.82 && uOpen > 0.35) col = vec3(0.97, 0.96, 0.94);
  if (q.y < -0.35 && e <= 0.82) col = vec3(0.82, 0.38, 0.4);
  vec4 diffuseColor = vec4(col, opacity);
`;

/** LIVING EYES for generated identity heads: the shell's texture is baked from the head's own painted eyes (identical
 *  at rest); alpha = the eye opening, its value the vertical position inside it (0 lower lid … 1 upper lid). The shared
 *  face uniforms drive blink (a skin lid with a lash edge descends), squint (lower lid) and gaze (the painted iris
 *  slides over the sclera). `lookUV`: the iris travel per unit of uLook, in the atlas' UV. */
export function bakedEyeMaterial(u: FaceUniforms, map: THREE.Texture, sclera: string, lookUV: [number, number]): THREE.MeshStandardMaterial {
  // V1.1: a CONSTANT depth bias only. The shell is already geometrically lifted off the face; a slope-scaled offset
  // (polygonOffsetFactor) grows without bound at grazing angles and pulled the eye through bangs, brows and the nose
  // bridge in ¾ and side views
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.35, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4 });
  map.colorSpace = THREE.SRGBColorSpace; map.minFilter = THREE.LinearFilter; map.generateMipmaps = false;
  const extra = { uSclera: { value: new THREE.Color(sclera) }, uLookUV: { value: new THREE.Vector2(...lookUV) } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, extra);
    // the smoothed lid normal (_lidn), skinned like the normal, for lid surface shading
    shader.vertexShader = `attribute vec3 _lidn;\nattribute float _edge;\nvarying vec3 vLidN;\nvarying float vEdge;\n${shader.vertexShader}`.replace("#include <defaultnormal_vertex>", `#include <defaultnormal_vertex>
  vEdge = _edge;
  vec3 hbL = _lidn;
  #ifdef USE_SKINNING
    hbL = (skinMatrix * vec4(hbL, 0.0)).xyz;
  #endif
  vLidN = normalMatrix * hbL;`);
    shader.fragmentShader = `varying vec3 vLidN;\nvarying float vEdge;\nuniform vec2 uLook; uniform float uClose; uniform float uLower; uniform vec3 uSkin; uniform vec3 uLash; uniform vec3 uSclera; uniform vec2 uLookUV;
float hbLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
${shader.fragmentShader}`.replace("#include <map_fragment>", `
  vec4 tx = texture2D(map, vMapUv);
  // coded alpha, read UNFILTERED: ≤1 outside · 2 lid region · 8/9 opening (+iris flag) · 10 painted flick (kept as painted)
  ivec2 tsz = textureSize(map, 0);
  vec2 tp = vMapUv * vec2(tsz);
  // the top 9 atlas rows are DATA (alpha = numbers, not codes): the grid's top edge samples exactly at their boundary — never
  // decode them as eye texels (V1 drew a dashed line along the top of every eye box)
  if (tp.y >= float(tsz.y) - 9.0) discard;
  float ai = floor(texelFetch(map, ivec2(tp), 0).a * 255.0 + 0.5);
  if (ai < 1.5) discard;
  float cls = floor(ai / 2.0);
  vec3 col = tx.rgb;
  float hbSkinW = cls < 1.5 ? 1.0 : 0.0, hbLidN = 0.0;
  if (cls < 4.5) {
    // this column's eye (the atlas' top data rows, alpha, filtered along x): opening bottom + height, lash thickness, closed line (texels)
    float rows = float(tsz.y) - 9.0, ty = float(tsz.y);
    #define HB_ROW(r) texture2D(map, vec2(vMapUv.x, (rows + r + 0.5) / ty)).a
    float B = HB_ROW(0.0) * 255.0 + HB_ROW(1.0), H = HB_ROW(2.0) * 255.0 + HB_ROW(3.0);
    float LT = max(HB_ROW(4.0) * 255.0 / 4.0, 1.5), CLn = HB_ROW(6.0) * 255.0 + HB_ROW(7.0), y = tp.y;
    vec3 S = texture2D(map, vMapUv + vec2(1.0 / 3.0, 0.0)).rgb;    // the rebuilt lid surface (the eye's own surrounding skin)
    if (cls > 3.5) {   // the open eye: a CLEAN SCLERA with the measured iris DISC carried by the gaze (stable shape, own paint)
      int NXe = tsz.x / 6, sd = int(floor(vMapUv.x * 6.0)), r8 = tsz.y - 1;
      #define HB_P(j) (texelFetch(map, ivec2(sd * NXe + j, r8), 0).a * 255.0)
      vec3 Wc = texture2D(map, vMapUv + vec2(2.0 / 3.0, 0.0)).rgb;
      if (HB_P(7) > 0.5) {
        // the iris that moves is exactly its own painted iris (the clean flagged disc), rigidly, by a travel clamped per eye so
        // it stays inside the opening; what it uncovers is the rebuilt clean sclera. At rest this is exactly the paint.
        vec2 off = vec2(uLook.x * HB_P(5), uLook.y * HB_P(6)) / 4.0;
        vec2 suv = vMapUv - off / vec2(tsz);
        float si = floor(texelFetch(map, ivec2(suv * vec2(tsz)), 0).a * 255.0 + 0.5);
        col = (si > 8.5 && si < 9.5) ? texture2D(map, suv).rgb : Wc;
      }
    }
    float k = clamp(uClose, 0.0, 1.0), fade = smoothstep(0.0, 0.05, k);
    float lowB = smoothstep(0.5, 1.0, k), kL = max(lowB * 0.3, uLower * 0.55), lowOn = max(lowB, smoothstep(0.0, 0.1, uLower)), kLOn = smoothstep(0.0, 0.03, kL);
    float eU = mix(B + H, CLn, k), eL = max(mix(B, CLn, lowB), B + H * uLower * 0.55);   // both lids meet on the closed line (a fitted arc ~30% up)
    // the upper lid's soft shadow on the eye just under it
    if (cls > 3.5 && y < eU) col *= mix(1.0, 0.8, fade * (1.0 - smoothstep(0.0, 0.12 * H + 1.0, eU - y)));
    // LOWER LID: the painted rim gives way to lid surface as it rises; a soft edge line while the eye is still open
    float wLo = y < B ? 1.0 : (1.0 - smoothstep(eL - 0.6, eL + 0.6, y)) * kLOn;
    col = mix(col, y < B ? mix(tx.rgb, S, lowOn) : S * 0.97, wLo);
    col = mix(col, S * 0.84, kLOn * (1.0 - smoothstep(0.85, 1.0, k)) * (1.0 - smoothstep(0.0, 1.2, abs(y - eL))) * step(B, y));
    // UPPER LID: above its edge — the lash stroke riding the lid edge, then clean lid surface with a soft shadow above the
    // lashes; at rest (k = 0) this is exactly the painted texture
    // the lash line: one clean stroke in the eye's own lash colour, its own thickness profile, tapering into the corners
    vec3 lc = texture2D(map, vec2(vMapUv.x, (rows + 0.5) / ty)).rgb;
    float lw = mix(LT, max(LT * 0.6, 1.6), k) * smoothstep(0.0, 5.0, H) + 0.35, dy = y - eU;
    float wl = 1.0 - smoothstep(lw - 0.6, lw + 0.6, dy);
    vec3 lid = mix(S * mix(0.93, 1.0, smoothstep(0.0, 4.0, dy - lw)), lc, wl);
    float wUp = smoothstep(eU - 0.6, eU + 0.6, y);
    col = mix(col, mix(tx.rgb, lid, fade), wUp);
    hbSkinW = max(hbSkinW, max(wUp * fade, wLo));
    hbLidN = max(wUp * fade, y < B ? lowOn : wLo);
  }
  // the shell FEATHERS into the head at its border (where it shows the same skin as the head beneath), so a rebuilt lid
  // meets the surrounding skin with no edge
  diffuseColor.a = cls > 3.5 ? 1.0 : smoothstep(0.0, 1.0, vEdge);
  diffuseColor.rgb = col;`).replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.9, hbSkinW);")
      // V1.1: the OPEN EYE (sclera + iris) shades with the shell's SMOOTHED surface — the generated head's eye relief (bumps,
      // ridges, a lumpy iris bulge) no longer reads as a rough eyeball from oblique angles. The lid keeps the head's own
      // shading at rest (so it matches the socket around it) and blends to the smooth lid as it closes (hbLidN)
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n  float hbN = max(hbLidN, cls > 3.5 ? 0.8 * smoothstep(0.0, 1.0, vEdge) : 0.0);\n  if (hbN > 0.0 && dot(vLidN, vLidN) > 0.0) normal = normalize(mix(normal, normalize(vLidN), hbN));");
  };
  m.customProgramCacheKey = () => "humanbase-baked-eyes-lid3";
  return m;
}

export function faceMaterial(u: FaceUniforms, eye: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    roughness: eye ? 0.35 : 0.7, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = `${eye ? "attribute float _side;\n" : ""}varying vec2 vFaceUv;\nvarying float vSide;\n${shader.vertexShader}`
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n  vFaceUv = uv;\n  vSide = ${eye ? "_side" : "1.0"};`);
    shader.fragmentShader = `uniform vec2 uLook; uniform float uClose; uniform float uLower; uniform float uWide; uniform vec3 uIris; uniform vec3 uSkin;
uniform vec3 uLash; uniform float uLashTop; uniform float uOpen; uniform float uMouthWide;
uniform vec4 uEyeP; uniform float uIrisSize; uniform float uMouthDY;
varying vec2 vFaceUv; varying float vSide;
${shader.fragmentShader}`.replace("vec4 diffuseColor = vec4( diffuse, opacity );", eye ? EYE_FRAG : MOUTH_FRAG);
  };
  m.customProgramCacheKey = () => (eye ? "humanbase-eyes" : "humanbase-mouth");
  return m;
}

// ---- the canonical head: identity painted from parameters -----------------------------------------------------

export type HeadPaintUniforms = Record<string, { value: number | THREE.Color | THREE.Vector2 | THREE.Vector3 | THREE.Vector4 }>;

/** Uniforms for the canonical head's identity paint. Landmark positions are the canonical head's (bind space). */
export function headPaintUniforms(lm: { eye: [number, number, number, number]; noseY: number; mouthY: number }): HeadPaintUniforms {
  return {
    uSkinH: { value: new THREE.Color("#efb38c") },
    uEye: { value: new THREE.Vector4(...lm.eye) },                       // eye centre x, y, half width, half height
    uEyeP: { value: new THREE.Vector4(1, 0, 1, 0) },                     // scale, spacing, openness, tilt
    uCrease: { value: 0.3 },
    uBrow: { value: new THREE.Vector4(0, 1, 0.3, 0) },                   // height, thickness, arch, tilt
    uBrow2: { value: new THREE.Vector2(1, 0) },                          // length, gap
    uBrowC: { value: new THREE.Color("#2a2120") },
    uNoseY: { value: lm.noseY }, uNose: { value: new THREE.Vector3(0, 0, 0.6) },   // size, width (shape controls), nostril
    uMouthY: { value: lm.mouthY }, uLip: { value: new THREE.Vector4(1, 1, 1, 0.5) }, uLipFull: { value: 0 },   // width, upper, lower, bow
    uLipC: { value: new THREE.Color("#d98f8a") },
    uLip2: { value: new THREE.Vector4(0, 0, 0, 0) },                     // offset, smile, line style, under-lip mark
    uBlush: { value: 0.35 },
    uStub: { value: new THREE.Vector3(0, 0, 0) }, uStubC: { value: new THREE.Color("#1c1818") },
  };
}

/** The shared head's material: skin tone × baked depth (`_ao`) with the identity's features painted in bind space,
 *  so paint stays on the surface whatever the shape controls do. Soft edges everywhere (fwidth-antialiased); the
 *  lips are shaded as volumes, the brows carry stroke texture — features belong to the surface, not stickers on it. */
export function canonicalHeadMaterial(u: HeadPaintUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.68, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = `attribute float _ao;\nvarying float vAo;\nvarying vec3 vB;\nvarying vec3 vBN;\n${shader.vertexShader}`
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vAo = _ao; vB = position; vBN = normal;");
    shader.fragmentShader = `uniform vec3 uSkinH; uniform vec4 uEye; uniform vec4 uEyeP; uniform float uCrease; uniform vec4 uBrow; uniform vec2 uBrow2; uniform vec3 uBrowC;
uniform float uNoseY; uniform vec3 uNose; uniform float uMouthY; uniform vec4 uLip; uniform float uLipFull; uniform vec3 uLipC; uniform vec4 uLip2; uniform float uBlush; uniform vec3 uStub; uniform vec3 uStubC;
varying float vAo; varying vec3 vB; varying vec3 vBN;
float hp_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hp_aa(float d) { float w = max(fwidth(d), 1e-5); return 1.0 - smoothstep(-w, w, d); }
${shader.fragmentShader}`.replace("vec4 diffuseColor = vec4( diffuse, opacity );", `
  vec3 col = uSkinH;
  float front = smoothstep(0.05, 0.4, vBN.z);
  float ax = abs(vB.x);
  // the eye as the face layer draws it (same spacing, scale, tilt) — for the brow and the lid crease
  float ex = uEye.x + uEyeP.y * uEye.z, ey = uEye.y, ew = uEye.z * uEyeP.x, eh = uEye.w * uEyeP.x * uEyeP.z;
  // ---- cheeks: a soft warm blush
  float bl = exp(-(pow((ax - 0.215) / 0.075, 2.0) + pow((vB.y - 0.94) / 0.05, 2.0)));
  col = mix(col, col * vec3(1.02, 0.86, 0.84), uBlush * 0.45 * bl * front);
  // ---- the hooded lid crease: a soft shade just above the eye opening
  vec2 q = vec2((ax - ex) / ew, (vB.y - ey) / eh);
  float creaseY = 1.18 + 0.12 * uEyeP.z;
  float cr = exp(-pow((q.y - creaseY * sqrt(max(0.0, 1.0 - 0.75 * q.x * q.x))) / 0.17, 2.0)) * (1.0 - smoothstep(0.9, 1.2, abs(q.x)));
  col *= 1.0 - 0.22 * uCrease * cr * front;
  // ---- nose: soft nostrils under the tip, a faint tip highlight
  float nw = 1.0 + 0.45 * uNose.y, ns = 1.0 + 0.6 * uNose.x;
  vec2 nq = vec2((ax - 0.021 * nw * ns) / (0.009 * ns), (vB.y - (uNoseY - 0.017 * ns)) / (0.005 * ns));
  float nos = 1.0 - smoothstep(0.5, 1.15, length(nq));
  col = mix(col, col * vec3(0.3, 0.2, 0.19), uNose.z * nos * front);
  // the soft shadow under the nose tip (illustrated noses read by it)
  col *= 1.0 - 0.18 * uNose.z * exp(-(pow(vB.x / (0.03 * nw), 2.0) + pow((vB.y - (uNoseY - 0.022)) / 0.008, 2.0))) * front;
  col += vec3(0.05, 0.035, 0.03) * exp(-(pow(vB.x / 0.012, 2.0) + pow((vB.y - uNoseY - 0.006) / 0.01, 2.0))) * front;
  // ---- lips: an upper and a fuller lower lip with a cupid's bow, shaded as volumes, a dark parting line
  float hw = 0.056 * uLip.x, lx = vB.x / hw, my = uMouthY + 0.025 * uLip2.x + 0.006 * uLip2.y * lx * lx * step(abs(lx), 1.2);
  float prof = pow(max(0.0, 1.0 - lx * lx), 0.55);
  float bow = 1.0 - uLip.w * 0.45 * exp(-pow(lx / 0.16, 2.0)) + uLip.w * 0.18 * exp(-pow((abs(lx) - 0.3) / 0.15, 2.0));
  float upH = 0.0115 * uLip.y * prof * bow * (1.0 + 0.25 * uLipFull), loH = 0.0155 * uLip.z * pow(max(0.0, 1.0 - lx * lx), 0.5) * (1.0 + 0.25 * uLipFull);
  float dy = vB.y - my;
  float inUp = hp_aa(dy - upH) * hp_aa(-dy), inLo = hp_aa(-dy - loH) * hp_aa(dy);
  float lipA = max(inUp, inLo) * front * step(abs(lx), 1.0) * (1.0 - uLip2.z);   // the line style draws no lip fill
  vec3 lipCol = uLipC * (0.88 + 0.12 * smoothstep(0.0, 1.0, 1.0 - abs(lx)));
  lipCol = mix(lipCol, lipCol * 0.82, inUp);                                                 // the upper lip in shade
  lipCol += vec3(0.07) * inLo * exp(-(pow(lx / 0.35, 2.0) + pow((dy + loH * 0.45) / (loH * 0.35 + 1e-4), 2.0)));   // lower-lip sheen
  col = mix(col, lipCol, lipA * smoothstep(1.0, 0.85, abs(lx)));
  float line = exp(-pow(dy / (0.0016 + 0.0009 * uLip2.z), 2.0)) * (1.0 - smoothstep(0.8, 1.05, abs(lx)));
  col = mix(col, mix(vec3(0.32, 0.14, 0.13), vec3(0.42, 0.24, 0.2), uLip2.z), (0.75 + 0.2 * uLip2.z) * line * front);
  // the lower-lip mark (illustrated faces): a short soft stroke under the mouth line
  float under = exp(-(pow(vB.x / (hw * 0.42), 6.0) + pow((dy + 0.017) / 0.0016, 2.0)));
  col = mix(col, col * vec3(0.72, 0.6, 0.56), uLip2.w * under * front);
  col *= 1.0 - 0.25 * exp(-(pow((abs(lx) - 1.02) / 0.06, 2.0) + pow(dy / 0.005, 2.0))) * front;   // soft mouth corners
  // ---- brows: a tapered stroke above each eye; soft edge, hair-stroke texture
  float bi = ex - 0.1 + 0.02 * uBrow2.y, bo = bi + 0.19 * uBrow2.x;
  float bu = clamp((ax - bi) / (bo - bi), 0.0, 1.0);
  float byc = ey + 0.066 + 0.02 * uBrow.x + 0.012 * uBrow.z * sin(3.14159 * pow(bu, 0.8)) - 0.018 * uBrow.w * (bu - 0.3);
  // a sculpted brow: a full rounded head inboard, the body arching, a clean tapered tail
  // family: BOLD brows
  float bt = 0.0135 * uBrow.y * mix(1.1, 0.45, pow(bu, 1.2));
  vec2 bp = vec2(ax - clamp(ax, bi, bo), vB.y - byc);
  float bd = length(vec2(bp.x * 1.6, bp.y)) - bt;
  float strokes = 1.0;
  col = mix(col, uBrowC, hp_aa(bd) * strokes * front * 0.97);
  // ---- facial hair: fine soft stipple, a thin moustache heavier at the corners, sparse on the chin
  vec2 cell = floor(vB.xy * 1150.0);
  float dots = step(0.55, hp_hash(cell)) * (1.0 - smoothstep(0.25, 0.5, length(fract(vB.xy * 1150.0) - 0.5)));
  float must = exp(-pow((dy - upH - 0.011 - 0.006 * lx * lx) / 0.0055, 2.0)) * (0.35 + 0.65 * smoothstep(0.25, 0.85, abs(lx))) * (1.0 - smoothstep(1.05, 1.35, abs(lx)));
  float chin = exp(-(pow(vB.x / 0.035, 2.0) + pow((dy + 0.055) / 0.025, 2.0)));
  float shadow = uStub.x * 0.18 * (must + chin * 0.8);
  col = mix(col, col * vec3(0.78, 0.74, 0.74), shadow * front);
  col = mix(col, uStubC, dots * (uStub.y * 0.55 * must + uStub.z * 0.45 * chin) * front);
  col *= mix(1.0, vAo, 0.85);
  // a height field for the painted features, read as relief by the normal below: brows raised, lips parted
  hpHeight = 0.0011 * hp_aa(bd) - 0.0006 * line - 0.0008 * nos;
  vec4 diffuseColor = vec4(col, opacity);`)
      .replace("void main() {", "float hpHeight = 0.0;\nvoid main() {")
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
  {
    vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
    vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
    float det = dot(sx, r1);
    vec3 grad = sign(det) * (dFdx(hpHeight) * r1 + dFdy(hpHeight) * r2);
    normal = normalize(abs(det) * normal - grad * 22.0);
  }`);
  };
  m.customProgramCacheKey = () => "humanbase-canonical-head";
  return m;
}

/** Stylised hair: a colour parameter, soft clump shading, a gentle light ring (the "halo" a sculpted chibi head of
 *  hair catches), no strands. */
export function hairMaterial(color: string): { material: THREE.MeshStandardMaterial; uniforms: { uHair: { value: THREE.Color } } } {
  const uniforms = { uHair: { value: new THREE.Color(color) } };
  // vertex colour carries the baked groove shading between the sculpted locks
  const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, side: THREE.DoubleSide, vertexColors: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = `uniform vec3 uHair;\n${shader.fragmentShader}`
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );", "vec4 diffuseColor = vec4( uHair, opacity );")
      .replace("#include <opaque_fragment>", `
  // the illustrated sheen: a soft band where the locks turn toward the light, brighter on the lock crowns (vColor),
  // gone in the grooves — so each sculpted lock reads as its own form even in black hair
  vec3 nV = normalize(normal);
  float band = smoothstep(0.15, 0.55, nV.y) * (1.0 - smoothstep(0.6, 0.95, nV.y));
  float rim = pow(1.0 - abs(nV.z), 3.0) * 0.35;
  float crown = smoothstep(0.7, 1.05, vColor.r);
  outgoingLight += (vec3(0.16, 0.16, 0.18) + uHair * 0.8) * (band * 0.8 + rim) * crown;
  #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => "humanbase-hair";
  return { material: m, uniforms };
}
