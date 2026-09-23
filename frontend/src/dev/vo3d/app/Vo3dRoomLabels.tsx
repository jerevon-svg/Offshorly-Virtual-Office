// vo3d app — ROOM DISCOVERY: THE ROOM'S NAME, OVER THE ROOM.
//
// The NBA 2K court treatment, and the whole of it: each room's name set large and bold straight over its
// floor, with no card, no pill, no border, no backing plate and no location pin. A refinement of Room
// Details' entry points, not a second feature — clicking a name opens the SAME panel, through the SAME
// world selection and the SAME camera framing a floor click already uses (app/Vo3dOverlay.tsx).
//
// ANCHORED TO REAL GEOMETRY, not to a screen grid. Each label hangs on the centre of the room's own rect
// (the very rect the camera frames it against — app/roomFocus.ts, one source for both), projected through
// the live camera every frame. So a label pans, orbits and zooms with the floor it names instead of
// drifting across it.
//
// REACT DOES NOT RUN THE FRAME LOOP, exactly as in Vo3dOverheads: React owns WHICH rooms exist, which is
// fixed for the life of the world, and one rAF loop writes each element's transform, size and visibility
// through refs. Putting a per-frame position in state would re-render this subtree sixty times a second.
//
// THE SIZE IS A FONT-SIZE, NOT A `scale()`. Same reason Vo3dOverheads states at length: a scaled element
// is rasterised once at its layout size and stretched, which turns type into a blurry bitmap. Written as
// a real font-size each frame, the words are laid out and rasterised at the size they are drawn — sharp
// at every zoom, in both cameras.
//
// ONE SHARED SIZE, and the room's own floor only ever pulls it DOWN. roomFocus's roomLabelLayout owns
// that rule and states at length why (two earlier versions got it wrong in opposite directions): the
// size is world-space cap height read through the live camera, so every room wears the same type and the
// whole set scales together on a zoom — and a room too narrow for its name wraps it, or, failing that,
// shrinks it by exactly as much as it must. Nothing is ever enlarged past the shared size.
//
// OFFICE AND 3D EXPLORE ONLY. PLAYER is deliberately untouched: its behaviour is unchanged, and the
// caller simply does not mount this layer there.
import { useEffect, useMemo, useRef } from "react";
import { formatRoomName } from "../../../data/office-layout";
import { roomLabelLayout } from "./roomFocus";
import type { Vo3dWorld } from "./world";
import styles from "./Vo3dRoomLabels.module.css";

export interface Vo3dRoomLabelsProps {
  worldRef: { current: Vo3dWorld | null };
  ready: boolean;
  /** Discovery is on AND this view takes the treatment. The caller owns both halves of that. */
  active: boolean;
  /** A name was clicked. The caller opens Room Details and frames the room — this file does neither. */
  onSelectRoom: (roomId: string) => void;
}

export function Vo3dRoomLabels({ worldRef, ready, active, onSelectRoom }: Vo3dRoomLabelsProps) {
  // FIXED FOR THE LIFE OF THE WORLD. The rooms are built once, so this is read once rather than polled.
  const roomIds = useMemo(
    () => (ready && worldRef.current ? worldRef.current.roomLabelIds?.() ?? [] : []),
    [ready, worldRef],
  );
  const nodes = useRef(new Map<string, HTMLButtonElement | null>());

  useEffect(() => {
    const world = worldRef.current;
    if (!active || !ready || !world) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const anchors = world.roomLabelAnchors();
      for (const [roomId, node] of nodes.current) {
        if (!node) continue;
        const a = anchors[roomId];
        // A room behind the camera or off the viewport is not drawn; nor is one at a zoom so far out that
        // the shared size would be a smear. Nothing else hides a label — at any ordinary zoom, the
        // default office view included, every room is lettered.
        const layout = a && a.visible ? roomLabelLayout(a, formatRoomName(roomId), a.scale) : null;
        if (!a || !layout) {
          node.style.visibility = "hidden";
          continue;
        }
        node.style.visibility = "visible";
        // The wrap is decided by the same pass that decided the size, so the two can never disagree —
        // written as text rather than left to the browser, which would wrap wherever the box happened to
        // end and undo the fit.
        const text = layout.lines.join("\n");
        if (node.textContent !== text) node.textContent = text;
        const px = layout.fontPx;
        // WHOLE PIXELS: a fractional translate leaves glyphs straddling device pixels, which reads as
        // softness even with no compositor layer involved.
        node.style.transform = `translate(${Math.round(a.clientX)}px, ${Math.round(a.clientY)}px) translate(-50%, -50%)`;
        node.style.fontSize = `${px.toFixed(2)}px`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, ready, worldRef]);

  // LEAVING DISCOVERY CLEARS THE WASH. Without this, hiding the layer while the pointer happens to be
  // over a name would strand a highlighted floor with nothing on screen explaining it.
  useEffect(() => {
    if (active) return;
    worldRef.current?.setRoomHighlight?.(null);
  }, [active, worldRef]);
  useEffect(() => () => worldRef.current?.setRoomHighlight?.(null), [worldRef]);

  if (!active || roomIds.length === 0) return null;

  return (
    <div className={styles.layer} data-testid="vo3d-room-labels">
      {roomIds.map((roomId) => (
        <button
          key={roomId}
          type="button"
          ref={(el) => {
            nodes.current.set(roomId, el);
          }}
          className={styles.label}
          data-testid="vo3d-room-label"
          data-room-id={roomId}
          // Hidden until the first frame places it.
          style={{ visibility: "hidden" }}
          onPointerEnter={() => worldRef.current?.setRoomHighlight?.(roomId)}
          onPointerLeave={() => worldRef.current?.setRoomHighlight?.(null)}
          onFocus={() => worldRef.current?.setRoomHighlight?.(roomId)}
          onBlur={() => worldRef.current?.setRoomHighlight?.(null)}
          onClick={() => onSelectRoom(roomId)}
        >
          {/* V1's OWN room name, the same string Room Details titles itself with. Seeded here so the
              element is never empty (and so a test can find it by name before the first frame); the frame
              loop rewrites it only when the wrap changes, which is almost never. */}
          {formatRoomName(roomId)}
        </button>
      ))}
    </div>
  );
}

export default Vo3dRoomLabels;
