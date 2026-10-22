// vo3d human — THE SHARED FACE / LIFE LAYER. Any identity that publishes landmarks gets it; nothing is per person.
//
// Generalised from the MonkeyAgent's face shells (avatar/MonkeyAgentBody — not imported, not changed) and
// redesigned for humans: an almond eye with a moving upper lid that carries its own lash line, iris/pupil/two
// highlights, a lower lid for smiles, and an open-mouth shape over the identity's painted mouth.
//   blink      randomised (1.6–5.5 s, ~15% doubles), 0.17 s, eyes FULLY closed at the middle of it
//   look       a world target (eyes first, within the eye; the head follows through the rig layer), or idle glances
//   talk       syllable-paced mouth opening
//   expression neutral / happy / surprised / focused / sleepy — lid targets eased, never snapped
import * as THREE from "three";
import { faceUniforms, type FaceUniforms } from "./humanMaterials";
import type { IdentityLandmarks } from "./humanBaseContract";
import type { HumanRig } from "./humanRig";

export type Expression = "neutral" | "happy" | "surprised" | "focused" | "sleepy";
/** lid targets per expression: [upper lid closure, lower lid rise, widen] */
export const EXPRESSIONS: Readonly<Record<Expression, readonly [number, number, number]>> = {
  neutral: [0, 0, 0],
  happy: [0.12, 0.5, 0],
  surprised: [-0.12, 0, 1],
  focused: [0.3, 0.12, 0],
  sleepy: [0.62, 0.05, 0],
};

export const BLINK_S = 0.17;

export class HumanFace {
  readonly uniforms: FaceUniforms;
  readonly landmarks: IdentityLandmarks;
  expression: Expression = "neutral";
  talking = false;
  /** a world point to look at; null = idle glances */
  lookTarget: THREE.Vector3 | null = null;
  blinking = true;
  /** identity: how far the upper lid rests closed (heavy / hooded eyes) */
  lidRest = 0;
  private blinkIn = 1.2 + Math.random() * 2.5;
  private blinkT = -1;
  private doubleBlink = false;
  private lids = { close: 0, lower: 0, wide: 0 };
  private glance = new THREE.Vector2();
  private glanceIn = 1;
  private talkT = 0;
  /** the last update's cost (ms) — the proof reports the face's price */
  lastMs = 0;
  /** dev/test: hold chosen face values for a still capture (null = live) */
  hold: { close?: number; look?: [number, number]; open?: number } | null = null;
  /** the current eyelid closure (0 open … 1 shut), for tests and the panel */
  closure = 0;

  constructor(landmarks: IdentityLandmarks) {
    this.landmarks = landmarks;
    this.uniforms = faceUniforms(landmarks.skin, landmarks.iris, landmarks.eyes.lashTop ?? 1.5);
  }

  setSkin(hex: string): void { this.uniforms.uSkin.value.set(hex); }
  blink(): void { if (this.blinkT < 0) this.blinkT = 0; }

  update(dt: number, rig: HumanRig | null): void {
    const t0 = performance.now();
    const u = this.uniforms;
    // ---- lids: expression targets, eased ----
    const [c, l, w] = EXPRESSIONS[this.expression];
    const k = 1 - Math.exp(-dt * 10);
    this.lids.close += (c - this.lids.close) * k; this.lids.lower += (l - this.lids.lower) * k; this.lids.wide += (w - this.lids.wide) * k;
    // ---- blink ----
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const x = this.blinkT / BLINK_S;
      blink = x < 0.45 ? x / 0.45 : x < 0.55 ? 1 : Math.max(0, 1 - (x - 0.55) / 0.45);
      if (x >= 1) {
        this.blinkT = this.doubleBlink ? -0.09 : -1;
        if (this.doubleBlink) { this.doubleBlink = false; this.blinkIn = 0.09; } else this.blinkIn = 1.6 + Math.random() * 3.9;
      }
    } else if (this.blinking && (this.blinkIn -= dt) <= 0) { this.blinkT = 0; this.doubleBlink = Math.random() < 0.15; }
    const lid = Math.min(0.95, this.lids.close + this.lidRest * (1 - Math.max(0, this.lids.close)));
    const close = lid + (1 - Math.max(0, lid)) * blink;
    u.uClose.value = close; u.uLower.value = this.lids.lower; u.uWide.value = this.lids.wide;
    this.closure = Math.max(0, close);
    // ---- look ----
    const want = new THREE.Vector2();
    if (this.lookTarget && rig) {
      // the target in the head's BIND space, from the midpoint between the eyes
      const m = rig.bindMatrixOf("Head", new THREE.Matrix4()).invert();
      const p = this.lookTarget.clone().applyMatrix4(m);
      const e = this.landmarks.eyes;
      const d = p.sub(new THREE.Vector3((e.l[0] + e.r[0]) / 2, (e.l[1] + e.r[1]) / 2, (e.l[2] + e.r[2]) / 2));
      want.set(Math.max(-1, Math.min(1, Math.atan2(d.x, Math.max(1e-3, d.z)) / 0.55)), Math.max(-1, Math.min(1, Math.atan2(d.y, Math.hypot(d.x, d.z)) / 0.45)));
    } else {
      if ((this.glanceIn -= dt) <= 0) {
        this.glanceIn = 1.2 + Math.random() * 3;
        this.glance.set((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.3);
        if (Math.random() < 0.4) this.glance.set(0, 0);
      }
      want.copy(this.glance);
    }
    u.uLook.value.lerp(want, 1 - Math.exp(-dt * 14));
    // ---- talk ----
    if (this.talking) {
      this.talkT += dt;
      const syl = Math.abs(Math.sin(this.talkT * 11.5)) * (0.55 + 0.45 * Math.sin(this.talkT * 3.1 + 1.3));
      u.uOpen.value += (0.12 + 0.6 * syl - u.uOpen.value) * (1 - Math.exp(-dt * 25));
      u.uMouthWide.value = 0.85 + 0.25 * Math.sin(this.talkT * 5.3);
    } else u.uOpen.value += (0 - u.uOpen.value) * (1 - Math.exp(-dt * 18));
    // review/test override (dev captures freeze a frame of the face); null in normal use
    if (this.hold) { if (this.hold.close !== undefined) u.uClose.value = this.hold.close; if (this.hold.look) u.uLook.value.set(...this.hold.look); if (this.hold.open !== undefined) u.uOpen.value = this.hold.open; }
    this.lastMs = performance.now() - t0;
  }
}
