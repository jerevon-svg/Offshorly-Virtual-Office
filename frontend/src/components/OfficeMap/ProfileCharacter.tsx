import { useEffect, useRef, useState } from "react";
import styles from "./ProfileCharacter.module.css";
import { CharacterCanvas } from "../../render3d/CharacterCanvas";
import { LIVE_3D_CHARACTERS, isLive3dEligible, resolveWidthCapacity } from "../../render3d/live3dCharacters";
import { avatarIdForEmail } from "../../data/avatarIdentity";

// CHARACTER — the profile's showcase tab.
//
// This renders the person's REAL live-3D model through the existing CharacterCanvas: same GLB,
// same shared WebGL renderer, same six animation clips. Nothing about the avatar pipeline is
// rebuilt or forked here — this component only supplies a heading (drag / auto-rotate) and the
// existing animation flags, and dresses the result in a studio.
//
// The pose buttons map onto clips that ALREADY exist in the rig, via the flags
// resolveCharacterAnimState() reads (see characterAnimationState.ts). There is deliberately no
// "Wave": the rig has no wave clip, and inventing a label for a clip that does not exist would
// show the wrong animation.
type Pose = "idle" | "agree" | "listening" | "walking";

const POSES: ReadonlyArray<{ id: Pose; label: string }> = [
  { id: "idle", label: "Idle" },
  { id: "agree", label: "Agree" },
  { id: "listening", label: "Listen" },
  { id: "walking", label: "Walk" },
];

/** Pose -> the existing CharacterCanvas flags that resolve to that clip. No new rig API. */
function flagsFor(pose: Pose): {
  isWalking: boolean;
  isSpatialConversation: boolean;
  isTyping: boolean;
} {
  return {
    isWalking: pose === "walking",
    isSpatialConversation: pose === "agree" || pose === "listening",
    isTyping: pose === "agree",
  };
}

const AUTO_ROTATE_DEG_PER_SEC = 26;

export interface ProfileCharacterProps {
  email: string;
  /** Falls back to the viewer's 2D portrait when this person has no live-3D model. */
  fallbackSrc: string;
  name: string;
}

export function ProfileCharacter({ email, fallbackSrc, name }: ProfileCharacterProps) {
  const avatarId = avatarIdForEmail(email);
  const eligible = isLive3dEligible(avatarId);
  const asset = eligible && avatarId ? LIVE_3D_CHARACTERS[avatarId] : undefined;

  const [pose, setPose] = useState<Pose>("idle");
  const [heading, setHeading] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [failed, setFailed] = useState(false);
  const dragRef = useRef<{ x: number; heading: number } | null>(null);

  // Auto-rotate ticks the same `headingDegrees` prop a drag writes, so the two share one source
  // of truth and a drag simply takes over mid-spin.
  useEffect(() => {
    if (!autoRotate || failed) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setHeading((h) => (h + AUTO_ROTATE_DEG_PER_SEC * dt) % 360);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoRotate, failed]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = { x: e.clientX, heading };
    setAutoRotate(false);
    // Optional-chained: pointer capture is an enhancement (it keeps a fast drag from escaping the
    // stage), never a requirement, and is absent in some environments.
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    // 0.6°/px reads as a natural turntable at this stage size.
    setHeading(((drag.heading + (e.clientX - drag.x) * 0.6) % 360 + 360) % 360);
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  const live = Boolean(asset) && !failed;

  return (
    <div className={styles.wrap} data-testid="profile-character">
      <header className={styles.head}>
        <h3 className={styles.title}>Your character</h3>
        <p className={styles.subtitle}>A little you, in the office.</p>
      </header>

      <div
        className={styles.stage}
        onPointerDown={live ? onPointerDown : undefined}
        onPointerMove={live ? onPointerMove : undefined}
        onPointerUp={live ? endDrag : undefined}
        onPointerCancel={live ? endDrag : undefined}
        data-live={live ? "true" : "false"}
      >
        <div className={styles.model}>
          {live && asset ? (
            <CharacterCanvas
              glbUrl={asset.glbUrl}
              width={360}
              height={420}
              maxQuality
              widthScale={resolveWidthCapacity(asset)}
              headingDegrees={heading}
              onError={() => setFailed(true)}
              {...flagsFor(pose)}
            />
          ) : (
            // No live-3D model for this person (or the GLB failed): the existing 2D portrait,
            // exactly what the rest of the profile already shows.
            <img className={styles.fallback} src={fallbackSrc} alt={`${name}'s character`} />
          )}
        </div>
      </div>

      {live && (
        <>
          <div className={styles.controls}>
            <div className={styles.poses} role="group" aria-label="Character pose">
              {POSES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={pose === p.id ? `${styles.pose} ${styles.poseActive}` : styles.pose}
                  aria-pressed={pose === p.id}
                  onClick={() => setPose(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <span className={styles.divider} aria-hidden="true" />

            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={autoRotate}
                onChange={(e) => setAutoRotate(e.target.checked)}
                aria-label="Auto-rotate"
              />
              <span className={styles.track} aria-hidden="true">
                <span className={styles.knob} />
              </span>
              <span className={styles.toggleLabel}>Auto-rotate</span>
            </label>

            <button
              type="button"
              className={styles.reset}
              onClick={() => {
                setHeading(0);
                setAutoRotate(false);
              }}
              aria-label="Reset rotation"
            >
              <span aria-hidden="true">⟲</span>
            </button>
          </div>
          <p className={styles.hint}>Drag to rotate</p>
        </>
      )}
    </div>
  );
}

export default ProfileCharacter;
