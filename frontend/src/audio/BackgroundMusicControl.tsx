import { useEffect, useSyncExternalStore } from "react";
import styles from "./BackgroundMusicControl.module.css";
import { armAutoplay, getVolume, isMuted, setMuted, setVolume, subscribe } from "./backgroundMusic";

export function BackgroundMusicControl({ hidden = false }: { hidden?: boolean }) {
  useEffect(() => {
    armAutoplay();
    // No cleanup: the audio singleton must outlive this component's own
    // StrictMode mount->cleanup->mount cycle. armAutoplay()'s internal
    // `armed` guard already makes a second call a no-op, and once playback
    // has started successfully the gesture listeners remove themselves —
    // there is nothing here to detach.
  }, []);

  const muted = useSyncExternalStore(subscribe, isMuted);
  const volume = useSyncExternalStore(subscribe, getVolume);

  if (hidden) {
    // Render nothing while a room sidebar covers this corner of the screen.
    // The audio singleton lives outside this component (backgroundMusic.ts),
    // so hiding the pill never pauses playback or touches volume/mute state —
    // it simply stops subscribing to the store until it renders again.
    return null;
  }

  return (
    <div className={styles.pill}>
      <button
        type="button"
        className={styles.muteButton}
        onClick={() => setMuted(!muted)}
        aria-label={muted ? "Unmute background music" : "Mute background music"}
        title={muted ? "Unmute background music" : "Mute background music"}
      >
        {muted ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 9v6h4l5 5V4L7 9H3z" fill="currentColor" />
            <path
              d="M16 9l5 5m0-5l-5 5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 9v6h4l5 5V4L7 9H3z" fill="currentColor" />
            <path
              d="M16.5 8.5a5 5 0 010 7M19 6a9 9 0 010 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        )}
      </button>
      <input
        type="range"
        className={styles.slider}
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        aria-label="Background music volume"
      />
    </div>
  );
}
