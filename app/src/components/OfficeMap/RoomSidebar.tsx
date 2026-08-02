import { useEffect, useRef } from "react";
import { formatCharacterName, formatRoomName } from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";
import styles from "./RoomSidebar.module.css";

type Props = {
  open: boolean;
  layer: AssetLayer | null;
  side: "left" | "right";
  members: AssetLayer[];
  onClose: () => void;
};

export function RoomSidebar({ open, layer, side, members, onClose }: Props) {
  // Cache the last non-null layer so content doesn't blank during the
  // close slide-out animation (component stays mounted; only CSS toggles).
  const lastLayerRef = useRef<AssetLayer | null>(null);
  if (layer) lastLayerRef.current = layer;
  const displayLayer = layer ?? lastLayerRef.current;

  // Same caching pattern for `side`: preserve whichever edge the sidebar was
  // actually docked at while it animates closed, instead of snapping to the
  // default right edge mid-animation.
  const lastSideRef = useRef<"left" | "right">("right");
  if (layer) lastSideRef.current = side;
  const displaySide = layer ? side : lastSideRef.current;

  const lastMembersRef = useRef<AssetLayer[]>([]);
  if (layer) lastMembersRef.current = members;
  const displayMembers = layer ? members : lastMembersRef.current;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={`${styles.sidebar} ${displaySide === "left" ? styles.left : ""} ${open ? styles.open : ""}`}
    >
      <div className={styles.header}>
        <div className={styles.title}>{displayLayer ? formatRoomName(displayLayer.id) : ""}</div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className={styles.body}>
        {displayMembers.length === 0 ? (
          <div className={styles.empty}>No employees in this room</div>
        ) : (
          displayMembers.map((member) => (
            <div key={member.id} className={styles.item}>
              {formatCharacterName(member)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default RoomSidebar;
