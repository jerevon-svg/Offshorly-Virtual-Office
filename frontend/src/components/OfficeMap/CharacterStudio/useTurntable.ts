import { useEffect, useRef, useState } from "react";

// The Profile character stage's turntable (ProfileCharacter.tsx): auto-rotate at 26°/s and drag at 0.6°/px share ONE heading,
// so a drag simply takes over mid-spin. Shared by Character Studio's CREATE and EDIT stages.
const AUTO_ROTATE_DEG_PER_SEC = 26;

export function useTurntable(enabled = true) {
  const [heading, setHeading] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const dragRef = useRef<{ x: number; heading: number } | null>(null);

  useEffect(() => {
    if (!enabled || !autoRotate) return;
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
  }, [enabled, autoRotate]);

  const handlers = {
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      dragRef.current = { x: e.clientX, heading };
      setAutoRotate(false);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      const drag = dragRef.current;
      if (!drag) return;
      setHeading(((drag.heading + (e.clientX - drag.x) * 0.6) % 360 + 360) % 360);
    },
    onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
      dragRef.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    },
  };
  return { heading, autoRotate, setAutoRotate, handlers: { ...handlers, onPointerCancel: handlers.onPointerUp } };
}
