// Day/night phase cycle model. Pure functions only — no React/DOM deps here
// so this stays trivially unit-testable (see officePhase.test.ts).

export type Phase = "morning" | "day" | "sunset" | "night";

// Boundaries: 6-10 morning, 10-17 day, 17-19 sunset, else (19-24, 0-6) night.
// hourDecimal is expected in [0, 24).
export function phaseForHour(hourDecimal: number): Phase {
  const h = ((hourDecimal % 24) + 24) % 24; // normalize, guard against negatives
  if (h >= 6 && h < 10) return "morning";
  if (h >= 10 && h < 17) return "day";
  if (h >= 17 && h < 19) return "sunset";
  return "night";
}

// Real Philippines (Asia/Manila) wall-clock time as a decimal hour, regardless
// of the browser's local timezone — e.g. 14:30 -> 14.5.
export function manilaHourDecimal(now: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minutePart = parts.find((p) => p.type === "minute")?.value ?? "0";
  // Intl can format midnight as "24" under hour12:false in some engines —
  // normalize to 0 so the result stays within [0, 24).
  const hour = Number(hourPart) % 24;
  const minute = Number(minutePart);
  return hour + minute / 60;
}
