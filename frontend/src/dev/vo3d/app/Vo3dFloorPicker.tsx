// vo3d app — THE ELEVATOR'S FLOOR PANEL: where to, once the building has more than one other floor.
//
// A lift's own button panel, in the office's card family: one keycap per registered floor, TOP FLOOR FIRST,
// the floor you are on lit and not pressable. Every row comes from app/floors (elevatorFloorRows), so a
// floor registered there appears here with no edit — nothing in this file knows how many floors exist.
//
// IT DECIDES NOTHING. Choosing a floor calls `onSelect(id)`, and the overlay hands that to the world's
// `useElevator(to)` — the same path every ride takes, so the ride, its camera and Go Together are unchanged.
// Closing it (Escape, an outside press, the close button) moves nothing.
//
// KEYBOARD: ↑/↓ move between destinations (the current floor is skipped), Home/End jump to the ends,
// Enter/Space press the focused button, a digit presses that floor's button the way a real panel does, and
// Escape closes. Handled in the CAPTURE phase and stopped there, so PLAYER's own keys (Space to jump,
// arrows to walk) never see a key the panel answered.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { placeMenu, type WorldActionMenuAnchor } from "../../../components/OfficeMap/WorldActionMenu";
import type { ElevatorFloorRow } from "./floors";
import styles from "./Vo3dFloorPicker.module.css";

export interface Vo3dFloorPickerProps {
  /** every registered floor, top first (app/floors elevatorFloorRows) */
  rows: readonly ElevatorFloorRow<string>[];
  /** the employee's on-screen point; omitted (or off-screen), the panel stands centred */
  anchor?: WorldActionMenuAnchor | null;
  /** a destination was chosen — never called for the floor you are on */
  onSelect(id: string): void;
  onClose(): void;
}

/** the destination to focus first: the one nearest the current floor, upward on a tie */
function initialFocus(rows: readonly ElevatorFloorRow<string>[]): number {
  const here = rows.findIndex((r) => r.current);
  let best = -1;
  rows.forEach((r, i) => {
    if (r.current) return;
    if (best < 0 || Math.abs(i - here) < Math.abs(best - here) || (Math.abs(i - here) === Math.abs(best - here) && i < best)) best = i;
  });
  return best;
}

export function Vo3dFloorPicker({ rows, anchor, onSelect, onClose }: Vo3dFloorPickerProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [focus, setFocus] = useState(() => initialFocus(rows));
  const here = rows.find((r) => r.current) ?? null;

  const choose = (i: number): void => {
    const row = rows[i];
    if (row && !row.current) onSelect(row.id);
  };

  useEffect(() => {
    if (focus >= 0) buttons.current[focus]?.focus();
  }, [focus]);

  useEffect(() => {
    const enabled = rows.map((r, i) => (r.current ? -1 : i)).filter((i) => i >= 0);
    const step = (by: number): void => {
      if (!enabled.length) return;
      const at = enabled.indexOf(focus);
      setFocus(enabled[(at < 0 ? 0 : at + by + enabled.length) % enabled.length]);
    };
    const onKey = (e: KeyboardEvent): void => {
      let handled = true;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") step(1);
      else if (e.key === "ArrowUp") step(-1);
      else if (e.key === "Home") { if (enabled.length) setFocus(enabled[0]); }
      else if (e.key === "End") { if (enabled.length) setFocus(enabled[enabled.length - 1]); }
      else if (e.key === "Enter" || e.key === " ") {
        // a focused control that is not a floor button (the close button) presses itself
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement && cardRef.current?.contains(active) && !buttons.current.includes(active)) active.click();
        else choose(focus);
      }
      else if (/^[0-9]$/.test(e.key)) {
        const i = rows.findIndex((r) => Number(r.indicator) === Number(e.key));
        if (i >= 0) choose(i);
      } else handled = false;
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (target && !cardRef.current?.contains(target)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  });

  // Measured before paint so the first frame is already where placeMenu puts it (WorldActionMenu's rule).
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    if (el.offsetWidth !== size.width || el.offsetHeight !== size.height) setSize({ width: el.offsetWidth, height: el.offsetHeight });
  });
  const placed = anchor ? placeMenu(anchor, size, { width: window.innerWidth, height: window.innerHeight }) : null;

  return (
    <div className={styles.backdrop}>
      <div
        ref={cardRef}
        className={`${styles.card} ${placed ? "" : styles.centred}`}
        style={placed ? { left: placed.left, top: placed.top } : undefined}
        onClick={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Choose a floor"
        data-testid="floor-picker"
      >
        <div className={styles.header}>
          <span className={styles.glyph} aria-hidden="true">
            <span>▲</span>
            <span>▼</span>
          </span>
          <div className={styles.heading}>
            <div className={styles.title}>Elevator</div>
            {here && <div className={styles.sub}>You're on {here.indicator} · {here.name}</div>}
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.panel} role="group" aria-label="Floors">
          {rows.map((r, i) => (
            <button
              key={r.id}
              ref={(el) => { buttons.current[i] = el; }}
              type="button"
              className={`${styles.row} ${r.current ? styles.current : ""}`}
              disabled={r.current}
              aria-current={r.current ? "location" : undefined}
              onClick={() => choose(i)}
              onMouseEnter={() => { if (!r.current) setFocus(i); }}
              data-testid={`floor-picker-${r.id}`}
            >
              <span className={styles.keycap}>{r.indicator}</span>
              <span className={styles.name}>{r.name}</span>
              {r.current ? (
                <span className={styles.here}>You're here</span>
              ) : (
                <span className={styles.dir} aria-label={r.direction === "up" ? "Going up" : "Going down"}>
                  {r.direction === "up" ? "▲" : "▼"}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className={styles.hint} aria-hidden="true">
          <kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> go · <kbd>Esc</kbd> close
        </div>
      </div>
    </div>
  );
}

export default Vo3dFloorPicker;
