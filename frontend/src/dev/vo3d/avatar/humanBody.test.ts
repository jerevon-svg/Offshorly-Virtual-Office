// @ts-expect-error — node built-ins in a vitest-only file (the app tsconfig carries no node types)
import crypto from "node:crypto";
// @ts-expect-error — as above
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { appearanceFor, HEAD_MOUNT, HUMANBASE_CATALOGUE, HUMANBASE_ENABLED, hasHumanBody, humanBaseOn, humanBodyFor, VALIDATED_HEADS } from "./humanBody";
import { CATALOGUE_BY_ID } from "../human/humanCatalogue";

describe("HumanBase production body selection (the approved five + batch 2)", () => {
  it("Bon wears his own identity head and, for now, the same Offshorly uniform as everyone; his own outfit stays in the wardrobe", () => {
    const cfg = humanBodyFor("bon", "");
    expect(cfg).not.toBeNull();
    expect(cfg!.identity.headAssetId).toBe("humanbase:bon");
    expect([cfg!.top.assetId, cfg!.top.colorway, cfg!.bottom.assetId, cfg!.bottom.colorway, cfg!.shoes.assetId, cfg!.shoes.colorway]).toEqual(["tee-offshorly", "ink", "joggers-offshorly", "black", "sneakers", "white"]);
    for (const id of ["hoodie-crrn", "shorts-denim", "clogs"]) expect(HUMANBASE_CATALOGUE.has(id) && CATALOGUE_BY_ID.has(id)).toBe(true);
    expect(HUMANBASE_CATALOGUE.get("humanbase:bon")?.url).toMatch(/human-base-v1\/production\/bon-v1\.glb$/);
  });
  it("Micah, Angelo, Clang and France wear their own V1.4 production head, the Offshorly uniform and their own extras", () => {
    const want = {
      micah: { preset: "feminine", idle: "feminine", glasses: "micah-glasses", acc: [] as string[] },
      angelo: { preset: "standard", idle: "masculine", glasses: null, acc: [] as string[] },
      clang: { preset: "feminine", idle: "feminine", glasses: null, acc: ["clang-flower"] },
      france: { preset: "feminine", idle: "feminine", glasses: null, acc: ["france-hair-tail"] },
      jona: { preset: "feminine", idle: "feminine", glasses: null, acc: [] as string[] },
      kael: { preset: "standard", idle: "masculine", glasses: null, acc: [] as string[] },
      nicole: { preset: "feminine", idle: "feminine", glasses: null, acc: [] as string[] },
      lui: { preset: "standard", idle: "masculine", glasses: null, acc: [] as string[] },
    } as const;
    for (const [id, w] of Object.entries(want)) {
      const cfg = (HUMANBASE_ENABLED.has(id) ? humanBodyFor(id, "") : appearanceFor(id))!;   // batch 2: the recipe exists, enablement waits for the gate
      expect(cfg.employeeId).toBe(id);
      expect(cfg.identity.headAssetId).toBe(`humanbase:${id}`);
      expect(HUMANBASE_CATALOGUE.get(`humanbase:${id}`)?.url).toMatch(new RegExp(`human-base-v1/production/${id}-v1\\.glb$`));
      expect(cfg.bodyPreset ?? "standard").toBe(w.preset);
      expect(cfg.idleProfile).toBe(w.idle);
      expect([cfg.top.assetId, cfg.top.colorway, cfg.bottom.assetId, cfg.bottom.colorway, cfg.shoes.assetId, cfg.shoes.colorway]).toEqual(["tee-offshorly", "ink", "joggers-offshorly", "black", "sneakers", "white"]);
      expect(cfg.glasses.assetId).toBe(w.glasses);
      expect(cfg.accessories.map((a) => a.assetId)).toEqual(w.acc);
      for (const a of [cfg.top, cfg.bottom, cfg.shoes, cfg.glasses, ...cfg.accessories]) if (a.assetId) expect(HUMANBASE_CATALOGUE.has(a.assetId)).toBe(true);
    }
  });
  it("GROUP PROPORTION: Bon is the canonical head (no mount); every other approved head carries its own measured mount", () => {
    expect(humanBodyFor("bon", "")!.identity.mount).toBeUndefined();
    for (const id of ["micah", "angelo", "clang", "france"]) {
      const m = appearanceFor(id)!.identity.mount!;
      expect(m).toEqual(HEAD_MOUNT[id]);
      expect(m.scale).toBeGreaterThan(0.85); expect(m.scale).toBeLessThan(1);   // a normalization, never a remodel
    }
    // only Micah's head is authored pitched forward
    expect(Object.entries(HEAD_MOUNT).filter(([, m]) => m.pitchDeg).map(([id]) => id)).toEqual(["micah"]);
    // per identity, not one blanket factor
    expect(new Set(Object.values(HEAD_MOUNT).map((m) => m.scale)).size).toBeGreaterThan(1);
  });
  it("RUNTIME / GATE PARITY: no hand-set mount for any non-frozen identity — the runtime wears the gate-validated record", () => {
    expect(Object.keys(HEAD_MOUNT).sort()).toEqual(["angelo", "clang", "france", "micah"]);   // the frozen approved five only
    const rec = { artifactHash: "a".repeat(64), pipelineVersion: "v", mount: { scale: 0.885, pitchDeg: 0 }, bindingHash: "b".repeat(64), validatedAt: "2026-10-06T00:00:00Z" };
    for (const id of ["jona", "kael", "nicole", "lui"]) {
      if (!VALIDATED_HEADS[id]) { expect(appearanceFor(id)!.identity.mount).toBeUndefined(); expect(hasHumanBody(id, "")).toBe(false); }   // no record → no mount, not enabled
      expect(appearanceFor(id, { [id]: rec })!.identity.mount).toEqual(rec.mount);   // exactly the record, scale AND pitch
    }
    expect(appearanceFor("micah", { micah: rec })!.identity.mount).toEqual(HEAD_MOUNT.micah);   // a record can never re-mount a frozen identity
  });
  it("every validated head record matches the production file on disk and its mount binding (hand edits are caught)", () => {
    for (const [id, v] of Object.entries(VALIDATED_HEADS)) {
      const file = `public/avatars/human-base-v1/production/${id}-v1.glb`;
      expect(crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")).toBe(v.artifactHash);
      expect(crypto.createHash("sha256").update(`${v.artifactHash}|${JSON.stringify({ scale: v.mount.scale, pitchDeg: v.mount.pitchDeg })}`).digest("hex")).toBe(v.bindingHash);
      expect(HUMANBASE_ENABLED.has(id)).toBe(true); expect(humanBodyFor(id, "")!.identity.mount).toEqual(v.mount);
    }
  });
  it("everyone else keeps the legacy body (config, not code)", () => {
    // Alex: the Meshy identity was rejected — his own legacy head is being adapted; Jan is deferred
    // FAIL-CLOSED: batch 2 (pre-audit, known-broken artifacts) stays disabled until a V2 candidate passes the final gate
    for (const id of ["alex", "jan", "jona", "kael", "nicole", "lui", "unknown"]) expect(humanBodyFor(id, "")).toBeNull();
    expect([...HUMANBASE_ENABLED]).toEqual(["bon", "micah", "angelo", "clang", "france"]);
    for (const id of ["jona", "kael", "nicole", "lui"]) expect(appearanceFor(id)).not.toBeNull();
  });
  it("`?humanbase=0` rolls the session back to the legacy body", () => {
    expect(humanBaseOn("?humanbase=0")).toBe(false);
    for (const id of HUMANBASE_ENABLED) { expect(humanBodyFor(id, "?humanbase=0")).toBeNull(); expect(hasHumanBody(id, "?humanbase=0")).toBe(false); expect(hasHumanBody(id, "")).toBe(true); }
    expect(humanBodyFor("bon", "?x=1")).not.toBeNull();
  });
  it("identity is not appearance: the config carries an appearance only, and a fresh copy every call", () => {
    const a = humanBodyFor("bon", "")!, b = humanBodyFor("bon", "")!;
    expect(a).not.toBe(b);
    expect(Object.keys(a)).not.toContain("email");
  });
});
