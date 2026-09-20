// vo3d app — PHASE 7D: WHICH VIEW AM I IN.
//
// C cycles three genuinely different experiences and, until now, said nothing about it: the picture
// changed and you worked out from the mouse what had happened. This says it once, briefly, and gets out
// of the way — the smallest thing that answers "what just happened and how do I drive it".
//
// IT IS A NOTIFICATION, NOT A CONTROL. `pointer-events: none`, no buttons, no dismiss: it must never
// intercept a drag meant for the orbit rig or a click meant for the floor underneath it.
//
// AND IT DOES NOT SHOUT ON STARTUP. The world pushes the current view to every new subscriber the
// moment it subscribes, so an indicator that reacted to "a value arrived" would greet every session
// with a card nobody asked for. It reacts to a CHANGE, which means ignoring that first push.
import { useEffect, useRef, useState } from "react";
import type { Vo3dWorld } from "./world";
import type { Vo3dViewMode } from "./viewMode";
import styles from "./Vo3dViewIndicator.module.css";

/** WHAT EACH VIEW IS, AND HOW IT IS DRIVEN. The words are the product's, kept here rather than derived
 *  so the three read as deliberate copy rather than as generated strings. */
const VIEWS: Record<Vo3dViewMode, { title: string; hint: string }> = {
  office: { title: "OFFICE VIEW", hint: "Right-click to walk · Drag to pan · Scroll to zoom" },
  explore: { title: "3D VIEW", hint: "Drag to orbit · Scroll to zoom · Explore freely" },
  player: { title: "PLAYER VIEW", hint: "Mouse to look · WASD to move · V to switch camera" },
};

/** Long enough to read two short lines, short enough that it is gone before it is furniture. */
const SHOW_MS = 2600;
const FADE_MS = 320;

export interface Vo3dViewIndicatorProps {
  worldRef: { current: Vo3dWorld | null };
  ready: boolean;
}

export function Vo3dViewIndicator({ worldRef, ready }: Vo3dViewIndicatorProps) {
  const [shown, setShown] = useState<Vo3dViewMode | null>(null);
  const [leaving, setLeaving] = useState(false);
  /** True once the browser has refused a pointer-lock request for the CURRENT player session. */
  const [lockDenied, setLockDenied] = useState(false);
  const seededRef = useRef(false);
  const modeRef = useRef<Vo3dViewMode>("office");
  const timers = useRef<{ fade?: number; clear?: number }>({});

  const show = (mode: Vo3dViewMode) => {
    setShown(mode);
    setLeaving(false);
    window.clearTimeout(timers.current.fade);
    window.clearTimeout(timers.current.clear);
    timers.current.fade = window.setTimeout(() => setLeaving(true), SHOW_MS);
    timers.current.clear = window.setTimeout(() => setShown(null), SHOW_MS + FADE_MS);
  };

  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world) return;
    return world.subscribeViewMode((mode) => {
      const previous = modeRef.current;
      modeRef.current = mode;
      // THE FIRST PUSH IS THE CURRENT STATE, not a change — see the header.
      if (!seededRef.current) {
        seededRef.current = true;
        return;
      }
      if (mode === previous) return;
      if (mode !== "player") setLockDenied(false);
      show(mode);
    });
  }, [ready, worldRef]);

  // THE RECOVERY HINT, and only when it is earned. `unlockedLook` is true exactly when a request was
  // refused and the fallback is carrying the mode — so this appears in place of the old permanent pill,
  // for the one case that pill was ever right about.
  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world?.subscribeLockState) return;
    return world.subscribeLockState((locked, unlockedLook) => {
      if (locked) {
        setLockDenied(false);
        return;
      }
      if (!unlockedLook) return;
      setLockDenied(true);
      if (modeRef.current === "player") show("player");
    });
  }, [ready, worldRef]);

  useEffect(
    () => () => {
      window.clearTimeout(timers.current.fade);
      window.clearTimeout(timers.current.clear);
    },
    [],
  );

  if (!shown) return null;
  const view = VIEWS[shown];

  return (
    <div
      className={leaving ? `${styles.card} ${styles.leaving}` : styles.card}
      data-testid="vo3d-view-indicator"
      data-view={shown}
      role="status"
      aria-live="polite"
    >
      <span className={styles.title}>{view.title}</span>
      <span className={styles.hint}>{view.hint}</span>
      {shown === "player" && lockDenied && (
        <span className={styles.denied} data-testid="vo3d-view-lock-hint">
          Click the world to capture your mouse
        </span>
      )}
    </div>
  );
}

export default Vo3dViewIndicator;
