import { useMemo, useState } from "react";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import { characterLayers, formatCharacterName } from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";
import { computeCenterTransform } from "./panMath";
import styles from "./CharacterSearch.module.css";

type CharacterSearchProps = {
  transformRef: React.RefObject<ReactZoomPanPinchRef | null>;
  targetScale: number;
  onLocate?: (layer: AssetLayer) => void;
};

export function CharacterSearch({ transformRef, targetScale, onLocate }: CharacterSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characterLayers.filter((l) =>
      formatCharacterName(l).toLowerCase().includes(q),
    );
  }, [query]);

  function goToCharacter(layer: AssetLayer) {
    const ref = transformRef.current;
    const wrapper = ref?.instance.wrapperComponent;
    if (!ref || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const { x, y } = computeCenterTransform(layer, targetScale, rect.width, rect.height);
    onLocate?.(layer);
    ref.setTransform(x, y, targetScale, 500, "easeOut");
    setQuery(formatCharacterName(layer));
    setOpen(false);
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setHighlight(0);
    setOpen(true);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (matches.length > 0) {
        setHighlight((h) => Math.min(h + 1, matches.length - 1));
      }
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (matches.length > 0) {
        setHighlight((h) => Math.max(h - 1, 0));
      }
      setOpen(true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matches.length > 0) {
        goToCharacter(matches[highlight] ?? matches[0]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showEmpty = open && query.trim().length > 0 && matches.length === 0;

  return (
    <div className={styles.search}>
      <input
        type="text"
        placeholder="Search for a person…"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <ul className={styles.dropdown}>
          {matches.map((layer, i) => (
            <li
              key={layer.id}
              className={i === highlight ? `${styles.item} ${styles.itemActive}` : styles.item}
              onMouseDown={(e) => {
                e.preventDefault();
                goToCharacter(layer);
              }}
            >
              {formatCharacterName(layer)}
            </li>
          ))}
          {showEmpty && <li className={styles.empty}>No match</li>}
        </ul>
      )}
    </div>
  );
}

export default CharacterSearch;
