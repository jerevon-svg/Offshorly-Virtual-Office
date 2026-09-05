import { describe, expect, it } from "vitest";
import {
  acknowledge,
  changedElements,
  reconcileUnacked,
  remoteWins,
  versionsOf,
  type PendingEntry,
  type SyncElement,
} from "./whiteboardSync";

const el = (id: string, version: number, versionNonce: number, extra: Record<string, unknown> = {}): SyncElement => ({
  id,
  version,
  versionNonce,
  ...extra,
});

describe("remoteWins (Excalidraw reconcile rule)", () => {
  it("accepts unknown elements and higher versions", () => {
    expect(remoteWins(undefined, el("a", 1, 1))).toBe(true);
    expect(remoteWins(el("a", 1, 9), el("a", 2, 0))).toBe(true);
    expect(remoteWins(el("a", 3, 0), el("a", 2, 9))).toBe(false);
  });

  it("breaks an equal version by lower nonce, and treats an identical copy as no change", () => {
    expect(remoteWins(el("a", 2, 50), el("a", 2, 10))).toBe(true);
    expect(remoteWins(el("a", 2, 10), el("a", 2, 50))).toBe(false);
    expect(remoteWins(el("a", 2, 10), el("a", 2, 10))).toBe(false);
  });
});

describe("changedElements", () => {
  it("returns elements whose version differs from the known map, including tombstones", () => {
    const known = new Map([["a", 1], ["b", 2]]);
    const changed = changedElements([el("a", 1, 0), el("b", 3, 0, { isDeleted: true }), el("c", 1, 0)], known);
    expect(changed.map((e) => e.id)).toEqual(["b", "c"]);
  });
});

describe("reconcileUnacked", () => {
  const snapshot = [el("a", 5, 1), el("b", 2, 2, { isDeleted: true }), el("c", 1, 1)];

  it("keeps and resends only pending changes that beat the snapshot; drops stale ones", () => {
    const pending = [
      el("a", 6, 1), // newer than snapshot → wins
      el("b", 1, 1), // stale copy of a deleted element → dropped, tombstone kept
      el("c", 1, 0), // equal version, lower nonce → wins
      el("d", 1, 1), // unknown to the server → wins
    ];
    const { scene, resend } = reconcileUnacked(pending, snapshot);
    expect(resend.map((e) => e.id)).toEqual(["a", "c", "d"]);
    const byId = new Map(scene.map((e) => [e.id, e]));
    expect(byId.get("a")?.version).toBe(6);
    expect(byId.get("b")?.isDeleted).toBe(true);
    expect(byId.get("c")?.versionNonce).toBe(0);
    expect(byId.has("d")).toBe(true);
  });

  it("with nothing pending, the scene is exactly the snapshot", () => {
    const { scene, resend } = reconcileUnacked([], snapshot);
    expect(scene).toEqual(snapshot);
    expect(resend).toEqual([]);
  });
});

describe("versionsOf / acknowledge", () => {
  it("maps ids to versions", () => {
    expect(versionsOf([el("a", 3, 0), el("b", 1, 0)])).toEqual(new Map([["a", 3], ["b", 1]]));
  });

  it("acknowledge removes entries sent at or before the acked seq only", () => {
    const pending = new Map<string, PendingEntry>([
      ["a", { element: el("a", 1, 0), seq: 1 }],
      ["b", { element: el("b", 2, 0), seq: 2 }],
      ["c", { element: el("c", 1, 0), seq: 3 }],
    ]);
    acknowledge(pending, 2);
    expect([...pending.keys()]).toEqual(["c"]);
  });
});
