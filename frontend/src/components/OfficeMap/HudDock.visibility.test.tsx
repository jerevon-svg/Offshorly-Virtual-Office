import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../auth/currentUserStore";
import { getCurrentUserId } from "../../auth/useAuthGate";
import { clearAll, saveResult, saveSessionStart } from "../../data/checkoutStorage";
import { attendanceService } from "../../services/attendance";
import { OfficeMap } from "./OfficeMap";

// The bottom dock's lifecycle across a work session. Once checkout has genuinely COMPLETED there
// must be NO dock at all — not an empty shell and not the ungated remnant (availability, Search,
// Chat, •••) that used to stay behind. Every earlier checkout step keeps today's behavior, and a
// new check-in brings the whole dock back.
//
// Drives the real gate: useCheckoutFlow resolves its initial state from checkout storage
// (isAlreadyCheckedOut), so seeding a completed submission is how a genuinely checked-out session
// is reproduced without walking the whole flow.

vi.mock("../../render3d/CharacterCanvas", async () => {
  const actual = await vi.importActual<typeof import("../../render3d/CharacterCanvas")>("../../render3d/CharacterCanvas");
  return { ...actual, CharacterCanvas: () => <div data-testid="character-canvas-stub" /> };
});

vi.mock("../../services/render/deviceTier", async () => {
  const actual = await vi.importActual<typeof import("../../services/render/deviceTier")>("../../services/render/deviceTier");
  return { ...actual, detectDeviceTier: () => "T2" };
});

vi.mock("../../services/presence/movementSync", async () => {
  const actual = await vi.importActual<typeof import("../../services/presence/movementSync")>(
    "../../services/presence/movementSync",
  );
  return { ...actual, getPeerMovementSnapshot: () => [], usePeerMovements: () => [] };
});

// Roster loading is one of the inputs to selfPlacementPending (OfficeMap's spawn gate), so it is
// controllable here: `loading: true` is the "checked in, avatar not placed yet" window.
const { rosterState } = vi.hoisted(() => ({ rosterState: { loading: false } }));
vi.mock("../../services/office/useOfficeRoster", () => ({
  useOfficeRoster: () => ({
    people: [],
    loading: rosterState.loading,
    error: null,
    live: true,
    roomNames: new Map(),
    floorCount: 0,
    presenceCount: 0,
  }),
}));

/** Mirrors useCheckoutFlow's own manilaWorkDate() so this test writes the keys the hook reads. */
function workDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const dock = () => screen.queryByTestId("hud-dock");

beforeEach(() => {
  rosterState.loading = false;
  setCurrentUserFromMeResponse({ id: "bon-id", email: "jerevon@offshorly.com", full_name: "Bon", role: "", team: null });
  clearAll(getCurrentUserId(), workDate());
});

afterEach(() => {
  clearAll(getCurrentUserId(), workDate());
  resetCurrentUserForTests();
  vi.restoreAllMocks();
});

/** A completed same-day checkout: a successful submission stamped after the session start, which
 *  is exactly what isAlreadyCheckedOut() treats as "already checked out today". */
function seedCompletedCheckout() {
  const id = getCurrentUserId();
  const date = workDate();
  saveSessionStart(id, date, new Date(Date.now() - 3600_000).toISOString());
  saveResult(id, date, {
    success: true,
    submissionId: "sub-1",
    submittedAt: new Date().toISOString(),
    entriesCreated: 1,
  });
}

describe("bottom dock visibility across a work session", () => {
  function checkedIn() {
    vi.spyOn(attendanceService, "getMine").mockResolvedValue({
      email: "jerevon@offshorly.com",
      status: "CHECKED_IN",
      checkedInAt: new Date(Date.now() - 3600_000).toISOString(),
      checkedOutAt: null,
    });
  }

  it("renders the FULL dock once check-in and placement are complete", async () => {
    checkedIn();

    render(<OfficeMap />);
    await waitFor(() => expect(dock()).not.toBeNull());
    // Full, not the reduced form: the profile / progression group only renders once the office
    // chrome is genuinely offered (dockChromeVisible), so its presence is what distinguishes a
    // complete dock from the partial one this gate exists to prevent.
    await waitFor(() => expect(screen.queryByTestId("hud-dock-identity")).not.toBeNull());
  });

  it("shows NO dock at all while placement is still pending — never a partial one", async () => {
    // Checked in per the server, but the avatar has not been placed yet: exactly the window right
    // after clicking Check In, where the ungated entries (availability, Search, Chat, •••) used to
    // show through as a partial dock.
    checkedIn();
    rosterState.loading = true;

    render(<OfficeMap />);
    await new Promise((r) => setTimeout(r, 250));

    expect(dock()).toBeNull();
    expect(screen.queryByLabelText("Set your status")).toBeNull();
    expect(screen.queryByLabelText("Search for a person")).toBeNull();
    expect(screen.queryByLabelText("Settings")).toBeNull();
  });

  it("is GONE once checkout has genuinely completed — no empty or partial dock left behind", async () => {
    seedCompletedCheckout();
    vi.spyOn(attendanceService, "getMine").mockResolvedValue({
      email: "jerevon@offshorly.com",
      status: "CHECKED_OUT",
      checkedInAt: new Date(Date.now() - 7200_000).toISOString(),
      checkedOutAt: new Date().toISOString(),
    });

    render(<OfficeMap />);
    // Give the office the same settling window the checked-in case needs before asserting absence.
    await waitFor(() => expect(screen.queryByTestId("character-canvas-stub")).not.toBeNull(), { timeout: 3000 }).catch(
      () => {},
    );
    await new Promise((r) => setTimeout(r, 150));

    expect(dock()).toBeNull();
    // Specifically the remnant that used to survive: availability, Search, Chat, •••.
    expect(screen.queryByLabelText("Set your status")).toBeNull();
    expect(screen.queryByLabelText("Search for a person")).toBeNull();
    expect(screen.queryByLabelText("Settings")).toBeNull();
  });

  it("comes back on the next check-in, with the office's own state", async () => {
    // A completed checkout still on disk, but the server says a NEW session is active: this is
    // the re-check-in path (beginNewSession returns the flow to IDLE), and the dock must return.
    seedCompletedCheckout();
    vi.spyOn(attendanceService, "getMine").mockResolvedValue({
      email: "jerevon@offshorly.com",
      status: "CHECKED_IN",
      checkedInAt: new Date(Date.now() + 1000).toISOString(),
      checkedOutAt: null,
    });

    render(<OfficeMap />);
    await waitFor(() => expect(dock()).not.toBeNull(), { timeout: 3000 });
  });
});
