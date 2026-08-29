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

// Same join key floorMerge.ts uses — emails are not case-consistent across
// Zoho/Cliq/Atlas, so every lookup here is on the normalized form.
function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

// A presence_update for someone the /floor snapshot never contained is a
// dead letter: mergeFloorWithPresence is `floor.map(...)`, so the row sits
// in `presence` state and never becomes a person. Until now the only way
// they appeared was the next SSE (re)connect resync or a reload. On such an
// event we refetch /floor ONCE (deduplicated — repeat unknown events while a
// refetch is in flight just join it) and let the existing merge pick them
// up. If Atlas still doesn't list them, nothing is fabricated and that
// email is put on a cooldown so a chatty presence source can't turn one
// missing employee into a /floor request loop.
const UNKNOWN_EMAIL_REFETCH_COOLDOWN_MS = 60_000;

interface UnknownEmailRefetchState {
  inFlight: Promise<void> | null;
  /** Normalized emails whose event triggered/joined the in-flight refetch. */
  pending: Set<string>;
  /** Normalized email -> epoch ms before which we won't refetch for it again. */
  cooldownUntil: Map<string, number>;
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

  // Normalized emails of the CURRENT floor, readable from the SSE callback
  // without closing over stale `floor` state.
  const floorEmailsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    floorEmailsRef.current = new Set(floor.map((person) => emailKey(person.user_email)));
  }, [floor]);

  // True while load() (initial fetch or a reconnect resync) is fetching
  // /floor — an unknown-email refetch during that window would only
  // duplicate the request that is already about to land.
  const loadInFlightRef = useRef(false);

  const load = useCallback(async () => {
    loadInFlightRef.current = true;
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
      loadInFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const unknownRefetchRef = useRef<UnknownEmailRefetchState>({
    inFlight: null,
    pending: new Set(),
    cooldownUntil: new Map(),
  });

  // See UNKNOWN_EMAIL_REFETCH_COOLDOWN_MS. Floor-only refetch: the live
  // `presence` state already holds the newest snapshot (this very event
  // included), so the existing mergeFloorWithPresence memo below does the
  // join — no separate merge path.
  const refetchFloorForUnknownEmail = useCallback((email: string) => {
    const key = emailKey(email);
    if (floorEmailsRef.current.has(key)) return;
    if (loadInFlightRef.current) return;

    const state = unknownRefetchRef.current;
    const until = state.cooldownUntil.get(key);
    if (until !== undefined && Date.now() < until) return;

    state.pending.add(key);
    if (state.inFlight) return; // join the refetch already running

    state.inFlight = officeService
      .getFloor()
      .then((nextFloor) => {
        if (!mountedRef.current) return;
        const nextKeys = new Set(nextFloor.map((person) => emailKey(person.user_email)));
        floorEmailsRef.current = nextKeys;
        setFloor(nextFloor);
        const now = Date.now();
        for (const pendingKey of state.pending) {
          if (nextKeys.has(pendingKey)) state.cooldownUntil.delete(pendingKey);
          else state.cooldownUntil.set(pendingKey, now + UNKNOWN_EMAIL_REFETCH_COOLDOWN_MS);
        }
      })
      .catch(() => {
        // Keep the current floor. Cool the pending emails down too, so a
        // failing /floor can't be hammered by every further unknown event.
        const now = Date.now();
        for (const pendingKey of state.pending) {
          state.cooldownUntil.set(pendingKey, now + UNKNOWN_EMAIL_REFETCH_COOLDOWN_MS);
        }
      })
      .finally(() => {
        state.pending.clear();
        state.inFlight = null;
      });
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
      onPresence: (row) => {
        setPresence((rows) => mergePresenceRow(rows, row));
        if (row?.user_email) refetchFloorForUnknownEmail(row.user_email);
      },
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
  }, [load, refetchFloorForUnknownEmail]);

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
