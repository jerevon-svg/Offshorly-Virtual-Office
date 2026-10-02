// vo3d app — WHAT THE AI WORKFORCE PRESENTER TELLS THE HUD (Phase 6B.5). Its own module so the production presenter,
// the overlay and the world share it without importing any demo controller.
import type { ArtifactResult, OrchestrationSource } from "../world/agentOrchestration";

export type AiWorkforceStatus = {
  phase: "idle" | "running" | "complete";
  /** a short human line for the HUD chip */
  step: string;
  title?: string;
  source: OrchestrationSource["kind"];
  /** the conversation so far, newest last (the in-world bubbles clamp at three lines; this never does) */
  transcript: readonly { who: string; text: string }[];
  /** the finished deliverable, once there is one */
  result?: ArtifactResult | null;
  /** the deliverable has physically reached the human: the View Result action is offered */
  delivered?: boolean;
  /** the job this scene is showing */
  jobId?: string | null;
  /** the job's records the live world has not shown yet (empty while the employee is away) */
  unseen?: readonly number[];
  /** WATCH IN LAB is on: camera only — the world plays the job either way */
  watching?: boolean;
};
