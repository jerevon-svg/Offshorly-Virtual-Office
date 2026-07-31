import {
  ASSET_PATH_TO_SRC,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  officeAssetLayers,
} from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";
import styles from "./OfficeStage.module.css";

// Render order: floor first (base), then room/decor images, then character
// images last so characters always sit above their room.
const KIND_ORDER: Record<AssetLayer["kind"], number> = {
  floor: 0,
  room: 1,
  decor: 1,
  character: 2,
};

const sortedLayers = [...officeAssetLayers].sort(
  (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
);

export function OfficeStage() {
  return (
    <div
      className={styles.stage}
      style={{
        width: FRAME_WIDTH,
        aspectRatio: `${FRAME_WIDTH} / ${FRAME_HEIGHT}`,
      }}
    >
      {sortedLayers.map((layer) => {
        const src = ASSET_PATH_TO_SRC[layer.path];

        if (layer.kind === "floor") {
          return (
            <div key={layer.id} className={styles.floor}>
              <img src={src} alt="" />
            </div>
          );
        }

        return (
          <div
            key={layer.id}
            className={styles.layer}
            style={{
              left: `${(layer.x / FRAME_WIDTH) * 100}%`,
              top: `${(layer.y / FRAME_HEIGHT) * 100}%`,
              width: `${(layer.width / FRAME_WIDTH) * 100}%`,
              height: `${(layer.height / FRAME_HEIGHT) * 100}%`,
              ...(layer.transform ? { transform: layer.transform } : {}),
              ...(layer.blendMode
                ? { mixBlendMode: layer.blendMode as React.CSSProperties["mixBlendMode"] }
                : {}),
            }}
          >
            <img src={src} alt="" />
          </div>
        );
      })}
    </div>
  );
}

export default OfficeStage;
