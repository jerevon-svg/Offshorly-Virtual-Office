import { useEffect, useMemo, useRef, useState } from "react";
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

  // Lets the stream's onConnected refetch the snapshot without being a
  // dependency of the effect that owns the stream (which would tear the
  // stream down and reopen it on every reload).
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Parallel: the endpoints are independent, and serializing them
        // doubles the time the floor sits empty.
        const [nextFloor, nextPresence] = await Promise.all([
          officeService.getFloor(),
          officeService.getPresence(),
        ]);
        if (cancelled) return;
        setFloor(nextFloor);
        setPresence(nextPresence);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        // apiFetch has already navigated away on a 401, so this is a
        // genuine failure — surface it rather than rendering an empty
        // office as though nobody were in.
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    reloadRef.current = () => void load();
    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isRealMode()) return;

    const stream = openPresenceStream({
      onPresence: (row) => setPresence((rows) => mergePresenceRow(rows, row)),
      onConnected: () => {
        setLive(true);
        // Resync on every (re)connect. Events broadcast while we were
        // disconnected are gone — the stream has no replay for presence —
        // so without this a reconnected tab silently shows stale rooms.
        reloadRef.current();
      },
      onError: () => setLive(false),
    });

    return () => stream.close();
  }, []);

  const people = useMemo(
    () => mergeFloorWithPresence(floor, presence),
    [floor, presence],
  );

  return { people, loading, error, live, roomNames };
}
