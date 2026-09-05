import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaptureUpdateAction, Excalidraw, getSceneVersion, restoreElements } from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
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
import styles from "./Whiteboard.module.css";

// Whiteboard W2: the Excalidraw editor over ONE persisted board. Excalidraw supplies free draw,
// text, shapes, arrows, zoom/pan and undo/redo; this component only owns persistence:
//  - load the stored document on mount (whiteboardDocument.ts decides what "stored" means),
//  - debounce-autosave scene changes (plus an explicit "Save now"),
//  - track the version the server handed back and surface a 409 as a reload prompt.
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

  // Flush a pending debounced save on unmount (e.g. the user hits Back right after drawing).
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
      apiRef.current = null;
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
          <button type="button" className={styles.button} onClick={() => void save()} disabled={status === "saving"}>
            Save now
          </button>
        )}
      </div>
      {parsed.kind === "legacy" && (
        <div className={styles.legacyNotice} role="note">
          This board was drawn with the previous editor and opens empty here. Saving will replace the old drawing.
        </div>
      )}
      <div className={styles.canvas}>
        <Excalidraw
          initialData={initialData}
          onChange={handleChange}
          excalidrawAPI={(api) => {
            apiRef.current = api;
          }}
        />
      </div>
    </>
  );
}
