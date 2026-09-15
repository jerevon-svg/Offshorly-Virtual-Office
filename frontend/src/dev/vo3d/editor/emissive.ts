// vo3d editor — THE LED / EMISSIVE REGISTRY.
//
// Same contract as editor/surfaces.ts, for the other half of art direction: an LED channel is addressable
// by name, copy-on-write over the shared material cache, and bounded to three numbers.
//
// WHAT THIS DELIBERATELY DOES NOT DO: create lights. Every strip in the office is an emissive bar plus one
// additive spill plane (build/led.ts) — no THREE.PointLight anywhere — and that is the whole reason a room
// can carry six of them at 60fps. The editor edits the bar's colour and emissive intensity and the spill's
// opacity. It never adds a real-time light, and it never touches blending, depth or render order.
//
// The ambient system holds MATERIAL REFERENCES for every powered and pulsed surface (render/Ambient), so
// swapping a material without telling it would leave a strip animating an orphan. Every swap here goes
// through `retarget`, which is exactly why that hook exists.
import * as THREE from "three";
import { PALETTE, type MatKey } from "../render/Materials";

/** What build/led.ts writes onto a strip group to make it addressable. */
export type LedTag = { id: string; roomId: string; label: string; color: MatKey; intensity: number; glow: number };

export function tagLed<T extends THREE.Object3D>(o: T, tag: LedTag): T {
  o.userData.led = tag;
  return o;
}

/** APPROVED LED COLOURS — the palette entries the office's own light channels are authored from. A free
 *  hex picker on an emissive surface is how a room ends up with a colour that exists nowhere else in the
 *  building, so this one stays a list. */
export const LED_COLORS: MatKey[] = [
  "gamingLed", "neonPink", "neonCyan", "neonGreen", "gamingViolet", "gamingBlue",
  "cyan", "gateLed", "readyGreen", "coveWarm", "execBrass", "white",
];

export type EmissiveSpec = {
  /** 0xRRGGBB, from LED_COLORS */
  color: number;
  /** 0 … 3 — the emitter bar's emissiveIntensity */
  intensity: number;
  /** 0 … 1 — the spill plane's opacity (0 = fixture only, no wash) */
  glow: number;
};
const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
export const clampEmissive = (s: EmissiveSpec): EmissiveSpec => ({
  color: Math.max(0, Math.min(0xffffff, Math.round(s.color))),
  intensity: clamp(s.intensity, 0, 3),
  glow: clamp(s.glow, 0, 1),
});
export const sameEmissive = (a: EmissiveSpec, b: EmissiveSpec): boolean =>
  a.color === b.color && a.intensity === b.intensity && a.glow === b.glow;
export const specFromLedTag = (t: LedTag): EmissiveSpec => ({ color: PALETTE[t.color], intensity: t.intensity, glow: t.glow });

type Owned = { mesh: THREE.Mesh; role: "emitter" | "wash"; original: THREE.Material };

export class LedEntry {
  readonly tag: LedTag;
  readonly meshes: Owned[] = [];
  readonly base: EmissiveSpec;
  committed: EmissiveSpec;
  preview: EmissiveSpec;
  private owned: THREE.Material[] = [];

  constructor(tag: LedTag) {
    this.tag = tag;
    this.base = specFromLedTag(tag);
    this.committed = { ...this.base };
    this.preview = { ...this.base };
  }
  get id(): string { return this.tag.id; }
  get pending(): boolean { return !sameEmissive(this.preview, this.committed); }

  show(spec: EmissiveSpec, retarget?: (from: THREE.Material, to: THREE.Material) => void): void {
    const next = clampEmissive(spec);
    this.preview = next;
    this.release(retarget, (o) => this.build(o, next));
  }
  cancel(retarget?: (from: THREE.Material, to: THREE.Material) => void): void {
    if (sameEmissive(this.preview, this.committed)) return;
    if (sameEmissive(this.committed, this.base)) this.restore(retarget);
    else this.show({ ...this.committed }, retarget);
    this.preview = { ...this.committed };
  }
  apply(): EmissiveSpec { this.committed = { ...this.preview }; return this.committed; }
  reset(retarget?: (from: THREE.Material, to: THREE.Material) => void): void {
    this.restore(retarget);
    this.committed = { ...this.base };
    this.preview = { ...this.base };
  }

  /** A strip's own material, cloned from whatever the room built it with so the fixture keeps its
   *  roughness, its alpha falloff, its blending and its floor-layer slot. Only the three edited fields
   *  are written — nothing that decides HOW it draws is touched. */
  private build(o: Owned, spec: EmissiveSpec): THREE.Material {
    const m = o.original.clone();
    m.name = `led:${this.tag.id}:${o.role}`;
    if (o.role === "emitter") {
      const s = m as THREE.MeshStandardMaterial;
      s.color.setHex(spec.color);
      s.emissive.setHex(spec.color);
      s.emissiveIntensity = spec.intensity;
    } else {
      const b = m as THREE.MeshBasicMaterial;
      b.color.setHex(spec.color);
      b.opacity = spec.glow;
      b.userData.baseOpacity = spec.glow; // what an animated spill breathes around
    }
    return m;
  }
  private release(retarget: ((from: THREE.Material, to: THREE.Material) => void) | undefined, make: (o: Owned) => THREE.Material): void {
    const prev = this.owned;
    this.owned = [];
    this.meshes.forEach((o, i) => {
      const next = make(o);
      const from = prev[i] ?? o.original;
      o.mesh.material = next;
      retarget?.(from, next);
      this.owned.push(next);
    });
    for (const m of prev) m.dispose();
  }
  private restore(retarget?: (from: THREE.Material, to: THREE.Material) => void): void {
    const prev = this.owned;
    this.owned = [];
    this.meshes.forEach((o, i) => {
      o.mesh.material = o.original;
      const from = prev[i];
      if (from) retarget?.(from, o.original);
    });
    for (const m of prev) m.dispose();
  }
  dispose(): void { for (const m of this.owned) m.dispose(); this.owned = []; }
}

export class LedRegistry {
  private readonly entries = new Map<string, LedEntry>();
  private readonly byRoom = new Map<string, string[]>();
  retarget: ((from: THREE.Material, to: THREE.Material) => void) | undefined;

  collect(roomId: string, root: THREE.Object3D): number {
    this.clearRoom(roomId);
    const ids: string[] = [];
    root.traverse((o) => {
      const tag = o.userData.led as LedTag | undefined;
      if (!tag) return;
      const entry = new LedEntry(tag);
      o.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        const m = mesh.material as THREE.Material & { emissive?: THREE.Color };
        if (m.emissive) entry.meshes.push({ mesh, role: "emitter", original: m });
        else if (m.transparent) entry.meshes.push({ mesh, role: "wash", original: m });
      });
      if (!entry.meshes.length) return;
      this.entries.set(tag.id, entry);
      ids.push(tag.id);
    });
    this.byRoom.set(roomId, ids);
    return ids.length;
  }
  clearRoom(roomId: string): void {
    for (const id of this.byRoom.get(roomId) ?? []) { this.entries.get(id)?.dispose(); this.entries.delete(id); }
    this.byRoom.delete(roomId);
  }
  get(id: string): LedEntry | null { return this.entries.get(id) ?? null; }
  all(): LedEntry[] { return [...this.entries.values()]; }
  inRoom(roomId: string): LedEntry[] { return this.all().filter((e) => e.tag.roomId === roomId); }
  get size(): number { return this.entries.size; }

  show(id: string, spec: EmissiveSpec): void { this.get(id)?.show(spec, this.retarget); }
  cancel(id: string): void { this.get(id)?.cancel(this.retarget); }
  reset(id: string): void { this.get(id)?.reset(this.retarget); }
  replay(id: string, spec: EmissiveSpec): void {
    const e = this.get(id);
    if (!e) return;
    if (sameEmissive(spec, e.base)) e.reset(this.retarget);
    else { e.show(spec, this.retarget); e.apply(); }
  }
}

/** The nearest addressable LED channel at or above `o`, or null. */
export function ledTagOf(o: THREE.Object3D | null): LedTag | null {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    const tag = n.userData.led as LedTag | undefined;
    if (tag) return tag;
  }
  return null;
}
