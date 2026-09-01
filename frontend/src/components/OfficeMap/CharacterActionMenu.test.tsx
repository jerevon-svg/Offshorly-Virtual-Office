import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssetLayer } from "../../types/office";
import { CharacterActionMenu } from "./CharacterActionMenu";

// Only the Stage A call-label behaviour is covered here: the menu item's ACTION is unchanged
// ("call", handled by OfficeMap's single join path), so these assert the label and that the same
// handler still fires — never a second join implementation.

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
  render(
    <CharacterActionMenu
      layer={layer}
      anchor={anchor}
      onChoose={onChoose}
      onClose={vi.fn()}
      {...props}
    />,
  );
  return onChoose;
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
