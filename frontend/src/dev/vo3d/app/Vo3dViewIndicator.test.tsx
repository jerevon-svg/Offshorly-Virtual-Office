import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dViewIndicator } from "./Vo3dViewIndicator";
import type { Vo3dViewMode } from "./viewMode";
import type { Vo3dWorld } from "./world";

// PHASE 7D — the view indicator. C switches between three genuinely different experiences and used to
// say nothing about it. What is pinned here is that it says the right thing, once, and is never chrome:
// it must not greet a fresh session with a card nobody asked for, and it must not be clickable.

let viewCb: ((m: Vo3dViewMode) => void) | null = null;
let lockCb: ((locked: boolean, unlockedLook: boolean) => void) | null = null;

const world = {
  subscribeViewMode: (cb: (m: Vo3dViewMode) => void) => {
    viewCb = cb;
    cb("office"); // the world always pushes the CURRENT value to a new subscriber
    return () => { viewCb = null; };
  },
  subscribeLockState: (cb: (locked: boolean, unlockedLook: boolean) => void) => {
    lockCb = cb;
    return () => { lockCb = null; };
  },
} as unknown as Vo3dWorld;
const worldRef = { current: world };

const push = (m: Vo3dViewMode) => act(() => viewCb?.(m));
const lock = (locked: boolean, unlockedLook: boolean) => act(() => lockCb?.(locked, unlockedLook));
const mount = () => render(<Vo3dViewIndicator worldRef={worldRef} ready />);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe("Vo3dViewIndicator", () => {
  it("says nothing on startup — the first push is the current state, not a change", () => {
    mount();
    expect(screen.queryByTestId("vo3d-view-indicator")).toBeNull();
  });

  it.each([
    ["office", "OFFICE VIEW", "Right-click to walk · Drag to pan · Scroll to zoom"],
    ["explore", "3D VIEW", "Drag to orbit · Scroll to zoom · Explore freely"],
    ["player", "PLAYER VIEW", "Mouse to look · WASD to move · V to switch camera"],
  ] as const)("announces %s with its own controls", (mode, title, hint) => {
    mount();
    push(mode === "office" ? "explore" : "office"); // move away first, so `mode` is a real change
    push(mode);
    const card = screen.getByTestId("vo3d-view-indicator");
    expect(card).toHaveAttribute("data-view", mode);
    expect(card).toHaveTextContent(title);
    expect(card).toHaveTextContent(hint);
  });

  it("fades on its own rather than staying as chrome", () => {
    mount();
    push("player");
    expect(screen.getByTestId("vo3d-view-indicator")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByTestId("vo3d-view-indicator")).toBeNull();
  });

  it("does not re-announce a view that did not change", () => {
    mount();
    push("player");
    act(() => { vi.advanceTimersByTime(4000); });
    push("player");
    expect(screen.queryByTestId("vo3d-view-indicator")).toBeNull();
  });

  it("is a notification, never a control", () => {
    mount();
    push("player");
    const card = screen.getByTestId("vo3d-view-indicator");
    expect(card).toHaveAttribute("role", "status");
    expect(card.querySelector("button")).toBeNull();
  });

  it("shows the recovery hint ONLY when the browser actually refused the pointer", () => {
    mount();
    push("player");
    expect(screen.queryByTestId("vo3d-view-lock-hint")).toBeNull();

    lock(false, true); // refused — the fallback is carrying the mode
    expect(screen.getByTestId("vo3d-view-lock-hint")).toHaveTextContent("Click the world to capture your mouse");
  });

  it("drops the hint once the pointer is genuinely taken", () => {
    mount();
    push("player");
    lock(false, true);
    expect(screen.getByTestId("vo3d-view-lock-hint")).toBeInTheDocument();
    lock(true, false);
    expect(screen.queryByTestId("vo3d-view-lock-hint")).toBeNull();
  });

  it("never shows the lock hint outside PLAYER", () => {
    mount();
    push("explore");
    lock(false, true);
    expect(screen.queryByTestId("vo3d-view-lock-hint")).toBeNull();
  });
});
