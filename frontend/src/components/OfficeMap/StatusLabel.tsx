import { formatCharacterName } from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";
import { ACTIVE_DETAIL_STATUSES, STATUS_META, type OfficeStatus } from "../../services/presence/status";
import { greetingAnchor } from "./panMath";
import styles from "./StatusLabel.module.css";

type StatusLabelProps = {
  layer: Pick<AssetLayer, "id" | "x" | "y" | "width" | "name">;
  status: OfficeStatus;
  isSelf: boolean;
};

// Floating "{emoji} {name}" pill, anchored above the character using the same
// greetingAnchor as TalkingBubble. Mutually exclusive with TalkingBubble: the
// caller (OfficeStage.tsx) only renders StatusLabel for a character when that
// character does NOT have an active spatial-chat conversation (TalkingBubble
// renders instead in that case), so the two never coexist and don't need
// distinct clearance offsets.
//
// This label does NOT use KeepScale: it renders as a plain descendant of the
// same TransformWrapper-scaled container the character avatar divs render in
// (see OfficeStage.tsx), so its size and its head-to-label gap are fixed in
// WORLD space and scale together with the avatar as the user zooms in/out (by
// design — see StatusLabel task notes). The pill's font-size/padding/dot-size
// and the -6px head-gap were retuned per live visual review after the
// KeepScale removal so the label reads as a small nameplate rather than
// dominating the character. TalkingBubble shares this same offset/sizing.
export function StatusLabel({ layer, status, isSelf }: StatusLabelProps) {
  const { leftPct, topPct } = greetingAnchor(layer);
  const meta = STATUS_META[status];
  const name = isSelf ? "You" : formatCharacterName(layer);
  const showDetail = ACTIVE_DETAIL_STATUSES.has(status);

  return (
    <div
      className={styles.anchor}
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
      }}
    >
      <div className={styles.pill}>
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
