// vo3d app — THE RECEPTION CHECK-IN KIOSK CARD (Phase 7E).
//
// A THIN WRAPPER, for the same reason app/CoworkerActionMenu.tsx is one: presentation and dismissal belong
// to the shared WorldActionMenu (components/OfficeMap), which is the office's real design system — its
// warm cream surface, its row treatment, its Escape-and-outside-press contract, its viewport flip. This
// file decides only WHICH row exists and what the header says. Writing a second card here would be a
// second design system pretending to be the first.
//
// IT DECIDES NOTHING ABOUT ATTENDANCE. It is handed a state and a callback. The check-in itself is V1's
// own `attendanceService.checkIn()`, run by app/Vo3dOverlay.tsx exactly as OfficeMap.tsx runs it — see
// adapters/v1Attendance.ts for why there is still only one authority.
//
// THE HEADER DOT IS THE SENSOR, ON SCREEN. The kiosk's own LED (render/Ambient's third state, driven from
// app/world.ts) says the same thing in the world: green checked in, red checked out or refused, amber
// while nothing is confirmed. The card never shows green for a state V1 has not confirmed — an unknown or
// in-flight answer is amber and offers no way through.
import { WorldActionMenu, type WorldActionMenuAnchor, type WorldActionMenuItem } from "../../../components/OfficeMap/WorldActionMenu";

/** What the kiosk is showing. Derived by the caller from V1's answer plus the in-flight request — never
 *  decided here, and deliberately closed: there is no state in which a check-in can be offered twice. */
export type Vo3dKioskState =
  /** V1 confirmed CHECKED_OUT: the gate is shut and this is the way through it. */
  | "checkedOut"
  /** A check-in is in flight. The row stays, disabled, so the card does not resize under the cursor. */
  | "submitting"
  /** V1 confirmed CHECKED_IN: nothing to do here, and no second check-in is offered. */
  | "checkedIn"
  /** The request failed, or the server answered with something other than CHECKED_IN. Retryable. */
  | "failed"
  /** Nothing is confirmed yet — the first read has not landed, or it failed. FAILS CLOSED: amber, no row
   *  that grants anything. */
  | "unknown";

/** Header colours. The office's own status palette — the same green and amber V1's presence dots use, and
 *  the red the refused speed gates now light (render/Materials PALETTE.denyRed). */
const META: Record<Vo3dKioskState, { color: string; label: string }> = {
  checkedOut: { color: "#FF5A52", label: "Checked out" },
  submitting: { color: "#EAB308", label: "Checking you in…" },
  checkedIn: { color: "#22C55E", label: "Checked in" },
  failed: { color: "#FF5A52", label: "Check-in didn't go through" },
  unknown: { color: "#EAB308", label: "Checking your status…" },
};

export interface Vo3dKioskCardProps {
  state: Vo3dKioskState;
  /** The kiosk's live on-screen point, recomputed by the caller per frame from the live camera. */
  anchor: WorldActionMenuAnchor;
  /** Run a check-in. Offered only in `checkedOut` and `failed`; the caller also guards against a second
   *  request in flight, so a double click can never become two POSTs. */
  onCheckIn: () => void;
  onClose: () => void;
}

export function Vo3dKioskCard({ state, anchor, onCheckIn, onClose }: Vo3dKioskCardProps) {
  const items: WorldActionMenuItem[] = [];
  if (state === "checkedOut") items.push({ key: "checkIn", label: "Check In", onSelect: onCheckIn });
  // IN FLIGHT: the row is still there and still says what is happening, but selecting it does nothing.
  // Removing it instead would shrink the card mid-click and hand the next click to whatever moved under it.
  else if (state === "submitting") items.push({ key: "checkIn", label: "Checking in…", onSelect: () => {} });
  else if (state === "failed") items.push({ key: "checkIn", label: "Try again", onSelect: onCheckIn });
  // `checkedIn` and `unknown` offer no action at all: one because there is nothing left to do, the other
  // because granting anything on an unconfirmed answer is the failure this whole boundary exists to avoid.
  items.push({ key: "close", label: "Close", onSelect: onClose });

  // The WORKING TIME is deliberately not repeated here. The HUD's pill already owns that number, from the
  // same server `checked_in_at`, and a second clock computed beside it is a second clock to disagree with.
  const meta = META[state];

  return (
    <WorldActionMenu
      anchor={anchor}
      onClose={onClose}
      ariaLabel="Reception check-in kiosk"
      title="Reception"
      meta={{ color: meta.color, label: meta.label }}
      items={items}
    />
  );
}

export default Vo3dKioskCard;
