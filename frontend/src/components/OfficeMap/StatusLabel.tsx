import { formatCharacterName } from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";
import { ACTIVE_DETAIL_STATUSES, STATUS_META, type OfficeStatus } from "../../services/presence/status";
import { greetingAnchor } from "./panMath";
import styles from "./StatusLabel.module.css";

type StatusLabelProps = {
  layer: Pick<AssetLayer, "id" | "x" | "y" | "width" | "name">;
  status: OfficeStatus;
  isSelf: boolean;
  /**
   * Whether this layer currently has an active TalkingBubble rendered
   * (dots or text). When true, the pill needs extra vertical clearance so
   * it never overlaps the bubble — the "text" variant (up to 3 lines) is
   * much taller than the "dots" typing indicator, so it gets its own,
   * larger offset. See StatusLabel.module.css for the two offset classes.
   */
  hasActiveBubble?: boolean;
  bubbleVariant?: "dots" | "text";
};

// Floating "{emoji} {name}" pill, anchored above the character using the same
// greetingAnchor as TalkingBubble, but with a larger negative vertical offset
// so it sits ABOVE where TalkingBubble renders — both stay visible at once
// without overlapping. TalkingBubble keeps its existing closer-to-the-head
// position untouched.
//
// Unlike TalkingBubble, this label does NOT use KeepScale: it renders as a
// plain descendant of the same TransformWrapper-scaled container the
// character avatar divs render in (see OfficeStage.tsx), so its size and its
// head-to-label gap are fixed in WORLD space and scale together with the
// avatar as the user zooms in/out (by design — see StatusLabel task notes).
// The three offset values below (-10px/-34px/-84px) were originally tuned as
// screen-space pixel values under KeepScale's constant-scale behavior; they
// are kept unchanged as the new WORLD-space defaults per design direction,
// so overlap-avoidance vs. the (still KeepScale'd, constant-screen-size)
// TalkingBubble is only guaranteed near 100% zoom — see StatusLabel.module.css.
export function StatusLabel({ layer, status, isSelf, hasActiveBubble, bubbleVariant }: StatusLabelProps) {
  const { leftPct, topPct } = greetingAnchor(layer);
  const meta = STATUS_META[status];
  const name = isSelf ? "You" : formatCharacterName(layer);
  const showDetail = ACTIVE_DETAIL_STATUSES.has(status);
  // Three clearance tiers, smallest to largest gap from the head:
  // - default (.pill): no active TalkingBubble — sit close to the head.
  // - .pillDotsActive: the "dots" typing-indicator bubble (~22px tall) is
  //   showing — needs the old -34px clearance so the pill doesn't overlap it.
  // - .pillAboveText: a real "text" bubble (up to 3 lines, ~70px tall) is
  //   showing — needs the largest -84px clearance.
  const pillClassName = !hasActiveBubble
    ? styles.pill
    : bubbleVariant === "text"
      ? `${styles.pill} ${styles.pillAboveText}`
      : `${styles.pill} ${styles.pillDotsActive}`;

  return (
    <div
      className={styles.anchor}
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
      }}
    >
      <div className={pillClassName}>
        <span className={styles.dot} style={{ backgroundColor: meta.color }} />
        <span className={styles.text}>
          {name}
          {showDetail ? ` · ${meta.label}` : ""}
        </span>
      </div>
    </div>
  );
}

export default StatusLabel;
