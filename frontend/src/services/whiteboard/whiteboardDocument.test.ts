import { describe, expect, it } from "vitest";
import {
  EXCALIDRAW_DOCUMENT_SOURCE,
  parseStoredDocument,
  toStoredDocument,
  type StoredElement,
} from "./whiteboardDocument";

// Format contract for the opaque `document` column after the tldraw → Excalidraw migration.

const rect: StoredElement = { id: "r1", type: "rectangle", version: 3, x: 0, y: 0 };
const deleted: StoredElement = { id: "d1", type: "ellipse", version: 2, isDeleted: true };
const image: StoredElement = { id: "i1", type: "image", version: 1, fileId: "f1" };

describe("parseStoredDocument", () => {
  it("treats null/undefined as an empty board", () => {
    expect(parseStoredDocument(null)).toEqual({ kind: "empty" });
    expect(parseStoredDocument(undefined)).toEqual({ kind: "empty" });
  });

  it("reports a tldraw snapshot (or any non-Excalidraw JSON) as legacy", () => {
    expect(parseStoredDocument({ document: { store: { "shape:1": {} }, schema: {} }, session: {} })).toEqual({
      kind: "legacy",
    });
    expect(parseStoredDocument({ type: "something-else", elements: [] })).toEqual({ kind: "legacy" });
    expect(parseStoredDocument("not an object")).toEqual({ kind: "legacy" });
  });

  it("returns a normalized Excalidraw document, filling missing optional parts", () => {
    const parsed = parseStoredDocument({ type: "excalidraw", version: 2, elements: [rect] });
    expect(parsed.kind).toBe("excalidraw");
    if (parsed.kind !== "excalidraw") return;
    expect(parsed.document.elements).toEqual([rect]);
    expect(parsed.document.appState).toEqual({});
    expect(parsed.document.files).toEqual({});
    expect(parsed.document.source).toBe(EXCALIDRAW_DOCUMENT_SOURCE);
  });
});

describe("toStoredDocument", () => {
  it("emits the Excalidraw file format with only live elements", () => {
    const doc = toStoredDocument([rect, deleted], { viewBackgroundColor: "#fff" }, {});
    expect(doc.type).toBe("excalidraw");
    expect(doc.version).toBe(2);
    expect(doc.elements).toEqual([rect]);
  });

  it("keeps only drawing-level appState, never session state", () => {
    const doc = toStoredDocument([rect], {
      viewBackgroundColor: "#fafafa",
      gridSize: 20,
      gridModeEnabled: true,
      selectedElementIds: { r1: true },
      zoom: { value: 2 },
      scrollX: 100,
      activeTool: { type: "freedraw" },
    }, {});
    expect(doc.appState).toEqual({ viewBackgroundColor: "#fafafa", gridSize: 20, gridModeEnabled: true });
  });

  it("keeps only files still referenced by a live image element", () => {
    const files = { f1: { id: "f1", dataURL: "data:1" }, orphan: { id: "orphan", dataURL: "data:2" } };
    const doc = toStoredDocument([image, { ...image, id: "i2", fileId: "gone", isDeleted: true }], {}, files);
    expect(Object.keys(doc.files)).toEqual(["f1"]);
  });

  it("round-trips through parseStoredDocument", () => {
    const stored = toStoredDocument([rect], { viewBackgroundColor: "#fff" }, {});
    const parsed = parseStoredDocument(JSON.parse(JSON.stringify(stored)));
    expect(parsed).toEqual({ kind: "excalidraw", document: stored });
  });
});
