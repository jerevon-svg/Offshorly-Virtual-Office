// Phase 7A — THE BRANDED HUD OVER V2. What is asserted is the WIRING, which is what a host can get
// wrong: a dock that stays up while the pointer is locked, a pill that lies about the work session, or a
// Search row that reaches a second implementation of Chat instead of the one the interaction card uses.
//
// V1's dock, pills and spotlight are REAL here — they are the thing under test. Only the panels that
// fetch are stubbed, and only so these stay about wiring.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dHud } from "./Vo3dHud";
import type { Vo3dWorld } from "./world";
import type { V1Attendance } from "../adapters/v1Attendance";
import type { Vo3dViewMode } from "./viewMode";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../../auth/currentUserStore";
import type { AssetLayer } from "../../../types/office";

const SELF = "bon@offshorly.com";
const ALEX = "alex@offshorly.com";

// PlayerHud renders nothing but the availability slot until the server's progression answers, so the
// store is given a real one — the identity group is part of what this file is testing.
vi.mock("../../../services/quests/progressionStore", () => ({
  useProgressionStore: () => ({
    progression: { xp: 120, coins: 40, level: 3, levelStartXp: 100, nextLevelXp: 200 },
    badges: [],
    lastClaim: null,
    lastAward: null,
    coinsPulse: 0,
    xpPulse: 0,
  }),
  refreshProgression: vi.fn(),
  refreshBadges: vi.fn(),
}));
vi.mock("../../../services/quests/claimableStore", () => ({
  useClaimableCount: () => 2,
  refreshClaimable: vi.fn(),
}));
vi.mock("../../../components/OfficeMap/NotificationCenter", () => ({
  NotificationCenter: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
vi.mock("../../../components/OfficeMap/TasksPanel", () => ({ TasksPanel: () => <div data-testid="tasks" /> }));
vi.mock("../../../components/OfficeMap/RewardsPanel", () => ({ RewardsPanel: () => <div data-testid="rewards" /> }));
vi.mock("../../../components/OfficeMap/CompanyHub", () => ({ CompanyHub: () => <div data-testid="hub" /> }));
vi.mock("../../../components/OfficeMap/HudSettings", () => ({ HudSettings: () => <div data-testid="settings" /> }));
vi.mock("../../../components/Whiteboard/WhiteboardPanel", () => ({
  WhiteboardPanel: ({ scope, title }: { scope: { kind: string; id: string }; title: string }) => (
    <div data-testid="boards">{`${scope.kind}:${scope.id}:${title}`}</div>
  ),
}));
vi.mock("../../../components/TeamMap/TeamMapPanel", () => ({ default: () => <div data-testid="map" /> }));
// Chat and Boards are gated on real chat mode in V2 exactly as they are in V1's dock.
vi.mock("../../../services/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/chat")>()),
  chatMode: "real",
}));
vi.mock("../../../services/hub/companyHubStore", () => ({
  useCompanyHub: () => ({ isOpen: false, mode: "manual", items: [], loading: false, error: null }),
  openCompanyHub: vi.fn(),
}));

let viewMode: Vo3dViewMode = "office";
// SEVERAL subscribers: the HUD and the view switcher each hold one. A single-slot mock would silently
// drop one of them, which is exactly the bug a shared view signal can have in production too.
let viewModeSubs: ((m: Vo3dViewMode) => void)[] = [];
const notifyViewMode = (m: Vo3dViewMode) => { viewMode = m; for (const cb of [...viewModeSubs]) cb(m); };
const exitPlayerMode = vi.fn();
const selectCoworkerByEmail = vi.fn((_email: string) => true);
const setViewMode = vi.fn((_m: Vo3dViewMode) => {});
const setPlayerView = vi.fn((_v: "first" | "third") => {});
const world = {
  subscribeViewMode: (cb: (m: Vo3dViewMode) => void) => {
    viewModeSubs.push(cb);
    cb(viewMode);
    return () => { viewModeSubs = viewModeSubs.filter((x) => x !== cb); };
  },
  subscribePlayerView: (cb: (v: "first" | "third") => void) => { cb("third"); return () => {}; },
  setViewMode,
  setPlayerView,
  devToolsVisible: () => false,
  setDevToolsVisible: vi.fn(),
  exitPlayerMode,
  selectCoworkerByEmail,
} as unknown as Vo3dWorld;
const worldRef = { current: world };

const layer = (email: string, name: string): AssetLayer =>
  ({ id: email, kind: "character", path: "", x: 0, y: 0, width: 26, height: 37, transform: null, name }) as AssetLayer;

const onCoworkerAction = vi.fn((_e: string, _n: string, _a: string) => {});
const onOpenProfile = vi.fn((_e: string) => {});
const onSelectConversation = vi.fn((_c: unknown) => {});
const onOpenDirectMessage = vi.fn((_e: string) => {});
const onStartGroup = vi.fn((_e: string[], _n?: string) => {});
let conversations: never[] = [];
let overlayToolOpen = false;

function attendanceOf(status: "CHECKED_IN" | "CHECKED_OUT", checkedInAt: string | null): V1Attendance {
  return {
    access: status === "CHECKED_IN" ? "permitted" : "denied",
    record: { email: SELF, status, checkedInAt, checkedOutAt: null },
  };
}

function mount(attendance = attendanceOf("CHECKED_IN", new Date(Date.now() - 90 * 60_000).toISOString())) {
  return render(
    <Vo3dHud
      worldRef={worldRef}
      ready
      attendance={attendance}
      peopleLayers={[layer(ALEX, "Alex Cruz")]}
      statusByEmail={{ [ALEX]: "AVAILABLE" }}
      onCoworkerAction={onCoworkerAction}
      onOpenProfile={onOpenProfile}
      people={[{ email: ALEX, displayName: "Alex Cruz" } as never]}
      selfId={SELF}
      conversations={conversations}
      unreadTotal={0}
      resolveDisplayName={(e) => e}
      onSelectConversation={onSelectConversation}
      onOpenDirectMessage={onOpenDirectMessage}
      onStartGroup={onStartGroup}
      overlayToolOpen={overlayToolOpen}
    />,
  );
}

beforeEach(() => {
  viewMode = "office";
  viewModeSubs = [];
  conversations = [];
  overlayToolOpen = false;
  vi.clearAllMocks();
  localStorage.clear();
  setCurrentUserFromMeResponse({ id: 1, email: SELF, full_name: "Bon" } as never);
});
afterEach(() => resetCurrentUserForTests());

describe("the dock", () => {
  it("renders V1's dock with the office's own controls", async () => {
    mount();
    const dock = await screen.findByTestId("hud-dock");
    expect(dock).toBeTruthy();
    for (const name of ["Search for a person", "Open Company Hub", "Open Tasks", "Open Rewards", "Settings"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("carries the real claimable count on Tasks, not a decorative one", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    expect(screen.getByRole("button", { name: "Open Tasks" }).textContent).toContain("2");
  });

  it("shows the identity group: the viewer's name and their level", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    expect(screen.getByTestId("player-hud")).toBeTruthy();
    expect(screen.getByText("Bon")).toBeTruthy();
    expect(screen.getByTestId("hud-level").textContent).toContain("3");
  });

  it("opens the viewer's OWN profile from the identity group", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    fireEvent.click(screen.getByRole("button", { name: "Open my profile" }));
    await waitFor(() => expect(onOpenProfile).toHaveBeenCalledWith(SELF));
  });
});

describe("Player Mode", () => {
  it("hides the dock — without unmounting it, so every control keeps its state", async () => {
    viewMode = "player";
    mount();
    const dock = await screen.findByTestId("hud-dock");
    // still mounted...
    expect(dock.isConnected).toBe(true);
    // ...and hidden by the dock's own class, not by a conditional render
    expect(dock.className).toMatch(/hidden/i);
  });

  it("shows the dock again the moment the world returns to OFFICE", async () => {
    viewMode = "player";
    mount();
    const dock = await screen.findByTestId("hud-dock");
    expect(dock.className).toMatch(/hidden/i);
    notifyViewMode("office");
    await waitFor(() => expect(screen.getByTestId("hud-dock").className).not.toMatch(/hidden/i));
  });

  it("swaps the full dock for a MINIMAL strip that still reaches real tools", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    expect(screen.queryByTestId("vo3d-player-hud")).toBeNull();
    notifyViewMode("player");
    const bar = await screen.findByTestId("vo3d-player-hud");
    // essential, daily-use tools — never the whole dock laid over an immersive view
    for (const label of ["Open Tasks", "Open Company Hub", "Open Global Team Map"]) {
      expect(bar.querySelector(`[aria-label="${label}"]`)).toBeTruthy();
    }
    fireEvent.click(bar.querySelector('[aria-label="Open Tasks"]')!);
    expect(await screen.findByTestId("tasks")).toBeTruthy();
  });

  it("states the pointer contract rather than leaving it to be discovered", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    notifyViewMode("player");
    expect((await screen.findByTestId("vo3d-player-hint")).textContent).toMatch(/click the world|esc/i);
  });
});

describe("working time", () => {
  it("shows the session clock, started from the SERVER's check-in time", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    // 90 minutes ago -> "1h 30m", whatever the label's exact shape, it is not the not-checked-in text
    const pill = screen.getByText(/1h 30m/);
    expect(pill).toBeTruthy();
  });

  it("shows no clock at all for an employee who is not checked in", async () => {
    mount(attendanceOf("CHECKED_OUT", null));
    await screen.findByTestId("hud-dock");
    expect(screen.queryByText(/\dh \d+m/)).toBeNull();
  });
});

describe("Search", () => {
  const openSearchAndQuery = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Search for a person" }));
    fireEvent.change(await screen.findByLabelText("Find a teammate"), { target: { value: "alex" } });
  };

  it("offers the people V2 actually draws", async () => {
    mount();
    await openSearchAndQuery();
    expect(await screen.findByText("1 teammate found")).toBeTruthy();
    expect(screen.getByText(/Alex Cruz/)).toBeTruthy();
  });

  it("Locate SELECTS that person in the 3D world — the same thing clicking their body does", async () => {
    mount();
    await openSearchAndQuery();
    fireEvent.click(await screen.findByRole("button", { name: "Locate Alex Cruz" }));
    expect(selectCoworkerByEmail).toHaveBeenCalledWith(ALEX);
  });

  it("Chat and Call run the interaction card's OWN handler, not a second copy", async () => {
    mount();
    await openSearchAndQuery();
    fireEvent.click(await screen.findByRole("button", { name: "Chat with Alex Cruz" }));
    expect(onCoworkerAction).toHaveBeenCalledWith(ALEX, "Alex Cruz", "chat");

    await openSearchAndQuery();
    fireEvent.click(await screen.findByRole("button", { name: "Call Alex Cruz" }));
    expect(onCoworkerAction).toHaveBeenCalledWith(ALEX, "Alex Cruz", "call");
  });
});

describe("the one visibility rule", () => {
  /** Every dock control that owns the screen, and how to open it. Search is deliberately NOT special. */
  const tools: [string, string][] = [
    ["Search", "Search for a person"],
    ["Tasks", "Open Tasks"],
    ["Rewards", "Open Rewards"],
    ["Boards", "Open office whiteboards"],
    ["Map", "Open Global Team Map"],
    ["Settings", "Settings"],
  ];

  it.each(tools)("hides the dock when %s opens", async (_name, ariaLabel) => {
    mount();
    const dock = await screen.findByTestId("hud-dock");
    expect(dock.className).not.toMatch(/hidden/i);
    fireEvent.click(screen.getByRole("button", { name: ariaLabel }));
    await waitFor(() => expect(screen.getByTestId("hud-dock").className).toMatch(/hidden/i));
  });

  it("restores the dock when the tool closes, with the tool's own state intact", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    fireEvent.click(screen.getByRole("button", { name: "Search for a person" }));
    fireEvent.change(await screen.findByLabelText("Find a teammate"), { target: { value: "alex" } });
    await screen.findByText("1 teammate found");
    await waitFor(() => expect(screen.getByTestId("hud-dock").className).toMatch(/hidden/i));
    // The spotlight listens on `document`, as the dock's flyouts do — a window-level event never
    // reaches it.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("hud-dock").className).not.toMatch(/hidden/i));
    // HIDDEN, never unmounted — the dock's own controls kept their state through the tool
    expect(screen.getByTestId("player-hud")).toBeTruthy();
  });

  it("hides the dock for a panel the OVERLAY owns, not only for its own tools", async () => {
    overlayToolOpen = true;
    mount();
    const dock = await screen.findByTestId("hud-dock");
    expect(dock.className).toMatch(/hidden/i);
  });
});

describe("the restored tools", () => {
  it("opens the office whiteboards at V1's own room scope", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Open office whiteboards" }));
    expect((await screen.findByTestId("boards")).textContent).toBe("room:office:Office");
  });

  it("opens the Global Team Map", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Open Global Team Map" }));
    expect(await screen.findByTestId("map")).toBeTruthy();
  });

  it("opens the inbox WITHOUT anybody being selected, and routes a row through the caller's opener", async () => {
    conversations = [{ id: "conv-1", type: "dm", participantIds: [SELF, ALEX], unreadCount: 0, lastMessageAt: new Date().toISOString() }] as never;
    mount();
    // With no unread, V1's badge names itself "Conversations".
    fireEvent.click(await screen.findByRole("button", { name: "Conversations" }));
    const rows = await screen.findByRole("list", { name: "Conversations" });
    const row = [...rows.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(ALEX));
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    expect(onSelectConversation).toHaveBeenCalledWith(expect.objectContaining({ id: "conv-1" }));
  });
});

describe("the view switcher", () => {
  it("stays on screen when the dock steps aside, and in Player", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    expect(screen.getByTestId("vo3d-view-switcher")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Tasks" }));
    await waitFor(() => expect(screen.getByTestId("hud-dock").className).toMatch(/hidden/i));
    expect(screen.getByTestId("vo3d-view-switcher")).toBeTruthy();
    notifyViewMode("player");
    expect(await screen.findByTestId("vo3d-view-switcher")).toBeTruthy();
  });

  it("offers the three views and switches through the world's own entry point", async () => {
    mount();
    await screen.findByTestId("vo3d-view-switcher");
    for (const id of ["office", "explore", "player"]) expect(screen.getByTestId(`view-${id}`)).toBeTruthy();
    expect(screen.getByTestId("view-office").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("view-explore"));
    expect(setViewMode).toHaveBeenCalledWith("explore");
  });

  it("offers first/third person ONLY inside Player View", async () => {
    mount();
    await screen.findByTestId("vo3d-view-switcher");
    expect(screen.queryByTestId("player-view-first")).toBeNull();
    notifyViewMode("player");
    fireEvent.click(await screen.findByTestId("player-view-first"));
    expect(setPlayerView).toHaveBeenCalledWith("first");
  });
});
