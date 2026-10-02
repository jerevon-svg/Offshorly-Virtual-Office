// vo3d world — THE ONE PLACE THAT KNOWS WHICH EXECUTION SOURCE RUNS AI WORKFORCE JOBS (Phase 6B).
//
// Everything downstream — JobClient/JobStore, the task conversation, the result viewer, the Lab presenter — sees
// only the shared contract (world/agentOrchestration OrchestrationSource). Today the source is the scripted mock;
// connecting Agent Harness means returning its adapter here (see AGENT_HARNESS_SEAM.md), nothing else.
import type { DemoCommand, OrchestrationEvent, OrchestrationSource } from "./agentOrchestration";
import { MockOrchestrationSource } from "./agentOrchestrationMock";

export type WorkforceSource = {
  source: OrchestrationSource;
  /** DEV-ONLY re-entry proof (`?aidemo=1`): run a job unwatched up to `until`, as if VO had been closed. Only the
   *  in-memory mock can do this; a real backend returns null and is reconnected with JobClient.reconnect(). */
  seedOffline: ((cmd: DemoCommand, until: (e: OrchestrationEvent) => boolean) => string) | null;
};

export function createOrchestrationSource(): WorkforceSource {
  const mock = new MockOrchestrationSource();
  return { source: mock, seedOffline: (cmd, until) => mock.seedOffline(cmd, until) };
}
