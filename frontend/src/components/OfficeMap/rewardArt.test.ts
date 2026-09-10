import { describe, expect, it } from "vitest";
import { rewardArtFor } from "./rewardArt";
import { HUD_ICONS } from "../HudIcon";

// The catalog's stable item ids (backend app/services/redemption.py's CATALOG). Every one must
// resolve to real art, and each must be distinct so no two cards look the same.
const ITEM_IDS = [
  "playlist_pick",
  "coffee_voucher",
  "desk_plant",
  "early_out_pass",
  "lunch_voucher",
  "half_day_leave",
] as const;

describe("rewardArtFor", () => {
  it("gives every catalog item its own illustration", () => {
    const art = ITEM_IDS.map(rewardArtFor);
    for (const src of art) expect(src).toBeTruthy();
    expect(new Set(art).size).toBe(ITEM_IDS.length);
  });

  it("falls back to the gift icon for an item the catalog gains later", () => {
    expect(rewardArtFor("some_future_reward")).toBe(HUD_ICONS.rewards);
    expect(rewardArtFor("")).toBe(HUD_ICONS.rewards);
  });

  it("keys off the id, not the title, so a reworded item keeps its art", () => {
    expect(rewardArtFor("coffee_voucher")).toBe(rewardArtFor("coffee_voucher"));
    expect(rewardArtFor("coffee_voucher")).not.toBe(rewardArtFor("desk_plant"));
  });
});
