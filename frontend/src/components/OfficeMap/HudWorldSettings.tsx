import { useEffect, useSyncExternalStore } from "react";
import HudIcon from "../HudIcon";
import {
  armAutoplay as armMusicAutoplay,
  getVolume as getMusicVolume,
  isMuted as isMusicMuted,
  setMuted as setMusicMuted,
  setVolume as setMusicVolume,
  subscribe as subscribeMusic,
} from "../../audio/backgroundMusic";
import {
  SENSITIVITY_RANGE,
  getExperiencePreferences,
  setExperiencePreference,
  subscribeExperience,
  type DefaultViewPreference,
} from "../../services/settings/experiencePreferences";
import styles from "./HudSettings.module.css";

// THE 3D WORLD'S OWN SETTINGS — the General / Controls / Interface / Audio rows that only mean anything
// where there is a 3D world to apply them to.
//
// They are rendered ONLY by a caller that passes `worldExperience` (dev/vo3d's HUD), because the readers
// live in that world: PlayerCamera, Vo3dOverheads and app/world.ts. In V1's 2D office none of them are
// listening, and the panel's oldest rule is that a row nothing reads does not ship. That is the same
// mechanism the Appearance section has always used — an absent prop removes the section rather than
// leaving a dead control on screen.
//
// Each one writes straight to services/settings/experiencePreferences, which persists it and notifies
// the non-React readers. No component here holds the value.

/** The store, as a React source — the same seam HudGraphicsSettings uses, for the same reason: the
 *  renderer reads this store from outside React entirely. */
function useExperience() {
  return useSyncExternalStore(subscribeExperience, getExperiencePreferences, getExperiencePreferences);
}

const VIEW_OPTIONS: readonly { value: DefaultViewPreference; label: string; hint: string }[] = [
  { value: "office", label: "Office", hint: "Top-down view of the whole floor" },
  { value: "explore", label: "3D", hint: "Free camera — explore the office and outside" },
  { value: "player", label: "Player", hint: "Walk your avatar directly" },
];

/** GENERAL — which camera the office opens in. Applied once, on the first frame the world is ready. */
export function HudDefaultViewSetting() {
  const { defaultView } = useExperience();
  return (
    <section className={styles.section} aria-label="Starting view">
      <h3 className={styles.sectionTitle}>Starting view</h3>
      <div className={styles.card}>
        <div className={styles.cardRow}>
          <span className={styles.cardIcon} aria-hidden="true">
            <HudIcon name="locate" size="24px" />
          </span>
          <div className={styles.cardText}>
            <span className={styles.rowLabel}>Open the office in</span>
            <span className={styles.rowHint}>Applies the next time you come in — you can switch any time</span>
          </div>
        </div>
        <div className={styles.choiceList} role="radiogroup" aria-label="Starting view">
          {VIEW_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={styles.choice}
              data-selected={defaultView === option.value ? "true" : undefined}
            >
              <input
                type="radio"
                name="vo-default-view"
                value={option.value}
                checked={defaultView === option.value}
                onChange={() => setExperiencePreference("defaultView", option.value)}
              />
              <span className={styles.choiceMark} aria-hidden="true" />
              <span className={styles.cardText}>
                <span className={styles.rowLabel}>{option.label}</span>
                <span className={styles.rowHint}>{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

/** What the keys and the mouse actually do. Not a setting — a reference — and it is here because the
 *  bindings are fixed: PlayerInput hard-codes them, so offering a rebinder would be offering a control
 *  that cannot do anything. Stating them honestly is the useful thing a Controls page can do. */
const CAMERA_BINDINGS: readonly { keys: string; action: string }[] = [
  { keys: "C", action: "Next camera — Office → 3D → Player → Office" },
  { keys: "V", action: "First / third person (Player view only)" },
];

const BINDINGS: readonly { keys: string; action: string }[] = [
  { keys: "W A S D", action: "Walk" },
  { keys: "Shift", action: "Sprint (held)" },
  { keys: "Space", action: "Jump" },
  { keys: "E", action: "Interact — sit, stand, use a door" },
  { keys: "Esc", action: "Release the mouse and use the HUD" },
  { keys: "Click the world", action: "Take the mouse back and play on" },
];

const OFFICE_BINDINGS: readonly { keys: string; action: string }[] = [
  { keys: "Left-drag", action: "Pan across the floor" },
  { keys: "Right-click", action: "Walk your avatar there" },
  { keys: "Scroll", action: "Zoom in and out" },
];

/** CONTROLS — mouse look, and the binding reference. */
export function HudControlsSettings() {
  const { lookSensitivity, invertLook } = useExperience();
  return (
    <>
      <section className={styles.section} aria-label="Mouse look">
        <h3 className={styles.sectionTitle}>Mouse look</h3>
        <div className={styles.card}>
          <div className={styles.cardRow}>
            <div className={styles.cardText}>
              <span className={styles.rowLabel}>Look sensitivity</span>
              <span className={styles.rowHint}>How far the view turns for the same mouse movement</span>
            </div>
            <span className={styles.rowValue} data-testid="look-sensitivity-value">
              {lookSensitivity.toFixed(2)}×
            </span>
          </div>
          <input
            type="range"
            className={styles.slider}
            min={SENSITIVITY_RANGE.min}
            max={SENSITIVITY_RANGE.max}
            step={0.05}
            value={lookSensitivity}
            aria-label="Look sensitivity"
            onChange={(event) => setExperiencePreference("lookSensitivity", Number(event.target.value))}
          />
          <div className={styles.cardRow}>
            <div className={styles.cardText}>
              <span className={styles.rowLabel}>Invert vertical look</span>
              <span className={styles.rowHint}>Push the mouse forward to look up</span>
            </div>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={invertLook}
                onChange={(event) => setExperiencePreference("invertLook", event.target.checked)}
                aria-label="Invert vertical look"
              />
              <span className={styles.switchTrack} aria-hidden="true">
                <span className={styles.switchKnob} />
              </span>
            </label>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-label="Keys and mouse">
        <h3 className={styles.sectionTitle}>Keys and mouse</h3>
        <div className={styles.card}>
          <p className={styles.cardStatus}>Cameras — anywhere in the office</p>
          <dl className={styles.bindings}>
            {CAMERA_BINDINGS.map((b) => (
              <div className={styles.binding} key={b.keys}>
                <dt className={styles.bindingKey}>{b.keys}</dt>
                <dd className={styles.bindingAction}>{b.action}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.cardStatus}>
            Neither fires while you are typing a message, filling in a field or working inside a panel.
          </p>
        </div>
        <div className={styles.card}>
          <p className={styles.cardStatus}>Walking your avatar (Player view)</p>
          <dl className={styles.bindings}>
            {BINDINGS.map((b) => (
              <div className={styles.binding} key={b.keys}>
                <dt className={styles.bindingKey}>{b.keys}</dt>
                <dd className={styles.bindingAction}>{b.action}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className={styles.card}>
          <p className={styles.cardStatus}>Looking at the office (Office and 3D views)</p>
          <dl className={styles.bindings}>
            {OFFICE_BINDINGS.map((b) => (
              <div className={styles.binding} key={b.keys}>
                <dt className={styles.bindingKey}>{b.keys}</dt>
                <dd className={styles.bindingAction}>{b.action}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}

/** INTERFACE — what is drawn OVER the world. Visibility only: the nameplates, bubbles and unread
 *  badges themselves are untouched, this only says whether they are shown. */
export function HudInterfaceSettings() {
  const { nameplates, worldChatIndicators } = useExperience();
  return (
    <section className={styles.section} aria-label="In-world display">
      <h3 className={styles.sectionTitle}>In-world display</h3>
      <div className={styles.card}>
        <div className={styles.cardRow}>
          <span className={styles.cardIcon} aria-hidden="true">
            <HudIcon name="people" size="24px" />
          </span>
          <div className={styles.cardText}>
            <span className={styles.rowLabel}>Nameplates</span>
            <span className={styles.rowHint}>Name and availability above each coworker</span>
          </div>
          <label className={styles.switch}>
            <input
              type="checkbox"
              checked={nameplates}
              onChange={(event) => setExperiencePreference("nameplates", event.target.checked)}
              aria-label="Show nameplates above coworkers"
            />
            <span className={styles.switchTrack} aria-hidden="true">
              <span className={styles.switchKnob} />
            </span>
          </label>
        </div>
        <div className={styles.cardRow}>
          <span className={styles.cardIcon} aria-hidden="true">
            <HudIcon name="chat" size="24px" />
          </span>
          <div className={styles.cardText}>
            <span className={styles.rowLabel}>Chat above the world</span>
            <span className={styles.rowHint}>Speech bubbles, typing dots and unread badges on people</span>
          </div>
          <label className={styles.switch}>
            <input
              type="checkbox"
              checked={worldChatIndicators}
              onChange={(event) => setExperiencePreference("worldChatIndicators", event.target.checked)}
              aria-label="Show chat above the world"
            />
            <span className={styles.switchTrack} aria-hidden="true">
              <span className={styles.switchKnob} />
            </span>
          </label>
        </div>
        <p className={styles.cardStatus}>
          Turning chat off here hides the overhead indicators only. Messages still arrive, and the Chat
          tile still counts them.
        </p>
      </div>
    </section>
  );
}

// ---- AUDIO ---------------------------------------------------------------------------------------
// TWO SOUNDS, ONE CONTROL SHAPE. Music and the office's ambient bed are separate systems on purpose —
// one is an <audio> element in audio/backgroundMusic, the other is a WebAudio graph in
// dev/vo3d/audio/EnvironmentalAudio — and neither is reimplemented here. What was wrong was the
// PRESENTATION: music was the floating BackgroundMusicControl pill (a mute icon and a stub slider)
// dropped into a card beside a full-width switch-and-percentage row, so the two read as different kinds
// of thing and the music slider looked decorative next to it. They are the same kind of thing, so they
// now wear the same card: a switch, a full-width slider and the value as a percentage.
//
// THE SLIDER IS DISABLED WHILE THE SOUND IS OFF, in both cards. That is not decoration either: dragging
// the music slider used to silently un-mute (setVolume's own "make it audible" rule), which with an
// explicit on/off switch beside it would read as the switch flipping itself. Off means off; the volume
// you left is still there when you turn it back on.

interface SoundRowProps {
  title: string;
  hint: string;
  on: boolean;
  volume: number;
  onToggle: (on: boolean) => void;
  onVolume: (v: number) => void;
  toggleLabel: string;
  volumeLabel: string;
  testId: string;
}

function SoundRow({ title, hint, on, volume, onToggle, onVolume, toggleLabel, volumeLabel, testId }: SoundRowProps) {
  return (
    <div className={styles.card}>
      <div className={styles.cardRow}>
        <div className={styles.cardText}>
          <span className={styles.rowLabel}>{title}</span>
          <span className={styles.rowHint}>{hint}</span>
        </div>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={on}
            onChange={(event) => onToggle(event.target.checked)}
            aria-label={toggleLabel}
          />
          <span className={styles.switchTrack} aria-hidden="true">
            <span className={styles.switchKnob} />
          </span>
        </label>
      </div>
      <div className={styles.cardRow}>
        <div className={styles.cardText}>
          <span className={styles.rowHint}>Volume</span>
        </div>
        <span className={styles.rowValue} data-testid={`${testId}-volume`}>
          {Math.round(volume * 100)}%
        </span>
      </div>
      <input
        type="range"
        className={styles.slider}
        min={0}
        max={1}
        step={0.01}
        value={volume}
        disabled={!on}
        aria-label={volumeLabel}
        onChange={(event) => onVolume(Number(event.target.value))}
      />
    </div>
  );
}

/** The music store, as a React source. The SINGLETON is the one in audio/backgroundMusic — the same one
 *  App.tsx keeps mounted so autoplay stays armed. Nothing here creates an audio element. */
function useMusic() {
  const muted = useSyncExternalStore(subscribeMusic, isMusicMuted, isMusicMuted);
  const volume = useSyncExternalStore(subscribeMusic, getMusicVolume, getMusicVolume);
  return { muted, volume };
}

/** AUDIO — music and, where there is a world to hear it in, the office's ambient bed. */
export function HudAudioSettings({ world }: { world: boolean }) {
  const music = useMusic();
  const { ambientAudio, ambientVolume } = useExperience();

  // Arm autoplay from here too. The pill used to be the only thing that did it inside this panel, and
  // armAutoplay's own `armed` guard makes a second call a no-op — so removing the pill must not remove
  // the arming with it.
  useEffect(() => {
    armMusicAutoplay();
  }, []);

  return (
    <section className={styles.section} aria-label="Audio">
      <h3 className={styles.sectionTitle}>Music</h3>
      <SoundRow
        title="Office music"
        hint="The background track that plays while you work"
        on={!music.muted}
        volume={music.volume}
        onToggle={(on) => setMusicMuted(!on)}
        onVolume={(v) => setMusicVolume(v)}
        toggleLabel="Office music"
        volumeLabel="Music volume"
        testId="music"
      />
      {world && (
        <>
          <h3 className={styles.sectionTitle}>Office sound</h3>
          <SoundRow
            title="Ambience"
            hint="Room tone, weather and the world around the office"
            on={ambientAudio}
            volume={ambientVolume}
            onToggle={(on) => setExperiencePreference("ambientAudio", on)}
            onVolume={(v) => setExperiencePreference("ambientVolume", v)}
            toggleLabel="Office ambience"
            volumeLabel="Ambience volume"
            testId="ambience"
          />
        </>
      )}
    </section>
  );
}
