import { useEffect, useRef } from "react";
import type { SpatialVideoTrack } from "../../services/call/callStore";

// THE ONE VIDEO ELEMENT for a call camera, wherever an office draws one.
//
// Extracted from SpatialVideoTile (Phase 7D) because V2 needs exactly this behaviour over its own 3D
// bodies and must not get a second, drifting copy of it. What is shared is the ELEMENT and its lifecycle;
// what is NOT shared is anchoring, which is genuinely different in the two offices — V1 positions by
// percentage inside a scaled 2D stage, V2 asks a real camera where a head is. So this component takes no
// position at all and leaves placement entirely to its caller.
//
// THE CALLER OWNS THE ELEMENT, callStore owns the track. That split is what lets several surfaces show
// the same camera at once — the tile over an avatar and the expanded CallOverlay, simultaneously —
// because livekit-client keeps Track.attachedElements as an array and gives each element its own
// MediaStream wrapper. The one API that would break the others is the no-argument detach(), which
// detaches EVERY element; cleanup below always passes its own.
export interface CallVideoElementProps {
  /** A LIVE camera track. Absence of an element — not a muted track — is how "camera off" is
   *  represented, so this is never null: callStore removes the entry instead (see its TrackMuted
   *  handler). Local and remote tracks are handled identically; that is why self video needs no
   *  second code path anywhere. */
  track: SpatialVideoTrack;
  className?: string;
}

export function CallVideoElement({ track, className }: CallVideoElementProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    // attach() wires the track's MediaStream to the element and registers it with LiveKit.
    track.attach(el);
    return () => {
      // Runs on unmount (camera off, participant left, call ended) AND on every track swap, since
      // `track` is in the dep list — so a replaced track is always detached before its successor
      // attaches, and no element is ever left holding a dead stream.
      try {
        track.detach(el);
      } catch {
        // Track already ended — clearing the element below is still the right cleanup.
      }
      el.srcObject = null;
    };
  }, [track]);

  return (
    <video
      ref={videoRef}
      className={className}
      // MUTED IS LOAD-BEARING, not cosmetic. Remote call audio is played by callStore's own hidden audio
      // elements and must stay there; an unmuted element would double-play it, and (for self video) feed
      // the local microphone back through the speakers. It also keeps the element outside Chrome's
      // autoplay gate entirely, so video can never trip the audioPlaybackBlocked path.
      muted
      // iOS Safari otherwise takes the video fullscreen instead of playing it inline.
      playsInline
      autoPlay
    />
  );
}

export default CallVideoElement;
