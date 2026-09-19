// Phase 4A — the HOST's half of the coworker contract: React owns the subscriptions, the world owns the
// scene objects, and the roster is never allowed to block or break the world.
import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dHost } from "./Vo3dHost";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../../auth/currentUserStore";
import type { Vo3dCoworker } from "./coworkers";
import type { OfficePerson } from "../../../services/office/floorMerge";
import type { PeerMovementState } from "../../../services/presence/movementSync";

const WORLD_IMPORT_TIMEOUT = 10000;
const TEST_TIMEOUT = 20000;

type Push = { coworkers: readonly Vo3dCoworker[]; missingAvatar: readonly string[] | undefined };
const worlds: { dispose: ReturnType<typeof vi.fn>; pushes: Push[] }[] = [];

vi.mock("./world", async () => ({
  createVo3dWorld: () => {
    const pushes: Push[] = [];
    const world = {
      dispose: vi.fn(),
      restoreSelf: vi.fn(() => false),
      setOfficeAccess: vi.fn(),
      setOccupiedSeats: vi.fn(),
      setCoworkerInteractions: vi.fn(), subscribeViewMode: () => () => {}, subscribePlayerView: () => () => {}, setViewMode: vi.fn(), setPlayerView: vi.fn(), devToolsVisible: () => false, setDevToolsVisible: vi.fn(), setConversationPoses: vi.fn(), exitPlayerMode: vi.fn(), selectCoworkerByEmail: vi.fn(() => false), clearCoworkerSelection: vi.fn(), coworkerAnchor: vi.fn(() => null), approachCoworker: vi.fn(() => false),
      standUp: vi.fn(),
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

// Stands in for V1's movement store the same way, so a test can drive positions directly. The module is a
// singleton with its own socket; the point of the host's half is that it SUBSCRIBES to it and lets go on
// unmount, never that it connects.
vi.mock("../../../services/presence/movementSync", async () => {
  const react = await import("react");
  return {
    usePeerMovements: () => {
      react.useEffect(() => {
        movementSubscribers.count += 1;
        return () => {
          movementSubscribers.count -= 1;
        };
      }, []);
      return peerMovements;
    },
    useMovementSnapshotReady: () => snapshotReady,
    subscribeSeatRejected: () => () => {},
    // Phase 6A: the host reads V1's last-snapshot clock offset to say how far into a walk a peer is.
    // Zero here, so a test's `startedAt` is measured against the test's own clock.
    getServerClockOffsetMs: () => 0,
  };
});

let peerMovements: PeerMovementState[] = [];
let snapshotReady = false;
const movementSubscribers = { count: 0 };

/** One arrived/stable entry, as V1's store holds it. Positions are V1 sprite TOP-LEFT. */
function at(email: string, x: number, y: number, facing: PeerMovementState["stable"]["facing"] = "front"): PeerMovementState {
  return {
    email,
    revision: 3,
    stable: { pos: { x, y }, facing, state: "standing", seatKey: null, roomId: null },
    active: null,
  };
}

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
  movementSubscribers.count = 0;
  peerMovements = [];
  snapshotReady = false;
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

  it("holds every movement subscription only while it is mounted", async () => {
    people = [ALEX];
    const view = render(
      <StrictMode>
        <Vo3dHost />
      </StrictMode>,
    );
    await waitFor(() => expect(movementSubscribers.count).toBeGreaterThan(0), { timeout: WORLD_IMPORT_TIMEOUT });
    view.unmount();
    expect(movementSubscribers.count).toBe(0);
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

describe("Vo3dHost live positions (Phase 4B)", () => {
  it("keeps Phase 4A's derived desks until V1's first positions_snapshot arrives", async () => {
    people = [ALEX];
    // A position is already in the store and is deliberately NOT believed yet — an empty store and an
    // office where nobody has ever moved look identical, so the flag is the only honest signal.
    peerMovements = [at("alex@offshorly.com", 0, 0)];
    snapshotReady = false;
    render(<Vo3dHost />);
    await waitFor(() => expect(lastPush().coworkers).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    expect(lastPush().coworkers[0].posSource).toBe("desk");
    expect(screen.getByTestId("vo3d-coworkers").getAttribute("data-snapshot-ready")).toBe("false");
    expect(screen.getByTestId("vo3d-coworkers").getAttribute("data-live-positions")).toBe("0");
  }, TEST_TIMEOUT);

  it("stands a coworker where V1 last saw them stop, converted through their OWN box", async () => {
    people = [ALEX];
    peerMovements = [at("alex@offshorly.com", 300, 400)];
    snapshotReady = true;
    render(<Vo3dHost />);
    await waitFor(() => expect(lastPush().coworkers[0]?.posSource).toBe("live"), { timeout: WORLD_IMPORT_TIMEOUT });
    const pushed = lastPush().coworkers[0];
    expect(pushed.point).toEqual({ x: 300 + pushed.box.width / 2, z: 400 + pushed.box.height / 2 });
    expect(screen.getByTestId("vo3d-coworkers").getAttribute("data-live-positions")).toBe("1");
    expect(screen.getByTestId("vo3d-coworkers").getAttribute("data-snapshot-ready")).toBe("true");
  }, TEST_TIMEOUT);

  it("leaves everyone V1 holds no position for on their derived desk", async () => {
    people = [ALEX, MICAH];
    peerMovements = [at("alex@offshorly.com", 300, 400)];
    snapshotReady = true;
    render(<Vo3dHost />);
    await waitFor(() => expect(lastPush().coworkers).toHaveLength(2), { timeout: WORLD_IMPORT_TIMEOUT });
    const bySource = Object.fromEntries(lastPush().coworkers.map((c) => [c.email, c.posSource]));
    expect(bySource).toEqual({ "alex@offshorly.com": "live", "micah@offshorly.com": "desk" });
    expect(screen.getByTestId("vo3d-coworkers").getAttribute("data-live-positions")).toBe("1");
  }, TEST_TIMEOUT);

  // THE ORDERING GUARANTEE. employee_positions is not attendance-gated and keeps a stale row for somebody
  // who checked out hours ago, so a position applied before V1's filters would put them back at a desk.
  it("NEVER resurrects a checked-out employee from stale movement data", async () => {
    people = [ALEX, { ...MICAH, status: "OFFLINE" }];
    peerMovements = [at("micah@offshorly.com", 100, 100), at("alex@offshorly.com", 300, 400)];
    snapshotReady = true;
    render(<Vo3dHost />);
    await waitFor(() => expect(lastPush().coworkers).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    // Micah has a perfectly usable live position and is still absent, because V1's offline predicate ran
    // FIRST and dropped him. The position can only ever move somebody the roster already yielded.
    expect(lastPush().coworkers.map((c) => c.email)).toEqual(["alex@offshorly.com"]);
    expect(screen.getByTestId("vo3d-coworkers").getAttribute("data-live-positions")).toBe("1");
  }, TEST_TIMEOUT);

  it("never gives the signed-in employee a second body, however much they have moved", async () => {
    setCurrentUserFromMeResponse({ id: "atlas-1", email: "micah@offshorly.com", full_name: "Micah", role: "", team: null });
    people = [ALEX, MICAH];
    peerMovements = [at("micah@offshorly.com", 100, 100), at("alex@offshorly.com", 300, 400)];
    snapshotReady = true;
    render(<Vo3dHost />);
    await waitFor(() => expect(lastPush().coworkers).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    expect(lastPush().coworkers[0].email).toBe("alex@offshorly.com");
  }, TEST_TIMEOUT);

  it("ignores a position that is not a place, and keeps that person's desk", async () => {
    people = [ALEX];
    peerMovements = [at("alex@offshorly.com", NaN, 400)];
    snapshotReady = true;
    render(<Vo3dHost />);
    await waitFor(() => expect(lastPush().coworkers).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    expect(lastPush().coworkers[0].posSource).toBe("desk");
    expect(screen.getByTestId("vo3d-coworkers").getAttribute("data-live-positions")).toBe("0");
  }, TEST_TIMEOUT);

  // A DISCONNECT IS NOT A MOVE. movementSync never prunes its map — there is no disconnect handler and no
  // eviction — so a dropped socket simply stops delivering. The last known position must stay on screen: a
  // network blip that teleported a roomful of people back to their desks would be worse than stale data.
  it("keeps the last known position when the feed stops delivering", async () => {
    people = [ALEX];
    peerMovements = [at("alex@offshorly.com", 300, 400)];
    snapshotReady = true;
    const view = render(<Vo3dHost />);
    await waitFor(() => expect(lastPush().coworkers[0]?.posSource).toBe("live"), { timeout: WORLD_IMPORT_TIMEOUT });
    const before = lastPush().coworkers[0].point;
    // The store holds its last state across a disconnect; a roster refetch re-renders over the top of it.
    people = [{ ...ALEX }];
    view.rerender(<Vo3dHost />);
    await waitFor(() => expect(lastPush().coworkers[0]?.posSource).toBe("live"));
    expect(lastPush().coworkers[0].point).toEqual(before);
  }, TEST_TIMEOUT);

  it("carries a person's recorded arrival facing instead of the chair's direction", async () => {
    people = [ALEX];
    peerMovements = [at("alex@offshorly.com", 300, 400, "back")];
    snapshotReady = true;
    render(<Vo3dHost />);
    await waitFor(() => expect(lastPush().coworkers[0]?.posSource).toBe("live"), { timeout: WORLD_IMPORT_TIMEOUT });
    expect(lastPush().coworkers[0].facing).toBe("north");
  }, TEST_TIMEOUT);
});
