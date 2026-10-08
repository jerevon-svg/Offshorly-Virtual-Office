import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dTravelChat } from "./Vo3dTravelChat";

// GO TOGETHER PHASE 5 — the Travel Chat strip: the same `/` gesture as the meeting chat, a small rolling
// feed, and an Esc that closes the composer WITHOUT reaching the world's "leave Go Together" Esc.

const SELF = "bon@x.com";
const ALEX = "alex@x.com";
const line = (id: string, email: string, text: string) => ({ id, email, text, atMs: Date.now() });
const send = vi.fn();
const resume = vi.fn();

const mount = (props: Partial<React.ComponentProps<typeof Vo3dTravelChat>> = {}) =>
  render(
    <Vo3dTravelChat
      active
      selfId={SELF}
      lines={[]}
      resolveDisplayName={(e) => (e === ALEX ? "Alex" : e)}
      onSend={send}
      onResumePointer={resume}
      {...props}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => null });
  document.exitPointerLock = vi.fn() as never;
});

describe("the travel chat strip", () => {
  it("is absent when this tab is not travelling (or a meeting owns `/`)", () => {
    mount({ active: false });
    expect(screen.queryByTestId("vo3d-travel-chat")).toBeNull();
    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(document.body);
  });

  it("shows only the newest few lines, with You for the viewer", () => {
    mount({ lines: [1, 2, 3, 4, 5].map((n) => line(`m${n}`, n === 5 ? SELF : ALEX, `line ${n}`)) });
    const rows = screen.getAllByTestId("travel-chat-line");
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain("line 2");
    expect(rows[3].textContent).toBe("Youline 5");
    expect(rows[2].textContent).toBe("Alexline 4");
  });

  it("`/` focuses the field and releases the pointer; Enter sends and asks for the pointer back", () => {
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => document.body });
    mount();
    fireEvent.keyDown(window, { key: "/" });
    const input = screen.getByTestId("travel-chat-input") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(document.exitPointerLock).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "  Are we presenting the new version?  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).toHaveBeenCalledWith("Are we presenting the new version?");
    expect(resume).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");
    expect(document.activeElement).not.toBe(input);
  });

  it("Esc closes the composer only — prevented and stopped, so the world's journey Esc never sees it", () => {
    const worldEsc = vi.fn();
    const onWindow = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) worldEsc();
    };
    window.addEventListener("keydown", onWindow);
    try {
      mount();
      fireEvent.keyDown(window, { key: "/" });
      const input = screen.getByTestId("travel-chat-input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "draft" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(worldEsc).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(input.value).toBe("");
      expect(document.activeElement).not.toBe(input);
      // the NEXT Esc, composer closed, is the world's again
      fireEvent.keyDown(window, { key: "Escape" });
      expect(worldEsc).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", onWindow);
    }
  });

  it("walking keys typed into the field stay in the field", () => {
    const worldKey = vi.fn();
    window.addEventListener("keydown", worldKey);
    try {
      mount();
      fireEvent.keyDown(window, { key: "/" });
      worldKey.mockClear();
      fireEvent.keyDown(screen.getByTestId("travel-chat-input"), { key: "w" });
      expect(worldKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", worldKey);
    }
  });
});
