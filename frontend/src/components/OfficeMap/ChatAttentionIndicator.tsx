import type React from "react";
import type { AssetLayer } from "../../types/office";
import { greetingAnchor } from "./panMath";
import { avatarIdForEmail } from "../../data/avatarIdentity";
import { LIVE_3D_CHARACTERS } from "../../render3d/live3dCharacters";
import styles from "./ChatAttentionIndicator.module.css";

type ChatAttentionIndicatorProps = {
  layer: Pick<AssetLayer, "id" | "x" | "y" | "width" | "height">;
  /** Unread message count from the existing chat unread state. */
  count: number;
  /** World-px clearance above the head, sized for whatever overhead element
   *  this character already has (see chatAttention.ts's OVERHEAD_CLEARANCE_PX). */
  clearancePx: number;
  /** Display name, for the accessible label only. */
  peerName: string;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
};

// Small game-like 💬 badge floating above a coworker who has unread messages
// waiting for the local viewer.
//
// Anchoring reuses greetingAnchor — the exact same head-anchor StatusLabel and
// TalkingBubble use, including the live-3D per-character measured head offset —
// so the badge tracks the avatar as it walks and needs no position logic of its
// own. Like those two it deliberately does NOT use KeepScale: it renders as a
// plain descendant of the TransformWrapper-scaled stage, so its size and its
// head gap are fixed in WORLD space and scale together with the avatar and its
// nameplate at every zoom level (the presence system's established rule — a
// screen-space badge would balloon relative to the character when zoomed out).
//
// Purely presentational: it neither reads nor writes unread state, and clicking
// it just calls back into the caller's existing conversation opener.
export function ChatAttentionIndicator({
  layer,
  count,
  clearancePx,
  peerName,
  onPointerDown,
  onPointerUp,
}: ChatAttentionIndicatorProps) {
  const { leftPct, topPct } = greetingAnchor(
    layer,
    LIVE_3D_CHARACTERS[avatarIdForEmail(layer.id) ?? ""]?.headTopAboveCenter,
  );
  return (
    <div className={styles.anchor} style={{ left: `${leftPct}%`, top: `${topPct}%` }}>
      {/* Outer: fixed world-space placement + the one-time entrance pop (this
          element mounts exactly when the unread state appears, so the pop is
          naturally once-per-appearance and needs no timer). Inner: the endless
          gentle bob, kept on a separate element so it never fights the pop's
          transform or the placement translate. */}
      <div
        className={styles.badge}
        style={{ transform: `translate(-50%, calc(-100% - ${clearancePx}px))` }}
      >
        <button
          type="button"
          className={styles.button}
          aria-label={
            count > 1
              ? `Open chat with ${peerName} — ${count} unread messages`
              : `Open chat with ${peerName} — 1 unread message`
          }
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          <span className={styles.emoji} aria-hidden="true">
            💬
          </span>
          {count > 1 ? <span className={styles.count}>{count > 9 ? "9+" : count}</span> : null}
        </button>
      </div>
    </div>
  );
}

export default ChatAttentionIndicator;
