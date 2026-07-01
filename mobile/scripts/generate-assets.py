#!/usr/bin/env python3
"""Generate Famlin app assets from the design palette."""

from PIL import Image, ImageDraw
import os

COLORS = {
    'coral_top': '#E07A6B',
    'coral_bottom': '#C95D4E',
    'amber': '#F2B85C',
    'cream': '#FDF8F3',
    'white': '#FFFFFF',
    'warm_black': '#2C2422',
}

def rounded_rect(draw, xy, radius, fill):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill)

def draw_logo(size, bg='gradient'):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background
    if bg == 'gradient':
        for y in range(size):
            ratio = y / size
            r = int(int(COLORS['coral_top'][1:3], 16) * (1 - ratio) + int(COLORS['coral_bottom'][1:3], 16) * ratio)
            g = int(int(COLORS['coral_top'][3:5], 16) * (1 - ratio) + int(COLORS['coral_bottom'][3:5], 16) * ratio)
            b = int(int(COLORS['coral_top'][5:7], 16) * (1 - ratio) + int(COLORS['coral_bottom'][5:7], 16) * ratio)
            draw.line([(0, y), (size, y)], fill=(r, g, b, 255))
    else:
        draw.rectangle([0, 0, size, size], fill=bg)

    s = size
    # House body
    body_w = s * 0.62
    body_h = s * 0.38
    body_x = (s - body_w) / 2
    body_y = s * 0.45
    radius = s * 0.06
    draw.rounded_rectangle(
        [body_x, body_y, body_x + body_w, body_y + body_h],
        radius=radius,
        fill=COLORS['white']
    )

    # Roof
    roof_height = s * 0.26
    roof_top = s * 0.19
    roof_points = [
        (s * 0.18, body_y),
        (s * 0.50, roof_top),
        (s * 0.82, body_y),
    ]
    draw.polygon(roof_points, fill=COLORS['white'])

    # Door
    door_w = s * 0.18
    door_h = s * 0.22
    door_x = s * 0.41
    door_y = body_y + body_h - door_h
    draw.rounded_rectangle(
        [door_x, door_y, door_x + door_w, door_y + door_h],
        radius=s * 0.03,
        fill=COLORS['coral_bottom']
    )

    # Door knob
    knob_x = door_x + door_w - s * 0.035
    knob_y = door_y + door_h * 0.55
    draw.ellipse(
        [knob_x - s*0.012, knob_y - s*0.012, knob_x + s*0.012, knob_y + s*0.012],
        fill=(255, 255, 255, 180)
    )

    # Windows
    win_w = s * 0.12
    win_h = s * 0.10
    win_y = body_y + s * 0.055
    # Left window
    draw.rounded_rectangle(
        [body_x + s * 0.055, win_y, body_x + s * 0.055 + win_w, win_y + win_h],
        radius=s * 0.02,
        fill=(255, 255, 255, 200)
    )
    # Right window
    draw.rounded_rectangle(
        [body_x + body_w - s * 0.055 - win_w, win_y, body_x + body_w - s * 0.055, win_y + win_h],
        radius=s * 0.02,
        fill=(255, 255, 255, 200)
    )

    # Heart chimney
    heart_cx = s * 0.62
    heart_cy = s * 0.34
    heart_size = s * 0.12
    draw_heart(draw, heart_cx, heart_cy, heart_size, COLORS['amber'])

    return img

def draw_heart(draw, cx, cy, size, color):
    """Draw a simple heart shape."""
    # Simplified heart as two circles + triangle
    r = size / 2
    left = (cx - r * 0.6, cy - r * 0.3)
    right = (cx + r * 0.6, cy - r * 0.3)
    draw.ellipse([left[0] - r*0.5, left[1] - r*0.5, left[0] + r*0.5, left[1] + r*0.5], fill=color)
    draw.ellipse([right[0] - r*0.5, right[1] - r*0.5, right[0] + r*0.5, right[1] + r*0.5], fill=color)
    draw.polygon([
        (cx, cy + r * 0.9),
        (cx - r * 0.9, cy - r * 0.2),
        (cx + r * 0.9, cy - r * 0.2),
    ], fill=color)

def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print(f'Generated {path}')

def main():
    assets_dir = os.path.join(os.path.dirname(__file__), '..', 'assets')
    assets_dir = os.path.abspath(assets_dir)

    # App icon
    icon = draw_logo(1024)
    save(icon, os.path.join(assets_dir, 'icon.png'))

    # Adaptive icon (same but slightly different safe zone)
    adaptive = draw_logo(1024)
    save(adaptive, os.path.join(assets_dir, 'adaptive-icon.png'))

    # Splash screen
    splash = Image.new('RGB', (1284, 2778), COLORS['cream'])
    logo = draw_logo(512)
    logo_w, logo_h = logo.size
    x = (splash.width - logo_w) // 2
    y = (splash.height - logo_h) // 2 - 200
    splash.paste(logo, (x, y), logo)
    save(splash, os.path.join(assets_dir, 'splash.png'))

    # Favicon
    favicon = draw_logo(48)
    save(favicon, os.path.join(assets_dir, 'favicon.png'))

    # Notification icon (white silhouette on transparent)
    notif = Image.new('RGBA', (96, 96), (0, 0, 0, 0))
    nd = ImageDraw.Draw(notif)
    # Simple house silhouette
    nd.polygon([(18, 48), (48, 18), (78, 48)], fill=COLORS['white'])
    nd.rounded_rectangle([22, 48, 74, 80], radius=6, fill=COLORS['white'])
    save(notif, os.path.join(assets_dir, 'notification-icon.png'))

if __name__ == '__main__':
    main()
