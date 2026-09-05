import { describe, expect, it } from "vitest";
import {
  STICKY_NOTE_DEFAULT_TEXT,
  STICKY_NOTE_HEIGHT,
  STICKY_NOTE_TOOL,
  STICKY_NOTE_WIDTH,
  isStickyNoteTool,
  stickyNoteSkeleton,
} from "./stickyNote";

describe("stickyNote", () => {
  it("recognises only the custom sticky-note tool", () => {
    expect(isStickyNoteTool({ type: "custom", customType: STICKY_NOTE_TOOL })).toBe(true);
    expect(isStickyNoteTool({ type: "custom", customType: "laser" })).toBe(false);
    expect(isStickyNoteTool({ type: "rectangle", customType: null })).toBe(false);
    expect(isStickyNoteTool(null)).toBe(false);
  });

  it("builds a filled, labelled rectangle centred on the pointer", () => {
    const skeleton = stickyNoteSkeleton({ x: 300, y: 200 }) as Record<string, unknown>;
    expect(skeleton).toMatchObject({
      type: "rectangle",
      x: 300 - STICKY_NOTE_WIDTH / 2,
      y: 200 - STICKY_NOTE_HEIGHT / 2,
      width: STICKY_NOTE_WIDTH,
      height: STICKY_NOTE_HEIGHT,
      fillStyle: "solid",
      label: { text: STICKY_NOTE_DEFAULT_TEXT, textAlign: "center", verticalAlign: "middle" },
    });
    expect(skeleton.backgroundColor).not.toBe("transparent");
  });
});
