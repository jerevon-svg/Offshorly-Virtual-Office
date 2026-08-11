import { useEffect, useState } from "react";
import { manilaHourDecimal, phaseForHour, type Phase } from "../../data/officePhase";

// Parses a "HH:MM" query-param string into a decimal hour, e.g. "21:30" -> 21.5.
// Returns null if malformed so callers can fall back to real time.
function parseHourParam(raw: string | null): number | null {
  if (!raw) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour + minute / 60;
}

function initialOverrideFromQuery(): number | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return parseHourParam(params.get("time"));
}

export type UseOfficePhaseResult = {
  phase: Phase;
  hourDecimal: number;
  overrideHour: number | null;
  setOverrideHour: (h: number | null) => void;
};

export function useOfficePhase(): UseOfficePhaseResult {
  const [overrideHour, setOverrideHour] = useState<number | null>(initialOverrideFromQuery);
  const [hourDecimal, setHourDecimal] = useState<number>(manilaHourDecimal);

  useEffect(() => {
    // Override active — don't fight it with the real-time interval.
    if (overrideHour !== null) return;
    const id = window.setInterval(() => {
      setHourDecimal(manilaHourDecimal());
    }, 60_000);
    return () => window.clearInterval(id);
  }, [overrideHour]);

  const effectiveHour = overrideHour ?? hourDecimal;

  return {
    phase: phaseForHour(effectiveHour),
    hourDecimal: effectiveHour,
    overrideHour,
    setOverrideHour,
  };
}
