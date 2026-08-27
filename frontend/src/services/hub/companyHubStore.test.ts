import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubItem } from "./hubClient";

vi.mock("./hubClient", () => ({
  fetchHubItems: vi.fn(),
  dismissHubItem: vi.fn(),
  acknowledgeHubItem: vi.fn(),
  actOnHubItem: vi.fn(),
}));

import {
  acknowledgeItem,
  actOnItem,
  closeCompanyHub,
  dismissItem,
  getCompanyHubSnapshot,
  hasBlockingRequiredItems,
  openCompanyHub,
  resetCompanyHubForTests,
} from "./companyHubStore";
import { fetchHubItems, dismissHubItem, acknowledgeHubItem, actOnHubItem } from "./hubClient";

function makeItem(overrides: Partial<HubItem> = {}): HubItem {
  return {
    id: "item-1",
    type: "announcement",
    title: "Title",
    description: "Description",
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

describe("companyHubStore", () => {
  beforeEach(() => {
    resetCompanyHubForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetCompanyHubForTests();
  });

  it("openCompanyHub sets isOpen/mode synchronously and loads items async", async () => {
    let resolveFetch: (items: HubItem[]) => void = () => {};
    vi.mocked(fetchHubItems).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    openCompanyHub("checkin");

    expect(getCompanyHubSnapshot().isOpen).toBe(true);
    expect(getCompanyHubSnapshot().mode).toBe("checkin");
    expect(getCompanyHubSnapshot().loading).toBe(true);

    resolveFetch([makeItem()]);
    await vi.waitFor(() => expect(getCompanyHubSnapshot().loading).toBe(false));

    expect(getCompanyHubSnapshot().items).toHaveLength(1);
  });

  it("openCompanyHub surfaces a fetch failure as an error without leaving isOpen stuck loading", async () => {
    vi.mocked(fetchHubItems).mockRejectedValue(new Error("network down"));

    openCompanyHub("manual");
    await vi.waitFor(() => expect(getCompanyHubSnapshot().loading).toBe(false));

    expect(getCompanyHubSnapshot().error).toBe("network down");
    expect(getCompanyHubSnapshot().isOpen).toBe(true);
  });

  it("closeCompanyHub sets isOpen back to false", () => {
    openCompanyHub("manual");
    closeCompanyHub();
    expect(getCompanyHubSnapshot().isOpen).toBe(false);
  });

  it("hasBlockingRequiredItems is true only for a required item not yet acknowledged", () => {
    expect(
      hasBlockingRequiredItems([makeItem({ priority: "required", myStatus: "unseen" })]),
    ).toBe(true);
    expect(
      hasBlockingRequiredItems([makeItem({ priority: "required", myStatus: "acknowledged" })]),
    ).toBe(false);
    expect(hasBlockingRequiredItems([makeItem({ priority: "normal", myStatus: "unseen" })])).toBe(
      false,
    );
  });

  it("dismissItem/acknowledgeItem/actOnItem call the client and merge the returned item back in", async () => {
    vi.mocked(fetchHubItems).mockResolvedValue([makeItem({ myStatus: "unseen" })]);
    openCompanyHub("manual");
    await vi.waitFor(() => expect(getCompanyHubSnapshot().loading).toBe(false));

    vi.mocked(dismissHubItem).mockResolvedValue(makeItem({ myStatus: "dismissed" }));
    await dismissItem("item-1");
    expect(dismissHubItem).toHaveBeenCalledWith("item-1");
    expect(getCompanyHubSnapshot().items[0].myStatus).toBe("dismissed");

    vi.mocked(acknowledgeHubItem).mockResolvedValue(makeItem({ myStatus: "acknowledged" }));
    await acknowledgeItem("item-1");
    expect(acknowledgeHubItem).toHaveBeenCalledWith("item-1");
    expect(getCompanyHubSnapshot().items[0].myStatus).toBe("acknowledged");

    vi.mocked(actOnHubItem).mockResolvedValue(makeItem({ myActed: true }));
    await actOnItem("item-1");
    expect(actOnHubItem).toHaveBeenCalledWith("item-1");
    expect(getCompanyHubSnapshot().items[0].myActed).toBe(true);
  });
});
