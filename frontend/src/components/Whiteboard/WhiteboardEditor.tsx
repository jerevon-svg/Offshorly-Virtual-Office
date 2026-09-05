import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  convertToExcalidrawElements,
  getSceneVersion,
  reconcileElements,
  restoreElements,
} from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  Collaborator,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  ExcalidrawProps,
  PointerDownState,
  SocketId,
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
import {
  acknowledge,
  changedElements,
  reconcileUnacked,
  versionsOf,
  type PendingEntry,
  type SyncElement,
} from "../../services/whiteboard/whiteboardSync";
import {
  joinWhiteboard,
  type CollaboratorInfo,
  type RemotePointer,
  type SyncHandle,
  type SyncStatus,
  type WhiteboardSnapshot,
} from "../../services/whiteboard/whiteboardSyncClient";
import { STICKY_NOTE_TOOL, isStickyNoteTool, stickyNoteSkeleton } from "./stickyNote";
import styles from "./Whiteboard.module.css";

// Whiteboard W2 + W3: the Excalidraw editor over ONE persisted board. Excalidraw supplies free
// draw, text, shapes, arrows, zoom/pan and undo/redo; this component owns:
//  - loading the stored document on mount (whiteboardDocument.ts decides what "stored" means),
//  - REALTIME (W3): joining the board's Socket.IO room, sending changed elements, applying
//    remote batches with Excalidraw's own reconcile rule, collaborator cursors and count. While
//    realtime owns the board the server persists it and the REST save path is disabled.
//  - FALLBACK (W1/W2): when realtime is unavailable, debounce-autosave over REST (plus "Save
//    now") with the version/409 reload prompt, exactly as before W3.
//  - the one tool Excalidraw lacks, a Sticky Note (see stickyNote.ts).
// A board still holding the previous editor's (tldraw) document is NEVER silently replaced:
// nothing mounts — no editor, no room, no save — until the user clicks "Start fresh".
// Default-exported so WhiteboardPanel can React.lazy() it — Excalidraw is a large dependency
// that must stay out of the main office bundle (and in vite optimizeDeps.include).

const AUTOSAVE_DEBOUNCE_MS = 1500;
const POINTER_THROTTLE_MS = 50;

type SceneElements = NonNullable<ExcalidrawInitialDataState["elements"]>;
type PointerUpdate = Parameters<NonNullable<ExcalidrawProps["onPointerUpdate"]>>[0];

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

export type WhiteboardEditorProps = {
  board: Whiteboard;
  onSaved?: (board: Whiteboard) => void;
};

function sceneVersionOf(elements: readonly StoredElement[]): number {
  return getSceneVersion(elements as unknown as SceneElements);
}

function realtimeOwns(status: SyncStatus): boolean {
  return status !== "offline";
}

export default function WhiteboardEditor({ board, onSaved }: WhiteboardEditorProps) {
  const parsed = useMemo(() => parseStoredDocument(board.document), [board.document]);
  const initialElements = parsed.kind === "excalidraw" ? parsed.document.elements : [];

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const versionRef = useRef(board.version);
  // Excalidraw's onChange also fires for selection/tool/scroll changes. The scene version is a
  // hash of element versions, so comparing against the last one we saw filters those out.
  const lastSceneVersionRef = useRef(sceneVersionOf(initialElements));
  // The scene as Excalidraw last reported it via onChange (INCLUDING deleted elements). Saves and
  // remote reconciles read THIS, never the imperative API: Excalidraw's componentWillUnmount
  // replaces its scene with an empty one before React runs our effect cleanup.
  const latestSceneRef = useRef<{ elements: readonly StoredElement[]; appState: Record<string, unknown>; files: Record<string, unknown> }>({
    elements: initialElements,
    appState: parsed.kind === "excalidraw" ? parsed.document.appState : {},
    files: parsed.kind === "excalidraw" ? parsed.document.files : {},
  });
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  // Set while a debounced REST save is pending; cleared when it fires so the unmount flush only
  // runs for a save that has not happened yet.
  const timerRef = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [startedFresh, setStartedFresh] = useState(false);
  // Legacy board the user has not chosen to replace: no editor, no room, no save path.
  const legacyLocked = parsed.kind === "legacy" && !startedFresh;

  // --- W3 realtime state -------------------------------------------------------------------
  const syncRef = useRef<SyncHandle | null>(null);
  const realtimeStatusRef = useRef<SyncStatus>("connecting");
  const [realtime, setRealtime] = useState<{ status: SyncStatus; others: number }>({ status: "connecting", others: 0 });
  // Version last sent to / received from the server, per element id — the diff baseline.
  const knownVersionsRef = useRef(new Map<string, number>());
  // Local changes the server has not acknowledged yet; reconciled against the next snapshot.
  const pendingRef = useRef(new Map<string, PendingEntry>());
  const clientSeqRef = useRef(0);
  const collaboratorsRef = useRef(new Map<string, Collaborator>());
  const pointerTimerRef = useRef<number | undefined>(undefined);
  const lastPointerRef = useRef<PointerUpdate | null>(null);

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

  // --- REST fallback save path (W1/W2) -----------------------------------------------------
  const currentDocument = useCallback(() => {
    const { elements, appState, files } = latestSceneRef.current;
    return toStoredDocument(elements, appState, files);
  }, []);

  const save = useCallback(async () => {
    if (realtimeOwns(realtimeStatusRef.current)) return;
    const document = currentDocument();
    if (savingRef.current) {
      pendingSaveRef.current = true;
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
        pendingSaveRef.current = false;
        setStatus("conflict");
      } else {
        setStatus("error");
        setErrorText(err instanceof Error ? err.message : "Save failed");
      }
    } finally {
      savingRef.current = false;
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        void save();
      }
    }
  }, [board.id, currentDocument, onSaved]);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined;
      void save();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [save]);

  // --- W3 realtime: apply / send -----------------------------------------------------------
  const pushCollaborators = useCallback(() => {
    apiRef.current?.updateScene({ collaborators: new Map(collaboratorsRef.current) as Map<SocketId, Collaborator> });
  }, []);

  const applyPresence = useCallback(
    (list: CollaboratorInfo[]) => {
      const self = syncRef.current?.selfId();
      const next = new Map<string, Collaborator>();
      for (const c of list) {
        if (c.sid === self) continue;
        const prev = collaboratorsRef.current.get(c.sid);
        next.set(c.sid, { ...prev, id: c.sid, username: c.username, color: c.color });
      }
      collaboratorsRef.current = next;
      pushCollaborators();
      setRealtime((r) => ({ ...r, others: next.size }));
    },
    [pushCollaborators],
  );

  /** Replace the scene with the server's authoritative snapshot, keeping only unacknowledged
   * local changes that beat it (same rule the server applies), and resend those. */
  const applySnapshot = useCallback(
    (snapshot: WhiteboardSnapshot) => {
      const api = apiRef.current;
      if (!api) return;
      const pendingElements = [...pendingRef.current.values()].map((p) => p.element);
      const { scene, resend } = reconcileUnacked(pendingElements, snapshot.elements);
      knownVersionsRef.current = versionsOf(scene);
      pendingRef.current = new Map();
      if (resend.length > 0) {
        const seq = ++clientSeqRef.current;
        for (const el of resend) pendingRef.current.set(el.id, { element: el, seq });
        syncRef.current?.sendElements(resend, seq);
      }
      const restored = restoreElements(scene as unknown as SceneElements, null);
      lastSceneVersionRef.current = getSceneVersion(restored);
      latestSceneRef.current = {
        elements: restored as unknown as readonly StoredElement[],
        appState: latestSceneRef.current.appState,
        files: snapshot.files,
      };
      const files = Object.values(snapshot.files) as BinaryFileData[];
      if (files.length > 0) api.addFiles(files);
      api.updateScene({ elements: restored, captureUpdate: CaptureUpdateAction.NEVER });
      versionRef.current = snapshot.version;
      applyPresence(snapshot.collaborators);
    },
    [applyPresence],
  );

  const applyRemoteElements = useCallback((remote: SyncElement[]) => {
    const api = apiRef.current;
    if (!api || remote.length === 0) return;
    const restoredRemote = restoreElements(remote as unknown as SceneElements, null);
    const reconciled = reconcileElements(
      latestSceneRef.current.elements as unknown as Parameters<typeof reconcileElements>[0],
      restoredRemote as unknown as Parameters<typeof reconcileElements>[1],
      api.getAppState(),
    );
    const winners = new Map(reconciled.map((el) => [el.id, el.version]));
    for (const el of remote) knownVersionsRef.current.set(el.id, winners.get(el.id) ?? el.version);
    lastSceneVersionRef.current = getSceneVersion(reconciled);
    latestSceneRef.current = { ...latestSceneRef.current, elements: reconciled as unknown as readonly StoredElement[] };
    api.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
  }, []);

  const applyPointer = useCallback(
    (p: RemotePointer) => {
      if (p.sid === syncRef.current?.selfId()) return;
      const prev = collaboratorsRef.current.get(p.sid) ?? { id: p.sid, username: p.username, color: p.color };
      collaboratorsRef.current.set(p.sid, {
        ...prev,
        pointer: p.pointer ?? undefined,
        button: p.button,
        selectedElementIds: p.selectedElementIds as Collaborator["selectedElementIds"],
      });
      pushCollaborators();
    },
    [pushCollaborators],
  );

  const handleStatus = useCallback(
    (next: SyncStatus) => {
      realtimeStatusRef.current = next;
      setRealtime((r) => ({ ...r, status: next, others: next === "offline" ? 0 : r.others }));
      if (next === "offline") {
        // Realtime is unavailable for this board: anything drawn so far goes through REST.
        if (collaboratorsRef.current.size > 0) {
          collaboratorsRef.current = new Map();
          pushCollaborators();
        }
        if (pendingRef.current.size > 0) {
          pendingRef.current = new Map();
          setStatus((s) => (s === "conflict" ? s : "dirty"));
          scheduleSave();
        }
      }
    },
    [pushCollaborators, scheduleSave],
  );

  // Join the board's room for the editor's lifetime (never for a locked legacy board).
  useEffect(() => {
    if (legacyLocked) return;
    const handle = joinWhiteboard(board.id, {
      onStatus: handleStatus,
      onSnapshot: applySnapshot,
      onRemoteElements: applyRemoteElements,
      onAck: (clientSeq) => acknowledge(pendingRef.current, clientSeq),
      onPresence: applyPresence,
      onPointer: applyPointer,
    });
    syncRef.current = handle;
    if (!handle) handleStatus("offline");
    return () => {
      handle?.leave();
      syncRef.current = null;
    };
  }, [board.id, legacyLocked, handleStatus, applySnapshot, applyRemoteElements, applyPresence, applyPointer]);

  const handleChange = useCallback(
    (elements: readonly SceneElements[number][], appState: AppState, files: BinaryFiles) => {
      latestSceneRef.current = {
        elements: elements as unknown as readonly StoredElement[],
        appState: appState as unknown as Record<string, unknown>,
        files: files as unknown as Record<string, unknown>,
      };
      const sceneVersion = getSceneVersion(elements);
      if (sceneVersion === lastSceneVersionRef.current) return;
      lastSceneVersionRef.current = sceneVersion;

      if (realtimeOwns(realtimeStatusRef.current)) {
        // Send only what changed since the server last knew; hold it as pending until acked.
        // Before the first snapshot / while reconnecting nothing is sent — the next snapshot
        // reconciles the pending set and resends the survivors.
        const changed = changedElements(elements as unknown as readonly SyncElement[], knownVersionsRef.current);
        if (changed.length === 0) return;
        const seq = ++clientSeqRef.current;
        for (const el of changed) {
          knownVersionsRef.current.set(el.id, el.version);
          pendingRef.current.set(el.id, { element: el, seq });
        }
        if (realtimeStatusRef.current === "live") syncRef.current?.sendElements(changed, seq);
        return;
      }

      setStatus((s) => (s === "conflict" ? s : "dirty"));
      scheduleSave();
    },
    [scheduleSave],
  );

  const handlePointerUpdate = useCallback((payload: PointerUpdate) => {
    if (realtimeStatusRef.current !== "live") return;
    lastPointerRef.current = payload;
    if (pointerTimerRef.current !== undefined) return;
    pointerTimerRef.current = window.setTimeout(() => {
      pointerTimerRef.current = undefined;
      const p = lastPointerRef.current;
      if (!p) return;
      syncRef.current?.sendPointer({
        pointer: p.pointer,
        button: p.button,
        selectedElementIds: apiRef.current?.getAppState().selectedElementIds ?? {},
      });
    }, POINTER_THROTTLE_MS);
  }, []);

  // --- Sticky Note tool ---------------------------------------------------------------------
  // While our custom tool is active, a pointer-down drops one note (rectangle + bound text, both
  // Excalidraw-native) centred on the pointer, selects it, and returns to the selection tool.
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

  // Flush a still-pending debounced REST save on unmount (e.g. the user hits Back right after
  // drawing while offline). Reads latestSceneRef, not the API — see its comment. Deliberately
  // does NOT clear apiRef: Excalidraw hands the imperative API over exactly once, from its
  // constructor, and React StrictMode (dev) runs this cleanup once right after mount.
  useEffect(() => {
    return () => {
      window.clearTimeout(pointerTimerRef.current);
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
        if (!savingRef.current && !realtimeOwns(realtimeStatusRef.current)) {
          const document = currentDocument();
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
      timerRef.current = undefined;
      const freshParsed = parseStoredDocument(fresh.document);
      const freshElements = freshParsed.kind === "excalidraw" ? freshParsed.document.elements : [];
      const restored = restoreElements(freshElements as unknown as SceneElements, null);
      lastSceneVersionRef.current = getSceneVersion(restored);
      latestSceneRef.current = {
        elements: restored as unknown as readonly StoredElement[],
        appState: latestSceneRef.current.appState,
        files: freshParsed.kind === "excalidraw" ? freshParsed.document.files : {},
      };
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
    idle: "Offline · saving directly",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved",
    conflict: "Someone else saved a newer version. Reload to keep drawing.",
    error: errorText ?? "Save failed",
  };

  const realtimeLabel: Record<SyncStatus, string> = {
    connecting: "Connecting…",
    live: realtime.others === 0 ? "Live · only you" : `Live · ${realtime.others} ${realtime.others === 1 ? "collaborator" : "collaborators"}`,
    reconnecting: "Reconnecting… changes are kept and sent when back",
    offline: "",
  };
  // A locked legacy board never joins a room, so its header keeps the (disabled) REST controls.
  const live = !legacyLocked && realtimeOwns(realtime.status);

  return (
    <>
      <div className={styles.header}>
        {live ? (
          <span className={styles.status} data-testid="realtime-status">
            {realtimeLabel[realtime.status]}
          </span>
        ) : (
          <>
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
          </>
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
            onPointerUpdate={handlePointerUpdate}
            isCollaborating={realtime.status === "live"}
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
