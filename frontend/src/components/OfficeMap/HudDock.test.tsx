import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HudDock, type HudDockEntry } from "./HudDock";

// Behaviour guard for the bottom dock. The dock is presentation only, so what matters is that
// every control it is handed survives the move: same accessible name, same handler, exactly once
// (no duplicate rendered both in the row and in the ••• menu), and that its own flyouts open and
// dismiss without swallowing anything.

function action(over: Partial<Extract<HudDockEntry, { kind: "action" }>> = {}) {
  return {
    kind: "action" as const,
    key: "hub",
    icon: "🏠",
    label: "Hub",
    ariaLabel: "Open Company Hub",
    onClick: vi.fn(),
    ...over,
  };
}

describe("HudDock", () => {
  it("renders the identity group, the status group and each action exactly once", () => {
    render(
      <HudDock
        identity={<div data-testid="identity">Bon</div>}
        entries={[action(), action({ key: "map", icon: "🌍", label: "Map", ariaLabel: "Open Global Team Map" })]}
      />,
    );
    expect(screen.getByTestId("hud-dock")).toBeInTheDocument();
    expect(screen.getByTestId("identity")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Open Company Hub")).toHaveLength(1);
    expect(screen.getAllByLabelText("Open Global Team Map")).toHaveLength(1);
  });

  it("calls the caller's own handler, and nothing else, when a tile is clicked", () => {
    const onClick = vi.fn();
    render(<HudDock entries={[action({ onClick })]} />);
    fireEvent.click(screen.getByLabelText("Open Company Hub"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("marks the active control with the highlighted-tile class and disables what the caller disables", () => {
    render(
      <HudDock
        entries={[
          action({ key: "quests", ariaLabel: "Open Onboarding Questline", active: true }),
          action({ key: "toucan", ariaLabel: "Toucan is on its way", disabled: true }),
        ]}
      />,
    );
    const active = screen.getByLabelText("Open Onboarding Questline");
    const other = screen.getByLabelText("Toucan is on its way");
    expect(active.className).not.toBe(other.className);
    expect(other).toBeDisabled();
  });

  it("renders a node entry (a moved component) inline, untouched", () => {
    render(
      <HudDock
        entries={[
          { kind: "node", key: "chat", node: <button aria-label="2 unread messages">💬</button> },
        ]}
      />,
    );
    expect(screen.getByLabelText("2 unread messages")).toBeInTheDocument();
  });

  describe("the ••• Settings flyout", () => {
    // ••• is Settings, NOT an overflow drawer: no product feature is ever hidden inside it.
    const settings = {
      kind: "flyout" as const,
      key: "settings",
      icon: "•••",
      ariaLabel: "Settings",
      align: "end" as const,
      panel: <button aria-label="Mute background music">mute</button>,
    };

    it("reveals its panel only once pressed, and closes on Escape", () => {
      render(<HudDock entries={[action(), settings]} />);
      expect(screen.queryByLabelText("Mute background music")).toBeNull();
      const tile = screen.getByLabelText("Settings");
      fireEvent.click(tile);
      expect(screen.getByLabelText("Mute background music")).toBeInTheDocument();
      expect(tile).toHaveAttribute("aria-expanded", "true");
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByLabelText("Mute background music")).toBeNull();
    });

    it("stays open while the viewer interacts with it", () => {
      render(<HudDock entries={[action(), settings]} />);
      fireEvent.click(screen.getByLabelText("Settings"));
      fireEvent.pointerDown(screen.getByLabelText("Mute background music"));
      expect(screen.getByLabelText("Mute background music")).toBeInTheDocument();
    });

    it("is icon-only and right-aligned, so it cannot hang off the dock's trailing edge", () => {
      const { container } = render(<HudDock entries={[action(), settings]} />);
      expect(screen.getByLabelText("Settings").textContent).toBe("•••");
      fireEvent.click(screen.getByLabelText("Settings"));
      expect(container.querySelector("[data-testid='hud-dock-flyout-settings']")!.className).toMatch(/flyoutEnd/);
    });
  });

  describe("separators", () => {
    function rules(): number {
      return screen.getByTestId("hud-dock").querySelectorAll("div[class*='separator']").length;
    }

    it("divides two groups of entries", () => {
      render(<HudDock entries={[action(), { kind: "separator", key: "s" }, action({ key: "map" })]} />);
      expect(rules()).toBe(1);
    });

    it("never renders a leading, trailing or doubled rule once gating removes the entries around it", () => {
      // Exactly what happens when e.g. time tracking is off and its separator has nothing to
      // divide, or when the notification bell is gated away behind its own separator.
      render(
        <HudDock
          entries={[
            { kind: "separator", key: "lead" },
            action(),
            { kind: "separator", key: "a" },
            { kind: "separator", key: "b" },
            action({ key: "map" }),
            { kind: "separator", key: "trail" },
          ]}
        />,
      );
      expect(rules()).toBe(1);
    });
  });

  it("steps below the overlay family in preference to the modal family when both are flagged", () => {
    const { container } = render(<HudDock behindModal behindOverlay entries={[action()]} />);
    const dock = container.querySelector("[data-testid='hud-dock']")!;
    expect(dock.className).toMatch(/behindOverlay/);
    expect(dock.className).not.toMatch(/behindModal/);
  });
});
