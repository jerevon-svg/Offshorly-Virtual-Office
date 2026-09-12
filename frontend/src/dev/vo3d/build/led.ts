// vo3d build — LED STRIP: the one place an architectural or furniture light channel is built.
//
// Before this, the "emissive bar + additive wash + ambient pulse" triple was hand-written at every call
// site (reception gates, the front-bar cove, the project brewers). The Gaming Room needs six of them, so
// the pattern is finally a function. Existing rooms are deliberately NOT migrated — this is groundwork.
//
// THE RULE THIS ENCODES: an LED is a PHYSICAL OBJECT first. Every strip is a slim dark extrusion (the
// channel) with a bright emitter sitting proud of its mouth; the wash is one low-opacity additive plane
// and is always secondary. A glow with no fixture behind it is what makes a room read as a neon arcade
// instead of a lit interior, so the fixture is not optional here.
import * as THREE from "three";
import { rbox } from "./helpers";
import { emissiveMat, emissiveMatUnique, glowMat, glowMatUnique, mat, type MatKey } from "../render/Materials";
import { animated, powered } from "../render/Ambient";

export type LedStripSpec = {
  /** the world axis the strip RUNS along */
  axis: "x" | "z";
  /** extent along `axis` (world) */
  from: number;
  to: number;
  /** the other horizontal coordinate: world z when axis is "x", world x when axis is "z" */
  at: number;
  /** base height of the channel */
  y: number;
  color: MatKey;
  /** which way the emitter faces: +1 → increasing z (axis "x") or x (axis "z"), −1 → the other way */
  dir?: 1 | -1;
  intensity?: number;
  /** false = bare tape (inside a cabinet, where the carcass is already the fixture) */
  housing?: boolean;
  /** the single additive spill plane. `reach` is how far it carries, `y` where it floats. */
  wash?: { reach: number; opacity: number; y?: number };
  /** ambient breathing. Omit for a purely static source — most strips should be static. */
  pulse?: { period: number; phase: number; min: number; max: number };
  /** Breathe the SPILL as well as the source. Light that brightens while the floor under it stays put
   *  reads as a glowing decal; giving the wash its own slightly-lagged fade is what makes it read as
   *  emitted. Costs one ambient channel, so it is reserved for the strips that actually carry a room. */
  washPulse?: { period: number; phase: number; min: number; max: number };
  name?: string;
};

/** A strip's channel + emitter + (optional) spill, in WORLD space. */
export function ledStrip(spec: LedStripSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = spec.name ?? "led-strip";
  const len = spec.to - spec.from;
  const mid = (spec.from + spec.to) / 2;
  const dir = spec.dir ?? 1;
  const along = spec.axis === "x";
  // one mapping from (offset across the strip) → world position / box size, so the two axes share a body
  const at = (off: number): { x: number; z: number } => (along ? { x: mid, z: spec.at + off } : { x: spec.at + off, z: mid });
  const box = (across: number): { w: number; d: number } => (along ? { w: len, d: across } : { w: across, d: len });

  if (spec.housing !== false) {
    const s = box(2.4), p = at(0);
    g.add(rbox(s.w, 2.0, s.d, mat("charcoal", 0.55), p.x, spec.y, p.z, 0.35));
  }
  const es = box(1.5), ep = at(dir * 0.85);
  const inten = spec.intensity ?? 1.4;
  // a pulsed strip needs its OWN material to carry its phase; a static one shares the cache
  const emitter = spec.pulse ? emissiveMatUnique(spec.color, inten, 0.3) : emissiveMat(spec.color, inten, 0.3);
  const bar = rbox(es.w, 1.0, es.d, emitter, ep.x, spec.y + 0.5, ep.z, 0.22);
  bar.castShadow = false;
  // an animated strip settles through its own channel; a static one powers down as a lit surface
  g.add(spec.pulse ? animated(bar, { kind: "pulse", ...spec.pulse }) : powered(bar));

  if (spec.wash) {
    const r = spec.wash.reach;
    const ws = box(r), wp = at(dir * (r / 2 + 1.2));
    // a breathing wash needs its OWN material to carry its phase, exactly as a pulsed emitter does
    const wm = spec.washPulse ? glowMatUnique(spec.color, spec.wash.opacity) : glowMat(spec.color, spec.wash.opacity);
    const wash = rbox(ws.w, 0.04, ws.d, wm, wp.x, spec.wash.y ?? 0.08, wp.z, 0);
    wash.castShadow = wash.receiveShadow = false;
    // spill has no business glowing once the source is off: animated ones settle through their channel
    g.add(spec.washPulse ? animated(wash, { kind: "fade", ...spec.washPulse }) : powered(wash));
  }
  return g;
}
