import type { OfficePerson } from "../office/floorMerge";
import { resolveDisplayName } from "./buckets";
import type { TeamMapPerson } from "./types";

// Client-side name search over the Team Map snapshot the panel already holds. No backend call and
// no new identity: matching is on the SAME display name the rows show (roster name first, Atlas
// name second — resolveDisplayName), and every match carries the person's email, which is the
// only identity the map ever selects by. Nothing here reads coordinates, so a match is found the
// same way whether the person sits on an Atlas base point, a live Working Today share, a saved
// last-shared location, or nothing at all.

export interface TeamMapSearchMatch {
  person: TeamMapPerson;
  name: string;
  /** Another match shares this display name — the row shows the email to tell them apart. */
  ambiguous: boolean;
}

const DEFAULT_LIMIT = 8;

/** Case-insensitive substring match on display name, prefix matches first, then alphabetical.
 *  An empty or whitespace-only query matches nobody (the sidebar keeps its normal sections). */
export function searchTeamMap(
  people: readonly TeamMapPerson[],
  roster: readonly OfficePerson[],
  query: string,
  limit: number = DEFAULT_LIMIT,
): TeamMapSearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];

  const scored: Array<{ person: TeamMapPerson; name: string; rank: number }> = [];
  for (const person of people) {
    const name = resolveDisplayName(person, roster);
    const index = name.toLowerCase().indexOf(needle);
    if (index < 0) continue;
    scored.push({ person, name, rank: index === 0 ? 0 : 1 });
  }
  scored.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name) || a.person.email.localeCompare(b.person.email));

  const capped = scored.slice(0, limit);
  const nameCounts = new Map<string, number>();
  for (const match of capped) {
    const key = match.name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  return capped.map(({ person, name }) => ({
    person,
    name,
    ambiguous: (nameCounts.get(name.toLowerCase()) ?? 0) > 1,
  }));
}
