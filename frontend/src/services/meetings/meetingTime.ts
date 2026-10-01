// LOCAL TIME FOR SCHEDULED MEETINGS — the only place a meeting's time meets a timezone, and the zone
// is always the employee's OWN browser zone. Nothing here names Manila or any other place: `new Date(y,
// m, d, h, min)` and `Intl` both resolve in the viewer's zone, and the backend only ever sees UTC ISO.

const pad = (n: number): string => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of `d` in local time — the value a native <input type="date"> holds. */
export function localDateValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "HH:MM" of `d` in local time — the value a native <input type="time"> holds. */
export function localTimeValue(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The instant a local date + time picker pair means, or null when either is incomplete. */
export function localToDate(date: string, time: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Local midnight at the start of `d`'s day. */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The next quarter hour at least `leadMinutes` ahead — a sensible default start. */
export function nextQuarterHour(now: Date, leadMinutes = 10): Date {
  const t = new Date(now.getTime() + leadMinutes * 60_000);
  t.setSeconds(0, 0);
  t.setMinutes(Math.ceil(t.getMinutes() / 15) * 15);
  return t;
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** "2:00 PM" (or "14:00" where that is the viewer's convention). */
export function formatTime(iso: string | Date): string {
  return TIME.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "2:00–3:00 PM" — Intl's own range formatting where the browser has it. */
export function formatTimeRange(startIso: string, endIso: string): string {
  const a = new Date(startIso);
  const b = new Date(endIso);
  const f = TIME as Intl.DateTimeFormat & { formatRange?: (x: Date, y: Date) => string };
  return typeof f.formatRange === "function" ? f.formatRange(a, b) : `${TIME.format(a)} – ${TIME.format(b)}`;
}

const DAY = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

/** "Today", "Tomorrow", or "Mon, Sep 28" — by the viewer's local calendar day. */
export function formatDay(iso: string, now: Date = new Date()): string {
  const day = startOfLocalDay(new Date(iso)).getTime();
  const today = startOfLocalDay(now).getTime();
  const tomorrow = startOfLocalDay(new Date(today + 36 * 3_600_000)).getTime();
  if (day === today) return "Today";
  if (day === tomorrow) return "Tomorrow";
  return DAY.format(new Date(iso));
}

/** Whole minutes between two ISO instants. */
export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000);
}

/** "30 min", "1 hr", "1 hr 30 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
