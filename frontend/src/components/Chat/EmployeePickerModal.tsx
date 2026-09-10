import { useMemo, useState } from "react";
import { profileImageFor } from "../../data/portraits";
import styles from "./EmployeePickerModal.module.css";

export type EmployeePickerPerson = { email: string; displayName: string };

type EmployeePickerModalProps = {
  /** "single" (New Message / Find Person) confirms as soon as one row is clicked.
   *  "multi" (New Group Chat) requires >=2 checked, then an explicit confirm click. */
  mode: "single" | "multi";
  title: string;
  people: EmployeePickerPerson[];
  onClose: () => void;
  /** Multi mode also hands back the optional, already-trimmed group name ("" when left blank).
   *  Single mode never passes a second argument. */
  onConfirm: (emails: string[], groupName?: string) => void;
};

// Shared employee search/select surface for the Global Chat entry points — "New Message" and
// "Find Person" both resolve to a single picked employee (functionally identical: search, pick
// one, open/create their DM via the existing idempotent flow), while "New Group Chat" reuses the
// exact same search/list UI in multi-select mode.
export function EmployeePickerModal({ mode, title, people, onClose, onConfirm }: EmployeePickerModalProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");

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
      <div className={styles.panel} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={styles.toRow}>
          <span className={styles.toLabel}>To:</span>
          <span className={styles.toValue}>
            {mode === "single"
              ? "Pick one person"
              : selected.size === 0
                ? "Pick two or more people"
                : `${selected.size} selected`}
          </span>
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
          {matches.map((person) => {
            const isSelected = selected.has(person.email);
            const portrait = profileImageFor(person.email, () => "");
            return (
              <button
                key={person.email}
                type="button"
                className={isSelected ? `${styles.row} ${styles.rowSelected}` : styles.row}
                onClick={() => toggle(person.email)}
                aria-pressed={mode === "multi" ? isSelected : undefined}
              >
                {portrait ? (
                  <img className={styles.avatar} src={portrait} alt="" draggable={false} />
                ) : (
                  <span className={styles.avatarInitials}>
                    {person.displayName.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                )}
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{person.displayName}</span>
                  <span className={styles.rowEmail}>{person.email}</span>
                </span>
                {mode === "multi" && (
                  <span className={isSelected ? `${styles.check} ${styles.checkOn}` : styles.check} aria-hidden="true">
                    {isSelected ? "✓" : ""}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {mode === "multi" && (
          <div className={styles.footer}>
            <input
              type="text"
              className={styles.groupNameInput}
              placeholder="Group name (optional)"
              aria-label="Group name"
              maxLength={255}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            <button
              type="button"
              className={styles.confirmButton}
              disabled={selected.size < 2}
              onClick={() => onConfirm(Array.from(selected), groupName.trim())}
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
