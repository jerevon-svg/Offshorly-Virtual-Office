# Connecting Agent Harness to the AI workforce

This note describes where Agent Harness plugs into the AI workforce (normal VO since Phase 6B, shown as a labelled Preview) and what it must provide. Today a deterministic mock runs every job. Harness is not connected, and its API is not known yet, so this note names no endpoints and assumes no transport.

## Data flow

```
CURRENT   MockOrchestrationSource ─┐
                                   ├─► JobRecord[] ─► JobClient / JobStore ─► task chat · result viewer · Lab presenter
FUTURE    AgentHarnessSource ──────┘   (same contract)  (unchanged)              (unchanged)
```

Job truth lives in `JobStore`. It is fed only by ordered records.

- The 3D scene, React components and the camera never own job state.
- The Lab presenter only decides how a record looks. Animation catches up with the truth; it never moves the job on.

## The contract (shared, pure types)

The contract lives in `world/agentOrchestration.ts`.

| Type | What it is |
|---|---|
| `OrchestrationEvent` | The domain events: `job.*`, `message`, `agent.assigned` / `agent.state`, `work.handoff`, `artifact.ready` / `.collected` / `.delivered`, `revision.requested`, `job.approved`, `attention.requested` / `.resolved`, `revision.halted` |
| `JobRecord` | `{ seq, at, event }`. `seq` is per job, gapless and starts at 1. `at` is epoch ms, as reported by the source |
| `JobCommand` | `submit`, `message`, `approve`, `request-revision`, `respond` |
| `JobCommandResult` | `{ ok: true, jobId }` or `{ ok: false, error }` |
| `JobHistory` | `{ jobId, snapshot \| null, records }`: the job's whole truth so far |
| `ArtifactResult` | One revision's content. `artifactId` stays the same across revisions; `revisionId` is unique to each revision; `source` is `"mock"` or `"agent-harness"` |
| Approvals | A finished result is reviewed with `approve` / `request-revision`. A consequential action (deploy, publish, spend) is guarded by `attention.requested` (`kind: "needs-approval"`, `action`) and answered once with `respond` → `attention.resolved`. **Declined means the guarded action is not performed**: the source must not continue down that path. It emits `revision.halted` (or reroutes), and the job returns to the human on the last delivered revision |
| `MessageKind` | `speech` is said in the world and shown as a bubble. `note` is a written update in the thread. `chat` is direct conversation with the human |

`world/agentJob.ts` holds the pure projection: `reduceJob`, `projectJob`, `JobSnapshot`, `attentionSignal`.

- The client and the mock already share this reducer.
- A Harness adapter may also use it to build snapshots.

## The interface a Harness adapter must implement

The interface is `OrchestrationSource` in `world/agentOrchestration.ts`.

```ts
interface OrchestrationSource {
  readonly kind: "agent-harness";
  subscribe(fn: (r: JobRecord) => void): () => void; // live records, in seq order per job
  send(cmd: JobCommand): Promise<JobCommandResult>;   // human → job; effects come back as records
  jobs(): Promise<readonly string[]>;                 // jobs this user can reconnect to, newest first
  history(jobId: string, afterSeq?: number): Promise<JobHistory>;
  artifact(revisionId: string): Promise<ArtifactResult | null>;
  cancel(): void;                                     // detach only; never cancels server-side work
  tick(dt: number): void;                             // no-op for a real backend
}
```

The adapter has five jobs:

1. **Map Harness concepts onto these events.** For example, a Harness task state becomes `agent.state`, a worker output becomes `artifact.ready`, and a blocked worker becomes `attention.requested` plus `agent.state` `needs-input` or `awaiting-approval`.
2. **Assign `seq`.** It must be stable and gapless per job.
3. **Translate commands into Harness calls.** Return `ok: false` with a reason when Harness refuses one.
4. **Emit the human's own actions as records once the backend accepts them.** These are the `message` from `"user"`, `revision.requested` and `job.approved`. Never add them to the UI optimistically.
5. **Choose the transport** (HTTP polling, WebSocket, SSE, and so on). Only the adapter knows it.

## How data enters VO

| What | How it enters |
|---|---|
| Initial snapshot / hydration | `JobClient.reconnect(jobId?)` calls `source.jobs()` and then `source.history(id, knownSeq)`. `JobStore.hydrate` loads the snapshot and folds in the later records. Presenters get one `hydrated(job)` call, and `LabWorkforce.adopt(job)` stages the current state instead of replaying it |
| Later events | `source.subscribe`, then `JobStore.apply`. The store drops duplicates and holds early records until any gap is filled. Each newly applied record goes to `feed.record(r)` |
| Human commands | The UI calls `JobClient.approve` / `requestChanges` / `respond` / `message` / `submit`, which calls `source.send`. Nothing in the UI or the scene changes until the resulting records arrive |
| Artifact content | Inline in `artifact.ready.result` when Harness can send it. Otherwise send only the reference (`artifactId`, `revisionId`); `JobClient.artifact(revisionId)` then fetches it from `source.artifact`. Every revision is kept, and none is ever overwritten |
| Notifications (later) | `JobClient.onAttention(fn)` fires on `needs-input`, `needs-approval`, `ready` and cleared. A push service subscribes there, or reproduces `attentionSignal` on the server |

## Reconnect

Example: the user opens VO at 10:35 for a job they started at 10:00.

1. `JobClient.reconnect()` fetches the history. The store now shows Nova done, Milo building, Pip not yet assigned, and Milo holding the work. The task conversation already has the full thread.
2. `LabWorkforce.adopt(job)` stages that state in one frame:
   - Milo is at a compatible Build station, with the packet on his desk.
   - Nova and Pip are at home.
   - The Toucan is on the perch (`Toucan.settleAt`).
   - Every READY revision has its gallery slot.
3. Live records then continue from `lastSeq + 1`.

To try it, open VO with `?aidemo=1` and click **Dev · Re-enter a job already in progress**. Behind it, `MockOrchestrationSource.seedOffline` runs a job unwatched, and then `reconnect` loads it.

Closing VO must never cancel a job. That holds once a persistent backend owns execution. Today the mock is in memory, so it stops when the page closes. That is a limit of the mock only.

## What stays the same when Harness is connected

None of these files should need to change:

- `world/agentOrchestration.ts` (contract). It changes only if Harness needs a new event kind, which would be a deliberate contract change.
- `world/agentJob.ts` (projection)
- `world/jobStore.ts` (store and facade)
- `app/labWorkforce.ts` (physical presenter)
- `app/AiLabTaskChat.tsx`, `app/AiLabResultPreview.tsx` and `app/Vo3dOverlay.tsx` (UI)
- `world/Toucan.ts`, `avatar/MonkeyCastRunner.ts` and the Lab build

These parts change:

- **Add** `world/agentHarnessSource.ts`, which implements `OrchestrationSource`.
- **Change** `createOrchestrationSource()` in `world/orchestrationSource.ts`, the only place that knows the source is the mock. Return the adapter there, behind a flag, with `seedOffline: null`. Then call `labJobs.reconnect()` in `app/world.ts` once the world is ready.
- The developer tools (`aiWorkforce.dev`: Reset and re-entry, `?aidemo=1` only) are already isolated from the production entry (`aiWorkforce.startSample` / `watch`). A real Reset must never delete server jobs.

## Known boundaries

- **Staffing.** The physical presenter assumes the three founders (Nova, Milo and Pip). Other agent ids are entered through the residence seam (`enterFromResidence`), and their stations are chosen by role through `labStations.workForRole`. If Harness roles use different names, extend that role map.
- **Bubble length.** Spoken lines longer than about 32 characters are clamped in the bubble. The thread always shows the full text.
- **Ordering across jobs.** `seq` orders records within a job only, never across jobs.
