import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  convertToExcalidrawElements,
  getSceneVersion,
  restoreElements,
} from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  PointerDownState,
  UIAppState,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import {
  getWhiteboard,
  saveWhiteboard,
  WhiteboardConflictError,
  type Whiteboard,
} from "../../services/whiteboard/whiteboardClient";
import {
  parseStoredDocument,
  toStoredDocument,
  type StoredElement,
} from "../../services/whiteboard/whiteboardDocument";
import { STICKY_NOTE_TOOL, isStickyNoteTool, stickyNoteSkeleton } from "./stickyNote";
import styles from "./Whiteboard.module.css";

// Whiteboard W2: the Excalidraw editor over ONE persisted board. Excalidraw supplies free draw,
// text, shapes, arrows, zoom/pan and undo/redo; this component only owns persistence:
//  - load the stored document on mount (whiteboardDocument.ts decides what "stored" means),
//  - debounce-autosave scene changes (plus an explicit "Save now"),
//  - track the version the server handed back and surface a 409 as a reload prompt,
//  - add the one tool Excalidraw lacks, a Sticky Note (see stickyNote.ts).
// A board still holding the previous editor's (tldraw) document is NEVER silently replaced:
// Excalidraw is not mounted — so nothing can autosave — until the user clicks "Start fresh".
// Default-exported so WhiteboardPanel can React.lazy() it — Excalidraw is a large dependency
// that must stay out of the main office bundle (and in vite optimizeDeps.include, see
// vite.config.ts). Realtime merge is W3; W1/W2 is last-write-wins with detection.

const AUTOSAVE_DEBOUNCE_MS = 1500;

type SceneElements = NonNullable<ExcalidrawInitialDataState["elements"]>;

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

export type WhiteboardEditorProps = {
  board: Whiteboard;
  onSaved?: (board: Whiteboard) => void;
};

function sceneVersionOf(elements: readonly StoredElement[]): number {
  return getSceneVersion(elements as unknown as SceneElements);
}

export default function WhiteboardEditor({ board, onSaved }: WhiteboardEditorProps) {
  const parsed = useMemo(() => parseStoredDocument(board.document), [board.document]);
  const initialElements = parsed.kind === "excalidraw" ? parsed.document.elements : [];

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const versionRef = useRef(board.version);
  // Excalidraw's onChange also fires for selection/tool/scroll changes. The scene version is a
  // hash of element versions, so comparing against the last one we saw filters those out.
  const lastSceneVersionRef = useRef(sceneVersionOf(initialElements));
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [startedFresh, setStartedFresh] = useState(false);
  // Legacy board the user has not chosen to replace: no editor, no save path.
  const legacyLocked = parsed.kind === "legacy" && !startedFresh;

  const initialData = useMemo<ExcalidrawInitialDataState | null>(() => {
    if (parsed.kind !== "excalidraw") return null;
    const { elements, appState, files } = parsed.document;
    return {
      elements: elements as unknown as SceneElements,
      appState: appState as ExcalidrawInitialDataState["appState"],
      files: files as unknown as BinaryFiles,
      scrollToContent: true,
    };
  }, [parsed]);

  const currentDocument = useCallback(() => {
    const api = apiRef.current;
    if (!api) return null;
    return toStoredDocument(
      api.getSceneElementsIncludingDeleted() as unknown as StoredElement[],
      api.getAppState() as unknown as Record<string, unknown>,
      api.getFiles() as unknown as Record<string, unknown>,
    );
  }, []);

  const save = useCallback(async () => {
    const document = currentDocument();
    if (!document) return;
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    setStatus("saving");
    try {
      const saved = await saveWhiteboard(board.id, document as unknown as Record<string, unknown>, versionRef.current);
      versionRef.current = saved.version;
      setStatus("saved");
      setErrorText(null);
      onSaved?.(saved);
    } catch (err) {
      if (err instanceof WhiteboardConflictError) {
        pendingRef.current = false;
        setStatus("conflict");
      } else {
        setStatus("error");
        setErrorText(err instanceof Error ? err.message : "Save failed");
      }
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void save();
      }
    }
  }, [board.id, currentDocument, onSaved]);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void save(), AUTOSAVE_DEBOUNCE_MS);
  }, [save]);

  const handleChange = useCallback(
    (elements: readonly SceneElements[number][], _appState: AppState, _files: BinaryFiles) => {
      const sceneVersion = getSceneVersion(elements);
      if (sceneVersion === lastSceneVersionRef.current) return;
      lastSceneVersionRef.current = sceneVersion;
      setStatus((s) => (s === "conflict" ? s : "dirty"));
      scheduleSave();
    },
    [scheduleSave],
  );

  // Sticky Note tool: while our custom tool is active, a pointer-down drops one note (rectangle +
  // bound text, both Excalidraw-native) centred on the pointer, selects it, and returns to the
  // selection tool so the next click moves/resizes/edits rather than dropping another.
  const handlePointerDown = useCallback((activeTool: AppState["activeTool"], pointerDownState: PointerDownState) => {
    const api = apiRef.current;
    if (!api || !isStickyNoteTool(activeTool)) return;
    const created = convertToExcalidrawElements([stickyNoteSkeleton(pointerDownState.origin)]);
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...created],
      appState: { selectedElementIds: Object.fromEntries(created.map((el) => [el.id, true as const])) },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.setActiveTool({ type: "selection" });
  }, []);

  const activateStickyNoteTool = useCallback(() => {
    apiRef.current?.setActiveTool({ type: "custom", customType: STICKY_NOTE_TOOL });
  }, []);

  // Rendered by Excalidraw beside its own top-right buttons, using its ToolIcon classes so the
  // button matches the toolbar's look (size, radius, hover and selected colours) in both themes.
  const renderTopRightUI = useCallback(
    (_isMobile: boolean, appState: UIAppState) => {
      const active = isStickyNoteTool(appState.activeTool);
      return (
        <button
          type="button"
          className={`ToolIcon ToolIcon_type_button ToolIcon_size_medium${active ? " ToolIcon--selected" : ""}`}
          title="Sticky note"
          aria-label="Sticky note"
          aria-pressed={active}
          onClick={activateStickyNoteTool}
        >
          <div className="ToolIcon__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 4h14a1 1 0 0 1 1 1v9l-6 6H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
              <path d="M14 20v-5a1 1 0 0 1 1-1h5" />
              <path d="M8 9h8M8 13h4" />
            </svg>
          </div>
        </button>
      );
    },
    [activateStickyNoteTool],
  );

  // Flush a pending debounced save on unmount (e.g. the user hits Back right after drawing).
  // Deliberately does NOT clear apiRef: Excalidraw hands the imperative API over exactly once,
  // from its constructor, and React StrictMode (dev) runs this cleanup once right after mount —
  // nulling the ref there left every later save with no editor to read from (bug 2026-09-05).
  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        const document = currentDocument();
        if (document && !savingRef.current) {
          void saveWhiteboard(board.id, document as unknown as Record<string, unknown>, versionRef.current).catch(
            () => {},
          );
        }
      }
    };
  }, [board.id, currentDocument]);

  async function reloadFromServer() {
    const api = apiRef.current;
    if (!api) return;
    try {
      const fresh = await getWhiteboard(board.id);
      window.clearTimeout(timerRef.current);
      const freshParsed = parseStoredDocument(fresh.document);
      const freshElements = freshParsed.kind === "excalidraw" ? freshParsed.document.elements : [];
      const restored = restoreElements(freshElements as unknown as SceneElements, null);
      lastSceneVersionRef.current = getSceneVersion(restored);
      if (freshParsed.kind === "excalidraw") {
        api.addFiles(Object.values(freshParsed.document.files) as BinaryFileData[]);
      }
      api.updateScene({ elements: restored, captureUpdate: CaptureUpdateAction.NEVER });
      versionRef.current = fresh.version;
      setStatus("idle");
      setErrorText(null);
      onSaved?.(fresh);
    } catch (err) {
      setStatus("error");
      setErrorText(err instanceof Error ? err.message : "Reload failed");
    }
  }

  const statusLabel: Record<SaveStatus, string> = {
    idle: "",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved",
    conflict: "Someone else saved a newer version. Reload to keep drawing.",
    error: errorText ?? "Save failed",
  };

  return (
    <>
      <div className={styles.header}>
        <span className={styles.status + (status === "conflict" || status === "error" ? ` ${styles.statusConflict}` : "")}>
          {statusLabel[status]}
        </span>
        {status === "conflict" ? (
          <button type="button" className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => void reloadFromServer()}>
            Reload latest
          </button>
        ) : (
          <button
            type="button"
            className={styles.button}
            onClick={() => void save()}
            disabled={status === "saving" || legacyLocked}
          >
            Save now
          </button>
        )}
      </div>
      {parsed.kind === "legacy" && (
        <div className={styles.legacyNotice} role="note">
          {legacyLocked ? (
            <>
              <span>
                This board was drawn with the previous editor and cannot be shown here. Its drawing is kept
                until you start fresh.
              </span>
              <button type="button" className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => setStartedFresh(true)}>
                Start fresh
              </button>
            </>
          ) : (
            <span>Started fresh — the first save replaces the previous editor's drawing.</span>
          )}
        </div>
      )}
      {legacyLocked ? (
        <div className={styles.legacyPlaceholder}>Choose “Start fresh” above to draw on this board.</div>
      ) : (
        <div className={styles.canvas}>
          <Excalidraw
            initialData={initialData}
            onChange={handleChange}
            onPointerDown={handlePointerDown}
            renderTopRightUI={renderTopRightUI}
            excalidrawAPI={(api) => {
              apiRef.current = api;
            }}
          />
        </div>
      )}
    </>
  );
}
