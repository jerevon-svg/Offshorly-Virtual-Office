// vo3d app — HR SERVICES: the panel the Executive Room's HR desk opens, from OFFICE (click the desk → "Open
// HR Services") and from PLAYER ([E] at the desk's visitor side). One component, one behaviour, both views.
//
// IT SHOWS ONLY WHAT IS REAL. Every section reads services/hr, whose capabilities report themselves
// unavailable until Atlas ships the employee-scoped leave endpoints (ATLAS_HR_LEAVE_ENDPOINT_REQUEST.md).
// An unavailable section says so — no invented leave types, no placeholder balances, and a Submit that
// stays disabled. When a capability turns available the same views load, validate and submit for real, and
// "submitted" is only ever said after the service confirms it.
//
// IT OWNS THE KEYBOARD WHILE OPEN. Keys are answered in the window's CAPTURE phase and stopped there, so
// neither PLAYER's movement nor OFFICE's shortcuts see a key typed into this panel (the floor picker's rule).
// Tab is trapped inside the card; Escape steps back from a section, and closes from the home screen. The
// backdrop takes the mouse, so a click beside the card closes it instead of walking the avatar.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { hrLeaveService, type HrCapability, type HrLeaveService, type LeaveBalance, type LeaveRequest, type LeaveStatus, type LeaveType } from "../../../services/hr";
import styles from "./Vo3dHrServices.module.css";

type View = "home" | "apply" | "requests" | "balance";

export interface Vo3dHrServicesProps {
  onClose(): void;
  /** injected in tests; the app uses the shared services/hr instance */
  service?: HrLeaveService;
}

/** THE SERVICE LIST. A future HR service is one more row here and one more view below. */
const SERVICES: readonly { view: Exclude<View, "home">; title: string; blurb: string; capability: HrCapability; icon: ReactNode }[] = [
  { view: "apply", title: "Apply for Leave", blurb: "Request time off for approval", capability: "submitLeave", icon: <IconCalendar /> },
  { view: "requests", title: "My Leave Requests", blurb: "Dates and approval status", capability: "leaveRequests", icon: <IconList /> },
  { view: "balance", title: "Leave Balance", blurb: "What you have left, by type", capability: "leaveBalance", icon: <IconGauge /> },
];
const TITLES: Record<View, string> = { home: "HR Services", apply: "Apply for Leave", requests: "My Leave Requests", balance: "Leave Balance" };

type Load<T> = { phase: "unavailable" } | { phase: "loading" } | { phase: "error" } | { phase: "ready"; data: T };

/** One read, gated on its capability: an unavailable capability is never called. */
function useHrRead<T>(service: HrLeaveService, capability: HrCapability, read: () => Promise<T>, enabled: boolean): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>(() =>
    service.availability(capability).state === "available" ? { phase: "loading" } : { phase: "unavailable" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    if (service.availability(capability).state !== "available") {
      setState({ phase: "unavailable" });
      return;
    }
    let live = true;
    setState({ phase: "loading" });
    read().then(
      (data) => { if (live) setState({ phase: "ready", data }); },
      () => { if (live) setState({ phase: "error" }); },
    );
    return () => { live = false; };
    // `read` is a fresh closure each render; the call is keyed on what it reads, not on its identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, capability, enabled, attempt]);
  return [state, useCallback(() => setAttempt((n) => n + 1), [])];
}

const FOCUSABLE = "button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

export function Vo3dHrServices({ onClose, service = hrLeaveService }: Vo3dHrServicesProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>("home");
  const pendingAny = SERVICES.some((s) => service.availability(s.capability).state !== "available");

  // keyboard ownership + focus trap (see the header)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        if (view === "home") onClose();
        else setView("home");
        return;
      }
      if (e.key !== "Tab") return;
      const card = cardRef.current;
      if (!card) return;
      const items = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !card.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [view, onClose]);

  // focus moves into the card on open and on every section change, and goes back where it was on close
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => { if (before && before.isConnected) before.focus?.(); };
  }, []);
  useEffect(() => {
    cardRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [view]);

  return (
    <div
      className={styles.backdrop}
      data-testid="hr-services-backdrop"
      onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div ref={cardRef} className={styles.card} role="dialog" aria-modal="true" aria-labelledby="hr-services-title" data-testid="hr-services">
        <div className={styles.header}>
          {view === "home" ? (
            <span className={styles.glyph} aria-hidden="true"><IconPeople /></span>
          ) : (
            <button type="button" className={styles.back} onClick={() => setView("home")} aria-label="Back to HR Services">‹</button>
          )}
          <div className={styles.heading}>
            <div id="hr-services-title" className={styles.title}>{TITLES[view]}</div>
            <div className={styles.sub}>Human Resources · Executive Room</div>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close HR Services">×</button>
        </div>

        <div className={styles.body}>
          {view === "home" && (
            <>
              <div className={`${styles.source} ${pendingAny ? styles.sourcePending : ""}`} data-testid="hr-source">
                <span className={styles.dot} aria-hidden="true" />
                Zoho People · {pendingAny ? "Connection pending" : "Connected"}
              </div>
              <div className={styles.tiles} role="group" aria-label="HR services">
                {SERVICES.map((s) => {
                  const pending = service.availability(s.capability).state !== "available";
                  return (
                    <button key={s.view} type="button" className={styles.tile} onClick={() => setView(s.view)} data-testid={`hr-tile-${s.view}`}>
                      <span className={styles.tileIcon} aria-hidden="true">{s.icon}</span>
                      <span className={styles.tileText}>
                        <span className={styles.tileTitle}>{s.title}</span>
                        <span className={styles.tileBlurb}>{s.blurb}</span>
                      </span>
                      {pending ? <span className={styles.badge}>Pending</span> : <span className={styles.chev} aria-hidden="true">›</span>}
                    </button>
                  );
                })}
              </div>
              <p className={styles.footnote}>Leave is managed in Zoho People. Until this desk is connected, keep using Zoho People as usual.</p>
            </>
          )}
          {view === "apply" && <ApplyForLeave service={service} />}
          {view === "requests" && <MyLeaveRequests service={service} />}
          {view === "balance" && <MyLeaveBalance service={service} />}
        </div>

        <div className={styles.hint} aria-hidden="true">
          <kbd>Tab</kbd> move · <kbd>Esc</kbd> {view === "home" ? "close" : "back"}
        </div>
      </div>
    </div>
  );
}

// ---- sections -----------------------------------------------------------------------------------

function Pending({ what }: { what: string }) {
  return (
    <div className={styles.state} data-testid="hr-pending">
      <span className={styles.stateIcon} aria-hidden="true"><IconPlug /></span>
      <div className={styles.stateTitle}>Integration pending</div>
      <p className={styles.stateText}>{what} will appear here once Virtual Office is connected to Zoho People through Atlas. Nothing is shown until it's real.</p>
    </div>
  );
}
function Failed({ onRetry }: { onRetry(): void }) {
  return (
    <div className={styles.state} role="alert" data-testid="hr-error">
      <div className={styles.stateTitle}>Couldn't reach HR right now</div>
      <p className={styles.stateText}>Zoho People didn't answer. Nothing was changed.</p>
      <button type="button" className={styles.secondary} onClick={onRetry}>Try again</button>
    </div>
  );
}
function Loading() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="Loading">
      <span /><span /><span />
    </div>
  );
}

/** a calendar date ("2026-10-22"), formatted without a timezone shift */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
const fmtRange = (a: string, b: string): string => (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);
const STATUS_LABEL: Record<LeaveStatus, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" };

function MyLeaveRequests({ service }: { service: HrLeaveService }) {
  const [state, retry] = useHrRead<LeaveRequest[]>(service, "leaveRequests", () => service.listLeaveRequests(), true);
  if (state.phase === "unavailable") return <Pending what="Your leave requests and their approval status" />;
  if (state.phase === "loading") return <Loading />;
  if (state.phase === "error") return <Failed onRetry={retry} />;
  if (!state.data.length) return <div className={styles.state}><div className={styles.stateTitle}>No leave requests yet</div></div>;
  return (
    <ul className={styles.list} data-testid="hr-requests">
      {state.data.map((r) => (
        <li key={r.id} className={styles.item}>
          <div className={styles.itemMain}>
            <span className={styles.itemTitle}>{r.leaveTypeName}</span>
            <span className={styles.itemSub}>{fmtRange(r.startDate, r.endDate)}</span>
            <span className={styles.itemMeta}>Submitted {fmtDate(r.submittedAt)}</span>
          </div>
          <span className={`${styles.status} ${styles[`status_${r.status}`]}`}>{STATUS_LABEL[r.status]}</span>
        </li>
      ))}
    </ul>
  );
}

function MyLeaveBalance({ service }: { service: HrLeaveService }) {
  const [state, retry] = useHrRead<LeaveBalance[]>(service, "leaveBalance", () => service.getLeaveBalance(), true);
  if (state.phase === "unavailable") return <Pending what="Your leave balance by type" />;
  if (state.phase === "loading") return <Loading />;
  if (state.phase === "error") return <Failed onRetry={retry} />;
  if (!state.data.length) return <div className={styles.state}><div className={styles.stateTitle}>No leave types assigned to you</div></div>;
  return (
    <ul className={styles.list} data-testid="hr-balance">
      {state.data.map((b) => {
        const unit = b.unit === "hour" ? "h" : "d";
        const total = b.available + b.used + (b.pending ?? 0);
        return (
          <li key={b.leaveTypeId} className={styles.balance}>
            <div className={styles.balanceHead}>
              <span className={styles.itemTitle}>{b.leaveTypeName}</span>
              <span className={styles.balanceNum}>{b.available}{unit} <small>available</small></span>
            </div>
            {total > 0 && (
              <div className={styles.bar} aria-hidden="true">
                <span className={styles.barUsed} style={{ width: `${(b.used / total) * 100}%` }} />
                <span className={styles.barPending} style={{ width: `${((b.pending ?? 0) / total) * 100}%` }} />
              </div>
            )}
            <div className={styles.itemMeta}>
              {b.used}{unit} used{b.pending !== undefined ? ` · ${b.pending}${unit} pending` : ""}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const REASON_MAX = 500;
type Submit = { phase: "idle" } | { phase: "submitting" } | { phase: "submitted"; request: LeaveRequest } | { phase: "failed" };

function ApplyForLeave({ service }: { service: HrLeaveService }) {
  const canSubmit = service.availability("submitLeave").state === "available";
  const [types, retryTypes] = useHrRead<LeaveType[]>(service, "leaveTypes", () => service.listLeaveTypes(), canSubmit);
  const live = canSubmit && types.phase === "ready";
  const [typeId, setTypeId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [submit, setSubmit] = useState<Submit>({ phase: "idle" });
  const [touched, setTouched] = useState(false);
  // one key per filled-in form: a retry after a lost response re-sends the same key, never a second leave
  const keyRef = useRef<string | null>(null);
  const ids = { type: useId(), start: useId(), end: useId(), reason: useId() };

  const errors = useMemo(() => {
    const out: string[] = [];
    if (!typeId) out.push("Choose a leave type.");
    if (!start || !end) out.push("Choose a start and end date.");
    else if (end < start) out.push("The end date can't be before the start date.");
    if (reason.length > REASON_MAX) out.push(`Keep the reason under ${REASON_MAX} characters.`);
    return out;
  }, [typeId, start, end, reason]);
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); keyRef.current = null; if (submit.phase === "failed") setSubmit({ phase: "idle" }); };

  const send = (): void => {
    setTouched(true);
    if (!live || errors.length || submit.phase === "submitting") return;
    keyRef.current ??= crypto.randomUUID();
    setSubmit({ phase: "submitting" });
    service.submitLeaveRequest({ leaveTypeId: typeId, startDate: start, endDate: end, reason: reason.trim(), idempotencyKey: keyRef.current }).then(
      (request) => setSubmit({ phase: "submitted", request }),
      () => setSubmit({ phase: "failed" }),
    );
  };

  if (submit.phase === "submitted") {
    return (
      <div className={styles.state} role="status" data-testid="hr-submitted">
        <span className={`${styles.stateIcon} ${styles.stateOk}`} aria-hidden="true">✓</span>
        <div className={styles.stateTitle}>Sent to Zoho People</div>
        <p className={styles.stateText}>
          {submit.request.leaveTypeName}, {fmtRange(submit.request.startDate, submit.request.endDate)} — {STATUS_LABEL[submit.request.status].toLowerCase()}.
        </p>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={(e) => { e.preventDefault(); send(); }} noValidate>
      {!canSubmit && (
        <div className={styles.notice} data-testid="hr-pending">
          <span className={styles.noticeIcon} aria-hidden="true"><IconPlug /></span>
          <div>
            <div className={styles.noticeTitle}>Integration pending</div>
            <div className={styles.noticeText}>Leave can't be submitted from the office yet. Use Zoho People until this desk is connected.</div>
          </div>
        </div>
      )}
      {canSubmit && types.phase === "error" && <Failed onRetry={retryTypes} />}
      <fieldset className={styles.fields} disabled={!live}>
        <label className={styles.field} htmlFor={ids.type}>
          <span>Leave type</span>
          <select id={ids.type} value={typeId} onChange={(e) => edit(setTypeId)(e.target.value)}>
            <option value="">{live ? "Choose a leave type" : canSubmit && types.phase === "loading" ? "Loading…" : "Loaded from Zoho People"}</option>
            {types.phase === "ready" && types.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <div className={styles.row2}>
          <label className={styles.field} htmlFor={ids.start}>
            <span>Start date</span>
            <input id={ids.start} type="date" value={start} onChange={(e) => edit(setStart)(e.target.value)} />
          </label>
          <label className={styles.field} htmlFor={ids.end}>
            <span>End date</span>
            <input id={ids.end} type="date" value={end} min={start || undefined} onChange={(e) => edit(setEnd)(e.target.value)} />
          </label>
        </div>
        <label className={styles.field} htmlFor={ids.reason}>
          <span>Reason <em>optional</em></span>
          <textarea id={ids.reason} rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => edit(setReason)(e.target.value)} />
        </label>
      </fieldset>
      {live && touched && errors.length > 0 && (
        <ul className={styles.errors} role="alert">{errors.map((m) => <li key={m}>{m}</li>)}</ul>
      )}
      {submit.phase === "failed" && <div className={styles.errors} role="alert">Zoho People didn't confirm the request, so it wasn't filed. Try again.</div>}
      <button type="submit" className={styles.primary} disabled={!live || submit.phase === "submitting"} data-testid="hr-submit">
        {!canSubmit ? "Submission unavailable" : submit.phase === "submitting" ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}

// ---- glyphs (inline, stroke-only, currentColor) -----------------------------------------------------
function Svg({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
function IconPeople() { return <Svg><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14.2c2.3.2 3.9 1.8 4.5 4.8" /></Svg>; }
function IconCalendar() { return <Svg><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M9 14.5l2 2 4-4" /></Svg>; }
function IconList() { return <Svg><path d="M9 7h11M9 12h11M9 17h11" /><circle cx="4.8" cy="7" r="1" /><circle cx="4.8" cy="12" r="1" /><circle cx="4.8" cy="17" r="1" /></Svg>; }
function IconGauge() { return <Svg><path d="M4 16a8 8 0 1 1 16 0" /><path d="M12 16l4-5" /><path d="M4 20h16" /></Svg>; }
function IconPlug() { return <Svg><path d="M9 3v5M15 3v5" /><path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0z" /><path d="M12 16.5V21" /></Svg>; }

export default Vo3dHrServices;
