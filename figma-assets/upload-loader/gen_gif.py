#!/usr/bin/env python3
"""Renders the same upload-loader animation as gen_svg.py to a raster GIF,
frame by frame with Pillow (no browser/cairo dependency needed)."""
import math
from PIL import Image, ImageDraw, ImageFont

from gen_svg import (
    DARK, GRAY, LINE, MINT, WHITE, PENDING_RING,
    W, H_TOP, FOOTER_H, H,
    RING_CX, RING_CY, RING_R, RING_SW,
    STEP_ICON_X, STEP_TEXT_X, STEP_STATUS_X, STEP_Y0, STEP_GAP, STEPS,
    T_B, RAMP, HOLD, TOTAL,
)

SCALE = 3  # supersample factor for anti-aliasing
FONT_DIR = "/System/Library/Fonts/Supplemental/"
SERIF = ImageFont.truetype(FONT_DIR + "Georgia.ttf", 21 * SCALE)
SANS_14 = ImageFont.truetype(FONT_DIR + "Arial.ttf", 14 * SCALE)
SANS_14_MED = ImageFont.truetype(FONT_DIR + "Arial Bold.ttf", 14 * SCALE)
SANS_16_MED = ImageFont.truetype(FONT_DIR + "Arial Bold.ttf", 16 * SCALE)
SANS_24_MED = ImageFont.truetype(FONT_DIR + "Arial Bold.ttf", 24 * SCALE)
SANS_12 = ImageFont.truetype(FONT_DIR + "Arial.ttf", 12 * SCALE)


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def s(v):
    return v * SCALE


def rounded_rect_mask(size, radius):
    mask = Image.new("L", size, 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size[0]-1, size[1]-1], radius=radius, fill=255)
    return mask


def text_center(d, xy, text, font, fill, anchor="mm"):
    d.text(xy, text, font=font, fill=hex2rgb(fill), anchor=anchor)


def step_state(i, t):
    pending_end = T_B[i - 1] if i > 0 else 0.0
    active_end = T_B[i]
    if t < pending_end:
        return "pending"
    if t < active_end:
        return "active"
    return "done"


def draw_icon(d, cx, cy, state, t):
    r = s(8)
    if state == "pending":
        d.ellipse([cx-r, cy-r, cx+r, cy+r], outline=hex2rgb(PENDING_RING), width=max(1, int(s(1.5))))
    elif state == "active":
        d.ellipse([cx-r, cy-r, cx+r, cy+r], outline=hex2rgb(MINT), fill=hex2rgb(WHITE), width=max(1, int(s(1.5))))
        pulse = 0.35 + 0.65 * (0.5 + 0.5 * math.sin(2 * math.pi * (t % 0.9) / 0.9))
        dot_r = s(3)
        alpha = int(255 * pulse)
        d.ellipse([cx-dot_r, cy-dot_r, cx+dot_r, cy+dot_r], fill=hex2rgb(MINT) + (alpha,))
    else:  # done
        d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=hex2rgb(MINT))
        d.line([(cx-s(4), cy), (cx-s(1.2), cy+s(3.2)), (cx+s(4.3), cy-s(3.6))],
               fill=hex2rgb(WHITE), width=max(1, int(s(1.6))), joint="curve")


def render_frame(t, pct):
    size = (s(W), s(H))
    base = Image.new("RGBA", size, (0, 0, 0, 0))

    # card shadow (very soft) then white card
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([s(0), s(6), s(W), s(H)+s(6)], radius=int(s(16)), fill=(26, 26, 46, 26))
    shadow = shadow.filter(__import__("PIL.ImageFilter", fromlist=["GaussianBlur"]).GaussianBlur(s(6)))
    base.alpha_composite(shadow)

    card = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([s(0.5), s(0.5), s(W-0.5), s(H-0.5)], radius=int(s(16)),
                         fill=hex2rgb(WHITE) + (255,), outline=hex2rgb(LINE), width=max(1, int(s(1))))

    # header text
    d.text((s(24), s(29)), "Import Candidates", font=SERIF, fill=hex2rgb(DARK), anchor="lm")
    d.text((s(24), s(68)), "Uploading your file...", font=SANS_16_MED, fill=hex2rgb(DARK), anchor="lm")
    d.text((s(24), s(91)), "Please don’t close this window. This may take a few moments.",
           font=SANS_14, fill=hex2rgb(GRAY), anchor="lm")

    # close icon
    x0, y0, x1, y1 = s(W-36), s(24), s(W-24), s(36)
    d.line([(x0, y0), (x1, y1)], fill=hex2rgb(DARK), width=max(1, int(s(1.4))))
    d.line([(x1, y0), (x0, y1)], fill=hex2rgb(DARK), width=max(1, int(s(1.4))))

    # ring
    cx, cy, r, sw = s(RING_CX), s(RING_CY), s(RING_R), s(RING_SW)
    d.ellipse([cx-r, cy-r, cx+r, cy+r], outline=hex2rgb(LINE), width=int(sw))
    start_angle = -90
    end_angle = -90 + 360 * (pct / 100)
    if pct > 0:
        d.arc([cx-r, cy-r, cx+r, cy+r], start=start_angle, end=end_angle, fill=hex2rgb(MINT), width=int(sw))
        # rounded cap dots at both ends of the arc
        for ang in (start_angle, end_angle):
            rad = math.radians(ang)
            px, py = cx + r * math.cos(rad), cy + r * math.sin(rad)
            cr = sw / 2
            d.ellipse([px-cr, py-cr, px+cr, py+cr], fill=hex2rgb(MINT))

    text_center(d, (cx, cy + s(2)), f"{pct}%", SANS_24_MED, DARK)

    d.text((s(RING_CX), s(263)), "candidate_import_new.csv", font=SANS_14_MED, fill=hex2rgb(DARK), anchor="mm")
    d.text((s(RING_CX), s(284)), "4.8 MB", font=SANS_14, fill=hex2rgb(GRAY), anchor="mm")

    d.line([(s(24), s(319.5)), (s(W-24), s(319.5))], fill=hex2rgb(LINE), width=max(1, int(s(1))))

    for i, label in enumerate(STEPS):
        row_y = s(STEP_Y0 + i * STEP_GAP)
        state = step_state(i, t)
        draw_icon(d, s(STEP_ICON_X), row_y, state, t)
        desc_color = GRAY if state == "pending" else DARK
        d.text((s(STEP_TEXT_X), row_y), label, font=SANS_14, fill=hex2rgb(desc_color), anchor="lm")
        status_text = {"pending": "Pending", "active": "In progress", "done": "Completed"}[state]
        status_color = {"pending": GRAY, "active": MINT, "done": DARK}[state]
        status_font = SANS_14 if state == "pending" else SANS_14_MED
        d.text((s(STEP_STATUS_X), row_y), status_text, font=status_font, fill=hex2rgb(status_color), anchor="rm")

    d.line([(0, s(H_TOP)), (s(W), s(H_TOP))], fill=hex2rgb(LINE), width=max(1, int(s(1))))
    d.ellipse([s(24), s(H_TOP+25), s(42), s(H_TOP+43)], outline=hex2rgb(GRAY), width=max(1, int(s(1.4))))
    d.text((s(33), s(H_TOP+34)), "?", font=SANS_12, fill=hex2rgb(GRAY), anchor="mm")
    d.text((s(52), s(H_TOP+34)), "Need help? Check our ", font=SANS_14, fill=hex2rgb(DARK), anchor="lm")
    w_prefix = d.textlength("Need help? Check our ", font=SANS_14)
    d.text((s(52) + w_prefix, s(H_TOP+34)), "import guide", font=SANS_14_MED, fill=hex2rgb(MINT), anchor="lm")

    base.alpha_composite(card)
    base = base.resize((W * 2, H * 2), Image.LANCZOS)  # keep some supersampling headroom, then final downsize
    base = base.resize((W, H), Image.LANCZOS)
    return base


def build_gif(path):
    frames = []
    durations = []
    step_pct = 2   # every 2% during ramp keeps file size sane
    frame_ms = 90  # 4.5s ramp / 50 steps
    for pct in range(0, 101, step_pct):
        t = (pct / 100) * RAMP
        frames.append(render_frame(t, pct))
        durations.append(frame_ms)
    # hold at 100%
    frames.append(render_frame(RAMP + 0.01, 100))
    durations.append(1500)

    bg = Image.new("RGBA", frames[0].size, (255, 255, 255, 255))
    rgba_frames = [Image.alpha_composite(bg, f).convert("RGB") for f in frames]

    # shared/global palette across all frames so GIF optimize can diff regions instead
    # of storing a full local color table + full frame every time
    ref = rgba_frames[len(rgba_frames) // 2].quantize(colors=200, method=Image.MEDIANCUT)
    pal_frames = [f.quantize(palette=ref, dither=Image.FLOYDSTEINBERG) for f in rgba_frames]

    pal_frames[0].save(
        path, save_all=True, append_images=pal_frames[1:], duration=durations,
        loop=0, optimize=True, disposal=1,
    )


if __name__ == "__main__":
    out = "/Users/lekoffshorly/Documents/AI Agents/figma-assets/upload-loader/upload_loader.gif"
    build_gif(out)
    import os
    print(f"wrote {out} ({os.path.getsize(out)} bytes)")
