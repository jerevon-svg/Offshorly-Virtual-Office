import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

// Sticky Note tool for the Whiteboard editor. Excalidraw has no built-in sticky note, but it has
// two things that together make one: a `custom` active tool (the host owns what a pointer-down
// does while it is active) and container-plus-bound-text elements (a rectangle whose `label`
// becomes a text element bound to it). So a sticky note here is an ordinary filled rectangle with
// a bound label — Excalidraw-native, so moving, resizing, double-click-to-edit, undo/redo, copy
// and export all work with zero extra code. This module is pure so the tool contract is testable
// without a canvas; WhiteboardEditor wires it to the toolbar button and onPointerDown.

export const STICKY_NOTE_TOOL = "sticky-note";
export const STICKY_NOTE_WIDTH = 200;
export const STICKY_NOTE_HEIGHT = 160;
export const STICKY_NOTE_DEFAULT_TEXT = "Note";

export interface ActiveToolLike {
  type: string;
  customType?: string | null;
}

export function isStickyNoteTool(tool: ActiveToolLike | null | undefined): boolean {
  return !!tool && tool.type === "custom" && tool.customType === STICKY_NOTE_TOOL;
}

/** The element skeleton for one sticky note centred on `origin` (scene coordinates), ready for
 * Excalidraw's convertToExcalidrawElements, which turns it into a rectangle + bound text. */
export function stickyNoteSkeleton(origin: { x: number; y: number }): ExcalidrawElementSkeleton {
  return {
    type: "rectangle",
    x: origin.x - STICKY_NOTE_WIDTH / 2,
    y: origin.y - STICKY_NOTE_HEIGHT / 2,
    width: STICKY_NOTE_WIDTH,
    height: STICKY_NOTE_HEIGHT,
    backgroundColor: "#fff9c4",
    strokeColor: "#e0c200",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 0,
    roundness: { type: 3 },
    label: {
      text: STICKY_NOTE_DEFAULT_TEXT,
      fontSize: 20,
      textAlign: "center",
      verticalAlign: "middle",
    },
  };
}
