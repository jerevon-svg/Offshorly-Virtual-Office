// Stored-document shape for Whiteboard W2 on Excalidraw. Pure module — no Excalidraw import — so
// the format contract is unit-testable without a canvas.
//
// The server treats `document` as opaque JSON (backend/app/models/whiteboard.py); this module is
// the ONLY place that knows what is inside. The shape follows Excalidraw's own `.excalidraw`
// file format (`type: "excalidraw", version: 2, elements, appState, files`) so a stored board is
// importable into excalidraw.com unchanged. Only non-deleted elements, the few appState keys that
// describe the drawing (not the session), and files still referenced by an image element are kept.
//
// Boards saved by the previous editor (tldraw snapshots, `{document: {store: …}}`) cannot be
// converted shape-for-shape; they are reported as `legacy` and open as an empty canvas. The
// board's `version` is untouched by this module, so the 409 optimistic-save protection still
// applies to the first save that replaces a legacy document.

export const EXCALIDRAW_DOCUMENT_TYPE = "excalidraw";
export const EXCALIDRAW_DOCUMENT_VERSION = 2;
export const EXCALIDRAW_DOCUMENT_SOURCE = "virtual-office-whiteboard";

// Minimal structural view of an Excalidraw element — only the fields this module reads.
export interface StoredElement {
  id: string;
  type: string;
  isDeleted?: boolean;
  fileId?: string | null;
  [key: string]: unknown;
}

export type StoredAppState = Record<string, unknown>;
export type StoredFiles = Record<string, unknown>;

export interface ExcalidrawDocument {
  type: typeof EXCALIDRAW_DOCUMENT_TYPE;
  version: typeof EXCALIDRAW_DOCUMENT_VERSION;
  source: string;
  elements: StoredElement[];
  appState: StoredAppState;
  files: StoredFiles;
}

export type ParsedDocument =
  | { kind: "empty" }
  | { kind: "legacy" }
  | { kind: "excalidraw"; document: ExcalidrawDocument };

// appState keys that describe the picture rather than the editing session (selection, tool,
// scroll, zoom, open menus). Mirrors the intent of Excalidraw's cleanAppStateForExport.
const PERSISTED_APP_STATE_KEYS = ["viewBackgroundColor", "gridSize", "gridStep", "gridModeEnabled"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Classify a board's stored `document` column. */
export function parseStoredDocument(document: unknown): ParsedDocument {
  if (document === null || document === undefined) return { kind: "empty" };
  if (!isRecord(document)) return { kind: "legacy" };
  if (document.type !== EXCALIDRAW_DOCUMENT_TYPE) return { kind: "legacy" };
  const elements = Array.isArray(document.elements) ? (document.elements as StoredElement[]) : [];
  return {
    kind: "excalidraw",
    document: {
      type: EXCALIDRAW_DOCUMENT_TYPE,
      version: EXCALIDRAW_DOCUMENT_VERSION,
      source: typeof document.source === "string" ? document.source : EXCALIDRAW_DOCUMENT_SOURCE,
      elements,
      appState: isRecord(document.appState) ? document.appState : {},
      files: isRecord(document.files) ? document.files : {},
    },
  };
}

/** Build the document to PUT from the live scene. Drops deleted elements, session-only
 * appState, and files no surviving image element points at. */
export function toStoredDocument(
  elements: readonly StoredElement[],
  appState: StoredAppState,
  files: StoredFiles,
): ExcalidrawDocument {
  const live = elements.filter((el) => !el.isDeleted);
  const persistedAppState: StoredAppState = {};
  for (const key of PERSISTED_APP_STATE_KEYS) {
    if (appState[key] !== undefined) persistedAppState[key] = appState[key];
  }
  const referencedFileIds = new Set(
    live.map((el) => el.fileId).filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const persistedFiles: StoredFiles = {};
  for (const id of referencedFileIds) {
    if (files[id] !== undefined) persistedFiles[id] = files[id];
  }
  return {
    type: EXCALIDRAW_DOCUMENT_TYPE,
    version: EXCALIDRAW_DOCUMENT_VERSION,
    source: EXCALIDRAW_DOCUMENT_SOURCE,
    elements: live,
    appState: persistedAppState,
    files: persistedFiles,
  };
}
