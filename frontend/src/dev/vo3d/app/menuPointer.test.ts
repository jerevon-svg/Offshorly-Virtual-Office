// THE MOUSE WHEN AN INTERACTION MENU OPENS IN PLAYER (app/menuPointer + player/PlayerInput menuOpen): the
// pointer is released at once, PLAYER's look / clicks / verbs stand down while the menu is up, and closing
// gives the pointer back — quietly, once, only when it was ours to give.
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only); vitest runs it in node
import { readFileSync } from "node:fs";
import { MenuPointerGate, hasLiveGesture, panelOpen, type MenuPointerDeps } from "./menuPointer";
import { PlayerInput } from "../player/PlayerInput";

function gateRig(locked: boolean, mayRelock = true) {
  const state = { locked, held: false, calls: [] as string[] };
  const deps: MenuPointerDeps = {
    isLocked: () => state.locked,
    unlock: () => { state.locked = false; state.calls.push("unlock"); },
    relock: () => { state.calls.push("relock"); },
    setHeld: (on) => { state.held = on; state.calls.push(on ? "hold" : "free"); },
    mayRelock: () => mayRelock,
  };
  return { gate: new MenuPointerGate(deps), state };
}

describe("MenuPointerGate", () => {
  it("a menu opened while LOCKED releases the pointer and holds PLAYER; closing frees and re-asks", () => {
    const { gate, state } = gateRig(true);
    gate.set(true);
    expect(state.calls).toEqual(["hold", "unlock"]);
    expect(state.held).toBe(true);
    expect(gate.releasedPointer).toBe(true);
    gate.set(false);
    expect(state.calls).toEqual(["hold", "unlock", "free", "relock"]);
    expect(state.held).toBe(false);
  });

  it("a menu opened with the pointer FREE never locks it on close (OFFICE, or PLAYER after Esc)", () => {
    const { gate, state } = gateRig(false);
    gate.set(true);
    gate.set(false);
    expect(state.calls).toEqual(["hold", "free"]);
  });

  it("no live gesture (closed by Esc): nothing is requested — the next click on the canvas locks", () => {
    const { gate, state } = gateRig(true, false);
    gate.set(true);
    gate.set(false);
    expect(state.calls).toEqual(["hold", "unlock", "free"]);
  });

  it("already locked again by the closing click: not asked twice", () => {
    const { gate, state } = gateRig(true);
    gate.set(true);
    state.locked = true; // the canvas click re-took it first
    gate.set(false);
    expect(state.calls).toEqual(["hold", "unlock", "free"]);
  });

  it("is idempotent: re-renders with the same answer do nothing", () => {
    const { gate, state } = gateRig(true);
    gate.set(true); gate.set(true); gate.set(false); gate.set(false);
    expect(state.calls).toEqual(["hold", "unlock", "free", "relock"]);
  });
});

describe("relock conditions", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("an open dialog keeps the mouse; a closed, inert one does not count", () => {
    expect(panelOpen()).toBe(false);
    document.body.innerHTML = `<div role="dialog" inert aria-hidden="true"></div>`;
    expect(panelOpen()).toBe(false);
    document.body.innerHTML += `<div role="dialog" aria-label="Chat"></div>`;
    expect(panelOpen()).toBe(true);
  });

  it("follows navigator.userActivation where the browser has it", () => {
    const nav = navigator as Navigator & { userActivation?: { isActive: boolean } };
    const had = Object.getOwnPropertyDescriptor(nav, "userActivation");
    Object.defineProperty(nav, "userActivation", { configurable: true, value: { isActive: false } });
    expect(hasLiveGesture()).toBe(false);
    Object.defineProperty(nav, "userActivation", { configurable: true, value: { isActive: true } });
    expect(hasLiveGesture()).toBe(true);
    if (had) Object.defineProperty(nav, "userActivation", had);
    else delete (nav as { userActivation?: unknown }).userActivation;
  });
});

describe("PlayerInput while a menu is open", () => {
  function rig() {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const log: string[] = [];
    const input = new PlayerInput(canvas, {
      onInteract: () => log.push("interact"),
      onToggleView: () => log.push("view"),
      onJump: () => log.push("jump"),
      onLockChange: () => {},
      onLockDenied: () => log.push("denied"),
    });
    input.enable();
    const key = (code: string) => window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));
    return { input, canvas, log, key, done: () => { input.disable(); canvas.remove(); } };
  }

  it("E, Space and V never reach the world; movement still does", () => {
    const r = rig();
    r.input.menuOpen = true;
    r.key("KeyE"); r.key("Space"); r.key("KeyV");
    r.key("KeyW");
    expect(r.log).toEqual([]);
    expect(r.input.axis.z).not.toBe(0);
    r.input.menuOpen = false;
    r.key("KeyE");
    expect(r.log).toEqual(["interact"]);
    r.done();
  });

  it("the mouse is not a look and a press on the canvas is not a click into the world", () => {
    const r = rig();
    r.input.menuOpen = true;
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 200, clientY: 90 }));
    expect(r.input.takeLook()).toEqual({ dx: 0, dy: 0 });
    const spy = vi.fn();
    (r.canvas as unknown as { requestPointerLock: () => void }).requestPointerLock = spy;
    r.canvas.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    expect(spy).not.toHaveBeenCalled();
    r.input.menuOpen = false;
    r.canvas.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1); // the next deliberate click restores, as always
    r.done();
  });

  it("a QUIET request that is refused changes nothing — no unlocked look, no recovery hint", () => {
    const r = rig(); // jsdom has no pointer lock: every request is refused
    r.input.requestLock({ fallback: false });
    expect(r.input.usingUnlockedLook).toBe(false);
    expect(r.log).toEqual([]);
    r.input.requestLock();
    expect(r.input.usingUnlockedLook).toBe(true); // the view switch's own fallback is untouched
    expect(r.log).toEqual(["denied"]);
    r.done();
  });
});

describe("wiring", () => {
  const strip = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  it("every interaction menu goes through the one gate", () => {
    expect(strip("src/dev/vo3d/app/Vo3dOverlay.tsx")).toContain("useMenuPointer(menuVisible || exitOpen || kioskOpen || floorPicker !== null, worldRef);");
  });
  it("the world stands PLAYER down and leaves a menu's Escape to the menu", () => {
    const w = strip("src/dev/vo3d/app/world.ts");
    expect(w).toContain("setInteractionMenuOpen: (open) => { interactionMenuOpen = open; playerMode.setMenuOpen(open); },");
    expect(w).toContain('if (e.key !== "Escape" || e.defaultPrevented || interactionMenuOpen ||');
    expect(strip("src/dev/vo3d/player/PlayerMode.ts")).toContain("resumePointerLock(): void { if (this.active) this.input.requestLock({ fallback: false }); }");
  });
});
