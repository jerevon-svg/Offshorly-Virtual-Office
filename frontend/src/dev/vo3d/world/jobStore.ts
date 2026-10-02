// vo3d world — THE CLIENT SIDE OF THE JOB SYSTEM: a projection store and the one facade everything talks to.
//
//   OrchestrationSource (mock today, Agent Harness adapter later)
//        │ ordered JobRecords                     ▲ JobCommands
//        ▼                                        │
//   JobClient ── JobStore (truth per job, from snapshot + records) ── subscribers: task chat, result UI, a phone
//        └── onRecord / onHydrate ── the physical presenter (app/labWorkforce), which only decides how it LOOKS
//
// No THREE, no React, no timers. Nothing here depends on a scene, a component or a camera being alive: a job
// lives in the store whether or not anything is watching it, and a client with no 3D at all (mobile) uses this
// file unchanged.
import { DEMO_COMMAND, type ArtifactResult, type AttentionResponse, type DemoCommand, type JobCommand, type JobCommandResult, type JobHistory, type JobRecord, type OrchestrationSource } from "./agentOrchestration";
import { attentionSignal, emptyJob, projectJob, reduceJob, type ArtifactRevision, type AttentionSignal, type JobSnapshot } from "./agentJob";

type Entry = { base: JobSnapshot | null; records: JobRecord[]; view: JobSnapshot; early: Map<number, JobRecord> };

/** THE PROJECTION: every job's records in order, and its current truth. Records are applied exactly once and in
 *  seq order: a duplicate (an overlap after reconnecting) is dropped, an early one (a live record that overtook
 *  the history fetch) waits until the gap before it is filled. */
export class JobStore {
  private jobs = new Map<string, Entry>();
  private order: string[] = [];
  private listeners = new Set<(jobId: string) => void>();

  /** apply one record; returns the records that were actually applied (in order), for the presenter */
  apply(r: JobRecord): JobRecord[] {
    const id = r.event.jobId;
    const en = this.entry(id);
    if (r.seq <= en.view.lastSeq || en.early.has(r.seq)) return [];
    if (r.seq > en.view.lastSeq + 1) { en.early.set(r.seq, r); return []; }
    const applied: JobRecord[] = [];
    let next: JobRecord | undefined = r;
    while (next) {
      en.records.push(next);
      en.view = reduceJob(en.view, next);
      applied.push(next);
      en.early.delete(next.seq);
      next = en.early.get(en.view.lastSeq + 1);
    }
    this.emit(id);
    return applied;
  }

  /** REBUILD a job from its history (snapshot + later records). Whatever was already known is kept where the
   *  history agrees; anything the history adds is folded in. Returns the job's truth afterwards. */
  hydrate(h: JobHistory<JobSnapshot>): JobSnapshot {
    const en = this.entry(h.jobId);
    if (h.snapshot && h.snapshot.lastSeq > en.view.lastSeq) {
      en.base = h.snapshot; en.records = []; en.view = h.snapshot;
    }
    for (const r of h.records) {
      if (r.seq <= en.view.lastSeq) continue;
      if (r.seq > en.view.lastSeq + 1) { en.early.set(r.seq, r); continue; }
      en.records.push(r); en.view = reduceJob(en.view, r);
      for (let n = en.early.get(en.view.lastSeq + 1); n; n = en.early.get(en.view.lastSeq + 1)) {
        en.records.push(n); en.view = reduceJob(en.view, n); en.early.delete(n.seq);
      }
    }
    this.emit(h.jobId);
    return en.view;
  }

  /** a job's current truth (null = unknown here) */
  get(jobId: string): JobSnapshot | null { return this.jobs.get(jobId)?.view ?? null; }

  /** a job as of the records a viewer has SEEN: the truth minus the records in `unseen`. The live Lab uses it so
   *  the thread beside the scene never runs ahead of what the scene is showing; without a scene it is the truth. */
  seen(jobId: string, unseen: ReadonlySet<number>): JobSnapshot | null {
    const en = this.jobs.get(jobId);
    if (!en) return null;
    if (unseen.size === 0) return en.view;
    return projectJob(jobId, en.base, en.records.filter((r) => !unseen.has(r.seq)));
  }

  /** every record known for a job after its snapshot (for tests and the dev panel) */
  records(jobId: string): readonly JobRecord[] { return this.jobs.get(jobId)?.records ?? []; }

  /** one revision, whichever job it belongs to */
  findRevision(revisionId: string): ArtifactRevision | null {
    for (const en of this.jobs.values()) { const a = en.view.artifacts.find((x) => x.revisionId === revisionId); if (a) return a; }
    return null;
  }

  /** the most recently created job */
  get latest(): string | null { return this.order.at(-1) ?? null; }

  subscribe(fn: (jobId: string) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  clear(): void { this.jobs.clear(); this.order = []; for (const fn of this.listeners) fn(""); }

  private entry(id: string): Entry {
    let en = this.jobs.get(id);
    if (!en) { en = { base: null, records: [], view: emptyJob(id), early: new Map() }; this.jobs.set(id, en); this.order.push(id); }
    return en;
  }
  private emit(id: string): void { for (const fn of this.listeners) fn(id); }
}

export type PresenterFeed = { record(r: JobRecord): void; hydrated(job: JobSnapshot): void };

/** THE ONE FACADE: commands out to the source, records in to the store and on to whoever presents them. The
 *  task conversation, the result viewer, the physical Lab and a future phone client all use THIS — never the
 *  source directly, and never each other. */
export class JobClient {
  readonly store = new JobStore();
  private feeds = new Set<PresenterFeed>();
  private signals = new Set<(s: AttentionSignal | null, jobId: string) => void>();
  private lastSignal = new Map<string, string>();
  private unsub: () => void;
  private readonly source: OrchestrationSource;

  constructor(source: OrchestrationSource) {
    this.source = source;
    this.unsub = source.subscribe((r) => this.receive(r));
    this.store.subscribe((jobId) => this.signal(jobId));
  }

  get kind(): OrchestrationSource["kind"] { return this.source.kind; }

  private receive(r: JobRecord): void {
    for (const a of this.store.apply(r)) for (const f of this.feeds) f.record(a);
  }

  // ---- human → job (every one of these works with no scene at all) -------------------------------------
  submit(request: DemoCommand = DEMO_COMMAND): Promise<JobCommandResult> { return this.send({ type: "submit", request }); }
  message(jobId: string, text: string): Promise<JobCommandResult> { return this.send({ type: "message", jobId, text }); }
  approve(jobId: string, revisionId: string): Promise<JobCommandResult> { return this.send({ type: "approve", jobId, revisionId }); }
  requestChanges(jobId: string, revisionId: string, feedback: string): Promise<JobCommandResult> {
    return this.send({ type: "request-revision", jobId, revisionId, feedback });
  }
  respond(jobId: string, requestId: string, response: AttentionResponse): Promise<JobCommandResult> {
    return this.send({ type: "respond", jobId, requestId, response });
  }
  send(cmd: JobCommand): Promise<JobCommandResult> { return this.source.send(cmd); }

  // ---- reading ------------------------------------------------------------------------------------------
  job(jobId: string): JobSnapshot | null { return this.store.get(jobId); }
  get latest(): string | null { return this.store.latest; }
  /** a revision's content: inline from the record when it came that way, else fetched by reference */
  async artifact(revisionId: string): Promise<ArtifactResult | null> {
    return this.store.findRevision(revisionId)?.result ?? this.source.artifact(revisionId);
  }

  /** RECONNECT: fetch each open job's truth (snapshot + history) and rebuild it here; presenters are told the
   *  job's CURRENT state once (onHydrate) instead of being replayed everything that already happened. */
  async reconnect(jobId?: string): Promise<JobSnapshot[]> {
    const ids = jobId ? [jobId] : [...(await this.source.jobs())].reverse();
    const out: JobSnapshot[] = [];
    for (const id of ids) {
      const known = this.store.get(id)?.lastSeq ?? 0;
      const h = (await this.source.history(id, known)) as JobHistory<JobSnapshot>;
      const view = this.store.hydrate(h);
      for (const f of this.feeds) f.hydrated(view);
      out.push(view);
    }
    return out;
  }

  /** the presenter's feed: each newly applied record, and a whole job after a hydration */
  feed(f: PresenterFeed): () => void { this.feeds.add(f); return () => { this.feeds.delete(f); }; }

  /** NOTIFICATION SEAM: called whenever what a job needs from the human changes (needs input / approval, a
   *  result ready, or nothing any more). A notification service subscribes here; nothing in VO's UI depends on it. */
  onAttention(fn: (s: AttentionSignal | null, jobId: string) => void): () => void { this.signals.add(fn); return () => { this.signals.delete(fn); }; }
  private signal(jobId: string): void {
    if (!jobId) { this.lastSignal.clear(); return; }
    const j = this.store.get(jobId);
    const s = j ? attentionSignal(j) : null;
    const key = s ? `${s.kind}:${s.key}` : "";
    if ((this.lastSignal.get(jobId) ?? "") === key) return;
    this.lastSignal.set(jobId, key);
    for (const fn of this.signals) fn(s, jobId);
  }

  /** drive a tick-driven source (the mock); a real adapter ignores it */
  tick(dt: number): void { this.source.tick(dt); }
  /** DEMO RESET: forget every job here and in the mock "backend" */
  reset(): void { this.source.cancel(); this.store.clear(); }
  dispose(): void { this.unsub(); this.feeds.clear(); this.signals.clear(); }
}
