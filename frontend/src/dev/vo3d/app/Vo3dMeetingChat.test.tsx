import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dMeetingChat } from "./Vo3dMeetingChat";
import type { MeetingChatSnapshot } from "../../../services/meeting/meetingChatClient";

// PHASE 7D — the meeting chat as a LIVESTREAM OVERLAY. What is asserted is the restraint and the one
// gesture: lines float and fade, the input is always there, `/` gets you into it and Enter gets you back
// out to walking — with nothing to open, close, or park over the curved screen.

const send = vi.fn();
const react = vi.fn();
let snapshot: MeetingChatSnapshot = { meetingId: "cave-all-hands", messages: [], reactions: [] };

vi.mock("../../../services/meeting/meetingChatClient", async () => {
  const actual = await vi.importActual<typeof import("../../../services/meeting/meetingChatClient")>(
    "../../../services/meeting/meetingChatClient",
  );
  return {
    ...actual,
    useMeetingChat: () => snapshot,
    sendMeetingChat: (...a: unknown[]) => send(...a),
    sendMeetingReaction: (...a: unknown[]) => react(...a),
  };
});

const SELF = "micah@offshorly.com";
const PEER = "angelo@offshorly.com";
const msg = (id: string, email: string, text: string) => ({ id, email, text, atMs: Date.now() });

const resume = vi.fn();

const mount = (props: Partial<React.ComponentProps<typeof Vo3dMeetingChat>> = {}) =>
  render(
    <Vo3dMeetingChat
      active
      selfId={SELF}
      resolveDisplayName={(e) => (e === PEER ? "Angelo" : e)}
      onResumePointer={resume}
      {...props}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  snapshot = { meetingId: "cave-all-hands", messages: [], reactions: [] };
  Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => null });
  document.exitPointerLock = vi.fn() as never;
});

describe("the livestream overlay", () => {
  it("shows nothing at all outside a meeting", () => {
    mount({ active: false });
    expect(screen.queryByTestId("vo3d-meeting-chat")).toBeNull();
  });

  it("has NO panel, header or close button — there is nothing to open or shut", () => {
    mount();
    expect(screen.queryByTestId("meeting-chat-panel")).toBeNull();
    expect(screen.queryByTestId("meeting-chat-toggle")).toBeNull();
    expect(screen.queryByLabelText("Collapse meeting chat")).toBeNull();
  });

  it("keeps a compact input visible during the meeting, inviting the key that opens it", () => {
    mount();
    expect(screen.getByTestId("meeting-chat-input")).toHaveAttribute("placeholder", "Press / to chat...");
  });

  it("floats the recent lines and fades the older ones without losing them", () => {
    snapshot = {
      ...snapshot,
      messages: Array.from({ length: 4 }, (_, i) => msg(`m${i}`, PEER, `line ${i}`)),
    };
    mount();
    const lines = screen.getAllByTestId("meeting-chat-line");
    expect(lines).toHaveLength(4);
    // The newest carries no age class; older ones do, so they recede rather than vanish.
    expect(lines[3].className).not.toMatch(/age/);
    expect(lines[0].className).toMatch(/age/);
  });

  it("names you as You and everybody else by their display name", () => {
    snapshot = { ...snapshot, messages: [msg("m1", PEER, "hi"), msg("m2", SELF, "hello")] };
    mount();
    const lines = screen.getAllByTestId("meeting-chat-line");
    expect(lines[0]).toHaveTextContent("Angelo");
    expect(lines[1]).toHaveTextContent("You");
  });

  it("keeps reactions and stickers reachable, inline rather than behind a tray", () => {
    mount();
    fireEvent.click(screen.getByTestId("meeting-reaction-🔥"));
    expect(react).toHaveBeenCalledWith("🔥");
    fireEvent.click(screen.getByTestId("meeting-sticker-🚀 ship it"));
    expect(react).toHaveBeenCalledWith("🚀 ship it");
  });

  it("marks itself quieter while somebody is presenting, without going away", () => {
    mount({ presenting: true });
    expect(screen.getByTestId("vo3d-meeting-chat")).toHaveAttribute("data-presenting", "true");
    expect(screen.getByTestId("meeting-chat-input")).toBeInTheDocument();
  });
});

describe("the one gesture: / in, Enter out", () => {
  it("focuses the field on / and releases the pointer with it", () => {
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => document.body });
    const exit = vi.fn();
    document.exitPointerLock = exit as never;
    mount();

    fireEvent.keyDown(window, { key: "/" });

    expect(document.activeElement).toBe(screen.getByTestId("meeting-chat-input"));
    // A locked pointer delivers no DOM events, so without this the field could never be reached.
    expect(exit).toHaveBeenCalled();
  });

  it("sends on Enter and hands the mouse back from that same keypress", () => {
    mount();
    const input = screen.getByTestId("meeting-chat-input");
    fireEvent.change(input, { target: { value: "on my way" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(send).toHaveBeenCalledWith("on my way");
    expect(resume).toHaveBeenCalled();
  });

  it("Escape leaves without sending, and drops the draft", () => {
    mount();
    const input = screen.getByTestId("meeting-chat-input");
    fireEvent.change(input, { target: { value: "never mind" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(send).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("never lets a keystroke meant for the field reach the world", () => {
    mount();
    const input = screen.getByTestId("meeting-chat-input");
    const onWorldKey = vi.fn();
    window.addEventListener("keydown", onWorldKey);
    fireEvent.keyDown(input, { key: "w", bubbles: true });
    fireEvent.keyDown(input, { key: "Enter", bubbles: true });
    window.removeEventListener("keydown", onWorldKey);
    expect(onWorldKey).not.toHaveBeenCalled();
  });

  it("does not hijack / while somebody is typing anywhere else", () => {
    mount();
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    fireEvent.keyDown(field, { key: "/", bubbles: true });
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it("does not take / outside a meeting", () => {
    const exit = vi.fn();
    document.exitPointerLock = exit as never;
    mount({ active: false });
    fireEvent.keyDown(window, { key: "/" });
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("the click-through regression, still pinned", () => {
  it("restores pointer-events AFTER the reset that would wipe them", async () => {
    // @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) —
    // the same exemption HudDock.layering.test.ts takes to read a stylesheet as data.
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/dev/vo3d/app/Vo3dMeetingChat.module.css", "utf8");
    const input = /\.input\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(input).toContain("all: unset");
    // ORDER IS THE WHOLE BUG: stated before the reset, it is wiped by it and every click falls
    // through to the canvas behind.
    expect(input.indexOf("all: unset")).toBeLessThan(input.indexOf("pointer-events: auto"));
  });

  it("keeps the wrapper transparent so the overlay never eats a click meant for the floor", async () => {
    // @ts-expect-error see above
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/dev/vo3d/app/Vo3dMeetingChat.module.css", "utf8");
    expect(/\.root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "").toContain("pointer-events: none");
  });
});
