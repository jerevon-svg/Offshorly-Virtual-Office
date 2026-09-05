// Pure helpers for Whiteboard W3 realtime sync — no Excalidraw or socket imports, so the merge
// contract is unit-testable and provably the same rule the server applies
// (backend/app/services/whiteboard_rooms.py remote_wins).
//
// Every Excalidraw element carries `version` (bumped on each mutation) and `versionNonce`
// (random tiebreak). Excalidraw's own reconcile (data/reconcile.ts) keeps the LOCAL copy when its
// version is higher, or equal with a LOWER nonce; otherwise the remote copy wins. Deleted elements
// are ordinary elements with `isDeleted: true` and a bumped version (tombstones), so deletions
// flow through the same rule.

export interface SyncElement {
  id: string;
  version: number;
  versionNonce: number;
  isDeleted?: boolean;
  [key: string]: unknown;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Excalidraw's reconcile rule from the receiver's side: does `remote` replace `local`? */
export function remoteWins(local: SyncElement | undefined, remote: SyncElement): boolean {
  if (!local) return true;
  const lv = num(local.version);
  const rv = num(remote.version);
  if (rv !== lv) return rv > lv;
  return num(remote.versionNonce) < num(local.versionNonce);
}

/** Elements whose version differs from what `known` records (last sent to, or received from, the
 * server). Deleted elements are included — a deletion is a version bump with isDeleted. */
export function changedElements(
  elements: readonly SyncElement[],
  known: ReadonlyMap<string, number>,
): SyncElement[] {
  return elements.filter((el) => known.get(el.id) !== num(el.version));
}

export interface UnackedReconciliation {
  /** The scene to load: the authoritative snapshot, with surviving local changes applied. */
  scene: SyncElement[];
  /** The local changes that beat the snapshot and must be (re)sent. Losers are dropped. */
  resend: SyncElement[];
}

/** On (re)join, reconcile ONLY the unacknowledged local changes against the server's snapshot.
 * A pending element is kept and resent iff it beats the snapshot copy under the same rule the
 * server will apply; everything else in the local scene is discarded in favour of the snapshot,
 * so a stale tab can never replay old state over what others did while it was away. */
export function reconcileUnacked(
  pending: readonly SyncElement[],
  snapshot: readonly SyncElement[],
): UnackedReconciliation {
  const scene = new Map<string, SyncElement>(snapshot.map((el) => [el.id, el]));
  const resend: SyncElement[] = [];
  for (const local of pending) {
    if (remoteWins(scene.get(local.id), local)) {
      scene.set(local.id, local);
      resend.push(local);
    }
  }
  return { scene: [...scene.values()], resend };
}

/** Versions of a scene keyed by id — the `known` map after a snapshot or a reconcile. */
export function versionsOf(elements: readonly SyncElement[]): Map<string, number> {
  return new Map(elements.map((el) => [el.id, num(el.version)]));
}

export interface PendingEntry {
  element: SyncElement;
  seq: number;
}

/** Drop pending entries acknowledged by the server (sent with seq <= ackedSeq). An element edited
 * again after that send has a higher seq and stays pending. */
export function acknowledge(pending: Map<string, PendingEntry>, ackedSeq: number): void {
  for (const [id, entry] of pending) {
    if (entry.seq <= ackedSeq) pending.delete(id);
  }
}
