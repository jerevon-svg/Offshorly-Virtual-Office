// Phase 5 — the HOST's half: the sink is built per mount from the identity V1 already had, handed to the
// world as a value, and V1's own persisted position is pushed in as a ONE-SHOT restore.
//
// The world is mocked, so nothing here asserts what a body does — that is the feed's and the adapter's
// job, and both have their own tests. What is asserted is the wiring, which is exactly what a React host
// can get wrong: publishing with no identity, restoring twice, restoring after the player has moved, or
// never restoring at all because the snapshot landed while the world module was still loading.
import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dHost } from "./Vo3dHost";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../../auth/currentUserStore";
import type { PeerMovementState } from "../../../services/presence/movementSync";
import type { Facing, Vec2 } from "../core/coords";

const WORLD_IMPORT_TIMEOUT = 10000;
const TEST_TIMEOUT = 20000;

type Restore = { point: Vec2; facing: Facing };
const worlds: { restores: Restore[]; access: unknown[]; sink: unknown; dispose: ReturnType<typeof vi.fn> }[] = [];
/** What the next mocked world will answer from restoreSelf — the real one refuses for several reasons. */
let restoreAccepts = true;

vi.mock("./world", async () => ({
  createVo3dWorld: (_canvas: unknown, _identity: unknown, _homeDesk: unknown, selfMovement: unknown) => {
    const restores: Restore[] = [];
    const access: unknown[] = [];
    const world = {
      dispose: vi.fn(),
      setCoworkers: vi.fn(),
      setOfficeAccess: (a: unknown) => { access.push(a); },
      setOccupiedSeats: vi.fn(),
      standUp: vi.fn(),
      access,
      restoreSelf: (point: Vec2, facing: Facing) => {
        restores.push({ point, facing });
        return restoreAccepts;
      },
      restores,
      sink: selfMovement,
    };
    worlds.push(world);
    return world;
  },
}));

vi.mock("../../../services/office/useOfficeRoster", () => ({
  useOfficeRoster: () => ({
    people: [], loading: false, error: null, live: true,
    roomNames: new Map(), floorCount: 0, presenceCount: 0,
  }),
}));

vi.mock("../../../services/presence/offlineLineupClient", () => ({ useOfflineLineup: () => [] }));

// V1's attendance service — the ONE authority over the working-office boundary. Mocked at the service, not
// at the adapter, so the host is exercised through the real read path.
let attendanceStatus: string | null = "CHECKED_IN";
let attendanceFails = false;
vi.mock("../../../services/attendance", () => ({
  attendanceService: {
    getMine: () => (attendanceFails ? Promise.reject(new Error("network")) : Promise.resolve({ status: attendanceStatus })),
    checkIn: vi.fn(),
    checkOut: vi.fn(),
  },
}));

// The movement module is V1's singleton socket. Only the two hooks the host subscribes through are
// stubbed; the emit functions are left real because nothing in these tests drives the feed (the world is
// mocked), and stubbing them would hide a wiring mistake rather than expose one.
vi.mock("../../../services/presence/movementSync", async () => {
  const actual = await vi.importActual<typeof import("../../../services/presence/movementSync")>(
    "../../../services/presence/movementSync",
  );
  return {
    ...actual,
    usePeerMovements: () => peerMovements,
    useMovementSnapshotReady: () => snapshotReady,
    subscribeSeatRejected: () => () => {},
  };
});

let peerMovements: PeerMovementState[] = [];
let snapshotReady = false;

const BON_EMAIL = "jerevon@offshorly.com";

function signIn(email = BON_EMAIL) {
  setCurrentUserFromMeResponse({ id: "atlas-1", email, full_name: "Bon", role: "dev", team: null });
}

/** One arrived/stable row, as V1's store holds it. Positions are V1 sprite TOP-LEFT. */
function at(email: string, x: number, y: number, facing: PeerMovementState["stable"]["facing"] = "front"): PeerMovementState {
  return { email, revision: 3, stable: { pos: { x, y }, facing, state: "standing", seatKey: null, roomId: null }, active: null };
}

beforeEach(() => {
  worlds.length = 0;
  peerMovements = [];
  snapshotReady = false;
  restoreAccepts = true;
  attendanceStatus = "CHECKED_IN";
  attendanceFails = false;
  resetCurrentUserForTests();
});
afterEach(() => {
  resetCurrentUserForTests();
  vi.unstubAllEnvs();
});

const ready = () => waitFor(() => expect(screen.getByTestId("vo3d-self-movement")).toBeInTheDocument(), { timeout: WORLD_IMPORT_TIMEOUT });

describe("publishing", () => {
  it("hands the world a sink, and says so, for a real signed-in employee", async () => {
    signIn();
    render(<Vo3dHost />);
    await ready();
    expect(screen.getByTestId("vo3d-self-movement").getAttribute("data-publishing")).toBe("true");
    expect(worlds[0].sink).not.toBeNull();
    expect(worlds[0].sink).toBeDefined();
  }, TEST_TIMEOUT);

  it("hands the world NOTHING when V1 could not parse an identity", async () => {
    // The standalone case: no employee, so no movement leaves the browser. It must not fall back to Bon.
    render(<Vo3dHost />);
    await ready();
    expect(screen.getByTestId("vo3d-self-movement").getAttribute("data-publishing")).toBe("false");
    expect(worlds[0].sink).toBeUndefined();
  }, TEST_TIMEOUT);
});

describe("the V1 position restore", () => {
  it("does not restore before V1's first positions_snapshot", async () => {
    signIn();
    peerMovements = [at(BON_EMAIL, 600, 500)];
    snapshotReady = false;
    render(<Vo3dHost />);
    await ready();
    expect(worlds[0].restores).toEqual([]);
    expect(screen.getByTestId("vo3d-self-movement").getAttribute("data-restored")).toBe("false");
  }, TEST_TIMEOUT);

  it("restores from V1's own row once the snapshot has arrived, converted to a CENTRE point", async () => {
    signIn();
    peerMovements = [at(BON_EMAIL, 600, 500, "back")];
    snapshotReady = true;
    render(<Vo3dHost />);
    await ready();
    await waitFor(() => expect(worlds[0].restores).toHaveLength(1));
    // bon's own manifest box halves, and V1's "back" in V2's vocabulary.
    expect(worlds[0].restores[0].point.x).toBeCloseTo(600 + 26.23 / 2, 2);
    expect(worlds[0].restores[0].point.z).toBeCloseTo(500 + 37.2 / 2, 2);
    expect(worlds[0].restores[0].facing).toBe("north");
    expect(screen.getByTestId("vo3d-self-movement").getAttribute("data-restored")).toBe("true");
  }, TEST_TIMEOUT);

  it("does not restore from somebody else's row", async () => {
    signIn();
    peerMovements = [at("micah@offshorly.com", 600, 500)];
    snapshotReady = true;
    render(<Vo3dHost />);
    await ready();
    expect(worlds[0].restores).toEqual([]);
  }, TEST_TIMEOUT);

  it("reports NOT restored when the world refuses the position", async () => {
    // A persisted point with nothing standable near it: the world keeps the desk preview and says so,
    // rather than dropping a body inside the furniture.
    signIn();
    restoreAccepts = false;
    peerMovements = [at(BON_EMAIL, 600, 500)];
    snapshotReady = true;
    render(<Vo3dHost />);
    await ready();
    await waitFor(() => expect(worlds[0].restores).toHaveLength(1));
    expect(screen.getByTestId("vo3d-self-movement").getAttribute("data-restored")).toBe("false");
  }, TEST_TIMEOUT);

  it("survives StrictMode's mount → cleanup → mount without leaking a world", async () => {
    signIn();
    peerMovements = [at(BON_EMAIL, 600, 500)];
    snapshotReady = true;
    const view = render(
      <StrictMode>
        <Vo3dHost />
      </StrictMode>,
    );
    await ready();
    // Every world that DOES get built under the double-invoke gets its own sink, resolved per mount —
    // never one captured at import time. (Only one is built here: the memoised world-module import
    // resolves after StrictMode's cleanup, and that run's `cancelled` guard drops the build.)
    await waitFor(() => expect(worlds.length).toBeGreaterThanOrEqual(1));
    for (const w of worlds) expect(w.sink).toBeDefined();
    for (const w of worlds) expect(w.restores).toHaveLength(1);
    view.unmount();
    for (const w of worlds) expect(w.dispose).toHaveBeenCalled();
  }, TEST_TIMEOUT);
});

describe("the working-office boundary (V1 attendance)", () => {
  it("pushes V1's answer into the world, and pushes it BEFORE attempting the restore", async () => {
    signIn();
    peerMovements = [at(BON_EMAIL, 600, 500)];
    snapshotReady = true;
    render(<Vo3dHost />);
    await ready();
    await waitFor(() => expect(worlds[0].access).toContain("permitted"));
    // The very first push is the access answer the world was built with; the restore follows it, so a
    // checked-in employee lands on their own desk on the first attempt.
    expect(worlds[0].access.length).toBeGreaterThan(0);
    expect(worlds[0].restores).toHaveLength(1);
    expect(screen.getByTestId("vo3d-self-movement").getAttribute("data-office-access")).toBe("permitted");
  }, TEST_TIMEOUT);

  it("reports a confirmed checkout as denied", async () => {
    signIn();
    attendanceStatus = "CHECKED_OUT";
    render(<Vo3dHost />);
    await ready();
    await waitFor(() =>
      expect(screen.getByTestId("vo3d-self-movement").getAttribute("data-office-access")).toBe("denied"),
    );
    await waitFor(() => expect(worlds[0].access).toContain("denied"));
  }, TEST_TIMEOUT);

  it("reports a failed read as unknown, and still pushes it so the gate stays shut", async () => {
    signIn();
    attendanceFails = true;
    render(<Vo3dHost />);
    await ready();
    expect(screen.getByTestId("vo3d-self-movement").getAttribute("data-office-access")).toBe("unknown");
  }, TEST_TIMEOUT);

  it("pushes no access answer at all when there is no identity to ask about", async () => {
    // The standalone-equivalent case: nothing is published and nothing is gated on this route's behalf.
    render(<Vo3dHost />);
    await ready();
    expect(worlds[0].access).toEqual([]);
  }, TEST_TIMEOUT);
});
