// vo3d app — THE MOUSE, WHEN AN INTERACTION MENU OPENS OVER THE WORLD.
//
// A pointer-locked player cannot click any DOM, so a menu opened from PLAYER (a coworker's menu from E, the
// exit card at the doors, the kiosk, the lift's floor panel) was a dead end until they pressed Esc. One gate
// now does for every such menu what the Toucan panel, the call ring and the dock's tools already do for
// themselves (Vo3dOverlay / Vo3dHud), and also gives the mouse BACK:
//
//   opens   the world's PLAYER input stands down (no look, no click into the world, no E / Space / V —
//           player/PlayerInput menuOpen) and, if the pointer was locked, it is released.
//   closes  the input comes back; if WE released the pointer, it is asked for again — quietly, once, and
//           only while the closing press still counts as a user gesture. A refusal (no gesture, the
//           browser's post-Esc cooldown, another panel now open) changes nothing: the next deliberate click
//           on the canvas locks, as it always has. Never retried, never on a timer.
//
// A menu opened with the pointer already free (OFFICE, or PLAYER after Esc) is left free when it closes.
import { useEffect, useRef } from "react";
import { isPointerLocked } from "./keyGuard";

export interface MenuPointerDeps {
  isLocked(): boolean;
  unlock(): void;
  /** the world's quiet re-lock (PlayerMode.resumePointerLock) */
  relock(): void;
  /** PLAYER's input stands down while true */
  setHeld(open: boolean): void;
  /** may we ask for the pointer back right now? (a live gesture, nothing else wanting the mouse) */
  mayRelock(): boolean;
}

export class MenuPointerGate {
  private open = false;
  private released = false;
  private readonly d: MenuPointerDeps;
  constructor(deps: MenuPointerDeps) { this.d = deps; }

  get isOpen(): boolean { return this.open; }
  /** did opening the current menu take the pointer off a locked player? */
  get releasedPointer(): boolean { return this.released; }

  set(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    if (open) {
      this.d.setHeld(true);
      this.released = this.d.isLocked();
      if (this.released) this.d.unlock();
      return;
    }
    this.d.setHeld(false);
    const give = this.released;
    this.released = false;
    if (give && !this.d.isLocked() && this.d.mayRelock()) this.d.relock();
  }
}

/** the closing press still counts as a user gesture (navigator.userActivation, where the browser has it) —
 *  a request outside one is refused anyway, and an Esc press never counts */
export function hasLiveGesture(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return !ua || ua.isActive;
}

/** IS ANOTHER PANEL NOW WANTING THE MOUSE? An open `role="dialog"` — V2's convention for "this owns the
 *  keyboard" (app/keyGuard). A closed panel that stays mounted is `inert` + `aria-hidden` (Vo3dRoomDetails),
 *  so it does not count. */
export function panelOpen(): boolean {
  return document.querySelector("[role='dialog']:not([inert]):not([aria-hidden='true'])") !== null;
}

interface MenuPointerWorld {
  setInteractionMenuOpen?(open: boolean): void;
  resumePointerLock?(): void;
}

/** ONE GATE for the overlay's interaction menus: pass true while any of them is open. */
export function useMenuPointer(open: boolean, worldRef: { current: MenuPointerWorld | null }): void {
  const gate = useRef<MenuPointerGate | null>(null);
  if (!gate.current) {
    gate.current = new MenuPointerGate({
      isLocked: isPointerLocked,
      unlock: () => document.exitPointerLock?.(),
      // ONE FRAME LATER, so a panel the menu's own action opened (Chat, a profile) is mounted by then and
      // keeps the mouse; the gesture is time-boxed by the browser, not by the task, so it is still live.
      relock: () => requestAnimationFrame(() => { if (!isPointerLocked() && !panelOpen()) worldRef.current?.resumePointerLock?.(); }),
      setHeld: (on) => worldRef.current?.setInteractionMenuOpen?.(on),
      mayRelock: hasLiveGesture,
    });
  }
  useEffect(() => { gate.current!.set(open); }, [open]);
  // unmounting with a menu up must not leave PLAYER's input standing down
  useEffect(() => () => { gate.current?.set(false); }, []);
}
