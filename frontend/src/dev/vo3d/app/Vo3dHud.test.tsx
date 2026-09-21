// Phase 7A — THE BRANDED HUD OVER V2. What is asserted is the WIRING, which is what a host can get
// wrong: a dock that stays up while the pointer is locked, a pill that lies about the work session, or a
// Search row that reaches a second implementation of Chat instead of the one the interaction card uses.
//
// V1's dock, pills and spotlight are REAL here — they are the thing under test. Only the panels that
// fetch are stubbed, and only so these stay about wiring.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dHud } from "./Vo3dHud";
import { useCheckoutFlow } from "../../../components/OfficeMap/useCheckoutFlow";
import { getCurrentUserId } from "../../../auth/useAuthGate";
import type { Vo3dWorld } from "./world";
import type { V1Attendance } from "../adapters/v1Attendance";
import type { Vo3dViewMode } from "./viewMode";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../../auth/currentUserStore";
import type { AssetLayer } from "../../../types/office";
import type { NotificationDestination } from "../../../components/OfficeMap/NotificationCenter";
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
// The bell itself is V1's and is tested there; what this file owns is the DESTINATION HANDLER V2 hands
// it. The stub therefore keeps the button and captures `onNavigate` so the branches can be driven
// directly, which is the only way to reach them without a server-backed notification list.
let navigate: ((d: NotificationDestination) => boolean | void) | null = null;
vi.mock("../../../components/OfficeMap/NotificationCenter", () => ({
  NotificationCenter: ({ label, onNavigate }: {
    label: string;
    onNavigate?: (d: NotificationDestination) => boolean | void;
  }) => {
    navigate = onNavigate ?? null;
    return <button type="button">{label}</button>;
  },
}));
vi.mock("../../../components/OfficeMap/TasksPanel", () => ({ TasksPanel: () => <div data-testid="tasks" /> }));
vi.mock("../../../components/OfficeMap/RewardsPanel", () => ({ RewardsPanel: () => <div data-testid="rewards" /> }));
vi.mock("../../../components/OfficeMap/CompanyHub", () => ({ CompanyHub: () => <div data-testid="hub" /> }));
vi.mock("../../../components/OfficeMap/HudSettings", () => ({ HudSettings: () => <div data-testid="settings" /> }));
vi.mock("../../../components/Whiteboard/WhiteboardPanel", () => ({
  WhiteboardPanel: ({ scope, title, onAskToucan, onClose }: {
    scope: { kind: string; id: string }; title: string;
    onAskToucan?: (b: { id: string; title: string }) => void; onClose: () => void;
  }) => (
    <div data-testid="boards">
      {`${scope.kind}:${scope.id}:${title}`}
      {/* aria-label only, so the panel's own textContent assertion stays exactly what it was. */}
      {onAskToucan && (
        <button type="button" aria-label="Ask Toucan about this board"
          onClick={() => onAskToucan({ id: "b1", title: "Sprint plan" })} />
      )}
      <button type="button" aria-label="Close boards" onClick={onClose} />
    </div>
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
const caveInvite = vi.fn((_email: string) => {});
/** A viewer standing in the Cave, already in the meeting — the only state that offers Invite. */
const caveMeetingState = {
  inside: true, status: "connected", session: "cave-all-hands", kind: "meeting",
  mic: true, camera: false, sharing: false, cameras: 0, people: 1,
  live: true, host: "bon@offshorly.com", isHost: true, presenter: "", note: "",
};

const world = {
  subscribeViewMode: (cb: (m: Vo3dViewMode) => void) => {
    viewModeSubs.push(cb);
    cb(viewMode);
    return () => { viewModeSubs = viewModeSubs.filter((x) => x !== cb); };
  },
  subscribePlayerView: (cb: (v: "first" | "third") => void) => { cb("third"); return () => {}; },
  setViewMode,
  setPlayerView,
  requestPointerLock: vi.fn(),
  devToolsVisible: () => false,
  setDevToolsVisible: vi.fn(),
  exitPlayerMode,
  selectCoworkerByEmail,
  // PHASE 7D. The Cave's meeting bridge, as the panel and the invite picker reach it.
  caveMeeting: {
    subscribe: (cb: (s: { inside: boolean; status: string }) => void) => {
      cb(caveMeetingState as never);
      return () => {};
    },
    start: vi.fn(async () => {}),
    setMic: vi.fn(async () => {}),
    setCamera: vi.fn(async () => {}),
    setSharing: vi.fn(async () => {}),
    leave: vi.fn(),
    observe: vi.fn(async () => {}),
    invite: caveInvite,
  },
} as unknown as Vo3dWorld;
const worldRef = { current: world };

const layer = (email: string, name: string): AssetLayer =>
  ({ id: email, kind: "character", path: "", x: 0, y: 0, width: 26, height: 37, transform: null, name }) as AssetLayer;

const onCoworkerAction = vi.fn((_e: string, _n: string, _a: string) => {});
const onOpenProfile = vi.fn((_e: string, _landing?: { tab: string; postId: string | null }) => {});
const onOpenConversation = vi.fn((_id: string) => {});
const onSelectConversation = vi.fn((_c: unknown) => {});
const onOpenDirectMessage = vi.fn((_e: string) => {});
const onStartGroup = vi.fn((_e: string[], _n?: string) => {});
const onOpenCurrentRoom = vi.fn();
const onCallToucan = vi.fn();
const onAskToucanAboutBoard = vi.fn((_b: { id: string; title: string }) => {});
const onClearToucanBoardContext = vi.fn();
const onStartCheckout = vi.fn();
/** Set per test: an undefined handler is a host with no checkout journey, which offers no button. */
let checkoutHandler: (() => void) | undefined = onStartCheckout;
let conversations: never[] = [];
let overlayToolOpen = false;
let toucanAvailable = true;
let toucanCalled = false;
let toucanState: "roaming" | "approaching" | "attending" = "roaming";

function attendanceOf(status: "CHECKED_IN" | "CHECKED_OUT", checkedInAt: string | null): V1Attendance {
  return {
    access: status === "CHECKED_IN" ? "permitted" : "denied",
    record: { email: SELF, status, checkedInAt, checkedOutAt: null },
    apply: vi.fn(),
    refresh: vi.fn(),
  };
}

/** PHASE 7E — the flow moved to app/Vo3dOverlay.tsx (it is driven by the exit journey now) and is passed
 *  in. The HUD is still tested against a REAL `useCheckoutFlow`, created here exactly as the overlay
 *  creates it, so the working-time pill and the availability gate are exercised against the real hook. */
/** The live flow the mounted HUD is reading, so a test can drive it the way the host does. */
let startedFlow: ReturnType<typeof useCheckoutFlow> | null = null;
type HudProps = Omit<Parameters<typeof Vo3dHud>[0], "checkoutFlow">;
function Hud(props: HudProps) {
  const rec = props.attendance.record;
  const timeInMs = rec?.status === "CHECKED_IN" && rec.checkedInAt ? Date.parse(rec.checkedInAt) : null;
  const flow = useCheckoutFlow({ employeeId: getCurrentUserId(), timeInMs, hourDecimal: 0 });
  startedFlow = flow;
  return <Vo3dHud {...props} checkoutFlow={flow} />;
}

function hud(attendance = attendanceOf("CHECKED_IN", new Date(Date.now() - 90 * 60_000).toISOString())) {
  return (
    <Hud
      worldRef={worldRef}
      ready
      attendance={attendance}
      peopleLayers={[layer(ALEX, "Alex Cruz")]}
      statusByEmail={{ [ALEX]: "AVAILABLE" }}
      onCoworkerAction={onCoworkerAction}
      onOpenProfile={onOpenProfile}
      onOpenConversation={onOpenConversation}
      people={[{ email: ALEX, displayName: "Alex Cruz" } as never]}
      selfId={SELF}
      conversations={conversations}
      unreadTotal={0}
      resolveDisplayName={(e) => e}
      onSelectConversation={onSelectConversation}
      onOpenDirectMessage={onOpenDirectMessage}
      onStartGroup={onStartGroup}
      overlayToolOpen={overlayToolOpen}
      onOpenCurrentRoom={onOpenCurrentRoom}
      toucanAvailable={toucanAvailable}
      toucanCalled={toucanCalled}
      toucanState={toucanState}
      onCallToucan={onCallToucan}
      onAskToucanAboutBoard={onAskToucanAboutBoard}
      onClearToucanBoardContext={onClearToucanBoardContext}
      onStartCheckout={checkoutHandler}
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
  checkoutHandler = onStartCheckout;
  onStartCheckout.mockClear();
  toucanAvailable = true;
  toucanCalled = false;
  toucanState = "roaming";
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

  // ---- THE CHECK OUT BUTTON -----------------------------------------------------------------------
  // V1's dock has one directly under the same pill (OfficeMap.tsx's `checkoutOfferable`), and
  // WorkingStatusIndicator's `compact` form exists for exactly that pairing. What these assert is that
  // V2's copy runs V1's flow through the HOST's existing entry point and adds no rule of its own.
  const checkoutBtn = () => screen.queryByRole("button", { name: "Check out" });

  it("offers Check out directly below the working-time pill while on the clock", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    const button = checkoutBtn();
    expect(button).toBeTruthy();
    // DIRECTLY BELOW, not merely somewhere in the dock: same group, pill first.
    const group = button!.parentElement!;
    expect(group.textContent).toMatch(/1h 30m/);
    expect(group.firstElementChild!.textContent).toMatch(/1h 30m/);
    expect(group.lastElementChild).toBe(button);
  });

  it("starts the HOST's existing checkout journey, and nothing else", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    fireEvent.click(checkoutBtn()!);
    expect(onStartCheckout).toHaveBeenCalledTimes(1);
  });

  it("is not offered to an employee who is not checked in", async () => {
    mount(attendanceOf("CHECKED_OUT", null));
    await screen.findByTestId("hud-dock");
    expect(checkoutBtn()).toBeNull();
  });

  it("is not offered once the journey is already running — no second entry into one flow", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    fireEvent.click(checkoutBtn()!);
    // The host starts the flow; the dock sees a non-IDLE state and stands down. (Driven here by the
    // real hook through the same button the reminder and the exit card also reach.)
    act(() => { startedFlow?.startCheckout(); });
    await waitFor(() => expect(checkoutBtn()).toBeNull());
  });

  it("is not offered at all when the host passes no checkout entry point", async () => {
    checkoutHandler = undefined;
    mount();
    await screen.findByTestId("hud-dock");
    expect(checkoutBtn()).toBeNull();
    // ...and the pill it sits under is unaffected.
    expect(screen.getByText(/1h 30m/)).toBeTruthy();
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


// PHASE 7D — THE INVITE PATH, end to end inside the HUD.
//
// The panel raises the request, the HUD owns the picker (a screen-owning modal, so it joins the one
// visibility rule every other tool joins), and the world's meeting bridge sends it. What is pinned here
// is that the picker's confirm reaches `caveMeeting.invite` and NOT any spatial-call path.
describe("inviting somebody to the Cave meeting", () => {
  beforeEach(() => {
    caveInvite.mockClear();
  });

  it("opens the picker from the panel and sends the MEETING invitation on confirm", async () => {
    mount();
    fireEvent.click(await screen.findByTestId("cave-meeting-invite"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Invite to the Cave meeting");

    fireEvent.click(screen.getByText("Alex Cruz"));
    expect(caveInvite).toHaveBeenCalledWith(ALEX);
    // A spatial ring is a different offer and must never be sent from here.
    expect(onCoworkerAction).not.toHaveBeenCalled();
  });

  it("steps the dock aside while the picker owns the screen, and brings it back after", async () => {
    mount();
    expect(screen.getByTestId("hud-dock").className).not.toMatch(/hidden/i);
    fireEvent.click(await screen.findByTestId("cave-meeting-invite"));
    // Hidden by the dock's own class, never unmounted — the rule every other tool here follows, so the
    // dock keeps its state and subscriptions while the picker is up.
    await waitFor(() => expect(screen.getByTestId("hud-dock").className).toMatch(/hidden/i));

    fireEvent.click(screen.getByLabelText("Close"));
    await waitFor(() => expect(screen.getByTestId("hud-dock").className).not.toMatch(/hidden/i));
    // Closing the picker invites nobody.
    expect(caveInvite).not.toHaveBeenCalled();
  });
});

// PHASE 7G — CALLING THE BIRD.
//
// The assistant is not under test here (it is V1's component, with V1's tests, mounted by the overlay)
// and neither is the flight (world/Toucan has its own). What is pinned is the ENTRY FLOW, which is the
// thing this phase exists to correct: two controls, both of which CALL THE BIRD and neither of which
// opens a panel, plus the one control a pointer-locked player can actually reach.
describe("calling the Toucan", () => {
  it("offers V1's dedicated lower-right summon button", async () => {
    mount();
    const button = await screen.findByTestId("vo3d-toucan-summon");
    expect(button).toHaveAccessibleName("Call the toucan");
    fireEvent.click(button);
    // IT CALLS THE BIRD. It does not open anything — arrival is what opens the assistant, and that is
    // the overlay's effect, not this file's business.
    expect(onCallToucan).toHaveBeenCalledTimes(1);
  });

  it("says the bird is on its way, and refuses a second summon while it flies", async () => {
    toucanCalled = true;
    toucanState = "approaching";
    mount();
    const button = await screen.findByTestId("vo3d-toucan-summon");
    expect(button).toHaveAccessibleName("Toucan is on its way");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onCallToucan).not.toHaveBeenCalled();
  });

  it("becomes Ask once the bird is parked", async () => {
    toucanCalled = true;
    toucanState = "attending";
    mount();
    const button = await screen.findByTestId("vo3d-toucan-summon");
    expect(button).toHaveAccessibleName("Ask the toucan");
    expect(button).not.toBeDisabled();
    // Pressing it again is not an error: V1 treats it as "come here", which an already-parked bird
    // answers by staying exactly where it is.
    fireEvent.click(button);
    expect(onCallToucan).toHaveBeenCalledTimes(1);
  });

  it("is the ONLY Toucan control on the HUD — the duplicate dock tile is gone", async () => {
    mount();
    const dock = await screen.findByTestId("hud-dock");
    // The tile used to live in here doing the very same thing the round button does. Two controls side
    // by side is not two ways in, it is one duplicated affordance.
    expect(dock.textContent).not.toMatch(/toucan/i);
    expect(dock.querySelector('[aria-label="Toucan"]')).toBeNull();
    // Exactly one Toucan entry point on the whole HUD, and it is the round button.
    const controls = screen.getAllByRole("button").filter((b) => /toucan/i.test(b.getAttribute("aria-label") ?? ""));
    expect(controls).toHaveLength(1);
    expect(controls[0]).toBe(screen.getByTestId("vo3d-toucan-summon"));
  });

  it("lives in the BOTTOM-RIGHT CORNER, outside the dock and owing it nothing", async () => {
    mount();
    const button = await screen.findByTestId("vo3d-toucan-summon");
    // Outside the dock's DOM: the dock owns layout and holds no feature state, and this is a
    // fixed-position sibling of it, not a tile in it.
    expect(screen.getByTestId("hud-dock").contains(button)).toBe(false);

    // jsdom applies no CSS-module styles, so the PLACEMENT is asserted against the stylesheet itself —
    // which is the thing that regressed when the button was parked beside the dock instead.
    const css = readFileSync("src/dev/vo3d/app/Vo3dHud.module.css", "utf8");
    const rule = css.slice(css.indexOf(".summon {"), css.indexOf("}", css.indexOf(".summon {")));
    expect(rule).toMatch(/right:\s*18px/);
    expect(rule).toMatch(/bottom:\s*18px/);
    // Nothing measured off the centre-anchored dock any more — a corner is a corner. (The 50% that
    // remains in the rule is the border-radius, which is what makes it round.)
    expect(rule).not.toMatch(/right:\s*calc\(50%/);
    expect(css).not.toMatch(/--vo3d-dock-half/);
  });

  it("summons on T, which is the one control a pointer-locked PLAYER can use", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    lockPointer(true);
    // The dock and the button are both DOM and both gone while the pointer is held.
    expect(screen.queryByTestId("vo3d-toucan-summon")).toBeNull();
    fireEvent.keyDown(window, { code: "KeyT" });
    expect(onCallToucan).toHaveBeenCalledTimes(1);
    // AND THE LOCK IS STILL HELD. Summoning must not take the mouse off somebody mid-walk; the panel
    // that eventually opens is what releases it, in the overlay.
    expect(exitPointerLock).not.toHaveBeenCalled();
    lockPointer(false);
  });

  it("leaves T alone for anybody who is typing, and for a modifier chord", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { code: "KeyT" });
    fireEvent.keyDown(window, { code: "KeyT", metaKey: true });
    fireEvent.keyDown(window, { code: "KeyT", repeat: true });
    expect(onCallToucan).not.toHaveBeenCalled();
    input.remove();
  });

  it("offers neither control, nor the key, when V1's attendance gate says it should not", async () => {
    toucanAvailable = false;
    mount();
    await screen.findByTestId("hud-dock");
    expect(screen.queryByTestId("vo3d-toucan-summon")).toBeNull();
    expect(screen.queryByLabelText("Toucan")).toBeNull();
    fireEvent.keyDown(window, { code: "KeyT" });
    expect(onCallToucan).not.toHaveBeenCalled();
  });

  it("hides the summon button while a tool owns the screen, exactly as the dock steps aside", async () => {
    mount();
    await screen.findByTestId("vo3d-toucan-summon");
    fireEvent.click(screen.getByLabelText("Open Tasks"));
    await waitFor(() => expect(screen.queryByTestId("vo3d-toucan-summon")).toBeNull());
  });

  it("gives Boards W5-C's existing Ask Toucan seam, and drops the board when the panel closes", async () => {
    mount();
    fireEvent.click(await screen.findByLabelText("Open office whiteboards"));
    fireEvent.click(await screen.findByLabelText("Ask Toucan about this board"));
    expect(onAskToucanAboutBoard).toHaveBeenCalledWith({ id: "b1", title: "Sprint plan" });

    fireEvent.click(screen.getByLabelText("Close boards"));
    expect(onClearToucanBoardContext).toHaveBeenCalledTimes(1);
  });

  it("offers Boards no Toucan button at all while the assistant is not available", async () => {
    toucanAvailable = false;
    mount();
    fireEvent.click(await screen.findByLabelText("Open office whiteboards"));
    await screen.findByTestId("boards");
    expect(screen.queryByLabelText("Ask Toucan about this board")).toBeNull();
  });
});

// ---- V1/V2 FINAL PARITY: NOTIFICATION ROUTING + PROFILE DEEP-LINKS --------------------------------
// Two of the three gaps the parity audit found, and both of them were SILENT: the bell's own panel
// closes on a truthy answer and stays put on a false, so a destination that was quietly refused looks
// exactly like one that worked but landed on the wrong tab. These drive `onNavigate` directly, which is
// the handler V2 owns — the panel, the list and the read-marking are V1's and are tested there.
describe("notification destinations", () => {
  /** The handler the bell was actually handed, after a render. */
  async function navigateTo(destination: NotificationDestination): Promise<boolean | void> {
    mount();
    await screen.findByText("Notifs");
    expect(navigate).not.toBeNull();
    return navigate!(destination);
  }

  it("opens a feed-post notification on the FEED tab, with that post to focus", async () => {
    const answer = await navigateTo({ kind: "profileFeed", email: ALEX, postId: "post-42" });
    expect(answer).toBe(true);
    expect(onOpenProfile).toHaveBeenCalledWith(ALEX, { tab: "feed", postId: "post-42" });
  });

  it("still lands on the Feed tab when the notification names no particular post", async () => {
    await navigateTo({ kind: "profileFeed", email: ALEX, postId: null });
    expect(onOpenProfile).toHaveBeenCalledWith(ALEX, { tab: "feed", postId: null });
  });

  it("opens a badge notification on the viewer's OWN Achievements tab", async () => {
    const answer = await navigateTo({ kind: "achievements" });
    expect(answer).toBe(true);
    expect(onOpenProfile).toHaveBeenCalledWith(SELF, { tab: "achievements", postId: null });
  });

  it("routes a conversation notification into the host's EXISTING opener, not a second one", async () => {
    const answer = await navigateTo({ kind: "conversation", conversationId: "conv-7" });
    expect(answer).toBe(true);
    expect(onOpenConversation).toHaveBeenCalledWith("conv-7");
    // The inbox's own opener is a DIFFERENT seam and must not have been reached as well.
    expect(onSelectConversation).not.toHaveBeenCalled();
  });

  it("refuses a conversation destination honestly when the host offers no opener", async () => {
    render(<Hud {...({
      ...hud().props,
      onOpenConversation: undefined,
    } as HudProps)} />);
    await screen.findByText("Notifs");
    expect(navigate!({ kind: "conversation", conversationId: "conv-7" })).toBe(false);
    expect(onOpenConversation).not.toHaveBeenCalled();
  });

  it("leaves CHECKOUT refused — its entry point is Reception, deliberately not the bell", async () => {
    const answer = await navigateTo({ kind: "checkout" });
    expect(answer).toBe(false);
    expect(onOpenProfile).not.toHaveBeenCalled();
    expect(onOpenConversation).not.toHaveBeenCalled();
  });
});
