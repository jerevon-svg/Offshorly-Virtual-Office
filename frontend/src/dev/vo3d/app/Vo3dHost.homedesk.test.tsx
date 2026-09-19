// Phase 3 — what the HOST hands the world for the home desk, and what it shows for each answer. The
// resolver itself is tested against V1's real stores and V2's real navigation in dev/vo3d/homedesk.test.ts;
// here both adapters are mocked so each case can pin one answer and assert on the consequence.
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Vo3dIdentity } from "./identity";
import type { Vo3dHomeDesk } from "./spawn";
import { Vo3dHost } from "./Vo3dHost";

const WORLD_IMPORT_TIMEOUT = 10000;
const TEST_TIMEOUT = 20000;

/** Every (identity, homeDesk) pair createVo3dWorld was called with. */
const mounts: { identity: Vo3dIdentity | undefined; homeDesk: Vo3dHomeDesk | undefined }[] = [];
let identity: Vo3dIdentity | null = null;
let homeDesk: Vo3dHomeDesk | null = null;

vi.mock("../adapters/v1Identity", () => ({ resolveVo3dIdentity: () => identity }));
vi.mock("../adapters/v1HomeDesk", () => ({ resolveVo3dHomeDesk: () => homeDesk }));
vi.mock("./world", () => ({
  createVo3dWorld: (_canvas: HTMLCanvasElement, id?: Vo3dIdentity, desk?: Vo3dHomeDesk) => {
    mounts.push({ identity: id, homeDesk: desk });
    // Phase 4A: the world is a Vo3dWorld, and the host pushes the roster into it on creation.
    return { dispose: vi.fn(), setCoworkers: vi.fn(), restoreSelf: vi.fn(() => false), setOfficeAccess: vi.fn(), setOccupiedSeats: vi.fn(), setCoworkerInteractions: vi.fn(), subscribeViewMode: () => () => {}, subscribePlayerView: () => () => {}, setViewMode: vi.fn(), setPlayerView: vi.fn(), devToolsVisible: () => false, setDevToolsVisible: vi.fn(), setConversationPoses: vi.fn(), exitPlayerMode: vi.fn(), selectCoworkerByEmail: vi.fn(() => false), clearCoworkerSelection: vi.fn(), coworkerAnchor: vi.fn(() => null), approachCoworker: vi.fn(() => false), standUp: vi.fn() };
  },
}));

const BON: Vo3dIdentity = { displayName: "Bon", avatarId: "bon", employeeId: null, source: "atlas" };
const BON_DESK: Vo3dHomeDesk = { roomId: "design-team", point: { x: 235.36, z: 434.215 }, facing: "east" };

beforeEach(() => {
  mounts.length = 0;
  identity = BON;
  homeDesk = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Vo3dHost home-desk handoff", () => {
  it("passes the resolved desk straight through to the world", async () => {
    homeDesk = BON_DESK;
    render(<Vo3dHost />);
    await waitFor(() => expect(mounts).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    expect(mounts[0].homeDesk).toEqual(BON_DESK);
  }, TEST_TIMEOUT);

  it("passes undefined — never a substitute desk — when V1 knows of none", async () => {
    homeDesk = null;
    render(<Vo3dHost />);
    await waitFor(() => expect(mounts).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    // undefined is the "keep your own default spawn" signal to the world.
    expect(mounts[0].homeDesk).toBeUndefined();
    expect(screen.queryByTestId("vo3d-home-desk")).toBeNull();
  }, TEST_TIMEOUT);

  it("reports the desk as a PREVIEW, with the values it was computed from", async () => {
    homeDesk = BON_DESK;
    render(<Vo3dHost />);
    const readout = await screen.findByTestId("vo3d-home-desk", {}, { timeout: WORLD_IMPORT_TIMEOUT });
    expect(readout).toHaveAttribute("data-room-id", "design-team");
    expect(readout).toHaveAttribute("data-seat-x", "235.36");
    expect(readout).toHaveAttribute("data-seat-z", "434.215");
    expect(readout).toHaveAttribute("data-facing", "east");
    // It says "desk preview" — not "checked in", not "at work", not a status of any kind. V2 reads no
    // attendance, so the one thing this readout must never do is imply a work session.
    expect(readout.textContent).toContain("desk preview");
    expect(readout.textContent).not.toMatch(/checked|attendance|at work/i);
  }, TEST_TIMEOUT);

  it("shows a desk even for an employee with no 3D character", async () => {
    // The two Phase answers are independent: an unmapped employee has no body to draw, but their desk is
    // still theirs, and the world still frames it.
    identity = { displayName: "Someone New", avatarId: null, employeeId: null, source: "atlas" };
    homeDesk = BON_DESK;
    render(<Vo3dHost />);
    await waitFor(() => expect(mounts).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    expect(mounts[0].homeDesk).toEqual(BON_DESK);
    expect(await screen.findByTestId("vo3d-missing-avatar")).toBeInTheDocument();
  }, TEST_TIMEOUT);
});
