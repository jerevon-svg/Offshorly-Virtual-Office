import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import type { Whiteboard } from "../../services/whiteboard/whiteboardClient";

// Editor persistence layer over a stubbed Excalidraw: jsdom has no canvas, so the real component
// is replaced by a harness that exposes the props the editor wires (initialData, onChange,
// excalidrawAPI). Asserts the migration contract: stored Excalidraw docs load, legacy tldraw
// docs open empty with a notice, scene changes autosave in the Excalidraw file format against
// the loaded version, appState-only changes do not save, and a 409 reloads the server's scene.

type Harness = {
  initialData: unknown;
  onChange?: (elements: unknown[], appState: unknown, files: unknown) => void;
  scene: Array<Record<string, unknown>>;
  updateScene: ReturnType<typeof vi.fn>;
  addFiles: ReturnType<typeof vi.fn>;
};
// vi.mock factories are hoisted above imports, so everything they reference must be hoisted too.
const { harness, saveWhiteboard, getWhiteboard, WhiteboardConflictError } = vi.hoisted(() => {
  class WhiteboardConflictError extends Error {}
  return {
    harness: { initialData: undefined, scene: [], updateScene: vi.fn(), addFiles: vi.fn() } as Harness,
    saveWhiteboard: vi.fn<(id: string, doc: Record<string, unknown>, version: number) => Promise<Whiteboard>>(),
    getWhiteboard: vi.fn<(id: string) => Promise<Whiteboard>>(),
    WhiteboardConflictError,
  };
});

vi.mock("@excalidraw/excalidraw/index.css", () => ({}));
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "NEVER" },
  getSceneVersion: (elements: Array<{ version?: number }>) => elements.reduce((sum, el) => sum + (el.version ?? 0), 0),
  restoreElements: (elements: unknown[] | null) => elements ?? [],
  Excalidraw: (props: {
    initialData: unknown;
    onChange: Harness["onChange"];
    excalidrawAPI: (api: unknown) => void;
  }) => {
    harness.initialData = props.initialData;
    harness.onChange = props.onChange;
    const { excalidrawAPI } = props;
    useEffect(() => {
      excalidrawAPI({
        getSceneElementsIncludingDeleted: () => harness.scene,
        getAppState: () => ({ viewBackgroundColor: "#ffffff", selectedElementIds: { x: true }, zoom: { value: 1 } }),
        getFiles: () => ({}),
        updateScene: harness.updateScene,
        addFiles: harness.addFiles,
      });
    }, [excalidrawAPI]);
    return <div data-testid="excalidraw" />;
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
  harness.scene = [];
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

  it("opens a legacy tldraw document as an empty canvas with a notice", () => {
    render(<WhiteboardEditor board={{ ...base, document: tldrawDoc }} />);
    expect(harness.initialData).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(/previous editor/);
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
