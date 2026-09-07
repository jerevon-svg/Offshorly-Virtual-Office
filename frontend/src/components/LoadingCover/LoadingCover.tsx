import { useEffect, useState } from "react";
import floorArt from "../../assets/office/floor.png";
import receptionArt from "../../assets/office/rooms/reception-room.png";
import {
  deriveStartupProgress,
  STARTUP_STAGES,
  useStartupSignals,
} from "../../startup/startupReadiness";
import "./LoadingCover.css";

// Full-viewport boot cover. Sits above the mounting office and fades out the
// moment every critical startup signal (startup/startupReadiness.ts) is
// ready — never on a timer, never waiting for lazy features. The artwork is
// the existing floor + reception-room PNGs office-layout already imports, so
// this adds no assets and shares the browser cache with the office itself.

// Safety cap, NOT a delay: it only ever shortens the wait. If a critical
// signal can never resolve (viewer missing from /floor so self never places,
// a stuck request, …) the office is still shown rather than a permanent
// cover. Counted from when the auth gate opened, since before that nothing
// downstream has even started. Well above the movement-snapshot bound
// OfficeMap already applies (1.5s) so a normal boot never hits it.
export const LOADING_COVER_MAX_WAIT_MS = 12_000;

// Matches the CSS opacity transition; the node unmounts after this.
const FADE_OUT_MS = 650;

const TIP_ROTATE_MS = 4_000;

export const LOADING_COVER_TIPS: readonly string[] = [
  "Walk up to a teammate and use Approach to start a quick conversation.",
  "Check in at the reception desk to take your seat for the day.",
  "Whiteboards open 1:1 or per room — sketch together in real time.",
  "Ask Toucan for a catch-up on what you missed while you were away.",
  "Daily and weekly missions earn XP, coins and badges.",
  "Set Do Not Disturb on your room when you need focus time.",
];

export function LoadingCover() {
  const signals = useStartupSignals();
  const progress = deriveStartupProgress(signals);
  const [capExpired, setCapExpired] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [artLoaded, setArtLoaded] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);

  // Safety cap — see LOADING_COVER_MAX_WAIT_MS.
  useEffect(() => {
    if (!signals.auth || progress.ready) return;
    const timer = window.setTimeout(() => setCapExpired(true), LOADING_COVER_MAX_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [signals.auth, progress.ready]);

  const done = progress.ready || capExpired;

  // Fade out, then unmount so the cover stops intercepting pointer events
  // and costs nothing once the office is up.
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDismissed(true), FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [done]);

  useEffect(() => {
    if (done) return;
    const timer = window.setInterval(
      () => setTipIndex((i) => (i + 1) % LOADING_COVER_TIPS.length),
      TIP_ROTATE_MS,
    );
    return () => window.clearInterval(timer);
  }, [done]);

  if (dismissed) return null;

  const percent = Math.round((done ? 1 : progress.fraction) * 100);
  const status = done ? "Welcome to the office." : progress.status;
  const activeIndex = done ? STARTUP_STAGES.length : progress.activeIndex;

  return (
    <div
      className="loading-cover"
      data-testid="loading-cover"
      data-state={done ? "done" : "loading"}
      role="status"
      aria-live="polite"
      aria-busy={!done}
    >
      <img className="loading-cover__art" src={floorArt} alt="" aria-hidden="true" />
      <img
        className={`loading-cover__art${artLoaded ? " loading-cover__art--loaded" : ""}`}
        src={receptionArt}
        alt=""
        aria-hidden="true"
        onLoad={() => setArtLoaded(true)}
      />
      <div className="loading-cover__overlay" />

      <div className="loading-cover__corner loading-cover__corner--tl">
        Same team
        <br />
        Different places
        <br />
        One office
      </div>
      <div className="loading-cover__corner loading-cover__corner--tr">People · Spaces · Progress · Together</div>

      <div className="loading-cover__content">
        <div className="loading-cover__brand">offshorly</div>
        <div className="loading-cover__welcome">Welcome to</div>
        <h1 className="loading-cover__title">VIRTUAL OFFICE</h1>
        <div className="loading-cover__tagline">People · Spaces · Progress · Together</div>

        <div className="loading-cover__bar-row">
          <div
            className="loading-cover__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="loading-cover__bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="loading-cover__percent">{percent}%</span>
        </div>
        <div className="loading-cover__status" data-testid="loading-cover-status">
          {status}
        </div>

        <ol className="loading-cover__steps" aria-hidden="true">
          {STARTUP_STAGES.map((stage, index) => {
            const isDone = done || signals[stage.signal];
            const isActive = !done && index === activeIndex;
            return (
              <li
                key={stage.signal}
                className={`loading-cover__step${isDone ? " loading-cover__step--done" : ""}${
                  isActive ? " loading-cover__step--active" : ""
                }`}
              >
                {stage.label}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="loading-cover__tip" data-testid="loading-cover-tip">
        <strong>Tip</strong>
        {LOADING_COVER_TIPS[tipIndex]}
      </div>
    </div>
  );
}
