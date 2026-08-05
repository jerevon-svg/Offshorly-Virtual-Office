import type { CheckoutState } from "../../../data/checkoutState";
import styles from "./checkout.module.css";

type Props = {
  state: CheckoutState;
  overrideHour: number | null;
  debugHoursWorked: number | null;
  setDebugHoursWorked: (h: number | null) => void;
  startCheckout: () => void;
  confirmStartCheckout: () => void;
  submit: (opts?: { forceFail?: boolean; forceTimeout?: boolean }) => Promise<void>;
  retrySubmit: (opts?: { forceFail?: boolean; forceTimeout?: boolean }) => Promise<void>;
  resetToday: () => void;
};

const MOCK_MODE = import.meta.env.VITE_ZOHO_INTEGRATION_MODE !== "mcp";

// Dev-only debug panel — gated by caller on import.meta.env.DEV or
// ?checkoutDebug=true. Positioned top-left, below the existing top-center
// day/night phase debug pill so the two never overlap.
export function CheckoutDebugPanel({
  state,
  overrideHour,
  debugHoursWorked,
  setDebugHoursWorked,
  startCheckout,
  confirmStartCheckout,
  submit,
  retrySubmit,
  resetToday,
}: Props) {
  // Submit/retry only legal from REVIEWING / SUBMISSION_FAILED per the state
  // machine — guard here rather than letting the hook throw on an illegal
  // transition.
  const canSimulate = state === "REVIEWING" || state === "SUBMISSION_FAILED";
  function simulate(opts?: { forceFail?: boolean; forceTimeout?: boolean }) {
    if (state === "SUBMISSION_FAILED") {
      void retrySubmit(opts);
    } else if (state === "REVIEWING") {
      void submit(opts);
    }
  }
  return (
    <details className={styles.debugPanel}>
      <summary>Checkout debug</summary>
      <div className={styles.debugRow}>
        <label>
          Hours worked override:{" "}
          <input
            type="number"
            min={0}
            max={12}
            step={0.25}
            value={debugHoursWorked ?? ""}
            placeholder="live"
            onChange={(e) => {
              const raw = e.target.value;
              setDebugHoursWorked(raw === "" ? null : Number(raw));
            }}
          />
        </label>
        <input
          type="range"
          min={0}
          max={12}
          step={0.25}
          value={debugHoursWorked ?? 0}
          onChange={(e) => setDebugHoursWorked(Number(e.target.value))}
        />
        <button className={styles.debugBtn} onClick={() => setDebugHoursWorked(7.9)}>
          Worked: below 8h (7:54)
        </button>
        <button className={styles.debugBtn} onClick={() => setDebugHoursWorked(8)}>
          Worked: at 8h — triggers reminder
        </button>
        <button className={styles.debugBtn} onClick={() => setDebugHoursWorked(8.1)}>
          Worked: above 8h (8:06)
        </button>
        <button className={styles.debugBtn} onClick={() => setDebugHoursWorked(null)}>
          Clear worked-time override
        </button>
        <button
          className={styles.debugBtn}
          onClick={() => {
            if (state === "REMINDER_SHOWN") {
              startCheckout();
              confirmStartCheckout();
            } else if (state === "CHECKOUT_CONFIRMATION") {
              confirmStartCheckout();
            } else {
              setDebugHoursWorked(8);
            }
          }}
        >
          Start checkout immediately
        </button>
        <button className={styles.debugBtn} disabled={!canSimulate} onClick={() => simulate()}>
          Simulate Zoho success
        </button>
        <button
          className={styles.debugBtn}
          disabled={!canSimulate}
          onClick={() => simulate({ forceFail: true })}
        >
          Simulate Zoho failure
        </button>
        <button
          className={styles.debugBtn}
          disabled={!canSimulate}
          onClick={() => simulate({ forceTimeout: true })}
        >
          Simulate Zoho timeout
        </button>
        <button className={styles.debugBtn} onClick={resetToday}>
          Reset today's checkout
        </button>
      </div>
      <div className={styles.debugHint}>
        state: {state} {overrideHour !== null ? `(hour override ${overrideHour})` : ""}{" "}
        {debugHoursWorked !== null ? `(worked-time override ${debugHoursWorked}h)` : ""}
      </div>
      {MOCK_MODE && <div className={styles.debugHint}>Using simulated Zoho Projects data</div>}
    </details>
  );
}

export default CheckoutDebugPanel;
