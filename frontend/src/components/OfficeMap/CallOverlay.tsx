import { useEffect, useRef } from "react";
import {
  callParticipantsFor,
  useCallState,
  type SpatialVideoTrack,
} from "../../services/call/callStore";
import { SpatialCallControls } from "./SpatialCallControls";
import styles from "./CallOverlay.module.css";

type CallOverlayProps = {
  /** True when the viewer has asked for the expanded view. PURE UI STATE, owned by OfficeMap. */
  expanded: boolean;
  /** Collapse back to the office. Never leaves the call. */
  onMinimize: () => void;
  /** The existing roster-backed name resolver OfficeMap already passes to CallInvitePrompt. */
  resolveDisplayName: (email: string) => string;
  /** The viewer's own LiveKit identity (their lowercased email) — see callStore's identity note. */
  selfIdentity: string;
};

// Stage C: the expanded view of an ALREADY-RUNNING call.
//
// THIS COMPONENT OWNS NO CALL LIFECYCLE. Expanded/minimized is UI state and nothing else: there
// is no call to startOrJoinCall, no token fetch, no `new Room()`, no socket emit and no spatial
// session call anywhere in this file. Mounting and unmounting it attaches and detaches DOM video
// elements against tracks that are already live — the LiveKit Room, its connection, and its
// microphone/camera publications are untouched, so audio and video never break at the seam.
//
// Mic / camera / leave are the EXISTING SpatialCallControls, mounted verbatim in the footer
// rather than reimplemented. Two instances of it (the chat header and this one) coexist safely:
// it is a stateless useSyncExternalStore reader over the one callStore snapshot.
//
// Remote AUDIO is deliberately absent here. It stays where Stage A put it — callStore's hidden
// elements on document.body, outside React entirely — which is why minimizing cannot mute a call.
export function CallOverlay({
  expanded,
  onMinimize,
  resolveDisplayName,
  selfIdentity,
}: CallOverlayProps) {
  const call = useCallState();

  // Escape closes the overlay. Bound only while the overlay is actually open, and stops
  // propagation so it can never reach OfficeMap's own Escape handling behind it.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onMinimize();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [expanded, onMinimize]);

  const sessionId = call.connectedSessionId;

  // RENDER GUARD, not just the boolean: a drop, a leave, or an error makes the overlay vanish
  // without needing an effect to fire first.
  if (!expanded || call.status !== "connected" || !sessionId) return null;

  // The roster comes from the SERVER BROADCAST that SpatialCallControls already consumes — that
  // is what gives a camera-off participant a tile at all (videoByIdentity holds only live
  // cameras). Self is unioned in rather than trusted from the broadcast, so a lagging
  // spatial_calls frame can't leave the viewer looking at an empty call.
  const identities = Array.from(
    new Set(
      [selfIdentity, ...callParticipantsFor(call, sessionId)]
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  return (
    <div className={styles.backdrop} role="dialog" aria-label="Call">
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>In call</span>
          <button
            type="button"
            className={styles.minimize}
            onClick={onMinimize}
            aria-label="Minimize call"
            title="Minimize (the call keeps running)"
          >
            ✕
          </button>
        </div>
        <div
          className={styles.grid}
          data-participant-count={identities.length}
          data-testid="call-overlay-grid"
        >
          {identities.map((identity) => (
            <CallOverlayTile
              key={identity}
              name={
                identity === selfIdentity ? "You" : resolveDisplayName(identity)
              }
              track={call.videoByIdentity[identity]}
            />
          ))}
        </div>
        <div className={styles.footer}>
          {/* The existing controls, unchanged: mic, camera, leave. */}
          <SpatialCallControls sessionId={sessionId} />
        </div>
      </div>
    </div>
  );
}

type CallOverlayTileProps = {
  name: string;
  /** Undefined means CAMERA OFF — the store removes the entry rather than keeping a muted track
   *  (callStore's frozen-frame guard), so absence is the only representation of "off". */
  track: SpatialVideoTrack | undefined;
};

// One participant. Deliberately a SECOND element attached to the SAME track the spatial tile over
// the avatar is using — livekit-client keeps Track.attachedElements as an array and gives each
// element its own MediaStream wrapper, so the two are independent. The one API that would break
// the other tile is the no-argument detach(), which detaches EVERY element; cleanup below always
// passes its own element.
function CallOverlayTile({ name, track }: CallOverlayTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      try {
        // ALWAYS with the element. track.detach() with no argument would rip the spatial tile's
        // element off this track too.
        track.detach(el);
      } catch {
        // Track already ended — clearing the element below is still the right cleanup.
      }
      el.srcObject = null;
    };
  }, [track]);

  if (!track) {
    return (
      <div className={styles.tile} data-camera="off">
        <div className={styles.placeholder} aria-hidden="true">
          {name.trim().charAt(0).toUpperCase() || "?"}
        </div>
        <span className={styles.name}>{name}</span>
      </div>
    );
  }

  return (
    <div className={styles.tile} data-camera="on">
      <video
        ref={videoRef}
        className={styles.video}
        // MUTED IS LOAD-BEARING, exactly as it is on SpatialVideoTile: remote call audio is
        // played by callStore's own hidden audio elements and must stay there. An unmuted
        // element here would double-play remote audio and feed the local mic back through the
        // speakers, and would drag video into Chrome's autoplay gate.
        muted
        playsInline
        autoPlay
      />
      <span className={styles.name}>{name}</span>
    </div>
  );
}

export default CallOverlay;
