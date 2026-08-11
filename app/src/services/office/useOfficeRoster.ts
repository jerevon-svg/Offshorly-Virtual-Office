import { useEffect, useState } from "react";
import { officeService } from "./index";
import { mergeFloorWithPresence, type OfficePerson } from "./floorMerge";

// Loads the office roster once at mount: /floor and /presence together,
// merged into the render-ready shape (see floorMerge.ts for why it must be
// both feeds and not either one).
//
// Deliberately fetch-once. Live updates are Phase 2's SSE stream, which
// will push into this same OfficePerson[] shape rather than replacing it —
// so nothing downstream has to change when the stream lands. Polling here
// in the meantime would be a second, competing update path to unpick later.

export interface OfficeRosterState {
  people: OfficePerson[];
  /** True until the first load settles, success or failure. */
  loading: boolean;
  /** Set when the roster could not be loaded. The canvas still renders —
   *  an empty floor with an error is better than a blank screen. */
  error: Error | null;
}

export function useOfficeRoster(): OfficeRosterState {
  const [state, setState] = useState<OfficeRosterState>({
    people: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Parallel, not sequential: the two endpoints are independent, and
        // serializing them doubles the time the floor sits empty.
        const [floor, presence] = await Promise.all([
          officeService.getFloor(),
          officeService.getPresence(),
        ]);
        if (cancelled) return;
        setState({
          people: mergeFloorWithPresence(floor, presence),
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        // apiFetch has already navigated away on a 401, so this branch is
        // a genuine failure (network, 5xx, malformed JSON) — surface it
        // rather than rendering an empty office as though nobody is in.
        setState({
          people: [],
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
