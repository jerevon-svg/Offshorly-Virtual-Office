// vo3d player — KEYBOARD / MOUSE / POINTER LOCK, owned only while PLAYER mode is active.
//
// TWO RULES, and they are the whole file:
//
//  1. LISTENERS ARE ATTACHED ON ENABLE AND REMOVED ON DISABLE. Not "attached once and ignored when
//     inactive" — actually removed. A dev rig has a lil-gui panel, number fields and a browser around it;
//     a WASD handler that merely returns early is still a handler that swallowed the key, and "W" in a
//     text field is not movement.
//  2. EVEN WHILE ENABLED, TYPING WINS. If the event originated in a form control, a contenteditable, or
//     anywhere inside the GUI panel, the key is not ours. That is checked on the event target rather than
//     on document.activeElement alone, because lil-gui's sliders are focusable divs.
//
// POINTER LOCK is requested on a click in the canvas and released by Esc (the browser does that itself)
// or by leaving the mode. Mouse-look is read ONLY while locked, so an unlocked player can still click the
// GUI without the view spinning. `lockchange` lets the owner re-render its prompt.
import { isTypingTarget } from "../app/keyGuard";

const MOVE_KEYS: Record<string, { x: number; z: number }> = {
  KeyW: { x: 0, z: -1 }, ArrowUp: { x: 0, z: -1 },
  KeyS: { x: 0, z: 1 }, ArrowDown: { x: 0, z: 1 },
  KeyA: { x: -1, z: 0 }, ArrowLeft: { x: -1, z: 0 },
  KeyD: { x: 1, z: 0 }, ArrowRight: { x: 1, z: 0 },
};

/** Shift = sprint. Held, never toggled: releasing it returns to walking on the very next frame. */
const SPRINT_KEYS = new Set(["ShiftLeft", "ShiftRight"]);

export type PlayerInputHandlers = {
  onInteract: () => void;
  onToggleView: () => void;
  onLockChange: (locked: boolean) => void;
};

/** true when the event belongs to something the user is typing in, driving with the mouse, or to a
 *  modal that has taken the screen. PHASE 7C moved the rule itself into app/keyGuard so the camera
 *  shortcut and this file cannot disagree about what counts as typing; the behaviour is unchanged. */
const isUiTarget = isTypingTarget;

export class PlayerInput {
  /** accumulated mouse delta since the last read, in pixels */
  private dx = 0;
  private dy = 0;
  private readonly held = new Set<string>();
  private readonly canvas: HTMLCanvasElement;
  private readonly h: PlayerInputHandlers;
  private attached = false;

  constructor(canvas: HTMLCanvasElement, handlers: PlayerInputHandlers) {
    this.canvas = canvas;
    this.h = handlers;
  }

  get enabled(): boolean { return this.attached; }
  get locked(): boolean { return document.pointerLockElement === this.canvas; }
  /** true while a Shift key is down. A modifier, not a mode — there is no sprint state to get stuck in. */
  get sprinting(): boolean {
    for (const code of this.held) if (SPRINT_KEYS.has(code)) return true;
    return false;
  }
  /** unit-ish movement intent in CAMERA-LOCAL axes (x right, z forward-negative), before camera rotation */
  get axis(): { x: number; z: number } {
    let x = 0, z = 0;
    for (const code of this.held) { const v = MOVE_KEYS[code]; if (v) { x += v.x; z += v.z; } }
    const len = Math.hypot(x, z);
    return len > 1 ? { x: x / len, z: z / len } : { x, z };
  }
  /** Consume the mouse delta accumulated since the previous call. */
  takeLook(): { dx: number; dy: number } {
    const d = { dx: this.dx, dy: this.dy };
    this.dx = 0; this.dy = 0;
    return d;
  }

  enable(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("pointerlockchange", this.onLockChange);
  }

  disable(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    this.held.clear();
    this.dx = this.dy = 0;
    this.unlock();
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isUiTarget(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (MOVE_KEYS[e.code]) { this.held.add(e.code); e.preventDefault(); return; }
    // Shift rides in the same held set as the movement keys, so the blur handler's "clear everything"
    // covers it too: tabbing away mid-sprint cannot leave the player running when they come back.
    if (SPRINT_KEYS.has(e.code)) { this.held.add(e.code); return; }
    if (e.code === "KeyE") { this.h.onInteract(); e.preventDefault(); return; }
    if (e.code === "KeyV") { this.h.onToggleView(); e.preventDefault(); }
    // Esc is deliberately NOT handled: the browser's own pointer-lock escape is the one users expect,
    // and intercepting it would take the only guaranteed way out of a locked pointer.
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => { this.held.delete(e.code); };
  /** a tab-out must not leave a key stuck down: the browser never sends its keyup */
  private readonly onBlur = (): void => { this.held.clear(); };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0 || isUiTarget(e)) return;
    if (!this.locked) { void this.canvas.requestPointerLock(); return; } // first click grabs the pointer
    this.h.onInteract(); // a click while locked is the same verb as E
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.dx += e.movementX;
    this.dy += e.movementY;
  };
  private readonly onLockChange = (): void => {
    if (!this.locked) { this.dx = this.dy = 0; this.held.clear(); }
    this.h.onLockChange(this.locked);
  };
}
