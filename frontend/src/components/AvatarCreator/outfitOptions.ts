import type { OutfitOption } from "../../services/avatar/types";

// Static outfit catalog. No real outfit art exists yet, so each option
// renders as a colored tile placeholder until asset art is ready.
export const OUTFIT_OPTIONS: OutfitOption[] = [
  { id: "business-suit", label: "Business Suit", colorHex: "#2b3a55" },
  { id: "smart-casual", label: "Smart Casual", colorHex: "#5b7fa6" },
  { id: "polo", label: "Polo", colorHex: "#3f7a5c" },
  { id: "hoodie", label: "Hoodie", colorHex: "#6b4c8a" },
  { id: "barong", label: "Barong", colorHex: "#c9a24b" },
  { id: "uniform", label: "Uniform", colorHex: "#a63d40" },
];
