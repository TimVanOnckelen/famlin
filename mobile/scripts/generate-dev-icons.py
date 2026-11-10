#!/usr/bin/env python3
"""Derive the development-variant app icons from the production ones.

The development variant (APP_VARIANT=development, see app.config.js) installs
next to the store app, so its icon has to be told apart at a glance: the
teal brand colour is rotated to orange and a "DEV" label is drawn on top.

Re-run after changing assets/icon.png or assets/adaptive-icon.png:

    python3 scripts/generate-dev-icons.py

Writes assets/icon-dev.png and assets/adaptive-icon-dev.png. Needs Pillow and
a bold sans-serif font (pass a path as the first argument if none of the
defaults below exists on your machine).
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', 'assets')

# Teal (~197°) -> orange (~27°). Pillow's HSV hue channel runs 0-255.
HUE_SHIFT = round((27 - 197) / 360 * 256) % 256

LABEL_BG = (44, 36, 34, 235)  # warm black, matches the design palette
LABEL_FG = (255, 255, 255, 255)

FONT_CANDIDATES = [
    '/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    'C:\\Windows\\Fonts\\arialbd.ttf',
]


def find_font(size):
    candidates = sys.argv[1:2] + FONT_CANDIDATES
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    sys.exit('No bold font found; pass a .ttf/.otf path as the first argument.')


def rotate_hue(img):
    alpha = img.getchannel('A')
    h, s, v = img.convert('RGB').convert('HSV').split()
    h = h.point(lambda x: (x + HUE_SHIFT) % 256)
    out = Image.merge('HSV', (h, s, v)).convert('RGB')
    out.putalpha(alpha)
    return out


def draw_label(img, center_y, font_size):
    draw = ImageDraw.Draw(img)
    font = find_font(font_size)
    text = 'DEV'
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    w, h = right - left, bottom - top
    pad_x, pad_y = font_size * 0.45, font_size * 0.25
    cx = img.width / 2
    box = [cx - w / 2 - pad_x, center_y - h / 2 - pad_y, cx + w / 2 + pad_x, center_y + h / 2 + pad_y]
    draw.rounded_rectangle(box, radius=(box[3] - box[1]) / 2, fill=LABEL_BG)
    draw.text((cx - w / 2 - left, center_y - h / 2 - top), text, font=font, fill=LABEL_FG)


def main():
    icon = rotate_hue(Image.open(os.path.join(ASSETS, 'icon.png')).convert('RGBA'))
    # Below the house, well inside iOS's rounded-corner mask.
    draw_label(icon, icon.height * 0.84, round(icon.height * 0.11))
    icon.save(os.path.join(ASSETS, 'icon-dev.png'), optimize=True)

    adaptive = rotate_hue(Image.open(os.path.join(ASSETS, 'adaptive-icon.png')).convert('RGBA'))
    # Android masks the adaptive foreground to its centre ~66%, so the label
    # sits just above the roof rather than below the house.
    draw_label(adaptive, adaptive.height * 0.235, round(adaptive.height * 0.075))
    adaptive.save(os.path.join(ASSETS, 'adaptive-icon-dev.png'), optimize=True)


if __name__ == '__main__':
    main()
