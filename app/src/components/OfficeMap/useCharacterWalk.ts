import { useEffect, useRef, useState } from "react";
import type { WalkDirection } from "../../data/bonWalkFrames";

type Pt = { x: number; y: number };

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function useCharacterWalk(initial: Pt) {
  const [pos, setPos] = useState(initial);
  const [isWalking, setIsWalking] = useState(false);
  const [isPatting, setIsPatting] = useState(false);
  const [direction, setDirection] = useState<WalkDirection>("front");
  const [frameIndex, setFrameIndex] = useState<0 | 1>(0);
  const dirRef = useRef<WalkDirection>("front");
  const rafRef = useRef<number | undefined>(undefined);
  const posRef = useRef(initial);
  const distSinceToggleRef = useRef(0);
  const lastFrameDRef = useRef(0);
  const patIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const patTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const STRIDE_PX = 14;

  const PAT_TOGGLE_MS = 240;
  const PAT_DURATION_MS = 1100;

  function playPat(onDone?: () => void) {
    if (patIntervalRef.current) clearInterval(patIntervalRef.current);
    if (patTimeoutRef.current) clearTimeout(patTimeoutRef.current);

    setIsPatting(true);
    setFrameIndex(0);

    patIntervalRef.current = setInterval(() => {
      setFrameIndex((f) => (f === 0 ? 1 : 0));
    }, PAT_TOGGLE_MS);

    patTimeoutRef.current = setTimeout(() => {
      if (patIntervalRef.current) clearInterval(patIntervalRef.current);
      patIntervalRef.current = undefined;
      patTimeoutRef.current = undefined;
      setIsPatting(false);
      setFrameIndex(0);
      onDone?.();
    }, PAT_DURATION_MS);
  }

  function walkTo(input: Pt | Pt[], onArrive?: () => void) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const path = Array.isArray(input) ? input : [input];
    const points = [posRef.current, ...path];

    // Precompute per-segment length + cumulative distance table.
    const segLens: number[] = [];
    const cumDist: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      segLens.push(len);
      cumDist.push(cumDist[i - 1] + len);
    }
    const totalDist = cumDist[cumDist.length - 1];

    if (totalDist === 0) {
      setIsWalking(false);
      onArrive?.();
      return;
    }

    const dur = Math.min(3500, Math.max(500, totalDist * 3.4));
    const t0 = performance.now();
    setIsWalking(true);
    setFrameIndex(0);
    distSinceToggleRef.current = 0;
    lastFrameDRef.current = 0;

    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const d = ease(t) * totalDist;

      // Find which segment this cumulative distance falls into.
      let segIdx = segLens.length - 1;
      for (let i = 0; i < segLens.length; i++) {
        if (d <= cumDist[i + 1] || i === segLens.length - 1) {
          segIdx = i;
          break;
        }
      }
      const segStart = points[segIdx];
      const segEnd = points[segIdx + 1];
      const segLen = segLens[segIdx];
      const segProgress = segLen === 0 ? 1 : (d - cumDist[segIdx]) / segLen;
      const clamped = Math.min(1, Math.max(0, segProgress));
      const next = {
        x: segStart.x + (segEnd.x - segStart.x) * clamped,
        y: segStart.y + (segEnd.y - segStart.y) * clamped,
      };
      posRef.current = next;
      setPos(next);

      // Distance-accumulated frame toggle: tie stride swap to ground distance
      // covered (arc-length d), not wall-clock time, so cadence matches the
      // eased velocity curve — slow near start/end, faster mid-walk.
      const frameDelta = d - lastFrameDRef.current;
      lastFrameDRef.current = d;
      distSinceToggleRef.current += frameDelta;
      if (distSinceToggleRef.current >= STRIDE_PX) {
        distSinceToggleRef.current -= STRIDE_PX;
        setFrameIndex((f) => (f === 0 ? 1 : 0));
      }

      const ddx = segEnd.x - segStart.x;
      const ddy = segEnd.y - segStart.y;
      if (ddx !== 0 || ddy !== 0) {
        const dir: WalkDirection =
          Math.abs(ddx) > Math.abs(ddy)
            ? ddx > 0
              ? "right"
              : "left"
            : ddy > 0
              ? "front"
              : "back"; // y grows downward → +dy = facing viewer = "front"
        if (dir !== dirRef.current) {
          dirRef.current = dir;
          setDirection(dir);
        }
      }

      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setIsWalking(false);
        onArrive?.();
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }

  // Aborts an in-progress walk: stops the rAF loop where bon currently stands,
  // clears isWalking, and does NOT call the pending walkTo's onArrive.
  function cancel() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
    setIsWalking(false);
  }

  // Debug-only escape hatch: hard-snaps position back to a given point
  // (e.g. the manifest spawn coords), cancelling any in-flight walk/pat
  // first. Not part of the normal walk API — used by the checkout debug
  // panel's full-reset action.
  function resetPos(p: Pt) {
    cancel();
    if (patIntervalRef.current) clearInterval(patIntervalRef.current);
    if (patTimeoutRef.current) clearTimeout(patTimeoutRef.current);
    patIntervalRef.current = undefined;
    patTimeoutRef.current = undefined;
    setIsPatting(false);
    setFrameIndex(0);
    posRef.current = p;
    setPos(p);
  }

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (patIntervalRef.current) clearInterval(patIntervalRef.current);
    if (patTimeoutRef.current) clearTimeout(patTimeoutRef.current);
  }, []);

  return { pos, isWalking, isPatting, direction, frameIndex, walkTo, playPat, cancel, resetPos };
}
