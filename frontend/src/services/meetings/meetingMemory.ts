import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMemory, type MemoryFilter, type MemoryPreview, type MemorySession } from "./meetingReceiptClient";

// PHASE 8A — MEETING MEMORY state: the caller's ended Meeting Sessions, one server page at a time. The server
// decides what is in it (meeting_access per row, before any content), what matched a search and what the
// preview says; this hook only holds the query, the filter and the pages already loaded. It is local to the
// Meetings panel — no global store, and nothing here touches call, travel, director or Go Together state.
// Opening a memory is the existing Receipt, keyed by the Meeting Session id.

export const MEMORY_PAGE = 20;
const MAX_PAGE = 50;
const SEARCH_DELAY_MS = 250;

export interface MemoryState {
  sessions: MemorySession[];
  nextCursor: string | null;
  /** The first page for the current query/filter is on its way. */
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

const EMPTY: MemoryState = { sessions: [], nextCursor: null, loading: true, loadingMore: false, error: null };

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return out;
}

/** `enabled` defers the first request until the Memory tab is actually opened. */
export function useMeetingMemory(enabled: boolean) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MemoryFilter>("all");
  const q = useDebounced(query.trim(), SEARCH_DELAY_MS);
  const [state, setState] = useState<MemoryState>(EMPTY);
  // Every request carries the sequence it was made under; a newer query (or unmount) makes it stale.
  const seq = useRef(0);
  useEffect(() => () => {
    seq.current += 1;
  }, []);

  const loadFirst = useCallback(
    async (limit = MEMORY_PAGE) => {
      const mine = ++seq.current;
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const page = await fetchMemory({ q, filter, limit });
        if (seq.current === mine) setState({ ...page, loading: false, loadingMore: false, error: null });
      } catch (err) {
        if (seq.current === mine)
          setState({ ...EMPTY, loading: false, error: err instanceof Error ? err.message : "Could not load" });
      }
    },
    [q, filter],
  );

  useEffect(() => {
    if (enabled) void loadFirst();
  }, [enabled, loadFirst]);

  const loadMore = useCallback(async () => {
    const cursor = state.nextCursor;
    if (!cursor || state.loadingMore || state.loading) return;
    const mine = seq.current;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const page = await fetchMemory({ q, filter, cursor, limit: MEMORY_PAGE });
      if (seq.current !== mine) return;
      setState((s) => {
        const have = new Set(s.sessions.map((x) => x.sessionId));
        return {
          ...s,
          sessions: [...s.sessions, ...page.sessions.filter((x) => !have.has(x.sessionId))],
          nextCursor: page.nextCursor,
          loadingMore: false,
        };
      });
    } catch (err) {
      if (seq.current === mine)
        setState((s) => ({ ...s, loadingMore: false, error: err instanceof Error ? err.message : "Could not load" }));
    }
  }, [q, filter, state.nextCursor, state.loadingMore, state.loading]);

  /** Re-read what is on screen (after returning from a Receipt, whose reviews may have changed a preview). */
  const refresh = useCallback(
    () => loadFirst(Math.min(MAX_PAGE, Math.max(MEMORY_PAGE, state.sessions.length))),
    [loadFirst, state.sessions.length],
  );

  return { ...state, query, setQuery, filter, setFilter, searching: q.length > 0, loadMore, refresh };
}

export type MeetingMemory = ReturnType<typeof useMeetingMemory>;

/** Who stands behind a preview: every active item human-reviewed, some, or none (VO's suggestion). */
export function previewReview(p: MemoryPreview): "reviewed" | "partly" | "suggested" {
  if (p.activeCount > 0 && p.reviewedCount >= p.activeCount) return "reviewed";
  return p.reviewedCount > 0 ? "partly" : "suggested";
}

/** "2 decisions · 1 commitment · 3 open" — active items only, zero counts left out. */
export function previewCounts(p: MemoryPreview): string {
  const parts: string[] = [];
  const { decisions, commitments, openLoops } = p.counts;
  if (decisions) parts.push(`${decisions} decision${decisions === 1 ? "" : "s"}`);
  if (commitments) parts.push(`${commitments} commitment${commitments === 1 ? "" : "s"}`);
  if (openLoops) parts.push(`${openLoops} open`);
  return parts.join(" · ");
}
