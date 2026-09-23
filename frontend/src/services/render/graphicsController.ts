// GRAPHICS & DISPLAY — the controller that joins the preference, the adaptive rung and the renderer.
//
// It talks to the renderer through a NARROW PORT (GraphicsEngine) rather than to the V2 Renderer class
// directly. Three reasons, in order of importance:
//   • It can then be driven by a fake in a test, which is the only way the mode/adaptation behaviour is
//     assertable at all without a GL context.
//   • The port is an explicit, readable list of EVERY switch graphics settings are allowed to touch.
//     Anything not on it — light values, the grade, nav, world state, the camera — cannot be reached
//     from here even by accident. That is the "never alters gameplay/nav/world state" guarantee made
//     structural instead of promised.
//   • The V2 renderer stays free of any knowledge of settings, storage or React.
//
// It is also the only place that decides WHEN the adaptive controller runs: in Smooth, and nowhere
// else. Full and Custom never construct a ladder rung, which is what makes "Full Graphics does not
// secretly adapt" a property of the code rather than a claim about it.

import { AdaptiveQuality, type AdaptiveChange } from "./adaptiveQuality";
import {
  FULL_GRAPHICS,
  MAX_QUALITY_LEVEL,
  resolveGraphics,
  sameGraphics,
  type AvatarDetail,
  type EffectsDetail,
  type GraphicsMode,
  type GraphicsSettings,
  type QualityLevel,
} from "./graphicsQuality";
import { getGraphicsPreference, subscribeGraphics } from "./graphicsPreferences";

/** EVERY switch graphics settings may touch. Nothing else is reachable from this module. */
export interface GraphicsEngine {
  /** Multiply the device-pixel-ratio cap and re-size the beauty/AO buffers to match. */
  setRenderScale(scale: number): void;
  /** SSAO on/off. */
  setAmbientOcclusion(on: boolean): void;
  /** Resolution the AO is computed at, as a fraction of the drawing buffer. */
  setAoResolutionScale(scale: number): void;
  /** Shadow casting on/off. */
  setShadows(on: boolean): void;
  /** Shadow map edge in texels. */
  setShadowMapSize(size: number): void;
  /** The rain particle field on/off (the weather GRADE is untouched either way). */
  setWeatherEffects(on: boolean): void;
  /** Density budget for environment effects. */
  setEffectsDetail(detail: EffectsDetail): void;
  /** Foliage sway animation on/off. */
  setFoliageSway(on: boolean): void;
  /** Character mesh LOD band. */
  setAvatarDetail(detail: AvatarDetail): void;
}

export interface GraphicsControllerOptions {
  engine: GraphicsEngine;
  /** Defaults to the real persisted preference; a test passes its own reader. */
  readPreference?: () => { mode: GraphicsMode; custom: Record<string, unknown> };
  /** Defaults to the real store's subscribe; a test passes a no-op. */
  subscribe?: (listener: () => void) => () => void;
  /** Wall clock for the first frame; only anchors the adaptive warm-up. */
  startedAtMs?: number;
}

/** What a dev overlay / the settings panel can read back without reaching into the controller. */
export interface GraphicsStatus {
  mode: GraphicsMode;
  /** The adaptive rung. Pinned to the top in Full and Custom — neither of them adapts. */
  level: QualityLevel;
  settings: GraphicsSettings;
  medianFrameMs: number | null;
  lastAdaptation: AdaptiveChange | null;
}

export class GraphicsController {
  private readonly engine: GraphicsEngine;
  private readonly readPreference: () => { mode: GraphicsMode; custom: Record<string, unknown> };
  private readonly unsubscribe: () => void;
  private adaptive: AdaptiveQuality;
  private mode: GraphicsMode;
  private custom: Record<string, unknown>;
  /** what the engine was last told — the diff base, so nothing is re-applied on a frame */
  private applied: GraphicsSettings | null = null;
  private startedAtMs: number;
  /** MEASUREMENT OVERRIDE — see pinMode(). null = the user's preference is in force. */
  private pinned: GraphicsMode | null = null;
  /** the preference's own mode, remembered while a pin is in force */
  private preferredMode: GraphicsMode;

  constructor(options: GraphicsControllerOptions) {
    this.engine = options.engine;
    this.readPreference =
      options.readPreference ?? (() => getGraphicsPreference() as { mode: GraphicsMode; custom: Record<string, unknown> });
    this.startedAtMs = options.startedAtMs ?? 0;
    const pref = this.readPreference();
    this.mode = pref.mode;
    this.preferredMode = pref.mode;
    this.custom = pref.custom;
    this.adaptive = new AdaptiveQuality({ startedAtMs: this.startedAtMs, onChange: () => this.applyNow() });
    const subscribe = options.subscribe ?? subscribeGraphics;
    this.unsubscribe = subscribe(() => this.onPreferenceChanged());
    this.applyNow();
  }

  /** The rung Smooth is on. Full and Custom report the top rung because neither of them moves. */
  get level(): QualityLevel {
    return this.mode === "smooth" ? this.adaptive.level : MAX_QUALITY_LEVEL;
  }

  get settings(): GraphicsSettings {
    return resolveGraphics(this.mode, this.level, this.custom);
  }

  status(): GraphicsStatus {
    return {
      mode: this.mode,
      level: this.level,
      settings: this.settings,
      medianFrameMs: this.mode === "smooth" ? this.adaptive.medianFrameMs : null,
      lastAdaptation: this.mode === "smooth" ? this.adaptive.lastAdaptation : null,
    };
  }

  /**
   * Drive one rendered frame. `frameMs` is the frame's own duration, `nowMs` the wall clock.
   *
   * In Full and Custom this is a single comparison and a return: no window is kept, no median is
   * computed and the ladder is not consulted. FULL GRAPHICS DOES NOT ADAPT, and the shortest proof of
   * that is that it does not even measure.
   */
  frame(frameMs: number, nowMs: number): void {
    if (this.mode !== "smooth") return;
    this.adaptive.sample(frameMs, nowMs);
  }

  /** Throw away the measurement window without changing quality — see AdaptiveQuality.resetWindow. */
  resetMeasurement(nowMs: number): void {
    this.adaptive.resetWindow(nowMs);
  }

  dispose(): void {
    this.unsubscribe();
  }

  /**
   * Force a mode WITHOUT writing the user's preference, or release the force with null.
   *
   * This exists for ONE caller: the dev performance harness (devtools/Stress), which has to capture at
   * Full Graphics whatever the machine it runs on happens to prefer — a benchmark taken at an adapted
   * rung measures the adaptation, not the product. It deliberately does not persist, so the harness
   * cannot leave a developer's account pinned to Full after a capture.
   */
  pinMode(mode: GraphicsMode | null): void {
    if (mode === this.pinned) return;
    this.pinned = mode;
    const next = mode ?? this.preferredMode;
    if (next !== this.mode) {
      this.mode = next;
      this.adaptive = new AdaptiveQuality({ startedAtMs: this.startedAtMs, onChange: () => this.applyNow() });
    }
    this.applyNow();
  }

  private onPreferenceChanged(): void {
    const pref = this.readPreference();
    this.preferredMode = pref.mode;
    const effective = this.pinned ?? pref.mode;
    const modeChanged = effective !== this.mode;
    this.mode = effective;
    this.custom = pref.custom;
    if (modeChanged) {
      // Entering Smooth starts from the approved look and earns its way down from there, on evidence
      // measured AFTER the switch. Carrying a rung over from a previous Smooth session would be
      // carrying over a judgement about a frame cost that no longer applies.
      this.adaptive = new AdaptiveQuality({ startedAtMs: this.startedAtMs, onChange: () => this.applyNow() });
    }
    this.applyNow();
  }

  /** Resolve and push to the engine, touching only the switches whose value actually changed. */
  private applyNow(): void {
    const next = resolveGraphics(this.mode, this.level, this.custom);
    const prev = this.applied;
    if (prev && sameGraphics(prev, next)) return;
    if (!prev || prev.renderScale !== next.renderScale) this.engine.setRenderScale(next.renderScale);
    if (!prev || prev.ambientOcclusion !== next.ambientOcclusion) this.engine.setAmbientOcclusion(next.ambientOcclusion);
    if (!prev || prev.aoResolutionScale !== next.aoResolutionScale) this.engine.setAoResolutionScale(next.aoResolutionScale);
    if (!prev || prev.shadows !== next.shadows) this.engine.setShadows(next.shadows);
    if (!prev || prev.shadowMapSize !== next.shadowMapSize) this.engine.setShadowMapSize(next.shadowMapSize);
    if (!prev || prev.weatherEffects !== next.weatherEffects) this.engine.setWeatherEffects(next.weatherEffects);
    if (!prev || prev.effectsDetail !== next.effectsDetail) this.engine.setEffectsDetail(next.effectsDetail);
    if (!prev || prev.foliageSway !== next.foliageSway) this.engine.setFoliageSway(next.foliageSway);
    if (!prev || prev.avatarDetail !== next.avatarDetail) this.engine.setAvatarDetail(next.avatarDetail);
    this.applied = next;
  }
}

/** Convenience for the report/overlay: whether the engine is currently at the approved benchmark. */
export function isFullGraphics(settings: GraphicsSettings): boolean {
  return sameGraphics(settings, FULL_GRAPHICS);
}
