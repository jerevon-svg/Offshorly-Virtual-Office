import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { officeService } from "./index";
import { mergePresenceRow } from "./officeSse";
import { openPresenceStream } from "./presenceStream";
import { mergeFloorWithPresence, type OfficePerson } from "./floorMerge";
import type { FloorPerson, Presence } from "./types";

// Loads the office roster and keeps it live.
//
// Two sources, two lifetimes:
//   /floor + /presence  fetched once — the roster and its starting state
//   SSE presence_update  applied continuously on top
//
// Floor and presence are held SEPARATELY rather than as one merged list,
// so a live update re-runs the real merge (including the placement rules)
// instead of patching an already-merged row. Patching in place would let
// the two drift: a person's room is derived from status + department, so
// a status change has to re-derive placement, not just overwrite a field.

export interface OfficeRosterState {
  people: OfficePerson[];
  /** True until the first load settles, success or failure. */
  loading: boolean;
  /** Set when the roster could not be loaded. The canvas still renders —
   *  an empty floor with an error beats a blank screen. */
  error: Error | null;
  /** False while the live stream is down. The roster stays on screen and
   *  simply stops updating, which is worth surfacing: a stale office looks
   *  exactly like a quiet one. */
  live: boolean;
  /** Atlas room id -> display name, for the ephemeral PROJECT/CLIQ_CHANNEL
   *  rooms that have no hand-drawn twin. Lets the sidebar say "in Design
   *  Sprint" instead of leaking a raw room id. Empty when rooms could not
   *  be loaded — the UI degrades to "elsewhere", it does not break. */
  roomNames: Map<string, string>;
  /** Raw /floor row count. `people` is derived from this feed, so an empty
   *  floor means an empty office however healthy the stream is — these two
   *  counts are what tell "nobody is in" apart from "the roster failed". */
  floorCount: number;
  /** Raw /presence row count. Grows as live events arrive. */
  presenceCount: number;
}

// Mock mode has no backend to stream from; opening a stream against it
// would fail and then reconnect-loop forever.
function isRealMode(): boolean {
  return import.meta.env.VITE_OFFICE_INTEGRATION_MODE === "real";
}

export function useOfficeRoster(): OfficeRosterState {
  const [floor, setFloor] = useState<FloorPerson[]>([]);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [live, setLive] = useState(false);
  const [roomNames, setRoomNames] = useState<Map<string, string>>(new Map());

  // Rooms are fetched separately from the roster and their failure is
  // swallowed: they are only used to label where someone is, so a rooms
  // outage should degrade to "elsewhere" rather than empty the office.
  useEffect(() => {
    let cancelled = false;
    officeService
      .listRooms()
      .then((rooms) => {
        if (cancelled) return;
        setRoomNames(new Map(rooms.map((room) => [room.id, room.name])));
      })
      .catch(() => {
        /* labels only — see above */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Lifecycle flag as a ref rather than a per-effect `cancelled` local.
  //
  // load() is reachable from the SSE stream's onConnected (via reloadRef),
  // so it outlives the effect that created it. Closing over a per-effect
  // flag meant a load could resolve against a closure whose flag had been
  // set by StrictMode's mount -> cleanup -> remount cycle, silently
  // dropping its result AND its setLoading(false) — presenting as a
  // permanent "loading…" with no error, which is indistinguishable from an
  // empty office. Reset to true on mount so the remount re-arms it.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      // Parallel: the endpoints are independent, and serializing them
      // doubles the time the floor sits empty.
      const [nextFloor, nextPresence] = await Promise.all([
        officeService.getFloor(),
        officeService.getPresence(),
      ]);
      if (!mountedRef.current) return;
      setFloor(nextFloor);
      setPresence(nextPresence);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      // apiFetch has already navigated away on a 401, so this is a
      // genuine failure — surface it rather than rendering an empty
      // office as though nobody were in.
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    // A request that neither resolves nor rejects would otherwise pin
    // `loading` forever with nothing to show for it. An empty office and a
    // hung fetch look identical on the canvas, so make the hang say so.
    const watchdog = setTimeout(() => {
      if (!mountedRef.current) return;
      setLoading((stillLoading) => {
        if (stillLoading) {
          setError(
            new Error(
              "Roster request did not complete within 15s — /office/floor may be hanging.",
            ),
          );
        }
        return stillLoading;
      });
    }, 15_000);

    return () => clearTimeout(watchdog);
  }, [load]);

  useEffect(() => {
    if (!isRealMode()) return;

    const stream = openPresenceStream({
      onPresence: (row) => setPresence((rows) => mergePresenceRow(rows, row)),
      onConnected: () => {
        setLive(true);
        // Resync on every (re)connect. Events broadcast while we were
        // disconnected are gone — the stream has no replay for presence —
        // so without this a reconnected tab silently shows stale rooms.
        void load();
      },
      onError: () => setLive(false),
    });

    return () => stream.close();
  }, [load]);

  const people = useMemo(
    () => mergeFloorWithPresence(floor, presence),
    [floor, presence],
  );

  // Raw feed sizes, exposed for diagnostics. `people` is derived from
  // /floor, so an empty floor yields an empty office no matter how healthy
  // the stream is — worth being able to see the two apart.
  return {
    people,
    loading,
    error,
    live,
    roomNames,
    floorCount: floor.length,
    presenceCount: presence.length,
  };
}
