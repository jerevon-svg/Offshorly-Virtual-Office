import { useEffect } from "react";
import { formatCharacterName } from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";
import styles from "./CharacterActionMenu.module.css";

type Props = {
  layer: AssetLayer;
  anchor: { clientX: number; clientY: number };
  onChoose: (action: "chat" | "call" | "pat") => void;
  onClose: () => void;
};

export function CharacterActionMenu({ layer, anchor, onChoose, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const left = Math.min(anchor.clientX + 8, window.innerWidth - 200);
  const top = Math.min(anchor.clientY, window.innerHeight - 160);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.menu} style={{ left, top }} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>{formatCharacterName(layer)}</div>
        <button className={styles.item} onClick={() => onChoose("chat")}>Chat</button>
        <button className={styles.item} onClick={() => onChoose("call")}>Call</button>
        <button className={styles.item} onClick={() => onChoose("pat")}>Pat on the head</button>
      </div>
    </div>
  );
}

export default CharacterActionMenu;
