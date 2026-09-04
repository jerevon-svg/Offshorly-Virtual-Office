import { describe, expect, it } from "vitest";
import { greetingAnchor, HEAD_LABEL_GAP_FRAME_UNITS } from "../components/OfficeMap/panMath";
import { FRAME_HEIGHT } from "../data/office-layout";
import { LIVE_3D_CHARACTERS, isLive3dEligible, resolveLive3dGlbUrl } from "./live3dCharacters";
import type { Live3dAssetSet } from "./live3dCharacters";

// Just the GLB paths of an entry — the registry also carries non-path strings
// (idleProfile), so "every string value is a url" is not a safe filter.
function glbUrlsOf(entry: Live3dAssetSet): string[] {
  return Object.entries(entry)
    .filter(([key, value]) => typeof value === "string" && key.toLowerCase().endsWith("glburl"))
    .map(([, value]) => value as string);
}

// Asset-file integrity (old jerevon + bon-v2 rollback sets present + unmodified, bon-v3 files present) is
// verified in the shell as part of the commit validation (sha256 of public/avatars/jerevon/*),
// since the app tsconfig has no Node typings for fs access from tests.
describe("live3dCharacters registry (bon-v3 + alex-v2 2026-08-30; micah-v4 + angelo added 2026-08-30; masculine idle profile 2026-08-31)", () => {
  it("bon resolves to the bon-v3-hq-idle9 LODs per tier: T2 lod0, T1 lod1, static-frame bucket lod2", () => {
    const bon = LIVE_3D_CHARACTERS.bon;
    // Promoted 2026-08-30 to the bon-v3 set (built from the approved T-pose
    // master); the bon-v2 and jerevon sets stay on disk as rollbacks and must
    // NOT be referenced by the registry.
    // Promoted again 2026-08-31 to the masculine-idle rebuild of the same
    // geometry; the Idle_12-era bon-v3-hq set joins the rollbacks.
    expect(resolveLive3dGlbUrl(bon, "T2", false)).toMatch(/\/avatars\/bon-v3-hq-idle9\/bon-v3-lod0\.glb$/);
    expect(resolveLive3dGlbUrl(bon, "T1", false)).toMatch(/\/avatars\/bon-v3-hq-idle9\/bon-v3-lod1\.glb$/);
    expect(resolveLive3dGlbUrl(bon, "T0", true)).toMatch(/\/avatars\/bon-v3-hq-idle9\/bon-v3-lod2\.glb$/);
    // Manifest aspect for bon is 26.23 / 37.2 — render size must keep it.
    expect(bon.renderWidth / bon.renderHeight).toBeCloseTo(26.23 / 37.2, 2);
    for (const url of glbUrlsOf(bon)) {
      expect(url).toMatch(/\/avatars\/bon-v3-hq-idle9\//);
      expect(url).not.toMatch(/\/avatars\/bon-v3-hq\//);
    }
  });

  it("alex resolves to the alex-v2-hq-idle9 LODs per tier: T2 lod0, T1 lod1, static-frame bucket lod2", () => {
    const alex = LIVE_3D_CHARACTERS.alex;
    expect(resolveLive3dGlbUrl(alex, "T2", false)).toMatch(/\/avatars\/alex-v2-hq-idle9\/alex-v2-lod0\.glb$/);
    expect(resolveLive3dGlbUrl(alex, "T1", false)).toMatch(/\/avatars\/alex-v2-hq-idle9\/alex-v2-lod1\.glb$/);
    expect(resolveLive3dGlbUrl(alex, "T0", true)).toMatch(/\/avatars\/alex-v2-hq-idle9\/alex-v2-lod2\.glb$/);
    // Manifest aspect for alex is 20 / 34.46 — render size must keep it.
    expect(alex.renderWidth / alex.renderHeight).toBeCloseTo(20 / 34.46, 2);
  });

  it("micah resolves to the micah-v5-hq LODs per tier: T2 lod0, T1 lod1, static-frame bucket lod2", () => {
    const micah = LIVE_3D_CHARACTERS.micah;
    expect(resolveLive3dGlbUrl(micah, "T2", false)).toMatch(/\/avatars\/micah-v5-hq\/micah-v5-lod0\.glb$/);
    expect(resolveLive3dGlbUrl(micah, "T1", false)).toMatch(/\/avatars\/micah-v5-hq\/micah-v5-lod1\.glb$/);
    expect(resolveLive3dGlbUrl(micah, "T0", true)).toMatch(/\/avatars\/micah-v5-hq\/micah-v5-lod2\.glb$/);
    // Manifest aspect for micah is 24.36 / 39.10 — render size must keep it.
    expect(micah.renderWidth / micah.renderHeight).toBeCloseTo(24.36 / 39.1, 2);
    // the rejected v1/v2/v3 chains must never be referenced
    for (const url of glbUrlsOf(micah)) {
      expect(url).toMatch(/\/avatars\/micah-v5-hq\//);
      // every superseded chain stays on disk as a rollback but must never be referenced
      expect(url).not.toMatch(/avatars\/micah\/|micah-v2|micah-v3|micah-v4/);
    }
  });

  it("angelo resolves to the gelo-v1-hq-idle9 LODs per tier: T2 lod0, T1 lod1, static-frame bucket lod2", () => {
    // Registry KEY is the roster/manifest id `angelo`; only the asset files
    // carry the pipeline chain name `gelo-v1`.
    const angelo = LIVE_3D_CHARACTERS.angelo;
    expect(resolveLive3dGlbUrl(angelo, "T2", false)).toMatch(/\/avatars\/gelo-v1-hq-idle9\/gelo-v1-lod0\.glb$/);
    expect(resolveLive3dGlbUrl(angelo, "T1", false)).toMatch(/\/avatars\/gelo-v1-hq-idle9\/gelo-v1-lod1\.glb$/);
    expect(resolveLive3dGlbUrl(angelo, "T0", true)).toMatch(/\/avatars\/gelo-v1-hq-idle9\/gelo-v1-lod2\.glb$/);
    // Manifest aspect for angelo is 28.18 / 39.85 — render size must keep it.
    expect(angelo.renderWidth / angelo.renderHeight).toBeCloseTo(28.18 / 39.85, 2);
  });

  it("registry holds exactly bon, alex, micah, angelo and jan; none references a rollback or another character's assets", () => {
    expect(Object.keys(LIVE_3D_CHARACTERS).sort()).toEqual(["alex", "angelo", "bon", "jan", "micah"]);
    expect(isLive3dEligible("alex")).toBe(true);
    expect(isLive3dEligible("micah")).toBe(true);
    expect(isLive3dEligible("angelo")).toBe(true);
    expect(isLive3dEligible("jan")).toBe(true);
    expect(isLive3dEligible("lui")).toBe(false);
    for (const url of glbUrlsOf(LIVE_3D_CHARACTERS.bon)) {
      expect(url).not.toMatch(/jerevon|alex/);
      // the bon-v2 rollback set must not be referenced either
      expect(url).not.toMatch(/bon-v2/);
    }
    for (const url of glbUrlsOf(LIVE_3D_CHARACTERS.alex)) {
      expect(url).toMatch(/\/avatars\/alex-v2-hq-idle9\//);
      expect(url).not.toMatch(/\/avatars\/alex-v2-hq\//);
      expect(url).not.toMatch(/bon/);
    }
    for (const url of glbUrlsOf(LIVE_3D_CHARACTERS.angelo)) {
      expect(url).toMatch(/\/avatars\/gelo-v1-hq-idle9\//);
      expect(url).not.toMatch(/\/avatars\/gelo-v1-hq\//);
    }
    for (const url of glbUrlsOf(LIVE_3D_CHARACTERS.jan)) {
      expect(url).toMatch(/\/avatars\/jan-v1-hq-idle9\//);
      expect(url).not.toMatch(/gelo|bon|alex|micah/);
    }
  });

  it("jan resolves to the jan-v1-hq-idle9 LODs per tier: T2 lod0, T1 lod1, static-frame bucket lod2", () => {
    // Registry KEY is the roster/manifest id `jan`; only the asset files carry
    // the pipeline chain name `jan-v1`. Built 2026-09-04, masculine from day one.
    const jan = LIVE_3D_CHARACTERS.jan;
    expect(resolveLive3dGlbUrl(jan, "T2", false)).toMatch(/\/avatars\/jan-v1-hq-idle9\/jan-v1-lod0\.glb$/);
    expect(resolveLive3dGlbUrl(jan, "T1", false)).toMatch(/\/avatars\/jan-v1-hq-idle9\/jan-v1-lod1\.glb$/);
    expect(resolveLive3dGlbUrl(jan, "T0", true)).toMatch(/\/avatars\/jan-v1-hq-idle9\/jan-v1-lod2\.glb$/);
    // Manifest aspect for jan is 28.18 / 39.85 — render size must keep it.
    expect(jan.renderWidth / jan.renderHeight).toBeCloseTo(28.18 / 39.85, 2);
  });
});

// Part B: the visible head-to-label gap must be the SAME for every live-3D
// employee, and must not depend on how much vertical animation headroom their
// layer box happens to carry.
describe("head-to-label gap", () => {
  const LAYER_HEIGHT: Record<string, number> = {
    bon: 37.2, alex: 34.46, micah: 39.1, angelo: 39.85, jan: 39.85,
  };
  // What the OLD layer-top anchor produced: head sits this far below the box
  // top, so the gap differed per character (this is the bug).
  const OLD_GAP: Record<string, number> = {
    bon: 4.002, alex: 2.937, micah: 4.686, angelo: 5.489,
  };

  it("every registered character carries a measured head offset", () => {
    for (const id of Object.keys(LIVE_3D_CHARACTERS)) {
      expect(LIVE_3D_CHARACTERS[id].headTopAboveCenter).toBeGreaterThan(0);
    }
  });

  it("reproduces the defect: the old layer-top anchor gave four different gaps", () => {
    const gaps = Object.values(OLD_GAP);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(2);
  });

  it("all four employees now share one gap, in their own layer AND in bon's seat box", () => {
    // rosterLayers.ts sizes every seated peer from bonLayer, so the same
    // character renders in a different box as a peer than as self. The gap must
    // survive both.
    for (const box of [null, 37.2] as const) {
      const gaps = Object.entries(LAYER_HEIGHT).map(([id, ownHeight]) => {
        const height = box ?? ownHeight;
        const head = LIVE_3D_CHARACTERS[id].headTopAboveCenter!;
        const { topPct } = greetingAnchor({ x: 0, y: 0, width: 10, height }, head);
        const labelY = (topPct / 100) * FRAME_HEIGHT;
        return height / 2 - head - labelY;
      });
      for (const g of gaps) expect(g).toBeCloseTo(HEAD_LABEL_GAP_FRAME_UNITS, 9);
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1e-9);
    }
  });

  it("the shared gap is the deliberate 2, tightened from bon's original 4.002", () => {
    // Was pinned to bon's own measured gap (4.002) when the shared anchor
    // landed; tightened to 3 and then 2 on 2026-08-31 per live visual review.
    // Pinned exactly so a future drift is a decision, not an accident — and it
    // stays BELOW the old per-character spread, which is the point of the
    // constant.
    expect(HEAD_LABEL_GAP_FRAME_UNITS).toBe(2);
    expect(HEAD_LABEL_GAP_FRAME_UNITS).toBeLessThan(OLD_GAP.bon);
  });
});

// Explicit masculine/feminine idle profiles (2026-08-31). Before this, every
// character was generated on Meshy Idle_12 because the pipeline standard named
// that one clip unconditionally, and the choice existed only as prose in each
// registry comment.
describe("idle profiles", () => {
  const MASCULINE = ["alex", "angelo", "bon", "jan"];

  it("every registered character declares a profile", () => {
    for (const [id, entry] of Object.entries(LIVE_3D_CHARACTERS)) {
      expect(["masculine", "feminine"], id).toContain(entry.idleProfile);
    }
  });

  it("bon, alex, angelo and jan are masculine; micah is the one feminine idle", () => {
    const byProfile = (profile: string) =>
      Object.keys(LIVE_3D_CHARACTERS)
        .filter((id) => LIVE_3D_CHARACTERS[id].idleProfile === profile)
        .sort();
    expect(byProfile("masculine")).toEqual(MASCULINE);
    expect(byProfile("feminine")).toEqual(["micah"]);
  });

  it("a masculine declaration is backed by an Idle_9 asset set, and only those", () => {
    // The `-idle9` asset folder is the only machine-checkable link between the
    // declaration and the GLB that actually ships, so a rebuild that forgets
    // one of the three (or points micah at an Idle_9 build) fails here.
    for (const [id, entry] of Object.entries(LIVE_3D_CHARACTERS)) {
      for (const url of glbUrlsOf(entry)) {
        if (entry.idleProfile === "masculine") expect(url, id).toMatch(/-hq-idle9\//);
        else expect(url, id).not.toMatch(/-idle9\//);
      }
    }
  });

  it("micah's feminine set is unchanged by the split (still micah-v5-hq)", () => {
    expect(resolveLive3dGlbUrl(LIVE_3D_CHARACTERS.micah, "T2", false)).toMatch(
      /\/avatars\/micah-v5-hq\/micah-v5-lod0\.glb$/,
    );
  });
});
