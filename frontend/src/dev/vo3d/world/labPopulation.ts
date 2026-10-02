// vo3d world — THE MONKEYAGENT POPULATION SEAM: how many agents are SHOWN, independent of how many EXIST.
//
//   TOTAL AGENTS  ≠  VISIBLE AGENTS  ≠  WORKSTATIONS
//
// The workforce may grow far past what should ever be rendered. The treehouse RESIDENCE (world/ailabV2) is the
// diegetic answer: an agent that is not shown is INSIDE. This module is the pure rule that decides who is shown —
// working agents first (they need their stations), then idle agents up to an idle budget that the residence's
// exterior rest spots can hold without looking crowded — and everything else stays inside. A future population
// manager turns the CHANGES in that answer into physical journeys: residence door → balcony/deck → tree →
// Lab → station to appear, and the reverse to disappear (the traversal graph's `interior` links).
//
// Nothing here renders, schedules or allocates; it is a deterministic function of the agent list and a budget.

export type AgentActivity = "working" | "assigned" | "idle" | "resting";
export type AgentRecord = { id: string; activity: AgentActivity; /** higher shows first among equals */ priority?: number; founder?: boolean };
export type VisibilityBudget = {
  /** the most MonkeyAgents rendered at once in the Lab (performance + readability) */
  total: number;
  /** of those, the most that are merely idle/resting (the residence exterior's comfortable capacity) */
  idle: number;
};
/** the Lab's budget: 12 rendered at most, of which up to 8 idle on the residence exterior */
export const LAB_VISIBILITY: VisibilityBudget = { total: 12, idle: 8 };

const busy = (a: AgentRecord) => a.activity === "working" || a.activity === "assigned";

/** WHO IS SHOWN. Busy agents always outrank idle ones; founders outrank others; then priority; then id (so the
 *  answer is stable from frame to frame and client to client). */
export function chooseVisible(agents: readonly AgentRecord[], budget: VisibilityBudget = LAB_VISIBILITY): { visible: string[]; inside: string[] } {
  const order = [...agents].sort((a, b) =>
    Number(busy(b)) - Number(busy(a)) || Number(!!b.founder) - Number(!!a.founder) || (b.priority ?? 0) - (a.priority ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const visible: string[] = [], inside: string[] = [];
  let idleShown = 0;
  for (const a of order) {
    if (visible.length >= budget.total) { inside.push(a.id); continue; }
    if (busy(a)) { visible.push(a.id); continue; }
    if (idleShown < budget.idle) { visible.push(a.id); idleShown++; } else inside.push(a.id);
  }
  return { visible, inside };
}

// ---- WHERE EACH AGENT LIVES (pure data the orchestration presenter reads; destinations, never coordinates) ----
export type LabResident = {
  /** where it rests with nothing to do, and what it is doing there (the node's own action: sit / sleep / perch) */
  home: string;
  /** where it waits once briefed, until its part of a job reaches it */
  standby: string;
  /** its place on the briefing ring */
  brief: string;
  /** seconds from the Toucan's arrival to moving (how quickly its temperament reacts) */
  react: number;
  /** not drawn until a job needs it: it comes out of the residence, and goes back in afterwards */
  hidden?: boolean;
};
/** THE FOUNDERS live OUTSIDE (always shown — the population rule's founder priority). Nova reads at her L1 nook, Milo
 *  sleeps in his L2 pod, Pip perches at the tip of the west limb. Once briefed, Milo waits on the west root seat,
 *  close to where Nova will bring him the design; Pip waits up on the L1 deck, from where he can leap straight
 *  down to the review bay. */
export const LAB_RESIDENTS: Readonly<Record<string, LabResident>> = {
  nova: { home: "NOVA_HOME", standby: "NOVA_HOME", brief: "BRIEFING_NOVA", react: 0.9 },
  milo: { home: "MILO_HOME", standby: "ROOT_SEAT_W", brief: "BRIEFING_MILO", react: 2.1 },
  pip: { home: "PIP_HOME", standby: "IDLE_L1_SE", brief: "BRIEFING_PIP", react: 0.25 },
};
/** anyone else lives INSIDE the residence: summoned through its door for a job, back inside afterwards */
export const residentFor = (id: string): LabResident =>
  LAB_RESIDENTS[id] ?? { home: "RESIDENCE_INSIDE", standby: "BRIEFING_RING", brief: "BRIEFING_RING", react: 1, hidden: true };
