import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogItem, Progression, RedeemResult, Redemption } from "../../services/quests/questsClient";

vi.mock("../../services/quests/questsClient", () => ({
  fetchMyProgression: vi.fn(),
  fetchMyBadges: vi.fn(),
  fetchRewardCatalog: vi.fn(),
  fetchMyRedemptions: vi.fn(),
  redeemReward: vi.fn(),
  cancelRedemption: vi.fn(),
  newIdempotencyKey: vi.fn(() => "test-key-000001"),
}));

import {
  cancelRedemption,
  fetchMyProgression,
  fetchMyRedemptions,
  fetchRewardCatalog,
  redeemReward,
} from "../../services/quests/questsClient";
import { getProgressionSnapshot, resetProgressionForTests } from "../../services/quests/progressionStore";
import { RewardsPanel } from "./RewardsPanel";

const p = (over: Partial<Progression> = {}): Progression => ({ xp: 0, coins: 100, level: 1, levelStartXp: 0, nextLevelXp: 100, ...over });
const item = (over: Partial<CatalogItem> = {}): CatalogItem => ({
  id: "coffee_voucher",
  title: "Coffee Voucher (demo)",
  description: "One coffee.",
  cost: 60,
  category: "voucher",
  requiresApproval: false,
  affordable: true,
  ...over,
});
const redemption = (over: Partial<Redemption> = {}): Redemption => ({
  id: "r1",
  itemId: "early_out_pass",
  title: "Early-Out Pass, 1 hour (demo)",
  cost: 200,
  status: "pending",
  note: null,
  createdAt: "2026-09-07T09:00:00Z",
  decidedAt: null,
  ...over,
});

describe("RewardsPanel", () => {
  beforeEach(() => {
    resetProgressionForTests();
    vi.clearAllMocks();
    vi.mocked(fetchMyProgression).mockResolvedValue(p());
    vi.mocked(fetchRewardCatalog).mockResolvedValue({
      items: [item(), item({ id: "desk_plant", title: "Desk Plant (demo)", cost: 120, category: "perk", requiresApproval: true, affordable: false })],
      progression: p(),
    });
    vi.mocked(fetchMyRedemptions).mockResolvedValue([redemption(), redemption({ id: "r2", status: "fulfilled", title: "Coffee Voucher (demo)", cost: 60, note: "enjoy" })]);
  });

  it("shows cost, affordability and approval hints; unaffordable items cannot be redeemed", async () => {
    render(<RewardsPanel onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("reward-catalog")).toBeInTheDocument());
    // The 🪙 glyph is now the locked HUD coin asset beside the amount.
    expect(screen.getByTestId("reward-coffee_voucher-cost")).toHaveTextContent("60");
    expect(screen.getByTestId("reward-coffee_voucher-cost").querySelector("img")).not.toBeNull();
    expect(screen.getByTestId("reward-coffee_voucher")).toHaveAttribute("data-affordable", "true");
    expect(screen.getByTestId("reward-desk_plant")).toHaveAttribute("data-affordable", "false");
    expect(screen.getByTestId("reward-desk_plant")).toHaveTextContent("Approval needed");
    // Affordability now gates the CONFIRM button in the selection summary — picking a card
    // commits nothing, so an unaffordable card can be inspected but never redeemed.
    fireEvent.click(screen.getByTestId("reward-desk_plant"));
    expect(screen.getByRole("button", { name: "Confirm redeem Desk Plant (demo)" })).toBeDisabled();
    fireEvent.click(screen.getByTestId("reward-coffee_voucher"));
    expect(screen.getByRole("button", { name: "Confirm redeem Coffee Voucher (demo)" })).toBeEnabled();
    // Catalog response feeds the shared store, so the header shows the server balance.
    expect(screen.getByTestId("rewards-balance")).toHaveTextContent("100 Coins");
  });

  it("redeems only after confirmation, once per press, then folds the server balance into the store and shows history", async () => {
    vi.mocked(redeemReward).mockResolvedValue({
      redemption: redemption({ id: "r3", itemId: "coffee_voucher", title: "Coffee Voucher (demo)", cost: 60, status: "approved" }),
      createdNow: true,
      progression: p({ coins: 40 }),
    } satisfies RedeemResult);
    render(<RewardsPanel onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("reward-catalog")).toBeInTheDocument());

    // Step 1 — picking a card only selects it; nothing is spent.
    expect(screen.getByText("Choose a reward to see its details")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("reward-coffee_voucher"));
    expect(screen.getByTestId("reward-selection")).toHaveTextContent("Coffee Voucher (demo)");
    expect(screen.getByTestId("reward-selection")).toHaveTextContent("60 Coins");
    expect(screen.getByTestId("reward-coffee_voucher")).toHaveAttribute("data-selected", "true");
    expect(redeemReward).not.toHaveBeenCalled();

    // Deselecting returns to the empty summary, still without spending.
    fireEvent.click(screen.getByTestId("reward-coffee_voucher"));
    expect(screen.queryByTestId("reward-selection")).toBeNull();
    expect(redeemReward).not.toHaveBeenCalled();

    // Step 2 — the summary's Redeem is the confirm.
    fireEvent.click(screen.getByTestId("reward-coffee_voucher"));
    const confirm = screen.getByRole("button", { name: "Confirm redeem Coffee Voucher (demo)" });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm); // double-click → one request
    });
    expect(redeemReward).toHaveBeenCalledTimes(1);
    expect(redeemReward).toHaveBeenCalledWith("coffee_voucher", "test-key-000001");
    expect(getProgressionSnapshot().progression?.coins).toBe(40);
    expect(getProgressionSnapshot().coinsPulse).toBeGreaterThan(0);
    // Jumps to History with the new redemption on top.
    const rows = within(screen.getByTestId("reward-history")).getAllByRole("listitem");
    expect(rows[0]).toHaveAttribute("data-testid", "redemption-r3");
    expect(screen.getByTestId("redemption-r3-status")).toHaveTextContent("Approved");
  });

  it("history shows every status and Cancel only while pending; cancelling refunds via the server response", async () => {
    vi.mocked(cancelRedemption).mockResolvedValue({ redemption: redemption({ status: "cancelled" }), progression: p({ coins: 300 }) });
    render(<RewardsPanel onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("reward-catalog")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /History/ }));
    expect(screen.getByTestId("rewards-pending-count").textContent).toBe("1");
    expect(screen.getByTestId("redemption-r1-status")).toHaveTextContent("Pending approval");
    expect(screen.getByTestId("redemption-r2-status")).toHaveTextContent("Fulfilled");
    expect(screen.getByTestId("redemption-r2")).toHaveTextContent("“enjoy”");
    expect(screen.queryByRole("button", { name: "Cancel Coffee Voucher (demo)" })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel Early-Out Pass, 1 hour (demo)" }));
    });
    expect(cancelRedemption).toHaveBeenCalledWith("r1");
    expect(screen.getByTestId("redemption-r1-status")).toHaveTextContent("Cancelled");
    expect(screen.queryByRole("button", { name: /^Cancel Early-Out/ })).toBeNull();
    expect(getProgressionSnapshot().progression?.coins).toBe(300);
  });

  it("surfaces a server refusal without changing balances", async () => {
    vi.mocked(redeemReward).mockRejectedValue(new Error("Not enough Coins: 10 available, 60 needed"));
    render(<RewardsPanel onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("reward-catalog")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("reward-coffee_voucher"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm redeem Coffee Voucher (demo)" }));
    });
    expect(screen.getByText("Not enough Coins: 10 available, 60 needed")).toBeInTheDocument();
    expect(getProgressionSnapshot().progression?.coins).toBe(100);
  });
});
