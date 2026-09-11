import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssetLayer } from "../../types/office";
import { CharacterActionMenu } from "./CharacterActionMenu";

// The employee menu is now a thin wrapper over the shared WorldActionMenu (card, rows, dismissal
// are tested there). What is covered HERE is that its rows, labels, gates and dispatched action
// strings are exactly what they were — the Stage A call label included: the item's ACTION is
// still "call", handled by OfficeMap's single join path, never a second join implementation.

const layer = {
  id: "angelo@offshorly.com",
  name: "Angelo",
  kind: "character",
  x: 0,
  y: 0,
  width: 60,
  height: 90,
  path: "",
} as unknown as AssetLayer;

const anchor = { clientX: 100, clientY: 100 };

function renderMenu(props: Partial<React.ComponentProps<typeof CharacterActionMenu>> = {}) {
  const onChoose = vi.fn();
  const onClose = vi.fn();
  render(<CharacterActionMenu layer={layer} anchor={anchor} onChoose={onChoose} onClose={onClose} {...props} />);
  return Object.assign(onChoose, { onClose });
}

describe("CharacterActionMenu call label", () => {
  it("reads 'Call' when the target is not in an active call", () => {
    renderMenu();
    expect(screen.getByText("Call")).toBeInTheDocument();
    expect(screen.queryByText("Join call")).not.toBeInTheDocument();
  });

  it("reads 'Join call' when the target is already a participant in the active call", () => {
    renderMenu({ targetInActiveCall: true });
    expect(screen.getByText("Join call")).toBeInTheDocument();
    expect(screen.queryByText("Call")).not.toBeInTheDocument();
  });

  it("dispatches the SAME 'call' action either way — one join path, not two", () => {
    const plain = renderMenu();
    screen.getByText("Call").click();
    expect(plain).toHaveBeenCalledWith("call");
  });

  it("dispatches 'call' from the relabelled item too", () => {
    const joining = renderMenu({ targetInActiveCall: true });
    screen.getByText("Join call").click();
    expect(joining).toHaveBeenCalledWith("call");
  });

  it("leaves the other actions untouched", () => {
    renderMenu({ targetInActiveCall: true, canAskToJoin: true });
    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Approach")).toBeInTheDocument();
    expect(screen.getByText("View Profile")).toBeInTheDocument();
    expect(screen.getByText("Ask to Join")).toBeInTheDocument();
  });

  it("does not show Ask to Join when it isn't offered", () => {
    renderMenu({ targetInActiveCall: true });
    expect(screen.queryByText("Ask to Join")).not.toBeInTheDocument();
  });
});

describe("CharacterActionMenu on the shared world menu", () => {
  it("dispatches every row's unchanged action string", () => {
    const onChoose = renderMenu({ canAskToJoin: true, showDemos: true });
    for (const [label, action] of [
      ["Chat", "chat"],
      ["Approach", "approach"],
      ["View Profile", "viewProfile"],
      ["Ask to Join", "askToJoin"],
      ["Walk demo", "walkDemo"],
      ["Pat demo", "patDemo"],
    ] as const) {
      screen.getByRole("menuitem", { name: label }).click();
      expect(onChoose).toHaveBeenLastCalledWith(action);
    }
  });

  it("hides the demo rows unless the caller offers them", () => {
    renderMenu();
    expect(screen.queryByText("Walk demo")).not.toBeInTheDocument();
    expect(screen.queryByText("Pat demo")).not.toBeInTheDocument();
  });

  it("frames the rows with the person's name, and their presence only when known", () => {
    renderMenu({ status: "BUSY" });
    expect(screen.getByRole("menu", { name: "Actions for Angelo" })).toBeInTheDocument();
    expect(screen.getByText("Angelo")).toBeInTheDocument();
    const meta = screen.getByTestId("world-menu-meta");
    expect(meta).toHaveTextContent("Busy");
    // The dot carries STATUS_META's colour for BUSY, the same one the nameplate uses.
    expect((meta.firstElementChild as HTMLElement).style.backgroundColor).toBe("rgb(245, 158, 11)");
  });

  it("shows no presence meta at all when the caller has none for this person", () => {
    renderMenu();
    expect(screen.queryByTestId("world-menu-meta")).not.toBeInTheDocument();
  });

  it("badges the Chat row with this person's real unread count, and only then", () => {
    renderMenu({ unreadCount: 3 });
    expect(screen.getByTestId("world-menu-badge-chat")).toHaveTextContent("3");
    expect(screen.queryByTestId("world-menu-badge-call")).not.toBeInTheDocument();
  });

  it("badges nothing when there is nothing unread", () => {
    renderMenu({ unreadCount: 0 });
    expect(screen.queryByTestId("world-menu-badge-chat")).not.toBeInTheDocument();
    renderMenu();
    expect(screen.queryByTestId("world-menu-badge-chat")).not.toBeInTheDocument();
  });

  it("still closes on Escape and on an outside press, through the shared shell", () => {
    const { onClose } = renderMenu();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("marks its anchor as a character so the shared card draws its pointer notch", () => {
    renderMenu();
    expect(screen.getByTestId("world-menu").getAttribute("data-side")).toBe("right");
  });
});
