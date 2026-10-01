// vo3d avatar — THE MONKEYAGENT DEMO CAST (P3). DEV-ONLY, OFF BY DEFAULT (`?monkeyagent=1`).
//
// Three PERMANENT identities — MILO, NOVA, PIP — on the ONE production base (MonkeyAgent_Base_V1): same
// mesh, skeleton, clips, face system and material program; they differ only in identity DATA (fur / face
// / marking tints, iris, one top, one accessory). Standing in the AI Lab hall beside the reference master's
// slot, each with its pill on the EXISTING overhead layer.
//
// THE THREE RECORDS ARE KEPT APART HERE EXACTLY AS THE CONTRACT SAYS:
//   identity    (who)        — DEMO_IDENTITIES, permanent (demo art direction, not final)
//   assignment  (for whom)   — DEV / DESIGN / REVIEW to start, replaceable
//   exec state  (what)       — set from OUTSIDE (dev GUI today, Agent Harness later) through setExec();
//                              the body derives clip + face + work layer from it, the pill re-renders.
// Nothing in this file decides a state on its own: no timers, no simulated work.
//
// SCENERY-SHAPED like the reference monkey: one group on the scene, not in the nav grid, the collision
// model, the shadow set or the room mirror.
import * as THREE from "three";
import { MonkeyAgentBody } from "./MonkeyAgentBody";
import {
  agentOverheadKey, agentPillStatus,
  type AgentAssignment, type AgentExecState, type MonkeyIdentity,
} from "../world/monkeyAgentContract";
import { MONKEY_DECK_Y, MONKEY_SLOT } from "../world/monkeyAgent";
import { BON_STANDING_HEIGHT } from "../adapters/v1Avatar";
import { TOUCAN_OVERHEAD_KEY } from "../app/Vo3dOverheads";

export const DEMO_IDENTITIES: readonly MonkeyIdentity[] = [
  { id: "milo", name: "Milo",
    look: { iris: 0x6a4428, accent: 0xf2b134, garments: ["tee"], accessories: [{ item: "headset", socket: "ears" }] } },
  { id: "nova", name: "Nova",
    look: { fur: 0x6f7f99, marks: { crown: 0xd4dbe6 }, iris: 0x3f8f5a, accent: 0x3a2f45,
      garments: ["longsleeve"], accessories: [{ item: "glasses", socket: "face" }] } },
  { id: "pip", name: "Pip",
    look: { fur: 0xc08a3e, marks: { muzzle: 0xe2ad85 }, iris: 0x3b6fb5,
      garments: ["vest", "cap"], accessories: [] } },
];
/** the demo's starting assignments — runtime records, NOT part of who anyone is */
export const DEMO_ASSIGNMENTS: Readonly<Record<string, AgentAssignment>> = {
  milo: { agentId: "milo", role: "Dev" }, nova: { agentId: "nova", role: "Design" }, pip: { agentId: "pip", role: "Review" },
};

/** one overhead row, in the overhead layer's own shape (Vo3dOverhead): the pill, or — while the agent is
 *  speaking — its speech bubble, by the layer's own sentText > status priority */
export type AgentPillRow = { email: string; displayName: string; status?: { color: string; shortName: string; detail: string }; sentText?: string };

type Member = { body: MonkeyAgentBody; slot: { x: number; z: number; yaw: number } };

/** DEMO SLOTS on the Lab hall's open floor around the reference master's slot (740, -485), clear of the
 *  planted hub ((740, -600) r88) and the zone furniture. Staggered in depth so the longest pills
 *  ("PIP · REVIEW · AWAITING APPROVAL") never overlap: the shared overhead layer has no label collision
 *  handling, and the real Lab layout comes later. */
export const DEMO_SLOTS: Readonly<Record<string, { x: number; z: number; work: { x: number; z: number } }>> = {
  // `work` is where each turns to while working: out and toward the hall's south side (the demo camera's
  // side), so the work layer and its screen face the viewer instead of the hub
  milo: { x: MONKEY_SLOT.x - 90, z: MONKEY_SLOT.z + 15, work: { x: MONKEY_SLOT.x - 150, z: MONKEY_SLOT.z + 110 } },
  nova: { x: MONKEY_SLOT.x - 30, z: MONKEY_SLOT.z - 15, work: { x: MONKEY_SLOT.x - 40, z: MONKEY_SLOT.z + 120 } },
  pip: { x: MONKEY_SLOT.x + 50, z: MONKEY_SLOT.z + 15, work: { x: MONKEY_SLOT.x + 110, z: MONKEY_SLOT.z + 110 } },
};

/** the overhead layer hangs a pill at the same height over a monkey as over an employee (Coworkers) */
const PILL_Y = BON_STANDING_HEIGHT + 6;

export class MonkeyAgentProof {
  readonly root = new THREE.Group();
  private members = new Map<string, Member>();
  private listeners = new Set<(rows: readonly AgentPillRow[]) => void>();
  /** what each agent is saying right now (presentation — set by the orchestration visual layer) */
  private lines = new Map<string, string>();
  /** the toucan's own line while the demo has it speaking (rides the toucan's existing overhead key) */
  private toucanLine: string | null = null;

  constructor() {
    this.root.name = "monkey-agent-proof";
    this.root.visible = false;
    for (const identity of DEMO_IDENTITIES) {
      const at = DEMO_SLOTS[identity.id];
      this.members.set(identity.id, { body: new MonkeyAgentBody(identity), slot: { x: at.x, z: at.z, yaw: MONKEY_SLOT.yaw } });
    }
  }

  async load(): Promise<boolean> {
    try {
      await Promise.all([...this.members.values()].map(async ({ body, slot }) => {
        await body.load();
        body.root.position.set(slot.x, MONKEY_DECK_Y, slot.z);
        body.root.rotation.y = slot.yaw;
        body.homeYaw = slot.yaw;
        this.root.add(body.root);
      }));
      // the mocked starting records — the demo flow will replace these with Agent Harness state
      for (const id of this.members.keys()) this.setExec(id, "idle", DEMO_ASSIGNMENTS[id] ?? null);
      return true;
    } catch (err) {
      console.warn("[vo3d] monkey agent proof unavailable:", err);
      return false;
    }
  }

  body(id: string): MonkeyAgentBody | null { return this.members.get(id)?.body ?? null; }
  get ids(): string[] { return [...this.members.keys()]; }

  /** THE ONLY STATE INPUT. */
  setExec(id: string, exec: AgentExecState, assignment?: AgentAssignment | null): void {
    const m = this.members.get(id);
    if (!m) return;
    m.body.setExec(exec, assignment === undefined ? m.body.assignment : assignment);
    this.emit();
  }

  rows(): AgentPillRow[] {
    const rows: AgentPillRow[] = [...this.members.values()].filter((m) => m.body.loaded).map(({ body }) => {
      const line = this.lines.get(body.identity.id);
      return {
        email: agentOverheadKey(body.identity.id),
        displayName: body.identity.name,
        status: agentPillStatus(body.identity, body.assignment, body.exec),
        ...(line ? { sentText: line } : {}),
      };
    });
    if (this.toucanLine) rows.push({ email: TOUCAN_OVERHEAD_KEY, displayName: "Toucan", sentText: this.toucanLine });
    return rows;
  }

  /** PRESENTATION: show (or clear) what an agent — or "toucan" — is saying, as the existing speech bubble.
   *  The speaker's mouth moves while it shows. */
  say(id: string, text: string | null): void {
    if (id === "toucan") this.toucanLine = text;
    else {
      if (text) this.lines.set(id, text); else this.lines.delete(id);
      const b = this.members.get(id)?.body;
      if (b) b.speaking = !!text;
    }
    this.emit();
  }

  /** world position of an agent's head (look-at target) */
  headOf(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const b = this.members.get(id)?.body;
    return b ? out.copy(b.root.position).setY(b.root.position.y + 30) : null;
  }

  /** where an agent turns to while it works */
  workSpot(id: string): { x: number; z: number } | null { return DEMO_SLOTS[id]?.work ?? null; }

  /** centre of the team, on the floor */
  teamCentre(): { x: number; z: number } {
    const v = Object.values(DEMO_SLOTS);
    return { x: v.reduce((a, s) => a + s.x, 0) / v.length, z: v.reduce((a, s) => a + s.z, 0) / v.length };
  }

  subscribe(fn: (rows: readonly AgentPillRow[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.rows());
    return () => { this.listeners.delete(fn); };
  }
  private emit(): void { const r = this.rows(); for (const fn of this.listeners) fn(r); }

  /** where the pill hangs, in world space; null when the agent is not drawn */
  pillPoint(key: string, out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.root.visible) return null;
    for (const { body } of this.members.values()) {
      if (agentOverheadKey(body.identity.id) !== key || !body.loaded) continue;
      return out.copy(body.root.position).setY(body.root.position.y + PILL_Y);
    }
    return null;
  }

  get visible(): boolean { return this.root.visible; }
  set visible(v: boolean) { this.root.visible = v; }

  /** what each agent's eyes follow: a point set by the orchestration visual layer, else the camera */
  private gazes = new Map<string, THREE.Vector3>();
  setGaze(id: string, point: THREE.Vector3 | null): void {
    if (point) (this.gazes.get(id) ?? this.gazes.set(id, new THREE.Vector3()).get(id)!).copy(point);
    else this.gazes.delete(id);
  }

  update(dt: number, camera: THREE.Camera | null, viewportH = 900): void {
    if (!this.root.visible) return;
    for (const [id, { body }] of this.members) {
      body.lookTarget = this.gazes.get(id) ?? (camera ? camera.position : null);
      body.update(dt, camera, viewportH);
    }
  }

  /** back to the cast's resting state: idle, no lines, facing home (a demo reset) */
  resetPresentation(): void {
    this.lines.clear(); this.toucanLine = null; this.gazes.clear();
    for (const [id, { body }] of this.members) { body.speaking = false; body.faceToward(null); body.setExec("idle", DEMO_ASSIGNMENTS[id] ?? null); }
    this.emit();
  }

  stats(): { triangles: number; draws: number } {
    let triangles = 0, draws = 0;
    for (const { body } of this.members.values()) { const s = body.stats(); triangles += s.triangles; draws += s.draws; }
    return { triangles, draws };
  }

  dispose(): void {
    for (const { body } of this.members.values()) body.dispose();
    this.listeners.clear();
    this.root.removeFromParent();
  }
}
