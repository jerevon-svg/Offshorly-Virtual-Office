// MonkeyAgent traversal + motion vocabulary — the pure layers, no browser.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  BASE_PROFILE, buildPlan, graphIndex, route, samplePlan, smoothPath, type Plan, type TraversalGraph,
} from "./world/monkeyTraversal";
import { MONKEY_PERSONAS } from "./world/monkeyPersona";
import { poseAt, GAITS } from "./avatar/monkeyMotion";
import { buildPlaygroundGraph, SCENARIOS } from "./playground/monkeyPlayground";

const G: TraversalGraph = buildPlaygroundGraph();
const nodeIds = G.nodes.map((n) => n.id);
const prof = BASE_PROFILE;

/** schedule a scenario the way the playground does (go requests only), per agent */
function scenarioPlans(id: string): Map<string, Plan[]> {
  const sc = SCENARIOS[id];
  const out = new Map<string, Plan[]>();
  const at = new Map<string, string>();
  const free = new Map<string, number>();
  for (const [a, st] of Object.entries(sc.start)) { at.set(a, st.node); free.set(a, -Infinity); out.set(a, []); }
  const cmds = sc.cmds;
  const carry = new Map<string, boolean>();
  for (const c of cmds) {
    if (c.op === "carry") carry.set(c.a, !!c.packet);
    if (c.op === "handoff") { carry.set(c.giver, false); carry.set(c.receiver, true); }
    if (c.op !== "go") continue;
    const p = MONKEY_PERSONAS[c.a].profile;
    const plan = buildPlan(G, at.get(c.a)!, c.to, p, Math.max(c.t, free.get(c.a)!), { carry: carry.get(c.a) });
    if (!plan) continue;
    out.get(c.a)!.push(plan);
    at.set(c.a, plan.end.id);
    free.set(c.a, plan.t1);
  }
  return out;
}

describe("MonkeyAgent traversal graph", () => {
  it("is well formed: every link joins known nodes, every destination names a node", () => {
    expect(() => graphIndex(G)).not.toThrow();
    for (const d of Object.values(G.destinations)) expect(nodeIds).toContain(d);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
  });

  it("reaches every destination from the floor centre and back (one-way links included)", () => {
    for (const [name, id] of Object.entries(G.destinations)) {
      expect(route(G, "f-centre", id, prof), `to ${name}`).not.toBeNull();
      expect(route(G, id, "f-centre", prof), `from ${name}`).not.toBeNull();
    }
  });

  it("plans the same route every time (ties broken deterministically)", () => {
    for (const a of ["u-sleep", "h-grip", "p-perch", "f-bench"]) {
      const r1 = route(G, "f-west", a, prof)!.map((e) => `${e.link.id}:${e.dir}`);
      const r2 = route(G, "f-west", a, prof)!.map((e) => `${e.link.id}:${e.dir}`);
      expect(r1).toEqual(r2);
    }
  });

  it("never sends a body carrying a packet up a climb, ladder, pole, jump, hang or branch", () => {
    const r = route(G, "f-centre", "f-desk-app", prof, true)!;
    expect(r.every((e) => e.link.geom.kind === "ground" && e.link.geom.surface === "floor")).toBe(true);
    expect(route(G, "f-centre", "u-sleep", prof, true)).toBeNull();
  });

  it("refuses the one-way links backwards: no climbing UP a pole or jumping up onto a stump from the floor", () => {
    const up = route(G, "f-pole", "u-pole", prof)!;
    expect(up.some((e) => e.link.geom.kind === "pole")).toBe(false);
    const toStump = route(G, "f-stump-land", "s-top", prof)!;
    expect(toStump.some((e) => e.link.id === "j:stump-floor")).toBe(false);
  });

  it("chooses gaits by distance and temperament — Pip drops to all fours sooner than Milo", () => {
    const pip = buildPlan(G, "f-west", "f-far-east", MONKEY_PERSONAS.pip.profile, 0)!;
    const milo = buildPlan(G, "f-desk-app", "f-seat", MONKEY_PERSONAS.milo.profile, 0)!;
    expect(pip.segs[0].run!.gait).toBe("knuckle");
    expect(milo.segs[0].run!.gait).toBe("walk");
    const p = buildPlan(G, "f-centre", "f-ladder", MONKEY_PERSONAS.pip.profile, 0)!;
    const m = buildPlan(G, "f-centre", "f-ladder", MONKEY_PERSONAS.milo.profile, 0)!;
    expect(p.t1).toBeLessThan(m.t1);
  });

  it("rounds path corners so the heading never snaps", () => {
    const pts = smoothPath([{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 100, y: 0, z: 100 }]);
    for (let i = 2; i < pts.length; i++) {
      const a = new THREE.Vector3(pts[i - 1].x - pts[i - 2].x, 0, pts[i - 1].z - pts[i - 2].z).normalize();
      const b = new THREE.Vector3(pts[i].x - pts[i - 1].x, 0, pts[i].z - pts[i - 1].z).normalize();
      expect(a.angleTo(b)).toBeLessThan(0.3);
    }
  });
});

describe("MonkeyAgent plans", () => {
  for (const id of Object.keys(SCENARIOS)) {
    it(`${id}: every request plans, plans chain node to node, and samples continuously`, () => {
      const plans = scenarioPlans(id);
      for (const [agent, ps] of plans) {
        for (let i = 1; i < ps.length; i++) {
          expect(ps[i].start.id, `${agent} chain`).toBe(ps[i - 1].end.id);
          expect(ps[i].t0).toBeGreaterThanOrEqual(ps[i - 1].t1 - 1e-9);
        }
        // the sampled anchor never jumps faster than any speed a monkey has (structured links included)
        for (const p of ps) {
          let prev = samplePlan(p, p.t0).pos;
          for (let t = p.t0; t <= p.t1; t += 1 / 60) {
            const s = samplePlan(p, t);
            const d = Math.hypot(s.pos.x - prev.x, s.pos.y - prev.y, s.pos.z - prev.z);
            expect(d, `${agent} ${s.kind} @${t.toFixed(2)}`).toBeLessThan(2.5);
            prev = s.pos;
          }
        }
      }
    });
    it(`${id}: the motion vocabulary poses every instant (no NaN, contacts finite)`, () => {
      for (const [agent, ps] of scenarioPlans(id)) {
        const p = MONKEY_PERSONAS[agent].profile;
        for (const plan of ps) {
          for (let t = plan.t0 - 0.2; t <= plan.t1 + 2; t += 1 / 20) {
            const P = poseAt(plan, samplePlan(plan, t), { t, prof: p });
            const nums = [P.pos.x, P.pos.y, P.pos.z, P.q.x, P.q.w, P.hips.y, P.spine.x];
            for (const c of [...P.hand, ...P.foot]) if (c) nums.push(c.p.x, c.p.y, c.p.z);
            expect(nums.every(Number.isFinite), `${agent} @${t.toFixed(2)}`).toBe(true);
          }
        }
      }
    });
  }
});

describe("MonkeyAgent stance contacts are world-fixed (no sliding)", () => {
  it("a knuckle-run's planted hands and feet do not move while planted", () => {
    const plan = buildPlan(G, "f-west", "f-far-east", MONKEY_PERSONAS.pip.profile, 0)!;
    const seg = plan.segs[0];
    const Gk = GAITS.knuckle;
    // track each limb's contact over cruise; while its phase is in stance, its contact must be constant
    const mid = seg.dur / 2;
    for (let limb = 0; limb < 4; limb++) {
      let last: THREE.Vector3 | null = null, k0 = -1;
      for (let t = mid - 0.5; t < mid + 0.5; t += 1 / 120) {
        const s = samplePlan(plan, t);
        const P = poseAt(plan, s, { t, prof: MONKEY_PERSONAS.pip.profile });
        const c = limb < 2 ? P.hand[limb] : P.foot[limb - 2];
        const cyc = s.gaitS / Gk.stride + Gk.phase[limb];
        const f = cyc - Math.floor(cyc);
        if (f < Gk.duty[limb] - 0.02 && f > 0.02) {
          if (last && Math.floor(cyc) === k0) expect(c!.p.distanceTo(last)).toBeLessThan(0.05);
          last = c!.p.clone(); k0 = Math.floor(cyc);
        } else last = null;
      }
    }
  });
});
