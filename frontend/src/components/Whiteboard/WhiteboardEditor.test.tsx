import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useEffect, useRef, type ReactNode } from "react";
import type { Whiteboard } from "../../services/whiteboard/whiteboardClient";
import type { SyncHandlers } from "../../services/whiteboard/whiteboardSyncClient";

// Editor persistence layer over a stubbed Excalidraw: jsdom has no canvas, so the real component
// is replaced by a harness that exposes the props the editor wires (initialData, onChange,
// excalidrawAPI). Asserts the migration contract: stored Excalidraw docs load, legacy tldraw
// docs open empty with a notice, scene changes autosave in the Excalidraw file format against
// the loaded version, appState-only changes do not save, and a 409 reloads the server's scene.

type Harness = {
  initialData: unknown;
  mounted: number;
  onChange?: (elements: unknown[], appState: unknown, files: unknown) => void;
  onPointerDown?: (activeTool: unknown, state: unknown) => void;
  activeTool: { type: string; customType: string | null };
  scene: Array<Record<string, unknown>>;
  updateScene: ReturnType<typeof vi.fn>;
  addFiles: ReturnType<typeof vi.fn>;
  setActiveTool: ReturnType<typeof vi.fn>;
  // W3 sync stub: "none" → joinWhiteboard returns null (REST fallback, the W1/W2 behaviour);
  // "live" → returns a handle and hands the editor's handlers back for the test to drive.
  syncMode: "none" | "live";
  sync: { handlers: SyncHandlers; sendElements: ReturnType<typeof vi.fn>; sendPointer: ReturnType<typeof vi.fn>; sendCursorChat: ReturnType<typeof vi.fn>; sendVoice: ReturnType<typeof vi.fn>; leave: ReturnType<typeof vi.fn> } | null;
  onPointerUpdate?: (payload: unknown) => void;
};
// vi.mock factories are hoisted above imports, so everything they reference must be hoisted too.
const { harness, saveWhiteboard, getWhiteboard, WhiteboardConflictError } = vi.hoisted(() => {
  class WhiteboardConflictError extends Error {}
  return {
    harness: {
      initialData: undefined,
      mounted: 0,
      activeTool: { type: "selection", customType: null },
      scene: [],
      updateScene: vi.fn(),
      addFiles: vi.fn(),
      setActiveTool: vi.fn(),
      syncMode: "none",
      sync: null,
    } as Harness,
    saveWhiteboard: vi.fn<(id: string, doc: Record<string, unknown>, version: number) => Promise<Whiteboard>>(),
    getWhiteboard: vi.fn<(id: string) => Promise<Whiteboard>>(),
    WhiteboardConflictError,
  };
});

vi.mock("@excalidraw/excalidraw/index.css", () => ({}));
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "NEVER", IMMEDIATELY: "IMMEDIATELY" },
  getSceneVersion: (elements: Array<{ version?: number }>) => elements.reduce((sum, el) => sum + (el.version ?? 0), 0),
  restoreElements: (elements: unknown[] | null) => elements ?? [],
  reconcileElements: (local: Array<{ id: string }>, remote: Array<{ id: string }>) => {
    const byId = new Map(local.map((el) => [el.id, el]));
    for (const el of remote) byId.set(el.id, el);
    return [...byId.values()];
  },
  // Skeleton → "converted" element: id it, keep everything else so the test can inspect it.
  convertToExcalidrawElements: (skeletons: Array<Record<string, unknown>>) =>
    skeletons.map((sk, i) => ({ ...sk, id: `note-${i + 1}`, version: 1 })),
  Excalidraw: (props: {
    initialData: unknown;
    onChange: Harness["onChange"];
    onPointerDown: Harness["onPointerDown"];
    onPointerUpdate: Harness["onPointerUpdate"];
    renderTopRightUI: (isMobile: boolean, appState: unknown) => ReactNode;
    excalidrawAPI: (api: unknown) => void;
  }) => {
    harness.initialData = props.initialData;
    harness.onChange = props.onChange;
    harness.onPointerDown = props.onPointerDown;
    harness.onPointerUpdate = props.onPointerUpdate;
    // The real Excalidraw calls excalidrawAPI ONCE, from its class constructor — never again on
    // re-render or after StrictMode's simulated remount. Mirror that: hand it over during the
    // first render only, so a parent that drops the API in an effect cleanup is caught here.
    const handedOver = useRef(false);
    if (!handedOver.current) {
      handedOver.current = true;
      props.excalidrawAPI({
        getSceneElementsIncludingDeleted: () => harness.scene,
        getAppState: () => ({ viewBackgroundColor: "#ffffff", selectedElementIds: { x: true }, zoom: { value: 1 }, scrollX: 0, scrollY: 0 }),
        onScrollChange: () => () => {},
        getFiles: () => ({}),
        updateScene: harness.updateScene,
        addFiles: harness.addFiles,
        setActiveTool: harness.setActiveTool,
      });
    }
    useEffect(() => {
      harness.mounted += 1;
    }, []);
    return (
      <div data-testid="excalidraw">
        <div data-testid="top-right">{props.renderTopRightUI(false, { activeTool: harness.activeTool })}</div>
      </div>
    );
  },
}));

vi.mock("../../services/whiteboard/whiteboardClient", () => ({
  saveWhiteboard: (id: string, doc: Record<string, unknown>, v: number) => saveWhiteboard(id, doc, v),
  getWhiteboard: (id: string) => getWhiteboard(id),
  WhiteboardConflictError,
}));

vi.mock("../../services/whiteboard/whiteboardSyncClient", () => ({
  CURSOR_CHAT_MAX_CHARS: 140,
  joinWhiteboard: (_boardId: string, handlers: SyncHandlers) => {
    if (harness.syncMode === "none") return null;
    const sync = { handlers, sendElements: vi.fn(() => true), sendPointer: vi.fn(), sendCursorChat: vi.fn(), sendVoice: vi.fn(), leave: vi.fn() };
    harness.sync = sync;
    handlers.onStatus("connecting");
    return { selfId: () => "me", sendElements: sync.sendElements, sendPointer: sync.sendPointer, sendCursorChat: sync.sendCursorChat, sendVoice: sync.sendVoice, leave: sync.leave };
  },
}));

// W5-B: the ONE call store, as a tiny controllable external store so tests can flip "connected to
// this board's voice" and watch the editor mirror it onto the whiteboard socket.
const callMock = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const base = {
    status: "idle" as string,
    connectedSessionId: null as string | null,
    connectedBoardId: null as string | null,
    boardError: null as { boardId: string; message: string } | null,
    micEnabled: false,
    audioPlaybackBlocked: false,
  };
  let snap = { ...base };
  return {
    get: () => snap,
    set: (patch: Partial<typeof base>) => {
      snap = { ...snap, ...patch };
      listeners.forEach((l) => l());
    },
    reset: () => {
      snap = { ...base };
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    leaveBoardVoice: vi.fn(),
    startOrJoinBoardVoice: vi.fn(),
    leaveCall: vi.fn(),
    setMicEnabled: vi.fn(),
  };
});
vi.mock("../../services/call/callStore", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useCallState: () => useSyncExternalStore(callMock.subscribe, callMock.get, callMock.get),
    leaveBoardVoice: (id: string) => callMock.leaveBoardVoice(id),
    startOrJoinBoardVoice: (id: string) => callMock.startOrJoinBoardVoice(id),
    leaveCall: () => callMock.leaveCall(),
    setMicEnabled: (on: boolean) => callMock.setMicEnabled(on),
    resumeAudioPlayback: vi.fn(),
    clearBoardError: vi.fn(),
  };
});

import WhiteboardEditor from "./WhiteboardEditor";

const base: Whiteboard = {
  id: "b1",
  conversationId: "c1",
  roomId: null,
  title: "Plan",
  version: 2,
  createdByEmail: "a@example.com",
  updatedByEmail: "a@example.com",
  createdAt: "2026-09-05T10:00:00.000Z",
  updatedAt: "2026-09-05T10:00:00.000Z",
  document: null,
};
const rect = { id: "r1", type: "rectangle", version: 1 };
const excalidrawDoc = { type: "excalidraw", version: 2, elements: [rect], appState: { viewBackgroundColor: "#fff" }, files: {} };
const tldrawDoc = { document: { store: { "shape:1": { type: "note" } }, schema: {} }, session: {} };

async function flushAutosave() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1600);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  saveWhiteboard.mockReset();
  getWhiteboard.mockReset();
  harness.updateScene.mockReset();
  harness.addFiles.mockReset();
  harness.setActiveTool.mockReset();
  harness.scene = [];
  harness.mounted = 0;
  harness.syncMode = "none";
  harness.sync = null;
  harness.activeTool = { type: "selection", customType: null };
  harness.initialData = undefined;
  callMock.reset();
  callMock.leaveBoardVoice.mockClear();
  callMock.startOrJoinBoardVoice.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("WhiteboardEditor (Excalidraw)", () => {
  it("loads a stored Excalidraw document as initialData, scrolled to content", () => {
    render(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} />);
    expect(harness.initialData).toMatchObject({ elements: [rect], appState: { viewBackgroundColor: "#fff" }, scrollToContent: true });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("never mounts the editor or saves over a legacy tldraw document until Start fresh is chosen", async () => {
    saveWhiteboard.mockResolvedValue({ ...base, version: 3 });
    render(<WhiteboardEditor board={{ ...base, document: tldrawDoc }} />);

    // Locked: notice + action, no Excalidraw, no save path.
    expect(screen.getByRole("note")).toHaveTextContent(/previous editor/);
    expect(screen.queryByTestId("excalidraw")).toBeNull();
    expect(harness.mounted).toBe(0);
    expect(screen.getByText("Save now")).toBeDisabled();
    fireEvent.click(screen.getByText("Save now"));
    await flushAutosave();
    expect(saveWhiteboard).not.toHaveBeenCalled();

    // Start fresh: an empty Excalidraw mounts, and the first change saves against the loaded version.
    fireEvent.click(screen.getByText("Start fresh"));
    expect(screen.getByTestId("excalidraw")).toBeInTheDocument();
    expect(harness.initialData).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(/Started fresh/);
    expect(screen.getByText("Save now")).toBeEnabled();

    harness.scene = [rect];
    act(() => harness.onChange!(harness.scene, {}, {}));
    await flushAutosave();
    expect(saveWhiteboard).toHaveBeenCalledTimes(1);
    expect(saveWhiteboard.mock.calls[0][1]).toMatchObject({ type: "excalidraw", elements: [rect] });
    expect(saveWhiteboard.mock.calls[0][2]).toBe(2);
  });

  it("serializes the scene Excalidraw last reported, not an API read — the API is empty once Excalidraw has unmounted", async () => {
    saveWhiteboard.mockResolvedValue({ ...base, version: 3 });
    const { unmount } = render(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} />);
    const drawn = [{ ...rect, version: 2 }];
    act(() => harness.onChange!(drawn, { viewBackgroundColor: "#ffffff" }, {}));
    // Excalidraw.componentWillUnmount swaps in a fresh empty scene before our cleanup runs.
    harness.scene = [];
    unmount();
    expect(saveWhiteboard).toHaveBeenCalledTimes(1);
    expect(saveWhiteboard.mock.calls[0][1]).toMatchObject({ elements: drawn });
    expect(saveWhiteboard.mock.calls[0][2]).toBe(2);
  });

  it("does not flush on unmount once the debounced save has already fired", async () => {
    saveWhiteboard.mockResolvedValue({ ...base, version: 3 });
    const { unmount } = render(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} />);
    act(() => harness.onChange!([{ ...rect, version: 2 }], { viewBackgroundColor: "#ffffff" }, {}));
    await flushAutosave();
    expect(saveWhiteboard).toHaveBeenCalledTimes(1);
    harness.scene = [];
    unmount();
    expect(saveWhiteboard).toHaveBeenCalledTimes(1);
  });

  it("unmounting a locked legacy board never flushes a save", () => {
    const { unmount } = render(<WhiteboardEditor board={{ ...base, document: tldrawDoc }} />);
    unmount();
    expect(saveWhiteboard).not.toHaveBeenCalled();
  });

  it("Sticky note button activates the custom tool and reflects its active state", () => {
    render(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} />);
    const button = screen.getByRole("button", { name: "Sticky note" });
    expect(button.className).toContain("ToolIcon");
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(harness.setActiveTool).toHaveBeenCalledWith({ type: "custom", customType: "sticky-note" });

    // Excalidraw re-renders its top-right UI on state changes; a scene change stands in for that.
    saveWhiteboard.mockResolvedValue({ ...base, version: 3 });
    harness.activeTool = { type: "custom", customType: "sticky-note" };
    act(() => harness.onChange!([{ ...rect, version: 2 }], {}, {}));
    expect(screen.getByRole("button", { name: "Sticky note" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a pointer-down with the sticky tool drops a note centred on the pointer, selects it and returns to selection", () => {
    render(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} />);
    harness.scene = [rect];

    // Other tools are Excalidraw's business.
    act(() => harness.onPointerDown!({ type: "rectangle", customType: null }, { origin: { x: 0, y: 0 } }));
    expect(harness.updateScene).not.toHaveBeenCalled();

    act(() => harness.onPointerDown!({ type: "custom", customType: "sticky-note" }, { origin: { x: 400, y: 300 } }));
    expect(harness.updateScene).toHaveBeenCalledTimes(1);
    const call = harness.updateScene.mock.calls[0][0];
    expect(call.elements).toHaveLength(2);
    expect(call.elements[0]).toBe(rect);
    expect(call.elements[1]).toMatchObject({ id: "note-1", type: "rectangle", x: 300, y: 220, width: 200, height: 160, label: { text: "Note" } });
    expect(call.appState).toEqual({ selectedElementIds: { "note-1": true } });
    expect(call.captureUpdate).toBe("IMMEDIATELY");
    expect(harness.setActiveTool).toHaveBeenLastCalledWith({ type: "selection" });
  });

  it("autosaves a scene change in the Excalidraw file format against the loaded version", async () => {
    saveWhiteboard.mockResolvedValue({ ...base, version: 3 });
    const onSaved = vi.fn();
    render(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} onSaved={onSaved} />);

    harness.scene = [{ ...rect, version: 2 }, { id: "gone", type: "ellipse", version: 1, isDeleted: true }];
    act(() => harness.onChange!(harness.scene, { viewBackgroundColor: "#ffffff", selectedElementIds: { r1: true } }, {}));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await flushAutosave();
    expect(saveWhiteboard).toHaveBeenCalledTimes(1);
    const [id, doc, version] = saveWhiteboard.mock.calls[0];
    expect(id).toBe("b1");
    expect(version).toBe(2);
    expect(doc).toMatchObject({ type: "excalidraw", version: 2, elements: [{ ...rect, version: 2 }], appState: { viewBackgroundColor: "#ffffff" } });
    expect(doc.appState).not.toHaveProperty("selectedElementIds");
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }));

    // The next save presents the bumped version the server returned.
    harness.scene = [{ ...rect, version: 4 }];
    act(() => harness.onChange!(harness.scene, {}, {}));
    await flushAutosave();
    expect(saveWhiteboard.mock.calls[1][2]).toBe(3);
  });

  it("still saves under React StrictMode, whose mount-time effect cleanup must not drop the editor API", async () => {
    saveWhiteboard.mockResolvedValue({ ...base, version: 3 });
    render(
      <StrictMode>
        <WhiteboardEditor board={{ ...base, document: excalidrawDoc }} />
      </StrictMode>,
    );
    harness.scene = [{ ...rect, version: 2 }];
    act(() => harness.onChange!(harness.scene, {}, {}));
    await flushAutosave();
    expect(saveWhiteboard).toHaveBeenCalledTimes(1);
    expect(saveWhiteboard.mock.calls[0][1]).toMatchObject({ type: "excalidraw", elements: [{ ...rect, version: 2 }] });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("ignores onChange calls whose scene version is unchanged (selection/zoom only)", async () => {
    render(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} />);
    act(() => harness.onChange!([rect], { selectedElementIds: { r1: true } }, {}));
    await flushAutosave();
    expect(saveWhiteboard).not.toHaveBeenCalled();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("surfaces a 409 as a conflict and reloads the server's scene without an undo entry", async () => {
    saveWhiteboard.mockRejectedValue(new WhiteboardConflictError("stale"));
    const serverRect = { id: "r9", type: "rectangle", version: 5 };
    getWhiteboard.mockResolvedValue({ ...base, version: 7, document: { ...excalidrawDoc, elements: [serverRect] } });
    render(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} />);

    harness.scene = [{ ...rect, version: 2 }];
    act(() => harness.onChange!(harness.scene, {}, {}));
    await flushAutosave();
    expect(screen.getByText(/Someone else saved a newer version/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Reload latest"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(harness.updateScene).toHaveBeenCalledTimes(1);
    expect(harness.updateScene).toHaveBeenCalledWith({ elements: [serverRect], captureUpdate: "NEVER" });
    expect(screen.queryByText(/Someone else saved/)).toBeNull();

    // Saving again after the reload uses the reloaded version.
    saveWhiteboard.mockResolvedValue({ ...base, version: 8 });
    harness.scene = [serverRect, { ...rect, version: 1 }];
    act(() => harness.onChange!(harness.scene, {}, {}));
    await flushAutosave();
    expect(saveWhiteboard.mock.lastCall?.[2]).toBe(7);
  });

  describe("W3 realtime (live room)", () => {
    const other = { sid: "s-other", email: "b@example.com", username: "b", color: { background: "#eee", stroke: "#333" } };
    const me = { sid: "me", email: "a@example.com", username: "a", color: { background: "#eee", stroke: "#333" } };
    const snapshot = (elements: unknown[], extra: Record<string, unknown> = {}) => ({
      boardId: "b1",
      elements,
      appState: {},
      files: {},
      version: 5,
      seq: 3,
      collaborators: [me, other],
      ...extra,
    });

    function renderLive() {
      harness.syncMode = "live";
      const utils = render(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} />);
      const sync = harness.sync!;
      act(() => {
        sync.handlers.onSnapshot(snapshot([{ ...rect, versionNonce: 1 }]) as never);
        sync.handlers.onStatus("live");
      });
      return { ...utils, sync };
    }

    it("shows live status with the collaborator count and hides the REST save button", () => {
      renderLive();
      // Live: the server persists every batch, so the bar shows the saved chip and the presence
      // pile's count rather than a connection sentence (which is kept for unsettled states).
      expect(screen.getByTestId("saved-chip")).toHaveTextContent("Saved");
      expect(screen.getByTestId("presence-count")).toHaveTextContent("2 here");
      expect(screen.queryByText("Save now")).toBeNull();
      // The snapshot replaced the scene without an undo entry.
      expect(harness.updateScene).toHaveBeenCalledWith(expect.objectContaining({ captureUpdate: "NEVER" }));
    });

    it("sends only changed elements (tombstones included) over the room and never REST-saves while live", async () => {
      const { sync } = renderLive();
      const drawn = { id: "n1", type: "ellipse", version: 1, versionNonce: 7 };
      const deleted = { ...rect, version: 2, versionNonce: 1, isDeleted: true };
      act(() => harness.onChange!([deleted, drawn], {}, {}));
      expect(sync.sendElements).toHaveBeenCalledTimes(1);
      const [elements, seq] = sync.sendElements.mock.calls[0];
      expect(elements.map((e: { id: string }) => e.id).sort()).toEqual(["n1", "r1"]);
      expect(seq).toBe(1);
      await flushAutosave();
      expect(saveWhiteboard).not.toHaveBeenCalled();
      // Same scene reported again (selection change): nothing new to send.
      act(() => harness.onChange!([deleted, drawn], { selectedElementIds: { n1: true } }, {}));
      expect(sync.sendElements).toHaveBeenCalledTimes(1);
    });

    it("applies remote elements through reconcile with captureUpdate NEVER and does not echo them back", () => {
      const { sync } = renderLive();
      harness.updateScene.mockClear();
      const remote = { id: "z1", type: "rectangle", version: 3, versionNonce: 2 };
      act(() => sync.handlers.onRemoteElements([remote]));
      expect(harness.updateScene).toHaveBeenCalledTimes(1);
      const call = harness.updateScene.mock.calls[0][0];
      expect(call.captureUpdate).toBe("NEVER");
      expect(call.elements.map((e: { id: string }) => e.id)).toEqual(["r1", "z1"]);
      // Excalidraw reports the merged scene back via onChange — nothing is re-sent.
      act(() => harness.onChange!(call.elements, {}, {}));
      expect(sync.sendElements).not.toHaveBeenCalled();
    });

    it("on rejoin, reconciles only unacknowledged local changes against the snapshot and resends the survivors", () => {
      const { sync } = renderLive();
      // Two local edits sent but never acked; a third acked.
      const winner = { id: "w", type: "rectangle", version: 9, versionNonce: 1 };
      const loser = { ...rect, version: 2, versionNonce: 9 }; // server will hold r1 at version 4
      const acked = { id: "k", type: "rectangle", version: 1, versionNonce: 1 };
      act(() => harness.onChange!([winner, loser, acked], {}, {}));
      expect(sync.sendElements).toHaveBeenCalledTimes(1);
      act(() => sync.handlers.onAck(0)); // acks nothing (seq 1 > 0)
      act(() => sync.handlers.onStatus("reconnecting"));
      expect(screen.getByTestId("realtime-status")).toHaveTextContent(/Reconnecting/);
      // While reconnecting, a further local edit is held, not sent.
      const held = { id: "h", type: "rectangle", version: 1, versionNonce: 1 };
      act(() => harness.onChange!([winner, loser, acked, held], {}, {}));
      expect(sync.sendElements).toHaveBeenCalledTimes(1);

      harness.updateScene.mockClear();
      const serverR1 = { ...rect, version: 4, versionNonce: 0 };
      act(() => {
        sync.handlers.onSnapshot(snapshot([serverR1, acked]) as never);
        sync.handlers.onStatus("live");
      });
      // Resent: w (unknown to server), h (held); dropped: r1 (server newer), k (identical).
      expect(sync.sendElements).toHaveBeenCalledTimes(2);
      const resent = sync.sendElements.mock.calls[1][0].map((e: { id: string }) => e.id).sort();
      expect(resent).toEqual(["h", "w"]);
      const scene = harness.updateScene.mock.calls[0][0].elements;
      expect(scene.find((e: { id: string }) => e.id === "r1").version).toBe(4);
      expect(scene.map((e: { id: string }) => e.id).sort()).toEqual(["h", "k", "r1", "w"]);
    });

    it("renders collaborator cursors from presence and pointer events, excluding itself", () => {
      const { sync } = renderLive();
      harness.updateScene.mockClear();
      act(() => sync.handlers.onPointer({ ...other, boardId: "b1", pointer: { x: 10, y: 20, tool: "pointer" }, button: "down", selectedElementIds: {} }));
      const collaborators = harness.updateScene.mock.lastCall![0].collaborators as Map<string, { pointer?: { x: number } }>;
      expect([...collaborators.keys()]).toEqual(["s-other"]);
      expect(collaborators.get("s-other")?.pointer?.x).toBe(10);
      act(() => sync.handlers.onPresence([me]));
      expect(screen.getByTestId("presence-count")).toHaveTextContent("1 here");
      expect((harness.updateScene.mock.lastCall![0].collaborators as Map<string, unknown>).size).toBe(0);
    });

    it("falls back to REST when the join is refused, flushing anything drawn meanwhile", async () => {
      harness.syncMode = "live";
      saveWhiteboard.mockResolvedValue({ ...base, version: 3 });
      render(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} />);
      const sync = harness.sync!;
      expect(screen.getByTestId("realtime-status")).toHaveTextContent("Connecting");
      act(() => harness.onChange!([{ ...rect, version: 2 }], { viewBackgroundColor: "#ffffff" }, {}));
      expect(sync.sendElements).not.toHaveBeenCalled(); // not live yet: held
      act(() => sync.handlers.onStatus("offline"));
      expect(screen.getByText("Save now")).toBeInTheDocument();
      await flushAutosave();
      expect(saveWhiteboard).toHaveBeenCalledTimes(1);
      expect(saveWhiteboard.mock.calls[0][1]).toMatchObject({ elements: [{ ...rect, version: 2 }] });
    });

    it("leaves the room on unmount", () => {
      const { sync, unmount } = renderLive();
      unmount();
      expect(sync.leave).toHaveBeenCalledTimes(1);
    });

    describe("W5-C Ask Toucan", () => {
      it("shows the Ask Toucan entry only when wired, and it calls back without touching the board", () => {
        const onAskToucan = vi.fn();
        harness.syncMode = "live";
        const { rerender } = render(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} onAskToucan={onAskToucan} />);
        act(() => {
          harness.sync!.handlers.onSnapshot(snapshot([]) as never);
          harness.sync!.handlers.onStatus("live");
        });
        harness.updateScene.mockClear();
        fireEvent.click(screen.getByRole("button", { name: "Ask Toucan about this board" }));
        expect(onAskToucan).toHaveBeenCalledTimes(1);
        expect(harness.updateScene).not.toHaveBeenCalled();
        expect(harness.sync!.sendElements).not.toHaveBeenCalled();
        rerender(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} />);
        expect(screen.queryByRole("button", { name: "Ask Toucan about this board" })).toBeNull();
      });
    });

    describe("W5-B board voice", () => {
      it("Join Voice is explicit: rendering a board never joins or touches the mic; the click does", () => {
        renderLive();
        expect(callMock.startOrJoinBoardVoice).not.toHaveBeenCalled();
        expect(harness.sync!.sendVoice).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Join voice" }));
        expect(callMock.startOrJoinBoardVoice).toHaveBeenCalledWith("b1");
      });

      it("mirrors 'connected to THIS board' onto the room as whiteboard_voice, re-sends after a reconnect, and clears on leave", () => {
        const { sync } = renderLive();
        act(() => callMock.set({ status: "connected", connectedBoardId: "b1", micEnabled: true }));
        expect(sync.sendVoice.mock.calls).toEqual([[true]]);
        expect(screen.getByRole("button", { name: "Mute microphone" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Leave voice" })).toBeInTheDocument();

        act(() => sync.handlers.onStatus("reconnecting"));
        act(() => sync.handlers.onStatus("live"));
        expect(sync.sendVoice.mock.calls).toEqual([[true], [true]]);

        // Some OTHER board's voice or a spatial call is never reported as ours.
        act(() => callMock.set({ status: "connected", connectedBoardId: "other" }));
        expect(sync.sendVoice.mock.calls).toEqual([[true], [true], [false]]);
        act(() => callMock.set({ status: "idle", connectedBoardId: null }));
        expect(sync.sendVoice.mock.calls).toEqual([[true], [true], [false]]);
      });

      it("Join Voice is disabled while connected to another media room, and shows who is in voice", () => {
        const { sync } = renderLive();
        act(() => callMock.set({ status: "connected", connectedSessionId: "conv-9" }));
        const join = screen.getByRole("button", { name: "Join voice" });
        expect(join).toBeDisabled();
        expect(join).toHaveAttribute("title", "Leave your current call first");
        act(() => sync.handlers.onPresence([me, { ...other, voice: true }]));
        expect(screen.getAllByTestId("presence-voice")).toHaveLength(1);
        expect(join).toHaveTextContent("Join Voice · 1");
      });

      it("a board-voice failure is shown inside the board, scoped to this board", () => {
        renderLive();
        act(() => callMock.set({ boardError: { boardId: "b1", message: "Voice calling is not configured" } }));
        expect(screen.getByRole("alert")).toHaveTextContent("Voice calling is not configured");
        act(() => callMock.set({ boardError: { boardId: "zzz", message: "elsewhere" } }));
        expect(screen.queryByRole("alert")).toBeNull();
      });

      it("closing the board leaves THIS board's voice", () => {
        const { unmount } = renderLive();
        unmount();
        expect(callMock.leaveBoardVoice).toHaveBeenCalledWith("b1");
      });
    });

    describe("W5-A presence strip + cursor chat", () => {
      // OfficeMap's resolver hands back an email-shaped placeholder for people outside the roster.
      const names: Record<string, string> = { "a@example.com": "Alex Reyes", "b@example.com": "Bon Santos" };
      const resolve = (email: string) => names[email] ?? email[0].toUpperCase() + email.slice(1);
      const chat = (text: string) => ({ ...other, boardId: "b1", text });
      const pointerAt = (x: number, y: number) =>
        ({ ...other, boardId: "b1", pointer: { x, y, tool: "pointer" as const }, button: "up" as const, selectedElementIds: {} });

      function renderLiveNamed() {
        harness.syncMode = "live";
        const utils = render(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} resolveDisplayName={resolve} />);
        const sync = harness.sync!;
        act(() => {
          sync.handlers.onSnapshot(snapshot([]) as never);
          sync.handlers.onStatus("live");
        });
        return { ...utils, sync };
      }

      it("shows every collaborator by employee name, self first as You, and feeds the resolved name to Excalidraw's cursor label", () => {
        const { sync } = renderLiveNamed();
        const chips = screen.getAllByTestId("presence-chip");
        expect(chips.map((c) => c.textContent)).toEqual(["ARYou", "BSBon Santos"]);
        expect(chips[1]).toHaveAttribute("title", "Bon Santos");
        const collaborators = harness.updateScene.mock.lastCall![0].collaborators as Map<string, { username: string }>;
        expect(collaborators.get("s-other")?.username).toBe("Bon Santos");
        act(() => sync.handlers.onPresence([me]));
        expect(screen.getAllByTestId("presence-chip")).toHaveLength(1);
        // Unknown to the roster → capitalised wire username, never the email.
        act(() => sync.handlers.onPresence([me, { ...other, sid: "s-x", email: "x@example.com", username: "xavier" }]));
        expect(screen.getAllByTestId("presence-chip")[1]).toHaveTextContent("Xavier");
      });

      it("new resolveDisplayName / onSaved identities (parent re-render) never leave and rejoin the room", () => {
        const { sync, rerender } = renderLiveNamed();
        rerender(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} onSaved={() => {}} resolveDisplayName={(email) => resolve(email) + "!"} />);
        rerender(<WhiteboardEditor board={{ ...base, document: excalidrawDoc }} onSaved={() => {}} resolveDisplayName={(email) => resolve(email) + "!"} />);
        expect(sync.leave).not.toHaveBeenCalled();
        act(() => sync.handlers.onPresence([me, other]));
        expect(screen.getAllByTestId("presence-chip")[1]).toHaveTextContent("Bon Santos!");
      });

      it("renders a remote bubble beside that collaborator's cursor, follows it, and drops it ~4s after the last update", () => {
        const { sync } = renderLiveNamed();
        act(() => sync.handlers.onPointer(pointerAt(100, 50)));
        act(() => sync.handlers.onCursorChat(chat("on my way")));
        const bubble = screen.getByTestId("cursor-chat-bubble");
        expect(bubble).toHaveTextContent("Bon Santos");
        expect(bubble).toHaveTextContent("on my way");
        expect(bubble.style.left).toBe("114px");
        expect(bubble.style.top).toBe("86px");

        act(() => sync.handlers.onPointer(pointerAt(200, 50)));
        expect(screen.getByTestId("cursor-chat-bubble").style.left).toBe("214px");

        act(() => vi.advanceTimersByTime(3000));
        act(() => sync.handlers.onCursorChat(chat("on my way!")));
        act(() => vi.advanceTimersByTime(3000));
        expect(screen.getByTestId("cursor-chat-bubble")).toHaveTextContent("on my way!");
        act(() => vi.advanceTimersByTime(1100));
        expect(screen.queryByTestId("cursor-chat-bubble")).toBeNull();
      });

      it("clears a remote bubble on an empty message, when the collaborator leaves, and when the connection drops", () => {
        const { sync } = renderLiveNamed();
        act(() => sync.handlers.onPointer(pointerAt(1, 1)));
        act(() => sync.handlers.onCursorChat(chat("a")));
        act(() => sync.handlers.onCursorChat(chat("")));
        expect(screen.queryByTestId("cursor-chat-bubble")).toBeNull();

        act(() => sync.handlers.onCursorChat(chat("b")));
        act(() => sync.handlers.onPresence([me]));
        expect(screen.queryByTestId("cursor-chat-bubble")).toBeNull();

        act(() => sync.handlers.onPresence([me, other]));
        act(() => sync.handlers.onPointer(pointerAt(1, 1)));
        act(() => sync.handlers.onCursorChat(chat("c")));
        expect(screen.getByTestId("cursor-chat-bubble")).toBeInTheDocument();
        act(() => sync.handlers.onStatus("reconnecting"));
        expect(screen.queryByTestId("cursor-chat-bubble")).toBeNull();
        // Own messages echoed back are never shown as a bubble.
        act(() => sync.handlers.onStatus("live"));
        act(() => sync.handlers.onCursorChat({ ...me, boardId: "b1", text: "mine" }));
        expect(screen.queryByTestId("cursor-chat-bubble")).toBeNull();
      });

      it("'/' over the canvas opens the input at the own pointer; typing sends at most every 200ms; Enter clears and closes", () => {
        const { sync } = renderLiveNamed();
        act(() => harness.onPointerUpdate!({ pointer: { x: 10, y: 20, tool: "pointer" }, button: "up", pointersMap: new Map() }));
        const canvas = screen.getByTestId("excalidraw").parentElement!;
        // Hovering without clicking leaves focus on <body>: the hotkey must still work from there.
        fireEvent.keyDown(document.body, { key: "/" });
        const input = screen.getByTestId("cursor-chat-input");
        expect(input).toHaveAttribute("maxlength", "140");
        expect(input.parentElement!.style.left).toBe("24px");
        expect(input.parentElement!.style.top).toBe("56px");

        fireEvent.change(input, { target: { value: "h" } });
        fireEvent.change(input, { target: { value: "he" } });
        fireEvent.change(input, { target: { value: "hey" } });
        expect(sync.sendCursorChat).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(200));
        expect(sync.sendCursorChat.mock.calls).toEqual([["hey"]]);

        fireEvent.keyDown(input, { key: "Enter" });
        expect(sync.sendCursorChat.mock.calls).toEqual([["hey"], [""]]);
        expect(screen.queryByTestId("cursor-chat-input")).toBeNull();

        // Not while typing into a text field, and never when realtime is not live.
        fireEvent.keyDown(canvas, { key: "/" });
        const reopened = screen.getByTestId("cursor-chat-input");
        fireEvent.keyDown(reopened, { key: "/" });
        expect(screen.getAllByTestId("cursor-chat-input")).toHaveLength(1);
        fireEvent.keyDown(reopened, { key: "Escape" });
        expect(screen.queryByTestId("cursor-chat-input")).toBeNull();
        // A textarea OUTSIDE the editor: blocks the hotkey while reachable, not while this dialog
        // covers it (a chat composer left focused behind the modal).
        const behind = document.createElement("textarea");
        document.body.appendChild(behind);
        fireEvent.keyDown(behind, { key: "/" });
        expect(screen.queryByTestId("cursor-chat-input")).toBeNull();
        const original = document.elementFromPoint;
        document.elementFromPoint = () => canvas;
        fireEvent.keyDown(behind, { key: "/" });
        expect(screen.getByTestId("cursor-chat-input")).toBeInTheDocument();
        fireEvent.keyDown(screen.getByTestId("cursor-chat-input"), { key: "Escape" });
        document.elementFromPoint = original;
        behind.remove();
        act(() => sync.handlers.onStatus("reconnecting"));
        fireEvent.keyDown(canvas, { key: "/" });
        expect(screen.queryByTestId("cursor-chat-input")).toBeNull();
      });

      it("the own input closes on its own ~4s after the last keystroke and clears the remote copy", () => {
        const { sync } = renderLiveNamed();
        fireEvent.click(screen.getByRole("button", { name: "Cursor chat" }));
        const input = screen.getByTestId("cursor-chat-input");
        fireEvent.change(input, { target: { value: "brb" } });
        act(() => vi.advanceTimersByTime(3900));
        expect(screen.getByTestId("cursor-chat-input")).toBeInTheDocument();
        act(() => vi.advanceTimersByTime(200));
        expect(screen.queryByTestId("cursor-chat-input")).toBeNull();
        expect(sync.sendCursorChat.mock.calls).toEqual([["brb"], [""]]);
      });
    });
  });
});
