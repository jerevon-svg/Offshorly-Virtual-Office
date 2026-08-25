import { useEffect } from "react";
import { formatCharacterName } from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";
import styles from "./CharacterActionMenu.module.css";

type Props = {
  layer: AssetLayer;
  anchor: { clientX: number; clientY: number };
  onChoose: (action: "chat" | "call" | "approach" | "walkDemo" | "patDemo" | "askToJoin") => void;
  onClose: () => void;
  // Demo triggers for any character with a populated sprite set — alex/micah
  // (hardcoded NPCs) plus any saved avatar (e.g. "Lui") generated via the
  // real "Add Employee" pipeline, each with its own useCharacterWalk
  // instance (see OfficeMap.tsx's savedAvatarApiRef/SavedAvatarWalker).
  // Exercises walk/pat animations independent of bon's own walk/pat
  // mechanism.
  showDemos?: boolean;
  // True when the tapped target is currently a member of a >=2-member spatial session
  // (see spatialSessionStore.ts) that the viewer is NOT already a member of — computed in
  // OfficeMap.tsx, which already consumes useSpatialSessions() for the self status flip.
  canAskToJoin?: boolean;
};

export function CharacterActionMenu({
  layer,
  anchor,
  onChoose,
  onClose,
  showDemos,
  canAskToJoin,
}: Props) {
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
        <button className={styles.item} onClick={() => onChoose("approach")}>Approach</button>
        {canAskToJoin && (
          <button className={styles.item} onClick={() => onChoose("askToJoin")}>Ask to Join</button>
        )}
        {showDemos && (
          <>
            <button className={styles.item} onClick={() => onChoose("walkDemo")}>Walk demo</button>
            <button className={styles.item} onClick={() => onChoose("patDemo")}>Pat demo</button>
          </>
        )}
      </div>
    </div>
  );
}

export default CharacterActionMenu;
