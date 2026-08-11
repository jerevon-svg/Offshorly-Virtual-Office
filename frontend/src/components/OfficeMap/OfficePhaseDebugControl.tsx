import type { Phase } from "../../data/officePhase";
import styles from "./OfficeMap.module.css";

type OfficePhaseDebugControlProps = {
  phase: Phase;
  hourDecimal: number;
  overrideHour: number | null;
  setOverrideHour: (h: number | null) => void;
};

function formatHour(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Dev-only debug control — lets QA/design scrub the day/night cycle without
// waiting for real time. Gated on import.meta.env.DEV by the caller.
export function OfficePhaseDebugControl({
  phase,
  hourDecimal,
  overrideHour,
  setOverrideHour,
}: OfficePhaseDebugControlProps) {
  return (
    <div className={styles.phaseDebug}>
      <div className={styles.phaseDebugLabel}>
        {phase} — {formatHour(hourDecimal)} {overrideHour === null ? "(real time)" : "(override)"}
      </div>
      <input
        type="range"
        min={0}
        max={24}
        step={0.25}
        value={hourDecimal}
        onChange={(e) => setOverrideHour(Number(e.target.value))}
        className={styles.phaseDebugSlider}
      />
      <button type="button" onClick={() => setOverrideHour(null)} className={styles.phaseDebugButton}>
        Use real time
      </button>
    </div>
  );
}

export default OfficePhaseDebugControl;
