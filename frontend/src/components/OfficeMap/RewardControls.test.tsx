import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClaimButton } from "./RewardControls";

// Every row reserves the same action slot, so nothing beside it shifts as a task progresses.
describe("ClaimButton always occupies the row's action slot", () => {
  const base = { pending: false, onClaim: vi.fn(), label: "Check in" };

  it("renders a disabled Claim for an incomplete task", () => {
    render(<ClaimButton {...base} completed={false} claimed={false} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn.textContent).toBe("Claim");
  });

  it("renders an enabled Claim only when completed and unclaimed", () => {
    render(<ClaimButton {...base} completed claimed={false} />);
    const btn = screen.getByRole("button", { name: "Claim reward for Check in" });
    expect(btn).not.toBeDisabled();
  });

  it("renders a disabled Claimed once claimed", () => {
    render(<ClaimButton {...base} completed claimed />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn.textContent).toBe("Claimed");
  });

  it("exposes the claimable accessible name ONLY in the actionable state", () => {
    const { unmount } = render(<ClaimButton {...base} completed={false} claimed={false} />);
    expect(screen.queryByRole("button", { name: /Claim reward for/ })).toBeNull();
    unmount();

    const second = render(<ClaimButton {...base} completed claimed />);
    expect(screen.queryByRole("button", { name: /Claim reward for/ })).toBeNull();
    second.unmount();

    render(<ClaimButton {...base} completed claimed={false} />);
    expect(screen.getByRole("button", { name: /Claim reward for/ })).toBeInTheDocument();
  });

  it("renders a button in every state, so the slot is never empty", () => {
    for (const state of [
      { completed: false, claimed: false },
      { completed: true, claimed: false },
      { completed: true, claimed: true },
    ]) {
      const { unmount } = render(<ClaimButton {...base} {...state} />);
      expect(screen.getAllByRole("button")).toHaveLength(1);
      unmount();
    }
  });
});
