// Centralized DND V1 policy constants — the single source every DND UI/logic call site reads
// from, so a future company-configurable policy (fetched from a settings endpoint, say) only
// needs to change this module, not every component that currently hardcodes a number. Mirrored
// server-side by backend/app/services/dnd_policy.py (only the decline cooldown needs server
// enforcement there — session length and daily allowance are enforced client-side in V1, see
// selfStatusStore.ts's module docstring for why).

export interface DndDurationOption {
  label: string;
  ms: number;
}

export const DND_POLICY = {
  /** V1 maximum length of a single manual DND session. */
  maxSessionMs: 2 * 60 * 60_000,
  /** V1 normal daily manual-DND allowance, across any number of sessions. */
  dailyAllowanceMs: 3 * 60 * 60_000,
  /** How long a requester must wait after being declined before re-requesting the same target. */
  declineCooldownMs: 15 * 60_000,
  /** Offered session lengths, shortest first. All must be <= maxSessionMs. */
  durationOptions: [
    { label: "30 min", ms: 30 * 60_000 },
    { label: "1 hour", ms: 60 * 60_000 },
    { label: "2 hours", ms: 120 * 60_000 },
  ] as DndDurationOption[],
  /** Optional, lightweight reason choices — purely cosmetic, no parsing/validation elsewhere. */
  reasonOptions: ["Deep Work", "Deadline", "Other"] as string[],
} as const;

export function formatDurationShort(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
