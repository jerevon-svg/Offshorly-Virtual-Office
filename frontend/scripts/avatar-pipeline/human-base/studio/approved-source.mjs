// studio/approved-source.mjs — THE APPROVED STAGE A ILLUSTRATION a person's Meshy head is made from (2026-10-20). The approved five
// and every later head came from the FLAT Stage A sprites (`<Name>_Sprite.png`, HB_SPRITE_DIR, default ~/Downloads/Employee Sprite);
// the Stage 0 population `-canonical.png` is a trace crop, never a Meshy reference (prep-reference destroys it). A Studio upload of an
// approved illustration is that person's sprite. No guessing: no file → null, and the caller refuses.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SPRITE_DIR = process.env.HB_SPRITE_DIR || path.join(os.homedir(), "Downloads", "Employee Sprite");
const SPRITE_NAME = { bon: "Jerevon" };   // the cast id ↔ sprite name exception (the Studio's bon ↔ jerevon key rule)

export const spriteFile = (who, dir = SPRITE_DIR) => path.join(dir, `${SPRITE_NAME[who] ?? who.charAt(0).toUpperCase() + who.slice(1)}_Sprite.png`);

/** the approved illustration for who: the Studio upload, else the roster sprite — null when neither is on disk */
export function approvedSource(who, { S = "scripts/avatar-pipeline/output/human-base/studio", dir = SPRITE_DIR, exists = fs.existsSync } = {}) {
  if (!/^[a-z0-9-]{1,40}$/.test(String(who ?? ""))) return null;
  return [`${S}/uploads/${who}.png`, spriteFile(who, dir)].find((f) => exists(f)) ?? null;
}
