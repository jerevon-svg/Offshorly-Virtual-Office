// TEMPORARY — PRESENTATION ENVIRONMENT SWITCHER (demo only, DEV builds only).
//
// WHY THIS EXISTS. The day/sunset/night and weather choices have always worked; the only way to reach
// them was the 3D inspection rig, which also carries frame-time graphs, nav diagnostics, shadow-cache
// switches and the seat editor. None of that belongs on a screen somebody is presenting from. So this is
// a second DOOR onto the two dropdowns that already exist — not a second implementation of them.
//
// IT OWNS NO STATE. Every click calls world.presentationEnv, whose setters ARE the dev GUI's own
// onChange bodies (see app/world.ts): the same `timeOfDay.mode` / `weather.mode`, the same
// `applyEnvPhase(true)` re-grade, the same lil-gui `refresh()`. Consequences of that, all deliberate:
//   • the two surfaces can never disagree — changing a tile here moves the GUI dropdown, and vice versa;
//   • nothing is remounted, rebuilt or reset: a re-grade is lights, sky, fog and tint, and the avatar,
//     the camera, the roster, attendance and every preference are untouched;
//   • nothing is persisted. Closing the demo or reloading the page returns to AUTO, which is the real
//     Manila clock and the configured weather provider. That is the point of a presentation override.
//
// TO REMOVE AFTER THE DEMO: delete this file and its .module.css, drop the `environment` prop from the
// HudSettings call in Vo3dHud.tsx, drop `environment` from HudSettingsProps (three short edits, all
// marked TEMPORARY), and drop `presentationEnv` from app/world.ts and its interface. The dev GUI, the
// environment system and the weather system are not touched by any of that.
import { useCallback, useState } from "react";
import type { RefObject } from "react";
import type { Vo3dWorld } from "./world";
import type { EnvTimeMode } from "../env/timeOfDay";
import type { WeatherMode } from "../env/weather";
import settings from "../../../components/OfficeMap/HudSettings.module.css";
import styles from "./Vo3dEnvironmentPanel.module.css";

/** V1's own env/timeOfDay vocabulary, given the words and the glyph a presentation wants. AUTO first,
 *  because it is the real office and the one every other value is a deviation from. */
const TIME_OPTIONS: { value: EnvTimeMode; label: string; glyph: string }[] = [
  { value: "auto", label: "Auto", glyph: "🕒" },
  { value: "day", label: "Day", glyph: "☀️" },
  { value: "sunset", label: "Sunset", glyph: "🌇" },
  { value: "night", label: "Night", glyph: "🌙" },
];

/** env/weather's five states, plus AUTO. Exactly WEATHER_MODES, in that order. */
const WEATHER_OPTIONS: { value: WeatherMode; label: string; glyph: string }[] = [
  { value: "auto", label: "Auto", glyph: "🌡️" },
  { value: "clear", label: "Clear", glyph: "☀️" },
  { value: "cloudy", label: "Cloudy", glyph: "☁️" },
  { value: "rain", label: "Rain", glyph: "🌧️" },
  { value: "heavy_rain", label: "Heavy rain", glyph: "⛈️" },
  { value: "thunderstorm", label: "Storm", glyph: "🌩️" },
];

interface TileRowProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string; glyph: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** A compact segmented row. A real radiogroup, so the whole row is one tab stop and the arrow keys walk
 *  it — the same keyboard contract the Settings category list already has. */
function TileRow<T extends string>({ label, options, value, onChange }: TileRowProps<T>) {
  return (
    <div className={styles.tiles} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          className={styles.tile}
          data-value={option.value}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
              : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
            if (step === 0) return;
            event.preventDefault();
            const index = options.findIndex((o) => o.value === value);
            onChange(options[(index + step + options.length) % options.length].value);
          }}
        >
          <span className={styles.glyph} aria-hidden="true">{option.glyph}</span>
          <span className={styles.label}>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export interface Vo3dEnvironmentPanelProps {
  worldRef: RefObject<Vo3dWorld | null>;
}

export function Vo3dEnvironmentPanel({ worldRef }: Vo3dEnvironmentPanelProps) {
  const env = worldRef.current?.presentationEnv ?? null;
  // Mirrors of the world's own answer, read once on open and re-read from the world after every write —
  // so this never becomes a second source of truth, only a rendering of the first one.
  const [time, setTimeState] = useState<EnvTimeMode>(() => env?.time() ?? "auto");
  const [weather, setWeatherState] = useState<WeatherMode>(() => env?.weather() ?? "auto");

  const pickTime = useCallback((mode: EnvTimeMode) => {
    const current = worldRef.current?.presentationEnv;
    current?.setTime(mode);
    setTimeState(current?.time() ?? mode);
  }, [worldRef]);

  const pickWeather = useCallback((mode: WeatherMode) => {
    const current = worldRef.current?.presentationEnv;
    current?.setWeather(mode);
    setWeatherState(current?.weather() ?? mode);
  }, [worldRef]);

  return (
    <section className={settings.section} aria-label="Environment" data-testid="vo3d-environment-settings">
      <h3 className={settings.sectionTitle}>Time of day</h3>
      <TileRow label="Time of day" options={TIME_OPTIONS} value={time} onChange={pickTime} />
      <p className={settings.cardStatus}>
        Auto follows the real office clock. The others hold the light where you put it.
      </p>

      <h3 className={settings.sectionTitle}>Weather</h3>
      <TileRow label="Weather" options={WEATHER_OPTIONS} value={weather} onChange={pickWeather} />
      <p className={settings.cardStatus}>
        Weather is its own choice — every time of day can be shown in any of these.
      </p>
    </section>
  );
}

export default Vo3dEnvironmentPanel;
