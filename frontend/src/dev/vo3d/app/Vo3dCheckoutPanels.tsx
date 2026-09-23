// vo3d app — V1'S CHECKOUT, OVER V2'S WORLD (Phase 7E).
//
// EVERY PANEL BELOW IS V1'S OWN COMPONENT, mounted unforked and given V1's own `useCheckoutFlow` state:
// the confirmation modal, the time summary, the time-log form, the review, the failure panel and the
// success card. The state machine, the draft persistence, the allocation validation, the Zoho submission,
// the duplicate-submission recovery and the 8-hour reminder are all in `useCheckoutFlow` and are not
// touched here. This file is a CALLER — the same relationship app/Vo3dHud.tsx has to V1's HudDock.
//
// WHAT IS DIFFERENT FROM V1, AND WHY IT IS ONLY THIS. V1's flow contains a scripted walk: a goodbye
// bubble, a walk across the office to Reception, then a walk out of the door. In V2 the flow is reached
// from the exit itself — the employee is ALREADY standing at Reception, which is the whole point of
// intercepting them there — so the two walk states are passed through immediately rather than animated.
// They are passed through, not removed: `confirmStartCheckout` and `arrivedAtReception` are the hook's own
// transitions, called in the hook's own order, so the state machine sees exactly the sequence it expects.
//
// WHAT WRITES ATTENDANCE. Nothing here. The POST lives with the one effect that watches the flow reach
// CHECKED_OUT (app/Vo3dOverlay.tsx), which is where V1 puts it too — after Zoho, never before.
//
// NAVIGATION, AND WHERE IT IS NOT. Every step a person can still change their mind on carries a way back:
// the confirmation has "Not yet", the summary and the form and the review carry Back and/or Cancel, and a
// failed submission keeps V1's own "Try again" and "Save and return later". Two states deliberately carry
// NEITHER — SUBMITTING, because a request is in flight and there is nothing safe to do but wait, and
// CHECKOUT_SUCCESS onwards, because the time log is recorded and a checkout cannot be un-done from a
// button. Both are properties of `useCheckoutFlow`'s own transition table, not of this file: those states
// have no edge back, so there is nothing here that could offer one.
import { CheckoutReminderToast } from "../../../components/OfficeMap/checkout/CheckoutReminderToast";
import { CheckoutConfirmModal } from "../../../components/OfficeMap/checkout/CheckoutConfirmModal";
import { TimeSummaryPanel } from "../../../components/OfficeMap/checkout/TimeSummaryPanel";
import { TimeLogForm } from "../../../components/OfficeMap/checkout/TimeLogForm";
import { TimeLogReview } from "../../../components/OfficeMap/checkout/TimeLogReview";
import { SubmissionFailedPanel } from "../../../components/OfficeMap/checkout/SubmissionFailedPanel";
import { CheckoutSuccessCard } from "../../../components/OfficeMap/checkout/CheckoutSuccessCard";
import checkoutStyles from "../../../components/OfficeMap/checkout/checkout.module.css";
import type { useCheckoutFlow } from "../../../components/OfficeMap/useCheckoutFlow";

export interface Vo3dCheckoutPanelsProps {
  flow: ReturnType<typeof useCheckoutFlow>;
  /** The SERVER's check-in time, for the summary panel's clock — the same value the HUD's pill uses. */
  timeInMs: number | null;
  /** Set once a submission lands, so the summary stops counting. V1's own `frozenCheckoutAtMs`. */
  frozenCheckoutAtMs: number | null;
  /** The success card is dismissable, and its dismissal is the caller's state (it survives the flow's own
   *  transitions, exactly as it does in V1). */
  successCardDismissed: boolean;
  onDismissSuccessCard: () => void;
}

export function Vo3dCheckoutPanels({ flow, timeInMs, frozenCheckoutAtMs, successCardDismissed, onDismissSuccessCard }: Vo3dCheckoutPanelsProps) {
  return (
    <>
      {/* THE 8-HOUR REMINDER — V1's own card, on V1's own state, unforked.
       *
       *  The trigger, the 480-minute threshold, the 30-minute snooze, the "Still here?" follow-up and the
       *  one-per-work-date bell entry are all `useCheckoutFlow`'s and are not touched here: this file was
       *  simply never rendering the state the hook was already reaching, so a V2 employee passed 8 hours
       *  and saw nothing while the bell row was posted behind their back. Every prop below is the same one
       *  OfficeMap.tsx passes — no second timer, no reminder state of its own, no storage.
       *
       *  IT IS NOT A MODAL and must not become one. It sits outside the checkout panel family on purpose:
       *  REMINDER_SHOWN is deliberately absent from Vo3dOverlay's CHECKOUT_PANEL_STATES, so the dock stays
       *  up, the pointer lock is kept and the world stays usable behind it. The card portals to <body>, so
       *  the wrapper's `role="dialog"` (which is only set for the real panels anyway) never covers it.
       *
       *  "Start checkout" is `startCheckout` — the SAME entry the Reception exit card and the dock use, so
       *  the journey it opens is the existing one. Nothing here checks anybody out or submits a time log;
       *  the reminder's only powers are to snooze itself and to open the confirmation. */}
      <CheckoutReminderToast
        visible={flow.reminderVisible}
        followUp={flow.reminderFollowUp}
        workedLabel={flow.workedLabel}
        onLater={flow.dismissReminderForLater}
        onStartCheckout={flow.startCheckout}
      />
      <CheckoutConfirmModal
        visible={flow.state === "CHECKOUT_CONFIRMATION"}
        onNotYet={flow.cancelConfirmation}
        // THE TWO WALK STATES, PASSED THROUGH. See the header: the employee is already at Reception.
        onStartCheckout={() => {
          flow.confirmStartCheckout();
          flow.arrivedAtReception();
        }}
      />
      {(flow.state === "AT_RECEPTION" || flow.state === "EDITING_TIME_LOG" || flow.state === "REVIEWING") && (
        <div className={checkoutStyles.backdrop}>
          <div className={checkoutStyles.panel}>
            <TimeSummaryPanel
              timeInMs={timeInMs}
              breakMinutes={flow.breakMinutes}
              workedLabel={flow.workedLabel}
              frozenCheckoutAtMs={frozenCheckoutAtMs}
            />
            {flow.state === "AT_RECEPTION" && (
              // PHASE 7E — A WAY BACK OUT, at the first step and at every one after it. This block is
              // V2's own markup (V1 renders its own copy in OfficeMap.tsx, untouched), so the Cancel here
              // costs V1 nothing. It ends no work session: `cancelCheckout` returns the flow to IDLE and
              // writes no attendance — see useCheckoutFlow.
              <div className={checkoutStyles.actions}>
                <button className={checkoutStyles.primary} onClick={flow.continueToTimeLog}>
                  Log today's work
                </button>
                <button className={checkoutStyles.secondary} onClick={flow.cancelCheckout}>
                  Cancel checkout
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {flow.state === "EDITING_TIME_LOG" && (
        <div className={checkoutStyles.backdrop}>
          <TimeLogForm
            entries={flow.entries}
            projects={flow.projects}
            tasks={flow.tasks}
            allocation={flow.allocation}
            workedLabel={flow.workedLabel}
            error={flow.error}
            onUpdateEntry={flow.updateEntry}
            onAddEntry={flow.addEntry}
            onRemoveEntry={flow.removeEntry}
            onContinue={flow.goToReview}
            // Back returns to the summary WITHOUT clearing anything: the entries live in the hook's state,
            // so stepping back and forward again lands on the same form. Cancel keeps them too — it
            // persists the draft through the same `saveDraft` the failure panel uses.
            onBack={flow.backToSummary}
            onCancel={flow.cancelCheckout}
          />
        </div>
      )}
      {flow.state === "REVIEWING" && (
        <div className={checkoutStyles.backdrop}>
          <TimeLogReview
            entries={flow.entries}
            allocation={flow.allocation}
            workedLabel={flow.workedLabel}
            onBack={flow.backToEditing}
            onCancel={flow.cancelCheckout}
            onSubmit={() => void flow.submit()}
          />
        </div>
      )}
      <SubmissionFailedPanel
        visible={flow.state === "SUBMISSION_FAILED"}
        error={flow.error}
        result={flow.submissionResult}
        onTryAgain={() => void flow.retrySubmit()}
        onSaveAndReturnLater={flow.saveAndReturnLater}
      />
      {!successCardDismissed && (
        <CheckoutSuccessCard
          state={flow.state}
          workedLabel={flow.workedLabel}
          entries={flow.entries}
          submissionResult={flow.submissionResult}
          onDismiss={onDismissSuccessCard}
        />
      )}
    </>
  );
}

export default Vo3dCheckoutPanels;
