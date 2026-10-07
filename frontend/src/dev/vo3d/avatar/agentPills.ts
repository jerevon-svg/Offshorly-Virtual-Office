// vo3d avatar — MONKEYAGENT PILL ROWS for the EXISTING overhead layer (app/Vo3dOverheads).
//
// One place that turns MonkeyAgent bodies into Vo3dOverhead rows, shared by every cast (the V1-Lab proof cast
// and the V2 Lab's MonkeyCastRunner). The pill itself is the employee pill, unchanged: this only supplies
// the facts — name, the execution-state dot and words (world/monkeyAgentContract agentPillStatus), or the line
// being said, which the layer shows INSTEAD of the pill (its own sentText > status priority) — and where over
// the body the row hangs. Nothing here decides a state: rows are re-emitted whenever a caller reports a change.
import * as THREE from "three";
import type { MonkeyAgentBody } from "./MonkeyAgentBody";
import { agentOverheadKey, agentPillStatus } from "../world/monkeyAgentContract";
import { BON_STANDING_HEIGHT } from "../adapters/v1Avatar";
import { TOUCAN_OVERHEAD_KEY } from "../app/Vo3dOverheads";

/** one overhead row, in the overhead layer's own shape (Vo3dOverhead) */
export type AgentPillRow = { email: string; displayName: string; status?: { color: string; shortName: string; detail?: string }; sentText?: string };

/** the overhead layer hangs a pill at the same height over a monkey as over an employee (Coworkers) */
export const AGENT_PILL_Y = BON_STANDING_HEIGHT + 6;
/** A NEIGHBOUR'S PILL GIVES WAY: while an agent this close (world units, on the floor plane) is speaking, the
 *  listener's pill is left out, so the bubble is never drawn over it. A face-to-face exchange (a handoff, 26
 *  apart) always overlaps otherwise — both rows hang at the same height, scaled with the world. */
export const PILL_GIVE_WAY = 70;

export class AgentPillBoard {
  private readonly listeners = new Set<(rows: readonly AgentPillRow[]) => void>();
  /** what each agent is saying right now (presentation — set by the orchestration visual layer) */
  private readonly lines = new Map<string, string>();
  /** the toucan's own line while a presenter has it speaking (rides the toucan's existing overhead key) */
  private toucanLine: string | null = null;
  private readonly bodies: () => Iterable<MonkeyAgentBody>;
  /** is this body drawn right now (no pill for an agent inside the residence, or a hidden cast) */
  private readonly shown: (b: MonkeyAgentBody) => boolean;

  constructor(bodies: () => Iterable<MonkeyAgentBody>, shown: (b: MonkeyAgentBody) => boolean) {
    this.bodies = bodies;
    this.shown = shown;
  }

  rows(): AgentPillRow[] {
    const rows: AgentPillRow[] = [];
    const all = [...this.bodies()].filter((b) => b.loaded);
    const speakers = all.filter((b) => this.lines.has(b.identity.id)).map((b) => b.root.position);
    for (const body of all) {
      const line = this.lines.get(body.identity.id);
      const p = body.root.position;
      const yielding = !line && speakers.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < PILL_GIVE_WAY);
      rows.push({
        email: agentOverheadKey(body.identity.id),
        displayName: body.identity.name,
        ...(yielding ? {} : { status: agentPillStatus(body.identity, body.assignment, body.exec) }),
        ...(line ? { sentText: line } : {}),
      });
    }
    if (this.toucanLine) rows.push({ email: TOUCAN_OVERHEAD_KEY, displayName: "Toucan", sentText: this.toucanLine });
    return rows;
  }

  /** show (or clear) what an agent — or "toucan" — is saying, as the existing speech bubble */
  say(id: string, text: string | null): void {
    if (id === "toucan") this.toucanLine = text;
    else if (text) this.lines.set(id, text);
    else this.lines.delete(id);
    this.emit();
  }
  line(id: string): string | null { return id === "toucan" ? this.toucanLine : this.lines.get(id) ?? null; }
  clear(): void { this.lines.clear(); this.toucanLine = null; this.emit(); }

  subscribe(fn: (rows: readonly AgentPillRow[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.rows());
    return () => { this.listeners.delete(fn); };
  }
  emit(): void { const r = this.rows(); for (const fn of this.listeners) fn(r); }

  /** where a row hangs, in world space; null when that agent is not drawn */
  point(key: string, out: THREE.Vector3): THREE.Vector3 | null {
    for (const body of this.bodies()) {
      if (agentOverheadKey(body.identity.id) !== key || !body.loaded || !this.shown(body)) continue;
      return out.copy(body.root.position).setY(body.root.position.y + AGENT_PILL_Y);
    }
    return null;
  }

  dispose(): void { this.listeners.clear(); }
}
