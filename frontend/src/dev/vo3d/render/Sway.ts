// vo3d render — foliage sway: per-node sinusoidal rotation, registered per entity id so a moved
// entity keeps its nodes (they are children of its group). Promoted from designRoom3d/build.ts.
import type * as THREE from "three";
import type { EntityId } from "../world/WorldState";

/** One animated node: rotates about `axis` by amp·sin(t·freq + phase) (+ a small harmonic) around `base`. */
export type SwayNode = { obj: THREE.Object3D; axis: "x" | "z"; amp: number; freq: number; phase: number; base: number };

export class SwaySystem {
  private readonly byEntity = new Map<EntityId, SwayNode[]>();
  enabled = true;
  register(id: EntityId, nodes: SwayNode[]): void {
    this.byEntity.set(id, nodes);
  }
  unregister(id: EntityId): void {
    this.byEntity.delete(id);
  }
  nodesOf(id: EntityId): readonly SwayNode[] {
    return this.byEntity.get(id) ?? [];
  }
  get nodeCount(): number {
    let n = 0;
    for (const v of this.byEntity.values()) n += v.length;
    return n;
  }
  /** Advance every node to time `t` (seconds). Cheap: two sins per node. */
  update(t: number): void {
    if (!this.enabled) return;
    for (const nodes of this.byEntity.values()) {
      for (const n of nodes) {
        const v = n.base + n.amp * Math.sin(t * n.freq + n.phase) + n.amp * 0.35 * Math.sin(t * n.freq * 2.3 + n.phase * 1.7);
        if (n.axis === "x") n.obj.rotation.x = v;
        else n.obj.rotation.z = v;
      }
    }
  }
}
