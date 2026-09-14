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
//
// TWO INDEPENDENT AXES. The environment holds a PHASE (day/sunset/night, from V1's clock via env/timeOfDay)
// and a WEATHER STATE (from env/weather, which knows nothing about time). Neither is derived from the
// other and neither is stored inside the other; they meet in exactly one place — env/weatherGrade — which
// hands back the composed preset. Setting either one re-applies from that single point, so there is no
// combination of the two that can be reached by one path and not the other.
import * as THREE from "three";
import type { Renderer } from "../render/Renderer";
import type { ExteriorScenery } from "../build/exterior";
import type { Rect } from "../core/coords";
import { type EnvPreset } from "./presets";
import { Rain } from "./Rain";
import { Sky } from "./Sky";
import type { EnvPhase } from "./timeOfDay";
import { weatherGrade } from "./weatherGrade";
import type { WeatherState } from "./weather";

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
 *  "interior" — a SEALED INTERIOR VOLUME (the Championship Cave). No sky, no campus, no rain, no fog and
 *             almost no sun: the room's own emissive surfaces are the light. This is not a darker grade
 *             of the day/night presentation — it is the statement that the outdoors is not visible from
 *             in here at all, which is exactly what a windowless theatre means. The phase still ticks
 *             underneath, so leaving restores whatever time of day it actually is.
 *
 *  The day/sunset/night GRADE is unaffected by "world"/"office": the office is lit by the same sun at
 *  the same time of day in both. "interior" deliberately opts out of it. */
export type EnvPresentation = "world" | "office" | "interior";

/** THE SEALED-INTERIOR RIG. Fixed, phase-independent, and dark on purpose: a video wall reads as a light
 *  source only if the room around it is not already lit. Everything is a floor, not a zero — a pitch-black
 *  room with one bright wall is unreadable, and a walker has to be able to see his own feet. */
const INTERIOR = {
  background: 0x04050a,
  key: { color: 0x8aa4d8, intensity: 0.16, azimuth: -40, elevation: 74 },
  fill: { color: 0x2a3a5e, intensity: 0.22 },
  hemi: { sky: 0x2b3550, ground: 0x0a0c12, intensity: 0.34 },
  envIntensity: 0.06,
  exposure: 1.05,
};

export class Environment {
  private readonly R: Renderer;
  private readonly scenery: ExteriorScenery | null;
  private readonly sky = new Sky();
  private readonly rain: Rain;
  private readonly fogColor = new THREE.Color();
  private readonly centre = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private current: EnvPhase | null = null;
  private _weather: WeatherState = "clear";
  private _fog = true;
  private _presentation: EnvPresentation = "world";
  /** OFFICE draws no campus, but rain is weather, not scenery — see `rainInOffice`. */
  private _rainInOffice = true;

  /** @param dry the office footprint, which it never rains on @param groundY the exterior grade */
  constructor(R: Renderer, scenery: ExteriorScenery | null = null, dry: Rect = { x: 0, z: 0, w: 0, d: 0 }, groundY = -8) {
    this.R = R;
    this.scenery = scenery;
    this.rain = new Rain(dry, groundY);
    if (scenery) R.scene.add(scenery.root);
    R.scene.add(this.sky.root);
    R.scene.add(this.rain.mesh);
  }

  /** Called once per frame: keeps the sky dome centred on the orbit target so panning cannot reach its
   *  edge, and rides the rain field on whichever camera is actually drawing. A handful of float writes and
   *  one uniform — no traversal, no allocation, nothing that scales with the scene.
   *
   *  WHICH CAMERA. OFFICE and EXPLORE draw the orthographic rig, whose "where am I looking" is the orbit
   *  target. PLAYER draws the perspective rig, whose orbit target is stale by design (CameraModes leaves
   *  the ortho rig exactly as it was so the view is resumed on the way back), so the field rides the eye
   *  instead. The extent likewise comes from what each rig can actually SEE: the ortho viewport's visible
   *  half-height — the same quantity Renderer.updateShadowFrame sizes itself from — clamped so a
   *  fully zoomed-out EXPLORE spreads the same streaks thinner instead of asking for a world of rain. */
  follow(dtSeconds = 0): void {
    this.sky.follow(this.R.target);
    if (this.rain.active) {
      const R = this.R;
      const player = R.activeCamera === R.playerCamera;
      if (player) this.centre.copy(R.playerCamera.position);
      else this.centre.copy(R.target);
      // ORTHO: the field is sized from the visible half-height — the same quantity the shadow frame uses —
      // and a streak is widened to hold a pixel floor, because a world unit is worth a different number of
      // pixels at every zoom. PERSPECTIVE already sizes things by depth, so it needs neither.
      //
      // PITCH MATTERS AS MUCH AS ZOOM. What a tilted camera sees on the ground is not a square around the
      // target, it is a trapezoid running away toward the viewer — at 30 deg it reaches roughly twice as
      // far as the viewport is tall. A box sized from the viewport alone therefore leaves the NEAR half of
      // the screen dry while it rains in the distance, which is what a first cut of this did. Dividing by
      // sin(pitch) stretches the box to cover that reach; the floor keeps a near-overhead view from asking
      // for an infinite one.
      const visibleHalf = R.camera.top / Math.max(R.camera.zoom, 1e-6);
      const sinPitch = Math.max(0.34, Math.abs(R.camera.getWorldDirection(this.forward).y));
      const half = player ? 560 : THREE.MathUtils.clamp((visibleHalf * 1.15) / sinPitch, 360, 1800);
      const heightPx = R.renderer.domElement.height / R.renderer.getPixelRatio();
      const worldPerPixel = player || heightPx < 1 ? 0 : (visibleHalf * 2) / heightPx;
      this.rain.follow(this.centre, half, worldPerPixel);
      this.rain.update(dtSeconds);
    }
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
  get weather(): WeatherState {
    return this._weather;
  }
  /** Switch weather. Returns true if it changed. Re-grades and re-parameterises only: no geometry is
   *  built, no room is rebuilt, no material is recompiled and the world is not reloaded. */
  setWeather(w: WeatherState, force = false): boolean {
    if (w === this._weather && !force) return false;
    this._weather = w;
    if (this.current) this.apply(this.current, true);
    return true;
  }
  /** Whether rain is drawn in OFFICE presentation. Rain is WEATHER, not campus — it reveals no terrain,
   *  no road and no lot, so the exterior-hidden illusion survives it and "it is raining outside" reads
   *  even in the product view. Flipped off here if that is ever not wanted; nothing else changes. */
  get rainInOffice(): boolean {
    return this._rainInOffice;
  }
  set rainInOffice(on: boolean) {
    this._rainInOffice = on;
    if (this.current) this.apply(this.current, true);
  }
  /** draw stats for the bench readout */
  get rainStats(): { draws: number; instances: number; triangles: number } {
    return this.rain.stats;
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
    // THE ONE COMPOSITION POINT. Weather × phase resolve here and nowhere else.
    const g = weatherGrade(this._weather, phase);
    this.rain.setParams(g.rain);
    this.scenery?.applyWetness(g.wetness);
    this.write(g.preset);
    return true;
  }

  private write(p: EnvPreset): void {
    const R = this.R;
    // A SEALED INTERIOR short-circuits the whole weather/phase composition: nothing outdoors is drawn,
    // and the grade that would light it is not applied. One early return, so no later line can leak a sky.
    if (this._presentation === "interior") {
      this.rain.visible = false;
      if (this.scenery) this.scenery.root.visible = false;
      this.sky.root.visible = false;
      R.scene.background = this.fogColor.setHex(INTERIOR.background).clone();
      R.scene.fog = null;
      R.key.color.setHex(INTERIOR.key.color);
      R.fill.color.setHex(INTERIOR.fill.color);
      R.fill.intensity = INTERIOR.fill.intensity;
      R.hemi.color.setHex(INTERIOR.hemi.sky);
      R.hemi.groundColor.setHex(INTERIOR.hemi.ground);
      R.lightParams = {
        azimuth: INTERIOR.key.azimuth, elevation: INTERIOR.key.elevation,
        keyIntensity: INTERIOR.key.intensity, ambientIntensity: INTERIOR.hemi.intensity,
        envIntensity: INTERIOR.envIntensity, exposure: INTERIOR.exposure,
      };
      R.placeLight();
      return;
    }
    const office = this._presentation === "office";
    this.rain.visible = !office || this._rainInOffice;
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
