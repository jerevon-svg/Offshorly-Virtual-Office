import coffeeVoucher from "../../assets/reward-art/coffee_voucher.png";
import deskPlant from "../../assets/reward-art/desk_plant.png";
import earlyOutPass from "../../assets/reward-art/early_out_pass.png";
import halfDayLeave from "../../assets/reward-art/half_day_leave.png";
import lunchVoucher from "../../assets/reward-art/lunch_voucher.png";
import playlistPick from "../../assets/reward-art/playlist_pick.png";
import { HUD_ICONS } from "../HudIcon";

// Reward illustrations, keyed by the catalog item's STABLE id (see backend
// app/services/redemption.py's CATALOG — ids are the redemption's item_id and are never reused
// for a different meaning, unlike titles which are free to be reworded).
//
// `early_out_pass` reuses the existing HUD clock rather than generating a seventh illustration.
// Anything the catalog gains later falls back to the gift icon already used in the header, so a
// new item renders sensibly with no code change.
const BY_ITEM_ID: Readonly<Record<string, string>> = {
  playlist_pick: playlistPick,
  coffee_voucher: coffeeVoucher,
  desk_plant: deskPlant,
  early_out_pass: earlyOutPass,
  lunch_voucher: lunchVoucher,
  half_day_leave: halfDayLeave,
};

/** Illustration for a catalog item or a redemption, by item id. */
export function rewardArtFor(itemId: string): string {
  return BY_ITEM_ID[itemId] ?? HUD_ICONS.rewards;
}
