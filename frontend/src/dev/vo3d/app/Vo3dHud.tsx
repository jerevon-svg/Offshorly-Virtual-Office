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
//   Toucan        V1's BIRD, and through it V1's assistant — reached from ONE control: the round summon
//                 button in the bottom-right corner, outside this dock and owing it nothing. V1's own
//                 front door, in V1's own place, because a companion you call is not the same product as
//                 one more chat icon in a strip.
//
//                 THERE WAS BRIEFLY ALSO A DOCK TILE. It has been removed: two controls doing the same
//                 thing, side by side, is not two ways in — it is one duplicated affordance, and the
//                 round button is the one that reads as the bird. Nothing was lost with it; PLAYER's
//                 reach is the T key (below), which was always the answer for a pointer-locked view
//                 rather than the tile.
//
//                 The button opens nothing: world/Toucan flies the bird, and the ARRIVAL is what opens
//                 the assistant, which is V1's own sequence. The panel and all of its state live in
//                 app/Vo3dOverlay.tsx (it owns the floating window stack the panel sits in).
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
//   Office / 3D   the full established dock.
//   Player        THE SAME FULL DOCK (Phase 7C). It used to be a four-button strip, which meant an
//                 immersive view quietly had fewer tools than the other two. What actually differs in
//                 PLAYER is not which tools exist but whether the mouse can reach them, so the dock now
//                 steps aside for exactly as long as the POINTER IS LOCKED and comes back on Esc — and
//                 opening a tool releases the lock itself, so nobody has to know that rule.
//
// The dock is HIDDEN, not unmounted, whenever it steps aside (HudDock's own `hidden` prop, which exists
// for exactly this), so nothing is re-mounted and no subscription is dropped on a view change.
//
// THE POINTER CONTRACT. PLAYER grabs the pointer to look around; Esc releases it (player/PlayerInput
// deliberately leaves Esc to the browser, as the one guaranteed way out), the strip is then clickable,
// and one click on the world takes the pointer back. The view switcher states which of the two you are
// in rather than leaving it to be discovered.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Vo3dWorld } from "./world";
import type { Vo3dCoworkerAction } from "./CoworkerActionMenu";
import { emailKey, selfEmailKey } from "../adapters/v1Coworkers";
import type { V1Attendance } from "../adapters/v1Attendance";
import HudIcon from "../../../components/HudIcon";
import { HudDock, type HudDockEntry } from "../../../components/OfficeMap/HudDock";
import { Vo3dViewSwitcher } from "./Vo3dViewSwitcher";
import { Vo3dViewIndicator } from "./Vo3dViewIndicator";
import { Vo3dCaveMeeting } from "./Vo3dCaveMeeting";
import { isPointerLocked, isTypingTarget } from "./keyGuard";
import type { ToucanSummonState } from "../../../components/OfficeMap/toucanSummon";
import { HudSettings } from "../../../components/OfficeMap/HudSettings";
import { Vo3dEnvironmentPanel } from "./Vo3dEnvironmentPanel";
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
import type { useCheckoutFlow } from "../../../components/OfficeMap/useCheckoutFlow";
import { refreshClaimable, useClaimableCount } from "../../../services/quests/claimableStore";
import { isRealZohoMode } from "../../../services/zoho";
import type { OfficeStatus } from "../../../services/presence/status";
import type { AssetLayer } from "../../../types/office";
import type { OfficePerson } from "../../../services/office/floorMerge";
import {
  getExperiencePreferences,
  subscribeExperience,
  type DefaultViewPreference,
} from "../../../services/settings/experiencePreferences";
import styles from "./Vo3dHud.module.css";

// Global Team Map — React.lazy so MapLibre (~250 KB) only loads when someone opens the map. V1's own rule.
const TeamMapPanel = lazy(() => import("../../../components/TeamMap/TeamMapPanel"));

/** WHERE AN EmployeeProfile SHOULD LAND when something opened it with a destination in mind — V1's own
 *  `profileLanding` shape (components/OfficeMap/OfficeMap.tsx), moved across unchanged so a feed-post
 *  notification opens the Feed tab with that post highlighted here exactly as it does there. */
export type Vo3dProfileLanding = {
  tab: "profile" | "feed" | "achievements";
  postId: string | null;
};

export interface Vo3dHudProps {
  worldRef: { current: Vo3dWorld | null };
  ready: boolean;
  /** V1's attendance, from the ONE poller app/Vo3dHost.tsx already runs (adapters/v1Attendance). */
  attendance: V1Attendance;
  /** PHASE 7E — V1'S CHECKOUT STATE MACHINE, owned by app/Vo3dOverlay.tsx and passed in.
   *
   *  It used to be created here, when the working-time pill was the only thing that read it. The exit
   *  journey reads and DRIVES it — the Check Out choice starts it, its panels run over the world, and its
   *  arrival at CHECKED_OUT is what posts the attendance — and two `useCheckoutFlow` instances would be two
   *  state machines over one localStorage draft. So there is one, and it lives with the callers that
   *  change it. */
  checkoutFlow: ReturnType<typeof useCheckoutFlow>;
  /** START A CHECKOUT — the host's OWN entry point (app/Vo3dOverlay.tsx's `startCheckout`), which is the
   *  same one the Reception exit card's "Check Out" row uses. Passed in rather than calling
   *  `checkoutFlow.startCheckout` directly from here: the host's wrapper also closes the exit card and
   *  un-dismisses the success card, and a dock button that skipped those would be a second, subtly
   *  different way to begin the same journey. Optional so a HUD mounted without a host handler (tests,
   *  and any future caller with no exit journey) simply does not offer the button. */
  onStartCheckout?: () => void;
  /** The coworkers V2 is actually drawing, as V1 layers — Search offers these and nobody else, because
   *  a person the world has no body for cannot be located in it. */
  peopleLayers: readonly AssetLayer[];
  statusByEmail: Record<string, OfficeStatus>;
  /** Phase 6D's own action handler, reused verbatim so Search's Chat/Call are the menu's Chat/Call. */
  onCoworkerAction: (email: string, displayName: string, action: Vo3dCoworkerAction) => void;
  /** Open a profile. Owned by the host so the HUD and the interaction menu share one profile modal.
   *  `landing` is V1's deep-link: which tab to open on and which feed post to highlight. Omitted means
   *  the default Profile tab, which is what every ordinary opener (the pill, the menu, Search) wants. */
  onOpenProfile: (email: string, landing?: Vo3dProfileLanding) => void;
  /** OPEN A CONVERSATION BY ID — the host's EXISTING `openConversationById`, the same one the Toucan
   *  panel is already handed. Notification routing performs it through here rather than growing an
   *  opener of its own; omitted (or chat not in real mode) makes a conversation destination an honest
   *  refusal, exactly as V1 refuses it outside real mode. */
  onOpenConversation?: (conversationId: string) => void;
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
  /** True while the overlay owns the screen with a panel of its own (the profile modal, checkout, Room
   *  Details), so the ONE visibility rule below covers those too rather than only the tools this file
   *  holds. */
  overlayToolOpen: boolean;
  /** ROOM DETAILS — open the panel for the room the body is standing in. Owned by the overlay (it holds
   *  the roster the panel is built from); this file only offers the tile.
   *
   *  WHY A TILE AT ALL, when Office and 3D can just click the floor: PLAYER mode cannot. A pointer-locked
   *  player has no cursor to aim at a floor region, and the dock is the ONE surface Phase 7C guarantees
   *  in all three views — so the tile is what makes the panel reachable from every view rather than from
   *  two of them. It is the same panel and the same rooms either way. */
  onOpenCurrentRoom: () => void;
  /** ROOM DISCOVERY — is the label layer up, so the tile can read as the toggle it is. Owned by the
   *  overlay (it renders the labels); the dock only lights the tile. */
  roomDiscoveryActive?: boolean;
  /** THE TOUCAN, whose bird belongs to the world and whose panel belongs to the overlay (see the header).
   *  This file offers the two controls that CALL it and the Boards -> "Ask Toucan" seam W5-C already
   *  built into WhiteboardPanel. */
  toucanAvailable: boolean;
  /** Has the bird been called — what lights both controls, and what makes the button say "Ask" rather
   *  than "Call". Not "is the panel open": the bird is called first and the panel follows on arrival. */
  toucanCalled: boolean;
  /** V1's own coarse bird state, straight off the world. "approaching" is what makes the button say the
   *  bird is on its way instead of pretending the click did nothing. */
  toucanState: ToucanSummonState;
  /** COME HERE. Both controls and the T key run this one handler; it never opens a panel. */
  onCallToucan: () => void;
  onAskToucanAboutBoard: (board: { id: string; title: string }) => void;
  /** Closing the board panel drops the board the viewer was asking about, exactly as it does in V1. */
  onClearToucanBoardContext: () => void;
}

export function Vo3dHud({
  worldRef, ready, attendance, checkoutFlow, onStartCheckout, peopleLayers, statusByEmail, onCoworkerAction, onOpenProfile,
  onOpenConversation,
  people, selfId, conversations, unreadTotal, resolveDisplayName, onSelectConversation,
  onOpenDirectMessage, onStartGroup, overlayToolOpen, onOpenCurrentRoom, roomDiscoveryActive = false,
  toucanAvailable, toucanCalled, toucanState, onCallToucan, onAskToucanAboutBoard, onClearToucanBoardContext,
}: Vo3dHudProps) {
  const self = selfEmailKey();
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
  // PHASE 7D — inviting somebody to the Cave meeting. Its own flag rather than a third `chatPickerMode`
  // value: that one is gated on chatMode === "real" and its confirm opens a conversation, neither of
  // which is true here. Same modal component, different question.
  const [invitePickerOpen, setInvitePickerOpen] = useState(false);
  const companyHub = useCompanyHub();
  const claimableCount = useClaimableCount();

  // SETTINGS -> GENERAL -> STARTING VIEW, applied exactly once, on the first frame this world is ready.
  // It is a preference about how the office OPENS, so re-applying it on any later change would take the
  // camera away from somebody who had since switched views by hand. "office" is the world's own default
  // and needs no call at all.
  //
  // PHASE 7C — and it is ALSO a live control. Picking a view in Settings used to write the preference and
  // leave the camera where it was, so the panel looked broken until the next launch. The rule is now the
  // honest one: the STARTUP value is applied once when the world is ready, and every later CHANGE to the
  // preference (which can only come from somebody choosing one in Settings) switches the camera there and
  // then. A view the employee picked from the camera button is never overridden, because that does not
  // touch the preference at all.
  const lastDefaultView = useRef<DefaultViewPreference | null>(null);
  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world) return;
    const apply = () => {
      const { defaultView } = getExperiencePreferences();
      if (defaultView === lastDefaultView.current) return;
      const first = lastDefaultView.current === null;
      lastDefaultView.current = defaultView;
      // "office" is the world's own opening view, so the first pass has nothing to do for it.
      if (first && defaultView === "office") return;
      world.setViewMode(defaultView);
    };
    apply();
    return subscribeExperience(apply);
  }, [ready, worldRef]);

  const hasCheckedIn = attendance.record?.status === "CHECKED_IN";

  const timeTrackingVisible = import.meta.env.DEV || isRealZohoMode();
  /** IS THE CHECK OUT BUTTON OFFERED? V1's `checkoutOfferable`, character for character
   *  (OfficeMap.tsx): on the clock, and the flow not already running.
   *
   *  `state === "IDLE"` is what keeps this out of the 8-hour reminder's way — and out of its own. While
   *  the reminder toast is up the flow is in REMINDER_SHOWN, and while any panel of the journey is open
   *  it is in one of those states, so the button is not there to be pressed a second time. The reminder
   *  keeps its own entry into the same `onStartCheckout`; this adds a second DOOR, never a second flow.
   *
   *  It is also why nothing here decides anything about attendance or Zoho: the button's whole job is to
   *  call the host's existing entry point. */
  const checkoutOfferable = hasCheckedIn && checkoutFlow.state === "IDLE" && timeTrackingVisible && !!onStartCheckout;

  // The Tasks badge must be right BEFORE Tasks is ever opened — fetched once the HUD exists and re-fetched
  // whenever the panel closes (a claim inside it already refreshes on confirmation). V1's own rule.
  useEffect(() => {
    if (!ready) return;
    void refreshClaimable();
  }, [ready, tasksOpen]);

  // THE LOCK, read from the browser rather than inferred. Esc releases it (player/PlayerInput leaves Esc
  // to the browser deliberately) and a click on the world takes it back.
  const [pointerLocked, setPointerLocked] = useState(false);
  useEffect(() => {
    const onChange = () => setPointerLocked(isPointerLocked());
    document.addEventListener("pointerlockchange", onChange);
    onChange();
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

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
    invitePickerOpen ||
    overlayToolOpen;
  // PART 2 — WHAT IS BELOW THE PANELS. The floating chat windows sit above the dock, so when the dock
  // steps aside (a tool has the screen, or PLAYER owns it) they must drop to the bottom edge rather than
  // leave a band of empty space, and rise again when it returns. Published as a CSS variable rather than
  // threaded through props: every panel that needs to clear the dock reads the same value, and V1's own
  // --vo-dock-clearance (which already re-declares itself on short viewports) stays the measure.
  // PHASE 7C — ONE HUD IN ALL THREE VIEWS. PLAYER used to get a four-button strip of its own; it now gets
  // V1's whole dock, because "the tools are never taken away" is easier to keep by not taking them away.
  // What genuinely differs in PLAYER is not which tools exist, it is whether the mouse can reach them: a
  // pointer-LOCKED player cannot click any DOM at all, so the dock steps aside for exactly as long as the
  // lock is held and comes back the moment Esc releases it. That is the same `hidden` prop and the same
  // one visibility rule, driven by the real browser state instead of by the mode.
  // OPENING A TOOL RELEASES THE POINTER. A panel the player cannot click is worse than no panel, and the
  // alternative — asking them to press Esc first — is a rule nobody can be told. Releasing the lock does
  // NOT stop PLAYER or move the body: PlayerInput clears its held keys on the way out (and on blur), so
  // closing the tool leaves the avatar exactly where it was standing.
  useEffect(() => {
    if (officeToolOpen && isPointerLocked()) document.exitPointerLock();
  }, [officeToolOpen]);

  const dockVisible = !(pointerLocked || officeToolOpen);
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
        // V1's own deep-link, restored: the Feed tab, with the post the notification is about
        // highlighted and scrolled to (EmployeeProfile's initialTab / focusPostId). A destination
        // carrying no post id is still a Feed landing — that is what V1 does with it too.
        onOpenProfile(destination.email, { tab: "feed", postId: destination.postId });
        return true;
      case "achievements":
        if (!self) return false;
        // Badges live on the viewer's OWN profile (progression is self-only by API design), on the
        // Achievements tab — V1's word for word.
        onOpenProfile(self, { tab: "achievements", postId: null });
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
      case "conversation":
        // V1'S OWN BRANCH, through V1's own gate: outside real mode there is no conversation to open, so
        // this refuses rather than half-performing. The opener itself is the host's existing
        // `openConversationById` — the same one the inbox, the Map and the Toucan panel already use, so
        // which slot the panel lands in and how unread is cleared are decided in exactly one place.
        if (chatMode !== "real" || !onOpenConversation) return false;
        onOpenConversation(destination.conversationId);
        return true;
      // "checkout" is honestly refused rather than half-performed: check-out is not offered from the bell
      // here at all (see the header) — its entry point is deliberately Reception, not a notification.
      // NotificationCenter keeps the panel open on a false, which is the correct outcome for a
      // destination this surface does not perform — it does not pretend to have navigated.
      default:
        return false;
    }
  }, [onOpenConversation, onOpenProfile, self]);

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

  // V1'S OWN THREE LABELS, word for word. A bird in the air is not a broken button: it says so, and it
  // refuses the second press rather than re-issuing a summon that is already under way.
  const toucanPending = toucanCalled && toucanState === "approaching";
  const toucanLabel =
    toucanState === "attending" ? "Ask the toucan" : toucanCalled ? "Toucan is on its way" : "Call the toucan";

  // T — SUMMON WITHOUT LOSING THE MOUSE. This is the one Toucan control a pointer-locked PLAYER can
  // actually use: the dock and the button are DOM and a locked pointer cannot reach either, and asking
  // somebody to press Esc, click a button and click back into the world is not a companion you call.
  // Pressing it keeps the lock, keeps the body walking and keeps every other key — it only tells the
  // world to send the bird. The lock is released later, by the overlay, at the moment the panel with a
  // text box in it actually opens.
  //
  // Guarded exactly as C is (Vo3dViewSwitcher): modifiers left alone, repeats ignored, and app/keyGuard
  // keeps it out of anything somebody is typing into or any modal that has taken the screen.
  useEffect(() => {
    if (!ready || !toucanAvailable) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyT") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (isTypingTarget(event)) return;
      event.preventDefault();
      onCallToucan();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCallToucan, ready, toucanAvailable]);

  const statusPicker = <StatusPicker checkedIn={hasCheckedIn && checkoutFlow.state !== "CHECKED_OUT"} />;

  // Order is V1's, left to right: Profile | Coins+XP | Search | Hub | Tasks | Rewards | Map |
  // Working | Notifs | Settings.
  const entries: HudDockEntry[] = [
    { kind: "action", key: "search", icon: <HudIcon name="search" />, label: "Search",
      ariaLabel: "Search for a person", active: dockTool === "search", onClick: () => setDockTool("search") },
    { kind: "action", key: "hub", icon: <HudIcon name="hub" />, label: "Hub",
      ariaLabel: "Open Company Hub", active: companyHub.isOpen, onClick: () => openCompanyHub("manual") },
    // ROOM DETAILS. Sits next to Search because it answers the same kind of question — who is where —
    // and it is the one tool here that is about the room you are standing in rather than the office.
    // ROOM DISCOVERY. In OFFICE and 3D EXPLORE this TOGGLES the room-name labels over the floor; in
    // PLAYER, where those labels are not drawn, it keeps its original behaviour and opens the details of
    // the room the body is standing in. One tile, one handler — the overlay decides which, because it is
    // the only side that knows the view and owns the labels.
    { kind: "action", key: "room", icon: <HudIcon name="room" />, label: "Room",
      ariaLabel: "Open room details", active: roomDiscoveryActive, onClick: onOpenCurrentRoom },
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
            {checkoutOfferable && (
              <button
                type="button"
                className={styles.checkoutButton}
                onClick={onStartCheckout}
                aria-label="Check out"
              >
                Check out
              </button>
            )}
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
      {/* PHASE 7G — V1'S SUMMON BUTTON, restored, and the ONLY Toucan control on the HUD. Round, dedicated,
          and parked in the BOTTOM-RIGHT CORNER, which is where V1 puts it. It hides on the SAME one rule the dock uses (a tool owns the
          screen, or PLAYER has the pointer), so it can never sit on top of a panel and can never be a
          control a locked player is invited to click — that is what the T key is for. */}
      {toucanAvailable && dockVisible && (
        <button
          type="button"
          className={`${styles.summon}${toucanCalled ? ` ${styles.summonCalled}` : ""}`}
          onClick={onCallToucan}
          disabled={toucanPending}
          aria-label={toucanLabel}
          title={toucanLabel}
          data-testid="vo3d-toucan-summon"
        >
          <HudIcon name="toucan" size="32px" />
        </button>
      )}
      {/* THE C KEY, and nothing on screen — see Vo3dViewSwitcher. Switching view is C or Settings ->
          General; V (first/third) stays with player/PlayerInput, which owns the keyboard in PLAYER. */}
      <Vo3dViewSwitcher worldRef={worldRef} ready={ready} />
      {/* PHASE 7D — says which view C just switched to, briefly. Non-interactive, so it cannot get in
          the way of a drag, an orbit or a click on the floor under it. */}
      <Vo3dViewIndicator worldRef={worldRef} ready={ready} />
      {/* PHASE 7C — the Championship Cave's meeting, offered only to somebody standing in it. Every
          control is V1's own call store through media/CaveLiveShare; see Vo3dCaveMeeting.tsx for what is
          deliberately NOT there yet and why. */}
      {!officeToolOpen && (
        <Vo3dCaveMeeting
          worldRef={worldRef}
          ready={ready}
          selfId={selfId}
          onInvite={() => setInvitePickerOpen(true)}
        />
      )}
      {invitePickerOpen && (
        // THE SAME PICKER New Message uses, asked a different question. Single mode: one person per
        // invitation, exactly as the server mints them. The roster is V1's own (pickerPeople, already
        // built above and already minus the viewer), so only real employees can be offered a meeting.
        <EmployeePickerModal
          mode="single"
          title="Invite to the Cave meeting"
          people={pickerPeople}
          onClose={() => setInvitePickerOpen(false)}
          onConfirm={(emails) => {
            setInvitePickerOpen(false);
            // Straight to the world's own meeting bridge — the MEETING invitation, never the spatial
            // ring. What the inviter sees next is the existing notice card, driven by the store's
            // outgoing-invitation state; this deliberately raises no toast of its own.
            if (emails[0]) worldRef.current?.caveMeeting?.invite(emails[0]);
          }}
        />
      )}
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
          onClose={() => {
            setBoardsOpen(false);
            // V1's own rule: the board you were asking about goes with the panel that showed it.
            onClearToucanBoardContext();
          }}
          resolveDisplayName={resolveDisplayName}
          // W5-C's EXISTING seam, offered here for the first time in V2 — the same Toucan panel opens,
          // scoped to this board. The board itself is never written to; W5-C is read-only.
          onAskToucan={toucanAvailable ? onAskToucanAboutBoard : undefined}
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
          // THIS is the world the Controls / Interface / starting-view / ambience rows write to:
          // PlayerCamera, Vo3dOverheads and world.ts all read the same preference store. V1's 2D office
          // passes nothing and is offered none of them.
          worldExperience
          // SETTINGS -> ENVIRONMENT. The employee's own time-of-day and weather choice, offered wherever
          // there is a 3D world to honour it (V1's 2D office passes nothing and is offered no category).
          // The panel owns no state: it reads and writes services/settings/environmentPreferences, which
          // world.ts subscribes to — so this call site needs no world reference and no wiring.
          environment={<Vo3dEnvironmentPanel />}
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
