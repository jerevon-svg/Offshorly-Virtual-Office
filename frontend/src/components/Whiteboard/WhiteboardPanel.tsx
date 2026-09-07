import { Suspense, lazy, useCallback, useEffect, useState, type ComponentType } from "react";
import { ErrorBoundary } from "../ErrorBoundary";
import {
  createWhiteboardIn,
  getWhiteboard,
  listWhiteboardsIn,
  type Whiteboard,
  type WhiteboardScope,
  type WhiteboardSummary,
} from "../../services/whiteboard/whiteboardClient";
import styles from "./Whiteboard.module.css";

// Whiteboard W1 (+ W4): create / list / open the boards of ONE scope — a conversation (DM or group)
// or an office room / the office itself — then hand the opened board to the lazily-loaded
// Excalidraw editor (W2). Who may see a scope is decided by the server (conversation participants;
// every signed-in user for rooms) — the panel just renders whatever the API returns.

import type { WhiteboardEditorProps } from "./WhiteboardEditor";

// A fresh lazy component per attempt: React.lazy caches a rejected import (a chunk that 404/504'd
// — e.g. Vite's "Outdated Optimize Dep" after its dep cache was rebuilt under a running server),
// so "Try again" must re-create it rather than re-render the same rejected one.
function loadEditor(): ComponentType<WhiteboardEditorProps> {
  return lazy(() => import("./WhiteboardEditor"));
}

export type WhiteboardPanelProps = {
  scope: WhiteboardScope;
  // Display name of the scope (group / peer / room) for the header.
  title: string;
  onClose: () => void;
  /** Employee display name for an email — shown in the editor's presence strip and cursor chat. */
  resolveDisplayName?: (email: string) => string;
  /** W5-C — open the (existing) Toucan panel scoped to the open board. Absent = no button. */
  onAskToucan?: (board: { id: string; title: string }) => void;
};

export function WhiteboardPanel({ scope, title, onClose, resolveDisplayName, onAskToucan }: WhiteboardPanelProps) {
  const scopeKind = scope.kind;
  const scopeId = scope.id;
  const [boards, setBoards] = useState<WhiteboardSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [openBoard, setOpenBoard] = useState<Whiteboard | null>(null);
  const [WhiteboardEditor, setWhiteboardEditor] = useState(loadEditor);

  const refresh = useCallback(async () => {
    try {
      setBoards(await listWhiteboardsIn({ kind: scopeKind, id: scopeId }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load whiteboards");
    }
  }, [scopeKind, scopeId]);

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
      const created = await createWhiteboardIn({ kind: scopeKind, id: scopeId }, t);
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

  // Stable identity: the editor's room membership must not depend on this panel re-rendering
  // (OfficeMap re-renders constantly — movement, presence, clock).
  const handleSaved = useCallback((saved: Whiteboard) => {
    setBoards((prev) => prev?.map((b) => (b.id === saved.id ? { ...b, ...saved, document: undefined } as WhiteboardSummary : b)) ?? prev);
  }, []);

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
            <ErrorBoundary
              fallback={(retry) => (
                <div className={styles.editorError} role="alert">
                  <p>The whiteboard editor couldn't load.</p>
                  <div className={styles.editorErrorActions}>
                    <button
                      type="button"
                      className={`${styles.button} ${styles.buttonPrimary}`}
                      onClick={() => {
                        setWhiteboardEditor(() => loadEditor());
                        retry();
                      }}
                    >
                      Try again
                    </button>
                    <button type="button" className={styles.button} onClick={() => { setOpenBoard(null); void refresh(); }}>
                      ← Boards
                    </button>
                  </div>
                </div>
              )}
            >
              <Suspense fallback={<div className={styles.empty}>Loading editor…</div>}>
                <WhiteboardEditor
                  key={openBoard.id}
                  board={openBoard}
                  onSaved={handleSaved}
                  resolveDisplayName={resolveDisplayName}
                  onAskToucan={onAskToucan ? () => onAskToucan({ id: openBoard.id, title: openBoard.title }) : undefined}
                />
              </Suspense>
            </ErrorBoundary>
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
