/** "Resets in 5h 12m" / "Resets in 3d 2h" from an ISO period end; never negative. Shared by the
 * Missions panel (kept out of the component file so Fast Refresh sees only components there). */
export function formatResetsIn(endsAtIso: string, now: number = Date.now()): string {
  const ms = Math.max(0, new Date(endsAtIso).getTime() - now);
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `Resets in ${days}d ${hours}h`;
  if (hours > 0) return `Resets in ${hours}h ${minutes}m`;
  return `Resets in ${Math.max(1, minutes)}m`;
}
