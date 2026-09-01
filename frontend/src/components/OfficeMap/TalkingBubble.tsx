import type { AssetLayer } from "../../types/office";
import { greetingAnchor } from "./panMath";
import { avatarIdForEmail } from "../../data/avatarIdentity";
import { LIVE_3D_CHARACTERS } from "../../render3d/live3dCharacters";
import styles from "./TalkingBubble.module.css";

type TalkingBubbleProps = {
  layer: Pick<AssetLayer, "id" | "x" | "y" | "width" | "height">;
  text?: string;
};

// Renders INSTEAD of StatusLabel (mutual exclusivity handled by the caller,
// OfficeStage.tsx) for a character with an active spatial-chat conversation.
// Unified with StatusLabel's tuned small-dark-pill look (same font-size,
// padding, gap, background, and -6px head-gap offset) — only the CONTENT
// differs: typing-dots vs. chat text. Does NOT use KeepScale (removed, same
// change already made to StatusLabel): renders as a plain descendant of the
// same TransformWrapper-scaled container the avatar divs render in, so size
// and head-gap are fixed in WORLD space and scale with zoom.
export function TalkingBubble({ layer, text }: TalkingBubbleProps) {
  // Live-3D employees hang off their own measured head so the visible
  // head-to-label gap is identical for all of them regardless of how much
  // vertical animation headroom their layer box carries (see
  // greetingAnchor). Everyone else keeps the original top-edge anchor.
  const { leftPct, topPct } = greetingAnchor(
    layer,
    LIVE_3D_CHARACTERS[avatarIdForEmail(layer.id) ?? ""]?.headTopAboveCenter,
  );
  return (
    <div
      className={styles.anchor}
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
      }}
    >
      {text ? (
        <div className={styles.bubbleText}>{text}</div>
      ) : (
        <div className={styles.bubble}>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </div>
      )}
    </div>
  );
}

export default TalkingBubble;
