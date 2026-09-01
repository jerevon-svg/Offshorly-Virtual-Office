import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AssetLayer } from "../../types/office";
import type { SpatialVideoTrack } from "../../services/call/callStore";
import { SpatialVideoTile } from "./SpatialVideoTile";
import { greetingAnchor } from "./panMath";

// The tile owns the ONE video element for a track. callStore holds tracks and never elements
// (the opposite of its remote-audio handling), so if attach/detach here is wrong, a camera-off or
// a participant leaving strands a live stream in the DOM.

/** Minimal stand-in for a LiveKit video track: records attach/detach targets. */
function fakeTrack() {
  const attached: HTMLElement[] = [];
  const detached: HTMLElement[] = [];
  return {
    attached,
    detached,
    attach(el: HTMLElement) {
      attached.push(el);
      return el;
    },
    detach(el: HTMLElement) {
      detached.push(el);
      return el;
    },
  };
}

const asTrack = (t: ReturnType<typeof fakeTrack>) => t as unknown as SpatialVideoTrack;

const layer: Pick<AssetLayer, "id" | "x" | "y" | "width" | "height"> = {
  id: "b@example.com",
  x: 400,
  y: 300,
  width: 26,
  height: 60,
};

function videoIn(container: HTMLElement): HTMLVideoElement {
  const el = container.querySelector("video");
  if (!el) throw new Error("no video element rendered");
  return el;
}

describe("SpatialVideoTile", () => {
  it("attaches the track to its own video element on mount", () => {
    const track = fakeTrack();
    const { container } = render(<SpatialVideoTile layer={layer} track={asTrack(track)} />);

    expect(track.attached).toHaveLength(1);
    expect(track.attached[0]).toBe(videoIn(container));
  });

  it("detaches on unmount — camera off, participant left, or call ended", () => {
    const track = fakeTrack();
    const { container, unmount } = render(
      <SpatialVideoTile layer={layer} track={asTrack(track)} />,
    );
    const el = videoIn(container);

    unmount();

    expect(track.detached).toEqual([el]);
    expect(el.srcObject).toBeNull();
  });

  it("detaches the old track before attaching a replacement", () => {
    const first = fakeTrack();
    const second = fakeTrack();
    const { container, rerender } = render(
      <SpatialVideoTile layer={layer} track={asTrack(first)} />,
    );
    const el = videoIn(container);

    rerender(<SpatialVideoTile layer={layer} track={asTrack(second)} />);

    // No element is ever left holding a dead stream across a republish/reconnect.
    expect(first.detached).toEqual([el]);
    expect(second.attached).toEqual([el]);
  });

  it("survives a track that has already ended when it is detached", () => {
    const track = fakeTrack();
    track.detach = () => {
      throw new Error("track already ended");
    };
    const { unmount } = render(<SpatialVideoTile layer={layer} track={asTrack(track)} />);

    expect(() => unmount()).not.toThrow();
  });

  it("renders muted, inline and autoplaying — call audio stays in callStore's audio elements", () => {
    const { container } = render(<SpatialVideoTile layer={layer} track={asTrack(fakeTrack())} />);
    const el = videoIn(container);

    // muted is load-bearing: an unmuted element would double-play remote audio and, for self
    // video, feed the local microphone back through the speakers.
    expect(el.muted).toBe(true);
    expect(el.autoplay).toBe(true);
    expect(el.getAttribute("playsinline")).not.toBeNull();
  });

  it("anchors above the avatar using the shared greetingAnchor positioning", () => {
    const { container } = render(<SpatialVideoTile layer={layer} track={asTrack(fakeTrack())} />);
    const anchor = container.firstElementChild as HTMLElement;
    const { leftPct, topPct } = greetingAnchor(layer);

    // Percentage-of-frame positioning inside the shared TransformWrapper is what makes the tile
    // follow walking, zoom, pan and resize with no work of its own.
    expect(anchor.style.left).toBe(`${leftPct}%`);
    expect(anchor.style.top).toBe(`${topPct}%`);
  });
});
