import { useEffect, useRef } from "react";
import { formatCharacterName, formatRoomName } from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";
import type { OfficePerson } from "../../services/office/floorMerge";
import styles from "./RoomSidebar.module.css";

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
        <div className={styles.title}>{displayLayer ? formatRoomName(displayLayer.id) : ""}</div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
          ×
        </button>
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
              return (
                <div key={person.email} className={styles.item}>
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      marginRight: 8,
                      background: STATUS_COLOR[person.status] ?? STATUS_COLOR.OFFLINE,
                    }}
                  />
                  {person.displayName}
                  {elsewhere && (
                    <span style={{ opacity: 0.6 }}> · in {elsewhere}</span>
                  )}
                  {person.currentActivity && (
                    <span style={{ opacity: 0.6 }}> · {person.currentActivity}</span>
                  )}
                </div>
              );
            })
          )
        ) : displayMembers.length === 0 ? (
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
