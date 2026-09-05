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
  sync: { handlers: SyncHandlers; sendElements: ReturnType<typeof vi.fn>; sendPointer: ReturnType<typeof vi.fn>; leave: ReturnType<typeof vi.fn> } | null;
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
    renderTopRightUI: (isMobile: boolean, appState: unknown) => ReactNode;
    excalidrawAPI: (api: unknown) => void;
  }) => {
    harness.initialData = props.initialData;
    harness.onChange = props.onChange;
    harness.onPointerDown = props.onPointerDown;
    // The real Excalidraw calls excalidrawAPI ONCE, from its class constructor — never again on
    // re-render or after StrictMode's simulated remount. Mirror that: hand it over during the
    // first render only, so a parent that drops the API in an effect cleanup is caught here.
    const handedOver = useRef(false);
    if (!handedOver.current) {
      handedOver.current = true;
      props.excalidrawAPI({
        getSceneElementsIncludingDeleted: () => harness.scene,
        getAppState: () => ({ viewBackgroundColor: "#ffffff", selectedElementIds: { x: true }, zoom: { value: 1 } }),
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
  joinWhiteboard: (_boardId: string, handlers: SyncHandlers) => {
    if (harness.syncMode === "none") return null;
    const sync = { handlers, sendElements: vi.fn(() => true), sendPointer: vi.fn(), leave: vi.fn() };
    harness.sync = sync;
    handlers.onStatus("connecting");
    return { selfId: () => "me", sendElements: sync.sendElements, sendPointer: sync.sendPointer, leave: sync.leave };
  },
}));

import WhiteboardEditor from "./WhiteboardEditor";

const base: Whiteboard = {
  id: "b1",
  conversationId: "c1",
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
      expect(screen.getByTestId("realtime-status")).toHaveTextContent("Live · 1 collaborator");
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
      expect(screen.getByTestId("realtime-status")).toHaveTextContent("Live · only you");
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
  });
});
