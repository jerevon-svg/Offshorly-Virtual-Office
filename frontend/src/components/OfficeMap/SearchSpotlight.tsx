import { useEffect, useMemo, useRef, useState } from "react";
import HudIcon from "../HudIcon";
import { formatCharacterName } from "../../data/office-layout";
import { profileImageFor } from "../../data/portraits";
import { STATUS_META, type OfficeStatus } from "../../services/presence/status";
import type { AssetLayer } from "../../types/office";
import styles from "./SearchSpotlight.module.css";

// ---- SEARCH SPOTLIGHT ------------------------------------------------------------------------
// The dock's Search tile opens this centred macOS-Spotlight-style panel instead of a dock flyout.
// It OWNS NO ACTION LOGIC: Locate / Chat / Call are the caller's existing handlers, passed in and
// invoked with the picked layer, so there is exactly one implementation of each behaviour in the
// app (OfficeMap's handleChoose / the search locate path). This component only decides which
// teammate the caller's handler runs against.
//
// Dock + Toucan hiding is NOT done here either — see OfficeMap's `spotlight` state and HudDock's
// `hidden` prop, which is the reusable mechanism any future dock tool can open with.

/** Locate history, newest first. Real usage only — never seeded with fabricated people. */
const RECENT_KEY = "vo.search.recent.v1";
const RECENT_MAX = 6;

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string): void {
  try {
    const next = [id, ...readRecent().filter((v) => v !== id)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode / blocked storage — Recent simply stays empty. */
  }
}

export type SearchSpotlightProps = {
  open: boolean;
  onClose: () => void;
  /** Searchable teammates — the caller's existing character layers, already filtered. */
  people: AssetLayer[];
  /** The caller's existing peer-status map, keyed by layer id. */
  statusByLayerId: Record<string, OfficeStatus>;
  /** Existing locate/focus/move-to-person behaviour. */
  onLocate: (layer: AssetLayer) => void;
  /** Existing open-DM behaviour. */
  onChat: (layer: AssetLayer) => void;
  /** Existing call behaviour. */
  onCall: (layer: AssetLayer) => void;
};

export function SearchSpotlight({
  open,
  onClose,
  people,
  statusByLayerId,
  onLocate,
  onChat,
  onCall,
}: SearchSpotlightProps) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Fresh query + focus on every open, and the Recent row re-read from storage so it reflects
  // locates made since the last time this was open.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setRecent(readRecent());
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // Esc anywhere, and pointer-down outside the panel, both close — the same dismissal contract
  // the dock's own flyouts use, so no office-wide backdrop layer is introduced.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onClose]);

  const trimmed = query.trim();
  const matches = useMemo(() => {
    if (!trimmed) return [];
    const q = trimmed.toLowerCase();
    return people.filter((l) => formatCharacterName(l).toLowerCase().includes(q));
  }, [people, trimmed]);

  const recentPeople = useMemo(() => {
    const byId = new Map(people.map((l) => [l.id, l]));
    const seen = recent.map((id) => byId.get(id)).filter((l): l is AssetLayer => Boolean(l));
    // Before any locate has ever been made there is no history to show, so the row falls back to
    // the real roster's own order. Still real teammates — nothing invented.
    return (seen.length > 0 ? seen : people).slice(0, RECENT_MAX);
  }, [people, recent]);

  if (!open) return null;

  function run(action: (layer: AssetLayer) => void, layer: AssetLayer) {
    pushRecent(layer.id);
    action(layer);
    onClose();
  }

  function statusOf(layer: AssetLayer): OfficeStatus {
    return statusByLayerId[layer.id] ?? "OFFLINE";
  }

  function avatarOf(layer: AssetLayer): string {
    return profileImageFor(layer.id.includes("@") ? layer.id : null, () => layer.path);
  }

  return (
    <div className={styles.overlay} data-testid="search-spotlight">
      <div className={styles.panel} ref={panelRef} role="dialog" aria-label="Search for a person">
        <div className={styles.queryRow}>
          <HudIcon name="search" size="26px" />
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder="Find a teammate..."
            aria-label="Find a teammate"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches.length > 0) run(onLocate, matches[0]);
            }}
          />
          <span className={styles.escHint} aria-hidden="true">
            esc
          </span>
        </div>

        <div className={styles.divider} />

        {trimmed ? (
          <div className={styles.results}>
            <div className={styles.sectionLabel}>
              {matches.length === 1 ? "1 teammate found" : `${matches.length} teammates found`}
            </div>
            {matches.map((layer) => {
              const status = statusOf(layer);
              return (
                <div key={layer.id} className={styles.resultRow}>
                  <img className={styles.resultAvatar} src={avatarOf(layer)} alt="" />
                  <div className={styles.resultText}>
                    <span className={styles.resultName}>
                      {formatCharacterName(layer)}
                      <span
                        className={styles.presenceDot}
                        style={{ background: STATUS_META[status].color }}
                        aria-hidden="true"
                      />
                    </span>
                    <span className={styles.resultStatus}>{STATUS_META[status].label}</span>
                  </div>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.actionButton}
                      aria-label={`Locate ${formatCharacterName(layer)}`}
                      onClick={() => run(onLocate, layer)}
                    >
                      <HudIcon name="locate" size="24px" />
                    </button>
                    <button
                      type="button"
                      className={styles.actionButton}
                      aria-label={`Chat with ${formatCharacterName(layer)}`}
                      onClick={() => run(onChat, layer)}
                    >
                      <HudIcon name="chat" size="24px" />
                    </button>
                    <button
                      type="button"
                      className={styles.actionButton}
                      aria-label={`Call ${formatCharacterName(layer)}`}
                      onClick={() => run(onCall, layer)}
                    >
                      <HudIcon name="call" size="24px" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.recent}>
            <div className={styles.sectionLabel}>Recent</div>
            <div className={styles.recentRow}>
              {recentPeople.map((layer) => {
                const status = statusOf(layer);
                return (
                  <button
                    key={layer.id}
                    type="button"
                    className={styles.recentItem}
                    aria-label={`Locate ${formatCharacterName(layer)}`}
                    onClick={() => run(onLocate, layer)}
                  >
                    <span className={styles.recentAvatarWrap}>
                      <img className={styles.recentAvatar} src={avatarOf(layer)} alt="" />
                      <span
                        className={styles.recentDot}
                        style={{ background: STATUS_META[status].color }}
                        aria-hidden="true"
                      />
                    </span>
                    <span className={styles.recentName}>{formatCharacterName(layer)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SearchSpotlight;
