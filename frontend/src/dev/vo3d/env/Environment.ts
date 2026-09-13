// vo3d env — THE GLOBAL ENVIRONMENT. One owner for everything that is true of the whole world at once.
//
// It owns:   sky/background · the sun/moon directional key · the cool fill · hemisphere ambient ·
//            environment (IBL) intensity · tone-mapping exposure · distance haze · the exterior scenery
//            and its practical lights.
// It does NOT own: anything inside a room. Rooms keep their scoped ambient electronics (render/Ambient),
//            their own emissive fixtures and their own materials, untouched. There is not one
//            room-specific branch in this file.
//
// SHADOWS. The renderer redraws the shadow map on demand (Renderer.shadowMap.autoUpdate = false). Moving
// the sun invalidates it — Renderer.placeLight() already does exactly that — so applying a phase is a
// correct invalidation point and the map is never left drawn for the previous sun.
import * as THREE from "three";
import type { Renderer } from "../render/Renderer";
import type { ExteriorScenery } from "../build/exterior";
import { ENV_PRESETS, type EnvPreset } from "./presets";
import { Sky } from "./Sky";
import type { EnvPhase } from "./timeOfDay";

/** WHICH WORLD THE ENVIRONMENT IS PRESENTING.
 *
 *  "world"  — everything: terrain, roads, planting, vehicles, the pond, the future-lot markers, the sky
 *             dome and its stars. This is 3D EXPLORE, and the reveal.
 *  "office" — V1's illusion. The exterior is NOT DRAWN AT ALL and the backdrop is a flat stage tone, so
 *             the office reads as the entire world. Camera bounds alone cannot achieve this: a 16:9
 *             viewport framing a near-square office necessarily overflows it sideways, and whatever is
 *             out there would show. Nothing is deleted or rebuilt — one visibility flag, flipped back the
 *             instant EXPLORE is entered.
 *
 *  The day/sunset/night GRADE is unaffected by either: the office is lit by the same sun at the same time
 *  of day in both presentations. */
export type EnvPresentation = "world" | "office";

export class Environment {
  private readonly R: Renderer;
  private readonly scenery: ExteriorScenery | null;
  private readonly sky = new Sky();
  private readonly fogColor = new THREE.Color();
  private current: EnvPhase | null = null;
  private _fog = true;
  private _presentation: EnvPresentation = "world";

  constructor(R: Renderer, scenery: ExteriorScenery | null = null) {
    this.R = R;
    this.scenery = scenery;
    if (scenery) R.scene.add(scenery.root);
    R.scene.add(this.sky.root);
  }

  /** Called once per frame: keeps the sky dome centred on the orbit target so panning cannot reach its
   *  edge. Three float writes — cheap enough to do unconditionally. */
  follow(): void {
    this.sky.follow(this.R.target);
  }
  get skyVisible(): boolean {
    return this.sky.root.visible;
  }
  set skyVisible(on: boolean) {
    if (this._presentation === "world") this.sky.root.visible = on;
  }

  get phase(): EnvPhase | null {
    return this.current;
  }
  get presentation(): EnvPresentation {
    return this._presentation;
  }
  /** Switch presentation. Returns true if it changed, so callers can invalidate shadows once. */
  setPresentation(p: EnvPresentation): boolean {
    if (p === this._presentation) return false;
    this._presentation = p;
    if (this.current) this.apply(this.current, true);
    return true;
  }
  get sceneryVisible(): boolean {
    return this.scenery ? this.scenery.root.visible : false;
  }
  set sceneryVisible(on: boolean) {
    // a manual override, meaningful only in world presentation — office never draws the exterior anyway
    if (this.scenery && this._presentation === "world") this.scenery.root.visible = on;
  }
  get fogEnabled(): boolean {
    return this._fog;
  }
  set fogEnabled(on: boolean) {
    this._fog = on;
    if (this.current) this.apply(this.current, true);
  }

  /** Apply a phase. Returns true if anything actually changed (so callers can avoid per-frame work). */
  apply(phase: EnvPhase, force = false): boolean {
    if (phase === this.current && !force) return false;
    this.current = phase;
    this.write(ENV_PRESETS[phase]);
    return true;
  }

  private write(p: EnvPreset): void {
    const R = this.R;
    const office = this._presentation === "office";
    // OFFICE: nothing exterior is drawn, and the backdrop is a flat stage tone rather than a sky.
    if (this.scenery) this.scenery.root.visible = !office;
    this.sky.root.visible = !office;
    R.scene.background = this.fogColor.setHex(office ? p.stage : p.sky).clone();
    // Fog offsets are measured from the orbit distance, so the office at the camera target always sits in
    // front of the haze and only the far landscape resolves into the sky.
    // Haze resolves to the sky's HORIZON band, not its zenith: that is the colour the far landscape is
    // dissolving into, and matching it is what stops the terrain disc reading as a floating plate when
    // EXPLORE drops the pitch far enough to see the horizon. In OFFICE there is no landscape to haze.
    R.scene.fog = !office && this._fog && p.fog ? new THREE.Fog(p.skyGrade.horizon, R.camDist + p.fog.near, R.camDist + p.fog.far) : null;
    R.key.color.setHex(p.key.color);
    R.fill.color.setHex(p.fill.color);
    R.fill.intensity = p.fill.intensity;
    R.hemi.color.setHex(p.hemi.sky);
    R.hemi.groundColor.setHex(p.hemi.ground);
    // placeLight() writes the intensities/exposure AND invalidates the shadow map for the new sun.
    R.lightParams = {
      azimuth: p.key.azimuth,
      elevation: p.key.elevation,
      keyIntensity: p.key.intensity,
      ambientIntensity: p.hemi.intensity,
      envIntensity: p.envIntensity,
      exposure: p.exposure,
    };
    R.placeLight();
    this.sky.apply(p.skyGrade);
    this.scenery?.applyTint(p.exteriorTint);
    this.scenery?.applyPracticals(p.practicals);
  }
}
