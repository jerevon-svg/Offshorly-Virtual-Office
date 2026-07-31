import { useState } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import floorplan from "../../assets/office/floorplan.png";
import styles from "./OfficeMap.module.css";

// Natural pixel dimensions of the exported floorplan.png. Keep these in
// sync with the actual asset — bounds/fit math depends on real dims, not
// CSS-stretched values.
const FLOORPLAN_WIDTH = 1024;
const FLOORPLAN_HEIGHT = 885;

function computeFitScale(): number {
  if (typeof window === "undefined") return 0.5;
  const fitW = window.innerWidth / FLOORPLAN_WIDTH;
  const fitH = window.innerHeight / FLOORPLAN_HEIGHT;
  // Fit the whole floorplan inside the viewport (contain, not cover).
  return Math.min(fitW, fitH);
}

export function OfficeMap() {
  const [fitScale] = useState(computeFitScale);
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div className={`${styles.viewport} ${isDragging ? styles.dragging : ""}`}>
      <TransformWrapper
        initialScale={fitScale}
        minScale={fitScale}
        maxScale={2.5}
        centerOnInit
        limitToBounds
        wheel={{ step: 0.1 }}
        pinch={{ step: 5 }}
        doubleClick={{ disabled: true }}
        onPanningStart={() => setIsDragging(true)}
        onPanningStop={() => setIsDragging(false)}
      >
        <TransformComponent
          wrapperStyle={{ width: "100%", height: "100%" }}
        >
          <img
            src={floorplan}
            alt="Offshorly virtual office floorplan"
            className={styles.floorplan}
            width={FLOORPLAN_WIDTH}
            height={FLOORPLAN_HEIGHT}
          />
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}

export default OfficeMap;
