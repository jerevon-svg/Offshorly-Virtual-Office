import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { CURSOR_CHAT_MAX_CHARS, type RemoteCursorChat } from "../../services/whiteboard/whiteboardSyncClient";
import styles from "./Whiteboard.module.css";

// W5-A ephemeral cursor chat (Figma-style). Overlays the Excalidraw canvas and owns ALL cursor-chat
// state so the editor never re-renders for it: remote bubbles keyed by collaborator sid, each
// positioned at that collaborator's last known pointer and dropped BUBBLE_TTL_MS after its last
// update; plus the viewer's own floating input, which follows their pointer and sends its current
// text at most every SEND_THROTTLE_MS. Nothing here is persisted or survives a rejoin — the editor
// clears the layer on reconnect and the server never stores a message (socket.py).
//
// Scene → canvas-pixel conversion is Excalidraw's own rule ((scene + scroll) * zoom); the layer
// re-reads scroll/zoom through the API's onScrollChange so bubbles stay pinned while panning.

export const BUBBLE_TTL_MS = 4000;
export const SEND_THROTTLE_MS = 200;
/** The input closes on its own this long after the last keystroke, matching the remote fade. */
const OWN_IDLE_CLOSE_MS = BUBBLE_TTL_MS;
// Below Excalidraw's own cursor name tag (drawn just under the pointer), never over it.
const CURSOR_OFFSET = { x: 14, y: 36 };

export type ScenePoint = { x: number; y: number };

type Bubble = {
  username: string;
  color: { background: string; stroke: string };
  text: string;
};

type View = { scrollX: number; scrollY: number; zoom: number };

export type CursorChatLayerHandle = {
  /** Remote message from a collaborator (never the viewer's own sid). */
  showRemote: (chat: RemoteCursorChat) => void;
  /** Latest pointer of a collaborator, in scene coordinates (null = pointer left the canvas). */
  setPointer: (sid: string, pointer: ScenePoint | null) => void;
  /** Drop bubbles of anyone not in `sids` (presence changed). */
  retain: (sids: Iterable<string>) => void;
  /** Drop every remote bubble (disconnect / reconnecting). */
  clearRemote: () => void;
  /** The viewer's own pointer, in scene coordinates. */
  setOwnPointer: (pointer: ScenePoint | null) => void;
  /** Open the viewer's own input at their pointer. */
  open: () => void;
  isOpen: () => boolean;
};

export type CursorChatLayerProps = {
  /** Read at mount — Excalidraw hands its API over before any effect runs. */
  getApi: () => ExcalidrawImperativeAPI | null;
  /** Whether the viewer may send right now (the editor gates on realtime being live). */
  canSend: () => boolean;
  onSend: (text: string) => void;
  /** Display name to show over a remote bubble; falls back to the wire username. */
  resolveName?: (email: string, fallback: string) => string;
};

function toCanvas(p: ScenePoint, view: View): { left: number; top: number } {
  return { left: (p.x + view.scrollX) * view.zoom, top: (p.y + view.scrollY) * view.zoom };
}

const CursorChatLayer = forwardRef<CursorChatLayerHandle, CursorChatLayerProps>(function CursorChatLayer(
  { getApi, canSend, onSend, resolveName },
  ref,
) {
  const [bubbles, setBubbles] = useState<Map<string, Bubble>>(new Map());
  const [pointers, setPointers] = useState<Map<string, ScenePoint>>(new Map());
  const [view, setView] = useState<View>({ scrollX: 0, scrollY: 0, zoom: 1 });
  const [own, setOwn] = useState<{ open: boolean; text: string; pointer: ScenePoint | null }>({
    open: false,
    text: "",
    pointer: null,
  });
  const ownRef = useRef(own);
  ownRef.current = own;
  // Own pointer is tracked in a ref while the input is closed (every mouse move reports it) and
  // only promoted to state — a re-render — while the input is open and needs to follow it.
  const ownPointerRef = useRef<ScenePoint | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sendTimerRef = useRef<number | undefined>(undefined);
  const pendingTextRef = useRef<string | null>(null);
  const sentSomethingRef = useRef(false);
  const idleTimerRef = useRef<number | undefined>(undefined);
  // One fade timer per remote bubble, restarted on every update from that collaborator.
  const fadeTimersRef = useRef(new Map<string, number>());

  // Follow Excalidraw's viewport so bubbles stay attached to the cursors while panning/zooming.
  useEffect(() => {
    const api = getApi();
    if (!api) return;
    const st = api.getAppState();
    setView({ scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom.value });
    if (typeof api.onScrollChange !== "function") return;
    return api.onScrollChange((scrollX, scrollY, zoom) => setView({ scrollX, scrollY, zoom: zoom.value }));
  }, [getApi]);

  const dropBubble = useCallback((sid: string) => {
    window.clearTimeout(fadeTimersRef.current.get(sid));
    fadeTimersRef.current.delete(sid);
    setBubbles((prev) => {
      if (!prev.has(sid)) return prev;
      const next = new Map(prev);
      next.delete(sid);
      return next;
    });
  }, []);

  const armFade = useCallback(
    (sid: string) => {
      window.clearTimeout(fadeTimersRef.current.get(sid));
      fadeTimersRef.current.set(sid, window.setTimeout(() => dropBubble(sid), BUBBLE_TTL_MS));
    },
    [dropBubble],
  );

  const dropAllBubbles = useCallback(() => {
    for (const t of fadeTimersRef.current.values()) window.clearTimeout(t);
    fadeTimersRef.current.clear();
    setBubbles((prev) => (prev.size === 0 ? prev : new Map()));
  }, []);

  const flushSend = useCallback(() => {
    window.clearTimeout(sendTimerRef.current);
    sendTimerRef.current = undefined;
    const text = pendingTextRef.current;
    pendingTextRef.current = null;
    if (text === null) return;
    if (text === "" && !sentSomethingRef.current) return;
    sentSomethingRef.current = text !== "";
    if (canSend()) onSend(text);
  }, [canSend, onSend]);

  const queueSend = useCallback(
    (text: string) => {
      pendingTextRef.current = text;
      if (sendTimerRef.current !== undefined) return;
      sendTimerRef.current = window.setTimeout(flushSend, SEND_THROTTLE_MS);
    },
    [flushSend],
  );

  const close = useCallback(() => {
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = undefined;
    if (!ownRef.current.open) return;
    // Everyone else's copy of our bubble goes away immediately — do not wait for their fade.
    pendingTextRef.current = "";
    flushSend();
    setOwn((o) => ({ ...o, open: false, text: "" }));
  }, [flushSend]);

  const armIdleClose = useCallback(() => {
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(close, OWN_IDLE_CLOSE_MS);
  }, [close]);

  useImperativeHandle(
    ref,
    () => ({
      showRemote: (chat) => {
        // Resolved per message so the bubble shows the employee name, not the email stub.
        if (chat.text === "") {
          dropBubble(chat.sid);
          return;
        }
        const username = resolveName ? resolveName(chat.email, chat.username) : chat.username;
        setBubbles((prev) => new Map(prev).set(chat.sid, { username, color: chat.color, text: chat.text }));
        armFade(chat.sid);
      },
      setPointer: (sid, pointer) => {
        setPointers((prev) => {
          if (pointer === null) {
            if (!prev.has(sid)) return prev;
            const next = new Map(prev);
            next.delete(sid);
            return next;
          }
          const cur = prev.get(sid);
          if (cur && cur.x === pointer.x && cur.y === pointer.y) return prev;
          return new Map(prev).set(sid, pointer);
        });
      },
      retain: (sids) => {
        const keep = new Set(sids);
        for (const sid of [...fadeTimersRef.current.keys()]) if (!keep.has(sid)) dropBubble(sid);
        setPointers((prev) => {
          const next = new Map([...prev].filter(([sid]) => keep.has(sid)));
          return next.size === prev.size ? prev : next;
        });
      },
      clearRemote: dropAllBubbles,
      setOwnPointer: (pointer) => {
        if (pointer !== null) ownPointerRef.current = pointer;
        if (pointer === null || !ownRef.current.open) return;
        setOwn((o) => (o.pointer && o.pointer.x === pointer.x && o.pointer.y === pointer.y ? o : { ...o, pointer }));
      },
      open: () => {
        if (!canSend() || ownRef.current.open) return;
        sentSomethingRef.current = false;
        setOwn({ open: true, text: "", pointer: ownPointerRef.current });
        armIdleClose();
      },
      isOpen: () => ownRef.current.open,
    }),
    [armFade, armIdleClose, canSend, dropAllBubbles, dropBubble, resolveName],
  );

  useEffect(() => {
    if (own.open) inputRef.current?.focus();
  }, [own.open]);

  useEffect(
    () => () => {
      window.clearTimeout(sendTimerRef.current);
      window.clearTimeout(idleTimerRef.current);
      for (const t of fadeTimersRef.current.values()) window.clearTimeout(t);
    },
    [],
  );

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    // Excalidraw listens for tool hotkeys on the document; keep typing out of its reach.
    e.stopPropagation();
  };

  const ownPos = own.open && own.pointer ? toCanvas(own.pointer, view) : null;

  return (
    <div className={styles.cursorChatLayer} data-testid="cursor-chat-layer">
      {[...bubbles].map(([sid, b]) => {
        const p = pointers.get(sid);
        if (!p) return null;
        const pos = toCanvas(p, view);
        return (
          <div
            key={sid}
            className={styles.cursorChatBubble}
            data-testid="cursor-chat-bubble"
            style={{
              left: pos.left + CURSOR_OFFSET.x,
              top: pos.top + CURSOR_OFFSET.y,
              background: b.color.background,
              borderColor: b.color.stroke,
            }}
          >
            <span className={styles.cursorChatName}>{b.username}</span>
            <span className={styles.cursorChatText}>{b.text}</span>
          </div>
        );
      })}
      {own.open && (
        <div
          className={`${styles.cursorChatBubble} ${styles.cursorChatOwn}`}
          style={ownPos ? { left: ownPos.left + CURSOR_OFFSET.x, top: ownPos.top + CURSOR_OFFSET.y } : { left: 16, bottom: 16 }}
        >
          <input
            ref={inputRef}
            className={styles.cursorChatInput}
            data-testid="cursor-chat-input"
            aria-label="Cursor chat"
            placeholder="Say something…"
            maxLength={CURSOR_CHAT_MAX_CHARS}
            value={own.text}
            onChange={(e) => {
              const text = e.target.value.slice(0, CURSOR_CHAT_MAX_CHARS);
              setOwn((o) => ({ ...o, text }));
              queueSend(text);
              armIdleClose();
            }}
            onKeyDown={handleKeyDown}
            onBlur={close}
          />
        </div>
      )}
    </div>
  );
});

export default CursorChatLayer;
