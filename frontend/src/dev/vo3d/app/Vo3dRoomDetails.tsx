// vo3d app — ROOM DETAILS, the V2 panel. V1/V2 parity for components/OfficeMap/RoomSidebar.
//
// THE SHELL IS V1'S, LITERALLY. RoomSidebar.module.css is imported here and supplies the panel surface,
// the docked slide-in, the header, the row card, the avatar disc, the status dot and the empty state — so
// this is the office's own cream-card family rather than a second one that resembles it. Vo3dRoomDetails
// .module.css adds only what V2 needs on top: a row that can be PRESSED, the role line, the project chip,
// the "You" tag and a loading skeleton.
//
// WHY IT IS NOT LITERALLY V1'S COMPONENT. One reason, and it is the whole of requirement 4: a V1 row is
// inert, and a V2 row has to dispatch V1's own employee interactions (`onSelectPerson` below, which the
// overlay routes into world.selectCoworkerByEmail → the existing CoworkerActionMenu, falling back to the
// existing profile modal for somebody the world is not drawing). Forking V1's inert list into a clickable
// one inside V1's own file would have changed V1's office; wrapping the shared stylesheet does not.
//
// IT DECIDES NOTHING AND FETCHES NOTHING. Every fact on screen is resolved in app/roomDetails.ts from
// V1's own roster, and this file renders it. There is no second roster subscription, no room endpoint and
// no invented role, project or assignment — see roomDetails.ts for what each field actually is.
import { useEffect, useRef } from "react";
import sidebar from "../../../components/OfficeMap/RoomSidebar.module.css";
import styles from "./Vo3dRoomDetails.module.css";
import { STATUS_META } from "../../../services/presence/status";
import { roomSubtitle, type Vo3dRoomDetails as Details } from "./roomDetails";

export interface Vo3dRoomDetailsProps {
  /** Already resolved by the overlay (app/roomDetails.ts). Null closes the panel. */
  details: Details | null;
  /** Which edge to dock against. The overlay picks it from the room's side of the floor, as V1 does. */
  side?: "left" | "right";
  onClose: () => void;
  /** A row was pressed. The overlay decides what selecting somebody means — this file never does. */
  onSelectPerson: (email: string, displayName: string) => void;
}

export function Vo3dRoomDetails({ details, side = "right", onClose, onSelectPerson }: Vo3dRoomDetailsProps) {
  // V1's own close-animation caching: the component stays mounted and only a CSS class toggles, so the
  // content must survive the slide-out instead of blanking halfway through it.
  const lastDetailsRef = useRef<Details | null>(null);
  if (details) lastDetailsRef.current = details;
  const shown = details ?? lastDetailsRef.current;

  const lastSideRef = useRef<"left" | "right">("right");
  if (details) lastSideRef.current = side;
  const shownSide = details ? side : lastSideRef.current;

  const open = details !== null;
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
      // `role="dialog"` is how V2's existing conventions learn a panel owns the keyboard: app/keyGuard
      // stops C and WASD reaching the world while one is up, with no new listener. Same declaration the
      // checkout panels make.
      role="dialog"
      aria-modal={false}
      aria-label="Room details"
      data-testid="vo3d-room-details"
      data-open={open ? "true" : "false"}
      // CLOSED MEANS UNREACHABLE, not merely off-screen. The panel stays mounted so it can slide out with
      // its content intact, which leaves its close button and its rows in the tab order and its
      // `role="dialog"` in app/keyGuard's path — a closed panel would then be able to swallow a Tab and,
      // once focused, the world's own bare-letter keys. `inert` is how HudDock retires a hidden dock, and
      // it is the same answer here.
      inert={!open || undefined}
      aria-hidden={!open || undefined}
      className={[sidebar.sidebar, shownSide === "left" ? sidebar.left : "", open ? sidebar.open : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={sidebar.header}>
        <div className={sidebar.titleBlock}>
          <div className={sidebar.title}>{shown?.roomName ?? ""}</div>
          <div className={sidebar.subtitle} data-testid="vo3d-room-subtitle">
            {shown ? roomSubtitle(shown) : ""}
          </div>
        </div>
        <div className={sidebar.headerActions}>
          <button type="button" className={sidebar.closeBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>
      <div className={sidebar.body}>{shown && <Body details={shown} onSelectPerson={onSelectPerson} />}</div>
    </div>
  );
}

function Body({
  details,
  onSelectPerson,
}: {
  details: Details;
  onSelectPerson: (email: string, displayName: string) => void;
}) {
  if (details.kind === "loading") {
    return (
      <>
        {[0, 1, 2].map((i) => (
          <div key={i} className={styles.skeletonRow} data-testid="vo3d-room-skeleton" aria-hidden="true">
            <span className={styles.skeletonDisc} />
            <span className={styles.skeletonText}>
              <span className={styles.skeletonLine} />
              <span className={styles.skeletonLine} />
            </span>
          </div>
        ))}
        <span className={sidebar.empty} role="status">
          Loading who’s here…
        </span>
      </>
    );
  }

  // The wall-less central hub: real art, no flat rect, so no roster row can ever be keyed to it. Said
  // plainly — a confident "nobody is here" would be a claim the data cannot support.
  if (details.kind === "untracked") {
    return (
      <div className={`${sidebar.empty} ${styles.note}`}>
        This shared space isn’t tracked by the team roster, so there’s nobody to list here.
      </div>
    );
  }

  // No live roster at all (mock mode, or the roster never answered): V1's own fallback to the hand-drawn
  // cast. Those rows are names and art and nothing else, so they are not pressable — there is no employee
  // behind them to chat, call or walk up to.
  if (details.kind === "manifest") {
    if (details.members.length === 0) return <div className={sidebar.empty}>No employees in this room</div>;
    return (
      <>
        {details.members.map((member) => (
          <div key={member.id} className={sidebar.item} data-testid="vo3d-room-person">
            <img className={sidebar.avatar} src={member.path} alt="" />
            <div className={sidebar.itemText}>
              <span className={sidebar.name}>{member.name}</span>
            </div>
          </div>
        ))}
      </>
    );
  }

  if (details.occupants.length === 0) return <div className={sidebar.empty}>No employees in this room</div>;

  return (
    <>
      {details.occupants.map((person) => {
        const status = STATUS_META[person.status];
        return (
          <button
            key={person.email}
            type="button"
            className={`${sidebar.item} ${styles.rowButton}`}
            data-testid="vo3d-room-person"
            aria-label={`${person.displayName}${person.role ? `, ${person.role}` : ""} — ${status.label}`}
            onClick={() => onSelectPerson(person.email, person.displayName)}
          >
            {/* A real portrait when one exists; otherwise an initial on the family's neutral disc. No
                invented art, and never somebody else's. */}
            {person.portrait ? (
              <img className={sidebar.avatar} src={person.portrait} alt="" />
            ) : (
              <span className={sidebar.avatarFallback} aria-hidden="true">
                {person.displayName.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <span className={sidebar.itemText}>
              <span className={`${sidebar.name} ${styles.nameLine}`}>
                <span className={sidebar.dot} aria-hidden="true" style={{ background: status.color }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{person.displayName}</span>
                {person.isSelf && <span className={styles.youTag}>You</span>}
              </span>
              {person.role && <span className={styles.role}>{person.role}</span>}
              {person.activity && <span className={sidebar.meta}>{person.activity}</span>}
              {person.project && (
                <span className={styles.projectChip} data-testid="vo3d-room-project">
                  <span className={styles.projectDot} aria-hidden="true" />
                  {person.project}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </>
  );
}

export default Vo3dRoomDetails;
