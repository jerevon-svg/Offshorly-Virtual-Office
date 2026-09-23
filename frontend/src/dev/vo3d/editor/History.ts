// vo3d editor — BOUNDED edit history. Deliberately not a command framework.
//
// One entry = ONE confirmed designer action, recorded as before → after. Undo/redo replay it through the
// SAME paths a confirm uses — WorldState.commit + walkability resync for a transform, create or delete;
// the surface / LED registry's own replay for a material change — so the atomic-transaction guarantee is
// identical whether a change arrives from a drag or from Ctrl-Z. Preview state is never recorded, because
// preview is not authoritative.
//
// Slice 2 widens the entry from a transform to a small union. The store is unchanged: it is still two
// stacks and a cap.
import type { Entity, EntityId, Transform2 } from "../world/WorldState";
import type { SurfaceSpec } from "./surfaces";
import type { EmissiveSpec } from "./emissive";

export type TransformEntry = { kind?: "transform"; id: EntityId; before: Transform2; after: Transform2 };
/** the whole entity, so an undone delete comes back with its footprint, capabilities and props intact */
export type CreateEntry = { kind: "create"; entity: Entity };
export type DeleteEntry = { kind: "delete"; entity: Entity };
export type SurfaceEntryRecord = { kind: "surface"; surfaceId: string; before: SurfaceSpec; after: SurfaceSpec };
export type EmissiveEntryRecord = { kind: "emissive"; ledId: string; before: EmissiveSpec; after: EmissiveSpec };

export type EditEntry = TransformEntry | CreateEntry | DeleteEntry | SurfaceEntryRecord | EmissiveEntryRecord;
/** a transform entry may omit `kind` — that is how Slice 1 wrote them, and undo must keep reading them */
export const entryKind = (e: EditEntry): NonNullable<EditEntry["kind"]> => e.kind ?? "transform";

export class TransformHistory {
  private readonly done: EditEntry[] = [];
  private readonly undone: EditEntry[] = [];
  readonly limit: number;
  constructor(limit = 60) { this.limit = limit; }

  /** record a committed change; drops the oldest entry past `limit` and clears the redo branch */
  push(entry: EditEntry): void {
    this.done.push(entry);
    if (this.done.length > this.limit) this.done.shift();
    this.undone.length = 0;
  }
  get canUndo(): boolean { return this.done.length > 0; }
  get canRedo(): boolean { return this.undone.length > 0; }
  get depth(): number { return this.done.length; }
  /** what undo would reverse next, without reversing it — the panel labels its button with this */
  peek(): EditEntry | null { return this.done[this.done.length - 1] ?? null; }

  /** pop the newest entry for replay at its `before`, or null */
  undo(): EditEntry | null {
    const e = this.done.pop();
    if (!e) return null;
    this.undone.push(e);
    return e;
  }
  /** pop the newest undone entry for replay at its `after`, or null */
  redo(): EditEntry | null {
    const e = this.undone.pop();
    if (!e) return null;
    this.done.push(e);
    return e;
  }
  clear(): void { this.done.length = 0; this.undone.length = 0; }
}
