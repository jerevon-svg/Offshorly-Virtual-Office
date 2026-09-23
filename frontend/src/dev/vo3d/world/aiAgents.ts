// vo3d world — THE MOCKED AI AGENT ROSTER for the AI Lab.
//
// V0 IS LOCAL AND STATIC ON PURPOSE. Offshorly's AI Agent Harness is the real management surface; the Lab
// is the SPATIAL view of the same workforce, and this file is the seam where the two would eventually
// meet. Today it is a frozen array — no API, no database, no polling, no simulation, no store. When
// Harness is wired in, this is the only file that changes shape.
export type AgentStatus = "reviewing" | "working" | "idle";

export type Agent = {
  /** matches a ZONES slot's `agent` key */
  id: string;
  name: string;
  status: AgentStatus;
  /** the one line of current-task text the world-space label carries */
  task: string;
};

/** STATUS COLOUR, from the AI Room's own palette. The Lab has no colour of its own — it borrows the
 *  office's one cool-tech space so the two read as the same company. */
export const STATUS_TINT: Record<AgentStatus, number> = {
  /** amber: attention is on this one */
  reviewing: 0xe5a43a,
  /** the room's signature electric blue, at full strength */
  working: 0x2376e5,
  /** the LED's deep core — lit, but plainly not busy */
  idle: 0x0e4cba,
};

/** how the status reads as MOTION: pulse period in seconds and how far the emissive swings. Idle barely
 *  breathes, working is brisk, reviewing is a slow considered sweep. */
export const STATUS_PULSE: Record<AgentStatus, { period: number; swing: number }> = {
  reviewing: { period: 2.6, swing: 0.45 },
  working: { period: 0.9, swing: 0.75 },
  idle: { period: 5.5, swing: 0.12 },
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  reviewing: "REVIEWING",
  working: "WORKING",
  idle: "IDLE",
};

export const AGENTS: readonly Agent[] = [
  { id: "master", name: "MASTER", status: "reviewing", task: "Reviewing Worker output" },
  { id: "worker", name: "WORKER", status: "working", task: "Implementing current task" },
  { id: "commit", name: "COMMIT", status: "idle", task: "Waiting for approved changes" },
];

export const agentById = (id: string): Agent | null => AGENTS.find((a) => a.id === id) ?? null;

/** THE UNNAMED WORKFORCE. The reference's Lab is busy — it is not three droids in an empty hall — so the
 *  zones carry additional agents that have a station and a status light but no label and no task text.
 *  They cost one opsRobot each and they are what makes the room read as operational. */
export const AUX_STATUS: readonly AgentStatus[] = ["working", "working", "reviewing", "working", "idle"];
