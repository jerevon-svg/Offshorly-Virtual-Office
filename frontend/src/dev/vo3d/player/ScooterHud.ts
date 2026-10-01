// vo3d player — THE SCOOTER HUD: speed and boost, shown only while mounted. A compact card low and centre,
// above the dock: a half-ring gauge with the boost band marked at its top end, a normalized SPD readout, and a
// BOOST tag that lights while boost is actually driving the deck (with a quiet Shift hint when cruising
// near the top without it). Pure DOM over the canvas; it reads the ride's motion state and nothing reads it.
//
// UNITS. Not km/h: VO's movement is gameplay, not a vehicle simulation, so the readout is a normalized SPD
// where a full road cruise reads 100 — boost 127, a path's share 85, off-road 50, reverse single figures.

/** SPD per world unit per second, for a given cruise speed (cruise reads 100) */
export const spdPerUnit = (cruise: number): number => 100 / cruise;

const TEAL = "#19b3a5"; //   the shared fleet's colour (world/scooters SCOOTER_COLOUR)
const VIOLET = "#5e5ce6"; // VO's accent — boost
const INK = "#1c1a24";
/** the gauge: a half ring, radius R, drawn with a dash so the value is one attribute write */
const R = 26, ARC = Math.PI * R;

export type ScooterHudLimits = { cruise: number; boost: number };

export class ScooterHud {
  private readonly root: HTMLDivElement;
  private readonly value: SVGPathElement;
  private readonly num: HTMLSpanElement;
  private readonly unit: HTMLSpanElement;
  private readonly tag: HTMLSpanElement;
  private readonly hint: HTMLSpanElement;
  private readonly limits: ScooterHudLimits;
  /** the speed on the dial, eased so the needle moves like a needle */
  private shown = 0;
  private lastText = "";
  private lastState = "";
  private lastSurface = "";
  private readonly hintHtml: string;

  constructor(parent: HTMLElement, limits: ScooterHudLimits) {
    this.limits = limits;
    this.root = document.createElement("div");
    this.root.setAttribute("data-testid", "scooter-hud");
    this.root.style.cssText =
      "position:fixed;left:50%;bottom:calc(var(--vo3d-dock-clearance, var(--vo-dock-clearance, 104px)) + 14px);" +
      "transform:translateX(-50%);z-index:6;pointer-events:none;display:flex;align-items:center;gap:12px;" +
      "padding:9px 14px 9px 12px;border-radius:18px;background:#fdfcfa;border:1px solid rgba(24,20,34,0.07);" +
      "box-shadow:0 1px 0 rgba(255,255,255,0.8) inset,0 2px 6px rgba(28,22,45,0.06),0 14px 36px rgba(28,22,45,0.14);" +
      `font:600 12px/1 system-ui,-apple-system,"Segoe UI",sans-serif;color:${INK};user-select:none;`;
    // the gauge: track, boost band (the top of the range), value
    const boostFrom = limits.cruise / limits.boost;
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "64"); svg.setAttribute("height", "36"); svg.setAttribute("viewBox", "0 0 64 36");
    const half = `M ${32 - R} 32 A ${R} ${R} 0 0 1 ${32 + R} 32`;
    const arc = (stroke: string, width: number, dash?: string) => {
      const p = document.createElementNS(svgNS, "path");
      p.setAttribute("d", half); p.setAttribute("fill", "none"); p.setAttribute("stroke", stroke);
      p.setAttribute("stroke-width", String(width)); p.setAttribute("stroke-linecap", "round");
      if (dash) p.setAttribute("stroke-dasharray", dash);
      svg.appendChild(p);
      return p;
    };
    arc("rgba(28,22,45,0.08)", 6);
    const band = arc("rgba(94,92,230,0.28)", 6, `0 ${ARC * boostFrom} ${ARC * (1 - boostFrom)} ${ARC}`);
    band.setAttribute("stroke-linecap", "butt");
    this.value = arc(TEAL, 6, `0 ${ARC}`);
    this.value.style.transition = "stroke 160ms ease";
    // the readout
    const read = document.createElement("div");
    read.style.cssText = "display:flex;align-items:baseline;gap:4px;min-width:62px;";
    this.num = document.createElement("span");
    this.num.style.cssText = "font-size:24px;font-weight:750;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;transition:color 160ms ease;";
    this.unit = document.createElement("span");
    this.unit.style.cssText = "font-size:11px;font-weight:600;opacity:0.5;";
    this.unit.textContent = "SPD";
    read.append(this.num, this.unit);
    // the state: BOOST tag and its Shift hint
    const side = document.createElement("div");
    side.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;gap:4px;";
    this.tag = document.createElement("span");
    this.tag.style.cssText = "font-size:10px;font-weight:800;letter-spacing:0.08em;padding:3px 7px;border-radius:7px;transition:background 160ms ease,color 160ms ease,box-shadow 160ms ease;";
    this.hint = document.createElement("span");
    this.hint.style.cssText = "font-size:10px;font-weight:600;opacity:0;transition:opacity 200ms ease;white-space:nowrap;";
    this.hintHtml = `<span style="display:inline-block;padding:1px 5px;margin-right:4px;border-radius:5px;background:#fff;border:1px solid rgba(24,20,34,0.14);box-shadow:0 1px 0 rgba(24,20,34,0.12)">Shift</span>boost`;
    this.hint.innerHTML = this.hintHtml;
    side.append(this.tag, this.hint);
    this.root.append(svg, read, side);
    parent.appendChild(this.root);
    this.update(0, false, 0);
  }

  /** a frame of the ride: its signed speed (world units/s, negative = reverse) and whether boost is driving it */
  /** `surface`: the class under the deck (world/exteriorGround) — shown as Road / Path / Off-road */
  update(speed: number, boosting: boolean, dt: number, surface?: "fast" | "normal" | "slow"): void {
    this.shown += (speed - this.shown) * (dt > 0 ? Math.min(1, dt * 10) : 1);
    if (Math.abs(this.shown - speed) < 0.05) this.shown = speed;
    const abs = Math.abs(this.shown);
    const frac = Math.min(1, abs / this.limits.boost);
    this.value.setAttribute("stroke-dasharray", `${ARC * frac} ${ARC}`);
    this.value.style.opacity = frac > 0.004 ? "1" : "0"; // a round cap on a zero-length dash draws a stray dot
    const text = String(Math.round(abs * spdPerUnit(this.limits.cruise)));
    if (text !== this.lastText) { this.num.textContent = text; this.lastText = text; }
    const reverse = speed < -1;
    const hinting = !reverse && !boosting && abs >= this.limits.cruise * 0.6 && surface !== "slow";
    const state = reverse ? "rev" : boosting ? "boost" : hinting ? "cruise-hint" : "cruise";
    const surf = surface ?? "";
    if (state === this.lastState && surf === this.lastSurface) return;
    this.lastState = state;
    this.lastSurface = surf;
    this.value.setAttribute("stroke", boosting ? VIOLET : reverse ? "#9a938a" : TEAL);
    this.num.style.color = boosting ? VIOLET : INK;
    this.tag.textContent = reverse ? "REV" : "BOOST";
    this.tag.style.background = boosting ? VIOLET : reverse ? "rgba(28,22,45,0.07)" : "rgba(28,22,45,0.05)";
    this.tag.style.color = boosting ? "#fff" : "rgba(28,22,45,0.42)";
    this.tag.style.boxShadow = boosting ? "0 3px 10px rgba(94,92,230,0.35)" : "none";
    // the second line: the Shift hint while cruising near the top, otherwise what the deck is rolling on
    if (state === "cruise-hint") { this.hint.innerHTML = this.hintHtml; this.hint.style.opacity = "0.75"; this.hint.style.color = INK; }
    else if (surface) {
      this.hint.textContent = surface === "fast" ? "Road" : surface === "normal" ? "Path" : "Off-road";
      this.hint.style.opacity = "0.6";
      this.hint.style.color = surface === "slow" ? "#b8741a" : INK;
    } else this.hint.style.opacity = "0";
  }

  /** the ride's state as the card shows it — for tests and the dev panel */
  get state(): { spd: number; mode: string; surface: string } { return { spd: Number(this.lastText), mode: this.lastState, surface: this.lastSurface }; }

  dispose(): void {
    this.root.remove();
  }
}
