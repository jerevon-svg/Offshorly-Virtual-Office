import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import {
  createWhiteboard,
  getWhiteboard,
  listWhiteboards,
  type Whiteboard,
  type WhiteboardSummary,
} from "../../services/whiteboard/whiteboardClient";
import styles from "./Whiteboard.module.css";

// Whiteboard W1: create / list / open the boards of ONE group conversation, then hand the opened
// board to the lazily-loaded Excalidraw editor (W2). Who may see this panel is decided by the
// server (group participants only) — the panel just renders whatever the API returns.

const WhiteboardEditor = lazy(() => import("./WhiteboardEditor"));

export type WhiteboardPanelProps = {
  conversationId: string;
  // Group display name for the header.
  title: string;
  onClose: () => void;
};

export function WhiteboardPanel({ conversationId, title, onClose }: WhiteboardPanelProps) {
  const [boards, setBoards] = useState<WhiteboardSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [openBoard, setOpenBoard] = useState<Whiteboard | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBoards(await listWhiteboards(conversationId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load whiteboards");
    }
  }, [conversationId]);

  useEffect(() => {
    setBoards(null);
    setOpenBoard(null);
    void refresh();
  }, [refresh]);

  async function handleCreate() {
    const t = newTitle.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const created = await createWhiteboard(conversationId, t);
      setNewTitle("");
      setOpenBoard(created);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create whiteboard");
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      setOpenBoard(await getWhiteboard(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open whiteboard");
    } finally {
      setBusy(false);
    }
  }

  function handleSaved(saved: Whiteboard) {
    setBoards((prev) => prev?.map((b) => (b.id === saved.id ? { ...b, ...saved, document: undefined } as WhiteboardSummary : b)) ?? prev);
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Whiteboards">
      <div className={styles.dialog}>
        <div className={styles.header}>
          {openBoard && (
            <button type="button" className={styles.button} onClick={() => { setOpenBoard(null); void refresh(); }}>
              ← Boards
            </button>
          )}
          <span className={styles.headerTitle}>
            {openBoard ? openBoard.title : "Whiteboards"}
            <span className={styles.headerSub}>· {title}</span>
          </span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close whiteboards">
            ×
          </button>
        </div>
        <div className={styles.body}>
          {openBoard ? (
            <Suspense fallback={<div className={styles.empty}>Loading editor…</div>}>
              <WhiteboardEditor key={openBoard.id} board={openBoard} onSaved={handleSaved} />
            </Suspense>
          ) : (
            <div className={styles.list}>
              <form
                className={styles.createRow}
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleCreate();
                }}
              >
                <input
                  className={styles.input}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="New whiteboard title"
                  aria-label="New whiteboard title"
                  maxLength={255}
                />
                <button type="submit" className={`${styles.button} ${styles.buttonPrimary}`} disabled={busy || !newTitle.trim()}>
                  Create
                </button>
              </form>
              {error && <div className={styles.error}>{error}</div>}
              {boards === null && !error && <div className={styles.empty}>Loading…</div>}
              {boards !== null && boards.length === 0 && <div className={styles.empty}>No whiteboards yet — create the first one.</div>}
              {boards?.map((b) => (
                <button key={b.id} type="button" className={styles.boardRow} onClick={() => void handleOpen(b.id)}>
                  <span>{b.title}</span>
                  <span className={styles.boardMeta}>
                    v{b.version} · {b.updatedByEmail} · {new Date(b.updatedAt).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
