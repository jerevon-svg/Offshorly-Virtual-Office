// vo3d render — SSAO WITHOUT THE SECOND SCENE SUBMISSION (V2 optimisation slice 4).
//
// WHY. After slice 3 the whole-office frame stood at 5,531 draw calls over 2,917 visible meshes — and
// that arithmetic only closes because the scene is submitted TWICE. Stock SSAOPass opens every frame by
// re-drawing the entire scene through a MeshNormalMaterial override just to fill a normal buffer, so
// roughly 2,610 of those calls buy nothing the beauty pass did not already rasterise. The frame is
// draw-call bound (slice 3: -44% calls bought -23% frame time), which makes that second submission the
// single largest remaining cost in Full Graphics, and it is the one that scales with avatar count: a
// skinned avatar can never be batched, so every one of the 70 is submitted, skinned and shaded, twice.
//
// WHAT THIS DOES. The beauty pass already wrote a depth buffer. Give that buffer a DepthTexture and SSAO
// can read it, which leaves only the normal to account for — and a view-space normal is recoverable from
// depth alone, because three neighbouring depth samples define the surface's tangent plane. So the
// override render goes away entirely and the AO is computed from the depth the frame already paid for.
//
// THE NORMAL RECONSTRUCTION IS EDGE-AWARE, and that is the whole quality story. Naive dFdx/dFdy of the
// reconstructed view position tilts the normal wildly across a silhouette, because the two sides of the
// step belong to different surfaces — which is exactly where AO is most visible, and exactly the "harder,
// faceted AO" failure this slice is not allowed to ship. Instead four taps are taken (left/right/up/down)
// and each axis keeps the neighbour that is CLOSER in view depth, so a pixel on the edge of a desk builds
// its tangent plane from the desk rather than from the floor behind it. Four extra texture fetches on a
// half-resolution quad against ~2,610 draw calls is not a trade that needs defending.
//
// WHAT IT DOES NOT CHANGE. Kernel size, kernel radius, min/max distance, AO_SCALE, the strength grading
// the environment drives per phase, the composite blend, DPR, shadows, materials, lighting, geometry. The
// pass still owns its own ssao/blur targets at AO_SCALE; only where the normal comes from has changed.
//
// RESIDUAL DIFFERENCE, stated honestly: MeshNormalMaterial interpolates SHADING normals across a
// triangle, and depth reconstruction recovers the GEOMETRIC normal of the facet. On smooth-shaded curved
// furniture the two differ by up to the half-angle between adjacent facets. The AO is then blurred and
// mixed toward white at ~0.6 strength, which is why this is expected to sit under the load-to-load noise
// floor — but "expected" is not "verified", so `?ao=legacy` rebuilds the stock path for a direct A/B and
// the visual gate, not this comment, is what decides whether the slice stands.
import * as THREE from "three";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";

/** A/B switch. ON by default; app/bootstrap turns it off for `?ao=legacy`. Read at Renderer construction
 *  (the beauty target and the shader patch are both built once), so the switch is a flag plus a reload —
 *  the same shape as `?batch=0` in render/StaticBatch. */
let enabled = true;
export function setSSAODepthReuse(on: boolean): void {
  enabled = on;
}
export function ssaoDepthReuseEnabled(): boolean {
  return enabled;
}

/** The composer's beauty buffer, with a depth texture attached so the AO pass can read what it wrote.
 *
 *  HalfFloat colour matches the target EffectComposer would have built for itself; depth is 24-bit with
 *  8 bits of stencil, matching what SSAOPass attaches to its own normal target — same precision the AO
 *  was tuned against. NearestFilter is the DepthTexture default and must stay: the AO samples this at
 *  half resolution and a filtered depth would average across silhouettes. */
export function makeBeautyTarget(width: number, height: number): THREE.WebGLRenderTarget {
  const depth = new THREE.DepthTexture(width, height);
  depth.format = THREE.DepthStencilFormat;
  depth.type = THREE.UnsignedInt248Type;
  const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthTexture: depth });
  rt.texture.name = "EffectComposer.rt1";
  return rt;
}

/** Swap the normal-buffer lookup for a reconstruction from `tDepth`. `getViewZ`/`getViewPosition` are
 *  already defined above this point in the stock shader and already handle both projections, so the
 *  reconstruction inherits the ortho/perspective correctness the Renderer fixed for the AO itself. */
function reconstructNormalsFromDepth(m: THREE.ShaderMaterial): void {
  const stock = `		vec3 getViewNormal( const in vec2 screenPosition ) {

			return unpackRGBToNormal( texture2D( tNormal, screenPosition ).xyz );

		}`;
  if (!m.fragmentShader.includes(stock)) {
    throw new Error("SSAOFromDepth: SSAOShader.getViewNormal has moved — re-check the patch against this three version");
  }
  m.uniforms.depthTexelSize = { value: new THREE.Vector2(1 / 1024, 1 / 1024) };
  m.fragmentShader = m.fragmentShader.replace(
    stock,
    `		uniform vec2 depthTexelSize;

		vec3 getViewPositionAt( const in vec2 uv ) {

			float d = getDepth( uv );
			return getViewPosition( uv, d, getViewZ( d ) );

		}

		vec3 getViewNormal( const in vec2 screenPosition ) {

			vec3 c = getViewPositionAt( screenPosition );
			vec3 xl = getViewPositionAt( screenPosition - vec2( depthTexelSize.x, 0.0 ) );
			vec3 xr = getViewPositionAt( screenPosition + vec2( depthTexelSize.x, 0.0 ) );
			vec3 yd = getViewPositionAt( screenPosition - vec2( 0.0, depthTexelSize.y ) );
			vec3 yu = getViewPositionAt( screenPosition + vec2( 0.0, depthTexelSize.y ) );

			// EDGE AWARE. Across a silhouette one neighbour lies on another surface entirely; keeping the
			// one closer in depth builds the tangent plane out of the surface this pixel belongs to.
			vec3 dx = abs( xl.z - c.z ) < abs( xr.z - c.z ) ? c - xl : xr - c;
			vec3 dy = abs( yd.z - c.z ) < abs( yu.z - c.z ) ? c - yd : yu - c;

			// view space is right-handed (+x right, +y up, +z toward the camera), so cross(dx, dy) faces
			// the viewer for a front-facing surface — the orientation unpackRGBToNormal produced.
			return normalize( cross( dx, dy ) );

		}`,
  );
  m.needsUpdate = true;
}

/** SSAOPass's own fullscreen-quad helper: binds the target, saves/restores the renderer's clear state and
 *  draws one of the pass's materials. It is `_`-prefixed in the addon so the generated types omit it, but
 *  it is exactly the routine the stock `render()` uses for all three of its quads — reaching for it is
 *  what keeps this subclass a DELETION of the override render rather than a reimplementation of the pass. */
type QuadPass = {
  _renderPass(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null, clearColor?: number, clearAlpha?: number): void;
};

/** SSAOPass with the normal-override scene render removed. Falls back to the stock pass verbatim when
 *  depth reuse is off, which is what makes `?ao=legacy` a true A/B rather than an approximation of one. */
export class SSAOFromDepthPass extends SSAOPass {
  /** whether THIS pass was built for depth reuse (fixed at construction: the shader is patched once) */
  readonly reusesDepth: boolean;
  private readonly texel = new THREE.Vector2();

  constructor(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number, kernelSize: number) {
    super(scene, camera, width, height, kernelSize);
    this.reusesDepth = ssaoDepthReuseEnabled();
    if (this.reusesDepth) reconstructNormalsFromDepth(this.ssaoMaterial as THREE.ShaderMaterial);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime?: number, maskActive?: boolean): void {
    const depth = readBuffer?.depthTexture ?? null;
    if (!this.reusesDepth || depth === null) {
      // stock path — normal override, normal buffer, normal target's own depth
      super.render(renderer, writeBuffer, readBuffer, deltaTime as number, maskActive as boolean);
      return;
    }
    const m = this.ssaoMaterial as THREE.ShaderMaterial;
    // THE BEAUTY PASS WROTE THIS MOMENTS AGO. `readBuffer` is the buffer RenderPass rendered into (it
    // does not swap), so taking the depth off the argument keeps this pass ignorant of the composer's
    // buffer bookkeeping — if the chain ever does swap, this still reads the right one.
    m.uniforms.tDepth.value = depth;
    // TAP SPACING IS THE AO'S OWN PIXEL, not the depth buffer's. The normal buffer this replaces was
    // rasterised at AO_SCALE, so legacy fed the kernel ONE normal per AO pixel; taking the taps a full
    // AO pixel apart estimates the tangent plane at that same rate. Tighter taps (one depth texel) read
    // real geometry the old buffer never resolved, and measurably sharpen the AO — accurate, but not
    // the approved look. Matching the sampling rate is what keeps this a reimplementation of the AO
    // rather than a new one.
    this.texel.set(1 / this.width, 1 / this.height);
    (m.uniforms.depthTexelSize.value as THREE.Vector2).copy(this.texel);
    m.uniforms.kernelRadius.value = this.kernelRadius;
    m.uniforms.minDistance.value = this.minDistance;
    m.uniforms.maxDistance.value = this.maxDistance;
    const quad = this as unknown as QuadPass;
    quad._renderPass(renderer, m, this.ssaoRenderTarget);
    quad._renderPass(renderer, this.blurMaterial, this.blurRenderTarget);
    // the approved composite, unchanged: blurred AO multiplied into the beauty through copyMaterial's
    // CustomBlending, with the Renderer's aoStrength lerp still in that shader.
    const cm = this.copyMaterial as THREE.ShaderMaterial;
    cm.uniforms.tDiffuse.value = this.blurRenderTarget.texture;
    cm.blending = THREE.CustomBlending;
    quad._renderPass(renderer, cm, this.renderToScreen ? null : readBuffer);
  }
}
