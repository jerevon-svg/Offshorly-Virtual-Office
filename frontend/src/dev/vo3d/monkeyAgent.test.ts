// vo3d — MONKEYAGENT: P0 contract, the untouched reference, the P2 production base and the P3 cast.
// Reads the real GLBs in public/, so a re-export that drifts from the locked proportions, the shared
// skeleton, the region/garment seams or the budgets fails here.
//   · the REFERENCE master is the proportion spec — and must stay byte-for-byte untouched
//   · MonkeyAgent_Base_V1 must keep those proportions at every LOD (surface deviation measured against
//     the master) while carrying the employee 24-joint contract, repaired symmetric weights, seam-exact
//     regions, per-LOD face shells, markings and the employee clip names
//   · garments bind to the same skeleton by name and stay inside budget
//   · the demo identities are data on the one base, separate from their assignments
import { describe, expect, it, beforeAll } from "vitest";
// @ts-expect-error node:crypto is untyped under tsconfig.app.json (types: ["vite/client"] only).
import { createHash } from "node:crypto";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only).
import { readFileSync } from "node:fs";
import { NodeIO, type Document, type Primitive } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
// @ts-expect-error — draco3dgltf ships no type declarations
import draco3d from "draco3dgltf";
import {
  AGENT_OVERHEAD_PREFIX, BODY_REGIONS, MASTER_DROPPED_JOINTS, MASTER_TO_CONTRACT_JOINT, MONKEY_AGENT_STANDING_HEIGHT,
  MONKEY_BASE_LODS, MONKEY_BUDGETS, MONKEY_CLIP_CONTRACT, MONKEY_HEAD_RATIO, MONKEY_JOINT_LANDMARKS, MONKEY_NATIVE_HEIGHT,
  MONKEY_SKELETON_JOINTS, MONKEY_SKELETON_PARENTS, MONKEY_SOCKETS, agentOverheadKey, agentPillStatus, EXEC_STATE_LABEL,
  isAgentOverheadKey, presentationFor, regionMask, type AgentExecState, type BodyRegion,
} from "./world/monkeyAgentContract";
import { surfaceDeviation } from "./world/meshDeviation";
import { CHARACTER_ANIM_STATES } from "../../render3d/characterAnimationState";
import { BON_STANDING_HEIGHT } from "./adapters/v1Avatar";
import { SELF_OVERHEAD_KEY, TOUCAN_OVERHEAD_KEY } from "./app/Vo3dOverheads";
import { FOUNDER_IDENTITIES } from "./world/monkeyIdentities";
import { MONKEY_ACCESSORY_BUILDERS, MONKEY_GARMENT_URLS } from "./avatar/MonkeyAgentBody";

const MASTER = "public/avatars/monkey-base-v1/monkey-master.glb";
/** sha256 of the approved master as of 2026-10-01 — the reference may never be rewritten */
const MASTER_SHA256 = "a6c7ac08e34570bdd9e940ded81b3a4d734fc2fba8705d3e0df03161fc6fe0fc";
const BASE = "public/avatars/monkey-agent-base-v1/monkey-agent-base.glb";
const GARMENTS = "public/avatars/monkey-agent-base-v1/garments/";
const BON = "public/avatars/bon-v3-hq-idle9/bon-v3-lod2.glb";

let io: NodeIO;
beforeAll(async () => {
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
});
const bindPositions = (doc: Document): Map<string, number[]> =>
  new Map(doc.getRoot().listSkins()[0].listJoints().map((j) => [j.getName(), j.getWorldTranslation() as number[]]));
const primNamed = (doc: Document, name: string): Primitive | null =>
  doc.getRoot().listNodes().find((n) => n.getName() === name)?.getMesh()?.listPrimitives()[0] ?? null;
const tris = (p: Primitive) => p.getIndices()!.getCount() / 3;
const ALL_EXEC: AgentExecState[] = ["idle", "assigned", "working", "reviewing", "awaiting-approval", "changes-requested", "done", "blocked"];

describe("MonkeyAgent P0 contract", () => {
  it("locks the height to an employee's, and the clip names to the employee contract", () => {
    expect(MONKEY_AGENT_STANDING_HEIGHT).toBe(36);
    expect(MONKEY_AGENT_STANDING_HEIGHT).toBe(BON_STANDING_HEIGHT);
    expect([...MONKEY_CLIP_CONTRACT]).toEqual([...CHARACTER_ANIM_STATES]);
  });

  it("maps every one of the master's 28 joints to a contract joint (24 renamed + 4 folded end joints)", () => {
    expect(Object.keys(MASTER_TO_CONTRACT_JOINT)).toHaveLength(24);
    expect(new Set(Object.values(MASTER_TO_CONTRACT_JOINT))).toEqual(new Set(MONKEY_SKELETON_JOINTS));
    expect(Object.keys(MASTER_DROPPED_JOINTS)).toHaveLength(4);
  });

  it("has one parent tree rooted at Hips, and every socket hangs off a contract joint", () => {
    expect(MONKEY_SKELETON_JOINTS.filter((j) => MONKEY_SKELETON_PARENTS[j] === null)).toEqual(["Hips"]);
    for (const s of Object.values(MONKEY_SOCKETS)) expect(MONKEY_SKELETON_JOINTS).toContain(s.bone);
  });

  it("builds region hide masks that fit a 32-bit int", () => {
    expect(Object.values(BODY_REGIONS).every((v) => v >= 0 && v < 31)).toBe(true);
    expect(regionMask(["CHEST", "BELLY"])).toBe((1 << BODY_REGIONS.CHEST) | (1 << BODY_REGIONS.BELLY));
  });

  it("derives presentation from execution state only — typing is a work layer, never a seated clip standing", () => {
    for (const s of ALL_EXEC) {
      const stand = presentationFor(s, "standing"), sit = presentationFor(s, "seated");
      expect(MONKEY_CLIP_CONTRACT).toContain(stand.clip);
      expect(stand.clip.startsWith("sit")).toBe(false);
      expect(sit.clip.startsWith("sit")).toBe(true);
      expect(presentationFor(s)).toEqual(stand);
    }
    expect(presentationFor("working").overlay).toBe("typing");
    expect(presentationFor("idle").overlay).toBeUndefined();
  });

  it("formats the existing pill as identity + role · state, and keys it apart from people", () => {
    // VO's own display casing (the employee pill: "Bon · In Meeting") — never all caps
    expect(agentPillStatus({ name: "Milo" }, { role: "Dev" }, "working")).toEqual({ color: "#2376e5", shortName: "Milo", detail: "Dev · Working" });
    expect(agentPillStatus({ name: "Nova" }, { role: "Design" }, "assigned").detail).toBe("Design · Assigned");
    expect(agentPillStatus({ name: "Pip" }, { role: "Review" }, "reviewing").detail).toBe("Review · Reviewing");
    // idle is QUIET: the name and the dot, like an Available employee
    expect(agentPillStatus({ name: "Milo" }, { role: "Dev" }, "idle")).toEqual({ color: "#8a96a8", shortName: "Milo" });
    // the human-attention states are already in the vocabulary
    expect(agentPillStatus({ name: "Pip" }, { role: "Review" }, "awaiting-approval").detail).toBe("Review · Needs Approval");
    expect(agentPillStatus({ name: "Nova" }, { role: "Design" }, "needs-input").detail).toBe("Design · Needs Input");
    expect(agentPillStatus({ name: "Pip" }, null, "ready").detail).toBe("Ready");
    for (const label of Object.values(EXEC_STATE_LABEL)) expect(label).not.toBe(label.toUpperCase());
    const k = agentOverheadKey("milo");
    expect(k.startsWith(AGENT_OVERHEAD_PREFIX) && isAgentOverheadKey(k)).toBe(true);
    for (const other of [SELF_OVERHEAD_KEY, TOUCAN_OVERHEAD_KEY, "milo@offshorly.com"]) expect(isAgentOverheadKey(other)).toBe(false);
  });
});

describe("the reference master — the locked spec", () => {
  let master: Document;
  beforeAll(async () => { master = await io.read(MASTER); });

  it("is byte-for-byte the approved file (never rewritten)", () => {
    expect(createHash("sha256").update(readFileSync(MASTER)).digest("hex")).toBe(MASTER_SHA256);
  });

  it("is the locked native height and matches every joint landmark", () => {
    const pos = master.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute("POSITION")!;
    expect(pos.getMax([])[1] - pos.getMin([])[1]).toBeCloseTo(MONKEY_NATIVE_HEIGHT, 2);
    const bind = bindPositions(master);
    const byContract = new Map<string, number[]>(Object.entries(MASTER_TO_CONTRACT_JOINT).map(([m, c]) => [c, bind.get(m)!]));
    for (const [name, lm] of Object.entries(MONKEY_JOINT_LANDMARKS)) {
      const p = byContract.get(name)!;
      for (let k = 0; k < 3; k++) expect(Math.abs(p[k] - lm.at[k]), `${name}[${k}]`).toBeLessThanOrEqual(lm.tol);
    }
    const neckY = bind.get("mixamorig:Neck")![1];
    expect(Math.abs((MONKEY_NATIVE_HEIGHT - neckY) / MONKEY_NATIVE_HEIGHT - MONKEY_HEAD_RATIO.value)).toBeLessThanOrEqual(MONKEY_HEAD_RATIO.tol);
  });
});

describe("MonkeyAgent_Base_V1 (P2 production base)", () => {
  let doc: Document, master: Document, bon: Document;
  beforeAll(async () => { [doc, master, bon] = await Promise.all([io.read(BASE), io.read(MASTER), io.read(BON)]); });

  it("carries the EMPLOYEE 24-joint contract — same names, same order, same tree as an employee rig", () => {
    const skin = doc.getRoot().listSkins()[0];
    expect(skin.listJoints().map((j) => j.getName())).toEqual([...MONKEY_SKELETON_JOINTS]);
    expect(bon.getRoot().listSkins()[0].listJoints().map((j) => j.getName())).toEqual([...MONKEY_SKELETON_JOINTS]);
    for (const j of skin.listJoints()) {
      const want = MONKEY_SKELETON_PARENTS[j.getName() as keyof typeof MONKEY_SKELETON_PARENTS];
      const parent = j.getParentNode();
      expect(want === null ? !skin.listJoints().includes(parent!) : parent?.getName() === want, j.getName()).toBe(true);
    }
  });

  it("keeps the master's bind exactly (every joint landmark)", () => {
    const bind = bindPositions(doc);
    for (const [name, lm] of Object.entries(MONKEY_JOINT_LANDMARKS)) {
      const p = bind.get(name)!;
      for (let k = 0; k < 3; k++) expect(Math.abs(p[k] - lm.at[k]), `${name}[${k}]`).toBeLessThanOrEqual(lm.tol);
    }
  });

  it("ships exactly the employee clip names, once, shared by every LOD", () => {
    expect(doc.getRoot().listAnimations().map((a) => a.getName()).sort()).toEqual([...MONKEY_CLIP_CONTRACT].sort());
    expect(doc.getRoot().listSkins()).toHaveLength(1);
  });

  for (const tier of MONKEY_BASE_LODS) {
    it(`${tier.name}: within its triangle target, its height, and its deviation budget from the master`, () => {
      const p = primNamed(doc, `body_${tier.name}`)!;
      expect(tris(p)).toBeLessThanOrEqual(tier.triangles * 1.08);
      const pos = p.getAttribute("POSITION")!;
      expect(Math.abs(pos.getMax([])[1] - pos.getMin([])[1] - MONKEY_NATIVE_HEIGHT)).toBeLessThanOrEqual(tier.name === "lod0" ? 0.002 : 0.01);
      const mPos = master.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute("POSITION")!.getArray()!;
      const dev = surfaceDeviation(mPos, pos.getArray()!, p.getIndices()!.getArray()!, 11);
      expect(dev.max, `${tier.name} max deviation`).toBeLessThanOrEqual(tier.maxDeviation);
      for (const a of ["TEXCOORD_0", "JOINTS_0", "WEIGHTS_0", "_REGION", "_MARKS"]) expect(p.getAttribute(a), a).toBeTruthy();
    });
    it(`${tier.name}: face shells ${tier.face ? "present, rigid to Head, within budget" : "absent (far LOD)"}`, () => {
      const eyes = primNamed(doc, `face_eyes_${tier.name}`), mouth = primNamed(doc, `face_mouth_${tier.name}`);
      if (!tier.face) { expect(eyes).toBeNull(); expect(mouth).toBeNull(); return; }
      expect(tris(eyes!) + tris(mouth!)).toBeLessThanOrEqual(MONKEY_BUDGETS.face);
      expect(eyes!.getAttribute("_SIDE")).toBeTruthy();
      for (const f of [eyes!, mouth!]) {
        const J = f.getAttribute("JOINTS_0")!.getArray()!, W = f.getAttribute("WEIGHTS_0")!.getArray()!;
        for (let v = 0; v < J.length / 4; v++) { expect(MONKEY_SKELETON_JOINTS[J[v * 4]]).toBe("Head"); expect(W[v * 4]).toBeCloseTo(1, 3); }
      }
    });
  }

  describe("LOD0 weights + seam-exact regions", () => {
    const names = [...MONKEY_SKELETON_JOINTS];
    let dom: string[] = [], reg: number[] = [], ys: number[] = [], idx: ArrayLike<number> = [];
    beforeAll(() => {
      const p = primNamed(doc, "body_lod0")!;
      const J = p.getAttribute("JOINTS_0")!.getArray()!, W = p.getAttribute("WEIGHTS_0")!.getArray()!;
      const R = p.getAttribute("_REGION")!.getArray()!, P = p.getAttribute("POSITION")!.getArray()!;
      idx = p.getIndices()!.getArray()!;
      dom = []; reg = []; ys = [];
      for (let i = 0; i < R.length; i++) {
        let b = 0; for (let k = 1; k < 4; k++) if (W[i * 4 + k] > W[i * 4 + b]) b = k;
        dom.push(names[J[i * 4 + b]]); reg.push(Math.round(R[i])); ys.push(P[i * 3 + 1]);
      }
    });
    const count = (pred: (i: number) => boolean) => dom.reduce((n, _, i) => n + (pred(i) ? 1 : 0), 0);

    it("labels every vertex with a known region", () => {
      const valid = new Set(Object.values(BODY_REGIONS) as number[]);
      expect(reg.every((r) => valid.has(r))).toBe(true);
    });
    it("never lets a thigh own the torso or the tail, and binds the tail to the pelvis", () => {
      const torso = new Set<number>([BODY_REGIONS.CHEST, BODY_REGIONS.BELLY, BODY_REGIONS.TAIL]);
      expect(count((i) => torso.has(reg[i]) && /UpLeg$/.test(dom[i]))).toBe(0);
      expect(count((i) => reg[i] === BODY_REGIONS.TAIL && dom[i] !== "Hips")).toBe(0);
    });
    it("is left/right symmetric (legs and feet within 25%)", () => {
      for (const part of ["Leg", "Foot", "ToeBase"]) {
        const l = count((i) => dom[i] === `Left${part}`), r = count((i) => dom[i] === `Right${part}`);
        expect(Math.abs(l - r) / Math.max(l, r), part).toBeLessThan(0.25);
      }
    });
    it("keeps the head shell rigid to Head (above the shoulder-contact band)", () => {
      const head = new Set<number>([BODY_REGIONS.HEAD, BODY_REGIONS.TUFT, BODY_REGIONS.EARS, BODY_REGIONS.EYE_L, BODY_REGIONS.EYE_R, BODY_REGIONS.MOUTH]);
      expect(count((i) => head.has(reg[i]) && ys[i] > 0.87 && dom[i] !== "Head")).toBe(0);
    });
    it("has no triangle straddling a seam pair, so garment hiding is exact", () => {
      const R = BODY_REGIONS;
      const pairs = [[R.UPPERARM_L, R.FOREARM_L], [R.FOREARM_L, R.HAND_L], [R.UPPERARM_R, R.FOREARM_R], [R.FOREARM_R, R.HAND_R],
        [R.PELVIS, R.BELLY], [R.BELLY, R.CHEST], [R.NECK, R.CHEST]].map(([a, b]) => `${Math.min(a, b)},${Math.max(a, b)}`);
      let straddling = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const rs = new Set([reg[idx[t]], reg[idx[t + 1]], reg[idx[t + 2]]]);
        if (rs.size === 2) { const [a, b] = [...rs].sort((x, y) => x - y); if (pairs.includes(`${a},${b}`)) straddling++; }
      }
      expect(straddling).toBe(0);
    });
  });

  it("ships the recolour masks", () => {
    const png = readFileSync("public/avatars/monkey-agent-base-v1/masks.png");
    expect(png.readUInt32BE(16)).toBe(1024); // IHDR width
    expect(png.readUInt32BE(20)).toBe(1024);
  });
});

describe("MonkeyAgent garments", () => {
  it("are the four demo garments", () => expect(Object.keys(MONKEY_GARMENT_URLS).sort()).toEqual(["cap", "longsleeve", "tee", "vest"]));
  for (const id of ["tee", "longsleeve", "vest", "cap"]) {
    it(`${id}: same skeleton by name, real hidden regions, within budget, head-rigid only if headwear`, async () => {
      const g = await io.read(`${GARMENTS}${id}.glb`);
      expect(g.getRoot().listSkins()[0].listJoints().map((j) => j.getName())).toEqual([...MONKEY_SKELETON_JOINTS]);
      const node = g.getRoot().listNodes().find((n) => n.getMesh())!;
      const meta = node.getExtras().monkeyGarment as { hides: BodyRegion[]; slot: string };
      expect(meta.hides.length).toBeGreaterThan(0);
      for (const r of meta.hides) expect(BODY_REGIONS).toHaveProperty(r);
      const p = node.getMesh()!.listPrimitives()[0];
      expect(tris(p)).toBeLessThanOrEqual(MONKEY_BUDGETS.garmentPerAgent);
      const J = p.getAttribute("JOINTS_0")!.getArray()!, W = p.getAttribute("WEIGHTS_0")!.getArray()!, head = MONKEY_SKELETON_JOINTS.indexOf("Head");
      let headW = 0, total = 0; for (let k = 0; k < J.length; k++) { total += W[k]; if (J[k] === head) headW += W[k]; }
      if (meta.slot === "head") expect(headW / total).toBeCloseTo(1, 3);
      else expect(headW).toBe(0);
    });
  }
});

describe("the founders — identities are data on the ONE base", () => {
  it("is three distinct permanent identities, each using only shipped garments and accessories", () => {
    expect(FOUNDER_IDENTITIES.map((i) => i.id)).toEqual(["milo", "nova", "pip"]);
    expect(new Set(FOUNDER_IDENTITIES.map((i) => i.look.iris)).size).toBe(3);
    expect(new Set(FOUNDER_IDENTITIES.map((i) => i.look.fur ?? -1)).size).toBe(3);
    for (const i of FOUNDER_IDENTITIES) {
      for (const g of i.look.garments) expect(MONKEY_GARMENT_URLS).toHaveProperty(g);
      for (const a of i.look.accessories) { expect(MONKEY_ACCESSORY_BUILDERS).toHaveProperty(a.item); expect(MONKEY_SOCKETS).toHaveProperty(a.socket); }
    }
  });
  it("keeps roles OUT of identity — a role is a job's runtime record, never part of who an agent is", () => {
    for (const i of FOUNDER_IDENTITIES) expect(JSON.stringify(i)).not.toMatch(/dev|design|review/i);
  });
});
