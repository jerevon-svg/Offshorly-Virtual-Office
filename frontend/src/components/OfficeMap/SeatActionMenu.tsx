import { WorldActionMenu } from "./WorldActionMenu";

type Props = {
  anchor: { clientX: number; clientY: number };
  onConfirm: () => void;
  onClose: () => void;
};

// Anchored action menu opened by clicking an empty seat marker — single
// "Sit here" confirm action. The card is the shared WorldActionMenu.
export function SeatActionMenu({ anchor, onConfirm, onClose }: Props) {
  return (
    <WorldActionMenu
      anchor={anchor}
      onClose={onClose}
      ariaLabel="Empty seat"
      title="Empty seat"
      items={[{ key: "sit", label: "Sit here", onSelect: onConfirm }]}
    />
  );
}

export default SeatActionMenu;
