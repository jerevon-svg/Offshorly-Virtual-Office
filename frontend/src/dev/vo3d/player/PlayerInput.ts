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
  /** PHASE 7D — a pointer-lock request was made from a real gesture and the browser refused it. The
   *  owner shows a recovery hint; mouse-look keeps working unlocked in the meantime. */
  onLockDenied?: () => void;
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
  /** PHASE 7D — UNLOCKED MOUSE-LOOK. Entering PLAYER used to need a click on the world before the
   *  camera would move at all, which made switching views feel like the mode had not started. Now the
   *  view switch asks for the lock from its own gesture, and when the browser says no (an iframe, a
   *  denied permission, a re-request too soon after Esc) the look still works — read from ordinary
   *  pointer movement rather than from lock deltas.
   *
   *  It is deliberately NOT always on: while locked, `movementX/Y` is the only correct source (it keeps
   *  turning past the edge of the screen, which is what 360° look means), and mixing the two would
   *  double every delta. This is the fallback path and nothing else. */
  private unlockedLook = false;
  private lastClient: { x: number; y: number } | null = null;
  /** Set while a request we made is in flight, so `lockchange` can tell "granted" from "the user
   *  pressed Esc" and we never re-ask on our own. */
  private requesting = false;

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
    this.unlockedLook = false;
    this.lastClient = null;
    this.unlock();
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** PHASE 7D — TAKE THE POINTER, FROM A REAL GESTURE.
   *
   *  Called synchronously out of the C-key handler and out of the chat's Enter, because a pointer-lock
   *  request is only granted inside a user gesture: deferring it by even a tick is how "entering Player
   *  View does nothing until you click" happened in the first place.
   *
   *  Called at most once per gesture and never on a timer — the browser rate-limits repeated requests
   *  and a loop of them is worse than none. If it is refused, unlocked look turns on immediately so the
   *  mode is still usable, and the owner is told so it can show a recovery hint. */
  requestLock(): void {
    if (!this.attached || this.locked || this.requesting) return;
    this.requesting = true;
    let settled = false;
    const granted = () => {
      if (settled) return;
      settled = true;
      this.requesting = false;
      this.unlockedLook = false;
      this.lastClient = null;
    };
    const denied = () => {
      if (settled) return;
      settled = true;
      this.requesting = false;
      // USABLE ANYWAY. The camera moves with the mouse; only the 360° wrap is lost.
      this.unlockedLook = true;
      this.lastClient = null;
      this.h.onLockDenied?.();
    };
    document.addEventListener("pointerlockchange", granted, { once: true });
    document.addEventListener("pointerlockerror", denied, { once: true });
    try {
      const attempt = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (attempt && typeof attempt.then === "function") attempt.then(granted).catch(denied);
    } catch {
      denied();
    }
    // A request that is simply ignored (no event either way) must not leave the mode dead: fall back
    // shortly after, which is still well inside "immediately" for a person switching views.
    window.setTimeout(() => { if (!this.locked) denied(); }, 250);
  }

  /** Unlocked look is a fallback, not a mode the user chose — anything that genuinely takes the mouse
   *  back (a click that locks, leaving PLAYER) turns it off. */
  stopUnlockedLook(): void {
    this.unlockedLook = false;
    this.lastClient = null;
  }

  get usingUnlockedLook(): boolean { return this.unlockedLook; }

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
    // A WORLD CLICK REMAINS THE RECAPTURE ROUTE, for the case the browser refused the switch's own
    // request. It is a fallback now rather than the only way in.
    if (!this.locked) { this.requestLock(); return; }
    this.h.onInteract(); // a click while locked is the same verb as E
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    if (this.locked) {
      this.dx += e.movementX;
      this.dy += e.movementY;
      return;
    }
    // THE FALLBACK. Only after a refused request, only over the world, and never while the pointer is
    // over a piece of UI — dragging across the HUD must not spin the camera.
    if (!this.unlockedLook || isUiTarget(e)) { this.lastClient = null; return; }
    const prev = this.lastClient;
    this.lastClient = { x: e.clientX, y: e.clientY };
    if (!prev) return;
    this.dx += e.clientX - prev.x;
    this.dy += e.clientY - prev.y;
  };
  private readonly onLockChange = (): void => {
    // Esc (or any release) ends the fallback too: the person asked for the mouse back, and a camera
    // that kept following it would be exactly the "it stole my pointer" complaint.
    if (!this.locked) { this.dx = this.dy = 0; this.held.clear(); this.unlockedLook = false; this.lastClient = null; }
    this.h.onLockChange(this.locked);
  };
}
