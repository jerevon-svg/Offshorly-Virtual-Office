// vo3d build — THE EXTERIOR'S SURFACE DETAIL, as shader patches on its OWN materials (build/exterior never
// touches render/Materials' shared cache, and neither does this).
//
// Every patch is an onBeforeCompile on an ordinary MeshStandardMaterial, so tint (night), wetness (rain:
// roughness + environment response) and lighting all keep working exactly as before — the patch only adds
// what a flat colour cannot say: mown stripes and dry patches in a lawn, the joints between paving slabs,
// aggregate in asphalt, mulch in a bed, and a lake that moves. No textures, no new draw calls; a handful of
// ALU per pixel, and every high-frequency pattern fades out with its own screen-space derivative so the
// distance never shimmers.
import * as THREE from "three";

// shared GLSL: a cheap value noise and hash, plus the world position varying every patch reads
const NOISE = /* glsl */ `
  varying vec3 vExtW;
  float exHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float exNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(exHash(i), exHash(i + vec2(1.0, 0.0)), u.x), mix(exHash(i + vec2(0.0, 1.0)), exHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // a JOINT GRID's darkening at this pixel: cells of \`size\`, lines \`width\` world units wide, faded out
  // where the grid gets finer than the pixels drawing it
  float exJoint(vec2 xz, vec2 size, float width) {
    vec2 g = xz / size, f = fract(g);
    vec2 d = min(f, 1.0 - f) * size;
    float line = 1.0 - smoothstep(0.0, width, min(d.x, d.y));
    vec2 fw = fwidth(g);
    return line * (1.0 - smoothstep(0.08, 0.3, max(fw.x, fw.y)));
  }
`;
const WORLD_POS_VERT = /* glsl */ `
  #include <begin_vertex>
  {
    vec4 exW = vec4(transformed, 1.0);
    #ifdef USE_BATCHING
      exW = batchingMatrix * exW;
    #endif
    #ifdef USE_INSTANCING
      exW = instanceMatrix * exW;
    #endif
    vExtW = (modelMatrix * exW).xyz;
  }
`;

export type GroundFinish = "lawn" | "lawn-mown" | "terrain" | "paving" | "paving-warm" | "asphalt" | "kerb" | "soil" | "shore";

/** the colour modulation each finish applies, after the base colour (and vertex colour) is known */
const FINISH: Record<GroundFinish, string> = {
  // grass: three octaves of mottling, a few yellowed dry patches, and (mown) faint stripes
  lawn: /* glsl */ `
    float n1 = exNoise(vExtW.xz * 0.011), n2 = exNoise(vExtW.xz * 0.043 + 7.3), n3 = exNoise(vExtW.xz * 0.19 + 3.1);
    float m = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;
    diffuseColor.rgb *= mix(0.85, 1.1, m);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 1.05, 0.74), smoothstep(0.64, 0.86, n2 * 0.7 + n1 * 0.3) * 0.7);
  `,
  "lawn-mown": "",
  terrain: "",
  paving: /* glsl */ `
    float pj = exJoint(vExtW.xz, vec2(24.0), 0.55);
    vec2 pid = floor(vExtW.xz / 24.0);
    diffuseColor.rgb *= (0.955 + 0.07 * exHash(pid)) * (1.0 - 0.2 * pj) * mix(0.96, 1.03, exNoise(vExtW.xz * 0.05));
  `,
  "paving-warm": /* glsl */ `
    // a running bond: every other course shifted half a block
    vec2 bxz = vExtW.xz; float course = floor(bxz.y / 18.0); bxz.x += mod(course, 2.0) * 18.0;
    float pj = exJoint(bxz, vec2(36.0, 18.0), 0.45);
    diffuseColor.rgb *= (0.96 + 0.06 * exHash(floor(bxz / vec2(36.0, 18.0)))) * (1.0 - 0.18 * pj);
  `,
  asphalt: /* glsl */ `
    float an = exNoise(vExtW.xz * 0.018), ap = exNoise(vExtW.xz * 0.004 + 2.7);
    float speck = exHash(floor(vExtW.xz * 1.7)) * (1.0 - smoothstep(0.3, 1.2, max(fwidth(vExtW.x), fwidth(vExtW.z)) * 1.7));
    diffuseColor.rgb *= mix(0.9, 1.06, an) * (1.0 + (speck - 0.5) * 0.12) * mix(0.94, 1.04, smoothstep(0.35, 0.75, ap));
  `,
  kerb: /* glsl */ `
    float kj = exJoint(vExtW.xz, vec2(32.0), 0.5);
    diffuseColor.rgb *= (0.95 + 0.08 * exHash(floor(vExtW.xz / 32.0))) * (1.0 - 0.25 * kj);
  `,
  soil: /* glsl */ `
    float s1 = exNoise(vExtW.xz * 0.6), s2 = exNoise(vExtW.xz * 0.13 + 4.0);
    float fade = 1.0 - smoothstep(0.4, 1.5, max(fwidth(vExtW.x), fwidth(vExtW.z)) * 0.6);
    diffuseColor.rgb *= mix(0.82, 1.18, mix(0.5, s1, fade) * 0.6 + s2 * 0.4);
  `,
  shore: /* glsl */ `
    float sn = exNoise(vExtW.xz * 0.09) * 0.6 + exNoise(vExtW.xz * 0.4) * 0.4;
    diffuseColor.rgb *= mix(0.9, 1.08, sn);
  `,
};
FINISH["lawn-mown"] = FINISH.lawn + /* glsl */ `
    float st = smoothstep(0.42, 0.58, abs(fract(vExtW.x / 96.0) - 0.5) * 2.0);
    diffuseColor.rgb *= 1.0 + (st - 0.5) * 0.06 * (1.0 - smoothstep(0.02, 0.08, fwidth(vExtW.x / 96.0)));
`;
FINISH.terrain = FINISH.lawn;

/** PATCH A GROUND MATERIAL with its finish. Idempotent; the program is keyed per finish. */
export function groundFinish<T extends THREE.MeshStandardMaterial>(m: T, finish: GroundFinish): T {
  if (m.userData.finish) return m;
  m.userData.finish = finish;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.vertexShader = `varying vec3 vExtW;\n${shader.vertexShader}`.replace("#include <begin_vertex>", WORLD_POS_VERT);
    shader.fragmentShader = `${NOISE}\n${shader.fragmentShader}`.replace("#include <color_fragment>", `#include <color_fragment>\n{${FINISH[finish]}}`);
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${key ? key() : ""}|finish:${finish}`;
  return m;
}

/** THE WIND, read from a per-vertex `wind` weight (world units of travel at full wind) rather than from
 *  height — so a crown, a grass tip and a pebble can share one material and only the leaves move. The two
 *  uniforms are shared objects: "the wind picked up" stays one float write for the whole campus. The phase
 *  seed comes from the instance's own translation (InstancedMesh or BatchedMesh), so neighbours are never
 *  in step. Shadows are not patched: the shadow map is drawn on demand (see build/exterior). */
export function windByVertex<T extends THREE.MeshStandardMaterial>(m: T, gain: { value: number }, time: { value: number }, flutter = 1): T {
  if (m.userData.windByVertex) return m;
  m.userData.windByVertex = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.uWindGain = gain;
    shader.uniforms.uWindTime = time;
    shader.vertexShader = `attribute float wind;\nuniform float uWindGain;\nuniform float uWindTime;\n${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      /* glsl */ `#include <begin_vertex>
      {
        float wSeed = 0.0;
        #ifdef USE_INSTANCING
          wSeed = instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.021;
        #endif
        #ifdef USE_BATCHING
          wSeed = batchingMatrix[3].x * 0.013 + batchingMatrix[3].z * 0.021;
        #endif
        float wAmp = uWindGain * wind;
        float wt = uWindTime * ${flutter.toFixed(2)};
        transformed.x += wAmp * (sin(wt * 1.7 + wSeed) + 0.42 * sin(wt * 4.1 + wSeed * 1.9 + transformed.y * 0.06));
        transformed.z += wAmp * 0.55 * cos(wt * 1.31 + wSeed * 0.7);
      }`,
    );
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${key ? key() : ""}|windv:${flutter}`;
  return m;
}

/** THE LAKE'S LIVE STATE: one set of uniform objects the exterior writes and the water reads. */
export type WaterUniforms = {
  uTime: { value: number };
  /** 0 = dry, 1 = the heaviest rain (drives ripple rings) */
  uRain: { value: number };
  /** 0..1, the weather's wind (raises the wave height and chop) */
  uWind: { value: number };
};
export const waterUniforms = (): WaterUniforms => ({ uTime: { value: 0 }, uRain: { value: 0 }, uWind: { value: 0 } });

/** THE LIVING LAKE. An ordinary standard material — the IBL, the sun, the night tint and the rain roughness
 *  all still apply — with three things added:
 *    · MOVEMENT. Four directional wave trains plus a scrolling two-octave ripple field perturb the NORMAL
 *      (and, gently, the surface height away from the shore), so sun glints and sky reflections slide
 *      continuously across it. Wind raises the height and the chop.
 *    · DEPTH. `aShore` (world units from the waterline, the same number world/water's depth model reads)
 *      shades shallow water warm and pale and deep water dark, and lifts roughness a touch at the margin.
 *    · THE EDGE. A thin lapping band runs along the waterline, breathing in and out.
 *    · RAIN. Rings: a jittered cell grid of drop impacts, each ring expanding and fading on its own clock.
 *  Everything is per-pixel on one ~1k-triangle mesh: no reflection pass, no render target, no texture. */
export function waterMaterial(base: THREE.MeshStandardMaterial, U: WaterUniforms, colours: { shallow: number; deep: number; foam: number }): THREE.MeshStandardMaterial {
  const m = base;
  const shallow = new THREE.Color(colours.shallow), deep = new THREE.Color(colours.deep), foam = new THREE.Color(colours.foam);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, { uShallow: { value: shallow }, uDeep: { value: deep }, uFoam: { value: foam } });
    shader.vertexShader = /* glsl */ `
      attribute float aShore;
      varying float vShore;
      varying vec3 vExtW;
      uniform float uTime; uniform float uWind;
      ${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      /* glsl */ `#include <begin_vertex>
      vShore = aShore;
      {
        vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
        float amp = (0.12 + 0.28 * uWind) * smoothstep(4.0, 60.0, aShore);
        // the lake mesh is authored flat in x/z with y up (build/exterior lakeMesh)
        transformed.y += amp * (sin(dot(wp.xz, vec2(0.021, 0.013)) + uTime * 0.9) + 0.6 * sin(dot(wp.xz, vec2(-0.017, 0.029)) + uTime * 1.3));
        vExtW = wp;
      }`,
    );
    shader.fragmentShader = /* glsl */ `
      varying float vShore;
      varying vec3 vExtW;
      uniform float uTime; uniform float uRain; uniform float uWind;
      uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uFoam;
      float wHash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
      float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y); }
      // the height field's gradient at p: wave trains + a scrolling ripple noise
      vec2 wSlope(vec2 p) {
        vec2 g = vec2(0.0);
        float chop = 0.55 + 0.9 * uWind;
        vec4 dirs[4];
        dirs[0] = vec4(normalize(vec2(1.0, 0.35)), 0.045, 1.1);
        dirs[1] = vec4(normalize(vec2(-0.4, 1.0)), 0.07, 1.5);
        dirs[2] = vec4(normalize(vec2(0.8, -0.7)), 0.11, 2.1);
        dirs[3] = vec4(normalize(vec2(-1.0, -0.2)), 0.19, 2.9);
        for (int i = 0; i < 4; i++) {
          vec2 d = dirs[i].xy; float k = dirs[i].z, w = dirs[i].w;
          float a = (0.5 / (1.0 + float(i))) * chop;
          g += d * k * a * cos(dot(p, d) * k + uTime * w);
        }
        float e = 0.6;
        vec2 q = p * 0.09 + vec2(uTime * 0.05, -uTime * 0.035);
        vec2 r = p * 0.23 + vec2(-uTime * 0.09, uTime * 0.07);
        g += vec2(wNoise(q + vec2(e, 0.0)) - wNoise(q - vec2(e, 0.0)), wNoise(q + vec2(0.0, e)) - wNoise(q - vec2(0.0, e))) * 0.32 * chop;
        g += vec2(wNoise(r + vec2(e, 0.0)) - wNoise(r - vec2(e, 0.0)), wNoise(r + vec2(0.0, e)) - wNoise(r - vec2(0.0, e))) * 0.16 * chop;
        return g;
      }
      // RAIN RINGS: one drop per 14-unit cell per cycle, each at its own jittered spot and phase
      vec2 wRain(vec2 p) {
        vec2 g = vec2(0.0);
        for (int layer = 0; layer < 2; layer++) {
          float cell = layer == 0 ? 14.0 : 9.0;
          vec2 pp = p / cell + float(layer) * 3.7;
          vec2 id = floor(pp), f = fract(pp);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 o = vec2(float(i), float(j));
            float h = wHash(id + o);
            vec2 c = o + vec2(wHash(id + o + 11.1), wHash(id + o + 27.3)) * 0.8 + 0.1;
            float t = fract(uTime * (0.55 + 0.4 * h) + h * 7.0);
            vec2 d = (f - c) * cell;
            float dist = length(d);
            float rad = t * 7.5;
            float ring = sin(clamp((dist - rad) * 1.6, -3.14159, 3.14159)) * smoothstep(1.6, 0.0, abs(dist - rad)) * (1.0 - t) * (1.0 - t);
            g += (dist > 0.001 ? d / dist : vec2(0.0)) * ring;
          }
        }
        return g * 0.5;
      }
      ${shader.fragmentShader}`
      .replace("#include <color_fragment>", /* glsl */ `#include <color_fragment>
      // DEPTH: pale and warm over the shelf, deep and cool past it (aShore is world units from the waterline)
      float wDeep = smoothstep(4.0, 150.0, vShore);
      vec3 wTint = diffuseColor.rgb; // the night/grade tint lands on the base colour; carry it to both ends
      diffuseColor.rgb = mix(uShallow, uDeep, wDeep) * wTint;
      // THE EDGE: a lapping band that breathes along the waterline
      float lap = 0.5 + 0.5 * sin(vShore * 0.55 - uTime * 1.4 + wNoise(vExtW.xz * 0.05) * 5.0);
      float edge = smoothstep(9.0, 0.0, vShore) * (0.35 + 0.65 * lap) + smoothstep(2.2, 0.0, vShore) * 0.6;
      edge *= 0.55 + 0.45 * wNoise(vExtW.xz * 0.16 + uTime * 0.2);
      diffuseColor.rgb = mix(diffuseColor.rgb, uFoam * wTint, clamp(edge, 0.0, 0.85));
      `)
      .replace("#include <normal_fragment_maps>", /* glsl */ `#include <normal_fragment_maps>
      {
        vec2 s = wSlope(vExtW.xz) + wRain(vExtW.xz) * uRain * 0.9;
        // calm the margin: the lapping band is flat water against the shore
        s *= mix(0.35, 1.0, smoothstep(0.0, 18.0, vShore));
        vec3 nW = normalize(vec3(-s.x, 1.0, -s.y));
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      }`)
      .replace("#include <roughnessmap_fragment>", /* glsl */ `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor + smoothstep(6.0, 0.0, vShore) * 0.25, 0.02, 1.0);`);
  };
  m.customProgramCacheKey = () => "vo3d-lake";
  return m;
}
