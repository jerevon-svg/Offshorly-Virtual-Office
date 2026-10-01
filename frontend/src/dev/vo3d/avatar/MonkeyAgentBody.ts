// vo3d avatar — ONE MONKEYAGENT BODY: the shared production base + one identity's appearance + one
// runtime record. DEV-ONLY today: constructed only by avatar/MonkeyAgentProof (the cast) behind
// `?monkeyagent=1`.
//
// THE BASE IS MonkeyAgent_Base_V1 (scripts/avatar-pipeline/monkey-agent/build-monkey-base.mjs): the
// established master technically rebuilt — LOD0/1/2 in ONE file sharing one skin, one texture and the
// clips, per-LOD face shells, fur/skin/dark masks + marking channels. It is parsed ONCE and every body is
// a SkeletonUtils clone (own skeleton, mixer and material instances; shared geometry), exactly what
// avatar/CastPrototypes does for employees.
//
// FOUR MODULAR SEAMS, each the one the production base keeps:
//   · GARMENTS — separate skinned GLBs on the SAME 24-joint skeleton, rebound by joint NAME to this
//     body's bones. Each declares the body regions it hides (`extras.monkeyGarment.hides`).
//   · BODY HIDING — the body's own `_region` vertex attribute against a 32-bit hide mask: hidden regions
//     are discarded, so nothing underneath a garment can poke through it, in any pose.
//   · SOCKETS — rigid accessories hang off contract sockets authored in BIND space; the bone-local
//     transform comes from the bone's inverse bind matrix, so attaching mid-animation is still exact.
//   · FACE — two thin Head-rigid shells over the sculpted eyes and the smile, drawn procedurally:
//     sclera, iris (identity colour), pupil, highlights, eyelids (blink + expression), look offset, and
//     an open-mouth shape for talking. No morph targets, no extra bones, works at any LOD.
//
// STATE IS NOT ANIMATION. `setExec()` takes the backend-reported execution state and DERIVES the clip
// and face from it (monkeyAgentContract.presentationFor). Nothing here produces or stores a state.
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DRACO_PATH } from "../adapters/v1Avatar";
import {
  MONKEY_AGENT_STANDING_HEIGHT, MONKEY_ALBEDO_REF, MONKEY_LOD_SCREEN_PX, MONKEY_NATIVE_HEIGHT, MONKEY_SOCKETS,
  MONKEY_SURFACE_LANDMARKS,
  presentationFor, regionMask,
  type AgentAssignment, type AgentExecState, type AgentPosture, type BodyRegion, type FaceExpression,
  type MonkeyIdentity, type SocketName,
} from "../world/monkeyAgentContract";

const BASE = `${import.meta.env.BASE_URL}avatars/monkey-agent-base-v1/`;
export const MONKEY_AGENT_BASE_URL = `${BASE}monkey-agent-base.glb`;
export const MONKEY_AGENT_MASKS_URL = `${BASE}masks.png`;
export const MONKEY_GARMENT_URLS: Readonly<Record<string, string>> = Object.fromEntries(
  ["tee", "longsleeve", "vest", "cap"].map((id) => [id, `${BASE}garments/${id}.glb`]));

let loader: GLTFLoader | null = null;
const loads = new Map<string, Promise<GLTF>>();
function loadOnce(url: string): Promise<GLTF> {
  if (!loader) { const d = new DRACOLoader(); d.setDecoderPath(DRACO_PATH); loader = new GLTFLoader(); loader.setDRACOLoader(d); }
  let p = loads.get(url);
  if (!p) { p = loader.loadAsync(url); loads.set(url, p); p.catch(() => loads.delete(url)); }
  return p;
}
let masks: Promise<THREE.Texture> | null = null;
function loadMasks(): Promise<THREE.Texture> {
  masks ??= new THREE.TextureLoader().loadAsync(MONKEY_AGENT_MASKS_URL).then((t) => {
    t.flipY = false; t.colorSpace = THREE.NoColorSpace; return t;
  });
  return masks;
}

// ---- the body material: region hiding + fur/skin recolouring + markings ------------------------------------
type BodyUniforms = {
  uHideMask: { value: number }; uMasks: { value: THREE.Texture | null };
  uFurTint: { value: THREE.Vector4 }; uSkinTint: { value: THREE.Vector4 };
  uCrown: { value: THREE.Vector4 }; uMuzzle: { value: THREE.Vector4 };
};
const LUMA = "vec3(0.2126, 0.7152, 0.0722)";
/** RECOLOUR KEEPS THE PAINTING: a tinted region takes the identity colour scaled by the albedo's own
 *  luminance relative to the reference colour, so every painted stroke and shade survives; w = 0 (no
 *  tint) leaves the master's albedo exactly as it is. */
function bodyMaterial(mat: THREE.MeshStandardMaterial, u: BodyUniforms): THREE.MeshStandardMaterial {
  const furRef = new THREE.Color(MONKEY_ALBEDO_REF.fur), skinRef = new THREE.Color(MONKEY_ALBEDO_REF.skin);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, { uFurRef: { value: furRef }, uSkinRef: { value: skinRef } });
    shader.vertexShader = `attribute float _region;\nattribute vec3 _marks;\nuniform int uHideMask;\nvarying float vHide;\nvarying vec3 vMarks;\n${shader.vertexShader}`
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vHide = float((uHideMask >> int(_region + 0.5)) & 1);\n  vMarks = _marks;");
    shader.fragmentShader = `varying float vHide;\nvarying vec3 vMarks;\nuniform sampler2D uMasks;\nuniform vec4 uFurTint; uniform vec4 uSkinTint; uniform vec4 uCrown; uniform vec4 uMuzzle;\nuniform vec3 uFurRef; uniform vec3 uSkinRef;\n${shader.fragmentShader}`
      .replace("#include <clipping_planes_fragment>", "if (vHide > 0.5) discard;\n#include <clipping_planes_fragment>")
      .replace("#include <map_fragment>", `#include <map_fragment>
      {
        vec3 m = texture2D(uMasks, vMapUv).rgb;
        vec3 c = diffuseColor.rgb;
        float l = dot(c, ${LUMA});
        vec3 fur = mix(c, uFurTint.rgb * (l / max(dot(uFurRef, ${LUMA}), 1e-4)), uFurTint.a);
        fur = mix(fur, uCrown.rgb * (l / max(dot(uFurRef, ${LUMA}), 1e-4)), uCrown.a * vMarks.x);
        vec3 skin = mix(c, uSkinTint.rgb * (l / max(dot(uSkinRef, ${LUMA}), 1e-4)), uSkinTint.a);
        skin = mix(skin, uMuzzle.rgb * (l / max(dot(uSkinRef, ${LUMA}), 1e-4)), uMuzzle.a * vMarks.y);
        vec3 tinted = c * clamp(1.0 - m.r - m.g, 0.0, 1.0) + fur * m.r + skin * m.g;
        diffuseColor.rgb = mix(tinted, c, vMarks.z); // painted face details keep the master's own colour
      }`);
  };
  mat.customProgramCacheKey = () => "monkey-agent-body";
  return mat;
}

// ---- garment look ---------------------------------------------------------------------------------------
/** A garment's colours: main panel + a trim band along its cut lines, chosen per fragment from the baked
 *  cut terms (`_COVER`, one per cut line, each <= 0 inside and 0 on its hem/cuff/collar). */
type GarmentLook = { main: string; trim: string; trimCover: number; panel?: string; panelFrom?: number };
/** `panel`: a second colour on the sleeve side of `panelFrom` (on the sleeve term) — a vest over a shirt. */
function garmentMaterial(look: GarmentLook): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const u = {
    uMain: { value: new THREE.Color(look.main) }, uTrim: { value: new THREE.Color(look.trim) }, uTrimCover: { value: look.trimCover },
    uPanel: { value: new THREE.Color(look.panel ?? look.main) }, uPanelFrom: { value: look.panelFrom ?? 1 },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = `attribute vec3 _cover;\nvarying vec3 vCover;\n${shader.vertexShader}`
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vCover = _cover;");
    shader.fragmentShader = `uniform vec3 uMain; uniform vec3 uTrim; uniform float uTrimCover; uniform vec3 uPanel; uniform float uPanelFrom;\nvarying vec3 vCover;\n${shader.fragmentShader}`
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );",
        "vec4 diffuseColor = vec4(max(vCover.x, max(vCover.y, vCover.z)) > uTrimCover ? uTrim : (vCover.y > uPanelFrom ? uPanel : uMain), opacity);");
  };
  m.customProgramCacheKey = () => "monkey-agent-garment";
  return m;
}

// ---- the face ------------------------------------------------------------------------------------------
type FaceUniforms = {
  uLook: { value: THREE.Vector2 }; uLidTop: { value: number }; uLidBot: { value: number };
  uIris: { value: THREE.Color }; uSkin: { value: THREE.Color }; uPupil: { value: number };
  uOpen: { value: number }; uWide: { value: number };
};
const EYE_FRAG = /* glsl */ `
  vec2 p = vFaceUv; float r = length(p);
  if (r > 1.02) discard;
  float topEdge = uLidTop - 0.16 * p.x * p.x, botEdge = uLidBot + (uLidBot > -0.9 ? -0.3 : 0.1) * p.x * p.x;
  vec3 col;
  if (p.y > topEdge || p.y < botEdge) {
    col = uSkin;
    if (p.y > topEdge && p.y < topEdge + 0.11 && uLidTop < 0.97) col = vec3(0.07, 0.045, 0.035);
  } else if (r > 0.9 - 0.07 * max(p.y, 0.0)) {
    col = vec3(0.05, 0.032, 0.025);
  } else {
    vec2 ic = vec2(-vSide * 0.28, -0.02) + uLook * vec2(0.36, 0.26);
    float d = length(p - ic);
    col = mix(vec3(0.93, 0.89, 0.80), vec3(0.62, 0.60, 0.58), smoothstep(0.55, 0.9, r));
    if (d < 0.66) {
      vec3 iris = mix(uIris * 0.45, uIris, smoothstep(0.66, 0.2, d)) * (1.0 - 0.35 * smoothstep(-0.2, 0.6, p.y - ic.y));
      col = d > 0.6 ? uIris * 0.25 : iris;
      if (d < uPupil) col = vec3(0.015);
    }
    if (length(p - ic - vec2(-0.2, 0.24)) < 0.14) col = vec3(1.0);
    if (length(p - ic - vec2(0.2, -0.22)) < 0.06) col = vec3(0.95);
  }
  vec4 diffuseColor = vec4(col, opacity);
`;
const MOUTH_FRAG = /* glsl */ `
  vec2 p = vFaceUv;
  if (uOpen < 0.02) discard;
  float ry = 0.1 + 0.5 * uOpen, rx = 0.46 * uWide;
  vec2 c = vec2(0.0, 0.2 - ry * 0.9);
  vec2 q = (p - c) / vec2(rx, ry);
  float e = length(q);
  if (e > 1.0) discard;
  vec3 col = e > 0.84 ? vec3(0.2, 0.08, 0.06) : vec3(0.1, 0.02, 0.03);
  if (q.y < -0.45 && e <= 0.84) col = vec3(0.75, 0.3, 0.33);
  vec4 diffuseColor = vec4(col, opacity);
`;

function faceMaterial(u: FaceUniforms, frag: string, key: string, eye: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: eye ? 0.38 : 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = `${eye ? "attribute float _side;\n" : ""}varying vec2 vFaceUv;\nvarying float vSide;\n${shader.vertexShader}`
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n  vFaceUv = uv;\n  vSide = ${eye ? "_side" : "0.0"};`);
    shader.fragmentShader = `uniform vec2 uLook; uniform float uLidTop; uniform float uLidBot; uniform vec3 uIris; uniform vec3 uSkin;
      uniform float uPupil; uniform float uOpen; uniform float uWide;\nvarying vec2 vFaceUv;\nvarying float vSide;\n${shader.fragmentShader}`
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );", frag);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

/** eyelid positions (eye-local, +1 = top of the eye) per expression: [top, bottom, pupil radius] */
const EXPRESSION_LIDS: Readonly<Record<FaceExpression, readonly [number, number, number]>> = {
  neutral: [1.1, -1.1, 0.4],
  focused: [0.42, -1.1, 0.36],
  happy: [1.1, -0.38, 0.42],
  surprised: [1.2, -1.2, 0.3],
  sleepy: [0.12, -1.1, 0.4],
};

// ---- rigid accessories (merged: ONE draw each) ------------------------------------------------------------
/** Built in BIND space around a socket, every part vertex-coloured and merged into one geometry. Demo
 *  geometry — production accessories arrive as GLBs through the same socket path. */
function merged(parts: [THREE.BufferGeometry, number][], name: string): THREE.Group {
  const geos = parts.map(([g, color]) => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute("uv");
    const c = new THREE.Color(color), n = ng.getAttribute("position").count, col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) col.set([c.r, c.g, c.b], k * 3);
    ng.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return ng;
  });
  const g = new THREE.Group(); g.name = name;
  g.add(new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 })));
  return g;
}
const at = (g: THREE.BufferGeometry, [sx, sy, sz]: readonly [number, number, number], x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x - sx, y - sy, z - sz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
const tube = (pts: number[][], s: readonly [number, number, number], r: number) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x - s[0], y - s[1], z - s[2]))), 32, r, 8);

/** HEADSET on `ears`: band over the crown (the tuft rises through it), cups on the ears, a mic boom. */
function buildHeadset(accent: number): THREE.Group {
  const s = MONKEY_SOCKETS.ears.position, DARK = 0x2a2f38, PAD = 0x1b1d22;
  const band: number[][] = []; for (let k = 0; k <= 24; k++) { const t = (k / 24) * Math.PI; band.push([0.63 * Math.cos(t), 1.12 + 0.37 * Math.sin(t), -0.03]); }
  const parts: [THREE.BufferGeometry, number][] = [[tube(band, s, 0.03), DARK]];
  for (const side of [-1, 1]) {
    parts.push([at(new THREE.CylinderGeometry(0.19, 0.19, 0.09, 32), s, side * 0.715, 1.075, -0.03, 0, 0, Math.PI / 2), accent]);
    parts.push([at(new THREE.TorusGeometry(0.17, 0.035, 10, 32), s, side * 0.665, 1.075, -0.03, 0, Math.PI / 2, 0), PAD]);
  }
  parts.push([tube([[0.72, 1.0, 0.06], [0.6, 0.9, 0.3], [0.32, 0.88, 0.43], [0.15, 0.93, 0.45]], s, 0.014), DARK]);
  parts.push([at(new THREE.SphereGeometry(0.035, 14, 10), s, 0.15, 0.93, 0.45), PAD]);
  return merged(parts, "accessory-headset");
}
/** GLASSES on `face`: round rims around the sculpted eyes (no lens: the drawn eyes read through), a
 *  bridge over the nose, temples back to the ears. */
function buildGlasses(accent: number): THREE.Group {
  const s = MONKEY_SOCKETS.face.position, e = MONKEY_SURFACE_LANDMARKS.eye;
  const parts: [THREE.BufferGeometry, number][] = [];
  for (const side of [-1, 1]) {
    parts.push([at(new THREE.TorusGeometry(0.125, 0.014, 10, 40), s, side * e.cx, e.cy, 0.39), accent]);
    parts.push([tube([[side * 0.305, e.cy + 0.02, 0.37], [side * 0.4, e.cy + 0.02, 0.25], [side * 0.45, e.cy, 0.02]], s, 0.011), accent]);
  }
  parts.push([tube([[-0.058, e.cy + 0.03, 0.4], [0, e.cy + 0.05, 0.42], [0.058, e.cy + 0.03, 0.4]], s, 0.012), accent]);
  return merged(parts, "accessory-glasses");
}
export const MONKEY_ACCESSORY_BUILDERS: Readonly<Record<string, (accent: number) => THREE.Group>> = { headset: buildHeadset, glasses: buildGlasses };

// ---- the body ------------------------------------------------------------------------------------------
export type MonkeyAgentBodyStats = { triangles: number; draws: number; lod: number; garments: string[]; accessories: string[]; clip: string; overlay: string; hideMask: number };

export class MonkeyAgentBody {
  readonly root = new THREE.Group();
  private scene: THREE.Object3D | null = null;
  private body: THREE.SkinnedMesh | null = null;
  private bones = new Map<string, THREE.Bone>();
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current: string | null = null;
  private hideMask = { value: 0 };
  private bodyU: BodyUniforms = {
    uHideMask: this.hideMask, uMasks: { value: null },
    uFurTint: { value: new THREE.Vector4() }, uSkinTint: { value: new THREE.Vector4() },
    uCrown: { value: new THREE.Vector4() }, uMuzzle: { value: new THREE.Vector4() },
  };
  /** per LOD: the body mesh plus that LOD's face shells (LOD2 has none) */
  private lods: THREE.Mesh[][] = [];
  private lod = -1;
  /** dev verification only: force a LOD (null = by on-screen size) */
  lodOverride: number | null = null;
  private overlay: "typing" | "reviewing" | null = null;
  private overlayT = 0;
  /** the floating work screen, on the `screen` socket; visible only under a work layer */
  private screen: THREE.Mesh | null = null;
  /** where the body faces when nothing asks otherwise (its slot) and what it is turning toward now */
  homeYaw = 0;
  private faceAt: THREE.Vector3 | null = null;
  /** PER-IDENTITY IDLE VARIATION: a fixed phase into the idle and a slight tempo, so three idle agents
   *  never breathe in lockstep. Derived from the identity id, so it is the same every run. */
  private readonly idlePhase: number;
  private readonly idleTempo: number;
  private garments = new Map<string, { mesh: THREE.SkinnedMesh; hides: BodyRegion[] }>();
  private accessories = new Map<string, THREE.Object3D>();
  private owned: THREE.Material[] = [];
  private face: FaceUniforms = {
    uLook: { value: new THREE.Vector2() }, uLidTop: { value: 1.1 }, uLidBot: { value: -1.1 },
    uIris: { value: new THREE.Color() }, uSkin: { value: new THREE.Color(0xf9d6bb) }, uPupil: { value: 0.4 },
    uOpen: { value: 0 }, uWide: { value: 1 },
  };
  private expression: FaceExpression = "neutral";
  private blinkIn = 2 + Math.random() * 3;
  private blinkT = -1;
  private speakT = 0;
  /** dev verification only — never derived from, never reported as state */
  private clipOverride: string | null = null;
  speaking = false;
  lookTarget: THREE.Vector3 | null = null;
  exec: AgentExecState = "idle";
  posture: AgentPosture = "standing";
  assignment: AgentAssignment | null = null;

  readonly identity: MonkeyIdentity;

  constructor(identity: MonkeyIdentity) {
    this.identity = identity;
    let h = 2166136261; for (const ch of identity.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    this.idlePhase = ((h >>> 0) % 1000) / 1000;
    this.idleTempo = 0.9 + (((h >>> 10) % 1000) / 1000) * 0.2;
    this.root.name = `monkey-agent-${identity.id}`;
  }

  async load(): Promise<void> {
    const [gltf, maskTex] = await Promise.all([loadOnce(MONKEY_AGENT_BASE_URL), loadMasks()]);
    const scene = cloneSkinned(gltf.scene);
    // LOCKED SCALE: the contract height over the contract native height — never re-measured per body.
    scene.scale.setScalar(MONKEY_AGENT_STANDING_HEIGHT / MONKEY_NATIVE_HEIGHT);
    this.bodyU.uMasks.value = maskTex;
    let bodyMat: THREE.MeshStandardMaterial | null = null;
    const faceMats = new Map<string, THREE.Material>();
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
      const hit = /^(body|face_eyes|face_mouth)_lod(\d)$/.exec(m.name);
      if (!hit) return;
      const lod = Number(hit[2]);
      (this.lods[lod] ??= []).push(m);
      if (hit[1] === "body") {
        // ONE body material per agent, shared by its three LODs (one program, one set of identity uniforms)
        if (!bodyMat) { bodyMat = bodyMaterial((m.material as THREE.MeshStandardMaterial).clone(), this.bodyU); if (bodyMat.map) bodyMat.map.anisotropy = 8; this.owned.push(bodyMat); }
        m.material = bodyMat;
        if (lod === 0) this.body = m;
      } else {
        const eye = hit[1] === "face_eyes";
        let fm = faceMats.get(hit[1]);
        if (!fm) { fm = faceMaterial(this.face, eye ? EYE_FRAG : MOUTH_FRAG, eye ? "monkey-face-eyes" : "monkey-face-mouth", eye); faceMats.set(hit[1], fm); this.owned.push(fm); }
        m.material = fm;
      }
    });
    if (!this.body) throw new Error("monkey agent base has no body_lod0 mesh");
    const look = this.identity.look;
    const tint = (v: THREE.Vector4, hex: number | undefined) => { if (hex === undefined) v.set(0, 0, 0, 0); else { const c = new THREE.Color(hex); v.set(c.r, c.g, c.b, 1); } };
    tint(this.bodyU.uFurTint.value, look.fur); tint(this.bodyU.uSkinTint.value, look.face);
    tint(this.bodyU.uCrown.value, look.marks?.crown); tint(this.bodyU.uMuzzle.value, look.marks?.muzzle);
    this.face.uIris.value.setHex(look.iris);
    // the eyelids are drawn in the face-plate colour: the identity's own, or the albedo reference
    this.face.uSkin.value.setHex(look.face ?? MONKEY_ALBEDO_REF.skin);
    this.scene = scene;
    this.root.add(scene);
    this.setLod(0);
    this.mixer = new THREE.AnimationMixer(scene);
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    for (const g of look.garments) await this.wear(g);
    for (const a of look.accessories) this.attach(a.item, a.socket);
    this.screen = this.buildScreen();
    this.applyPresentation(0);
  }

  /** The work screen: one textured quad on the `screen` socket, shared texture, Lab-blue or review-amber. */
  private buildScreen(): THREE.Mesh | null {
    if (!this.body) return null;
    const mat = new THREE.MeshBasicMaterial({ map: screenTexture(), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    this.owned.push(mat);
    const m = new THREE.Mesh(SCREEN_GEO, mat);
    m.name = "work-screen"; m.frustumCulled = false; m.visible = false; m.renderOrder = 2;
    const holder = new THREE.Group();
    holder.add(m);
    const def = MONKEY_SOCKETS.screen;
    const bone = this.bones.get(def.bone), i = this.body.skeleton.bones.findIndex((b) => b.name === def.bone);
    if (!bone || i < 0) return null;
    const sock = new THREE.Matrix4().compose(new THREE.Vector3(...def.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...def.rotation)), new THREE.Vector3(1, 1, 1));
    this.body.skeleton.boneInverses[i].clone().multiply(this.body.bindMatrix).multiply(sock).decompose(holder.position, holder.quaternion, holder.scale);
    bone.add(holder);
    return m;
  }

  /** PRESENTATION: turn toward a world point (the current speaker, a work spot); null = back to the slot. */
  faceToward(point: THREE.Vector3 | null): void {
    this.faceAt = point ? (this.faceAt ?? new THREE.Vector3()).copy(point) : null;
  }

  private setLod(n: number): void {
    if (n === this.lod) return;
    this.lod = n;
    this.lods.forEach((meshes, k) => { for (const m of meshes) m.visible = k === n; });
  }

  /** LOD by the body's ON-SCREEN height — the same rule for the orthographic and the perspective camera */
  private chooseLod(camera: THREE.Camera, viewportH: number): number {
    if (this.lodOverride !== null) return this.lodOverride;
    const world = TMP_V.setFromMatrixPosition(this.root.matrixWorld);
    let pxPerUnit: number;
    const c = camera as THREE.PerspectiveCamera & THREE.OrthographicCamera;
    if (c.isOrthographicCamera) pxPerUnit = (viewportH * c.zoom) / (c.top - c.bottom);
    else pxPerUnit = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2) * Math.max(1e-3, world.distanceTo(c.position)));
    const px = pxPerUnit * MONKEY_AGENT_STANDING_HEIGHT;
    return px > MONKEY_LOD_SCREEN_PX.lod0Above ? 0 : px > MONKEY_LOD_SCREEN_PX.lod1Above ? 1 : 2;
  }

  get loaded(): boolean { return this.body !== null; }
  get clipNames(): string[] { return Object.keys(this.actions); }

  /** THE LOCOMOTION SEAM (avatar/MonkeyLocomotion). When set, it runs every frame AFTER the mixer and the work
   *  overlays have posed the bones, and it owns the root's placement: the body's own slot-turning is skipped.
   *  `null` hands the body back exactly as it was. */
  driver: ((dt: number) => void) | null = null;
  /** What a driver needs to pose this body: the scaled model root (the model frame), the contract bones by
   *  name, and the skin's skeleton (its bind pose). Null until loaded. */
  rigHandles(): { model: THREE.Object3D; bones: ReadonlyMap<string, THREE.Bone>; skeleton: THREE.Skeleton } | null {
    return this.body && this.scene ? { model: this.scene, bones: this.bones, skeleton: this.body.skeleton } : null;
  }
  /** the floating work-screen quad is off wherever a real workstation carries the screen */
  workScreenEnabled = true;

  // ---- state in, presentation out --------------------------------------------------------------------
  /** The backend-reported execution state (+ assignment). The ONLY input that changes what the body does. */
  setExec(exec: AgentExecState, assignment: AgentAssignment | null = this.assignment): void {
    this.exec = exec; this.assignment = assignment;
    this.applyPresentation();
  }
  setPosture(p: AgentPosture): void { this.posture = p; this.applyPresentation(); }
  /** DEV ONLY: force a clip for visual verification; null returns to the state-derived clip. */
  setClipOverride(name: string | null): void { this.clipOverride = name; this.applyPresentation(); }
  setExpression(e: FaceExpression): void { this.expression = e; }

  private applyPresentation(fade = 0.3): void {
    const p = presentationFor(this.exec, this.posture);
    this.expression = p.face;
    this.overlay = this.clipOverride ? null : p.overlay ?? null;
    this.play(this.clipOverride ?? p.clip, fade);
  }

  // ---- the procedural WORK layer (free, P2 decision): typing, on top of whatever clip is playing --------
  /** Rotate a bone by `angle` about a MODEL-frame axis (the body's own +x left / +y up / +z face), after the
   *  mixer has posed it; children follow. */
  private turn(name: string, axis: THREE.Vector3, angle: number): void {
    const bone = this.bones.get(name);
    if (!bone || !bone.parent || !this.scene) return;
    const rootQ = this.scene.getWorldQuaternion(TMP_Q1);
    const qWorld = TMP_Q2.setFromAxisAngle(axis, angle).premultiply(rootQ).multiply(TMP_Q3.copy(rootQ).invert());
    const boneW = bone.getWorldQuaternion(TMP_Q3);
    const parentW = bone.parent.getWorldQuaternion(TMP_Q4);
    bone.quaternion.copy(parentW.invert().multiply(qWorld.multiply(boneW)));
    bone.updateMatrixWorld(true);
  }
  /** REVIEWING: reading the work screen — arms half-raised, the right hand scrolling, the head scanning. */
  private applyReviewing(dt: number): void {
    this.overlayT += dt;
    const t = this.overlayT;
    this.scene!.updateMatrixWorld(true);
    for (const [side, s] of [["Left", 1], ["Right", -1]] as const) {
      this.turn(`${side}Arm`, AX_X, -0.7);
      this.turn(`${side}Arm`, AX_Y, -s * 0.38);
      this.turn(`${side}ForeArm`, AX_X, side === "Right" ? -0.75 - 0.18 * Math.max(0, Math.sin(t * 1.6)) : -0.45);
    }
    this.turn("RightHand", AX_X, 0.25 * Math.sin(t * 1.6));
    this.turn("Head", AX_Y, 0.16 * Math.sin(t * 0.7));
    this.turn("Head", AX_X, 0.2);
  }

  private applyTyping(dt: number): void {
    this.overlayT += dt;
    const t = this.overlayT;
    this.scene!.updateMatrixWorld(true);
    for (const [side, s] of [["Left", 1], ["Right", -1]] as const) {
      this.turn(`${side}Arm`, AX_X, -0.95);                    // upper arms forward
      this.turn(`${side}Arm`, AX_Y, -s * 0.42);                // ...and in, in front of the belly
      this.turn(`${side}ForeArm`, AX_X, -0.55);                // elbows bent, hands over the keys
      this.turn(`${side}Hand`, AX_X, 0.16 * Math.sin(t * 13 + (s > 0 ? 0 : 1.9)) * Math.max(0, Math.sin(t * 2.1 + s)));
    }
    this.turn("Head", AX_X, 0.16 + 0.03 * Math.sin(t * 0.9));  // eyes on the work
  }

  private play(name: string, fade: number): void {
    if (this.current === name) return;
    const next = this.actions[name];
    if (!next) return;
    const prev = this.current ? this.actions[this.current] : null;
    next.reset().setEffectiveWeight(1).play();
    if (name === "idle-9") { next.time = this.idlePhase * next.getClip().duration; next.timeScale = this.idleTempo; }
    else next.timeScale = 1;
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
    else prev?.stop();
    this.current = name;
  }

  // ---- garments ----------------------------------------------------------------------------------------
  async wear(id: string): Promise<boolean> {
    if (!this.body || this.garments.has(id)) return !!this.body;
    const url = MONKEY_GARMENT_URLS[id];
    if (!url) return false;
    const gltf = await loadOnce(url);
    let src: THREE.SkinnedMesh | null = null;
    gltf.scene.traverse((o) => { if (!src && (o as THREE.SkinnedMesh).isSkinnedMesh) src = o as THREE.SkinnedMesh; });
    if (!src) return false;
    const s = src as THREE.SkinnedMesh;
    // REBIND BY JOINT NAME onto THIS body's bones — the garment's own skeleton is never animated.
    const bones = s.skeleton.bones.map((b) => this.bones.get(b.name));
    if (bones.some((b) => !b)) { console.warn(`[vo3d] garment ${id}: skeleton does not match the contract`); return false; }
    const meta = (s.userData.monkeyGarment ?? s.parent?.userData.monkeyGarment) as { hides?: BodyRegion[]; look?: GarmentLook } | undefined;
    const mat = meta?.look ? garmentMaterial(meta.look) : (s.material as THREE.Material).clone();
    this.owned.push(mat);
    const mesh = new THREE.SkinnedMesh(s.geometry, mat);
    mesh.name = `garment-${id}`;
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
    this.body.parent!.add(mesh);
    mesh.position.copy(this.body.position); mesh.quaternion.copy(this.body.quaternion); mesh.scale.copy(this.body.scale);
    mesh.bind(new THREE.Skeleton(bones as THREE.Bone[], s.skeleton.boneInverses), this.body.bindMatrix);
    const hides = meta?.hides ?? [];
    this.garments.set(id, { mesh, hides });
    this.updateHideMask();
    return true;
  }

  takeOff(id: string): void {
    const g = this.garments.get(id);
    if (!g) return;
    g.mesh.removeFromParent();
    this.garments.delete(id);
    this.updateHideMask();
  }

  private updateHideMask(): void {
    this.hideMask.value = regionMask([...this.garments.values()].flatMap((g) => g.hides)) | 0;
  }

  // ---- sockets -----------------------------------------------------------------------------------------
  attach(item: string, socket: SocketName): boolean {
    if (!this.body || this.accessories.has(item)) return false;
    const build = MONKEY_ACCESSORY_BUILDERS[item];
    if (!build) return false;
    const obj = build(this.identity.look.accent ?? 0xf2b134);
    obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; m.frustumCulled = false; this.owned.push(m.material as THREE.Material); } });
    const def = MONKEY_SOCKETS[socket];
    const bone = this.bones.get(def.bone);
    const i = this.body.skeleton.bones.findIndex((b) => b.name === def.bone);
    if (!bone || i < 0) return false;
    // bone-local = boneInverse · bindMatrix · socket(bind space)
    const sock = new THREE.Matrix4().compose(
      new THREE.Vector3(...def.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...def.rotation)), new THREE.Vector3(1, 1, 1));
    const local = this.body.skeleton.boneInverses[i].clone().multiply(this.body.bindMatrix).multiply(sock);
    local.decompose(obj.position, obj.quaternion, obj.scale);
    bone.add(obj);
    this.accessories.set(item, obj);
    return true;
  }

  detach(item: string): void {
    this.accessories.get(item)?.removeFromParent();
    this.accessories.delete(item);
  }

  // ---- frame -------------------------------------------------------------------------------------------
  private headMatrix(out: THREE.Matrix4): THREE.Matrix4 | null {
    if (!this.body) return null;
    const i = this.body.skeleton.bones.findIndex((b) => b.name === "Head");
    const head = this.body.skeleton.bones[i];
    return out.copy(head.matrixWorld).multiply(this.body.skeleton.boneInverses[i]).multiply(this.body.bindMatrix);
  }

  /** world position of a BIND-space point carried rigidly by the head (pill anchor, look-at) */
  headPoint(bind: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null {
    const m = this.headMatrix(TMP_M);
    return m ? out.copy(bind).applyMatrix4(m) : null;
  }

  update(dt: number, camera: THREE.Camera | null = null, viewportH = 900): void {
    if (!this.mixer || !this.root.visible) return;
    if (camera) this.setLod(this.chooseLod(camera, viewportH));
    else if (this.lodOverride !== null) this.setLod(this.lodOverride);
    this.mixer.update(dt);
    if (this.overlay === "typing") this.applyTyping(dt);
    else if (this.overlay === "reviewing") this.applyReviewing(dt);
    if (this.screen) {
      this.screen.visible = this.overlay !== null && this.workScreenEnabled;
      (this.screen.material as THREE.MeshBasicMaterial).color.setHex(this.overlay === "reviewing" ? 0xffd28a : 0x9cc8ff);
    }
    if (this.driver) this.driver(dt);
    else {
      // TURNING: toward what it was asked to face, else home — eased, shortest way round
      const wantYaw = this.faceAt ? Math.atan2(this.faceAt.x - this.root.position.x, this.faceAt.z - this.root.position.z) : this.homeYaw;
      let d = wantYaw - this.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.root.rotation.y += d * Math.min(1, dt * 4);
    }
    const [top0, bot0, pupil] = EXPRESSION_LIDS[this.expression];
    // BLINK — a short close/open every few seconds, with jitter
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const t = this.blinkT / 0.16;
      blink = t < 0.5 ? t * 2 : Math.max(0, 2 - t * 2);
      if (t >= 1) { this.blinkT = -1; this.blinkIn = 1.8 + Math.random() * 4; }
    } else if ((this.blinkIn -= dt) <= 0) this.blinkT = 0;
    const f = this.face;
    f.uLidTop.value = top0 + (-0.32 - top0) * blink;
    f.uLidBot.value = bot0 + (-0.36 - bot0) * blink * 0.6;
    f.uPupil.value += (pupil - f.uPupil.value) * Math.min(1, dt * 8);
    // LOOK — toward the target, in the head's own bind frame
    const want = TMP_V2.set(0, 0);
    if (this.lookTarget && this.headMatrix(TMP_M)) {
      const local = TMP_V.copy(this.lookTarget).applyMatrix4(TMP_M.invert());
      const e = MONKEY_SURFACE_LANDMARKS.eye;
      const dx = local.x, dy = local.y - e.cy, dz = local.z - e.frontZ;
      if (dz > 0.05) want.set(THREE.MathUtils.clamp((dx / dz) * 1.6, -1, 1), THREE.MathUtils.clamp((dy / dz) * 1.6, -1, 1));
    }
    f.uLook.value.lerp(want, Math.min(1, dt * 6));
    // TALKING — a syllable-like open/close while `speaking` (driven later by real chat/speech events)
    this.speakT += dt;
    const target = this.speaking ? 0.25 + 0.55 * Math.abs(Math.sin(this.speakT * 9.5) * Math.sin(this.speakT * 3.7 + 1.3)) : 0;
    f.uOpen.value += (target - f.uOpen.value) * Math.min(1, dt * 18);
  }

  stats(): MonkeyAgentBodyStats {
    let triangles = 0, draws = 0;
    this.root.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const idx = m.geometry.getIndex();
      triangles += (idx ? idx.count : m.geometry.getAttribute("position").count) / 3;
      draws++;
    });
    return {
      triangles: Math.round(triangles), draws, lod: this.lod, garments: [...this.garments.keys()], accessories: [...this.accessories.keys()],
      clip: this.current ?? "-", overlay: this.overlay ?? "-", hideMask: this.hideMask.value,
    };
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    for (const g of this.garments.values()) g.mesh.removeFromParent();
    for (const a of this.accessories.values()) a.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    for (const m of this.owned) m.dispose();
    this.scene?.removeFromParent();
    this.garments.clear(); this.accessories.clear(); this.owned = [];
    this.body = null; this.scene = null; this.mixer = null; this.actions = {}; this.current = null;
  }
}
const TMP_M = new THREE.Matrix4();
const TMP_V = new THREE.Vector3();
const TMP_V2 = new THREE.Vector2();
const TMP_Q1 = new THREE.Quaternion(), TMP_Q2 = new THREE.Quaternion(), TMP_Q3 = new THREE.Quaternion(), TMP_Q4 = new THREE.Quaternion();
const AX_X = new THREE.Vector3(1, 0, 0), AX_Y = new THREE.Vector3(0, 1, 0);
const SCREEN_GEO = new THREE.PlaneGeometry(0.5, 0.32);
let screenTex: THREE.CanvasTexture | null = null;
/** a generic, abstract work UI (panels and lines) — no real content, white so the material tints it */
function screenTexture(): THREE.CanvasTexture {
  if (screenTex) return screenTex;
  const c = document.createElement("canvas"); c.width = 256; c.height = 164;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(255,255,255,0.28)"; g.beginPath(); g.roundRect(4, 4, 248, 156, 16); g.fill();
  g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 5; g.beginPath(); g.roundRect(4, 4, 248, 156, 16); g.stroke();
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.fillRect(22, 22, 90, 12); g.fillRect(22, 46, 210, 7); g.fillRect(22, 62, 180, 7); g.fillRect(22, 78, 196, 7);
  g.fillRect(22, 104, 96, 38); g.fillRect(130, 104, 102, 38);
  screenTex = new THREE.CanvasTexture(c); screenTex.colorSpace = THREE.SRGBColorSpace;
  return screenTex;
}
