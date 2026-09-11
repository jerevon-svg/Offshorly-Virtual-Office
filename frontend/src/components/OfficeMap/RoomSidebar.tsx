import { useEffect, useRef } from "react";
import HudIcon from "../HudIcon";
import { formatCharacterName, formatRoomName } from "../../data/office-layout";
import { portraitSrcFor } from "../../data/portraits";
import type { AssetLayer } from "../../types/office";
import type { OfficePerson } from "../../services/office/floorMerge";
import styles from "./RoomSidebar.module.css";

// Room details — the side panel a room click opens. PRESENTATION follows the cream card family
// (Hub / Tasks / Notifications); BEHAVIOUR is unchanged: it still docks flush to whichever edge
// the caller picked (`side`, decided in OfficeMap from the room's position and the space around
// it), slides in/out, caches its content through the close animation, and lists the live
// occupants when a roster is present or the manifest cast when not. One list, exactly as before.

type Props = {
  open: boolean;
  layer: AssetLayer | null;
  side: "left" | "right";
  members: AssetLayer[];
  onClose: () => void;
  /** Real occupants from Atlas. When present these replace `members`
   *  entirely — with a live roster the manifest's fictional cast is hidden
   *  on the canvas, so listing it here would contradict what's on screen. */
  people?: OfficePerson[];
  /** Atlas room id -> display name, so someone whose live room has no
   *  hand-drawn twin reads as "in Design Sprint" rather than a raw id. */
  roomNames?: Map<string, string>;
  /** Whiteboard W4: opens this room's boards. Absent when boards are unavailable (mock chat
   *  backend, or the layer has no flat room id) — then no button is rendered at all. */
  onOpenWhiteboards?: () => void;
};

// Shown as a coloured dot rather than a word: the list is names, and a
// status label per row would compete with them for attention.
const STATUS_COLOR: Record<string, string> = {
  ONLINE: "#3ec46d",
  IN_MEETING: "#e0a53a",
  AWAY: "#c9a227",
  ON_LEAVE: "#8a8a8a",
  OFFLINE: "#6b6b6b",
};

export function RoomSidebar({
  open,
  layer,
  side,
  members,
  onClose,
  people,
  roomNames,
  onOpenWhiteboards,
}: Props) {
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

  // Same close-animation caching as `members` above. Undefined (not empty)
  // means "no live roster — fall back to the manifest list", so the two
  // states stay distinguishable during the slide-out.
  const lastPeopleRef = useRef<OfficePerson[] | undefined>(undefined);
  if (layer) lastPeopleRef.current = people;
  const displayPeople = layer ? people : lastPeopleRef.current;

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
        <div className={styles.titleBlock}>
          <div className={styles.title}>{displayLayer ? formatRoomName(displayLayer.id) : ""}</div>
          <div className={styles.subtitle} data-testid="room-subtitle">
            {displayPeople
              ? displayPeople.length === 1
                ? "1 person in the room"
                : `${displayPeople.length} people in the room`
              : displayMembers.length === 1
                ? "1 seat"
                : `${displayMembers.length} seats`}
          </div>
        </div>
        <div className={styles.headerActions}>
          {onOpenWhiteboards && (
            <button
              type="button"
              className={styles.whiteboardsBtn}
              onClick={onOpenWhiteboards}
              aria-label="Open whiteboards"
              title="Whiteboards"
            >
              {/* The production boards icon, not a glyph stand-in. */}
              <HudIcon name="boards" size="20px" />
            </button>
          )}
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>
      <div className={styles.body}>
        {displayPeople ? (
          displayPeople.length === 0 ? (
            <div className={styles.empty}>No employees in this room</div>
          ) : (
            displayPeople.map((person) => {
              // Someone ONLINE in a Cliq channel or project room is drawn
              // at their desk (those rooms have no art), so the sidebar is
              // the only place that can say where they actually are.
              const elsewhere = person.inEphemeralRoom
                ? (person.atlasRoomId && roomNames?.get(person.atlasRoomId)) ?? "elsewhere"
                : null;
              const portrait = portraitSrcFor(person.email);
              const meta = [elsewhere ? `in ${elsewhere}` : null, person.currentActivity].filter(Boolean).join(" · ");
              return (
                <div key={person.email} className={styles.item} data-testid="room-person">
                  {/* Real portrait when one exists (data/portraits.ts); otherwise an initial on the
                      family's neutral disc — no invented art. */}
                  {portrait ? (
                    <img className={styles.avatar} src={portrait} alt="" />
                  ) : (
                    <span className={styles.avatarFallback} aria-hidden="true">
                      {person.displayName.trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className={styles.itemText}>
                    <span className={styles.name}>
                      <span
                        className={styles.dot}
                        aria-hidden="true"
                        style={{ background: STATUS_COLOR[person.status] ?? STATUS_COLOR.OFFLINE }}
                      />
                      {person.displayName}
                    </span>
                    {meta && <span className={styles.meta}>{meta}</span>}
                  </div>
                </div>
              );
            })
          )
        ) : displayMembers.length === 0 ? (
          <div className={styles.empty}>No employees in this room</div>
        ) : (
          displayMembers.map((member) => (
            <div key={member.id} className={styles.item} data-testid="room-person">
              <img className={styles.avatar} src={member.path} alt="" />
              <div className={styles.itemText}>
                <span className={styles.name}>{formatCharacterName(member)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default RoomSidebar;
