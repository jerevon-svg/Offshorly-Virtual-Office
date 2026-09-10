import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./questsClient", () => ({
  fetchMyQuests: vi.fn(),
  fetchMyMissions: vi.fn(),
}));

import { fetchMyMissions, fetchMyQuests } from "./questsClient";
import { getClaimableCount, refreshClaimable, resetClaimableForTests } from "./claimableStore";

const quest = (over: Partial<{ completed: boolean; claimed: boolean }> = {}) =>
  ({ id: "q", completed: true, claimed: false, ...over }) as never;
const missions = (daily: unknown[], weekly: unknown[]) =>
  ({ daily: { missions: daily }, weekly: { missions: weekly } }) as never;

describe("claimableStore", () => {
  beforeEach(() => {
    resetClaimableForTests();
    vi.mocked(fetchMyQuests).mockReset();
    vi.mocked(fetchMyMissions).mockReset();
  });

  it("counts completed-but-unclaimed across Quests AND Missions", async () => {
    vi.mocked(fetchMyQuests).mockResolvedValue([quest(), quest(), quest({ claimed: true })]);
    vi.mocked(fetchMyMissions).mockResolvedValue(
      missions([quest(), quest({ completed: false })], [quest()]),
    );

    await refreshClaimable();
    expect(getClaimableCount()).toBe(4); // 2 quests + 1 daily + 1 weekly
  });

  it("counts Missions-only and Quests-only correctly", async () => {
    vi.mocked(fetchMyQuests).mockResolvedValue([]);
    vi.mocked(fetchMyMissions).mockResolvedValue(missions([quest()], []));
    await refreshClaimable();
    expect(getClaimableCount()).toBe(1);

    vi.mocked(fetchMyQuests).mockResolvedValue([quest()]);
    vi.mocked(fetchMyMissions).mockResolvedValue(missions([], []));
    await refreshClaimable();
    expect(getClaimableCount()).toBe(1);
  });

  it("drops to zero once everything is claimed", async () => {
    vi.mocked(fetchMyQuests).mockResolvedValue([quest()]);
    vi.mocked(fetchMyMissions).mockResolvedValue(missions([], []));
    await refreshClaimable();
    expect(getClaimableCount()).toBe(1);

    vi.mocked(fetchMyQuests).mockResolvedValue([quest({ claimed: true })]);
    await refreshClaimable();
    expect(getClaimableCount()).toBe(0);
  });

  it("keeps the last known count when both fetches fail", async () => {
    vi.mocked(fetchMyQuests).mockResolvedValue([quest()]);
    vi.mocked(fetchMyMissions).mockResolvedValue(missions([], []));
    await refreshClaimable();
    expect(getClaimableCount()).toBe(1);

    vi.mocked(fetchMyQuests).mockRejectedValue(new Error("offline"));
    vi.mocked(fetchMyMissions).mockRejectedValue(new Error("offline"));
    await refreshClaimable();
    expect(getClaimableCount()).toBe(1);
  });

  it("coalesces concurrent refreshes into one pair of requests", async () => {
    vi.mocked(fetchMyQuests).mockResolvedValue([quest()]);
    vi.mocked(fetchMyMissions).mockResolvedValue(missions([], []));

    await Promise.all([refreshClaimable(), refreshClaimable(), refreshClaimable()]);
    expect(vi.mocked(fetchMyQuests)).toHaveBeenCalledTimes(1);
  });
});
