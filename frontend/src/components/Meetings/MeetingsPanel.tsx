import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import HudIcon from "../HudIcon";
import { EmployeePickerModal, type EmployeePickerPerson } from "../Chat/EmployeePickerModal";
import {
  cancelScheduledMeeting,
  editMeeting,
  respondToScheduledMeeting,
  scheduleMeeting,
  useNow,
  useScheduledMeetings,
} from "../../services/meetings/scheduledMeetingsStore";
import {
  fetchAvailability,
  fetchFloorBookings,
  ScheduledMeetingsError,
  type RoomAvailability,
  type RoomBooking,
  type ScheduledMeeting,
} from "../../services/meetings/scheduledMeetingsClient";
import {
  formatDay,
  formatDuration,
  formatTime,
  formatTimeRange,
  localDateValue,
  localTimeValue,
  localToDate,
  minutesBetween,
  nextQuarterHour,
} from "../../services/meetings/meetingTime";
import { useMeetingMemory } from "../../services/meetings/meetingMemory";
import { useBriefingAvailability } from "../../services/meetings/meetingBriefing";
import { MeetingBriefing } from "./MeetingBriefing";
import { PanelTabs } from "../OfficeMap/PanelTabs";
import { MeetingMemory } from "./MeetingMemory";
import { MeetingReceipt } from "./MeetingReceipt";
import { MeetingTwin } from "./MeetingTwin";
import { OrganizationalTwin } from "./OrganizationalTwin";
import { useOrganizationalTwin } from "../../services/meetings/organizationalTwin";
import type { MeetingSessionInfo } from "../../services/meetings/meetingReceiptClient";
import styles from "./MeetingsPanel.module.css";

// SCHEDULED MEETINGS V1 — the employee surface: Upcoming Meetings, and the Schedule / Edit form in the
// same shell. Cream panel family (Rewards / Hub / Tasks). Everything it shows is the scheduled-meetings
// store (the server's answer for THIS identity); every write goes through the store's actions and the
// server stays the only judge of conflicts — the room grid here is a convenience, a 409 is the truth.
//
// Deliberately not a calendar: one chronological list, a compact form, and the existing employee picker.
//
// PHASE 7C — a Meeting Receipt opens in the same shell, keyed by the Meeting Session id, never the room.
//
// PHASE 8A — two tabs: Upcoming (future and running bookings, unchanged) | Memory (ended Meeting Sessions
// the viewer may read — components/Meetings/MeetingMemory.tsx). Memory replaced 7C's short Recent list. Its
// state lives here, not in the tab, so returning from a Receipt keeps the query, filter and loaded pages.

const DURATIONS = [15, 30, 45, 60, 90];
/** Only the slug is needed to name a room; the grid's names and seats come from the server. */
const roomName = (roomId: string): string => {
  const slug = roomId.split("/")[1] ?? roomId;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
};

export interface MeetingsPanelProps {
  selfId: string;
  people: EmployeePickerPerson[];
  resolveDisplayName: (email: string) => string;
  /** Show this meeting (from a notification or the reminder): highlighted and scrolled to, or — when it
   *  is no longer on the viewer's schedule — a short note saying so. */
  focusMeetingId?: string | null;
  onClose: () => void;
}

// PHASE 8B — the Meeting Twin is one more view: opened from a Receipt with that Receipt's session, and Back
// (or Escape) returns to the Receipt, then onward to the Memory list with its query/filter/pages intact.
//
// PHASE 8C — a Receipt can open a RELATED meeting's Receipt (its continuity timeline). `trail` is the Receipts
// that led here, so Back walks them in reverse before returning to the list. Revisiting one already on the
// trail cuts the trail back to it instead of growing a loop, so the stack is never deeper than the path taken.
//
// PHASE 9B — "Ask your Memory" (the Organizational Twin) opens from the Memory tab. A source's Receipt opened
// from it carries `from: "orgtwin"`, so Back at the end of that Receipt's trail returns to the Twin — whose
// conversation lives HERE (useOrganizationalTwin) and survives the detour — and the Twin's Back returns to
// Memory with its query, filter and pages intact. "Ask this meeting" from such a Receipt still works as before.
//
// PHASE 9C — an upcoming card's "Brief" opens the pre-meeting briefing (MeetingBriefing). A source Receipt opened
// from it carries `from: { brief }`, so Back at the end of that Receipt's trail returns to the same brief, and
// the brief's Back returns to Upcoming. Memory → Ask your Memory and Receipt → Ask this meeting are unchanged.
type From = "list" | "orgtwin" | { brief: string };
type View =
  | { kind: "list" }
  | { kind: "form"; editing: ScheduledMeeting | null }
  | { kind: "receipt"; sessionId: string; trail: string[]; focusItemId?: string; from?: From }
  | { kind: "twin"; session: MeetingSessionInfo; trail: string[]; from?: From }
  | { kind: "orgtwin" }
  | { kind: "brief"; meetingId: string };
type Tab = "upcoming" | "memory";

export function MeetingsPanel({ selfId, people, resolveDisplayName, focusMeetingId = null, onClose }: MeetingsPanelProps) {
  const store = useScheduledMeetings();
  const [view, setView] = useState<View>({ kind: "list" });
  const [tab, setTab] = useState<Tab>("upcoming");
  const [memoryOpened, setMemoryOpened] = useState(false);
  const memory = useMeetingMemory(memoryOpened);
  const orgTwin = useOrganizationalTwin();
  // PHASE 9C — "Brief" only where the server found useful, authorized history for THIS viewer. Held here, not in
  // the list, so returning from a Brief or its Receipts doesn't make the affordance blink out and back.
  const briefable = useBriefingAvailability(
    store.mine.filter((m) => Date.parse(m.endsAt) > Date.now()).slice(0, 20).map((m) => m.id), store.revision);
  const chooseTab = (t: Tab) => {
    setTab(t);
    if (t === "memory") setMemoryOpened(true);
  };
  const receiptBack = (trail: string[], from: From = "list"): View =>
    trail.length
      ? { kind: "receipt", sessionId: trail[trail.length - 1], trail: trail.slice(0, -1), from }
      : from === "orgtwin" ? { kind: "orgtwin" }
        : typeof from === "object" ? { kind: "brief", meetingId: from.brief } : { kind: "list" };
  const openRelated = (at: string, trail: string[], from: From | undefined, sessionId: string, focusItemId?: string) => {
    const i = trail.indexOf(sessionId);
    setView({ kind: "receipt", sessionId, focusItemId, from, trail: i >= 0 ? trail.slice(0, i) : [...trail, at] });
  };
  // Leaving a Receipt (Back or Escape) re-reads the Memory on screen: a review there may have changed a
  // preview. The query, filter and loaded pages are kept.
  const lastView = useRef(view.kind);
  useEffect(() => {
    if ((lastView.current === "receipt" || lastView.current === "orgtwin") && view.kind === "list" && tab === "memory")
      void memory.refresh();
    lastView.current = view.kind;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.kind]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const flash = (text: string) => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  };
  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);
  // A notification can outlive its meeting (cancelled, the viewer removed, already over): say so once
  // the list has loaded rather than opening something stale.
  const missingNoted = useRef<string | null>(null);
  useEffect(() => {
    if (!focusMeetingId || store.loading || missingNoted.current === focusMeetingId) return;
    const m = store.mine.find((x) => x.id === focusMeetingId);
    if (!m || Date.parse(m.endsAt) <= Date.now()) {
      missingNoted.current = focusMeetingId;
      flash("That meeting is no longer on your schedule");
    }
  }, [focusMeetingId, store.loading, store.mine]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[data-meetings-picker]")) {
        if (view.kind === "twin")
          setView({ kind: "receipt", sessionId: view.session.sessionId, trail: view.trail, from: view.from });
        else if (view.kind === "receipt") setView(receiptBack(view.trail, view.from));
        else if (view.kind !== "list") setView({ kind: "list" });
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, onClose]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-label="Meetings" onClick={(e) => e.stopPropagation()} data-testid="meetings-panel">
        {view.kind === "list" && tab === "memory" ? (
          <>
            <PanelHeader tab={tab} onTab={chooseTab} onClose={onClose} />
            <div className={styles.body}>
              <MeetingMemory memory={memory} resolveDisplayName={resolveDisplayName}
                onOpen={(sessionId) => setView({ kind: "receipt", sessionId, trail: [] })}
                onAsk={() => setView({ kind: "orgtwin" })} />
            </div>
          </>
        ) : view.kind === "list" ? (
          <UpcomingList
            tabs={<PanelTabs ariaLabel="Meetings" tabs={TABS} active={tab} onChange={chooseTab} />}
            selfId={selfId}
            meetings={store.mine}
            briefable={briefable}
            onBrief={(meetingId) => setView({ kind: "brief", meetingId })}
            loading={store.loading}
            error={store.error}
            resolveDisplayName={resolveDisplayName}
            focusMeetingId={focusMeetingId}
            onSchedule={() => setView({ kind: "form", editing: null })}
            onEdit={(m) => setView({ kind: "form", editing: m })}
            onClose={onClose}
            flash={flash}
          />
        ) : view.kind === "receipt" ? (
          <MeetingReceipt key={view.sessionId} sessionId={view.sessionId} resolveDisplayName={resolveDisplayName}
            focusItemId={view.focusItemId ?? null}
            backLabel={view.trail.length ? "Back to the previous receipt"
              : view.from === "orgtwin" ? "Back to Ask your Memory"
                : typeof view.from === "object" ? "Back to the brief" : "Back to meetings"}
            onBack={() => setView(receiptBack(view.trail, view.from))} onClose={onClose}
            onAsk={(session) => setView({ kind: "twin", session, trail: view.trail, from: view.from })}
            onOpenRelated={(sessionId, focusItemId) =>
              openRelated(view.sessionId, view.trail, view.from, sessionId, focusItemId)} />
        ) : view.kind === "twin" ? (
          <MeetingTwin session={view.session} resolveDisplayName={resolveDisplayName}
            onBack={() => setView({ kind: "receipt", sessionId: view.session.sessionId, trail: view.trail, from: view.from })}
            onClose={onClose} />
        ) : view.kind === "brief" ? (
          <MeetingBriefing key={view.meetingId} meetingId={view.meetingId} resolveDisplayName={resolveDisplayName}
            onBack={() => setView({ kind: "list" })} onClose={onClose}
            onOpenReceipt={(sessionId, focusItemId) =>
              setView({ kind: "receipt", sessionId, focusItemId, trail: [], from: { brief: view.meetingId } })} />
        ) : view.kind === "orgtwin" ? (
          <OrganizationalTwin twin={orgTwin} resolveDisplayName={resolveDisplayName}
            onBack={() => setView({ kind: "list" })} onClose={onClose}
            onOpenReceipt={(sessionId) => setView({ kind: "receipt", sessionId, trail: [], from: "orgtwin" })} />
        ) : (
          <ScheduleForm
            selfId={selfId}
            people={people}
            editing={view.editing}
            revision={store.revision}
            resolveDisplayName={resolveDisplayName}
            onBack={() => setView({ kind: "list" })}
            onSaved={(m, edited) => {
              setView({ kind: "list" });
              flash(`${edited ? "Meeting updated" : "Meeting scheduled"} · ${roomName(m.roomId)}, ${formatDay(m.startsAt)} ${formatTime(m.startsAt)}`);
            }}
          />
        )}
        {toast && (
          <div className={styles.toast} role="status" data-testid="meetings-toast">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

const TABS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "memory", label: "Memory" },
] as const;

/** The Memory tab's header: the same shell as Upcoming's, without Schedule (Memory is only the past). */
function PanelHeader({ tab, onTab, onClose }: { tab: Tab; onTab: (t: Tab) => void; onClose: () => void }) {
  return (
    <header className={styles.header}>
      <span className={styles.headerIcon} aria-hidden="true">
        <HudIcon name="clock" size="34px" />
      </span>
      <div className={styles.headerText}>
        <h2 className={styles.title}>Meetings</h2>
        <p className={styles.subtitle}>Past meetings you can return to</p>
      </div>
      <PanelTabs ariaLabel="Meetings" tabs={TABS} active={tab} onChange={onTab} />
      <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close meetings">
        ✕
      </button>
    </header>
  );
}

// ---- Upcoming Meetings -----------------------------------------------------------------------------

function UpcomingList({
  tabs,
  selfId,
  meetings,
  briefable,
  onBrief,
  loading,
  error,
  resolveDisplayName,
  onSchedule,
  onEdit,
  onClose,
  flash,
  focusMeetingId,
}: {
  tabs: ReactNode;
  focusMeetingId: string | null;
  selfId: string;
  meetings: ScheduledMeeting[];
  briefable: ReadonlySet<string>;
  onBrief: (meetingId: string) => void;
  loading: boolean;
  error: string | null;
  resolveDisplayName: (email: string) => string;
  onSchedule: () => void;
  onEdit: (m: ScheduledMeeting) => void;
  onClose: () => void;
  flash: (text: string) => void;
}) {
  const now = useNow(30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const visible = meetings.filter((m) => Date.parse(m.endsAt) > now);
  const groups = useMemo(() => {
    const out: { day: string; items: ScheduledMeeting[] }[] = [];
    for (const m of visible) {
      const day = formatDay(m.startsAt, new Date(now));
      if (out.at(-1)?.day !== day) out.push({ day, items: [] });
      out.at(-1)!.items.push(m);
    }
    return out;
  }, [visible, now]);

  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      await fn();
      flash(done);
    } catch (err) {
      flash(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
      setConfirmCancel(null);
    }
  };

  return (
    <>
      <header className={styles.header}>
        <span className={styles.headerIcon} aria-hidden="true">
          <HudIcon name="clock" size="34px" />
        </span>
        <div className={styles.headerText}>
          <h2 className={styles.title}>Meetings</h2>
          <p className={styles.subtitle}>On the Meeting Floor</p>
        </div>
        {tabs}
        <button type="button" className={styles.primary} onClick={onSchedule} data-testid="meetings-schedule">
          Schedule meeting
        </button>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close meetings">
          ✕
        </button>
      </header>
      <div className={styles.body}>
        {error && !visible.length && <p className={styles.empty}>{error}</p>}
        {!error && loading && !visible.length && <p className={styles.empty}>Loading…</p>}
        {!loading && !error && !visible.length && (
          <div className={styles.emptyState}>
            <p className={styles.emptyTitle}>Nothing scheduled</p>
            <p className={styles.empty}>Book one of the Meeting Floor rooms and invite your team.</p>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.day} className={styles.group}>
            <h3 className={styles.dayLabel}>{g.day}</h3>
            {g.items.map((m) => {
              const mine = m.organizerEmail === selfId;
              const me = m.invitees.find((i) => i.email === selfId);
              const others = m.invitees.filter((i) => i.email !== m.organizerEmail);
              const accepted = others.filter((i) => i.response === "accepted").length;
              const running = Date.parse(m.startsAt) <= now;
              return (
                <article key={m.id} className={m.id === focusMeetingId ? `${styles.item} ${styles.itemFocus}` : styles.item}
                  data-testid="meeting-item" data-meeting-id={m.id}
                  ref={m.id === focusMeetingId ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}>
                  <div className={styles.when}>
                    <span className={styles.whenTime}>{formatTime(m.startsAt)}</span>
                    <span className={styles.whenLen}>{formatDuration(minutesBetween(m.startsAt, m.endsAt))}</span>
                  </div>
                  <div className={styles.itemBody}>
                    <div className={styles.itemTitle}>
                      <span className={styles.itemName}>{m.title}</span>
                      {m.isPrivate && <span className={styles.privateTag}>Private</span>}
                      {running && <span className={styles.nowTag}>Now</span>}
                    </div>
                    <div className={styles.itemMeta}>
                      <strong>{roomName(m.roomId)}</strong> · {formatTimeRange(m.startsAt, m.endsAt)} ·{" "}
                      {mine ? "You're organizing" : `By ${resolveDisplayName(m.organizerEmail)}`}
                    </div>
                    <div className={styles.itemRsvp}>
                      {mine
                        ? others.length
                          ? `${others.length} invited · ${accepted} accepted`
                          : "Just you so far"
                        : me?.response === "accepted"
                          ? "You're going"
                          : me?.response === "declined"
                            ? "You declined"
                            : "Awaiting your reply"}
                    </div>
                  </div>
                  <div className={styles.itemActions}>
                    {briefable.has(m.id) && (
                      <button type="button" className={styles.brief} onClick={() => onBrief(m.id)} data-testid="meeting-brief"
                        aria-label={`Brief for ${m.title}`}>
                        Brief
                      </button>
                    )}
                    {mine ? (
                      confirmCancel === m.id ? (
                        <>
                          <button type="button" className={styles.danger} disabled={busy === m.id}
                            onClick={() => void act(m.id, () => cancelScheduledMeeting(m.id), "Meeting cancelled")}
                            data-testid="meeting-cancel-confirm">
                            Cancel it
                          </button>
                          <button type="button" className={styles.ghost} onClick={() => setConfirmCancel(null)}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className={styles.ghost} onClick={() => onEdit(m)} data-testid="meeting-edit">
                            Edit
                          </button>
                          <button type="button" className={styles.ghost} onClick={() => setConfirmCancel(m.id)} data-testid="meeting-cancel">
                            Cancel
                          </button>
                        </>
                      )
                    ) : (
                      <>
                        <button type="button" disabled={busy === m.id || me?.response === "accepted"}
                          className={me?.response === "accepted" ? styles.choiceOn : styles.ghost}
                          onClick={() => void act(m.id, () => respondToScheduledMeeting(m.id, "accepted"), "You're going")}
                          data-testid="meeting-accept">
                          Accept
                        </button>
                        <button type="button" disabled={busy === m.id || me?.response === "declined"}
                          className={me?.response === "declined" ? styles.choiceOn : styles.ghost}
                          onClick={() => void act(m.id, () => respondToScheduledMeeting(m.id, "declined"), "Declined")}
                          data-testid="meeting-decline">
                          Decline
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}

// ---- Schedule / Edit ---------------------------------------------------------------------------------

function ScheduleForm({
  selfId,
  people,
  editing,
  revision,
  resolveDisplayName,
  onBack,
  onSaved,
}: {
  selfId: string;
  people: EmployeePickerPerson[];
  editing: ScheduledMeeting | null;
  revision: number;
  resolveDisplayName: (email: string) => string;
  onBack: () => void;
  onSaved: (m: ScheduledMeeting, edited: boolean) => void;
}) {
  const initialStart = editing ? new Date(editing.startsAt) : nextQuarterHour(new Date());
  const initialDuration = editing ? minutesBetween(editing.startsAt, editing.endsAt) : 30;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [date, setDate] = useState(localDateValue(initialStart));
  const [time, setTime] = useState(localTimeValue(initialStart));
  const [duration, setDuration] = useState(initialDuration);
  const [invitees, setInvitees] = useState<string[]>(
    editing ? editing.invitees.map((i) => i.email).filter((e) => e !== editing.organizerEmail) : [],
  );
  const [roomId, setRoomId] = useState<string | null>(editing?.roomId ?? null);
  const [isPrivate, setIsPrivate] = useState(editing?.isPrivate ?? false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rooms, setRooms] = useState<RoomAvailability[] | null>(null);
  const [overlaps, setOverlaps] = useState<RoomBooking[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recheck, setRecheck] = useState(0);

  // An untouched date/time keeps the booking's own instant. The pickers are minute-precise, so reading a
  // start back through them could shift it by seconds and turn "unchanged" into "moved into the past".
  const startUnchanged = editing !== null && date === localDateValue(initialStart) && time === localTimeValue(initialStart);
  const start = startUnchanged ? new Date(editing!.startsAt) : localToDate(date, time);
  const end = start ? new Date(start.getTime() + duration * 60_000) : null;
  const startIso = start?.toISOString() ?? "";
  const endIso = end?.toISOString() ?? "";
  const durations = DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b);

  // AVAILABILITY for the chosen window: the server's per-room answer, plus the floor's bookings in that
  // window (public window facts only) so a taken room can say WHEN it is taken. Re-asked whenever the
  // window changes and whenever the server announces a change (`revision`).
  useEffect(() => {
    if (!startIso || !endIso) {
      setRooms(null);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      Promise.all([fetchAvailability(startIso, endIso), fetchFloorBookings(startIso, endIso)])
        .then(([a, b]) => {
          if (!live) return;
          setRooms(a);
          setOverlaps(b);
        })
        .catch(() => live && setRooms(null));
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [startIso, endIso, revision, recheck]);

  const roomTaken = (r: RoomAvailability): RoomBooking[] =>
    overlaps.filter((b) => b.roomId === r.roomId && (!editing || b.id !== editing.id));
  const isFree = (r: RoomAvailability): boolean =>
    r.available || (editing !== null && r.roomId === editing.roomId && roomTaken(r).length === 0);
  const headcount = invitees.length + 1;

  // A chosen room that becomes unavailable (someone else booked it, or the time moved) is let go of, so
  // Save can never quietly submit a room the grid is showing as taken.
  useEffect(() => {
    if (!rooms || !roomId) return;
    const r = rooms.find((x) => x.roomId === roomId);
    if (r && !isFree(r)) setRoomId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, overlaps]);

  const problem = !title.trim()
    ? "Give the meeting a title"
    : !start
      ? "Choose a date and start time"
      : !startUnchanged && start.getTime() < Date.now() - 60_000
        ? "That start time has already passed"
        : !roomId
          ? "Choose a room"
          : null;

  const save = async () => {
    if (problem || !roomId || saving) return;
    setSaving(true);
    setError(null);
    const draft = { title: title.trim(), roomId, startsAt: startIso, endsAt: endIso, isPrivate, inviteeEmails: invitees };
    try {
      const saved = editing ? await editMeeting(editing.id, draft) : await scheduleMeeting(draft);
      onSaved(saved, Boolean(editing));
    } catch (err) {
      if (err instanceof ScheduledMeetingsError && err.status === 409) {
        setError(`${roomName(roomId)} was just booked for part of that time. Pick another room.`);
        setRoomId(null);
        setRecheck((n) => n + 1);
      } else {
        setError(err instanceof Error ? err.message : "Couldn't save the meeting");
      }
    } finally {
      setSaving(false);
    }
  };

  const inviteeSummary = invitees.length
    ? invitees.slice(0, 3).map(resolveDisplayName).join(", ") + (invitees.length > 3 ? ` +${invitees.length - 3}` : "")
    : "No one yet";

  return (
    <>
      <header className={styles.header}>
        <button type="button" className={styles.backButton} onClick={onBack} aria-label="Back to meetings">
          ‹
        </button>
        <div className={styles.headerText}>
          <h2 className={styles.title}>{editing ? "Edit meeting" : "Schedule meeting"}</h2>
          <p className={styles.subtitle}>Times are in your local time</p>
        </div>
      </header>
      <div className={styles.body}>
        <label className={styles.field}>
          <span className={styles.label}>Title</span>
          <input className={styles.input} value={title} maxLength={120} placeholder="Product sync"
            onChange={(e) => setTitle(e.target.value)} autoFocus data-testid="meeting-title" />
        </label>

        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>Date</span>
            <input type="date" className={styles.input} value={date} min={localDateValue(new Date())}
              onChange={(e) => setDate(e.target.value)} data-testid="meeting-date" />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Start</span>
            <input type="time" className={styles.input} value={time} step={300}
              onChange={(e) => setTime(e.target.value)} data-testid="meeting-time" />
          </label>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>
            Duration{end && <span className={styles.labelHint}> · ends {formatTime(end)}</span>}
          </span>
          <div className={styles.segmented} role="radiogroup" aria-label="Duration">
            {durations.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={duration === d}
                className={duration === d ? styles.segmentOn : styles.segment}
                onClick={() => setDuration(d)} data-testid={`meeting-duration-${d}`}>
                {d < 60 ? `${d}m` : d % 60 ? `${Math.floor(d / 60)}h ${d % 60}m` : `${d / 60}h`}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Invite</span>
          <div className={styles.inviteRow}>
            <span className={styles.inviteSummary} data-testid="meeting-invitees">{inviteeSummary}</span>
            <button type="button" className={styles.ghost} onClick={() => setPickerOpen(true)} data-testid="meeting-invite">
              {invitees.length ? "Change" : "Choose people"}
            </button>
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>
            Room<span className={styles.labelHint}> · {headcount} {headcount === 1 ? "person" : "people"}</span>
          </span>
          {!rooms ? (
            <p className={styles.empty}>{start ? "Checking rooms…" : "Pick a time to see free rooms"}</p>
          ) : (
            <div className={styles.rooms} role="radiogroup" aria-label="Meeting room">
              {rooms.map((r) => {
                const free = isFree(r);
                const taken = roomTaken(r);
                const tight = free && r.capacity < headcount;
                const selected = roomId === r.roomId;
                return (
                  <button key={r.roomId} type="button" role="radio" aria-checked={selected} disabled={!free}
                    className={[styles.room, selected ? styles.roomOn : "", free ? "" : styles.roomTaken].join(" ")}
                    onClick={() => setRoomId(r.roomId)} data-testid={`meeting-room-${r.roomId.split("/")[1]}`}>
                    <span className={styles.roomName}>{r.name.toUpperCase()}</span>
                    <span className={styles.roomSeats}>{r.capacity} seats</span>
                    <span className={free ? (tight ? styles.roomWarn : styles.roomFree) : styles.roomBusy}>
                      {free
                        ? tight ? "Small for this group" : "Available"
                        : taken[0] ? `${formatTimeRange(taken[0].startsAt, taken[0].endsAt)} booked` : "Booked"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <label className={styles.toggleRow}>
          <input type="checkbox" className={styles.toggleInput} checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)} data-testid="meeting-private" />
          <span className={styles.toggle} aria-hidden="true" />
          <span className={styles.toggleText}>
            <strong>Private · DND</strong>
            <span>Only invitees can enter the room and join. The door sign hides the title.</span>
          </span>
        </label>
      </div>
      <footer className={styles.footer}>
        <span className={error ? styles.error : styles.footerHint} role={error ? "alert" : undefined} data-testid="meeting-form-error">
          {error ?? problem ?? (start && end ? `${formatDay(startIso)} · ${formatTimeRange(startIso, endIso)} · ${roomName(roomId!)}` : "")}
        </span>
        <button type="button" className={styles.ghost} onClick={onBack}>
          Back
        </button>
        <button type="button" className={styles.primary} disabled={Boolean(problem) || saving} onClick={() => void save()}
          data-testid="meeting-save">
          {saving ? "Saving…" : editing ? "Save changes" : "Schedule"}
        </button>
      </footer>
      {pickerOpen && (
        <div data-meetings-picker>
          <EmployeePickerModal
            mode="multi"
            title="Invite to meeting"
            people={people.filter((p) => p.email !== selfId)}
            minSelected={0}
            showGroupName={false}
            confirmLabel={(n) => (n ? `Invite ${n}` : "Done")}
            initialSelected={invitees}
            onClose={() => setPickerOpen(false)}
            onConfirm={(emails) => {
              setInvitees(emails);
              setPickerOpen(false);
            }}
          />
        </div>
      )}
    </>
  );
}

export default MeetingsPanel;
