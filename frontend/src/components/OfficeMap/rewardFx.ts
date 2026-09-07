import styles from "./rewardFx.module.css";
import { applyClaim, commitStaged, stageClaim } from "../../services/quests/progressionStore";
import type { ClaimResult } from "../../services/quests/questsClient";

// Reward collection FX — lightweight DOM + requestAnimationFrame, no canvas, no physics.
//
// Sequence for a server-confirmed claim (grantedNow=true):
//   Claim button → a few 🪙 and XP icons pop outward with a short bounce → coins curve to the
//   HUD's Coins counter, XP chips curve to the HUD's XP meter → on arrival the store commits that
//   part of the confirmed balances (commitStaged), so the HUD counts up and pulses exactly when
//   the icons land. The source is the clicked control's rect; destinations are located live via
//   [data-hud-target] so the effect follows the HUD wherever it is laid out.
//
// Nothing is ever shown for grantedNow=false, and prefers-reduced-motion (or a missing HUD)
// skips straight to applyClaim: confirmed values, subtle pulse, no travel.

export const HUD_TARGET_ATTR = "data-hud-target";

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export function findHudTargets(): { coins: Element | null; xp: Element | null } {
  if (typeof document === "undefined") return { coins: null, xp: null };
  return {
    coins: document.querySelector(`[${HUD_TARGET_ATTR}="coins"]`),
    xp: document.querySelector(`[${HUD_TARGET_ATTR}="xp"]`),
  };
}

const BURST_MS = 380;
const TRAVEL_MS = 640;
const STAGGER_MS = 70;
const SAFETY_MS = 4000;

type Kind = "coins" | "xp";

interface Particle {
  el: HTMLElement;
  kind: Kind;
  sx: number; // source centre
  sy: number;
  bx: number; // burst end point
  by: number;
  dx: number; // destination centre
  dy: number;
  cx: number; // bezier control point
  cy: number;
  delay: number;
  arrived: boolean;
}

function easeOutBack(k: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}

function easeInOutCubic(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

function centre(rect: DOMRect): [number, number] {
  return [rect.left + rect.width / 2, rect.top + rect.height / 2];
}

/** How many icons to show: a handful, scaled gently with the reward, never a swarm. */
export function iconCount(kind: Kind, amount: number): number {
  if (amount <= 0) return 0;
  return kind === "coins" ? Math.min(5, 2 + Math.ceil(amount / 5)) : Math.min(4, 1 + Math.ceil(amount / 40));
}

export interface PlayOptions {
  source: DOMRect;
  coins: number;
  xp: number;
  targets: { coins: Element; xp: Element };
  onCoinsArrive: () => void;
  onXpArrive: () => void;
  /** Injectable clock/scheduler for tests. */
  now?: () => number;
  raf?: (cb: (t: number) => void) => number;
}

/** Runs the burst + travel and resolves when every icon has landed (or the safety cap hits). */
export function playRewardCollection(opts: PlayOptions): Promise<void> {
  const now = opts.now ?? (() => Date.now());
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const layer = document.createElement("div");
  layer.className = styles.layer;
  document.body.appendChild(layer);

  const [sx, sy] = centre(opts.source);
  const particles: Particle[] = [];
  const spawn = (kind: Kind, count: number, dest: Element) => {
    const [dx, dy] = centre(dest.getBoundingClientRect());
    for (let i = 0; i < count; i++) {
      const el = document.createElement("span");
      el.className = kind === "coins" ? styles.coin : styles.xp;
      el.textContent = kind === "coins" ? "🪙" : "XP";
      el.setAttribute("aria-hidden", "true");
      layer.appendChild(el);
      // Fan upward-biased around the source; coins lean left, XP right, so the two streams read
      // as separate even before they split toward their destinations.
      const base = kind === "coins" ? -115 : -65;
      const angle = ((base + (i - (count - 1) / 2) * 28 + (Math.random() - 0.5) * 12) * Math.PI) / 180;
      const dist = 30 + Math.random() * 26;
      const bx = sx + Math.cos(angle) * dist;
      const by = sy + Math.sin(angle) * dist;
      // Control point: above the straight line, so the travel arcs rather than beelines.
      const mx = (bx + dx) / 2;
      const my = (by + dy) / 2;
      const lift = 50 + Math.random() * 40;
      particles.push({ el, kind, sx, sy, bx, by, dx, dy, cx: mx, cy: my - lift, delay: i * STAGGER_MS, arrived: false });
    }
  };
  spawn("coins", iconCount("coins", opts.coins), opts.targets.coins);
  spawn("xp", iconCount("xp", opts.xp), opts.targets.xp);

  let coinsDone = particles.every((p) => p.kind !== "coins");
  let xpDone = particles.every((p) => p.kind !== "xp");
  if (coinsDone) opts.onCoinsArrive();
  if (xpDone) opts.onXpArrive();

  return new Promise<void>((resolve) => {
    const t0 = now();
    const finish = () => {
      if (!coinsDone) {
        coinsDone = true;
        opts.onCoinsArrive();
      }
      if (!xpDone) {
        xpDone = true;
        opts.onXpArrive();
      }
      layer.remove();
      resolve();
    };
    const frame = () => {
      const t = now() - t0;
      if (t > SAFETY_MS) return finish();
      let pending = 0;
      for (const p of particles) {
        if (p.arrived) continue;
        let x: number;
        let y: number;
        let scale: number;
        let opacity = 1;
        if (t < BURST_MS) {
          const k = easeOutBack(Math.min(1, t / BURST_MS));
          x = p.sx + (p.bx - p.sx) * k;
          y = p.sy + (p.by - p.sy) * k;
          scale = 0.4 + 0.6 * Math.min(1, k);
        } else {
          const kt = Math.min(1, Math.max(0, (t - BURST_MS - p.delay) / TRAVEL_MS));
          const e = easeInOutCubic(kt);
          const u = 1 - e;
          x = u * u * p.bx + 2 * u * e * p.cx + e * e * p.dx;
          y = u * u * p.by + 2 * u * e * p.cy + e * e * p.dy;
          scale = 1 - 0.45 * e;
          opacity = kt > 0.85 ? 1 - (kt - 0.85) / 0.15 : 1;
          if (kt >= 1) {
            p.arrived = true;
            p.el.remove();
            continue;
          }
        }
        pending++;
        p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
        p.el.style.opacity = opacity.toFixed(3);
      }
      if (!coinsDone && particles.filter((p) => p.kind === "coins").every((p) => p.arrived)) {
        coinsDone = true;
        opts.onCoinsArrive();
      }
      if (!xpDone && particles.filter((p) => p.kind === "xp").every((p) => p.arrived)) {
        xpDone = true;
        opts.onXpArrive();
      }
      if (pending === 0) return finish();
      raf(frame);
    };
    raf(frame);
  });
}

/** Panel entry point after POST /progression/claim resolves. `source` is the clicked Claim
 * control's rect (captured at click time). */
export async function collectReward(result: ClaimResult, source: DOMRect | null): Promise<void> {
  if (!result.grantedNow) {
    applyClaim(result);
    return;
  }
  const targets = findHudTargets();
  if (reducedMotion() || !source || !targets.coins || !targets.xp || typeof requestAnimationFrame !== "function") {
    applyClaim(result); // confirmed values, subtle destination pulse, no travel
    return;
  }
  stageClaim(result);
  await playRewardCollection({
    source,
    coins: result.reward.coins,
    xp: result.reward.xp,
    targets: { coins: targets.coins, xp: targets.xp },
    onCoinsArrive: () => commitStaged("coins"),
    onXpArrive: () => commitStaged("xp"),
  });
  commitStaged("coins"); // idempotent safety net if a callback never fired
  commitStaged("xp");
}
