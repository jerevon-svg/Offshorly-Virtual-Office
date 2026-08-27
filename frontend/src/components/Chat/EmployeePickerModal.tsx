import { useMemo, useState } from "react";
import styles from "./EmployeePickerModal.module.css";

export type EmployeePickerPerson = { email: string; displayName: string };

type EmployeePickerModalProps = {
  /** "single" (New Message / Find Person) confirms as soon as one row is clicked.
   *  "multi" (New Group Chat) requires >=2 checked, then an explicit confirm click. */
  mode: "single" | "multi";
  title: string;
  people: EmployeePickerPerson[];
  onClose: () => void;
  onConfirm: (emails: string[]) => void;
};

// Shared employee search/select surface for the Global Chat entry points — "New Message" and
// "Find Person" both resolve to a single picked employee (functionally identical: search, pick
// one, open/create their DM via the existing idempotent flow), while "New Group Chat" reuses the
// exact same search/list UI in multi-select mode.
export function EmployeePickerModal({ mode, title, people, onClose, onConfirm }: EmployeePickerModalProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) => p.displayName.toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
    );
  }, [people, query]);

  function toggle(email: string) {
    if (mode === "single") {
      onConfirm([email]);
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span>{title}</span>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search for a person…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div className={styles.list}>
          {matches.length === 0 && <div className={styles.emptyRow}>No match.</div>}
          {matches.map((person) => (
            <button
              key={person.email}
              type="button"
              className={selected.has(person.email) ? `${styles.row} ${styles.rowSelected}` : styles.row}
              onClick={() => toggle(person.email)}
            >
              {mode === "multi" && <input type="checkbox" checked={selected.has(person.email)} readOnly />}
              <span>{person.displayName}</span>
            </button>
          ))}
        </div>
        {mode === "multi" && (
          <div className={styles.footer}>
            <button
              type="button"
              className={styles.confirmButton}
              disabled={selected.size < 2}
              onClick={() => onConfirm(Array.from(selected))}
            >
              Create Group ({selected.size})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default EmployeePickerModal;
