// vo3d render — AMBIENT ELECTRONICS: one lightweight update path for every powered surface in the world.
//
// Builders tag a mesh with `userData.ambient = <channel spec>`; SceneMirror collects them once per room
// build (the same anchor/finalize pattern the desk succulents use) and this system advances them all from a
// single per-frame loop. There is no per-object system, no per-frame allocation, no canvas redrawing and no
// geometry churn — a channel only writes a number into a material or a position component it already owns.
//
// Three channel kinds cover everything Reception needs:
//   pulse  — slow emissive breathing (sensor rings, status LEDs, screen luminance)
//   travel — a small emissive mesh sliding along one local axis and looping (status-strip sweep, UI scan)
//   blip   — a rare, short, eased brightening (scanner sparkle); long period, per-instance phase
import * as THREE from "three";

type Emissive = { emissiveIntensity: number };
type Tintable = { color: THREE.Color; emissive?: THREE.Color };

/** A scanner's two-state colour language: BLUE while powered and waiting, GREEN on detection/approval. */
export type Tint = { idle: number; active: number };

/** Fields every channel may carry. `group` binds it to a scanner whose activation drives `tint`. */
type Common = {
  /** scanner id this channel belongs to (see setScanner) */
  group?: string;
  /** colours lerped by the scanner's smoothed activation */
  tint?: Tint;
  /** extra emissive/opacity gain at full activation */
  activeGain?: number;
};

export type AmbientPulse = Common & {
  kind: "pulse";
  /** seconds per breath */
  period: number;
  phase: number;
  min: number;
  max: number;
};
export type AmbientTravel = Common & {
  kind: "travel";
  axis: "x" | "y" | "z";
  from: number;
  to: number;
  period: number;
  phase: number;
  /** fade the sweep in/out at the ends so it does not pop */
  fade?: { min: number; max: number };
};
export type AmbientBlip = Common & {
  kind: "blip";
  period: number;
  phase: number;
  /** fraction of the period the blip occupies (kept small: this is a rare sparkle, not a flash) */
  duty: number;
  base: number;
  peak: number;
};
/** Opacity breathing for an additive glow plane — the channel that actually reads at game distance. */
export type AmbientFade = Common & {
  kind: "fade";
  period: number;
  phase: number;
  min: number;
  max: number;
};
export type AmbientSpec = AmbientPulse | AmbientTravel | AmbientBlip | AmbientFade;

/** A surface that is POWERED but not animated — every glow plane, halo and static emissive fixture.
 *  It costs nothing per frame; it exists so that switching the idle system off actually reads as the
 *  electronics powering down, instead of leaving a room full of glow with nothing driving it. */
type Powered = { m: { opacity?: number; emissiveIntensity?: number }; opacity: number | null; intensity: number | null };
/** what a powered surface falls to when the system is switched off: spill vanishes, sources go nearly dark */
const POWER_OFF = { glow: 0, emissive: 0.14 };

type Tinted = { group: string | null; tintA: THREE.Color | null; tintB: THREE.Color | null; target: Tintable | null; gain: number };
type Channel = Tinted &
  (
    | { kind: "pulse"; m: Emissive; period: number; phase: number; min: number; span: number }
    | { kind: "fade"; m: { opacity: number }; period: number; phase: number; min: number; span: number }
    | { kind: "travel"; o: THREE.Object3D; axis: "x" | "y" | "z"; from: number; span: number; period: number; phase: number; m: Emissive | null; fMin: number; fSpan: number }
    | { kind: "blip"; m: Emissive; period: number; phase: number; duty: number; base: number; span: number }
  );

/** smoothstep-eased 0..1 triangle: a breath, not a sine spike */
const breathe = (u: number): number => {
  const t = u < 0.5 ? u * 2 : (1 - u) * 2;
  return t * t * (3 - 2 * t);
};

/** Attack/release of the blue→green transition, in reciprocal seconds. Green arrives briskly (a reader
 *  responding) and lets go slowly, so a scanner never snaps or flickers as someone brushes past. */
const ATTACK = 6.5, RELEASE = 2.2;

export class AmbientSystem {
  /** keyed by room so rebuilding one room never drops another room's channels */
  private readonly byRoom = new Map<string, Channel[]>();
  /** scanner id → { target 0|1, smoothed activation } */
  private readonly scanners = new Map<string, { target: number; value: number }>();
  private readonly scratch = new THREE.Color();
  /** powered-but-unanimated surfaces, keyed by room like the channels */
  private readonly poweredByRoom = new Map<string, Powered[]>();
  private _enabled = true;

  /** Master switch for the idle system. Turning it OFF also powers DOWN every registered surface, so the
   *  difference is immediately visible rather than just "the breathing stopped". */
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(on: boolean) {
    if (on === this._enabled) return;
    this._enabled = on;
    this.applyPower(on);
  }
  private applyPower(on: boolean): void {
    for (const list of this.poweredByRoom.values())
      for (const p of list) {
        if (p.opacity !== null) p.m.opacity = on ? p.opacity : POWER_OFF.glow;
        if (p.intensity !== null) p.m.emissiveIntensity = on ? p.intensity : p.intensity * POWER_OFF.emissive;
      }
    if (on) return;
    // animated channels settle to the dim end of their own range
    for (const channels of this.byRoom.values())
      for (const c of channels) {
        if (c.kind === "fade") c.m.opacity = POWER_OFF.glow;
        else if (c.kind === "pulse") c.m.emissiveIntensity = c.min * POWER_OFF.emissive;
        else if (c.kind === "blip") c.m.emissiveIntensity = c.base * POWER_OFF.emissive;
        else if (c.m) c.m.emissiveIntensity = c.fMin * POWER_OFF.emissive;
      }
  }

  get channelCount(): number {
    let n = 0;
    for (const v of this.byRoom.values()) n += v.length;
    return n;
  }
  clearRoom(roomId: string): void {
    this.byRoom.delete(roomId);
    this.poweredByRoom.delete(roomId);
  }
  get poweredCount(): number {
    let n = 0;
    for (const v of this.poweredByRoom.values()) n += v.length;
    return n;
  }

  /** THE SCANNER STATE API. `active` = a person is in this scanner's zone.
   *  Idle (false) renders BLUE; active (true) eases to GREEN and back again on release. */
  setScanner(id: string, active: boolean): void {
    const s = this.scanners.get(id);
    if (s) s.target = active ? 1 : 0;
    else this.scanners.set(id, { target: active ? 1 : 0, value: 0 });
  }
  /** current smoothed activation, 0 = idle/blue … 1 = detected/green */
  scannerActivation(id: string): number {
    return this.scanners.get(id)?.value ?? 0;
  }
  get scannerIds(): string[] {
    return [...this.scanners.keys()];
  }

  /** MATERIAL SWAP NOTICE. The room editor replaces a strip's or a surface's material with one it owns
   *  (copy-on-write over the shared cache — editor/surfaces.ts, editor/emissive.ts). Every channel and
   *  powered surface here holds a MATERIAL REFERENCE, so without this the animation would keep writing to
   *  the material that is no longer on screen and the edited one would sit frozen.
   *
   *  Baselines are re-read from the new material, which is the correct reading of an edit: the designer
   *  just set what "full brightness" means for this fixture, so that is what powering it back on restores. */
  retarget(from: THREE.Material, to: THREE.Material): number {
    let n = 0;
    const next = to as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
    for (const channels of this.byRoom.values())
      for (const c of channels) {
        if (c.target === (from as unknown as Tintable)) c.target = next;
        if (c.m === (from as unknown as Emissive & { opacity: number })) { (c as { m: unknown }).m = next; n++; }
      }
    for (const list of this.poweredByRoom.values())
      for (const p of list)
        if (p.m === (from as unknown as Powered["m"])) {
          p.m = next;
          if (p.opacity !== null) p.opacity = next.opacity ?? p.opacity;
          if (p.intensity !== null) p.intensity = next.emissiveIntensity ?? p.intensity;
          n++;
        }
    return n;
  }

  /** Walk a freshly built room group and register every mesh tagged with `userData.ambient`. */
  collect(roomId: string, root: THREE.Object3D): number {
    const channels: Channel[] = [];
    const lit: Powered[] = [];
    let n = 0;
    root.traverse((o) => {
      const spec = o.userData.ambient as AmbientSpec | undefined;
      if (!spec) {
        if (o.userData.powered) {
          const pm = (o as THREE.Mesh).material as (THREE.MeshStandardMaterial & THREE.MeshBasicMaterial) | undefined;
          if (pm) lit.push({ m: pm, opacity: pm.transparent && pm.opacity !== undefined ? pm.opacity : null, intensity: pm.emissiveIntensity ?? null });
        }
        return;
      }
      const material = (o as THREE.Mesh).material as (THREE.MeshStandardMaterial & THREE.MeshBasicMaterial) | undefined;
      const tinted: Tinted = {
        group: spec.group ?? null,
        tintA: spec.tint ? new THREE.Color(spec.tint.idle) : null,
        tintB: spec.tint ? new THREE.Color(spec.tint.active) : null,
        target: spec.tint && material ? material : null,
        gain: spec.activeGain ?? 0,
      };
      if (spec.group && !this.scanners.has(spec.group)) this.scanners.set(spec.group, { target: 0, value: 0 });
      if (spec.kind === "pulse") {
        if (!material || material.emissiveIntensity === undefined) return;
        channels.push({ ...tinted, kind: "pulse", m: material, period: spec.period, phase: spec.phase, min: spec.min, span: spec.max - spec.min });
      } else if (spec.kind === "fade") {
        if (!material || material.opacity === undefined) return;
        channels.push({ ...tinted, kind: "fade", m: material, period: spec.period, phase: spec.phase, min: spec.min, span: spec.max - spec.min });
      } else if (spec.kind === "blip") {
        if (!material || material.emissiveIntensity === undefined) return;
        channels.push({ ...tinted, kind: "blip", m: material, period: spec.period, phase: spec.phase, duty: spec.duty, base: spec.base, span: spec.peak - spec.base });
      } else {
        const fade = spec.fade;
        channels.push({
          ...tinted,
          kind: "travel", o, axis: spec.axis, from: spec.from, span: spec.to - spec.from, period: spec.period, phase: spec.phase,
          m: fade && material && material.emissiveIntensity !== undefined ? material : null,
          fMin: fade?.min ?? 0, fSpan: fade ? fade.max - fade.min : 0,
        });
      }
      n++;
    });
    if (channels.length) this.byRoom.set(roomId, channels);
    if (lit.length) this.poweredByRoom.set(roomId, lit);
    if (!this._enabled) this.applyPower(false); // a room built while switched off comes up powered down
    return n;
  }

  /** Advance every channel to time `t` (seconds); `dt` advances the blue→green easing.
   *  A handful of arithmetic ops per channel and no allocation — the colour lerp reuses one scratch. */
  update(t: number, dt = 0): void {
    if (!this.enabled) return;
    if (dt > 0) {
      for (const s of this.scanners.values()) {
        const rate = s.target > s.value ? ATTACK : RELEASE;
        s.value += (s.target - s.value) * Math.min(1, rate * dt);
      }
    }
    for (const channels of this.byRoom.values()) {
      for (const c of channels) {
        const act = c.group ? (this.scanners.get(c.group)?.value ?? 0) : 0;
        const gain = 1 + act * c.gain;
        if (c.kind === "pulse") {
          const u = ((t / c.period + c.phase) % 1 + 1) % 1;
          c.m.emissiveIntensity = (c.min + c.span * breathe(u)) * gain;
        } else if (c.kind === "fade") {
          const u = ((t / c.period + c.phase) % 1 + 1) % 1;
          c.m.opacity = Math.min(1, (c.min + c.span * breathe(u)) * gain);
        } else if (c.kind === "blip") {
          const u = ((t / c.period + c.phase) % 1 + 1) % 1;
          c.m.emissiveIntensity = (u < c.duty ? c.base + c.span * breathe(u / c.duty) : c.base) * gain;
        } else {
          const u = ((t / c.period + c.phase) % 1 + 1) % 1;
          c.o.position[c.axis] = c.from + c.span * u;
          // fade in over the first fifth and out over the last fifth so the sweep never pops at the ends
          if (c.m) {
            const edge = u < 0.2 ? u / 0.2 : u > 0.8 ? (1 - u) / 0.2 : 1;
            c.m.emissiveIntensity = (c.fMin + c.fSpan * edge * edge * (3 - 2 * edge)) * gain;
          }
        }
        // BLUE → GREEN: one lerp into the material's own colours, no allocation
        if (c.target && c.tintA && c.tintB) {
          this.scratch.lerpColors(c.tintA, c.tintB, act);
          c.target.color.copy(this.scratch);
          if (c.target.emissive) c.target.emissive.copy(this.scratch);
        }
      }
    }
  }
}

/** Tag a mesh for the ambient system. Returns the mesh so it can be added inline. */
export function animated<T extends THREE.Object3D>(o: T, spec: AmbientSpec): T {
  o.userData.ambient = spec;
  return o;
}

/** Tag a mesh as POWERED but not animated — glow planes, halos, static emissive fixtures. It gains no
 *  per-frame cost; it only goes dark when the idle system is switched off. */
export function powered<T extends THREE.Object3D>(o: T): T {
  o.userData.powered = true;
  return o;
}
