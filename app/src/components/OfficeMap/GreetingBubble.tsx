import { KeepScale } from "react-zoom-pan-pinch";
import type { AssetLayer } from "../../types/office";
import { greetingAnchor } from "./panMath";
import styles from "./GreetingBubble.module.css";

type GreetingBubbleProps = {
  layer: Pick<AssetLayer, "x" | "y" | "width">;
  text: string;
};

export function GreetingBubble({ layer, text }: GreetingBubbleProps) {
  const { leftPct, topPct } = greetingAnchor(layer);
  return (
    <KeepScale
      className={styles.anchor}
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
      }}
    >
      <div className={styles.bubble}>{text}</div>
    </KeepScale>
  );
}

export default GreetingBubble;
