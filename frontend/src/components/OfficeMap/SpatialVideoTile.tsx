import type { AssetLayer } from "../../types/office";
import type { SpatialVideoTrack } from "../../services/call/callStore";
import { greetingAnchor } from "./panMath";
import { avatarIdForEmail } from "../../data/avatarIdentity";
import { LIVE_3D_CHARACTERS } from "../../render3d/live3dCharacters";
import { CallVideoElement } from "./CallVideoElement";
import styles from "./SpatialVideoTile.module.css";

type SpatialVideoTileProps = {
  layer: Pick<AssetLayer, "id" | "x" | "y" | "width" | "height">;
  /** A LIVE camera track. Absence of a tile — not a muted track — is how "camera off" is
   *  represented, so this is never null: callStore removes the entry instead (see its
   *  TrackMuted handler). Local and remote tracks are handled identically. */
  track: SpatialVideoTrack;
};

// Stage B: a participant's camera, floating above their avatar in the office.
//
// ANCHORING is deliberately the EXISTING mechanism, not a new one. This is a plain DOM element
// positioned as a percentage of the design frame via the same greetingAnchor() that StatusLabel
// and TalkingBubble use, rendered as a descendant of the same TransformWrapper-scaled container
// the avatars live in. That single choice gets four requirements for free:
//
//   * it follows a walking avatar, because OfficeStage anchors it off `resolved` layers, which
//     already have live characterOverrides (including peer walk positions) applied;
//   * it follows zoom, pan and window resize, because the shared transform moves it with
//     everything else — no listeners, no rAF, no measurement here;
//   * it scales in WORLD space like the nameplate does (the deliberate KeepScale removal);
//   * it never touches Three.js. Video is DOM, on purpose — see the Stage B brief.
//
// THIS COMPONENT OWNS THE VIDEO ELEMENT. callStore holds tracks, never video elements (the
// opposite of its remote-AUDIO handling, where no component renders the audio so the store owns
// those hidden elements). That split is what makes several participants work with no extra
// bookkeeping: one tile, one element, mounted and unmounted by React.
export function SpatialVideoTile({ layer, track }: SpatialVideoTileProps) {
  // Live-3D employees hang off their own measured head so the gap reads identically across the
  // cast, exactly as StatusLabel and TalkingBubble do.
  const { leftPct, topPct } = greetingAnchor(
    layer,
    LIVE_3D_CHARACTERS[avatarIdForEmail(layer.id) ?? ""]?.headTopAboveCenter,
  );

  return (
    <div className={styles.anchor} style={{ left: `${leftPct}%`, top: `${topPct}%` }}>
      {/* PHASE 7D: the element and its attach/detach lifecycle moved to CallVideoElement so V2's own
          tile is the same element rather than a copy of it. Nothing about this tile's behaviour
          changed — muted/playsInline/autoPlay and the detach-with-my-own-element rule live there now. */}
      <CallVideoElement track={track} className={styles.video} />
    </div>
  );
}

export default SpatialVideoTile;
