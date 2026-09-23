// vo3d app — THE RECEPTION EXIT CHOICE (Phase 7E).
//
// A THIN WRAPPER, for the same reason app/Vo3dKioskCard.tsx and app/CoworkerActionMenu.tsx are: the card,
// its rows, its warm cream surface, its Escape-and-outside-press contract and its viewport flip all belong
// to the shared WorldActionMenu (components/OfficeMap). This file decides only WHICH rows exist.
//
// WHY THERE IS A CHOICE AT ALL. Walking out of the building is two completely different things — stepping
// over to the AI Lab for an hour, still on the clock, and ending the working day. Nothing in the world can
// tell them apart, and guessing either way is the expensive kind of wrong: an accidental check-out loses
// somebody's session, and an accidental "still working" leaves them clocked in all night. So the exit is
// held and the question is asked.
//
// IT DECIDES NOTHING. Every row is a callback. The AI Lab row opens a door; the Check Out row starts V1's
// own Log Time → Zoho → check-out flow, unchanged, in V1's own components; Cancel does nothing at all.
// Attendance is written by exactly one thing in this product and it is not this file.
import { WorldActionMenu, type WorldActionMenuAnchor } from "../../../components/OfficeMap/WorldActionMenu";

export interface Vo3dExitCardProps {
  /** The employee's live on-screen point, recomputed by the caller per frame from the live camera. */
  anchor: WorldActionMenuAnchor;
  /** Step out to the AI Lab: the exit opens, the work session is untouched, presence becomes Away. */
  onAiLab: () => void;
  /** Start V1's checkout. The exit stays shut until that flow has actually completed. */
  onCheckOut: () => void;
  /** Close the card. The exit stays shut and the work session is untouched — Escape and an outside press
   *  land here too, which is why "cancel" needs no confirmation of its own. */
  onCancel: () => void;
  /** Offered only where V1 offers it (DEV or a real Zoho integration), for V1's own reason: a Check Out
   *  row that opened a time-log flow with no Zoho behind it would log into the void. */
  showCheckOut?: boolean;
  /** How long this session has been running — V1's own worked label, passed in rather than recomputed. */
  workedLabel?: string;
}

export function Vo3dExitCard({ anchor, onAiLab, onCheckOut, onCancel, showCheckOut = true, workedLabel }: Vo3dExitCardProps) {
  const items = [
    { key: "aiLab", label: "Go to the AI Lab", onSelect: onAiLab },
    ...(showCheckOut ? [{ key: "checkOut", label: "Check Out", onSelect: onCheckOut }] : []),
    { key: "cancel", label: "Cancel", onSelect: onCancel },
  ];
  return (
    <WorldActionMenu
      anchor={anchor}
      onClose={onCancel}
      ariaLabel="Leaving the office"
      title="Leaving?"
      // The session clock, because it is the one fact that makes the choice: somebody four hours in is
      // stepping out, somebody eight hours in is probably done.
      {...(workedLabel ? { subtitle: `Working · ${workedLabel}` } : {})}
      items={items}
    />
  );
}

export default Vo3dExitCard;
