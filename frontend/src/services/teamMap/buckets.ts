import type { OfficePerson } from "../office/floorMerge";
import type { PresenceStatusValue } from "../office/types";
import { mapAtlasToOfficeStatus, type OfficeStatus } from "../presence/status";
import type { TeamMapBucket, TeamMapPerson } from "./types";

// Pure helpers for the Team Map panel — no React, no fetching — so bucket grouping, status
// resolution and local-time formatting are testable without a WebGL map.

export interface GroupedTeamMap {
  ph: TeamMapPerson[];
  elsewhere: TeamMapPerson[];
  none: TeamMapPerson[];
}

export const BUCKET_LABELS: Record<TeamMapBucket, string> = {
  ph: "Philippines",
  elsewhere: "Elsewhere",
  none: "No location",
};

export function groupByBucket(people: TeamMapPerson[]): GroupedTeamMap {
  const grouped: GroupedTeamMap = { ph: [], elsewhere: [], none: [] };
  for (const person of people) {
    // A person with no coordinates is "none" whatever the backend said — the marker layer
    // must never receive a null pair.
    const bucket: TeamMapBucket =
      person.latitude === null || person.longitude === null ? "none" : person.bucket;
    grouped[bucket].push(person);
  }
  const byName = (a: TeamMapPerson, b: TeamMapPerson) =>
    (a.display_name ?? a.email).localeCompare(b.display_name ?? b.email);
  grouped.ph.sort(byName);
  grouped.elsewhere.sort(byName);
  grouped.none.sort(byName);
  return grouped;
}

/** People who can be pinned — the GeoJSON source is built from exactly this list. */
export function mappable(people: TeamMapPerson[]): TeamMapPerson[] {
  return people.filter((p) => p.latitude !== null && p.longitude !== null);
}

const ATLAS_STATUSES: ReadonlySet<string> = new Set([
  "ONLINE",
  "AWAY",
  "IN_MEETING",
  "ON_LEAVE",
  "OFFLINE",
]);

/** VO status for a map person: the LIVE floor roster wins (SSE-updated), else the snapshot's
 *  Atlas status, mapped through the same 5→9 table the floor uses. */
export function resolveMapStatus(
  person: TeamMapPerson,
  roster: readonly OfficePerson[],
): OfficeStatus {
  const live = roster.find((p) => p.email.toLowerCase() === person.email.toLowerCase());
  if (live) return mapAtlasToOfficeStatus(live.status);
  const raw = ATLAS_STATUSES.has(person.status)
    ? (person.status as PresenceStatusValue)
    : "OFFLINE";
  return mapAtlasToOfficeStatus(raw);
}

/** "3:42 PM" in the person's zone, or null when the zone is missing or not one this browser
 *  knows — an unknown zone must degrade to "no time", never throw inside a render. */
export function formatLocalTime(timezone: string | null, now: Date = new Date()): string | null {
  if (!timezone) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    }).format(now);
  } catch {
    return null;
  }
}

export function displayNameFor(person: TeamMapPerson): string {
  return person.display_name?.trim() || person.email;
}

function rosterRowFor(
  person: TeamMapPerson,
  roster: readonly OfficePerson[],
): OfficePerson | undefined {
  const needle = person.email.toLowerCase();
  return roster.find((p) => p.email.toLowerCase() === needle);
}

/** Department for a map person: the floor roster VO already consumes from Atlas (/floor
 *  department_name, live) is authoritative, joined by EMAIL; the map row's own department is
 *  only the fallback for someone the roster does not list. Never joined by position. */
export function resolveDepartment(
  person: TeamMapPerson,
  roster: readonly OfficePerson[],
): string | null {
  return rosterRowFor(person, roster)?.departmentName ?? person.department_name ?? null;
}

/** Display name with the same precedence as resolveDepartment. */
export function resolveDisplayName(person: TeamMapPerson, roster: readonly OfficePerson[]): string {
  return rosterRowFor(person, roster)?.displayName?.trim() || displayNameFor(person);
}

export function initialsFor(person: TeamMapPerson): string {
  const name = displayNameFor(person);
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/** "just now", "5 min ago", "2 h ago" — for the Working Today "Shared … ago" hint. Null when the
 *  timestamp is unparsable, so a bad value degrades to no hint rather than "NaN min ago". */
export function formatSharedAgo(sharedAt: string, now: Date = new Date()): string | null {
  const then = Date.parse(sharedAt);
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ago`;
}

/** One-line place hint for a row or card: a live Working Today share (exact, opted-in) wins over
 *  the approximate Atlas base. */
export function placeHintFor(person: TeamMapPerson, now: Date = new Date()): string {
  if (person.working_today) {
    const ago = formatSharedAgo(person.working_today.shared_at, now);
    if (person.working_today.active) return `Working today${ago ? ` · Shared ${ago}` : ""}`;
    // Saved last location: never worded as current.
    return `Last shared${ago ? ` ${ago}` : ""} · not live`;
  }
  return person.location_label ? `Based near ${person.location_label}` : "No location";
}
