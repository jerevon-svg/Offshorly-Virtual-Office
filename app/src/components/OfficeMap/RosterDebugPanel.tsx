import { useEffect, useState } from "react";
import type { OfficePerson } from "../../services/office/floorMerge";

// Dev-only readout of live roster state.
//
// Everything this shows was previously invisible: a failed roster fetch, a
// dead SSE stream and a genuinely quiet office all render identically —
// an office that simply isn't changing. That made "is it working?"
// unanswerable without digging through the Network tab.
//
// Guarded on import.meta.env.DEV, which `vite build` sets false, so the
// whole component is dropped from a production bundle.

interface Props {
  people: OfficePerson[];
  loading: boolean;
  error: Error | null;
  live: boolean;
  viewerEmail: string | null;
}

export function RosterDebugPanel({ people, loading, error, live, viewerEmail }: Props) {
  // Counts events by watching the roster identity change — enough to prove
  // updates are landing without threading a counter through the stream.
  const [updates, setUpdates] = useState(0);
  const [lastUpdateAt, setLastUpdateAt] = useState<string | null>(null);

  useEffect(() => {
    setUpdates((n) => n + 1);
    setLastUpdateAt(new Date().toLocaleTimeString());
  }, [people]);

  if (!import.meta.env.DEV) return null;

  const viewer = viewerEmail
    ? people.find((p) => p.email.toLowerCase() === viewerEmail.toLowerCase())
    : undefined;

  const byRoom = new Map<string, number>();
  for (const person of people) {
    byRoom.set(person.roomId, (byRoom.get(person.roomId) ?? 0) + 1);
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 60,
        background: "rgba(17,17,17,0.88)",
        color: "#eee",
        font: "11px/1.5 ui-monospace, monospace",
        padding: "8px 10px",
        borderRadius: 8,
        maxWidth: 260,
        pointerEvents: "none",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>roster</div>
      <div>people: {loading ? "loading…" : people.length}</div>
      <div>
        stream:{" "}
        <span style={{ color: live ? "#7ddb7d" : "#ff8a8a" }}>
          {live ? "live" : "not live"}
        </span>
      </div>
      <div>
        merges: {updates}
        {lastUpdateAt ? ` (last ${lastUpdateAt})` : ""}
      </div>
      {error && <div style={{ color: "#ff8a8a" }}>error: {error.message}</div>}
      <div style={{ marginTop: 4 }}>
        you: {viewer ? `${viewer.roomId} · ${viewer.status}` : "not in roster"}
      </div>
      {viewer?.departmentName && <div>dept: {viewer.departmentName}</div>}
      <div style={{ marginTop: 4, opacity: 0.75 }}>
        {[...byRoom.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([room, n]) => `${room} ${n}`)
          .join(" · ")}
      </div>
    </div>
  );
}
