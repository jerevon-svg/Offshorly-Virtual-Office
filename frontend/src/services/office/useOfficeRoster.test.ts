import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useOfficeRoster } from "./useOfficeRoster";
import { officeService } from "./index";
import { openPresenceStream, type PresenceStreamHandlers } from "./presenceStream";
import type { FloorPerson, Presence } from "./types";

// Real-mode stale-roster fix (2026-08-29): a presence_update for an email
// the one-time /floor snapshot never contained used to be a dead letter
// (mergeFloorWithPresence is floor.map). The hook now refetches /floor once
// per unknown email, deduplicated + cooled down. These tests drive the hook
// with a captured SSE handler set and a mocked officeService.

vi.mock("./index", () => ({
  officeService: {
    getFloor: vi.fn(),
    getPresence: vi.fn(),
    listRooms: vi.fn(),
  },
}));

vi.mock("./presenceStream", () => ({
  openPresenceStream: vi.fn(),
}));

function floorPerson(overrides: Partial<FloorPerson> = {}): FloorPerson {
  return {
    user_email: "jerevon@offshorly.com",
    display_name: "Bon",
    status: "OFFLINE",
    department_name: "dev-team",
    team_room_id: null,
    current_room_id: null,
    source: "test",
    current_activity: null,
    job_title: null,
    ...overrides,
  };
}

function presenceRow(overrides: Partial<Presence> = {}): Presence {
  return {
    user_email: "jerevon@offshorly.com",
    full_name: "Bon",
    photo_url: null,
    job_title: null,
    department_name: "dev-team",
    status: "ONLINE",
    source: "cliq",
    current_room_id: null,
    avatar_x: null,
    avatar_y: null,
    checked_in_at: null,
    last_seen_at: null,
    current_activity: null,
    ...overrides,
  };
}

const BON = floorPerson();
const ALEX = floorPerson({ user_email: "alex@offshorly.com", display_name: "Alex" });
const MICAH = floorPerson({ user_email: "micah@offshorly.com", display_name: "Micah" });

let handlers: PresenceStreamHandlers | null = null;
const streamClose = vi.fn();

function emailsOf(people: { email: string }[]): string[] {
  return people.map((p) => p.email.toLowerCase()).sort();
}

async function renderRoster(initialFloor: FloorPerson[] = [BON, ALEX]) {
  vi.mocked(officeService.getFloor).mockResolvedValueOnce(initialFloor);
  vi.mocked(officeService.getPresence).mockResolvedValue([]);
  vi.mocked(officeService.listRooms).mockResolvedValue([]);
  const hook = renderHook(() => useOfficeRoster());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await waitFor(() => expect(handlers).not.toBeNull());
  expect(officeService.getFloor).toHaveBeenCalledTimes(1);
  return hook;
}

beforeEach(() => {
  vi.stubEnv("VITE_OFFICE_INTEGRATION_MODE", "real");
  handlers = null;
  vi.mocked(openPresenceStream).mockImplementation((h) => {
    handlers = h;
    return { close: streamClose };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(officeService.getFloor).mockReset();
  vi.mocked(officeService.getPresence).mockReset();
  vi.mocked(officeService.listRooms).mockReset();
});

describe("useOfficeRoster real-mode unknown-email floor refetch", () => {
  it("1. known-email presence update patches the roster without a /floor refetch", async () => {
    const hook = await renderRoster();
    act(() => handlers!.onPresence(presenceRow({ user_email: "alex@offshorly.com", status: "ONLINE" })));
    await waitFor(() => {
      const alex = hook.result.current.people.find((p) => p.email === "alex@offshorly.com");
      expect(alex?.status).toBe("ONLINE");
    });
    expect(officeService.getFloor).toHaveBeenCalledTimes(1);
    expect(emailsOf(hook.result.current.people)).toEqual(["alex@offshorly.com", "jerevon@offshorly.com"]);
  });

  it("2. unknown-email presence update triggers exactly one /floor refetch", async () => {
    const hook = await renderRoster();
    vi.mocked(officeService.getFloor).mockResolvedValueOnce([BON, ALEX, MICAH]);
    act(() => handlers!.onPresence(presenceRow({ user_email: "micah@offshorly.com" })));
    await waitFor(() => expect(officeService.getFloor).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(emailsOf(hook.result.current.people)).toContain("micah@offshorly.com"));
    expect(officeService.getFloor).toHaveBeenCalledTimes(2);
    // /presence is NOT refetched — the live presence state already holds the event.
    expect(officeService.getPresence).toHaveBeenCalledTimes(1);
  });

  it("3. a refetched floor that now contains the employee adds them, merged with their live presence", async () => {
    const hook = await renderRoster();
    vi.mocked(officeService.getFloor).mockResolvedValueOnce([BON, ALEX, MICAH]);
    act(() => handlers!.onPresence(presenceRow({ user_email: "micah@offshorly.com", status: "ONLINE", current_activity: "typing" })));
    await waitFor(() => expect(emailsOf(hook.result.current.people)).toEqual(["alex@offshorly.com", "jerevon@offshorly.com", "micah@offshorly.com"]));
    const micah = hook.result.current.people.find((p) => p.email === "micah@offshorly.com")!;
    expect(micah.displayName).toBe("Micah"); // identity from /floor
    expect(micah.status).toBe("ONLINE"); // live fields from the presence event
    expect(micah.currentActivity).toBe("typing");
    expect(micah.avatarId).toBe("micah");
  });

  it("4. repeated unknown events while a refetch is in flight share that single request", async () => {
    const hook = await renderRoster();
    let resolveFloor!: (rows: FloorPerson[]) => void;
    vi.mocked(officeService.getFloor).mockImplementationOnce(
      () => new Promise<FloorPerson[]>((resolve) => { resolveFloor = resolve; }),
    );
    act(() => {
      handlers!.onPresence(presenceRow({ user_email: "micah@offshorly.com" }));
      handlers!.onPresence(presenceRow({ user_email: "micah@offshorly.com", status: "AWAY" }));
      handlers!.onPresence(presenceRow({ user_email: "lui@offshorly.com" }));
      handlers!.onPresence(presenceRow({ user_email: "micah@offshorly.com" }));
    });
    expect(officeService.getFloor).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveFloor([BON, ALEX, MICAH]);
    });
    await waitFor(() => expect(emailsOf(hook.result.current.people)).toContain("micah@offshorly.com"));
    expect(officeService.getFloor).toHaveBeenCalledTimes(2);
  });

  it("5. an employee Atlas still does not list is not fabricated from their presence row", async () => {
    const hook = await renderRoster();
    vi.mocked(officeService.getFloor).mockResolvedValueOnce([BON, ALEX]); // still no micah
    act(() => handlers!.onPresence(presenceRow({ user_email: "micah@offshorly.com" })));
    await waitFor(() => expect(officeService.getFloor).toHaveBeenCalledTimes(2));
    // Let the refetch settle, then assert the roster is unchanged.
    await waitFor(() => expect(hook.result.current.presenceCount).toBe(1));
    expect(emailsOf(hook.result.current.people)).toEqual(["alex@offshorly.com", "jerevon@offshorly.com"]);
    expect(hook.result.current.floorCount).toBe(2);
  });

  it("6. cooldown: a still-absent email does not refetch again until the cooldown elapses", async () => {
    const base = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(base);
    const hook = await renderRoster();
    vi.mocked(officeService.getFloor).mockResolvedValue([BON, ALEX]); // never lists micah
    act(() => handlers!.onPresence(presenceRow({ user_email: "micah@offshorly.com" })));
    await waitFor(() => expect(officeService.getFloor).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.presenceCount).toBe(1));

    // Within the cooldown window: repeated unknown events for the same email are ignored.
    nowSpy.mockReturnValue(base + 30_000);
    act(() => {
      handlers!.onPresence(presenceRow({ user_email: "micah@offshorly.com" }));
      handlers!.onPresence(presenceRow({ user_email: "micah@offshorly.com", status: "AWAY" }));
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(officeService.getFloor).toHaveBeenCalledTimes(2);

    // After the cooldown: one more refetch is allowed.
    nowSpy.mockReturnValue(base + 61_000);
    act(() => handlers!.onPresence(presenceRow({ user_email: "micah@offshorly.com" })));
    await waitFor(() => expect(officeService.getFloor).toHaveBeenCalledTimes(3));
    expect(emailsOf(hook.result.current.people)).toEqual(["alex@offshorly.com", "jerevon@offshorly.com"]);
  });

  it("7. case/whitespace differences match the normalized roster and never create duplicates", async () => {
    const hook = await renderRoster();
    // Known employee under a different case: no refetch, one row.
    act(() => handlers!.onPresence(presenceRow({ user_email: " Alex@Offshorly.com ", status: "ONLINE" })));
    await waitFor(() => {
      const alex = hook.result.current.people.find((p) => p.email.toLowerCase() === "alex@offshorly.com");
      expect(alex?.status).toBe("ONLINE");
    });
    expect(officeService.getFloor).toHaveBeenCalledTimes(1);
    expect(emailsOf(hook.result.current.people)).toEqual(["alex@offshorly.com", "jerevon@offshorly.com"]);

    // Unknown employee arrives mixed-case; /floor returns them lowercase: one row, one refetch.
    vi.mocked(officeService.getFloor).mockResolvedValueOnce([BON, ALEX, MICAH]);
    act(() => handlers!.onPresence(presenceRow({ user_email: "Micah@Offshorly.com" })));
    await waitFor(() => expect(emailsOf(hook.result.current.people)).toContain("micah@offshorly.com"));
    act(() => handlers!.onPresence(presenceRow({ user_email: "MICAH@offshorly.com", status: "AWAY" })));
    await waitFor(() => {
      const micah = hook.result.current.people.find((p) => p.email.toLowerCase() === "micah@offshorly.com");
      expect(micah?.status).toBe("AWAY");
    });
    expect(officeService.getFloor).toHaveBeenCalledTimes(2);
    expect(hook.result.current.people.filter((p) => p.email.toLowerCase() === "micah@offshorly.com")).toHaveLength(1);
  });

  it("8. SSE reconnect behavior is unchanged: onConnected resyncs /floor + /presence and flips live; onError flips it back", async () => {
    const hook = await renderRoster();
    expect(hook.result.current.live).toBe(false);
    vi.mocked(officeService.getFloor).mockResolvedValueOnce([BON, ALEX, MICAH]);
    act(() => handlers!.onConnected!());
    await waitFor(() => expect(hook.result.current.live).toBe(true));
    await waitFor(() => expect(officeService.getFloor).toHaveBeenCalledTimes(2));
    expect(officeService.getPresence).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(emailsOf(hook.result.current.people)).toContain("micah@offshorly.com"));
    act(() => handlers!.onError!(new Error("stream dropped")));
    expect(hook.result.current.live).toBe(false);
    hook.unmount();
    expect(streamClose).toHaveBeenCalled();
  });
});
