// vo3d V2 OPTIMISATION SLICE 4 — SSAO WITHOUT THE SECOND SCENE SUBMISSION.
//
// The claim this slice makes is narrow and mechanical: the AO pass no longer submits the scene, and it
// reads the depth the beauty pass wrote instead. Both halves are testable without a GL context, because
// both are decisions the pass makes in JS before it draws anything — WHICH object it hands to
// renderer.render(), and WHICH texture it binds to tDepth.
//
// What these tests CANNOT hold is the look of the AO; a reconstructed normal is a shader question and
// belongs to the visual A/B (`?ao=legacy`). What they can hold is that the stock path is still there and
// still intact when the flag says so, which is what makes that A/B a real comparison.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { SSAOShader } from "three/examples/jsm/shaders/SSAOShader.js";
import { SSAOFromDepthPass, makeBeautyTarget, setSSAODepthReuse } from "./render/SSAOFromDepth";

/** Enough of a WebGLRenderer for SSAOPass's own `_renderPass`/`_renderOverride` helpers to run. Every
 *  renderer.render() call is recorded with what it was asked to draw, which is the whole point: a
 *  fullscreen quad arrives as a Mesh, a scene submission arrives as a Scene. */
function fakeRenderer() {
  const drew: THREE.Object3D[] = [];
  const r = {
    autoClear: true,
    drew,
    getClearColor: (t: THREE.Color) => t,
    getClearAlpha: () => 1,
    setClearColor: () => {},
    setClearAlpha: () => {},
    setRenderTarget: vi.fn(),
    clear: vi.fn(),
    render: (obj: THREE.Object3D) => { drew.push(obj); },
  };
  return r as unknown as THREE.WebGLRenderer & { drew: THREE.Object3D[] };
}
const sceneSubmissions = (r: { drew: THREE.Object3D[] }) => r.drew.filter((o) => (o as THREE.Scene).isScene === true).length;
const quadDraws = (r: { drew: THREE.Object3D[] }) => r.drew.filter((o) => (o as THREE.Scene).isScene !== true).length;

function rig(reuse: boolean) {
  setSSAODepthReuse(reuse);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 100);
  const pass = new SSAOFromDepthPass(scene, camera, 64, 48, 16);
  const beauty = makeBeautyTarget(128, 96);
  return { scene, camera, pass, beauty, renderer: fakeRenderer() };
}

afterEach(() => setSSAODepthReuse(true));

describe("slice 4 — the second scene submission", () => {
  it("is gone: the AO pass draws its quads and never the scene", () => {
    const { pass, beauty, renderer } = rig(true);
    pass.render(renderer, makeBeautyTarget(128, 96), beauty);
    expect(sceneSubmissions(renderer)).toBe(0);
    // ssao, blur, composite — the three quads the stock Default path also draws
    expect(quadDraws(renderer)).toBe(3);
  });

  it("is still there under ?ao=legacy, so the A/B compares against the real stock pass", () => {
    const { pass, beauty, renderer } = rig(false);
    expect(pass.reusesDepth).toBe(false);
    pass.render(renderer, makeBeautyTarget(128, 96), beauty);
    expect(sceneSubmissions(renderer)).toBe(1);
    expect(quadDraws(renderer)).toBe(3);
  });

  it("falls back to the stock path rather than reading a depth texture that is not there", () => {
    const { pass, renderer } = rig(true);
    const plain = new THREE.WebGLRenderTarget(128, 96); // no depthTexture: a composer built the old way
    pass.render(renderer, new THREE.WebGLRenderTarget(128, 96), plain);
    expect(sceneSubmissions(renderer)).toBe(1);
  });
});

describe("slice 4 — where the depth comes from", () => {
  it("binds the buffer the beauty pass just wrote, not the pass's own normal target", () => {
    const { pass, beauty, renderer } = rig(true);
    const u = (pass.ssaoMaterial as THREE.ShaderMaterial).uniforms;
    expect(u.tDepth.value).toBe(pass.normalRenderTarget.depthTexture);
    pass.render(renderer, makeBeautyTarget(128, 96), beauty);
    expect(u.tDepth.value).toBe(beauty.depthTexture);
  });

  it("spaces its normal taps one AO pixel apart — the rate the old normal buffer was rasterised at", () => {
    const { pass, beauty, renderer } = rig(true);
    pass.render(renderer, makeBeautyTarget(128, 96), beauty);
    const texel = (pass.ssaoMaterial as THREE.ShaderMaterial).uniforms.depthTexelSize.value as THREE.Vector2;
    // AO runs at 64x48 over a 128x96 depth buffer: one AO pixel is two depth texels, and taking the
    // taps any tighter resolves geometry the replaced half-res normal buffer never saw — which reads
    // as a sharper AO than the approved one.
    expect(texel.x).toBeCloseTo(1 / 64, 10);
    expect(texel.y).toBeCloseTo(1 / 48, 10);
  });

  it("hands SSAO a depth texture the AO was tuned against: 24-bit depth, nearest-sampled", () => {
    const rt = makeBeautyTarget(128, 96);
    expect(rt.depthTexture).not.toBeNull();
    expect(rt.depthTexture?.format).toBe(THREE.DepthStencilFormat);
    expect(rt.depthTexture?.type).toBe(THREE.UnsignedInt248Type);
    // a filtered depth would average across silhouettes — the one thing the edge-aware taps exist to avoid
    expect(rt.depthTexture?.minFilter).toBe(THREE.NearestFilter);
    expect(rt.depthTexture?.magFilter).toBe(THREE.NearestFilter);
  });
});

describe("slice 4 — the normal reconstruction", () => {
  it("replaces the normal-buffer fetch, and only in the reuse build", () => {
    const reuse = rig(true).pass.ssaoMaterial as THREE.ShaderMaterial;
    const legacy = rig(false).pass.ssaoMaterial as THREE.ShaderMaterial;
    expect(legacy.fragmentShader).toContain("unpackRGBToNormal( texture2D( tNormal");
    expect(reuse.fragmentShader).not.toContain("unpackRGBToNormal( texture2D( tNormal");
    expect(reuse.fragmentShader).toContain("cross( dx, dy )");
    expect(reuse.uniforms.depthTexelSize).toBeDefined();
    expect(legacy.uniforms.depthTexelSize).toBeUndefined();
  });

  it("leaves everything the approved AO was graded on alone", () => {
    const reuse = rig(true).pass;
    const legacy = rig(false).pass;
    const a = reuse.ssaoMaterial as THREE.ShaderMaterial, b = legacy.ssaoMaterial as THREE.ShaderMaterial;
    expect(a.defines.KERNEL_SIZE).toBe(b.defines.KERNEL_SIZE);
    expect(reuse.kernel.length).toBe(legacy.kernel.length);
    // the strength lerp the environment grades lives in copyMaterial; slice 4 must not have touched it
    expect((reuse.copyMaterial as THREE.ShaderMaterial).fragmentShader).toBe((legacy.copyMaterial as THREE.ShaderMaterial).fragmentShader);
    // the AO target itself still runs at the pass's own AO_SCALE resolution
    expect(reuse.ssaoRenderTarget.width).toBe(legacy.ssaoRenderTarget.width);
  });

  it("is anchored to a snippet three still ships — the upgrade tripwire", () => {
    // If a three upgrade moves getViewNormal, a string replace would quietly no-op and the AO would read
    // an EMPTY normal buffer: black AO everywhere, and nothing would say so. The patch throws instead,
    // and this asserts the text it anchors on so the failure lands here, at the upgrade, not on screen.
    expect(SSAOShader.fragmentShader).toContain("return unpackRGBToNormal( texture2D( tNormal, screenPosition ).xyz );");
    expect(() => rig(true)).not.toThrow();
  });
});
