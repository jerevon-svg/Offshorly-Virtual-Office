import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CompanyHub } from "./CompanyHub";
import type { HubItem } from "../../services/hub/hubClient";

const mockState: { snapshot: ReturnType<typeof makeSnapshot> } = {
  snapshot: makeSnapshot([]),
};

function makeSnapshot(items: HubItem[], overrides: Partial<{ mode: "checkin" | "manual"; loading: boolean; error: string | null }> = {}) {
  return {
    isOpen: true,
    mode: overrides.mode ?? ("checkin" as const),
    items,
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
  };
}

function makeItem(overrides: Partial<HubItem> = {}): HubItem {
  return {
    id: "item-1",
    type: "announcement",
    title: "Test Announcement",
    description: "Some description",
    imageUrl: null,
    startAt: new Date().toISOString(),
    endAt: null,
    priority: "normal",
    ctaLabel: null,
    ctaAction: null,
    audienceEmail: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    myStatus: "unseen",
    myActed: false,
    ...overrides,
  };
}

const { dismissItem, acknowledgeItem, actOnItem, closeCompanyHub } = vi.hoisted(() => ({
  dismissItem: vi.fn().mockResolvedValue(undefined),
  acknowledgeItem: vi.fn().mockResolvedValue(undefined),
  actOnItem: vi.fn().mockResolvedValue(undefined),
  closeCompanyHub: vi.fn(),
}));

vi.mock("../../services/hub/companyHubStore", async () => {
  const actual = await vi.importActual<typeof import("../../services/hub/companyHubStore")>(
    "../../services/hub/companyHubStore",
  );
  return {
    ...actual,
    useCompanyHub: () => mockState.snapshot,
    dismissItem,
    acknowledgeItem,
    actOnItem,
    closeCompanyHub,
  };
});

describe("CompanyHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockState.snapshot = makeSnapshot([]);
  });

  it("shows the all-caught-up empty state and an enabled primary button when there are no items", () => {
    mockState.snapshot = makeSnapshot([]);
    render(<CompanyHub />);

    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter Office" })).not.toBeDisabled();
  });

  it("disables Enter Office while a required item is unacknowledged, and enables it after acknowledging", async () => {
    const required = makeItem({
      id: "req-1",
      type: "announcement",
      priority: "required",
      title: "Policy update",
      ctaLabel: "Read More",
    });
    mockState.snapshot = makeSnapshot([required]);
    const { rerender } = render(<CompanyHub />);

    const enterButton = screen.getByRole("button", { name: "Enter Office" });
    expect(enterButton).toBeDisabled();
    expect(screen.getByText(/acknowledge required items/i)).toBeInTheDocument();

    const actionButton = screen.getByRole("button", { name: /Read More & Acknowledge/i });
    fireEvent.click(actionButton);

    await waitFor(() => expect(actOnItem).toHaveBeenCalledWith("req-1"));
    expect(acknowledgeItem).toHaveBeenCalledWith("req-1");

    // Simulate the store updating after acknowledge resolves (as it would via useSyncExternalStore).
    mockState.snapshot = makeSnapshot([
      { ...required, myStatus: "acknowledged", myActed: true },
    ]);
    rerender(<CompanyHub />);

    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter Office" })).not.toBeDisabled();
  });

  it("dismissing a normal item calls dismissItem and does not block Enter Office", () => {
    const normal = makeItem({ id: "n-1", priority: "normal", title: "Just an FYI" });
    mockState.snapshot = makeSnapshot([normal]);
    render(<CompanyHub />);

    expect(screen.getByRole("button", { name: "Enter Office" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(dismissItem).toHaveBeenCalledWith("n-1");
  });

  it("uses 'Close' as the primary label in manual mode", () => {
    mockState.snapshot = makeSnapshot([], { mode: "manual" });
    render(<CompanyHub />);

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("clicking the primary button calls closeCompanyHub", () => {
    mockState.snapshot = makeSnapshot([]);
    render(<CompanyHub />);

    fireEvent.click(screen.getByRole("button", { name: "Enter Office" }));
    expect(closeCompanyHub).toHaveBeenCalled();
  });

  it("checkin mode still hides already-handled items (unchanged attention-flow behavior)", () => {
    const dismissed = makeItem({ id: "d-1", title: "Old announcement", myStatus: "dismissed" });
    const acknowledged = makeItem({ id: "a-1", title: "Old policy", priority: "required", myStatus: "acknowledged" });
    const fresh = makeItem({ id: "f-1", title: "New item", myStatus: "unseen" });
    mockState.snapshot = makeSnapshot([dismissed, acknowledged, fresh], { mode: "checkin" });

    render(<CompanyHub />);

    expect(screen.queryByText("Old announcement")).not.toBeInTheDocument();
    expect(screen.queryByText("Old policy")).not.toBeInTheDocument();
    expect(screen.getByText("New item")).toBeInTheDocument();
  });

  it("manual reopen shows dismissed/acknowledged items with a state badge, read-only (no action buttons)", () => {
    const dismissed = makeItem({ id: "d-1", title: "Old announcement", myStatus: "dismissed" });
    const acknowledged = makeItem({
      id: "a-1",
      title: "Old policy",
      priority: "required",
      myStatus: "acknowledged",
    });
    const fresh = makeItem({ id: "f-1", title: "New item", myStatus: "unseen", ctaLabel: "Read More" });
    mockState.snapshot = makeSnapshot([dismissed, acknowledged, fresh], { mode: "manual" });

    render(<CompanyHub />);

    // All three are visible, unlike checkin mode.
    expect(screen.getByText("Old announcement")).toBeInTheDocument();
    expect(screen.getByText("Old policy")).toBeInTheDocument();
    expect(screen.getByText("New item")).toBeInTheDocument();

    // State badges reflect each item's real persisted status.
    expect(screen.getByText("Dismissed")).toBeInTheDocument();
    expect(screen.getByText("✓ Acknowledged")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();

    // Handled items are read-only — the only "Dismiss" button left belongs to the still-fresh
    // item, and no "Acknowledge" action button is offered for the already-acknowledged one.
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Acknowledge/ })).not.toBeInTheDocument();

    // The still-fresh item keeps its normal actionable buttons.
    expect(screen.getByRole("button", { name: "Read More" })).toBeInTheDocument();
  });

  it("a previously-acknowledged required item does not block Enter Office when reviewed in manual mode", () => {
    const acknowledgedRequired = makeItem({
      id: "req-1",
      priority: "required",
      myStatus: "acknowledged",
    });
    mockState.snapshot = makeSnapshot([acknowledgedRequired], { mode: "manual" });

    render(<CompanyHub />);

    expect(screen.getByRole("button", { name: "Close" })).not.toBeDisabled();
  });
});
