// fringe-exact.test.mjs — FC-FRINGE-INTO-FACE-EXACT (REPORT-ONLY): the exact sunk-fringe measure clears the approved five, fires on
// its negative fixtures, is deterministic, and its known blind spot is pinned (so a change to it is a decision). From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/fringe-exact.test.mjs
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { fringeIntoFaceExact } from "./fringe-exact.mjs";
import { identityParts } from "./visibility.mjs";
import { REPORT_ONLY, REGISTRY } from "./failure-registry.mjs";

const require = createRequire(import.meta.url), { NodeIO } = require("@gltf-transform/core"), { ALL_EXTENSIONS } = require("@gltf-transform/extensions"), draco3d = require("draco3dgltf");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
const measure = async (file) => { const parts = identityParts(await io.read(file)), get = (n) => parts.find((p) => p.name === n); return fringeIntoFaceExact({ fringe: get("identity_hair_fringe"), face: [get("identity_head"), get("identity_face_twin")].filter(Boolean) }); };
const P = "public/avatars/human-base-v1/production", F = "scripts/avatar-pipeline/human-base/fixtures/report-only";

describe("FC-FRINGE-INTO-FACE-EXACT (fringe-exact.mjs, report-only)", () => {
  it("clears the approved five (no fringe triangle sunk whole inside the face)", async () => { for (const w of ["bon", "micah", "angelo", "clang", "france"]) expect((await measure(`${P}/${w}-v1.glb`)).sunkArea, w).toBe(0); }, 120000);
  it("fires on its negative fixtures (a fringe strand pushed 15 mm-eq into the face)", async () => {
    for (const f of ["france-broken-fringe-into-face", "bon-broken-fringe-lock-into-face"]) expect((await measure(`${F}/${f}.glb`)).sunkArea, f).toBeGreaterThan(1e-4); }, 120000);
  it("pins its known blind spot: a strand sunk AT the face outline reads 0 here (FC-FRINGE-EYE still catches it)", async () => { expect((await measure(`${F}/bon-broken-fringe-into-face.glb`)).sunkArea).toBe(0); }, 120000);
  it("is deterministic", async () => { const a = await measure(`${P}/france-v1.glb`), b = await measure(`${P}/france-v1.glb`); expect(a).toEqual(b); }, 120000);
  it("is report-only: never a blocking class, and FC-FRINGE-EYE is unchanged", () => {
    expect(REPORT_ONLY.some((d) => d.id === "FC-FRINGE-INTO-FACE-EXACT")).toBe(true); expect(REGISTRY.some((d) => d.id === "FC-FRINGE-INTO-FACE-EXACT")).toBe(false);
    expect(REGISTRY.find((d) => d.id === "FC-FRINGE-EYE").validate.toString()).toMatch(/intoFace === 0 && e\.artifact\.fringe\.eyeCutsHair === 0/); });
});
