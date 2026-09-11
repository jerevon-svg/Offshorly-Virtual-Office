import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PanelTabs } from "./PanelTabs";

// THE shared tab bar — Quests | Missions, Notifications All | Unread, Rewards Catalog | History.
describe("PanelTabs", () => {
  it("renders a tablist with the active tab selected and reports changes", () => {
    const onChange = vi.fn();
    render(<PanelTabs ariaLabel="Demo" tabs={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} active="a" onChange={onChange} />);
    expect(screen.getByRole("tablist", { name: "Demo" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("accepts a node label, so a tab can carry a badge (Rewards' pending count)", () => {
    render(
      <PanelTabs
        ariaLabel="Demo"
        tabs={[{ value: "h", label: (<>History<span data-testid="badge">2</span></>) }]}
        active="h"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: /History/ })).toContainElement(screen.getByTestId("badge"));
  });
});
