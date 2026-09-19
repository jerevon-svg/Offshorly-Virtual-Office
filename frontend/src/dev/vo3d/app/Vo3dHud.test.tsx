// Phase 7A — THE BRANDED HUD OVER V2. What is asserted is the WIRING, which is what a host can get
// wrong: a dock that stays up while the pointer is locked, a pill that lies about the work session, or a
// Search row that reaches a second implementation of Chat instead of the one the interaction card uses.
//
// V1's dock, pills and spotlight are REAL here — they are the thing under test. Only the panels that
// fetch are stubbed, and only so these stay about wiring.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dHud } from "./Vo3dHud";
import type { Vo3dWorld } from "./world";
import type { V1Attendance } from "../adapters/v1Attendance";
import type { Vo3dViewMode } from "./viewMode";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../../auth/currentUserStore";
import type { AssetLayer } from "../../../types/office";
import {
  __resetExperiencePreferencesForTests,
  setExperiencePreference,
} from "../../../services/settings/experiencePreferences";

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

function hud(attendance = attendanceOf("CHECKED_IN", new Date(Date.now() - 90 * 60_000).toISOString())) {
  return (
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
    />
  );
}

function mount(attendance?: V1Attendance) {
  return render(hud(attendance));
}

/** Drive the browser's pointer-lock state the way the canvas would. jsdom implements neither the
 *  property nor the event, which is exactly why the HUD must not read it with `!== null`. */
const exitPointerLock = vi.fn();
function lockPointer(locked: boolean) {
  Object.defineProperty(document, "pointerLockElement", { value: locked ? canvas : null, configurable: true });
  act(() => {
    document.dispatchEvent(new Event("pointerlockchange"));
  });
}
const canvas = document.createElement("canvas");

beforeEach(() => {
  Object.defineProperty(document, "pointerLockElement", { value: null, configurable: true });
  Object.defineProperty(document, "exitPointerLock", { value: exitPointerLock, configurable: true });
  exitPointerLock.mockReset();
  viewMode = "office";
  viewModeSubs = [];
  conversations = [];
  overlayToolOpen = false;
  vi.clearAllMocks();
  localStorage.clear();
  __resetExperiencePreferencesForTests();
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
  // PHASE 7C — PLAYER GETS THE SAME DOCK. It used to get a four-button strip, which meant the immersive
  // view quietly had fewer tools. What actually differs in PLAYER is whether the mouse can reach the
  // DOM, so the dock now follows the POINTER LOCK rather than the mode.
  it("keeps the full dock in PLAYER, with no second minimal strip", async () => {
    viewMode = "player";
    mount();
    const dock = await screen.findByTestId("hud-dock");
    expect(dock.className).not.toMatch(/hidden/i);
    expect(screen.queryByTestId("vo3d-player-hud")).toBeNull();
    // Every daily-use tool is the dock's own, in PLAYER exactly as in OFFICE.
    for (const label of ["Search for a person", "Open Tasks", "Open Company Hub", "Open Global Team Map"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Open Tasks" }));
    expect(await screen.findByTestId("tasks")).toBeTruthy();
  });

  it("hides the dock — without unmounting it — for exactly as long as the pointer is locked", async () => {
    viewMode = "player";
    mount();
    const dock = await screen.findByTestId("hud-dock");
    expect(dock.className).not.toMatch(/hidden/i);

    lockPointer(true);
    // still mounted, and hidden by the dock's own class rather than by a conditional render
    await waitFor(() => expect(screen.getByTestId("hud-dock").className).toMatch(/hidden/i));
    expect(screen.getByTestId("hud-dock").isConnected).toBe(true);

    lockPointer(false); // Esc
    await waitFor(() => expect(screen.getByTestId("hud-dock").className).not.toMatch(/hidden/i));
  });

  it("releases the pointer itself when a tool takes the screen", async () => {
    viewMode = "player";
    overlayToolOpen = false;
    const view = mount();
    await screen.findByTestId("hud-dock");

    lockPointer(true);
    await waitFor(() => expect(screen.getByTestId("hud-dock").className).toMatch(/hidden/i));
    exitPointerLock.mockClear();

    // A tool takes the screen (here the overlay's own — the one visibility rule covers every tool).
    // A panel the player cannot click is worse than no panel, so the HUD hands the pointer back rather
    // than making them discover Esc first.
    overlayToolOpen = true;
    view.rerender(hud());
    expect(exitPointerLock).toHaveBeenCalledTimes(1);

    // Closing it does NOT re-lock and does NOT move anybody: the world is untouched on the way out.
    overlayToolOpen = false;
    setViewMode.mockClear();
    view.rerender(hud());
    expect(setViewMode).not.toHaveBeenCalled();
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

describe("switching view", () => {
  // PHASE 7C CLEANUP — there is NO permanent view widget. Switching is C or Settings -> General, and
  // the office's top-left corner is empty rather than holding a button.
  it("puts no view control on screen at all", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    expect(screen.queryByTestId("vo3d-view-switcher")).toBeNull();
    expect(screen.queryByTestId("vo3d-camera-button")).toBeNull();
    expect(screen.queryByTestId("view-explore")).toBeNull();
  });

  it("puts nothing on screen in PLAYER either — the corners stay empty in every view", async () => {
    mount();
    act(() => notifyViewMode("player"));
    await screen.findByTestId("hud-dock");
    for (const id of ["vo3d-view-switcher", "player-view-third", "player-view-first", "vo3d-player-hint"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  describe("the C shortcut", () => {
    it("cycles Office -> 3D -> Player -> Office, through the world's own entry point", async () => {
      mount();
      await screen.findByTestId("hud-dock");
      fireEvent.keyDown(window, { code: "KeyC", key: "c" });
      expect(setViewMode).toHaveBeenLastCalledWith("explore");
      act(() => notifyViewMode("explore"));
      fireEvent.keyDown(window, { code: "KeyC", key: "c" });
      expect(setViewMode).toHaveBeenLastCalledWith("player");
      act(() => notifyViewMode("player"));
      fireEvent.keyDown(window, { code: "KeyC", key: "c" });
      expect(setViewMode).toHaveBeenLastCalledWith("office");
    });

    it("does not fire while somebody is typing, or inside a panel", async () => {
      mount();
      await screen.findByTestId("hud-dock");

      const field = document.createElement("input");
      document.body.appendChild(field);
      fireEvent.keyDown(field, { code: "KeyC", key: "c" });
      expect(setViewMode).not.toHaveBeenCalled();
      field.remove();

      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      const inner = document.createElement("span");
      dialog.appendChild(inner);
      document.body.appendChild(dialog);
      fireEvent.keyDown(inner, { code: "KeyC", key: "c" });
      expect(setViewMode).not.toHaveBeenCalled();
      dialog.remove();

      // …and Cmd/Ctrl+C is a copy, not a camera.
      fireEvent.keyDown(window, { code: "KeyC", key: "c", metaKey: true });
      expect(setViewMode).not.toHaveBeenCalled();
    });

    it("leaves V to player/PlayerInput, which has always owned it", async () => {
      mount();
      await screen.findByTestId("hud-dock");
      act(() => notifyViewMode("player"));
      fireEvent.keyDown(window, { code: "KeyV", key: "v" });
      // A second listener here would toggle first/third twice per press. PlayerInput is the one that
      // binds V, while PLAYER is active — this file must add nothing.
      expect(setPlayerView).not.toHaveBeenCalled();
    });
  });

  it("keeps first/third person as a world entry point, with no button of its own", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    act(() => notifyViewMode("player"));
    expect(screen.queryByTestId("player-view-first")).toBeNull();
    // The verb still exists and is still the one V drives through player/PlayerInput.
    worldRef.current.setPlayerView("first");
    expect(setPlayerView).toHaveBeenCalledWith("first");
  });
});

// ---- PHASE 7C — HUD REFINEMENT --------------------------------------------------------------------
describe("the HUD under a screen-owning tool", () => {
  it("steps the dock aside in PLAYER for a tool, and C still gets you out", async () => {
    mount();
    act(() => notifyViewMode("player"));
    await screen.findByTestId("hud-dock");

    fireEvent.click(screen.getByRole("button", { name: "Open Tasks" }));
    await waitFor(() => expect(screen.getByTestId("hud-dock").className).toMatch(/hidden/i));
    // Nothing is on screen to leave PLAYER with — which is fine, because the key is not on screen
    // either. The panel is a modal, so C is correctly refused while it holds focus…
    setViewMode.mockClear();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    fireEvent.keyDown(dialog, { code: "KeyC", key: "c" });
    expect(setViewMode).not.toHaveBeenCalled();
    dialog.remove();
    // …and works again from the world once the tool is closed.
    fireEvent.keyDown(window, { code: "KeyC", key: "c" });
    expect(setViewMode).toHaveBeenLastCalledWith("office");
  });
});

describe("the starting-view preference", () => {
  it("does not touch the camera when the office is the chosen view", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    expect(setViewMode).not.toHaveBeenCalled();
  });

  // PHASE 7C — it is also a LIVE control. Picking a view in Settings used to write the preference and
  // leave the camera where it was, so the panel looked broken until the next launch.
  it("switches the camera immediately when the preference changes in Settings", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    expect(setViewMode).not.toHaveBeenCalled();

    act(() => setExperiencePreference("defaultView", "player"));
    expect(setViewMode).toHaveBeenLastCalledWith("player");

    act(() => setExperiencePreference("defaultView", "office"));
    expect(setViewMode).toHaveBeenLastCalledWith("office");
  });

  it("does not re-apply the preference when the employee switches view by hand", async () => {
    setExperiencePreference("defaultView", "explore");
    mount();
    await screen.findByTestId("hud-dock");
    expect(setViewMode).toHaveBeenCalledTimes(1);

    // The camera button does not touch the preference, so nothing here pulls the view back.
    act(() => notifyViewMode("office"));
    expect(setViewMode).toHaveBeenCalledTimes(1);
  });

  it("opens in the chosen view once, and never overrides a later manual switch", async () => {
    setExperiencePreference("defaultView", "explore");
    const { rerender } = mount();
    await screen.findByTestId("hud-dock");
    expect(setViewMode).toHaveBeenCalledWith("explore");
    expect(setViewMode).toHaveBeenCalledTimes(1);

    notifyViewMode("office");
    rerender(<div />);
    expect(setViewMode).toHaveBeenCalledTimes(1);
  });
});
