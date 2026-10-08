// vo3d world — ONE LINE OF STATUS FOR A JOB, from its truth alone (pure; no scene, no THREE). The Lab presenter
// uses it whenever no scene is narrating the job (Phase 6B background), and the AI Workforce status card uses it
// for a job the scene is not showing.
import { nameOf, type JobSnapshot } from "./agentJob";

/** THE STATUS LINE FROM THE JOB'S TRUTH (background: no scene is narrating it) */
export function stepFor(job: JobSnapshot): string {
  const nm = (id: string) => nameOf(id);
  if (job.status === "approved") return "Approved";
  if (job.status === "ready") return "Result ready for review";
  if (job.status === "halted") return "Stopped — back with you";
  if (job.status === "failed") return "The job failed";
  if (job.attention) return `${nm(job.attention.from)} needs your ${job.attention.kind === "needs-approval" ? "approval" : "input"}`;
  const busy = Object.entries(job.agents).find(([, a]) => a.state === "working" || a.state === "reviewing");
  if (busy) return `${nm(busy[0])} is ${busy[1].state}`;
  if (job.owner && job.owner !== "toucan" && job.owner !== "user" && job.owner !== "artifact") return `${nm(job.owner)} has the work`;
  if (job.owner === "artifact") return "Result ready in the AI Lab";
  return Object.keys(job.agents).length > 0 ? "Toucan is with the team" : "Toucan is briefing the team";
}

