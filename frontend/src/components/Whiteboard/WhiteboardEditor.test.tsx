import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useEffect, useRef, type ReactNode } from "react";
import type { Whiteboard } from "../../services/whiteboard/whiteboardClient";

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
    act(() => harness.onChange!(harness.scene, {}, {}));
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
});
