// Phase 2 — what the HOST hands the world, and what it puts on screen for each answer. The identity
// resolver itself is tested against V1's real stores in adapters/v1Identity.test.ts; here it is mocked so
// each case can pin one answer and assert on the consequence.
import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Vo3dIdentity } from "./identity";
import { Vo3dHost } from "./Vo3dHost";

const WORLD_IMPORT_TIMEOUT = 10000;
const TEST_TIMEOUT = 20000;

/** Every (canvas, identity) pair createVo3dWorld was called with. */
const mounts: { canvas: HTMLCanvasElement; identity: Vo3dIdentity | undefined }[] = [];
let resolved: Vo3dIdentity | null = null;

vi.mock("../adapters/v1Identity", () => ({
  resolveVo3dIdentity: () => resolved,
}));
/** The dev-tools switch, as the world drives it. Phase 7C: the host's own readouts ride it. */
let devToolsListener: ((on: boolean) => void) | null = null;

vi.mock("./world", () => ({
  createVo3dWorld: (canvas: HTMLCanvasElement, identity?: Vo3dIdentity) => {
    mounts.push({ canvas, identity });
    // Phase 4A: the world is a Vo3dWorld, and the host pushes the roster into it on creation.
    return { dispose: vi.fn(), setCoworkers: vi.fn(), restoreSelf: vi.fn(() => false), setOfficeAccess: vi.fn(), setOccupiedSeats: vi.fn(), setCoworkerInteractions: vi.fn(), subscribeViewMode: () => () => {}, subscribePlayerView: () => () => {}, setViewMode: vi.fn(), setPlayerView: vi.fn(), devToolsVisible: () => false, setDevToolsVisible: vi.fn(), setConversationPoses: vi.fn(), exitPlayerMode: vi.fn(), selectCoworkerByEmail: vi.fn(() => false), clearCoworkerSelection: vi.fn(), coworkerAnchor: vi.fn(() => null), approachCoworker: vi.fn(() => false), standUp: vi.fn(), subscribeDevTools: (cb: (on: boolean) => void) => { devToolsListener = cb; cb(false); return () => { devToolsListener = null; }; } };
  },
}));

const BON: Vo3dIdentity = {
  displayName: "Bon",
  avatarId: "bon",
  employeeId: null,
  source: "atlas",
};
const UNMAPPED: Vo3dIdentity = {
  displayName: "Someone New",
  avatarId: null,
  employeeId: null,
  source: "atlas",
};

beforeEach(() => {
  mounts.length = 0;
  resolved = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Vo3dHost identity handoff", () => {
  it("passes the resolved employee straight through to the world", async () => {
    resolved = BON;
    render(<Vo3dHost />);
    await waitFor(() => expect(mounts).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    expect(mounts[0].identity).toEqual(BON);
  }, TEST_TIMEOUT);

  it("passes undefined — not a guess — when V1 has no identity", async () => {
    resolved = null;
    render(<Vo3dHost />);
    await waitFor(() => expect(mounts).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    // undefined is the standalone signal. It must not be null-the-object or a stand-in Bon.
    expect(mounts[0].identity).toBeUndefined();
    expect(screen.queryByTestId("vo3d-identity")).toBeNull();
  }, TEST_TIMEOUT);

  it("re-resolves on every mount rather than reusing a value captured at import time", async () => {
    // A module-scope read would freeze the FIRST answer for the life of the tab. Reading inside the
    // effect means a later mount sees whatever V1 knows then — proven by changing the answer between
    // two real mounts and watching the second world get the new one.
    resolved = BON;
    const first = render(<Vo3dHost />);
    await waitFor(() => expect(mounts).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    first.unmount();

    resolved = UNMAPPED;
    render(<Vo3dHost />);
    await waitFor(() => expect(mounts).toHaveLength(2), { timeout: WORLD_IMPORT_TIMEOUT });

    expect(mounts[0].identity).toEqual(BON);
    expect(mounts[1].identity).toEqual(UNMAPPED);
    // Each mount still gets its own fresh canvas (the Phase 1 contract, unchanged by identity).
    expect(mounts[0].canvas).not.toBe(mounts[1].canvas);
  }, TEST_TIMEOUT);

  it("builds exactly one world under StrictMode, and it carries the identity", async () => {
    // StrictMode is mount -> cleanup -> mount; the first run's cleanup cancels its own in-flight import,
    // so only the second run builds. Phase 1's contract, re-asserted with identity in the picture.
    resolved = BON;
    render(
      <StrictMode>
        <Vo3dHost />
      </StrictMode>,
    );
    await waitFor(() => expect(mounts).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    expect(mounts[0].identity).toEqual(BON);
  }, TEST_TIMEOUT);
});

describe("Vo3dHost identity readout", () => {
  it("shows the name and character id, and nothing from the session", async () => {
    resolved = BON;
    render(<Vo3dHost />);
    const el = await screen.findByTestId("vo3d-identity", {}, { timeout: WORLD_IMPORT_TIMEOUT });
    expect(el.dataset.displayName).toBe("Bon");
    expect(el.dataset.avatarId).toBe("bon");
    expect(el.dataset.source).toBe("atlas");
    expect(el.dataset.avatarMissing).toBe("false");
    // The readout is the thing an outside check reads, so it must never carry an address or a token.
    expect(el.outerHTML).not.toContain("@");
    expect(screen.queryByTestId("vo3d-missing-avatar")).toBeNull();
  }, TEST_TIMEOUT);

  it("shows an explicit missing-avatar state for an employee with no character", async () => {
    resolved = UNMAPPED;
    render(<Vo3dHost />);
    const notice = await screen.findByTestId("vo3d-missing-avatar", {}, { timeout: WORLD_IMPORT_TIMEOUT });
    expect(notice).toHaveTextContent(/no 3d avatar is registered for someone new/i);
    const el = screen.getByTestId("vo3d-identity");
    expect(el.dataset.avatarMissing).toBe("true");
    expect(el.dataset.avatarId).toBe("");
    // THE load-bearing assertion of the whole phase: an unmapped employee is never labelled as Bon.
    expect(el.outerHTML.toLowerCase()).not.toContain("bon");
    expect(notice.textContent?.toLowerCase()).not.toContain("bon");
  }, TEST_TIMEOUT);

  it("still builds the world for an employee with no character", async () => {
    resolved = UNMAPPED;
    render(<Vo3dHost />);
    await waitFor(() => expect(mounts).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    expect(mounts[0].identity?.avatarId).toBeNull();
  }, TEST_TIMEOUT);
});

// ---- PHASE 7C — THE READOUTS ARE DEVELOPER DIAGNOSTICS ---------------------------------------------
// They exist so a real session can be verified from OUTSIDE, which is why they are HIDDEN rather than
// removed: the elements and their data-* attributes stay queryable (every check above still reads them)
// and only the paint is taken away from an employee's office.
describe("developer diagnostics", () => {
  it("keeps the readout in the DOM but off the screen until the developer switch is on", async () => {
    resolved = BON;
    render(<Vo3dHost />);
    const el = await screen.findByTestId("vo3d-identity", {}, { timeout: WORLD_IMPORT_TIMEOUT });
    // Present and readable — that is what an automated check needs.
    expect(el.dataset.displayName).toBe("Bon");
    // …and not painted over the office.
    expect(el).not.toBeVisible();

    act(() => devToolsListener?.(true));
    expect(screen.getByTestId("vo3d-identity")).toBeVisible();

    act(() => devToolsListener?.(false));
    expect(screen.getByTestId("vo3d-identity")).not.toBeVisible();
  }, TEST_TIMEOUT);

  it("leaves the employee-facing missing-avatar notice alone", async () => {
    resolved = UNMAPPED;
    render(<Vo3dHost />);
    const notice = await screen.findByTestId("vo3d-missing-avatar", {}, { timeout: WORLD_IMPORT_TIMEOUT });
    // Not a diagnostic: it tells an employee why the world has no body for them.
    expect(notice).toBeVisible();
  }, TEST_TIMEOUT);
});
