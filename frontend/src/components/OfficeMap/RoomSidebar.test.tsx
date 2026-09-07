import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RoomSidebar } from "./RoomSidebar";
import type { AssetLayer } from "../../types/office";

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
  it("renders the ▦ Whiteboards button only when a handler is supplied, and calls it", () => {
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
