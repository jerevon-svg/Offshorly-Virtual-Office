// Phase 4A — the HOST's half of the coworker contract: React owns the subscriptions, the world owns the
// scene objects, and the roster is never allowed to block or break the world.
import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dHost } from "./Vo3dHost";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../../auth/currentUserStore";
import type { Vo3dCoworker } from "./coworkers";
import type { OfficePerson } from "../../../services/office/floorMerge";

const WORLD_IMPORT_TIMEOUT = 10000;
const TEST_TIMEOUT = 20000;

type Push = { coworkers: readonly Vo3dCoworker[]; missingAvatar: readonly string[] | undefined };
const worlds: { dispose: ReturnType<typeof vi.fn>; pushes: Push[] }[] = [];

vi.mock("./world", async () => ({
  createVo3dWorld: () => {
    const pushes: Push[] = [];
    const world = {
      dispose: vi.fn(),
      setCoworkers: (coworkers: readonly Vo3dCoworker[], missingAvatar?: readonly string[]) => {
        pushes.push({ coworkers, missingAvatar });
      },
      pushes,
    };
    worlds.push(world);
    return world;
  },
}));

// The roster hook is mocked (not the service) so a test can drive the roster directly — the JOIN itself
// is tested against the real tables in coworkers.phase4.test.ts, and re-testing it here would prove the
// same thing twice while making these lifecycle tests depend on a fetch.
let people: OfficePerson[] = [];
let rosterError: Error | null = null;
const rosterSubscribers = { count: 0 };

vi.mock("../../../services/office/useOfficeRoster", () => ({
  useOfficeRoster: () => ({
    people,
    loading: false,
    error: rosterError,
    live: true,
    roomNames: new Map(),
    floorCount: people.length,
    presenceCount: people.length,
  }),
}));

// Stands in for the offline-lineup socket so the test can assert the host SUBSCRIBES and UNSUBSCRIBES,
// which is the leak this phase could plausibly introduce.
vi.mock("../../../services/presence/offlineLineupClient", async () => {
  const react = await import("react");
  return {
    useOfflineLineup: () => {
      react.useEffect(() => {
        rosterSubscribers.count += 1;
        return () => {
          rosterSubscribers.count -= 1;
        };
      }, []);
      return [];
    },
  };
});

function person(email: string, avatarId: string | null, displayName: string, roomId = "design-team"): OfficePerson {
  return {
    email, displayName, status: "ONLINE", departmentName: "Design", jobTitle: null,
    currentActivity: null, lastMessage: null, avatarId, roomId, atlasRoomId: null, inEphemeralRoom: false,
  };
}

const ALEX = person("alex@offshorly.com", "alex", "Alex", "executive-team");
const MICAH = person("micah@offshorly.com", "micah", "Micah");
const LUI = person("lui@offshorly.com", "lui", "Lui", "dev-team");

beforeEach(() => {
  worlds.length = 0;
  people = [];
  rosterError = null;
  rosterSubscribers.count = 0;
  resetCurrentUserForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  resetCurrentUserForTests();
  vi.restoreAllMocks();
});

/** The latest roster the host pushed into the world it built. */
function lastPush(index = 0): Push {
  const pushes = worlds[index].pushes;
  return pushes[pushes.length - 1];
}

describe("Vo3dHost coworkers (Phase 4A)", () => {
  it("pushes the resolved roster into the world it just built", async () => {
    people = [ALEX, MICAH];
    render(<Vo3dHost />);
    await waitFor(() => expect(worlds).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    await waitFor(() => expect(lastPush().coworkers).toHaveLength(2));
    expect(lastPush().coworkers.map((c) => c.email)).toEqual(["alex@offshorly.com", "micah@offshorly.com"]);
  }, TEST_TIMEOUT);

  it("never hands the world a body for the signed-in employee", async () => {
    setCurrentUserFromMeResponse({ id: "atlas-1", email: "micah@offshorly.com", full_name: "Micah", role: "", team: null });
    people = [ALEX, MICAH];
    render(<Vo3dHost />);
    await waitFor(() => expect(worlds).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    await waitFor(() => expect(lastPush().coworkers).toHaveLength(1));
    expect(lastPush().coworkers.map((c) => c.email)).toEqual(["alex@offshorly.com"]);
  }, TEST_TIMEOUT);

  it("reports an employee V1 lists but V2 cannot draw, rather than shrinking the office silently", async () => {
    people = [ALEX, LUI];
    render(<Vo3dHost />);
    await waitFor(() => expect(worlds).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    const readout = await screen.findByTestId("vo3d-coworkers");
    expect(readout.getAttribute("data-count")).toBe("1");
    expect(readout.getAttribute("data-missing-avatar")).toBe("1");
    expect(lastPush().missingAvatar).toEqual(["Lui"]);
  }, TEST_TIMEOUT);

  it("STILL OPENS THE WORLD when the roster fails — an outage is not a broken preview", async () => {
    rosterError = new Error("/office/floor is down");
    people = [];
    render(<Vo3dHost />);
    await waitFor(() => expect(worlds).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    // The world is ready and explorable; the readout says why it is empty rather than claiming an
    // empty office.
    const readout = await screen.findByTestId("vo3d-coworkers");
    expect(readout.getAttribute("data-roster-error")).toBe("true");
    expect(readout.getAttribute("data-count")).toBe("0");
    expect(screen.getByRole("button", { name: /back to v1/i })).toBeInTheDocument();
  }, TEST_TIMEOUT);

  it("adds and removes bodies as the roster changes, without rebuilding the world", async () => {
    people = [ALEX];
    const { rerender } = render(<Vo3dHost />);
    await waitFor(() => expect(worlds).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    await waitFor(() => expect(lastPush().coworkers).toHaveLength(1));

    people = [ALEX, MICAH];
    rerender(<Vo3dHost />);
    await waitFor(() => expect(lastPush().coworkers).toHaveLength(2));

    people = [MICAH];
    rerender(<Vo3dHost />);
    await waitFor(() => expect(lastPush().coworkers.map((c) => c.email)).toEqual(["micah@offshorly.com"]));

    // ONE world throughout: a roster change must never cost a renderer.
    expect(worlds).toHaveLength(1);
    expect(worlds[0].dispose).not.toHaveBeenCalled();
  }, TEST_TIMEOUT);

  it("leaves no subscription behind on unmount, including under StrictMode", async () => {
    people = [ALEX, MICAH];
    const { unmount, container } = render(
      <StrictMode>
        <Vo3dHost />
      </StrictMode>,
    );
    await waitFor(() => expect(worlds.length).toBeGreaterThan(0), { timeout: WORLD_IMPORT_TIMEOUT });
    expect(rosterSubscribers.count).toBeGreaterThan(0);

    unmount();

    expect(rosterSubscribers.count).toBe(0);
    expect(container.querySelectorAll("canvas")).toHaveLength(0);
    for (const world of worlds) expect(world.dispose).toHaveBeenCalled();
  }, TEST_TIMEOUT);

  it("does not push a roster into a world that has already been disposed", async () => {
    people = [ALEX];
    const { unmount } = render(<Vo3dHost />);
    await waitFor(() => expect(worlds).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    unmount();
    const pushesAtUnmount = worlds[0].pushes.length;

    people = [ALEX, MICAH];
    // Nothing is rendering any more, so nothing may reach the disposed world.
    expect(worlds[0].pushes).toHaveLength(pushesAtUnmount);
  }, TEST_TIMEOUT);
});
