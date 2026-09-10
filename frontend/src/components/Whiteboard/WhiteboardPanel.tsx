import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { ErrorBoundary } from "../ErrorBoundary";
import HudIcon from "../HudIcon";
import {
  createWhiteboardIn,
  getWhiteboard,
  listWhiteboardsIn,
  type Whiteboard,
  type WhiteboardScope,
  type WhiteboardSummary,
} from "../../services/whiteboard/whiteboardClient";
import { boardPreview, relativeAge } from "./boardCard";
import styles from "./Whiteboard.module.css";

// Whiteboard W1 (+ W4): create / list / open the boards of ONE scope — a conversation (DM or group)
// or an office room / the office itself — then hand the opened board to the lazily-loaded
// Excalidraw editor (W2). Who may see a scope is decided by the server (conversation participants;
// every signed-in user for rooms) — the panel just renders whatever the API returns.
//
// The gallery is the approved cream card layout (search, sort, 3-up preview cards). Everything on
// a card comes from the list response: title, creator, updatedAt. There is no thumbnail, no pin
// and no per-board presence server-side, so none of those are drawn — see boardCard.ts for the
// deterministic placeholder preview a card shows instead.

import type { WhiteboardEditorProps } from "./WhiteboardEditor";

// A fresh lazy component per attempt: React.lazy caches a rejected import (a chunk that 404/504'd
// — e.g. Vite's "Outdated Optimize Dep" after its dep cache was rebuilt under a running server),
// so "Try again" must re-create it rather than re-render the same rejected one.
function loadEditor(): ComponentType<WhiteboardEditorProps> {
  return lazy(() => import("./WhiteboardEditor"));
}

type SortKey = "updated" | "created" | "title";

const SORT_LABELS: Record<SortKey, string> = {
  updated: "Recently updated",
  created: "Recently created",
  title: "Name (A–Z)",
};

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
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [openBoard, setOpenBoard] = useState<Whiteboard | null>(null);
  const [WhiteboardEditor, setWhiteboardEditor] = useState(loadEditor);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

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

  // Fullscreen is the browser's own, on the dialog element — Escape or the OS chrome can leave it
  // without going through our button, so the label follows the document rather than our state.
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === dialogRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen?.();
    } else {
      void el.requestFullscreen?.().catch(() => {});
    }
  }, []);

  async function handleCreate() {
    const t = newTitle.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const created = await createWhiteboardIn({ kind: scopeKind, id: scopeId }, t);
      setNewTitle("");
      setCreating(false);
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

  const backToGallery = useCallback(() => {
    setOpenBoard(null);
    void refresh();
  }, [refresh]);

  // Stable identity: the editor's room membership must not depend on this panel re-rendering
  // (OfficeMap re-renders constantly — movement, presence, clock).
  const handleSaved = useCallback((saved: Whiteboard) => {
    setBoards((prev) => prev?.map((b) => (b.id === saved.id ? { ...b, ...saved, document: undefined } as WhiteboardSummary : b)) ?? prev);
  }, []);

  const ownerOf = useCallback(
    (email: string) => {
      const resolved = resolveDisplayName?.(email)?.trim();
      if (resolved && !resolved.includes("@")) return resolved;
      const local = email.split("@")[0];
      return local ? local[0].toUpperCase() + local.slice(1) : email;
    },
    [resolveDisplayName],
  );

  // Search + sort are pure client-side views of the list response — no extra requests.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle === "" ? boards ?? [] : (boards ?? []).filter((b) => b.title.toLowerCase().includes(needle));
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      const key = sort === "created" ? "createdAt" : "updatedAt";
      return Date.parse(b[key]) - Date.parse(a[key]);
    });
    return sorted;
  }, [boards, query, sort]);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Whiteboards">
      <div className={styles.dialog} ref={dialogRef}>
        {openBoard ? (
          <div className={styles.body}>
            <ErrorBoundary
              fallback={(retry) => (
                <>
                  <div className={styles.docBar}>
                    <button type="button" className={styles.back} onClick={backToGallery}>
                      ← Boards
                    </button>
                    <span className={styles.docTitle}>{openBoard.title}</span>
                    <span className={styles.docSpacer} />
                    <button type="button" className={styles.close} onClick={onClose} aria-label="Close whiteboards">
                      ✕
                    </button>
                  </div>
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
                    </div>
                  </div>
                </>
              )}
            >
              <Suspense fallback={<div className={styles.empty}>Loading editor…</div>}>
                <WhiteboardEditor
                  key={openBoard.id}
                  board={openBoard}
                  onSaved={handleSaved}
                  resolveDisplayName={resolveDisplayName}
                  onAskToucan={onAskToucan ? () => onAskToucan({ id: openBoard.id, title: openBoard.title }) : undefined}
                  onBack={backToGallery}
                  onClose={onClose}
                  onToggleFullscreen={toggleFullscreen}
                  fullscreen={fullscreen}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        ) : (
          <>
            <div className={styles.header}>
              <span className={styles.headerIcon}>
                <HudIcon name="boards" size="34px" />
              </span>
              <div className={styles.headerText}>
                <h2 className={styles.title}>Boards</h2>
                <p className={styles.subtitle}>
                  <span>A shared space for your next idea.</span>
                  <span className={styles.headerSub}>· {title}</span>
                </p>
              </div>
              <button
                type="button"
                className={styles.newBoard}
                onClick={() => setCreating((open) => !open)}
                aria-expanded={creating}
              >
                <span className={styles.plus} aria-hidden="true">
                  +
                </span>
                New board
              </button>
              <button type="button" className={styles.close} onClick={onClose} aria-label="Close whiteboards">
                ✕
              </button>
            </div>

            <div className={styles.toolbar}>
              <span className={styles.searchWrap}>
                <span className={styles.searchIcon} aria-hidden="true">
                  <HudIcon name="search" size="18px" />
                </span>
                <input
                  type="search"
                  className={styles.searchInput}
                  placeholder="Search boards..."
                  aria-label="Search boards"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </span>
              <select
                className={styles.sortSelect}
                aria-label="Sort boards"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>

            {creating && (
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
                  autoFocus
                />
                <button type="submit" className={`${styles.button} ${styles.buttonPrimary}`} disabled={busy || !newTitle.trim()}>
                  Create
                </button>
              </form>
            )}

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.list}>
              {boards === null && !error && <div className={styles.empty}>Loading…</div>}
              {boards !== null && boards.length === 0 && (
                <div className={styles.empty}>No whiteboards yet — create the first one.</div>
              )}
              {boards !== null && boards.length > 0 && visible.length === 0 && (
                <div className={styles.empty}>No boards match “{query.trim()}”.</div>
              )}
              {visible.length > 0 && (
                <ul className={styles.grid}>
                  {visible.map((b) => {
                    const preview = boardPreview(b.id, b.title);
                    const age = relativeAge(b.updatedAt);
                    return (
                      <li key={b.id}>
                        <button type="button" className={styles.card} onClick={() => void handleOpen(b.id)}>
                          <span className={styles.thumb} style={{ background: preview.tint }} aria-hidden="true">
                            <span className={styles.thumbSheet} />
                            <span className={styles.thumbMark}>{preview.mark}</span>
                          </span>
                          <span className={styles.cardTitle}>{b.title}</span>
                          <span className={styles.boardMeta}>
                            {ownerOf(b.createdByEmail)}
                            {age ? ` · Updated ${age}` : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {boards !== null && boards.length > 0 && (
              <div className={styles.footer}>
                {visible.length === boards.length
                  ? `${boards.length} ${boards.length === 1 ? "board" : "boards"}`
                  : `${visible.length} of ${boards.length} boards`}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
