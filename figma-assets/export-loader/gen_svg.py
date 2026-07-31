#!/usr/bin/env python3
"""Generates an animated (SMIL) SVG of the Export Candidates export loader,
matching Figma node 14034:71799. No JS -- animates even when loaded via <img>."""
import math

# ---- design tokens (pulled from Figma get_variable_defs) ----
DARK = "#222222"
GRAY = "#9292A1"
LINE = "#E5E9EE"
MINT = "#7BC069"
WHITE = "#FFFFFF"
PENDING_RING = "#D9D9E0"

# ---- layout (derived from Figma get_design_context coordinates) ----
W, H = 552, 465
RING_CX, RING_CY, RING_R, RING_SW = 277, 203, 48, 8
CIRC = 2 * math.pi * RING_R

STEP_ICON_X = 42
STEP_TEXT_X = 60
STEP_STATUS_X = W - 24
STEP_Y0 = 352
STEP_GAP = 40
STEPS = [
    "Gathering candidate records",
    "Formatting CSV file",
    "Preparing download",
]

# ---- timeline ----
RAMP = 4.5   # seconds, 0% -> 100%
HOLD = 1.5   # seconds holding at 100%
TOTAL = RAMP + HOLD
T_B = [0.20 * RAMP, 0.65 * RAMP, RAMP]  # active_end time per step (3 steps)


def frac(t):
    return round(t / TOTAL, 6)


def vis_anim(s, e):
    """<animate> XML toggling opacity 1 during [s, e), 0 elsewhere, looping."""
    s_f, e_f = frac(s), frac(e)
    pts = []
    if s_f <= 0:
        pts.append((0, 1))
    else:
        pts.append((0, 0))
        pts.append((s_f, 1))
    pts.append((e_f, 1))
    if e_f < 1:
        pts.append((e_f, 0))
        pts.append((1, 0))
    keyTimes = ";".join(str(p[0]) for p in pts)
    values = ";".join(str(p[1]) for p in pts)
    return (f'<animate attributeName="opacity" keyTimes="{keyTimes}" '
            f'values="{values}" dur="{TOTAL}s" begin="0s" repeatCount="indefinite" fill="freeze"/>')


def color_switch(switch_t, before, after):
    s_f = frac(switch_t)
    if s_f <= 0:
        return ""  # always `after`, no animation needed
    keyTimes = f"0;{s_f};{s_f};1"
    values = f"{before};{before};{after};{after}"
    return (f'<animate attributeName="fill" keyTimes="{keyTimes}" values="{values}" '
            f'dur="{TOTAL}s" begin="0s" repeatCount="indefinite" fill="freeze"/>')


def step_windows(i):
    pending_end = T_B[i - 1] if i > 0 else 0.0
    active_end = T_B[i]
    windows = {}
    if pending_end > 0:
        windows["pending"] = (0.0, pending_end)
    windows["active"] = (pending_end, active_end)
    windows["done"] = (active_end, TOTAL)
    return windows


def icon_pending(cx, cy):
    return f'<circle cx="{cx}" cy="{cy}" r="8" fill="none" stroke="{PENDING_RING}" stroke-width="1.5"/>'


def icon_active(cx, cy):
    return (
        f'<circle cx="{cx}" cy="{cy}" r="8" fill="{WHITE}" stroke="{MINT}" stroke-width="1.5"/>'
        f'<circle cx="{cx}" cy="{cy}" r="3" fill="{MINT}">'
        f'<animate attributeName="opacity" values="1;0.35;1" dur="0.9s" repeatCount="indefinite"/>'
        f'</circle>'
    )


def icon_done(cx, cy):
    return (
        f'<circle cx="{cx}" cy="{cy}" r="8" fill="{MINT}"/>'
        f'<path d="M {cx-4} {cy} L {cx-1.2} {cy+3.2} L {cx+4.3} {cy-3.6}" '
        f'stroke="{WHITE}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    )


def build_step(i, label):
    cy = STEP_Y0 + i * STEP_GAP
    icon_cx = STEP_ICON_X
    windows = step_windows(i)
    parts = [f'<g data-node-id="step-{i}">']

    # icon states
    icon_builders = {"pending": icon_pending, "active": icon_active, "done": icon_done}
    for state, (s, e) in windows.items():
        parts.append(f'<g>{icon_builders[state](icon_cx, cy)}{vis_anim(s, e)}</g>')

    # description text color (gray while pending, dark once active/done)
    desc_switch_t = windows.get("pending", (0, 0))[1]
    fill_anim = color_switch(desc_switch_t, GRAY, DARK)
    initial_fill = GRAY if desc_switch_t > 0 else DARK
    parts.append(
        f'<text x="{STEP_TEXT_X}" y="{cy+5}" font-family="Instrument Sans, Helvetica Neue, Arial, sans-serif" '
        f'font-size="14" fill="{initial_fill}">{label}{fill_anim}</text>'
    )

    # status label (Pending / In progress / Completed)
    status_text = {"pending": "Pending", "active": "In progress", "done": "Completed"}
    status_color = {"pending": GRAY, "active": MINT, "done": DARK}
    status_weight = {"pending": "normal", "active": "500", "done": "500"}
    for state, (s, e) in windows.items():
        parts.append(
            f'<text x="{STEP_STATUS_X}" y="{cy+5}" text-anchor="end" '
            f'font-family="Instrument Sans, Helvetica Neue, Arial, sans-serif" font-size="14" '
            f'font-weight="{status_weight[state]}" fill="{status_color[state]}" opacity="0">'
            f'{status_text[state]}{vis_anim(s, e)}</text>'
        )

    parts.append('</g>')
    return "\n".join(parts)


def build_percentage():
    parts = ['<g data-node-id="pct-counter">']
    for pct in range(0, 101):
        s = (pct / 100) * RAMP
        e = ((pct + 1) / 100) * RAMP if pct < 100 else TOTAL
        parts.append(
            f'<text x="{RING_CX}" y="{RING_CY+8}" text-anchor="middle" '
            f'font-family="Instrument Sans, Helvetica Neue, Arial, sans-serif" font-size="24" '
            f'font-weight="500" fill="{DARK}" opacity="0">{pct}%{vis_anim(s, e)}</text>'
        )
    parts.append('</g>')
    return "\n".join(parts)


def build_ring():
    return f'''
<circle cx="{RING_CX}" cy="{RING_CY}" r="{RING_R}" fill="none" stroke="{LINE}" stroke-width="{RING_SW}"/>
<circle cx="{RING_CX}" cy="{RING_CY}" r="{RING_R}" fill="none" stroke="{MINT}" stroke-width="{RING_SW}"
  stroke-linecap="round" stroke-dasharray="{CIRC:.3f}"
  transform="rotate(-90 {RING_CX} {RING_CY})">
  <animate attributeName="stroke-dashoffset"
    keyTimes="0;{frac(RAMP)};1" values="{CIRC:.3f};0;0"
    dur="{TOTAL}s" begin="0s" repeatCount="indefinite" fill="freeze"/>
</circle>'''


def build_svg():
    steps_svg = "\n".join(build_step(i, label) for i, label in enumerate(STEPS))
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<defs>
  <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="4" stdDeviation="10" flood-color="#1a1a2e" flood-opacity="0.10"/>
  </filter>
  <clipPath id="cardClip"><rect x="0.5" y="0.5" width="{W-1}" height="{H-1}" rx="16"/></clipPath>
</defs>

<g filter="url(#cardShadow)">
  <rect x="0.5" y="0.5" width="{W-1}" height="{H-1}" rx="16" fill="{WHITE}" stroke="{LINE}"/>

  <g clip-path="url(#cardClip)">
    <text x="24" y="40" font-family="Source Serif 4, Georgia, serif" font-size="21" font-weight="500"
      fill="{DARK}" letter-spacing="-0.4">Export Candidates</text>

    <text x="24" y="76" font-family="Instrument Sans, Helvetica Neue, Arial, sans-serif" font-size="16"
      font-weight="500" fill="{DARK}">Preparing your export</text>
    <text x="24" y="98" font-family="Instrument Sans, Helvetica Neue, Arial, sans-serif" font-size="14"
      fill="{GRAY}">Please wait while we generate your candidate export</text>

    <!-- close icon -->
    <g stroke="{DARK}" stroke-width="1.4" stroke-linecap="round">
      <line x1="{W-36}" y1="24" x2="{W-24}" y2="36"/>
      <line x1="{W-24}" y1="24" x2="{W-36}" y2="36"/>
    </g>

    {build_ring()}
    {build_percentage()}

    <text x="{RING_CX}" y="270" text-anchor="middle" font-family="Instrument Sans, Helvetica Neue, Arial, sans-serif"
      font-size="14" font-weight="500" fill="{DARK}">candidates_export_2026_31_07.csv</text>
    <text x="{RING_CX}" y="290" text-anchor="middle" font-family="Instrument Sans, Helvetica Neue, Arial, sans-serif"
      font-size="14" fill="{GRAY}">5.2 MB</text>

    <line x1="24" y1="319.5" x2="{W-24}" y2="319.5" stroke="{LINE}"/>

    {steps_svg}
  </g>
</g>
</svg>'''
    return svg


if __name__ == "__main__":
    out = build_svg()
    path = "/Users/lekoffshorly/Documents/AI Agents/figma-assets/export-loader/export_loader.svg"
    with open(path, "w") as f:
        f.write(out)
    print(f"wrote {path} ({len(out)} bytes)")
