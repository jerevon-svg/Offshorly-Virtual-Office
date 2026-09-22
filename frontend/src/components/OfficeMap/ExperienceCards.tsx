// EXPERIENCE CARDS — the picker shared by Settings -> General's two "which experience" choices:
// Starting view (Office / 3D / Player) and the Office Experience gallery (3D Office / Classic Office,
// and the seasonal offices that will join them).
//
// WHY A CARD AND NOT A ROW. Both of these are a choice between PLACES, and a place is recognised, not
// read. The text rows they replace described a camera in words and made three cameras look like three
// paragraphs; a framed picture of the real thing with a short label is how a game asks this question.
// Nothing else about the Settings modal changes — this is the two pickers, in the panel's own section
// frame, using the panel's own accent (#4bb96a).
//
// THE PICTURES ARE REAL CAPTURES of the running office, taken through the app's own camera and
// environment controls (src/assets/experience/*.webp). Nothing is illustrated, mocked or generated: the
// Office card is the office camera, the Player card is the player camera with the avatar in it, and the
// Classic card is V1's own floor. A card whose art were a drawing would be promising an office that does
// not exist, which is the one thing a picker like this must never do.
//
// ONE COMPONENT, BOTH PICKERS, AND THE SEASONAL ONES AFTER THEM. An option may be marked `comingSoon`,
// which renders it as a labelled, unselectable preview — the seam the Halloween and Christmas offices
// will arrive through, with no second selector and no branch in the selection logic.
import styles from "./ExperienceCards.module.css";

export interface ExperienceOption<T extends string> {
  value: T;
  label: string;
  hint: string;
  /** A real capture of this experience — imported from src/assets/experience. */
  art: string;
  /** Marks an experience that exists in the gallery but cannot be chosen yet. It renders as a clearly
   *  labelled preview and is NOT selectable: a card that looked available and did nothing would be
   *  worse than not showing it at all. */
  comingSoon?: boolean;
}

interface Props<T extends string> {
  /** Names the radiogroup for assistive technology, and groups the radios for arrow-key navigation. */
  name: string;
  ariaLabel: string;
  options: readonly ExperienceOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function ExperienceCards<T extends string>({ name, ariaLabel, options, value, onChange }: Props<T>) {
  return (
    <div className={styles.grid} role="radiogroup" aria-label={ariaLabel}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className={styles.card}
              data-selected={selected ? "true" : undefined}
              data-coming-soon={option.comingSoon ? "true" : undefined}
              data-value={option.value}
            >
              {/* A REAL RADIO, only visually replaced. Arrow keys walk the group, Space selects, the role
                  and checked state are the browser's own — none of it is reimplemented here. */}
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                disabled={option.comingSoon}
                onChange={() => onChange(option.value)}
                // A RADIO THAT IS ALREADY CHECKED FIRES NO `change`, and here that silence was wrong:
                // picking the card you are already on can still be a real choice — arriving in Classic
                // on `?world=v1` and wanting to KEEP it is exactly that. `click` fires either way, and
                // both handlers are safe to run for one selection because every consumer of `onChange`
                // is idempotent for the same value.
                onClick={() => onChange(option.value)}
              />
              <span className={styles.thumb}>
                {/* `loading="lazy"` because Settings is opened, not passed through, and five captures
                    should not be on the office's own boot path. The alt is empty on purpose: the label
                    beside it is already the accessible name, and "screenshot of the 3D office" read out
                    before it would be noise in front of the thing it is describing. */}
                <img src={option.art} alt="" loading="lazy" decoding="async" />
                {option.comingSoon && <span className={styles.badge}>Coming soon</span>}
                {selected && !option.comingSoon && (
                  <span className={styles.tick} aria-hidden="true">
                    ✓
                  </span>
                )}
              </span>
              <span className={styles.text}>
                <span className={styles.label}>{option.label}</span>
                <span className={styles.hint}>{option.hint}</span>
              </span>
            </label>
          );
        })}
    </div>
  );
}
