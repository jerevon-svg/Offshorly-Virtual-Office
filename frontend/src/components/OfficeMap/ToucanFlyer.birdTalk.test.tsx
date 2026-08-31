import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToucanFlyer } from "./ToucanFlyer";

// The world-space pill above the bird is BIRD TALK ONLY — it must never carry
// the assistant's real answer (that lives in ToucanAssistantPanel). These
// tests pin exactly that separation. Movement/flight are untouched here.

// No WebGL and no real GLB in jsdom: the component already tolerates both
// (the load is caught, renderToCanvas failure sets webglBroken), these mocks
// just keep the test quiet and fast.
vi.mock("../../render3d/glbCache", () => ({
  loadGlbCached: () => new Promise(() => {}),
}));
vi.mock("../../render3d/SharedRenderer", () => ({
  getSharedRenderer: () => {
    throw new Error("no webgl in test");
  },
  renderToCanvas: () => {
    throw new Error("no webgl in test");
  },
}));

describe("ToucanFlyer world-space bubble", () => {
  it("says bird talk only while a reply is pending", () => {
    render(<ToucanFlyer thinking />);
    expect(screen.getByTestId("toucan-bird-talk")).toHaveTextContent("Squawk squawk…");
  });

  it("renders no bubble when nothing is pending", () => {
    render(<ToucanFlyer thinking={false} />);
    expect(screen.queryByTestId("toucan-bird-talk")).not.toBeInTheDocument();
  });

  it("cannot render an assistant response — the prop is a boolean, not text", () => {
    // A caller trying to smuggle text through the flag still gets bird talk:
    // the string is a module constant inside the component.
    render(<ToucanFlyer thinking={"Micah is currently in the Design Room." as unknown as boolean} />);
    const bubble = screen.getByTestId("toucan-bird-talk");
    expect(bubble).toHaveTextContent("Squawk squawk…");
    expect(bubble.textContent).not.toContain("Design Room");
  });
});
