import { WorldActionMenu, type WorldActionMenuItem } from "./WorldActionMenu";

type Props = {
  anchor: { clientX: number; clientY: number };
  onClose: () => void;
  // Hidden once already checked in — mirrors the old Arisha-menu gate, just
  // reached via reception now instead of her.
  showCheckIn?: boolean;
  // Gated the same way the rest of the checkout UI is (DEV or real Zoho
  // mode) — see OfficeMap.tsx's checkout-UI guard comment. Only rendering
  // this button under the same guard avoids opening a flow with no visible
  // modal in a prod build without real Zoho integration.
  showCheckOut?: boolean;
  onCheckIn: () => void;
  onCheckOut: () => void;
};

// Anchored action menu opened by clicking the reception room itself — the
// sole entry point for both check-in and check-out. Rows and their gates are
// unchanged; the card is the shared WorldActionMenu.
export function ReceptionActionMenu({ anchor, onClose, showCheckIn, showCheckOut, onCheckIn, onCheckOut }: Props) {
  const items: WorldActionMenuItem[] = [];
  if (showCheckIn) items.push({ key: "checkIn", label: "Check In", onSelect: onCheckIn });
  if (showCheckOut) items.push({ key: "checkOut", label: "Check Out", onSelect: onCheckOut });
  return <WorldActionMenu anchor={anchor} onClose={onClose} ariaLabel="Reception" title="Reception" items={items} />;
}

export default ReceptionActionMenu;
