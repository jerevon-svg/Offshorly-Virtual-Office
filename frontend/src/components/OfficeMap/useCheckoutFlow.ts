// Headless "spine" hook for the checkout flow. NO JSX — Pass B builds the
// UI on top of this. Accepts hourDecimal as a param (from the shared
// useOfficePhase() instance) rather than calling that hook itself, so Pass B
// can lift one shared instance across the office map + this hook.

import { useEffect, useMemo, useState } from "react";
import {
  assertTransition,
  canTransition,
  type CheckoutState,
} from "../../data/checkoutState";
import {
  clearAll,
  isAlreadyCheckedOut,
  loadDraft,
  loadResult,
  saveDraft,
  saveResult,
} from "../../data/checkoutStorage";
import { computeWorkedMinutes, formatDuration, validateAllocation } from "../../data/workedTime";
import { isAlreadySubmittedError, zohoService } from "../../services/zoho";
import type { MockSubmitOptions } from "../../services/zoho/MockZohoService";
import type {
  SubmitTimeLogsResult,
  TimeLogEntry,
  ZohoProject,
  ZohoTask,
} from "../../services/zoho/types";

// Re-trigger the 18:00 reminder 30 minutes after "Later" is dismissed.
const SNOOZE_MINUTES = 30;

// Manila calendar date as "YYYY-MM-DD", independent of browser timezone.
// Kept local to this hook (rather than officePhase.ts) since it's only
// needed here for the checkout storage key.
function manilaWorkDate(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now); // en-CA gives YYYY-MM-DD directly
}

export interface UseCheckoutFlowParams {
  employeeId: string;
  hourDecimal: number;
  timeInMs: number | null;
}

export interface UseCheckoutFlowResult {
  state: CheckoutState;
  workedMinutes: number;
  workedLabel: string;
  breakMinutes: number;
  reminderVisible: boolean;
  projects: ZohoProject[];
  tasks: ZohoTask[];
  entries: TimeLogEntry[];
  allocation: ReturnType<typeof validateAllocation>;
  submissionResult: SubmitTimeLogsResult | null;
  error: string | null;

  dismissReminderForLater: () => void;
  startCheckout: () => void;
  cancelConfirmation: () => void;
  confirmStartCheckout: () => void;
  arrivedAtReception: () => void;
  continueToTimeLog: () => void;
  addEntry: () => void;
  updateEntry: (index: number, patch: Partial<TimeLogEntry>) => void;
  removeEntry: (index: number) => void;
  goToReview: () => void;
  backToEditing: () => void;
  submit: (opts?: MockSubmitOptions) => Promise<void>;
  retrySubmit: (opts?: MockSubmitOptions) => Promise<void>;
  saveAndReturnLater: () => void;
  cancelWalkToReception: () => void;
  startExitWalk: () => void;
  finishExit: () => void;
  resetToday: () => void;
  forceCheckedOut: () => void;
}

const EMPTY_ENTRY: TimeLogEntry = {
  projectId: null,
  taskId: null,
  category: null,
  timeSpentMinutes: 0,
  workDescription: "",
};

export function useCheckoutFlow(params: UseCheckoutFlowParams): UseCheckoutFlowResult {
  // hourDecimal kept in UseCheckoutFlowParams for API stability / possible
  // future display use, but the reminder trigger no longer reads it.
  const { employeeId, timeInMs } = params;
  const workDate = useMemo(() => manilaWorkDate(), []);

  // Resume-from-storage is read synchronously via lazy initializers (not an
  // effect) so `state`/`submissionResult` are already correct on the VERY
  // FIRST render if the employee already checked out today. Consumers (e.g.
  // OfficeMap's mount-seat effect, which decides desk vs. sidewalk spawn)
  // read checkoutFlow.state on their own first render too — if resume were
  // an effect instead, state would still read "IDLE" on that first pass and
  // a one-shot mount effect elsewhere could act on stale state before this
  // hook's own effect corrected it.
  const [state, setState] = useState<CheckoutState>(() =>
    loadResult(employeeId, workDate)?.success ? "CHECKED_OUT" : "IDLE",
  );
  const [laterUntilMs, setLaterUntilMs] = useState<number | null>(null);
  const [projects, setProjects] = useState<ZohoProject[]>([]);
  const [tasks, setTasks] = useState<ZohoTask[]>([]);
  const [entries, setEntries] = useState<TimeLogEntry[]>([]);
  const [breakMinutes, setBreakMinutes] = useState<number>(0);
  const [submissionResult, setSubmissionResult] = useState<SubmitTimeLogsResult | null>(
    () => loadResult(employeeId, workDate) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Restore an in-progress draft on mount. The "already checked out" case is
  // now handled above by the lazy initializers, so this effect only needs to
  // cover the draft-restore path.
  useEffect(() => {
    if (loadResult(employeeId, workDate)?.success) return;
    const draft = loadDraft(employeeId, workDate);
    if (draft) {
      setEntries(draft.entries);
      if (typeof draft.breakMinutes === "number") setBreakMinutes(draft.breakMinutes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick "now" every minute so workedMinutes stays live while checked in.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Load projects once we're in the flow (needed by EDITING_TIME_LOG).
  useEffect(() => {
    if (state !== "AT_RECEPTION" && state !== "EDITING_TIME_LOG") return;
    let cancelled = false;
    zohoService
      .getProjects(employeeId)
      .then((p) => {
        if (!cancelled) setProjects(p);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load projects.");
      });
    return () => {
      cancelled = true;
    };
  }, [state, employeeId]);

  const workedMinutes =
    timeInMs === null ? 0 : computeWorkedMinutes(timeInMs, nowMs, breakMinutes);

  // 8-hour worked-time reminder trigger (spec-correct: fires once workedMinutes
  // reaches 480, not off the office day/night clock).
  useEffect(() => {
    if (workedMinutes < 480) return;
    if (state !== "IDLE") return;
    if (isAlreadyCheckedOut(employeeId, workDate)) return;
    if (laterUntilMs !== null && Date.now() < laterUntilMs) return;
    setState("REMINDER_SHOWN");
  }, [workedMinutes, state, employeeId, workDate, laterUntilMs]);

  // Persist draft on every entry/break change.
  useEffect(() => {
    if (entries.length === 0) return;
    saveDraft(employeeId, workDate, {
      entries,
      breakMinutes,
      savedAt: new Date().toISOString(),
    });
  }, [entries, breakMinutes, employeeId, workDate]);

  const workedLabel = timeInMs === null ? "Not checked in yet" : formatDuration(workedMinutes);
  const allocation = validateAllocation(workedMinutes, entries);

  function goTo(next: CheckoutState) {
    setState((prev) => {
      if (!canTransition(prev, next)) {
        assertTransition(prev, next); // throws with a clear message
      }
      return next;
    });
  }

  function dismissReminderForLater() {
    goTo("IDLE");
    setLaterUntilMs(Date.now() + SNOOZE_MINUTES * 60_000);
  }

  function startCheckout() {
    goTo("CHECKOUT_CONFIRMATION");
  }

  function cancelConfirmation() {
    goTo("IDLE");
  }

  // Moves through SAYING_GOODBYE into WALKING_TO_RECEPTION as one action —
  // Pass B renders the goodbye/walk visuals on its own timing and calls
  // arrivedAtReception() once the walk animation completes.
  function confirmStartCheckout() {
    goTo("SAYING_GOODBYE");
    goTo("WALKING_TO_RECEPTION");
  }

  function arrivedAtReception() {
    goTo("AT_RECEPTION");
  }

  function continueToTimeLog() {
    goTo("EDITING_TIME_LOG");
    if (entries.length === 0) {
      setEntries([{ ...EMPTY_ENTRY }]);
    }
  }

  function addEntry() {
    setEntries((prev) => [...prev, { ...EMPTY_ENTRY }]);
  }

  function updateEntry(index: number, patch: Partial<TimeLogEntry>) {
    setEntries((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;
      const updated = { ...current, ...patch };
      next[index] = updated;

      // Load tasks for the newly selected project, if any.
      if (patch.projectId && patch.projectId !== current.projectId) {
        zohoService
          .getTasks(employeeId, patch.projectId)
          .then(setTasks)
          .catch(() => setError("Failed to load tasks."));
      }

      return next;
    });
  }

  function removeEntry(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  function goToReview() {
    goTo("REVIEWING");
  }

  function backToEditing() {
    goTo("EDITING_TIME_LOG");
  }

  // opts: debug-only escape hatch (forceFail/forceTimeout) so the dev debug
  // panel can simulate Zoho failure/timeout without touching the real mock
  // service's internal call sites. Ignored by McpZohoService (cast below);
  // MockZohoService already declared support for this in Pass A.
  async function submit(opts?: MockSubmitOptions): Promise<void> {
    if (isAlreadyCheckedOut(employeeId, workDate)) {
      const existing = loadResult(employeeId, workDate);
      setSubmissionResult(existing);
      goTo("CHECKOUT_SUCCESS");
      return;
    }

    setError(null);
    goTo("SUBMITTING");

    try {
      const submitFn = zohoService.submitTimeLogs as (
        request: { employeeId: string; workDate: string; entries: TimeLogEntry[] },
        opts?: MockSubmitOptions,
      ) => Promise<SubmitTimeLogsResult>;
      const result = await submitFn(
        {
          employeeId,
          workDate,
          entries,
        },
        opts,
      );

      if (result.success) {
        saveResult(employeeId, workDate, result);
        setSubmissionResult(result);
        goTo("CHECKOUT_SUCCESS");
      } else {
        saveDraft(employeeId, workDate, {
          entries,
          breakMinutes,
          savedAt: new Date().toISOString(),
        });
        // Keep the result on a FAILURE too: a partial submission carries
        // per-entry failures and a count of what did land, and the panel
        // needs both to warn that retrying would double-log the successes.
        setSubmissionResult(result);
        setError(result.error ?? "Submission failed.");
        goTo("SUBMISSION_FAILED");
      }
    } catch (err) {
      // A duplicate is a normal outcome, not a failure: the server rejected
      // a second submission for this date because one already exists. Show
      // that prior submission rather than an error panel — and record it
      // locally, since this branch is reached exactly when local state has
      // drifted from the server (cleared storage, another browser).
      if (isAlreadySubmittedError(err)) {
        const recovered: SubmitTimeLogsResult = {
          success: true,
          submissionId: err.submissionId,
          entriesCreated: err.entriesCreated,
        };
        saveResult(employeeId, workDate, recovered);
        setSubmissionResult(recovered);
        goTo("CHECKOUT_SUCCESS");
        return;
      }

      saveDraft(employeeId, workDate, {
        entries,
        breakMinutes,
        savedAt: new Date().toISOString(),
      });
      setError(err instanceof Error ? err.message : "Submission failed.");
      goTo("SUBMISSION_FAILED");
    }
  }

  async function retrySubmit(opts?: MockSubmitOptions): Promise<void> {
    goTo("REVIEWING");
    await submit(opts);
  }

  function saveAndReturnLater() {
    saveDraft(employeeId, workDate, {
      entries,
      breakMinutes,
      savedAt: new Date().toISOString(),
    });
    goTo("IDLE");
  }

  function cancelWalkToReception() {
    // Only valid pre-arrival per spec.
    if (state !== "WALKING_TO_RECEPTION") return;
    goTo("IDLE");
  }

  // CHECKOUT_SUCCESS -> WALKING_TO_EXIT. Pass B calls this once the "You're
  // all set" card's beat finishes, then drives the exit walk itself and
  // calls finishExit() on arrival — mirrors confirmStartCheckout's split of
  // "hook owns state, Pass B owns visuals/timing".
  function startExitWalk() {
    goTo("WALKING_TO_EXIT");
  }

  function finishExit() {
    goTo("CHECKED_OUT");
  }

  // Debug-only escape hatch (dev debug panel): wipes today's stored draft +
  // result and resets all in-memory flow state back to IDLE. Not part of the
  // normal state-machine transitions — bypasses goTo() intentionally since
  // "reset from anywhere" isn't a real product transition.
  function resetToday() {
    clearAll(employeeId, workDate);
    setEntries([]);
    setBreakMinutes(0);
    setSubmissionResult(null);
    setError(null);
    setLaterUntilMs(null);
    setState("IDLE");
  }

  // Dev-only preview escape hatch — jumps straight to CHECKED_OUT (a fake
  // but well-formed submission result is stored so a page refresh keeps
  // previewing the same "already checked out" resume path this unlocks).
  // Bypasses goTo() intentionally, same rationale as resetToday(). The only
  // caller is a DEV-gated query-param check in OfficeMap; never wired into
  // any production code path.
  function forceCheckedOut() {
    const fakeResult: SubmitTimeLogsResult = {
      success: true,
      submissionId: "dev-preview-checked-out",
      entriesCreated: 0,
    };
    saveResult(employeeId, workDate, fakeResult);
    setSubmissionResult(fakeResult);
    setState("CHECKED_OUT");
  }

  return {
    state,
    workedMinutes,
    workedLabel,
    breakMinutes,
    reminderVisible: state === "REMINDER_SHOWN",
    projects,
    tasks,
    entries,
    allocation,
    submissionResult,
    error,

    dismissReminderForLater,
    startCheckout,
    cancelConfirmation,
    confirmStartCheckout,
    arrivedAtReception,
    continueToTimeLog,
    addEntry,
    updateEntry,
    removeEntry,
    goToReview,
    backToEditing,
    submit,
    retrySubmit,
    saveAndReturnLater,
    cancelWalkToReception,
    startExitWalk,
    finishExit,
    resetToday,
    forceCheckedOut,
  };
}
