// THE HUD ICON FAMILY'S CONTRACT. Not a look test — a look test would be a screenshot — but the two
// things that are mechanically checkable and that a hand-added icon actually gets wrong: that the name is
// registered at all, and that the PNG behind it is cut to the family's own canvas.
//
// EVERY ICON IS 512×512 WITH AN ALPHA CHANNEL. The dock sizes them in `em` off one shared container, so a
// file that is a different canvas size or that ships an opaque background does not render slightly wrong —
// it renders as a white tile in a cream dock, at whatever scale its own pixels imply.
import { describe, expect, it } from "vitest";
// @ts-expect-error node:fs/node:path are untyped under tsconfig.app.json (types: ["vite/client"] only).
import { readFileSync } from "node:fs";
import { HUD_ICONS, type HudIconName } from "./HudIcon";

const DIR = "src/assets/hud-icons";

/** width, height and PNG colour type, straight out of IHDR — no decoder needed. Read through a
 *  DataView rather than Node's Buffer helpers, so nothing here needs @types/node. */
function pngHeader(file: string): { width: number; height: number; colorType: number } {
  const bytes = new Uint8Array(readFileSync(`${DIR}/${file}`) as ArrayLike<number>);
  expect(String.fromCharCode(...bytes.subarray(1, 4)), `${file} is a PNG`).toBe("PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), colorType: bytes[25] };
}

describe("the HUD icon family", () => {
  it("registers a dedicated Room icon — the Room Details tile is not borrowing `people`", () => {
    expect(Object.keys(HUD_ICONS)).toContain("room");
    expect(HUD_ICONS.room).not.toBe(HUD_ICONS.people);
    expect(HUD_ICONS.room).not.toBe(HUD_ICONS.hub);
    expect(HUD_ICONS.room).not.toBe(HUD_ICONS.map);
  });

  it("ships room.png on the family's own canvas, with alpha", () => {
    const h = pngHeader("room.png");
    expect(h.width).toBe(512);
    expect(h.height).toBe(512);
    expect(h.colorType).toBe(6); // RGBA — an opaque icon would paint a white tile in the dock
  });

  it("holds every registered name to the same canvas, so one new icon cannot drift", () => {
    for (const name of Object.keys(HUD_ICONS) as HudIconName[]) {
      // Vite resolves the import to a URL; the basename is what is on disk either way.
      const file = String(HUD_ICONS[name]).split("/").pop()!.split("?")[0];
      const h = pngHeader(file);
      expect([h.width, h.height], name).toEqual([512, 512]);
      expect(h.colorType, name).toBe(6);
    }
  });
});
