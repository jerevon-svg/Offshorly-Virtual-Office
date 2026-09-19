// vo3d app — PART 4: THE VIEW SWITCHER.
//
// Three deliberately DIFFERENT experiences, offered as three buttons and never merged:
//
//   Office   the default. A fixed top-down read of the whole floor, V1's own framing, with V1's mouse
//            contract underneath it (left-drag pans, right-click moves, wheel zooms).
//   3D       free-camera exploration — orbit, pan and zoom over the office, the exterior and everywhere
//            else that is built. IT MOVES THE CAMERA AND NOTHING ELSE: the avatar stays exactly where it
//            was standing, and attendance, presence and position are untouched, because this mode only
//            reconfigures the orbit rig (render/CameraModes).
//   Player   direct control of the avatar, with its own first/third-person cameras and pointer lock.
//
// ALWAYS REACHABLE. This is NOT inside HudDock: the dock steps aside whenever a tool owns the screen and
// is hidden outright in Player, and a view switcher that disappeared with it would strand somebody in a
// mode they could not leave. It is the one control that outlives the dock.
import { useEffect, useState } from "react";
import type { Vo3dWorld } from "./world";
import type { Vo3dViewMode } from "./viewMode";
import styles from "./Vo3dViewSwitcher.module.css";

const MODES: { id: Vo3dViewMode; label: string; hint: string }[] = [
  { id: "office", label: "Office", hint: "Top-down view of the whole office" },
  { id: "explore", label: "3D", hint: "Free camera — explore the office and outside" },
  { id: "player", label: "Player", hint: "Walk your avatar directly" },
];

export interface Vo3dViewSwitcherProps {
  worldRef: { current: Vo3dWorld | null };
  ready: boolean;
  /** Told to the rest of the overlay so the HUD can present itself appropriately per view (Part 5). */
  onViewModeChange?: (mode: Vo3dViewMode) => void;
}

export function Vo3dViewSwitcher({ worldRef, ready, onViewModeChange }: Vo3dViewSwitcherProps) {
  const [mode, setMode] = useState<Vo3dViewMode>("office");
  const [playerView, setPlayerView] = useState<"first" | "third">("third");
  const [pointerLocked, setPointerLocked] = useState(false);

  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world) return;
    const offMode = world.subscribeViewMode((m) => {
      setMode(m);
      onViewModeChange?.(m);
    });
    const offView = world.subscribePlayerView(setPlayerView);
    return () => {
      offMode();
      offView();
    };
  }, [onViewModeChange, ready, worldRef]);

  // POINTER STATE, read from the browser rather than guessed: it is what decides whether these buttons
  // can be clicked at all, so the hint below has to say which of the two states the player is in.
  useEffect(() => {
    const onChange = () => setPointerLocked(document.pointerLockElement !== null);
    document.addEventListener("pointerlockchange", onChange);
    onChange();
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  return (
    <div className={styles.wrap} data-testid="vo3d-view-switcher">
      <div className={styles.group} role="group" aria-label="View">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={m.id === mode ? `${styles.tab} ${styles.active}` : styles.tab}
            aria-pressed={m.id === mode}
            title={m.hint}
            data-testid={`view-${m.id}`}
            onClick={() => worldRef.current?.setViewMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === "player" && (
        <div className={styles.group} role="group" aria-label="Player camera">
          {(["third", "first"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={v === playerView ? `${styles.tab} ${styles.active}` : styles.tab}
              aria-pressed={v === playerView}
              title={v === "third" ? "Third person (V)" : "First person (V)"}
              data-testid={`player-view-${v}`}
              onClick={() => worldRef.current?.setPlayerView(v)}
            >
              {v === "third" ? "3rd" : "1st"}
            </button>
          ))}
        </div>
      )}
      {mode === "player" && (
        // THE POINTER CONTRACT, stated rather than left to be discovered. Esc is deliberately left to the
        // browser by player/PlayerInput — it is the one guaranteed way out of a locked pointer — so the
        // honest instruction is "Esc to use the HUD, click the world to play on".
        <span className={styles.hint} data-testid="vo3d-player-hint">
          {pointerLocked ? "Esc to use the HUD" : "Click the world to play"}
        </span>
      )}
    </div>
  );
}

export default Vo3dViewSwitcher;
