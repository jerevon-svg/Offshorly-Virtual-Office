// SETTINGS -> ENVIRONMENT. The employee's own time-of-day and weather choice for the 3D office.
//
// WHY THIS EXISTS. The day/sunset/night and weather presentations have always worked; the only way to
// reach them was the 3D inspection rig, which also carries frame-time graphs, nav diagnostics,
// shadow-cache switches and the seat editor. None of that is an employee's settings. This is the same
// two choices, as a permanent Settings section — not a second implementation of them.
//
// IT OWNS NO STATE. The single source of truth is services/settings/environmentPreferences: this panel
// renders that store and writes to it, dev/vo3d/app/world.ts subscribes to it and re-grades the world.
// Neither one talks to the other, so there is nothing to keep in sync and no order to get right.
// Consequences, all deliberate:
//   • the choice SURVIVES a reload and every view change, because it lives in the store, not in a world
//     that is rebuilt whenever the canvas is;
//   • it is remembered per signed-in employee, so the next person on this browser gets their own;
//   • nothing is remounted, rebuilt or reset when it changes: a re-grade is lights, sky, fog and tint,
//     and the avatar, the camera, the roster, attendance and every other preference are untouched;
//   • the two axes are independent — AUTO time with fixed weather, or the reverse, are ordinary states.
//
// THE INSPECTION RIG IS STILL THERE and its two dropdowns still work. They are a DEVELOPER override for
// the running session and are deliberately NOT written back here, so poking at the rig can never
// silently rewrite what an employee saved (see world.ts's note at the same seam).
import { useSyncExternalStore } from "react";
import type { EnvTimeMode } from "../env/timeOfDay";
import type { WeatherMode } from "../env/weather";
import {
  getEnvironmentPreferences,
  setEnvironmentPreference,
  subscribeEnvironmentPreferences,
  type EnvironmentTimePreference,
  type EnvironmentWeatherPreference,
} from "../../../services/settings/environmentPreferences";
import settings from "../../../components/OfficeMap/HudSettings.module.css";
import styles from "./Vo3dEnvironmentPanel.module.css";

// THE TWO VOCABULARIES ARE THE SAME OBJECT, CHECKED BY THE COMPILER. The store restates them so a
// service does not import from the 3D app; these two lines fail the build the moment either side grows
// a value the other does not have, which is the whole point of restating them rather than duplicating
// them by hand and hoping.
const _timeIsEnvTimeMode: EnvironmentTimePreference extends EnvTimeMode
  ? EnvTimeMode extends EnvironmentTimePreference ? true : never : never = true;
const _weatherIsWeatherMode: EnvironmentWeatherPreference extends WeatherMode
  ? WeatherMode extends EnvironmentWeatherPreference ? true : never : never = true;
void _timeIsEnvTimeMode;
void _weatherIsWeatherMode;

/** env/timeOfDay's vocabulary, given the words and the glyph a settings row wants. AUTO first, because
 *  it is the real office and the one every other value is a deviation from. */
const TIME_OPTIONS: { value: EnvironmentTimePreference; label: string; glyph: string }[] = [
  { value: "auto", label: "Auto", glyph: "🕒" },
  { value: "day", label: "Day", glyph: "☀️" },
  { value: "sunset", label: "Sunset", glyph: "🌇" },
  { value: "night", label: "Night", glyph: "🌙" },
];

/** env/weather's five states, plus AUTO. Exactly WEATHER_MODES, in that order. No mode is invented here
 *  — every one of these is a presentation the environment already knows how to render. */
const WEATHER_OPTIONS: { value: EnvironmentWeatherPreference; label: string; glyph: string }[] = [
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

/** The store, as a React source — useSyncExternalStore for the same reason HudGraphicsSettings uses it:
 *  the store is a plain module that the 3D world also reads. */
function useEnvironmentPreferences() {
  return useSyncExternalStore(
    subscribeEnvironmentPreferences,
    getEnvironmentPreferences,
    getEnvironmentPreferences,
  );
}

export function Vo3dEnvironmentPanel() {
  const { time, weather } = useEnvironmentPreferences();

  return (
    <section className={settings.section} aria-label="Environment" data-testid="vo3d-environment-settings">
      <h3 className={settings.sectionTitle}>Time of day</h3>
      <TileRow
        label="Time of day"
        options={TIME_OPTIONS}
        value={time}
        onChange={(value) => setEnvironmentPreference("time", value)}
      />
      <p className={settings.cardStatus}>
        Auto follows the real office clock. The others hold the light where you put it, and stay there
        next time you sign in.
      </p>

      <h3 className={settings.sectionTitle}>Weather</h3>
      <TileRow
        label="Weather"
        options={WEATHER_OPTIONS}
        value={weather}
        onChange={(value) => setEnvironmentPreference("weather", value)}
      />
      <p className={settings.cardStatus}>
        Auto follows the office's real conditions. Weather is its own choice — every time of day can be
        shown in any of these.
      </p>
    </section>
  );
}

export default Vo3dEnvironmentPanel;
