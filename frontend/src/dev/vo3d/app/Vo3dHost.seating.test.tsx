// Phase 6C — the HOST's half of seating: occupancy derived from V1's own feed and pushed into the world,
// the seat anchor carried on the restore, and the backend's seat rejection standing the body up.
//
// The world is mocked (its seat behaviour has its own tests); what is asserted is the wiring, which is
// exactly what a React host can get wrong: counting one's own chair as occupied, restoring standing when
// V1 says seated, or never hearing the rejection.
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dHost } from "./Vo3dHost";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../../auth/currentUserStore";
import { v1SeatForAnchor } from "../adapters/v1Seats";
import type { PeerMovementState, SeatRejectedEvent } from "../../../services/presence/movementSync";
import type { Facing, Vec2 } from "../core/coords";

const WORLD_IMPORT_TIMEOUT = 10000;
const TEST_TIMEOUT = 20000;

type Restore = { point: Vec2; facing: Facing; seat?: string };
const worlds: { restores: Restore[]; occupied: string[][]; standUp: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = [];

vi.mock("./world", async () => ({
  createVo3dWorld: () => {
    const restores: Restore[] = [];
    const occupied: string[][] = [];
    const world = {
      dispose: vi.fn(),
      setCoworkers: vi.fn(),
      setOfficeAccess: vi.fn(),
      setOccupiedSeats: (ids: readonly string[]) => { occupied.push([...ids]); },
      standUp: vi.fn(),
      restoreSelf: (point: Vec2, facing: Facing, seat?: string) => { restores.push({ point, facing, ...(seat ? { seat } : {}) }); return true; },
      restores,
      occupied,
    };
    worlds.push(world);
    return world;
  },
}));

vi.mock("../../../services/office/useOfficeRoster", () => ({
  useOfficeRoster: () => ({ people: [], loading: false, error: null, live: true, roomNames: new Map(), floorCount: 0, presenceCount: 0 }),
}));
vi.mock("../../../services/presence/offlineLineupClient", () => ({ useOfflineLineup: () => [] }));
vi.mock("../../../services/attendance", () => ({
  attendanceService: { getMine: () => Promise.resolve({ status: "CHECKED_IN" }), checkIn: vi.fn(), checkOut: vi.fn() },
}));

let rejectionListeners: ((e: SeatRejectedEvent) => void)[] = [];
vi.mock("../../../services/presence/movementSync", async () => {
  const actual = await vi.importActual<typeof import("../../../services/presence/movementSync")>("../../../services/presence/movementSync");
  return {
    ...actual,
    usePeerMovements: () => peerMovements,
    useMovementSnapshotReady: () => snapshotReady,
    subscribeSeatRejected: (listener: (e: SeatRejectedEvent) => void) => {
      rejectionListeners.push(listener);
      return () => { rejectionListeners = rejectionListeners.filter((l) => l !== listener); };
    },
  };
});

let peerMovements: PeerMovementState[] = [];
let snapshotReady = true;

const BON_EMAIL = "jerevon@offshorly.com";
const ALEX_EMAIL = "alex@offshorly.com";
const CHAIR = "executive-room/workstation-chair";
const OTHER_CHAIR = "dev-room/bay-chair-n1";
const BOX = { w: 26.23, h: 37.2 }; // bon's manifest box

function signIn(email = BON_EMAIL) {
  setCurrentUserFromMeResponse({ id: "atlas-1", email, full_name: "Bon", role: "dev", team: null });
}
/** A SITTING row for `anchor`, as V2's publisher writes it: centroid − box/2, V1's key, the chair's direction. */
function sitting(email: string, anchor: string, active: PeerMovementState["active"] = null): PeerMovementState {
  const seat = v1SeatForAnchor(anchor)!;
  return { email, revision: 5, active, stable: { pos: { x: seat.x - BOX.w / 2, y: seat.y - BOX.h / 2 }, facing: seat.direction, state: "sitting", seatKey: seat.key, roomId: seat.roomId } };
}
function standing(email: string, x: number, y: number): PeerMovementState {
  return { email, revision: 3, stable: { pos: { x, y }, facing: "front", state: "standing", seatKey: null, roomId: null }, active: null };
}

beforeEach(() => {
  worlds.length = 0;
  rejectionListeners = [];
  peerMovements = [];
  snapshotReady = true;
  resetCurrentUserForTests();
});
afterEach(() => resetCurrentUserForTests());

const ready = () => waitFor(() => expect(screen.getByTestId("vo3d-self-movement")).toBeInTheDocument(), { timeout: WORLD_IMPORT_TIMEOUT });
const lastOccupied = () => worlds[0].occupied[worlds[0].occupied.length - 1];

describe("occupancy", () => {
  it("pushes a seated PEER's chair as occupied, and never one's own", async () => {
    signIn();
    peerMovements = [sitting(ALEX_EMAIL, OTHER_CHAIR), sitting(BON_EMAIL, CHAIR)];
    render(<Vo3dHost />);
    await ready();
    await waitFor(() => expect(worlds[0].occupied.length).toBeGreaterThan(0));
    expect(lastOccupied()).toEqual([OTHER_CHAIR]);
  }, TEST_TIMEOUT);

  it("counts a peer on a V2-ONLY seat (namespaced key) as occupying that anchor", async () => {
    signIn();
    const id = "central-hub/cafe-chair-2-east";
    peerMovements = [{ email: ALEX_EMAIL, revision: 4, active: null, stable: { pos: { x: 700, y: 600 }, facing: "front", state: "sitting", seatKey: `v2:${id}`, roomId: null } }];
    render(<Vo3dHost />);
    await ready();
    await waitFor(() => expect(lastOccupied()).toEqual([id]));
  }, TEST_TIMEOUT);

  it("frees the chair the moment the sitter's walk_started lands, and when they arrive standing", async () => {
    signIn();
    peerMovements = [sitting(ALEX_EMAIL, OTHER_CHAIR)];
    const view = render(<Vo3dHost />);
    await ready();
    await waitFor(() => expect(lastOccupied()).toEqual([OTHER_CHAIR]));
    // mid-walk: V1's own occupancy read excludes anyone with a movement in flight
    peerMovements = [sitting(ALEX_EMAIL, OTHER_CHAIR, { movementId: "m", origin: { x: 0, y: 0 }, path: [{ x: 1, y: 1 }], roomId: null, durationMs: 500, startedAt: 0 })];
    view.rerender(<Vo3dHost />);
    await waitFor(() => expect(lastOccupied()).toEqual([]));
    peerMovements = [standing(ALEX_EMAIL, 600, 500)];
    view.rerender(<Vo3dHost />);
    await waitFor(() => expect(lastOccupied()).toEqual([]));
  }, TEST_TIMEOUT);
});

describe("the seated restore", () => {
  it("carries the seat anchor when V1 says this employee is sitting in a chair V2 identifies", async () => {
    signIn();
    peerMovements = [sitting(BON_EMAIL, CHAIR)];
    render(<Vo3dHost />);
    await ready();
    await waitFor(() => expect(worlds[0].restores).toHaveLength(1));
    expect(worlds[0].restores[0].seat).toBe(CHAIR);
    const seat = v1SeatForAnchor(CHAIR)!;
    expect(worlds[0].restores[0].point.x).toBeCloseTo(seat.x, 2);
    expect(worlds[0].restores[0].point.z).toBeCloseTo(seat.y, 2);
  }, TEST_TIMEOUT);

  it("carries NO seat for a standing row (Phase 5 behaviour, unchanged)", async () => {
    signIn();
    peerMovements = [standing(BON_EMAIL, 600, 500)];
    render(<Vo3dHost />);
    await ready();
    await waitFor(() => expect(worlds[0].restores).toHaveLength(1));
    expect(worlds[0].restores[0].seat).toBeUndefined();
  }, TEST_TIMEOUT);
});

describe("the backend's seat rejection", () => {
  it("stands the body up when this session's own seat claim is rejected", async () => {
    signIn();
    render(<Vo3dHost />);
    await ready();
    await waitFor(() => expect(rejectionListeners).toHaveLength(1));
    act(() => { for (const l of rejectionListeners) l({ movementId: "m1", seatKey: "881,258", heldBy: ALEX_EMAIL }); });
    expect(worlds[0].standUp).toHaveBeenCalledTimes(1);
  }, TEST_TIMEOUT);

  it("subscribes only for a publishing session, and lets go on unmount", async () => {
    // no identity → no publishing → nothing to reject
    const view = render(<Vo3dHost />);
    await ready();
    expect(rejectionListeners).toHaveLength(0);
    view.unmount();
    signIn();
    const second = render(<Vo3dHost />);
    await ready();
    await waitFor(() => expect(rejectionListeners).toHaveLength(1));
    second.unmount();
    expect(rejectionListeners).toHaveLength(0);
  }, TEST_TIMEOUT);
});
