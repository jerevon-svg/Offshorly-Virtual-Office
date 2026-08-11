import { FRAME_HEIGHT, FRAME_WIDTH, officeAssetLayers } from "../../data/office-layout";
import type { Phase } from "../../data/officePhase";
import styles from "./OfficeStage.module.css";

// Same manifest-px -> stage-% conversion OfficeStage.tsx uses for every
// layer — reused here instead of inventing a second convention.
function rectStyle(x: number, y: number, width: number, height: number) {
  return {
    left: `${(x / FRAME_WIDTH) * 100}%`,
    top: `${(y / FRAME_HEIGHT) * 100}%`,
    width: `${(width / FRAME_WIDTH) * 100}%`,
    height: `${(height / FRAME_HEIGHT) * 100}%`,
  };
}

const GLOW_ROOM_IDS = ["reception-room", "central-hub", "gaming-room"] as const;

type OfficePhaseOverlayProps = {
  phase: Phase;
};

export function OfficePhaseOverlay({ phase }: OfficePhaseOverlayProps) {
  const sidewalk = officeAssetLayers.find((l) => l.id === "sidewalk");
  const glowRooms = GLOW_ROOM_IDS.map((id) => officeAssetLayers.find((l) => l.id === id)).filter(
    (l): l is NonNullable<typeof l> => Boolean(l),
  );

  return (
    <div className={styles.phaseOverlay}>
      <div className={`${styles.phaseTint} ${styles.phaseMorning} ${phase === "morning" ? styles.phaseActive : ""}`} />
      <div className={`${styles.phaseTint} ${styles.phaseDay} ${phase === "day" ? styles.phaseActive : ""}`} />
      <div className={`${styles.phaseTint} ${styles.phaseSunset} ${phase === "sunset" ? styles.phaseActive : ""}`} />
      <div className={`${styles.phaseTint} ${styles.phaseNight} ${phase === "night" ? styles.phaseActive : ""}`} />

      {sidewalk && (
        <div
          className={`${styles.sidewalkNightDarken} ${phase === "night" ? styles.phaseActive : ""}`}
          style={rectStyle(sidewalk.x, sidewalk.y, sidewalk.width, sidewalk.height)}
        />
      )}

      {glowRooms.map((room) => (
        <div
          key={room.id}
          className={`${styles.nightGlow} ${
            room.id === "gaming-room" ? styles.nightGlowGaming : styles.nightGlowWarm
          } ${phase === "night" ? styles.phaseActive : ""}`}
          style={rectStyle(room.x, room.y, room.width, room.height)}
        />
      ))}
    </div>
  );
}

export default OfficePhaseOverlay;
