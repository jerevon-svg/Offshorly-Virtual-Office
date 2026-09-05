import { useCallback, useEffect, useRef, useState } from "react";
import { Tldraw, getSnapshot, loadSnapshot, type Editor, type TLEditorSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import {
  getWhiteboard,
  saveWhiteboard,
  WhiteboardConflictError,
  type Whiteboard,
} from "../../services/whiteboard/whiteboardClient";
import styles from "./Whiteboard.module.css";

// Whiteboard W2: the tldraw editor over ONE persisted board. tldraw supplies draw/text/sticky
// notes/geo shapes/arrows/zoom/pan/undo/redo; this component only owns persistence:
//  - load the stored snapshot on mount,
//  - debounce-autosave user changes (plus an explicit "Save now"),
//  - track the version the server handed back and surface a 409 as a reload prompt.
// Default-exported so WhiteboardPanel can React.lazy() it — tldraw is ~15MB unpacked and must
// stay out of the main office bundle. Realtime merge is W3; W1/W2 is last-write-wins with detection.

const AUTOSAVE_DEBOUNCE_MS = 1500;
// loadSnapshot() replays through the store as ordinary (non-remote) changes, and tldraw flushes
// history on the next frame — so a listener attached in onMount would see the initial load as an
// edit and fire one pointless save. Ignore listener events inside this settle window instead.
const SETTLE_MS = 300;

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

export type WhiteboardEditorProps = {
  board: Whiteboard;
  onSaved?: (board: Whiteboard) => void;
};

export default function WhiteboardEditor({ board, onSaved }: WhiteboardEditorProps) {
  const editorRef = useRef<Editor | null>(null);
  const versionRef = useRef(board.version);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const armedAtRef = useRef(0);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);

  const save = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    setStatus("saving");
    try {
      const snapshot = getSnapshot(editor.store) as unknown as Record<string, unknown>;
      const saved = await saveWhiteboard(board.id, snapshot, versionRef.current);
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
  }, [board.id, onSaved]);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void save(), AUTOSAVE_DEBOUNCE_MS);
  }, [save]);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      if (board.document) {
        loadSnapshot(editor.store, board.document as unknown as TLEditorSnapshot);
      }
      armedAtRef.current = Date.now() + SETTLE_MS;
      const unlisten = editor.store.listen(
        () => {
          if (Date.now() < armedAtRef.current) return;
          setStatus((s) => (s === "conflict" ? s : "dirty"));
          scheduleSave();
        },
        { scope: "document", source: "user" },
      );
      return () => {
        unlisten();
        editorRef.current = null;
      };
    },
    [board.document, scheduleSave],
  );

  // Flush a pending debounced save on unmount (e.g. the user hits Back right after drawing).
  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        const editor = editorRef.current;
        if (editor && !savingRef.current) {
          const snapshot = getSnapshot(editor.store) as unknown as Record<string, unknown>;
          void saveWhiteboard(board.id, snapshot, versionRef.current).catch(() => {});
        }
      }
    };
  }, [board.id]);

  async function reloadFromServer() {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      const fresh = await getWhiteboard(board.id);
      window.clearTimeout(timerRef.current);
      armedAtRef.current = Date.now() + SETTLE_MS;
      if (fresh.document) loadSnapshot(editor.store, fresh.document as unknown as TLEditorSnapshot);
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
      <div className={styles.canvas}>
        <Tldraw onMount={handleMount} />
      </div>
    </>
  );
}
