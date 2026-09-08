// REGRESSION GUARD for the continuous 401 stream (2026-09-08):
//   GET /badges/me -> 401, GET /notifications/me -> 401, GET /progression/me -> 401, repeating.
//
// Those three endpoints are fetched by the only two always-on surfaces that re-ask on every
// mount, tab focus and `online` event (PlayerHud -> progression + badges, NotificationCenter ->
// notifications). Neither client had an identity PRECONDITION: with no dev identity seeded and no
// bearer token in storage, `if (token) headers.set(...)` simply omitted the header and the request
// went out bare. The backend answered 401, nothing recorded that the credential was missing, and
// the next trigger did it again — one lost identity became an endless stream of unauthenticated
// requests.
//
// The fix refuses locally instead: no credential, no request. These tests pin exactly that, in
// both directions, so the authenticated paths can never be broken by the guard.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("socket.io-client", () => ({ io: () => ({ on: () => {}, disconnect: () => {} }) }));

function stubStorage(token: string | null) {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k === "token" ? token : null),
    setItem: () => {},
    removeItem: () => {},
  });
}

describe("no identity means no request", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("notifications: refuses to fetch with neither a dev identity nor a token", async () => {
    stubStorage(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("./notificationsClient");
    await expect(client.fetchNotifications()).rejects.toThrow(/Not signed in/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("notifications: a failed refresh does not arm a retry — the store just records the error", async () => {
    stubStorage(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const store = await import("./notificationsStore");
    await store.refreshNotifications();
    // Two more triggers (a focus and an `online` would each call this) still send nothing.
    await store.refreshNotifications();
    await store.refreshNotifications();
    expect(fetchMock).not.toHaveBeenCalled();
    const snapshot = store.getNotificationsSnapshot();
    expect(snapshot.loading).toBe(false);
    expect(snapshot.error).toMatch(/Not signed in/);
  });

  it("progression + badges: refuse to fetch with neither a dev identity nor a token", async () => {
    stubStorage(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = await import("../quests/questsClient");
    await expect(client.fetchMyProgression()).rejects.toThrow(/Not signed in/);
    await expect(client.fetchMyBadges()).rejects.toThrow(/Not signed in/);
    await expect(client.fetchMyQuests()).rejects.toThrow(/Not signed in/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("progression store: repeated refreshes stay silent instead of re-issuing 401s", async () => {
    stubStorage(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const store = await import("../quests/progressionStore");
    await store.refreshProgression();
    await store.refreshBadges();
    await store.refreshProgression();
    await store.refreshBadges();
    expect(fetchMock).not.toHaveBeenCalled();
    // Balances are decorative — a missing identity must not break the surface.
    expect(store.getProgressionSnapshot().progression).toBeNull();
  });

  it("a seeded dev identity still sends x-dev-email on all four quest/progression endpoints", async () => {
    stubStorage(null);
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push((init.headers as Headers).get("x-dev-email") ?? "");
        return { ok: true, status: 200, json: async () => ({ quests: [], badges: [] }) } as Response;
      }),
    );

    const client = await import("../quests/questsClient");
    client.setDevIdentity("Alex@Offshorly.com");
    await client.fetchMyQuests();
    await client.fetchMyProgression();
    await client.fetchMyBadges();
    await client.fetchMyMissions();
    expect(calls).toEqual([
      "alex@offshorly.com",
      "alex@offshorly.com",
      "alex@offshorly.com",
      "alex@offshorly.com",
    ]);
  });

  it("production bearer auth is unchanged — a token alone is enough", async () => {
    stubStorage("atlas-jwt");
    const headers: (Headers | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        headers.push(init.headers as Headers);
        return { ok: true, status: 200, json: async () => ({ quests: [] }) } as Response;
      }),
    );

    const client = await import("../quests/questsClient");
    await client.fetchMyProgression();
    expect(headers[0]?.get("Authorization")).toBe("Bearer atlas-jwt");
    expect(headers[0]?.get("x-dev-email")).toBeNull();
  });
});
