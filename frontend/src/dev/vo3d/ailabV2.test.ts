// AI Lab V2 — the treehouse Lab blockout's data: placement, collision, traversal, headroom, ergonomics, sightlines.
import { describe, expect, it } from "vitest";
import {
  RAMP, BRIEF_SPOTS, CANOPY, FUTURE_PODS, HANDOFFS, HANG, HEADROOM, JUMP_PAD, L1, L2, LAB2_PLINTH, STAIR, POLE, STATION, RESIDENCE, IDLE_SPOTS, CLIMB, l1Slot,
  SW_BRANCH, TREE, TRUNK, WALK2, WALL_SEGS_V2, WEST_LIMB, aiLabV2StandTest, buildLabV2Graph, inAiLabV2Zone, l1Rim, l2Rim, labV2Solids,
} from "./world/ailabV2";
import { LAB_ARRIVAL, PATH_LINK, WALL_SEGS } from "./world/ailab";
import { AI_LAB_SITE } from "./world/construction";
import { POND, POND_SHORE, PODIUM } from "./world/campus";
import { buildPlan, graphIndex, route, samplePlan, type V3 } from "./world/monkeyTraversal";
import { MONKEY_PERSONAS } from "./world/monkeyPersona";
import { LAB_V2_SCENARIOS } from "./world/labV2Scenarios";
import { STATIONS, STATION_TEMPLATES, assignStation, toWorld } from "./world/labStations";
import { chooseVisible, LAB_VISIBILITY } from "./world/labPopulation";
import type { Vec2 } from "./core/coords";

const G = buildLabV2Graph();
const ix = graphIndex(G);
const inPoly = (p: Vec2, poly: readonly Vec2[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};
/** the shore band's outer edge, as an ellipse test (the pond outline is close to its ellipse) */
const inShore = (p: Vec2, margin = 0) => ((p.x - POND.x) / (POND.rx + POND_SHORE + margin)) ** 2 + ((p.z - POND.z) / (POND.rz + POND_SHORE + margin)) ** 2 <= 1;

describe("AI Lab V2 — placement", () => {
  it("keeps the V1 centre line, entrance, porch and lake openings", () => {
    const xs = WALL_SEGS_V2.flatMap(([a, b]) => [a.x, b.x]);
    expect(Math.min(...xs)).toBe(100);
    expect(Math.max(...xs)).toBe(1380);
    // the south entrance and north lake gaps are exactly V1's
    const gap = (segs: typeof WALL_SEGS, z: number) => segs.filter(([a, b]) => a.z === z && b.z === z).flatMap(([a, b]) => [a.x, b.x]).sort((p, q) => p - q);
    expect(gap(WALL_SEGS_V2, -440)).toEqual(expect.arrayContaining([654, 826]));
    expect(gap(WALL_SEGS_V2, -980)).toEqual(expect.arrayContaining([676, 804]));
  });
  it("stands clear of the office podium, the lake's shore band (with 25 to spare) and the PATH_LINK causeway", () => {
    for (const p of LAB2_PLINTH) {
      expect(p.z).toBeLessThan(PODIUM.z - 200);
      expect(inShore(p, 25), `plinth vertex ${p.x},${p.z}`).toBe(false);
    }
    for (let i = 0; i < LAB2_PLINTH.length; i++) {
      const a = LAB2_PLINTH[i], b = LAB2_PLINTH[(i + 1) % LAB2_PLINTH.length];
      for (let k = 0; k <= 20; k++) expect(inShore({ x: a.x + ((b.x - a.x) * k) / 20, z: a.z + ((b.z - a.z) * k) / 20 }, 10)).toBe(false);
    }
    for (const [x, z] of [[PATH_LINK.x, PATH_LINK.z], [PATH_LINK.x + PATH_LINK.w, PATH_LINK.z]]) expect(inPoly({ x, z }, LAB2_PLINTH)).toBe(false);
    for (const pod of FUTURE_PODS) expect(inPoly({ x: pod.x + pod.w / 2, z: pod.z + pod.d / 2 }, LAB2_PLINTH)).toBe(true);
  });
  it("leaves the construction scaffold on the south wall's west run, and its yard outside the plinth", () => {
    const sc = AI_LAB_SITE.scaffold!;
    const run = WALL_SEGS_V2.find(([a, b]) => a.z === -440 && b.z === -440 && Math.min(a.x, b.x) <= sc.x0 && Math.max(a.x, b.x) >= sc.x1);
    expect(run).toBeTruthy();
    const y = AI_LAB_SITE.yard;
    expect(inPoly({ x: y.x + y.w / 2, z: y.z + y.d / 2 }, LAB2_PLINTH)).toBe(false);
  });
});

describe("AI Lab V2 — the player can walk it", () => {
  it("hands over to the V2 test exactly where V1's did at the porch", () => {
    expect(inAiLabV2Zone(LAB_ARRIVAL, 8)).toBe(true);
    expect(aiLabV2StandTest(LAB_ARRIVAL, 8)).toBe(true);
  });
  it("every adjoining pair of walk rects overlaps by more than a body", () => {
    const [core, west, east] = WALK2;
    const ov = (a: typeof core, b: typeof core) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    expect(ov(core, west)).toBeGreaterThan(16);
    expect(ov(core, east)).toBeGreaterThan(16);
  });
  it("reaches every zone of the floor from the porch (flood fill at body radius)", () => {
    const step = 8, R = 8, seen = new Set<string>(), q: Vec2[] = [LAB_ARRIVAL];
    const key = (p: Vec2) => `${Math.round(p.x / step)},${Math.round(p.z / step)}`;
    seen.add(key(LAB_ARRIVAL));
    while (q.length) {
      const p = q.pop()!;
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const n = { x: p.x + dx, z: p.z + dz };
        if (n.z > -360 || seen.has(key(n)) || !aiLabV2StandTest(n, R)) continue;
        seen.add(key(n)); q.push(n);
      }
    }
    const reached = (x: number, z: number) => [...seen].some((k) => { const [a, b] = k.split(",").map(Number); return Math.hypot(a * step - x, b * step - z) < 14; });
    for (const [name, x, z] of [["nova", 300, -800], ["milo", 1150, -800], ["pip", 1150, -545], ["reserve", 300, -520], ["briefing", 740, -520], ["lake spur", 740, -950], ["west strip", 140, -700], ["east strip", 1340, -700]] as const)
      expect(reached(x, z), name).toBe(true);
  });
});

describe("AI Lab V2 — the treehouse is built to the MonkeyAgent body", () => {
  it("keeps the canopy masses above L2 (nothing grows through a deck or a pod)", () => {
    for (const c of CANOPY) expect(c.y - c.ry, `${c.x},${c.y},${c.z}`).toBeGreaterThan(L2.y + 14);
  });
  it("has ≥ 44 headroom under both decks", () => {
    expect(L1.y - L1.t).toBeGreaterThanOrEqual(HEADROOM);
    expect(L2.y - L2.t - L1.y).toBeGreaterThanOrEqual(HEADROOM);
  });
  it("puts every L1 / L2 node on its deck, clear of the trunk and outside the climb slot", () => {
    const slot = l1Slot();
    for (const n of G.nodes) {
      const p = { x: n.at.x, z: n.at.z };
      const dTrunk = Math.hypot(p.x - TREE.x, p.z - TREE.z);
      if (n.at.y === L1.y) {
        expect(inPoly(p, l1Rim()), `${n.id} on L1`).toBe(true);
        expect(inPoly(p, slot), `${n.id} in the climb slot`).toBe(false);
        expect(dTrunk, n.id).toBeGreaterThan(TRUNK.r + 8);
      }
      if (n.at.y === L2.y) {
        expect(inPoly(p, l2Rim()), `${n.id} on L2`).toBe(true);
        expect(dTrunk, n.id).toBeGreaterThan(TRUNK.rMid + 10);
      }
    }
  });
  it("sizes every structured route by the Phase 1 rules", () => {
    expect(SW_BRANCH.r).toBeGreaterThanOrEqual(4.5);
    expect(WEST_LIMB.r).toBeGreaterThanOrEqual(4.5);
    expect(Math.hypot(JUMP_PAD.x - JUMP_PAD.from.x, JUMP_PAD.z - JUMP_PAD.from.z)).toBeLessThanOrEqual(55);
    expect(Math.hypot(JUMP_PAD.land.x - JUMP_PAD.x, JUMP_PAD.land.z - JUMP_PAD.z)).toBeLessThanOrEqual(55);
    expect(Math.atan2(STAIR.top.y - STAIR.bottom.y, Math.hypot(STAIR.top.x - STAIR.bottom.x, STAIR.top.z - STAIR.bottom.z)) * 180 / Math.PI).toBeCloseTo(60, 0);
    expect(POLE.x - POLE.ledge.x).toBeCloseTo(1.5, 1);
    expect(POLE.z - POLE.ledge.z).toBeCloseTo(9, 1);
    expect(HANG.grip.y - HANG.stand.y).toBeCloseTo(17, 0);
    // the climb slot is ~34 wide for the head and ears, and leaves a bridge strip at the rim for the deck ring
    expect(CLIMB.slotHalf * 2).toBeGreaterThanOrEqual(30);
    expect(CLIMB.slotOut).toBeLessThan(96 - 12);
  });
  it("keeps every ground node and floor route clear of the floor solids", () => {
    const S = labV2Solids();
    const blocked = (p: Vec2, r: number) => S.rects.some((s) => p.x > s.x - r && p.x < s.x + s.w + r && p.z > s.z - r && p.z < s.z + s.d + r) || S.circles.some((c) => Math.hypot(p.x - c.x, p.z - c.z) < c.r + r);
    for (const n of G.nodes) if (n.at.y === 0 && n.action !== "work-seated") expect(blocked(n.at, 4), n.id).toBe(false);
    for (const l of G.links) {
      if (l.geom.kind !== "ground" || l.geom.surface !== "floor" || l.id === "r:ramp") continue;
      const pts = l.geom.path;
      for (let i = 1; i < pts.length; i++) for (let k = 0; k <= 10; k++) {
        const t = k / 10, p = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t };
        const y = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
        // the last stretch into a stool is the stool itself
        const endsAtStool = ix.node.get(l.to)?.action === "work-seated" && i === pts.length - 1 && t > 0.6;
        if (y === 0 && !endsAtStool) expect(blocked(p, 3), `${l.id} @${p.x.toFixed(0)},${p.z.toFixed(0)}`).toBe(false);
      }
    }
  });
});

describe("AI Lab V2 — the traversal graph", () => {
  const must = ["NOVA_HOME", "MILO_HOME", "PIP_HOME", "BRIEFING_RING", "NOVA_DESIGN_STATION", "MILO_BUILD_STATION", "PIP_QA_STATION", "ARTIFACT_DOCK", "HANDOFF_NOVA_MILO", "HANDOFF_MILO_PIP"];
  it("names every destination the orchestration layer needs", () => {
    for (const d of must) expect(G.destinations[d], d).toBeTruthy();
  });
  it("reaches every destination from the briefing ring and back", () => {
    for (const [name, id] of Object.entries(G.destinations)) {
      expect(route(G, "g-brief-pip", id, MONKEY_PERSONAS.pip.profile), `to ${name}`).not.toBeNull();
      expect(route(G, id, "g-brief-pip", MONKEY_PERSONAS.pip.profile), `from ${name}`).not.toBeNull();
    }
  });
  it("takes the routes the architecture — and each temperament — intends: Milo down the pole, Nova down the ramp, Pip off the limb", () => {
    const kinds = (from: string, to: string, who: keyof typeof MONKEY_PERSONAS) => route(G, from, G.destinations[to] ?? to, MONKEY_PERSONAS[who].profile)!.map((e) => e.link.id);
    expect(kinds("u2-milo-home", "BRIEFING_MILO", "milo")).toContain("c:pole");
    expect(kinds("u1-nova-home", "BRIEFING_NOVA", "nova")).toContain("r:ramp");
    expect(kinds("b-tip", "BRIEFING_PIP", "pip").some((id) => id.startsWith("b:") || id.startsWith("h:"))).toBe(true);
    // the climb is how the floor reaches L1's east side
    expect(kinds("g-climb-foot", "CLIMB_TOP", "nova")).toEqual(["c:trunk"]);
  });
  it("carries a packet only on the floor: every station, dock and handoff spot is reachable hands-full", () => {
    for (const d of ["NOVA_DESIGN_STATION", "MILO_BUILD_STATION", "PIP_QA_STATION", "ARTIFACT_DOCK", "HANDOFF_NOVA_MILO", "HANDOFF_NOVA_MILO_RECV", "HANDOFF_MILO_PIP", "HANDOFF_MILO_PIP_RECV"]) {
      const r = route(G, G.destinations.DESIGN_01, G.destinations[d], MONKEY_PERSONAS.nova.profile, true);
      expect(r, d).not.toBeNull();
      expect(r!.every((e) => e.link.geom.kind === "ground" && e.link.geom.surface === "floor" && e.link.id !== "r:ramp" || e.link.id === "r:ramp")).toBe(true);
    }
  });
  it("plans and samples every proof scenario continuously", () => {
    for (const sc of Object.values(LAB_V2_SCENARIOS)) {
      const at = new Map(Object.entries(sc.start).map(([a, s]) => [a, s.node]));
      const free = new Map<string, number>();
      for (const c of sc.cmds) {
        if (c.op !== "go") continue;
        const plan = buildPlan(G, at.get(c.a)!, c.to, MONKEY_PERSONAS[c.a].profile, Math.max(c.t, free.get(c.a) ?? -Infinity));
        if (!plan) continue;
        let prev = samplePlan(plan, plan.t0).pos;
        for (let t = plan.t0; t <= plan.t1; t += 1 / 60) { const s = samplePlan(plan, t); expect(Math.hypot(s.pos.x - prev.x, s.pos.y - prev.y, s.pos.z - prev.z)).toBeLessThan(2.5); prev = s.pos; }
        at.set(c.a, plan.end.id); free.set(c.a, plan.t1);
      }
    }
  });
});

describe("AI Lab V2 — work floor ergonomics", () => {
  it("builds every station module to the monkey (stool 12 / bench 18 seated, bench 13 standing) with screens ≥ 14 in front", () => {
    expect(STATION).toEqual({ seat: 12, foot: 7, bench: 18, stand: 13 });
    for (const [type, t] of Object.entries(STATION_TEMPLATES)) {
      if (t.posture === "seated") { expect(t.seatY, type).toBe(12); expect(t.surfaceY, type).toBe(18); }
      for (const sc of t.screens) expect(-sc.z, `${type} ${sc.kind}`).toBeGreaterThanOrEqual(14);
    }
  });
  it("registers the stations as data: every kind of work, two of each on the floor, founders on their own", () => {
    const by = (type: string) => STATIONS.filter((s) => s.type === type);
    for (const t of ["design", "build", "review", "flex", "master"]) expect(by(t).length, t).toBeGreaterThanOrEqual(2);
    expect(new Set(STATIONS.map((s) => s.id)).size).toBe(STATIONS.length);
    expect(assignStation("design", new Set(), "nova")!.id).toBe("DESIGN_01");
    expect(assignStation("build", new Set(["BUILD_01"]))!.id).toBe("BUILD_02");
    expect(assignStation("review", new Set(["QA_01", "QA_02"]))?.id).toBe("FLEX_02");
    expect(assignStation("orchestration", new Set())!.type).toBe("master");
    // every station that can be reached has a graph node and a destination named after it
    for (const st of STATIONS.filter((x) => x.state !== "future")) expect(G.destinations[st.id], st.id).toBeTruthy();
    // modules never overlap one another
    const rects = STATIONS.filter((x) => x.at.y === 0).map((st) => { const a = toWorld(st, -60, -50), b = toWorld(st, 60, 6); return { st, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) }; });
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const A = rects[i], B = rects[j];
      const overlap = A.x0 < B.x1 - 4 && B.x0 < A.x1 - 4 && A.z0 < B.z1 - 4 && B.z0 < A.z1 - 4;
      expect(overlap, `${A.st.id} × ${B.st.id}`).toBe(false);
    }
  });
  it("sets every handoff pair side by side, 26 apart", () => {
    for (const h of Object.values(HANDOFFS)) { expect(h.take.x - h.give.x).toBe(26); expect(h.take.z).toBe(h.give.z); }
  });
});

describe("AI Lab V2 — the residence and its population seam", () => {
  it("has a way in, a way out onto the balcony, and an interior that is never drawn", () => {
    expect(route(G, "u2-res-door", "bal-door", MONKEY_PERSONAS.pip.profile)!.some((e) => e.link.geom.kind === "interior")).toBe(true);
    expect(ix.node.get("res-inside")!.action).toBe("inside");
    // from inside to any station: out of the door, down the tree, across the Lab
    expect(route(G, "res-inside", G.destinations.BUILD_02, MONKEY_PERSONAS.milo.profile)).not.toBeNull();
  });
  it("stands every residence volume on L2, its roofs under the crown's upper mass", () => {
    for (const v of [RESIDENCE.main, RESIDENCE.west, RESIDENCE.east]) {
      for (const [x, z] of [[v.x0, v.z0], [v.x1, v.z0], [v.x0, v.z1], [v.x1, v.z1]]) expect(inPoly({ x, z }, l2Rim()), `${x},${z}`).toBe(true);
      expect(v.ridge).toBeLessThan(CANOPY[3].y - CANOPY[3].ry);
    }
    expect(RESIDENCE.balcony.y - L2.y).toBeGreaterThanOrEqual(HEADROOM);
  });
  it("offers rest spots for a visible idle population beyond the founders' homes", () => {
    expect(IDLE_SPOTS.length + 6).toBeGreaterThanOrEqual(LAB_VISIBILITY.idle);
    for (let i = 0; i < IDLE_SPOTS.length; i++) for (let j = i + 1; j < IDLE_SPOTS.length; j++) {
      const a = IDLE_SPOTS[i].at, b = IDLE_SPOTS[j].at;
      if (a.y === b.y) expect(Math.hypot(a.x - b.x, a.z - b.z), `${IDLE_SPOTS[i].id} × ${IDLE_SPOTS[j].id}`).toBeGreaterThan(24);
    }
  });
  it("shows working agents first, then idle ones up to the budget; the rest are inside", () => {
    const agents = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `agent-${String(i).padStart(2, "0")}`, activity: "idle" as const })),
      { id: "milo", activity: "working" as const, founder: true }, { id: "nova", activity: "idle" as const, founder: true }, { id: "x-busy", activity: "assigned" as const },
    ];
    const v = chooseVisible(agents);
    // 2 busy + the idle cap (8) — the busy are never squeezed out, the idle never exceed their budget
    expect(v.visible.length).toBe(2 + LAB_VISIBILITY.idle);
    expect(v.visible.slice(0, 2)).toEqual(["milo", "x-busy"]);
    expect(v.visible).toContain("nova");
    expect(v.visible.length + v.inside.length).toBe(agents.length);
    expect(chooseVisible(agents)).toEqual(v);
  });
});

describe("AI Lab V2 — sightlines from the VO camera (pitch 52, from the south)", () => {
  // the head of a body standing at a node, and the ray from it back toward the camera
  const DIR = { x: 0, y: Math.sin((52 * Math.PI) / 180), z: Math.cos((52 * Math.PI) / 180) };
  const occluded = (p: V3): string | null => {
    const head = { x: p.x, y: p.y + 24, z: p.z };
    for (const c of CANOPY) {
      // test in the ellipsoid's own space (y scaled to make it a sphere of radius r)
      const k = c.r / c.ry;
      const h = { x: head.x, y: head.y * k, z: head.z }, C = { x: c.x, y: c.y * k, z: c.z };
      const d0 = { x: DIR.x, y: DIR.y * k, z: DIR.z }, dl = Math.hypot(d0.x, d0.y, d0.z), d = { x: d0.x / dl, y: d0.y / dl, z: d0.z / dl };
      const v = { x: C.x - h.x, y: C.y - h.y, z: C.z - h.z };
      if (Math.hypot(v.x, v.y, v.z) < c.r) return `inside canopy ${c.x},${c.y},${c.z}`;
      const s = v.x * d.x + v.y * d.y + v.z * d.z;
      if (s <= 0) continue;
      const q = { x: h.x + d.x * s - C.x, y: h.y + d.y * s - C.y, z: h.z + d.z * s - C.z };
      if (Math.hypot(q.x, q.y, q.z) < c.r) return `canopy ${c.x},${c.y},${c.z}`;
    }
    // the decks: where the ray crosses each deck's height, is it inside the deck?
    for (const [y, rim] of [[L1.y, l1Rim()], [L2.y, l2Rim()]] as const) {
      if (head.y >= y) continue;
      const s = (y - head.y) / DIR.y;
      const at = { x: head.x + DIR.x * s, z: head.z + DIR.z * s };
      if (inPoly(at, rim) && !(y === L1.y && inPoly(at, l1Slot()))) return `deck at ${y}`;
    }
    return null;
  };
  it("sees every home, briefing spot, station and handoff spot", () => {
    for (const d of ["NOVA_HOME", "MILO_HOME", "PIP_HOME", "PIP_HANG", "RESIDENCE_DOOR", "IDLE_BAL_W", "IDLE_BAL_E", "IDLE_L2_RAIL_S", "BRIEFING_NOVA", "BRIEFING_MILO", "BRIEFING_PIP", "NOVA_DESIGN_STATION", "MILO_BUILD_STATION", "PIP_QA_STATION", "ARTIFACT_DOCK", "HANDOFF_NOVA_MILO", "HANDOFF_MILO_PIP", "ROOT_SEAT_W", "ROOT_SEAT_E"]) {
      const n = ix.node.get(G.destinations[d])!;
      const at = d === "PIP_HANG" ? { ...n.at, y: n.at.y - 20 } : n.at;
      expect(occluded(at), d).toBeNull();
    }
    expect(BRIEF_SPOTS.pip.z).toBeGreaterThan(-560);
  });
  it("sees the agents ON every route: ramp, pole, stair, both branches, the jump — and the trunk climb, through its slot", () => {
    const samples: [string, V3][] = [
      ...RAMP.path.slice(1, 4).map((p, i) => [`ramp ${i}`, p] as [string, V3]),
      ...[100, 70, 40, 12].map((y) => [`pole @${y}`, { x: POLE.x + 7, y, z: POLE.z }] as [string, V3]),
      ...[0.2, 0.6, 0.9].map((k) => [`stair ${k}`, { x: STAIR.bottom.x + (STAIR.top.x - STAIR.bottom.x) * k + STAIR.out.x * 6, y: STAIR.bottom.y + (STAIR.top.y - STAIR.bottom.y) * k - 12, z: STAIR.bottom.z + (STAIR.top.z - STAIR.bottom.z) * k + STAIR.out.z * 6 }] as [string, V3]),
      ...[14, 30].map((y) => [`trunk climb @${y}`, { x: 740 + Math.cos((CLIMB.deg * Math.PI) / 180) * 32, y, z: -735 + Math.sin((CLIMB.deg * Math.PI) / 180) * 32 }] as [string, V3]),
      ...SW_BRANCH.path.slice(1, 3).map((p, i) => [`sw branch ${i}`, p] as [string, V3]),
      ...WEST_LIMB.path.slice(2).map((p, i) => [`limb ${i}`, p] as [string, V3]),
      ["jump pad", { x: JUMP_PAD.x, y: JUMP_PAD.y, z: JUMP_PAD.z }],
    ];
    for (const [name, p] of samples) expect(occluded(p), name).toBeNull();
  });
});
