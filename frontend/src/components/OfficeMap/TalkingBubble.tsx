import { KeepScale } from "react-zoom-pan-pinch";
import type { AssetLayer } from "../../types/office";
import { greetingAnchor } from "./panMath";
import styles from "./TalkingBubble.module.css";

type TalkingBubbleProps = {
  layer: Pick<AssetLayer, "x" | "y" | "width">;
  text?: string;
  /**
   * Horizontal nudge (px) so two participants' bubbles don't render on top of
   * each other when they're standing close together (e.g. bon walked up
   * next to the peer for chat) — their anchor points can land almost
   * identically. Sign/magnitude chosen by the caller per bubble.
   */
  sideOffset?: number;
};

export function TalkingBubble({ layer, text, sideOffset = 0 }: TalkingBubbleProps) {
  const { leftPct, topPct } = greetingAnchor(layer);
  const bubbleStyle = sideOffset
    ? { transform: `translate(calc(-50% + ${sideOffset}px), calc(-100% - 12px))` }
    : undefined;
  return (
    <KeepScale
      className={styles.anchor}
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
      }}
    >
      {text ? (
        <div className={styles.bubbleText} style={bubbleStyle}>
          {text}
        </div>
      ) : (
        <div className={styles.bubble} style={bubbleStyle}>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </div>
      )}
    </KeepScale>
  );
}

export default TalkingBubble;
