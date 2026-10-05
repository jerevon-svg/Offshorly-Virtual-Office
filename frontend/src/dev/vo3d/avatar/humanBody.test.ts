import { describe, expect, it } from "vitest";
import { HEAD_MOUNT, HUMANBASE_CATALOGUE, HUMANBASE_ENABLED, humanBaseOn, humanBodyFor } from "./humanBody";
import { CATALOGUE_BY_ID } from "../human/humanCatalogue";

describe("HumanBase production body selection (Phase 3: the five approved employees)", () => {
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
    } as const;
    for (const [id, w] of Object.entries(want)) {
      const cfg = humanBodyFor(id, "")!;
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
  it("GROUP PROPORTION: Bon is the canonical head (no mount); every other head carries its own measured mount", () => {
    expect(humanBodyFor("bon", "")!.identity.mount).toBeUndefined();
    for (const id of ["micah", "angelo", "clang", "france"]) {
      const m = humanBodyFor(id, "")!.identity.mount!;
      expect(m).toEqual(HEAD_MOUNT[id]);
      expect(m.scale).toBeGreaterThan(0.85); expect(m.scale).toBeLessThan(1);   // a normalization, never a remodel
    }
    // only Micah's head is authored pitched forward
    expect(Object.entries(HEAD_MOUNT).filter(([, m]) => m.pitchDeg).map(([id]) => id)).toEqual(["micah"]);
    // per identity, not one blanket factor
    expect(new Set(Object.values(HEAD_MOUNT).map((m) => m.scale)).size).toBeGreaterThan(1);
  });
  it("everyone else keeps the legacy body (config, not code)", () => {
    for (const id of ["alex", "jan", "jona", "kael", "nicole", "unknown"]) expect(humanBodyFor(id, "")).toBeNull();
    expect([...HUMANBASE_ENABLED]).toEqual(["bon", "micah", "angelo", "clang", "france"]);
  });
  it("`?humanbase=0` rolls the session back to the legacy body", () => {
    expect(humanBaseOn("?humanbase=0")).toBe(false);
    for (const id of HUMANBASE_ENABLED) expect(humanBodyFor(id, "?humanbase=0")).toBeNull();
    expect(humanBodyFor("bon", "?x=1")).not.toBeNull();
  });
  it("identity is not appearance: the config carries an appearance only, and a fresh copy every call", () => {
    const a = humanBodyFor("bon", "")!, b = humanBodyFor("bon", "")!;
    expect(a).not.toBe(b);
    expect(Object.keys(a)).not.toContain("email");
  });
});
