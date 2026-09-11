import { WorldActionMenu, type WorldActionMenuAnchor, type WorldActionMenuItem } from "./WorldActionMenu";

// The two manifest furniture layers that together paint the HR desk in the executive-team room
// (see office-assets-manifest.json). Either half opens the one HR Desk menu.
export const HR_DESK_LAYER_IDS: readonly string[] = ["hr-sdesk", "hr-ldesk"];

type Props = {
  anchor: WorldActionMenuAnchor;
  onClose: () => void;
  onApplyForLeave: () => void;
  onRequestEarlyOut: () => void;
  onHrRequests: () => void;
};

// Anchored action menu opened by clicking the HR desk — the same thin-wrapper shape as
// ReceptionActionMenu: this file only decides WHICH rows exist; the card, rows, dismissal and
// placement are the shared WorldActionMenu. V1 rows are entry points only; the formal
// employee-request flow (HR Desk -> request -> Atlas/Zoho People -> HR approval) lands behind
// these handlers later. General HR questions are deliberately not a row: employees chat with
// HR through the existing employee interaction.
export function HrDeskActionMenu({ anchor, onClose, onApplyForLeave, onRequestEarlyOut, onHrRequests }: Props) {
  const items: WorldActionMenuItem[] = [
    { key: "applyForLeave", label: "Apply for Leave", onSelect: onApplyForLeave },
    { key: "requestEarlyOut", label: "Request Early Out", onSelect: onRequestEarlyOut },
    { key: "hrRequests", label: "HR Requests", onSelect: onHrRequests },
  ];
  return (
    <WorldActionMenu
      anchor={anchor}
      onClose={onClose}
      ariaLabel="HR Desk"
      title="HR Desk"
      subtitle="Human Resources"
      items={items}
    />
  );
}

export default HrDeskActionMenu;
