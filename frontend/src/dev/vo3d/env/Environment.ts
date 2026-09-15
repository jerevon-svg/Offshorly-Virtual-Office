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
import { blendPresetInto, clonePreset, lerpHex, type EnvPreset } from "./presets";
import { Bolt } from "./Bolt";
import { Lightning, type ThunderEvent } from "./Lightning";
import { Rain } from "./Rain";
import { Sky } from "./Sky";
import type { EnvPhase } from "./timeOfDay";
import { LIGHTNING_PHASE_GAIN, weatherGrade, type RainParams } from "./weatherGrade";
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
/** HOW LONG A GRADE TAKES TO TRAVEL, as the time constant of an exponential approach, in seconds. A
 *  transition is held open for 4 tau and then snapped exactly onto the target, so CLEAR still lands
 *  byte-for-byte on the approved day/sunset/night presentation rather than creeping at it forever.
 *
 *  WEATHER IS FASTER THAN THE CLOCK. A shower arriving over a couple of seconds is weather; the sun
 *  taking a couple of seconds to cross from afternoon to dusk is a light switch being thrown slowly, and
 *  wants the longer ramp. Neither is long enough to be sat through: the point is only that no material
 *  and no light ever changes between one frame and the next. */
const TAU: Record<"weather" | "phase", number> = { weather: 0.85, phase: 1.3 };

/** HOW MUCH OF A LIGHTNING FLASH EACH PRESENTATION GETS.
 *
 *  INTERIOR IS ZERO AND THAT IS THE WHOLE POINT. The Championship Cave is a sealed, windowless volume;
 *  a storm outside it is not merely dimmer in there, it is not observable at all. The scheduler is
 *  stopped rather than dimmed (see apply()), so the CAVE cannot receive a flash by any path.
 *
 *  OFFICE is pulled back because there is no sky on screen to flash: a full-strength global exposure
 *  pop with nothing visibly causing it stops reading as lightning and starts reading as the UI blinking. */
const PRESENTATION_FLASH: Record<EnvPresentation, number> = { world: 1, office: 0.55, interior: 0 };

/** WHAT A FLASH BUYS, per unit of (flash x phase gain x presentation gain). Everything here is a level
 *  or a colour — there is no light to create, no shadow to redraw and no material to recompile. */
/** RAISED so that a strike is unmistakable without ever being a white screen. The old set was tuned
 *  against a night sky and read as a flicker in daylight; these are roughly 40% stronger across the board,
 *  which lands a NIGHT strike at an obvious but still atmospheric pop and a DAY one at something you
 *  actually notice. Everything here is still a LEVEL or a COLOUR — no light is created, no shadow map is
 *  invalidated and no material is recompiled, so a brighter flash costs exactly what the old one did.
 *  `skyMix` stays well under 1: the dome brightens toward a cold white, it never becomes one. */
const FLASH = { key: 1.6, ambient: 2.6, env: 0.45, exposure: 0.55, fill: 1.2, sky: 0xe8eeff, skyMix: 0.72 };

const INTERIOR = {
  background: 0x04050a,
  key: { color: 0x8aa4d8, intensity: 0.16, azimuth: -40, elevation: 74 },
  fill: { color: 0x2a3a5e, intensity: 0.22 },
  hemi: { sky: 0x2b3550, ground: 0x0a0c12, intensity: 0.34 },
  envIntensity: 0.06,
  exposure: 1.05,
  // A SEALED, NEARLY UNLIT VOLUME IS WHERE CONTACT OCCLUSION EARNS THE MOST. With almost no directional
  // light there are no cast shadows to ground anything, so screen-space AO is the only thing telling the
  // eye that a seat sits ON the tier rather than floating over it.
  ao: 0.6,
};

export class Environment {
  private readonly R: Renderer;
  private readonly scenery: ExteriorScenery | null;
  private readonly sky = new Sky();
  private readonly rain: Rain;
  private readonly centre = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private current: EnvPhase | null = null;
  private _weather: WeatherState = "clear";
  private _fog = true;
  private _presentation: EnvPresentation = "world";
  /** OFFICE draws no campus, but rain is weather, not scenery — see `rainInOffice`. */
  private _rainInOffice = true;

  // ---- the transition -------------------------------------------------------------------------------
  // TWO GRADES AT ONCE. `target` is the composition weather x phase resolves to — the thing the world is
  // heading for. `shown` is what is actually on screen this frame. Both are objects this class OWNS and
  // writes into; nothing here allocates a preset per frame, which is what a transition running at 60Hz
  // would otherwise do six times over (see presets.blendPresetInto).
  private readonly target: EnvPreset;
  private readonly shown: EnvPreset;
  private readonly targetRain: RainParams = { perMillion: 0, opacity: 0, speed: 0, length: 1 };
  private readonly shownRain: RainParams = { perMillion: 0, opacity: 0, speed: 0, length: 1 };
  private targetWetness = 0;
  private shownWetness = 0;
  private targetWind = 0;
  private shownWind = 0;
  /** seconds of transition still to run; 0 = settled and the write path is idle */
  private travel = 0;
  private tau = TAU.weather;
  /** the sun's last WRITTEN direction. Re-grading only pays for a shadow redraw when this moves. */
  private lastAz = Number.NaN;
  private lastEl = Number.NaN;
  private elapsed = 0;
  private _transitions = true;

  // ---- the storm ------------------------------------------------------------------------------------
  private readonly lightning = new Lightning();
  /** THE VISIBLE CHANNEL. One line object for the life of the world; see env/Bolt for why it is free. */
  private readonly bolt = new Bolt();
  private shownFlash = 0;
  /** background is one Color for the life of the environment, written in place */
  private readonly bg = new THREE.Color();
  /** likewise one Fog: `new THREE.Fog()` per write was free at twice a day and is not free per frame */
  private readonly fogNode = new THREE.Fog(0xffffff, 1, 2);

  /** @param dry the office footprint, which it never rains on @param groundY the exterior grade */
  constructor(R: Renderer, scenery: ExteriorScenery | null = null, dry: Rect = { x: 0, z: 0, w: 0, d: 0 }, groundY = -8) {
    this.R = R;
    this.scenery = scenery;
    this.rain = new Rain(dry, groundY);
    if (scenery) R.scene.add(scenery.root);
    R.scene.add(this.sky.root);
    R.scene.add(this.rain.mesh);
    R.scene.add(this.bolt.object);
    // seeded from a real grade so neither preset is ever half-built; both are replaced on the first apply
    const seed = weatherGrade("clear", "day");
    this.target = clonePreset(seed.preset);
    this.shown = clonePreset(seed.preset);
    // THE THUNDER SEAM, FORWARDED AND NOT CONSUMED. Nothing in vo3d plays a sound; this hands the event
    // straight through to whoever set `onThunder`, which today is the dev readout and tomorrow is the
    // spatial ambient-audio phase. See env/Lightning for what the event carries and why.
    // A STRIKE DRAWS ITS OWN CHANNEL, at the distance the event already decided, before the event is
    // forwarded. No second scheduler and no second source of truth about where or how far away it was.
    this.lightning.onStrike = (e) => {
      this.bolt.strike(e.distanceKm, this.centre);
      this.onThunder?.(e);
    };
  }

  /** THE AUDIO PHASE'S ONE SUBSCRIPTION POINT. Fires the instant the sky lights, carrying the strike's
   *  strength, its distance in km and the seconds until the clap should be heard. Deliberately a plain
   *  callback: no event bus, no audio context, no scheduler — the next phase owns all three, and finding
   *  a half-built one here would be worse than finding nothing. */
  onThunder: ((e: ThunderEvent) => void) | null = null;

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
    // A PRESENTATION SWITCH IS NOT WEATHER AND MUST NOT FADE. Walking into the Cave, or leaving EXPLORE
    // for OFFICE, is a cut: fading the sky out over a second would show the world dissolving through the
    // wall behind it. Retarget, then land on the same frame.
    if (this.current) {
      this.apply(this.current, true);
      this.settle();
    }
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

  /** RETARGET. Returns true if anything actually changed (so callers can avoid per-frame work).
   *
   *  This no longer WRITES the new presentation — it names it. The world then travels there over the next
   *  second or two under tick(), because a shower that arrives between two frames, or a sun that jumps
   *  from afternoon to dusk on a single frame, is the one thing that gives a weather system away. The
   *  first grade of the session, a presentation switch and an explicit settle() all still land instantly:
   *  there is nothing to fade FROM. */
  apply(phase: EnvPhase, force = false): boolean {
    if (phase === this.current && !force) return false;
    const first = this.current === null;
    const phaseChanged = phase !== this.current;
    this.current = phase;
    // THE ONE COMPOSITION POINT. Weather × phase resolve here and nowhere else.
    const g = weatherGrade(this._weather, phase);
    blendPresetInto(this.target, g.preset, g.preset, 1);
    this.targetRain.perMillion = g.rain.perMillion;
    this.targetRain.opacity = g.rain.opacity;
    this.targetRain.speed = g.rain.speed;
    this.targetRain.length = g.rain.length;
    this.targetWetness = g.wetness;
    this.targetWind = g.wind;
    // A SEALED INTERIOR HAS NO STORM. Not a dimmer one — none: the scheduler is stopped outright, so
    // there is no path by which a strike can be scheduled, emitted or spent while inside the Cave.
    this.lightning.setParams(this._presentation === "interior" ? null : g.lightning, this._weather);
    // STREAK SPEED AND LENGTH ARE NOT FADED. Only how MUCH rain there is fades; how fast a drop falls is
    // a property of the drop, and ramping it up from zero reads as rain in treacle for the first second.
    if (g.rain.perMillion > 0) {
      this.shownRain.speed = g.rain.speed;
      this.shownRain.length = g.rain.length;
    }
    if (first || !this._transitions) this.settle();
    else {
      this.tau = phaseChanged ? TAU.phase : TAU.weather;
      this.travel = this.tau * 4;
      this.step(0); // write the first frame of the move now, so the caller sees a consistent world
    }
    return true;
  }

  /** SNAP. The world is at its target as of this call — no travel, no partial grade. */
  settle(): void {
    this.travel = 0;
    blendPresetInto(this.shown, this.shown, this.target, 1);
    this.shownRain.perMillion = this.targetRain.perMillion;
    this.shownRain.opacity = this.targetRain.opacity;
    this.shownRain.speed = this.targetRain.speed;
    this.shownRain.length = this.targetRain.length;
    this.shownWetness = this.targetWetness;
    this.shownWind = this.targetWind;
    this.commit();
  }

  /** Whether grades travel at all. Off = every apply() lands on the frame it is called, which is what a
   *  test wants and what a screenshot rig wants. */
  get transitions(): boolean {
    return this._transitions;
  }
  set transitions(on: boolean) {
    this._transitions = on;
    if (!on) this.settle();
  }
  /** true while a grade is still travelling */
  get travelling(): boolean {
    return this.travel > 0;
  }
  /** the STORM, for the dev panel and for whoever wants to hang thunder off it */
  get storm(): Lightning {
    return this.lightning;
  }
  /** the visible channel, for the dev readout */
  get lightningBolt(): Bolt {
    return this.bolt;
  }
  /** 0…1 — how lit the sky is by lightning THIS FRAME, after phase and presentation gains */
  get flash(): number {
    return this.shownFlash;
  }
  /** what the foliage is currently being pushed by, 0…1 */
  get wind(): number {
    return this.shownWind;
  }
  /** how wet the ground currently reads, 0…1 */
  get wetness(): number {
    return this.shownWetness;
  }

  /** THE ONLY PER-FRAME ENVIRONMENT CALL. Advances the travelling grade, the storm and the wind clock.
   *
   *  Idle cost, which is the cost almost every frame: one comparison for the transition, one countdown
   *  decrement for the storm, one for the wind. Nothing is written, nothing is allocated and the renderer
   *  is not touched at all unless something actually moved. */
  tick(dtSeconds: number): void {
    const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? Math.min(0.25, dtSeconds) : 0;
    this.elapsed += dt;
    if (this.travel > 0) this.step(dt);
    if (this.current !== null) {
      this.lightning.update(dt);
      const f = this.lightning.flash * LIGHTNING_PHASE_GAIN[this.current] * PRESENTATION_FLASH[this._presentation];
      // written only when it MOVED, so a storm between strikes costs the same as a clear day
      if (Math.abs(f - this.shownFlash) > 0.002 || (f === 0 && this.shownFlash !== 0)) {
        this.shownFlash = f;
        this.writeFlash();
      }
      // the bolt rides the same number, so it can never be out of step with the sky it is lighting
      this.bolt.setFlash(this.shownFlash, this._presentation === "world");
    }
    // the foliage clock only runs while there is wind to spend it on (see exterior.windTick)
    this.scenery?.windTick(this.elapsed);
  }

  /** Advance the travelling grade by dt and write the frame it lands on. */
  private step(dt: number): void {
    // exponential approach, so the move eases out of its own accord rather than needing a curve
    const u = dt > 0 ? 1 - Math.exp(-dt / this.tau) : 0;
    this.travel -= dt;
    if (this.travel <= 0) {
      this.settle();
      return;
    }
    blendPresetInto(this.shown, this.shown, this.target, u);
    this.shownRain.perMillion += (this.targetRain.perMillion - this.shownRain.perMillion) * u;
    this.shownRain.opacity += (this.targetRain.opacity - this.shownRain.opacity) * u;
    this.shownWetness += (this.targetWetness - this.shownWetness) * u;
    this.shownWind += (this.targetWind - this.shownWind) * u;
    this.commit();
  }

  /** Push whatever `shown` currently is at the world. */
  private commit(): void {
    this.rain.setParams(this.shownRain);
    this.scenery?.applyWetness(this.shownWetness);
    this.scenery?.applyWind(this.shownWind);
    this.write(this.shown);
    if (this.shownFlash > 0) this.writeFlash(); // a grade write clobbers the levels a live flash had set
  }

  /** LIGHTNING, SPENT. Levels, one sky colour and one background colour — no light is created, no shadow
   *  map is invalidated (a shadow stores depth, which brightness cannot change: see
   *  Renderer.applyLightLevels) and no material is recompiled. A flash is roughly eight float writes. */
  private writeFlash(): void {
    if (this._presentation === "interior") return; // belt and braces: the scheduler is already stopped
    const R = this.R, p = this.shown, f = this.shownFlash;
    R.lightParams.keyIntensity = p.key.intensity + f * FLASH.key;
    R.lightParams.ambientIntensity = p.hemi.intensity + f * FLASH.ambient;
    R.lightParams.envIntensity = p.envIntensity + f * FLASH.env;
    R.lightParams.exposure = p.exposure + f * FLASH.exposure;
    R.fill.intensity = p.fill.intensity + f * FLASH.fill;
    R.applyLightLevels();
    this.sky.setFlash(f);
    const office = this._presentation === "office";
    R.scene.background = this.bg.setHex(lerpHex(office ? p.stage : p.sky, FLASH.sky, f * FLASH.skyMix));
  }

  private write(p: EnvPreset): void {
    const R = this.R;
    // A SEALED INTERIOR short-circuits the whole weather/phase composition: nothing outdoors is drawn,
    // and the grade that would light it is not applied. One early return, so no later line can leak a sky.
    if (this._presentation === "interior") {
      this.rain.visible = false;
      if (this.scenery) this.scenery.root.visible = false;
      this.sky.root.visible = false;
      this.sky.setFlash(0);
      R.scene.background = this.bg.setHex(INTERIOR.background);
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
      R.aoStrength = INTERIOR.ao;
      this.lastAz = INTERIOR.key.azimuth;
      this.lastEl = INTERIOR.key.elevation;
      R.placeLight();
      return;
    }
    const office = this._presentation === "office";
    this.rain.visible = !office || this._rainInOffice;
    // OFFICE: nothing exterior is drawn, and the backdrop is a flat stage tone rather than a sky.
    if (this.scenery) this.scenery.root.visible = !office;
    this.sky.root.visible = !office;
    // ONE Color AND ONE Fog, WRITTEN IN PLACE. Both used to be freshly allocated on every write, which
    // was the right trade when a write happened twice a day; a travelling grade writes every frame.
    R.scene.background = this.bg.setHex(office ? p.stage : p.sky);
    // Fog offsets are measured from the orbit distance, so the office at the camera target always sits in
    // front of the haze and only the far landscape resolves into the sky.
    // Haze resolves to the sky's HORIZON band, not its zenith: that is the colour the far landscape is
    // dissolving into, and matching it is what stops the terrain disc reading as a floating plate when
    // EXPLORE drops the pitch far enough to see the horizon. In OFFICE there is no landscape to haze.
    if (!office && this._fog && p.fog) {
      this.fogNode.color.setHex(p.skyGrade.horizon);
      this.fogNode.near = R.camDist + p.fog.near;
      this.fogNode.far = R.camDist + p.fog.far;
      R.scene.fog = this.fogNode;
    } else R.scene.fog = null;
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
    // THE SHADOW MAP IS ONLY REDRAWN WHEN THE SUN MOVED. Weather never moves it — the overcast targets
    // carry no azimuth or elevation precisely so that a Clear→Rain fade costs zero shadow redraws, for
    // all that it re-grades every frame. A day→sunset travel does move it, and pays per frame for the
    // ~5s it lasts, twice in an office day. Everything else takes the levels-only path.
    if (p.key.azimuth !== this.lastAz || p.key.elevation !== this.lastEl) {
      this.lastAz = p.key.azimuth;
      this.lastEl = p.key.elevation;
      R.placeLight();
    } else R.applyLightLevels();
    // AO rides the travelling grade like every other global, so Day -> Sunset -> Night eases its contact
    // occlusion across too rather than snapping it on the frame the phase flips. One uniform write.
    R.aoStrength = p.ao;
    this.sky.apply(p.skyGrade);
    this.scenery?.applyTint(p.exteriorTint);
    this.scenery?.applyPracticals(p.practicals);
  }
}
