// THE HUMANBASE GAIT TABLE IS A MEASUREMENT, pinned here: the built shared walk/run clips are posed at exact times on a real
// composed body and the stance foot's backward speed against the root is what the clip covers at rate 1. If the clips are
// ever rebuilt, this fails until avatar/gait's HUMANBASE_CLIP_GROUND_SPEED is re-measured — feet would skate otherwise.
import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only).
import fs from "node:fs";
import type { EmployeeAvatar } from "../human/humanBaseContract";
import { BON_AVATAR, CATALOGUE_BY_ID, HUMAN_BASE_URL } from "../human/humanCatalogue";
import { HumanAvatar, setGlbFetcher } from "../human/HumanAvatar";
import { loadHumanGlb, publicPath } from "../human/humanGlb.testutil";
import { HUMANBASE_CLIP_GROUND_SPEED, locomotion } from "./gait";
import { PLAYER_SPRINT_SPEED, PLAYER_WALK_SPEED } from "../player/PlayerMode";

/** mean backward speed of each foot across its ground-contact runs (u/s at rate 1), and the hands' fore-aft swing (u) */
function measure(a: HumanAvatar, clip: string, N = 240): { speed: number; armSwing: number; shoulderY: number; chestZ: number; footMin: number } {
  a.play(clip, 0);
  const act = a.actionFor(clip)!, dur = act.getClip().duration;
  act.timeScale = 0;
  const rows: Record<string, THREE.Vector3>[] = [];
  for (let i = 0; i <= N; i++) {
    act.time = (dur * i) / N; a.update(0);
    const p = (n: string) => a.bones.get(n)!.getWorldPosition(new THREE.Vector3());
    rows.push({ L: p("LeftFoot"), R: p("RightFoot"), hL: p("LeftHand"), hR: p("RightHand"), sL: p("LeftArm"), sR: p("RightArm"), neck: p("neck") });
  }
  const speeds: number[] = [];
  for (const f of ["L", "R"]) {
    const ys = rows.map((r) => r[f].y), lo = Math.min(...ys), hi = Math.max(...ys);
    const down = ys.map((y) => y - lo < 0.15 * (hi - lo));
    for (let i = 0; i <= N; i++) {
      if (!down[i] || (i > 0 && down[i - 1])) continue;
      let j = i; while (j < N && down[j + 1]) j++;
      if (j - i >= 4) speeds.push((rows[i][f].z - rows[j][f].z) / (((j - i) * dur) / N));
      i = j;
    }
  }
  const swing = (k: string) => Math.max(...rows.map((r) => r[k].z)) - Math.min(...rows.map((r) => r[k].z));
  const mean = (f: (r: Record<string, THREE.Vector3>) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  return { speed: speeds.reduce((s, v) => s + v, 0) / speeds.length, armSwing: (swing("hL") + swing("hR")) / 2, shoulderY: mean((r) => (r.sL.y + r.sR.y) / 2), chestZ: mean((r) => r.neck.z), footMin: Math.min(...rows.map((r) => Math.min(r.L.y, r.R.y))) };
}

describe.skipIf(!fs.existsSync(publicPath(HUMAN_BASE_URL)))("HumanBase gait calibration (the shared clips, measured)", () => {
  beforeAll(() => setGlbFetcher(loadHumanGlb));
  it("HUMANBASE_CLIP_GROUND_SPEED is what the shared walking/running clips actually cover", async () => {
    const a = await HumanAvatar.create(structuredClone(BON_AVATAR) as EmployeeAvatar, CATALOGUE_BY_ID);
    a.clearance.enabled = false;   // the clip's own feet, not the arm layer
    const idle = measure(a, "idle-masculine"), walk = measure(a, "walking"), run = measure(a, "running");
    a.removeLayer("gait-posture");
    const rawWalk = measure(a, "walking"), rawRun = measure(a, "running");
    expect(Math.abs(walk.speed - HUMANBASE_CLIP_GROUND_SPEED.walking) / walk.speed).toBeLessThan(0.15);
    expect(Math.abs(run.speed - HUMANBASE_CLIP_GROUND_SPEED.running) / run.speed).toBeLessThan(0.15);
    // GAIT POSTURE: the clip alone drops the shoulder joints ~2.6 u below the idle's; the shared layer keeps them at the
    // idle's height (upright, not drooped) and the torso hunch mostly out — and the arm swing smaller
    expect(idle.shoulderY - rawWalk.shoulderY).toBeGreaterThan(1.5);
    expect(Math.abs(idle.shoulderY - walk.shoulderY), "walking shoulders at the idle's height").toBeLessThan(0.9);
    expect(Math.abs(walk.chestZ - idle.chestZ)).toBeLessThan(Math.abs(rawWalk.chestZ - idle.chestZ));
    // THE BRISK STRIDE: the drawn walk covers more ground per cycle than the clip alone, and its feet never go below
    // the clip's own lowest point (no sinking through the floor at the longer reach)
    expect(walk.speed).toBeGreaterThan(rawWalk.speed * 1.25);
    expect(walk.footMin).toBeGreaterThan(rawWalk.footMin - 0.25);
    expect(walk.armSwing).toBeLessThan(rawWalk.armSwing * 0.8);
    expect(run.armSwing).toBeLessThan(rawRun.armSwing * 0.9);
  }, 120_000);

  it("the office walk is a foot-locked WALK and the sprint a foot-locked RUN on a HumanBase body", () => {
    const w = locomotion("humanbase", PLAYER_WALK_SPEED, false, true, null);
    expect(w.clip).toBe("walking");
    expect(w.rate * HUMANBASE_CLIP_GROUND_SPEED.walking).toBeCloseTo(PLAYER_WALK_SPEED, 5);   // no skating
    const r = locomotion("humanbase", PLAYER_SPRINT_SPEED, true, true, "walking");
    expect(r.clip).toBe("running");
    expect(r.rate * HUMANBASE_CLIP_GROUND_SPEED.running).toBeCloseTo(PLAYER_SPRINT_SPEED, 5);
    // a walk does not flip to the run on an ordinary speed wobble
    expect(locomotion("humanbase", PLAYER_WALK_SPEED * 1.3, false, true, "walking").clip).toBe("walking");
  });
});
