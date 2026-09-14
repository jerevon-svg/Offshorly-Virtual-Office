// vo3d editor — BOUNDED transform history. Deliberately not a command framework.
//
// One entry = one confirmed transform of one entity ("before" → "after"). Undo/redo replay it through the
// SAME WorldState.commit path a confirm uses, so the atomic-transaction + walkability-resync guarantee is
// identical whether a change arrives from a drag or from Ctrl-Z. Nothing else is recorded: preview state is
// not history, because preview is not authoritative.
import type { EntityId, Transform2 } from "../world/WorldState";

export type TransformEntry = { id: EntityId; before: Transform2; after: Transform2 };

export class TransformHistory {
  private readonly done: TransformEntry[] = [];
  private readonly undone: TransformEntry[] = [];
  readonly limit: number;
  constructor(limit = 40) { this.limit = limit; }

  /** record a committed change; drops the oldest entry past `limit` and clears the redo branch */
  push(entry: TransformEntry): void {
    this.done.push(entry);
    if (this.done.length > this.limit) this.done.shift();
    this.undone.length = 0;
  }
  get canUndo(): boolean { return this.done.length > 0; }
  get canRedo(): boolean { return this.undone.length > 0; }
  get depth(): number { return this.done.length; }

  /** pop the newest entry for replay at its `before`, or null */
  undo(): TransformEntry | null {
    const e = this.done.pop();
    if (!e) return null;
    this.undone.push(e);
    return e;
  }
  /** pop the newest undone entry for replay at its `after`, or null */
  redo(): TransformEntry | null {
    const e = this.undone.pop();
    if (!e) return null;
    this.done.push(e);
    return e;
  }
  clear(): void { this.done.length = 0; this.undone.length = 0; }
}
