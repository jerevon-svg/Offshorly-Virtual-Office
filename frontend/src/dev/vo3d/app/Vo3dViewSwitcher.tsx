// vo3d app — PART 4 / PHASE 7C: SWITCHING VIEW, WITH NO CHROME AT ALL.
//
// Three deliberately DIFFERENT experiences, and they have not changed:
//
//   Office   the default. A fixed top-down read of the whole floor, V1's own framing, with V1's mouse
//            contract underneath it (left-drag pans, right-click moves, wheel zooms).
//   3D       free-camera exploration — orbit, pan and zoom over the office, the exterior and everywhere
//            else that is built. IT MOVES THE CAMERA AND NOTHING ELSE: the avatar stays exactly where it
//            was standing, and attendance, presence and position are untouched, because this mode only
//            reconfigures the orbit rig (render/CameraModes).
//   Player   direct control of the avatar, with its own first/third-person cameras and pointer lock.
//
// WHAT THIS COMPONENT IS NOW: the C key, and nothing else. It renders null. The three-tab strip became a
// camera button, the camera button was removed, and the 3rd/1st pair and the pointer hint went with it —
// so the office's corners hold no permanent widget of any kind and the world is the whole screen.
//
// NOTHING FUNCTIONAL LEFT WITH THE PIXELS. Every way to change a view still exists:
//   C           cycles Office -> 3D -> Player -> Office, bound here.
//   V           first/third person inside PLAYER, bound where it has always been bound —
//               player/PlayerInput, which owns the keyboard while PLAYER is active. A second listener
//               here would toggle twice per press, which is why there has never been one.
//   Settings    -> General picks the view (switches immediately AND sets the starting preference), and
//               -> Controls is where both keys are written down for somebody who has not met them.
// All of them go through the one `world.setViewMode` / `world.setPlayerView` entry point the dev GUI's
// dropdown uses, so no two of them can ever disagree.
//
// THE POINTER CONTRACT, as of PHASE 7D. Entering PLAYER asks for the lock from the C keypress itself,
// because that is the only moment a browser will grant one — waiting for a click on the world made the
// mode feel like it had not started. Esc still gives the pointer back (PlayerInput leaves Esc to the
// browser, the one guaranteed way out), a world click is still the recapture route, and the dock still
// follows the lock (app/Vo3dHud). A refused request is not a dead end: unlocked mouse-look takes over
// immediately and a contextual hint says how to get the real thing back. The permanent centre-screen
// "click to look" pill is gone with it — the view indicator below says what this mode is, once.
//
// IT STILL SUBSCRIBES, because C has to know what "next" means. Keeping the subscription here rather
// than lifting the key into the HUD keeps the view state in one place.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Vo3dWorld } from "./world";
import type { Vo3dViewMode } from "./viewMode";
import { isTypingTarget } from "./keyGuard";

/** The cycle, in the order C walks. */
export const VIEW_CYCLE: readonly Vo3dViewMode[] = ["office", "explore", "player"];

/** The one next-view rule, exported so the C binding and its tests agree by construction.
 *
 *  `available` is the floor's own list (app/floors.ts, published as `world.availableViewModes()`). The
 *  order is always this file's — C means the same thing everywhere in the building — but a floor that
 *  does not offer a view is simply not stopped on, so upstairs C alternates Office and Player instead of
 *  pausing on a 3D mode that would be refused the instant it was asked for. Defaults to all three, so
 *  every existing caller and test is byte-for-byte unaffected. */
export function nextViewMode(mode: Vo3dViewMode, available: readonly Vo3dViewMode[] = VIEW_CYCLE): Vo3dViewMode {
  const cycle = VIEW_CYCLE.filter((m) => available.includes(m));
  if (cycle.length === 0) return "office";
  const i = cycle.indexOf(mode);
  // a mode the floor does not offer (the one you arrived carrying) still has to advance somewhere: the
  // first offered view is the honest answer, and it is where the arrival rule already put you
  return i === -1 ? cycle[0] : cycle[(i + 1) % cycle.length];
}

export interface Vo3dViewSwitcherProps {
  worldRef: { current: Vo3dWorld | null };
  ready: boolean;
  /** Told to the rest of the overlay so the HUD can present itself appropriately per view (Part 5). */
  onViewModeChange?: (mode: Vo3dViewMode) => void;
}

export function Vo3dViewSwitcher({ worldRef, ready, onViewModeChange }: Vo3dViewSwitcherProps) {
  const [mode, setMode] = useState<Vo3dViewMode>("office");

  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world) return;
    return world.subscribeViewMode((m) => {
      setMode(m);
      onViewModeChange?.(m);
    });
  }, [onViewModeChange, ready, worldRef]);

  // The mode the KEY acts on is read from a ref, not from the effect's closure: the world pushes view
  // changes outside React's batching, so a handler re-bound on every `mode` render can still be running
  // against the previous value for a frame.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const cycle = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    // optional-called: a host that hands this a partial world (a test double, an older embed) gets the
    // three-view cycle it always had rather than a crash on a method it does not implement
    const next = nextViewMode(modeRef.current, world.availableViewModes?.());
    world.setViewMode(next);
    // PHASE 7D — ASK FOR THE POINTER FROM THIS KEYPRESS, SYNCHRONOUSLY.
    //
    // A pointer-lock request is only granted inside a user gesture, and this handler IS one. Deferring
    // it — to an effect, a subscription callback, or the next tick — is precisely why entering PLAYER
    // used to do nothing until you clicked the world. Asked once per press and never retried on a
    // timer: the browser rate-limits repeats, and unlocked mouse-look carries the mode if it refuses.
    if (next === "player") world.requestPointerLock();
  }, [worldRef]);

  // C. Modifier presses are left alone (Cmd/Ctrl+C is a copy, and taking it would be the kind of
  // shortcut that makes a product feel broken), and app/keyGuard keeps it out of anything a person is
  // typing into or any modal that has taken the screen.
  useEffect(() => {
    if (!ready) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyC") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (isTypingTarget(event)) return;
      event.preventDefault();
      cycle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycle, ready]);

  return null;
}

export default Vo3dViewSwitcher;
