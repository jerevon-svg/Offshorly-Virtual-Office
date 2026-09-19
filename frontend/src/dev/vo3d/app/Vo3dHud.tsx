// vo3d app — PHASE 7A: THE BRANDED HUD.
//
// V1's dock, over V2's world. Not a port and not a redesign: components/OfficeMap/HudDock is mounted here
// unforked, and every tile in it is V1's own control calling V1's own service. HudDock was already built
// for this — it "owns layout and nothing else", holds no feature state, performs no fetches, and takes
// each control as the caller's existing component or handler. So the whole of this file is a caller.
//
// WHAT IS HERE, and why each one is:
//   identity      PlayerHud in dock layout — avatar, first name, Level, XP meter, Coins. It reads the
//                 progression store itself, so it needs nothing from V2.
//   status        StatusPicker — the availability pill, gated on V1's attendance exactly as V1 gates it.
//   working time  WorkingStatusIndicator, over useCheckoutFlow's session clock, started from the SERVER's
//                 checked_in_at so a reload resumes the same clock rather than restarting it.
//   Search        V1's spotlight, whose Locate now means "select that person in the 3D world" — the same
//                 selection a click on their body makes (Phase 6D), and whose Chat/Call run Phase 6D's
//                 own handlers. No second implementation of either.
//   Chat          V1's MessageNotificationBadge tile plus its ConversationListPanel — the real inbox,
//                 reachable without selecting anybody, routing each row through the caller's existing
//                 conversation opener. New Message / New Group Chat are V1's EmployeePickerModal.
//   Boards        V1's WhiteboardPanel on the office room board — the same scope V1's Boards tile opens.
//   Map           V1's TeamMapPanel, lazily imported exactly as V1 imports it.
//   Hub / Tasks / Rewards / Notifs / Settings — V1's panels, unchanged.
//
// ONE VISIBILITY RULE. V1 has a single `officeToolOpen` line that every full-screen tool joins, and the
// dock and the Toucan step aside for all of them. V2 had a Search-only special case, which meant opening
// Tasks or the inbox left the dock sitting on top of the panel. The same one-line rule is used here, and
// a future tool joins it by extending the line rather than by adding a second mechanism.
//
// WHAT IS DELIBERATELY NOT HERE:
//   • CHECK OUT. The dock's Check out button starts V1's Log Time → Zoho → checkout flow, which in V1 is
//     also a scripted walk (goodbye, Reception, out the door) that V2 has no choreography for. A button
//     that ran half of that is worse than one that is not offered yet, so the working-time pill ships and
//     the flow does not. Attendance is unaffected: V1's own office still owns check-out.
//   • The Toucan flyer, the spatial chat windows and the world-space chat indicators — Phase 7B.
//
// ONE HUD SYSTEM, THREE PRESENTATIONS (Part 5). The tools, their state and their subscriptions are the
// same objects in every view — only what is put on screen changes:
//
//   Office / 3D   the full established dock. 3D is a looked-at world like Office, so there is no reason
//                 to take daily-use controls away from somebody exploring it.
//   Player        a MINIMAL strip: the availability pill, and the handful of tools an employee actually
//                 reaches for mid-session (Chat, Hub, Map, Tasks). The full dock is never laid over an
//                 immersive view, and the tools are never taken away either — opening one from here is
//                 the same panel, with the same state, that the dock opens.
//
// The dock is HIDDEN, not unmounted, whenever it steps aside (HudDock's own `hidden` prop, which exists
// for exactly this), so nothing is re-mounted and no subscription is dropped on a view change.
//
// THE POINTER CONTRACT. PLAYER grabs the pointer to look around; Esc releases it (player/PlayerInput
// deliberately leaves Esc to the browser, as the one guaranteed way out), the strip is then clickable,
// and one click on the world takes the pointer back. The view switcher states which of the two you are
// in rather than leaving it to be discovered.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { Vo3dWorld } from "./world";
import type { Vo3dViewMode } from "./viewMode";
import type { Vo3dCoworkerAction } from "./CoworkerActionMenu";
import { emailKey, selfEmailKey } from "../adapters/v1Coworkers";
import type { V1Attendance } from "../adapters/v1Attendance";
import HudIcon from "../../../components/HudIcon";
import { HudDock, type HudDockEntry } from "../../../components/OfficeMap/HudDock";
import { Vo3dViewSwitcher } from "./Vo3dViewSwitcher";
import { HudSettings } from "../../../components/OfficeMap/HudSettings";
import { PlayerHud } from "../../../components/OfficeMap/PlayerHud";
import { StatusPicker } from "../../../components/OfficeMap/StatusPicker";
import { TasksPanel, type TasksTab } from "../../../components/OfficeMap/TasksPanel";
import { RewardsPanel } from "../../../components/OfficeMap/RewardsPanel";
import { CompanyHub } from "../../../components/OfficeMap/CompanyHub";
import { openCompanyHub, useCompanyHub } from "../../../services/hub/companyHubStore";
import { NotificationCenter, type NotificationDestination } from "../../../components/OfficeMap/NotificationCenter";
import { SearchSpotlight } from "../../../components/OfficeMap/SearchSpotlight";
import { MessageNotificationBadge } from "../../../components/Chat/MessageNotificationBadge";
import { ConversationListPanel } from "../../../components/Chat/ConversationListPanel";
import { EmployeePickerModal } from "../../../components/Chat/EmployeePickerModal";
import { WhiteboardPanel } from "../../../components/Whiteboard/WhiteboardPanel";
import { OFFICE_ROOM_ID } from "../../../services/whiteboard/whiteboardClient";
import { chatMode } from "../../../services/chat";
import type { Conversation } from "../../../services/chat/types";
import { WorkingStatusIndicator } from "../../../components/OfficeMap/checkout/WorkingStatusIndicator";
import { useCheckoutFlow } from "../../../components/OfficeMap/useCheckoutFlow";
import { refreshClaimable, useClaimableCount } from "../../../services/quests/claimableStore";
import { isRealZohoMode } from "../../../services/zoho";
import { getCurrentUserId } from "../../../auth/useAuthGate";
import type { OfficeStatus } from "../../../services/presence/status";
import type { AssetLayer } from "../../../types/office";
import type { OfficePerson } from "../../../services/office/floorMerge";
import styles from "./Vo3dHud.module.css";

// Global Team Map — React.lazy so MapLibre (~250 KB) only loads when someone opens the map. V1's own rule.
const TeamMapPanel = lazy(() => import("../../../components/TeamMap/TeamMapPanel"));

export interface Vo3dHudProps {
  worldRef: { current: Vo3dWorld | null };
  ready: boolean;
  /** V1's attendance, from the ONE poller app/Vo3dHost.tsx already runs (adapters/v1Attendance). */
  attendance: V1Attendance;
  /** The coworkers V2 is actually drawing, as V1 layers — Search offers these and nobody else, because
   *  a person the world has no body for cannot be located in it. */
  peopleLayers: readonly AssetLayer[];
  statusByEmail: Record<string, OfficeStatus>;
  /** Phase 6D's own action handler, reused verbatim so Search's Chat/Call are the menu's Chat/Call. */
  onCoworkerAction: (email: string, displayName: string, action: Vo3dCoworkerAction) => void;
  /** Open a profile. Owned by the host so the HUD and the interaction menu share one profile modal. */
  onOpenProfile: (email: string) => void;
  /** V1's roster, for the Map and for the New Message / New Group Chat pickers. */
  people: readonly OfficePerson[];
  /** The viewer's chat identity, and V1's own conversation rows + unread total (useUnreadTotal). */
  selfId: string;
  conversations: Conversation[];
  unreadTotal: number;
  resolveDisplayName: (email: string) => string;
  /** The caller's EXISTING conversation opener — it, not this file, decides DM vs group and which slot
   *  the panel lands in. Opening the inbox must never become a second way to open a conversation. */
  onSelectConversation: (conv: Conversation) => void;
  /** Open (or create) a DM with one person — New Message / Find Person's destination, and the Map's. */
  onOpenDirectMessage: (email: string) => void;
  /** Start a group conversation with these people — New Group Chat's destination. */
  onStartGroup: (emails: string[], groupName?: string) => void;
  /** True while the overlay owns the screen with a panel of its own (the profile modal), so the ONE
   *  visibility rule below covers those too rather than only the tools this file holds. */
  overlayToolOpen: boolean;
}

export function Vo3dHud({
  worldRef, ready, attendance, peopleLayers, statusByEmail, onCoworkerAction, onOpenProfile,
  people, selfId, conversations, unreadTotal, resolveDisplayName, onSelectConversation,
  onOpenDirectMessage, onStartGroup, overlayToolOpen,
}: Vo3dHudProps) {
  const self = selfEmailKey();
  const [viewMode, setViewMode] = useState<Vo3dViewMode>("office");
  /** V1's own dock-tool slot: at most one full-screen tool from the dock at a time. */
  const [dockTool, setDockTool] = useState<null | "search" | "chat">(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [tasksTab, setTasksTab] = useState<TasksTab>("quests");
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [teamMapOpen, setTeamMapOpen] = useState(false);
  const [chatPickerMode, setChatPickerMode] = useState<null | "message" | "group">(null);
  const companyHub = useCompanyHub();
  const claimableCount = useClaimableCount();

  // WHICH CAMERA IS DRIVING. Pushed by the world; told once on subscribe, so the first render after the
  // world lands is already correct rather than assuming OFFICE.
  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world) return;
    return world.subscribeViewMode(setViewMode);
  }, [ready, worldRef]);

  // V1's own session clock. `timeInMs` is the SERVER's checked_in_at, not a mount timestamp, so a reload
  // (or a second browser) resumes the same session rather than restarting it — V1's rule, kept.
  const timeInMs = useMemo(() => {
    if (attendance.record?.status !== "CHECKED_IN") return null;
    const parsed = attendance.record.checkedInAt ? Date.parse(attendance.record.checkedInAt) : NaN;
    return Number.isFinite(parsed) ? parsed : Date.now();
  }, [attendance.record]);
  // `hourDecimal` is part of useCheckoutFlow's params for API stability and is not read by the reminder
  // trigger (see the hook). V2 has its own day/night clock in the world and deliberately does not feed it
  // in here: this HUD uses the flow for the worked-time label only.
  const checkoutFlow = useCheckoutFlow({ employeeId: getCurrentUserId(), timeInMs, hourDecimal: 0 });
  const hasCheckedIn = attendance.record?.status === "CHECKED_IN";
  const timeTrackingVisible = import.meta.env.DEV || isRealZohoMode();

  // The Tasks badge must be right BEFORE Tasks is ever opened — fetched once the HUD exists and re-fetched
  // whenever the panel closes (a claim inside it already refreshes on confirmation). V1's own rule.
  useEffect(() => {
    if (!ready) return;
    void refreshClaimable();
  }, [ready, tasksOpen]);

  // ONE CONDITION for "a tool owns the screen". V1's officeToolOpen, line for line in spirit: the dock
  // steps aside for ANY of them, and a future tool joins by extending this expression. The dock is
  // HIDDEN, never unmounted, so every tool keeps its own state and subscriptions while it is out of view.
  const officeToolOpen =
    dockTool !== null ||
    companyHub.isOpen ||
    tasksOpen ||
    rewardsOpen ||
    settingsOpen ||
    notificationsOpen ||
    boardsOpen ||
    teamMapOpen ||
    chatPickerMode !== null ||
    overlayToolOpen;
  // PART 2 — WHAT IS BELOW THE PANELS. The floating chat windows sit above the dock, so when the dock
  // steps aside (a tool has the screen, or PLAYER owns it) they must drop to the bottom edge rather than
  // leave a band of empty space, and rise again when it returns. Published as a CSS variable rather than
  // threaded through props: every panel that needs to clear the dock reads the same value, and V1's own
  // --vo-dock-clearance (which already re-declares itself on short viewports) stays the measure.
  const dockVisible = !(viewMode === "player" || officeToolOpen);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--vo3d-dock-clearance", dockVisible ? "var(--vo-dock-clearance, 104px)" : "16px");
    return () => {
      root.style.removeProperty("--vo3d-dock-clearance");
    };
  }, [dockVisible]);

  /** The z-index 60 modal family the dock must step BELOW rather than merely behind. */
  const anyModalOpen = companyHub.isOpen || tasksOpen || rewardsOpen || teamMapOpen || overlayToolOpen;

  const navigate = useCallback((destination: NotificationDestination): boolean => {
    switch (destination.kind) {
      case "profileFeed":
        onOpenProfile(destination.email);
        return true;
      case "achievements":
        if (!self) return false;
        onOpenProfile(self);
        return true;
      case "quests":
        setTasksTab("quests");
        setTasksOpen(true);
        return true;
      case "missions":
        setTasksTab("missions");
        setTasksOpen(true);
        return true;
      case "hub":
        openCompanyHub("manual");
        return true;
      // "conversation" and "checkout" are honestly refused rather than half-performed: the conversation
      // list is Phase 7B's and check-out is not offered here at all (see the header). NotificationCenter
      // keeps the panel open on a false, which is the correct outcome for a destination that does not
      // exist yet — it does not pretend to have navigated.
      default:
        return false;
    }
  }, [onOpenProfile, self]);

  /** Search's row actions, all three routed into work that already exists. */
  const locate = useCallback((layer: AssetLayer) => {
    setDockTool(null);
    // SELECT, which is exactly what clicking their body does — the world opens their interaction card
    // anchored to them, and a person the world has no body for is simply not selected.
    worldRef.current?.selectCoworkerByEmail?.(emailKey(layer.id));
  }, [worldRef]);
  const nameFor = useCallback(
    (layer: AssetLayer) => layer.name?.trim() || layer.id.split("@")[0] || layer.id,
    [],
  );
  const searchAction = useCallback((layer: AssetLayer, action: Vo3dCoworkerAction) => {
    setDockTool(null);
    onCoworkerAction(emailKey(layer.id), nameFor(layer), action);
  }, [nameFor, onCoworkerAction]);

  /** Everybody V1's roster lists, minus the viewer — the picker's own shape. */
  const pickerPeople = useMemo(
    () =>
      people
        .filter((p) => p.email.trim().toLowerCase() !== selfId)
        .map((p) => ({ email: p.email, displayName: p.displayName ?? p.email })),
    [people, selfId],
  );

  const statusPicker = <StatusPicker checkedIn={hasCheckedIn && checkoutFlow.state !== "CHECKED_OUT"} />;

  // Order is V1's, left to right: Profile | Coins+XP | Search | Hub | Tasks | Rewards | Map |
  // Working | Notifs | Settings.
  const entries: HudDockEntry[] = [
    { kind: "action", key: "search", icon: <HudIcon name="search" />, label: "Search",
      ariaLabel: "Search for a person", active: dockTool === "search", onClick: () => setDockTool("search") },
    { kind: "action", key: "hub", icon: <HudIcon name="hub" />, label: "Hub",
      ariaLabel: "Open Company Hub", active: companyHub.isOpen, onClick: () => openCompanyHub("manual") },
    { kind: "action", key: "tasks", icon: <HudIcon name="tasks" />, label: "Tasks",
      ariaLabel: "Open Tasks", active: tasksOpen, badge: claimableCount, onClick: () => setTasksOpen(true) },
    ...(chatMode === "real"
      ? [{
          kind: "node" as const,
          key: "chat",
          node: (
            <MessageNotificationBadge
              label="Chat"
              total={unreadTotal}
              conversations={conversations}
              selfId={selfId}
              resolveDisplayName={resolveDisplayName}
              onSelectConversation={onSelectConversation}
              onNewMessage={() => setChatPickerMode("message")}
              onFindPerson={() => setDockTool("search")}
              onNewGroupChat={() => setChatPickerMode("group")}
              // The list itself is the dock's Chat TOOL (ConversationListPanel below): setting dockTool
              // is what hides the dock, through the one visibility rule. The tile keeps its unread badge.
              active={dockTool === "chat"}
              onOpen={() => setDockTool((tool) => (tool === "chat" ? null : "chat"))}
            />
          ),
        }]
      : []),
    { kind: "action", key: "rewards", icon: <HudIcon name="rewards" />, label: "Rewards",
      ariaLabel: "Open Rewards", active: rewardsOpen, onClick: () => setRewardsOpen(true) },
    ...(chatMode === "real"
      ? [{
          kind: "action" as const,
          key: "boards",
          icon: <HudIcon name="boards" />,
          label: "Boards",
          ariaLabel: "Open office whiteboards",
          active: boardsOpen,
          onClick: () => setBoardsOpen(true),
        }]
      : []),
    { kind: "action", key: "map", icon: <HudIcon name="map" />, label: "Map",
      ariaLabel: "Open Global Team Map", active: teamMapOpen, onClick: () => setTeamMapOpen(true) },
    { kind: "separator", key: "sep-utility" },
    { kind: "node", key: "notifications",
      node: (
        <NotificationCenter
          onNavigate={navigate}
          modalOpen={anyModalOpen}
          label="Notifs"
          // Screen-owning, exactly as in V1: the panel's open state feeds the one visibility rule above.
          onOpenChange={setNotificationsOpen}
        />
      ) },
    { kind: "action", key: "settings", icon: <HudIcon name="settings" />, label: "Settings",
      ariaLabel: "Settings", active: settingsOpen, onClick: () => setSettingsOpen(true) },
  ];
  if (timeTrackingVisible) {
    entries.push(
      { kind: "separator", key: "sep-time" },
      { kind: "node", key: "time",
        node: (
          <div className={styles.timeGroup}>
            <WorkingStatusIndicator compact state={checkoutFlow.state} workedLabel={checkoutFlow.workedLabel} />
          </div>
        ) },
    );
  }

  return (
    <>
      <HudDock
        // HIDDEN, not unmounted — see the header. Search's spotlight owns the screen the same way it does
        // in V1, so the dock steps out of its way too.
        // ONE RULE (see officeToolOpen). PLAYER additionally hides it because a pointer-locked player
        // cannot click a DOM control at all.
        hidden={!dockVisible}
        behindModal={anyModalOpen}
        entries={entries}
        identity={
          <PlayerHud
            layout="dock"
            statusSlot={statusPicker}
            onProfileClick={self ? () => onOpenProfile(self) : undefined}
          />
        }
      />
      {viewMode === "player" && (
        // THE MINIMAL PLAYER HUD. Same controls, same handlers, same panels as the dock's — this is a
        // presentation of the one HUD system, not a second one. Nothing decorative: every button here
        // opens something real.
        <div className={styles.playerBar} data-testid="vo3d-player-hud">
          <div className={styles.playerStatus}>{statusPicker}</div>
          <button type="button" className={styles.playerTool} aria-label="Open Tasks" onClick={() => setTasksOpen(true)}>
            <HudIcon name="tasks" />
          </button>
          {chatMode === "real" && (
            <button
              type="button"
              className={styles.playerTool}
              aria-label={unreadTotal > 0 ? `${unreadTotal} unread message${unreadTotal === 1 ? "" : "s"}` : "Conversations"}
              onClick={() => setDockTool((tool) => (tool === "chat" ? null : "chat"))}
            >
              <HudIcon name="chat" />
              {unreadTotal > 0 && <span className={styles.playerBadge}>{unreadTotal > 9 ? "9+" : unreadTotal}</span>}
            </button>
          )}
          <button type="button" className={styles.playerTool} aria-label="Open Company Hub" onClick={() => openCompanyHub("manual")}>
            <HudIcon name="hub" />
          </button>
          <button type="button" className={styles.playerTool} aria-label="Open Global Team Map" onClick={() => setTeamMapOpen(true)}>
            <HudIcon name="map" />
          </button>
        </div>
      )}
      <Vo3dViewSwitcher worldRef={worldRef} ready={ready} />
      <SearchSpotlight
        open={dockTool === "search"}
        onClose={() => setDockTool(null)}
        people={peopleLayers as AssetLayer[]}
        statusByLayerId={statusByEmail}
        onLocate={locate}
        onChat={(layer) => searchAction(layer, "chat")}
        onCall={(layer) => searchAction(layer, "call")}
      />
      {chatMode === "real" && (
        // The inbox. Owns no chat state: the rows are the caller's conversations and picking one goes
        // straight through its existing opener, which still decides DM vs group and which slot it lands
        // in. Reachable without selecting anybody — that is the point of it being a dock tool.
        <ConversationListPanel
          open={dockTool === "chat"}
          conversations={conversations}
          selfId={selfId}
          resolveDisplayName={resolveDisplayName}
          onSelectConversation={(conv) => {
            setDockTool(null);
            onSelectConversation(conv);
          }}
          onNewMessage={() => {
            setDockTool(null);
            setChatPickerMode("message");
          }}
          // Find Person is the EXISTING Search dock tool — the same employee search, locate, chat and
          // call actions it already offers. No second person-finder.
          onFindPerson={() => setDockTool("search")}
          onNewGroupChat={() => {
            setDockTool(null);
            setChatPickerMode("group");
          }}
          onClose={() => setDockTool(null)}
        />
      )}
      {chatMode === "real" && chatPickerMode && (
        <EmployeePickerModal
          mode={chatPickerMode === "group" ? "multi" : "single"}
          title={chatPickerMode === "group" ? "New Group Chat" : "New Message"}
          people={pickerPeople}
          onClose={() => setChatPickerMode(null)}
          onConfirm={(emails, groupName) => {
            setChatPickerMode(null);
            if (chatPickerMode === "group") onStartGroup(emails, groupName);
            else if (emails[0]) onOpenDirectMessage(emails[0]);
          }}
        />
      )}
      {boardsOpen && (
        // The OFFICE board, the same scope V1's Boards tile opens. The panel owns its own boards,
        // access and realtime; this only says which room's boards to show.
        <WhiteboardPanel
          scope={{ kind: "room", id: OFFICE_ROOM_ID }}
          title="Office"
          onClose={() => setBoardsOpen(false)}
          resolveDisplayName={resolveDisplayName}
        />
      )}
      {teamMapOpen && (
        <Suspense fallback={null}>
          <TeamMapPanel
            viewerEmail={selfId || null}
            roster={people as OfficePerson[]}
            onClose={() => setTeamMapOpen(false)}
            onOpenProfile={(email) => {
              setTeamMapOpen(false);
              onOpenProfile(email);
            }}
            onOpenChat={
              chatMode === "real"
                ? (email) => {
                    setTeamMapOpen(false);
                    onOpenDirectMessage(email);
                  }
                : undefined
            }
          />
        </Suspense>
      )}
      {companyHub.isOpen && <CompanyHub />}
      {tasksOpen && <TasksPanel tab={tasksTab} onTabChange={setTasksTab} onClose={() => setTasksOpen(false)} />}
      {rewardsOpen && <RewardsPanel onClose={() => setRewardsOpen(false)} />}
      {settingsOpen && (
        <HudSettings
          onClose={() => setSettingsOpen(false)}
          // PART 6 — the developer inspection rig lives behind V1's OWN Settings > Developer section,
          // which is where V1 already relocated its day/night scrubber and checkout debug panel. DEV
          // builds only: HudSettings renders this slot in its own DEV-gated section, so production never
          // sees it and nothing is removed from the rig itself.
          devTools={
            import.meta.env.DEV ? (
              <label className={styles.devToggle}>
                <input
                  type="checkbox"
                  defaultChecked={worldRef.current?.devToolsVisible() ?? false}
                  onChange={(e) => worldRef.current?.setDevToolsVisible(e.target.checked)}
                  data-testid="vo3d-dev-tools-toggle"
                />
                3D inspection panel &amp; frame-time overlay
              </label>
            ) : undefined
          }
        />
      )}
    </>
  );
}

export default Vo3dHud;
