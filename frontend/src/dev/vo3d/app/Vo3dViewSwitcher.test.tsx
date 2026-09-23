import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dViewSwitcher, nextViewMode } from "./Vo3dViewSwitcher";
import type { Vo3dViewMode } from "./viewMode";
import type { Vo3dWorld } from "./world";

// PHASE 7D — C takes the pointer from its own keypress.
//
// A pointer-lock request is only granted inside a user gesture. Entering PLAYER used to wait for a
// click on the world, which made switching views feel like the mode had not started; asking here, in
// the handler that did the switching, is the whole fix — and it must be asked SYNCHRONOUSLY, because a
// request deferred to an effect or a subscription callback is no longer inside the gesture.

const setViewMode = vi.fn((_m: Vo3dViewMode) => {});
const requestPointerLock = vi.fn();
let viewCb: ((m: Vo3dViewMode) => void) | null = null;

const world = {
  setViewMode: (m: Vo3dViewMode) => { setViewMode(m); viewCb?.(m); },
  requestPointerLock,
  subscribeViewMode: (cb: (m: Vo3dViewMode) => void) => {
    viewCb = cb;
    cb("office");
    return () => { viewCb = null; };
  },
} as unknown as Vo3dWorld;
const worldRef = { current: world };

const mount = () => render(<Vo3dViewSwitcher worldRef={worldRef} ready />);
const pressC = () => act(() => { fireEvent.keyDown(window, { code: "KeyC" }); });

beforeEach(() => {
  vi.clearAllMocks();
  viewCb = null;
});

describe("the C key", () => {
  it("cycles Office → 3D → Player → Office", () => {
    expect(nextViewMode("office")).toBe("explore");
    expect(nextViewMode("explore")).toBe("player");
    expect(nextViewMode("player")).toBe("office");
  });

  it("asks for the pointer when — and only when — it lands on PLAYER", () => {
    mount();
    pressC(); // office -> explore
    expect(setViewMode).toHaveBeenLastCalledWith("explore");
    expect(requestPointerLock).not.toHaveBeenCalled();

    pressC(); // explore -> player
    expect(setViewMode).toHaveBeenLastCalledWith("player");
    expect(requestPointerLock).toHaveBeenCalledTimes(1);

    pressC(); // player -> office
    expect(setViewMode).toHaveBeenLastCalledWith("office");
    expect(requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it("asks synchronously, inside the keypress — a deferred request is no longer a gesture", () => {
    mount();
    pressC();
    // Still inside the same act() as the keydown: no timer, no effect, no microtask.
    act(() => { fireEvent.keyDown(window, { code: "KeyC" }); expect(requestPointerLock).toHaveBeenCalled(); });
  });

  it("leaves modified presses alone, so Cmd/Ctrl+C is still a copy", () => {
    mount();
    act(() => { fireEvent.keyDown(window, { code: "KeyC", metaKey: true }); });
    act(() => { fireEvent.keyDown(window, { code: "KeyC", ctrlKey: true }); });
    expect(setViewMode).not.toHaveBeenCalled();
  });

  it("does not switch while somebody is typing", () => {
    mount();
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    act(() => { fireEvent.keyDown(field, { code: "KeyC", bubbles: true }); });
    expect(setViewMode).not.toHaveBeenCalled();
    field.remove();
  });

  it("does not re-request on a key repeat", () => {
    mount();
    pressC();
    pressC(); // now on player, one request
    act(() => { fireEvent.keyDown(window, { code: "KeyC", repeat: true }); });
    expect(requestPointerLock).toHaveBeenCalledTimes(1);
  });
});
