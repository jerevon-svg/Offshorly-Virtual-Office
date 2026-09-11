// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) —
// same exemption HudDock.layering.test.ts takes. vitest runs with cwd = frontend/.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RoomSidebar } from "./RoomSidebar";
import type { AssetLayer } from "../../types/office";
import type { OfficePerson } from "../../services/office/floorMerge";
import styles from "./RoomSidebar.module.css";

const layer: AssetLayer = {
  id: "dev-team",
  kind: "room",
  path: "",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  transform: null,
};

describe("RoomSidebar — Whiteboard W4 entry", () => {
  it("renders the Whiteboards button only when a handler is supplied, and calls it", () => {
    const onOpenWhiteboards = vi.fn();
    const { rerender } = render(
      <RoomSidebar open layer={layer} side="right" members={[]} onClose={() => {}} />,
    );
    expect(screen.queryByLabelText("Open whiteboards")).toBeNull();

    rerender(
      <RoomSidebar open layer={layer} side="right" members={[]} onClose={() => {}} onOpenWhiteboards={onOpenWhiteboards} />,
    );
    fireEvent.click(screen.getByLabelText("Open whiteboards"));
    expect(onOpenWhiteboards).toHaveBeenCalledTimes(1);
    // The close button is still there beside it.
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });
});

const person = (over: Partial<OfficePerson> = {}): OfficePerson => ({
  email: "angelo@offshorly.com",
  displayName: "Angelo",
  status: "ONLINE",
  departmentName: "Design",
  jobTitle: "Designer",
  currentActivity: "Implementing proof of concepts",
  lastMessage: null,
  avatarId: null,
  roomId: "dev-team",
  atlasRoomId: null,
  inEphemeralRoom: false,
  ...over,
});

describe("RoomSidebar — presentation polish keeps the behaviour", () => {
  it("still docks on whichever side the caller chose — the adaptive left/right logic is untouched", () => {
    const { container, rerender } = render(<RoomSidebar open layer={layer} side="right" members={[]} onClose={() => {}} />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.classList.contains(styles.sidebar)).toBe(true);
    expect(panel.classList.contains(styles.open)).toBe(true);
    expect(panel.classList.contains(styles.left)).toBe(false);
    rerender(<RoomSidebar open layer={layer} side="left" members={[]} onClose={() => {}} />);
    expect(panel.classList.contains(styles.left)).toBe(true);
    // Closing keeps the last side through the slide-out (content/side caching, as before).
    rerender(<RoomSidebar open={false} layer={null} side="right" members={[]} onClose={() => {}} />);
    expect(panel.classList.contains(styles.left)).toBe(true);
    expect(panel.classList.contains(styles.open)).toBe(false);
  });

  it("lists live occupants as rows with a real portrait (or an initial), status dot, name and work line", () => {
    render(
      <RoomSidebar
        open
        layer={layer}
        side="right"
        members={[]}
        onClose={() => {}}
        people={[person(), person({ email: "nobody@example.com", displayName: "Nobody", status: "AWAY", currentActivity: null, inEphemeralRoom: true, atlasRoomId: "r-1" })]}
        roomNames={new Map([["r-1", "Design Sprint"]])}
      />,
    );
    const rows = screen.getAllByTestId("room-person");
    expect(rows).toHaveLength(2);
    // Angelo has a New Portrait; Nobody falls back to an initial — never a broken image.
    expect(rows[0].querySelector("img")?.getAttribute("src")).toContain("portraits/angelo.png");
    expect(rows[0]).toHaveTextContent("Angelo");
    expect(rows[0]).toHaveTextContent("Implementing proof of concepts");
    expect(rows[1].querySelector("img")).toBeNull();
    expect(rows[1]).toHaveTextContent("N");
    expect(rows[1]).toHaveTextContent("in Design Sprint");
    expect(screen.getByTestId("room-subtitle")).toHaveTextContent("2 people in the room");
    // The status dot colour still comes from the same presence mapping.
    const dot = rows[0].querySelector(`.${styles.dot}`) as HTMLElement;
    expect(dot.style.background).toBe("rgb(62, 196, 109)");
  });

  it("falls back to the manifest cast with their sprite, and shows the empty state when nobody is here", () => {
    const member = { ...layer, id: "alex", kind: "character", path: "/sprites/alex.png" } as AssetLayer;
    const { rerender } = render(<RoomSidebar open layer={layer} side="right" members={[member]} onClose={() => {}} />);
    expect(screen.getByTestId("room-person").querySelector("img")?.getAttribute("src")).toBe("/sprites/alex.png");
    expect(screen.getByTestId("room-subtitle")).toHaveTextContent("1 seat");
    rerender(<RoomSidebar open layer={layer} side="right" members={[]} onClose={() => {}} people={[]} />);
    expect(screen.getByText("No employees in this room")).toBeInTheDocument();
  });

  it("closes from the ✕ and from Escape, exactly as before", () => {
    const onClose = vi.fn();
    render(<RoomSidebar open layer={layer} side="right" members={[]} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("floats with the Chats panel's inset, radius and shadow — mirrored exactly on the left", () => {
    // Source-asserted: jsdom loads no CSS-module rules.
    const room = readFileSync("src/components/OfficeMap/RoomSidebar.module.css", "utf8");
    const chats = readFileSync("src/components/Chat/ConversationListPanel.module.css", "utf8");
    const rule = (css: string, cls: string) => new RegExp(`\\.${cls} \\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? "";
    const shell = rule(room, "sidebar");
    const chatsPanel = rule(chats, "panel");
    const chatsBackdrop = rule(chats, "backdrop");
    // Same viewport gap Chats pads its backdrop with.
    expect(chatsBackdrop).toMatch(/padding: 16px;/);
    expect(shell).toMatch(/top: 16px;/);
    expect(shell).toMatch(/bottom: 16px;/);
    expect(shell).toMatch(/right: 16px;/);
    expect(shell).not.toMatch(/height: 100vh/);
    // Same radius, border and shadow tokens as the Chats panel.
    for (const token of ["border-radius: 22px;", "border: 1px solid rgba(24, 20, 34, 0.08);", "box-shadow: 0 28px 70px rgba(18, 16, 28, 0.32), 0 2px 8px rgba(18, 16, 28, 0.12);"]) {
      expect(shell, token).toContain(token);
      expect(chatsPanel, token).toContain(token);
    }
    // The left dock mirrors the gap, and both slide fully past their own inset.
    const left = rule(room, "left");
    expect(left).toMatch(/left: 16px;/);
    expect(left).toMatch(/right: auto;/);
    expect(shell).toMatch(/translateX\(calc\(100% \+ 16px\)\)/);
    expect(left).toMatch(/translateX\(calc\(-100% - 16px\)\)/);
    expect(shell).toMatch(/z-index: 145;/);
  });
});
