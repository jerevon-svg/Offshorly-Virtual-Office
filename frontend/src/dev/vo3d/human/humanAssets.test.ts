// The BUILT HumanBase_V1 files honour the contract: one skeleton, one clip library, modules that rebind by name.
import { describe, expect, it } from "vitest";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only).
import fs from "node:fs";
import { HAND_FRAMES, HEAD_ENVELOPE, HUMAN_CLIPS, HUMAN_HAND_JOINTS, HUMAN_SKELETON_JOINTS, BODY_REGIONS, type IdentityLandmarks } from "./humanBaseContract";
import { HUMAN_BASE_URL, HUMAN_BODY_PRESET_URLS, PROOF_CATALOGUE } from "./humanCatalogue";
import { nodeIO, publicPath } from "./humanGlb.testutil";

const BASE = publicPath(HUMAN_BASE_URL);
const MODULES = PROOF_CATALOGUE.filter((a) => !a.url.startsWith("procedural:"));
const read = async (p: string) => (await nodeIO()).read(p);

describe.skipIf(!fs.existsSync(BASE))("HumanBase_V1 assets", () => {
  it("the base carries the 36-joint contract skeleton, in order", async () => {
    const doc = await read(BASE);
    expect(doc.getRoot().listSkins()[0].listJoints().map((j) => j.getName())).toEqual([...HUMAN_SKELETON_JOINTS]);
  }, 30_000);

  it("ONE shared clip library: every contract clip, rotation-only except the Hips, no hand tracks", async () => {
    const doc = await read(BASE);
    const anims = doc.getRoot().listAnimations();
    expect(anims.map((a) => a.getName()).sort()).toEqual([...HUMAN_CLIPS].sort());
    for (const a of anims) for (const ch of a.listChannels()) {
      const node = ch.getTargetNode()!.getName(), path = ch.getTargetPath();
      expect(path).not.toBe("scale");
      if (path === "translation") expect(node).toBe("Hips");
      expect(HUMAN_HAND_JOINTS as readonly string[]).not.toContain(node);
    }
  }, 30_000);

  it("is symmetric: every left joint's rest position mirrors its right partner", async () => {
    const doc = await read(BASE);
    const rest = (doc.getRoot().listNodes().find((n) => n.getName() === "humanbase_body")!.getExtras() as { humanBase: { rest: Record<string, number[]> } }).humanBase.rest;
    for (const [j, p] of Object.entries(rest)) {
      if (!j.startsWith("Left")) continue;
      const r = rest[`Right${j.slice(4)}`];
      expect(r[0]).toBeCloseTo(-p[0], 3); expect(r[1]).toBeCloseTo(p[1], 3); expect(r[2]).toBeCloseTo(p[2], 3);
    }
  }, 30_000);

  it("has no head (identity supplies it) and every vertex in a contract region", async () => {
    const doc = await read(BASE);
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    const P = prim.getAttribute("POSITION")!.getArray()!, R = prim.getAttribute("_REGION")!.getArray()!;
    let maxY = 0; for (let i = 1; i < P.length; i += 3) maxY = Math.max(maxY, P[i]);
    expect(maxY).toBeLessThan(0.93);
    const valid = new Set(Object.values(BODY_REGIONS));
    for (let i = 0; i < R.length; i += 97) expect(valid.has(Math.round(R[i]) as never)).toBe(true);
  }, 30_000);

  it("the contract's hand frames are where the base's own hand vertices put them", async () => {
    const doc = await read(BASE);
    const m = (doc.getRoot().listNodes().find((n) => n.getName() === "humanbase_body")!.getExtras() as { humanBase: { handFramesMeasured: Record<string, number[]> } }).humanBase.handFramesMeasured;
    for (const [f, def] of Object.entries(HAND_FRAMES)) for (let k = 0; k < 3; k++) expect(Math.abs(m[f][k] - def.position[k])).toBeLessThan(0.03);
  }, 30_000);

  it("every module rebinds by name onto the base: same joints, same inverse bind matrices", async () => {
    const base = await read(BASE);
    const bSkin = base.getRoot().listSkins()[0];
    const bIbm = bSkin.getInverseBindMatrices()!.getArray()!;
    for (const a of MODULES) {
      const doc = await read(publicPath(a.url));
      // the base's 36 joints first, then only the joints the module declares it owns (hair chains) under real parents
      const owned = ((doc.getRoot().listScenes()[0].getExtras() as { moduleJoints?: { name: string; parent: string }[] }).moduleJoints ?? []);
      for (const skin of doc.getRoot().listSkins()) {
        const names = skin.listJoints().map((j) => j.getName());
        expect(names.slice(0, 36)).toEqual([...HUMAN_SKELETON_JOINTS]);
        expect(names.slice(36)).toEqual(owned.map((j) => j.name));
        for (const j of owned) expect([...HUMAN_SKELETON_JOINTS, ...owned.map((o) => o.name)]).toContain(j.parent);
        const ibm = skin.getInverseBindMatrices()!.getArray()!;
        for (let i = 0; i < bIbm.length; i++) expect(Math.abs(ibm[i] - bIbm[i])).toBeLessThan(1e-3);
      }
    }
  }, 60_000);

  it("module extras agree with the catalogue (hides), and the identity sits in the head envelope", async () => {
    for (const a of MODULES) {
      const ex = (await read(publicPath(a.url))).getRoot().listScenes()[0].getExtras() as Record<string, { hides?: string[]; landmarks?: IdentityLandmarks }>;
      const info = ex.humanGarment ?? ex.humanIdentity ?? ex.humanHair ?? ex.humanAccessory;
      expect(info, a.id).toBeTruthy();
      expect([...(info.hides ?? [])].sort(), a.id).toEqual([...(a.hides ?? [])].sort());
      if (a.slot === "identity") {
        const e = info.landmarks!.eyes;
        const longFace = !!(info as unknown as { mount?: { longFace?: { extended?: boolean } } }).mount?.longFace?.extended;   // the bounded long-face extension, recorded by the build
        for (const p of [e.l, e.r]) { expect(p[1]).toBeGreaterThan(HEAD_ENVELOPE.eyeY[0]); if (!longFace) expect(p[1]).toBeLessThan(HEAD_ENVELOPE.eyeY[1]); }   // a long-face identity is bounded by the mounted envelope, not a native ceiling
        expect(e.l[0]).toBeCloseTo(-e.r[0], 4);
      }
    }
  }, 60_000);

  it("every body preset is the SAME rig: joints, inverse binds, rest pose and clip library identical to the standard base", async () => {
    const std = await read(BASE);
    for (const url of Object.values(HUMAN_BODY_PRESET_URLS)) {
      if (!fs.existsSync(publicPath(url))) continue;
      const doc = await read(publicPath(url)), a = std.getRoot().listSkins()[0], b = doc.getRoot().listSkins()[0];
      expect(b.listJoints().map((j) => j.getName())).toEqual(a.listJoints().map((j) => j.getName()));
      const A = a.getInverseBindMatrices()!.getArray()!, B = b.getInverseBindMatrices()!.getArray()!;
      for (let i = 0; i < A.length; i++) expect(Math.abs(A[i] - B[i])).toBeLessThan(1e-5);
      expect(doc.getRoot().listAnimations().map((x) => x.getName()).sort()).toEqual(std.getRoot().listAnimations().map((x) => x.getName()).sort());
    }
  }, 60_000);

  it("the shorts are ONE closed garment at the crotch: no open edges between the legs", async () => {
    const doc = await read(publicPath(PROOF_CATALOGUE.find((a) => a.id === "shorts-denim")!.url));
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    const P = prim.getAttribute("POSITION")!.getArray()!, I = prim.getIndices()!.getArray()!;
    const key = (i: number) => `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`;
    const use = new Map<string, { n: number; y: number; x: number }>();
    for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = I[t + k], b = I[t + (k + 1) % 3], ka = key(a), kb = key(b), e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const u = use.get(e) ?? { n: 0, y: (P[a * 3 + 1] + P[b * 3 + 1]) / 2, x: Math.abs(P[a * 3] + P[b * 3]) / 2 }; u.n++; use.set(e, u);
    }
    const crotchOpen = [...use.values()].filter((u) => u.n === 1 && u.x < 0.06 && u.y > 0.24 && u.y < 0.4).length;
    expect(crotchOpen).toBe(0);
  }, 60_000);
});
