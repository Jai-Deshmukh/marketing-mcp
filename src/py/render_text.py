"""Renders full-canvas PNGs for captions, on-screen titles, end cards and placeholder frames.

Homebrew's ffmpeg has no text filters (no libass/freetype), so text is drawn here and
composited by ffmpeg's overlay filter. Reads a JSON spec on stdin:

{"width": 1080, "height": 1920, "style": {...}, "items": [{"kind": "caption", "text": "...", "out": "/abs.png"}]}
"""
import json
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

DEVANAGARI = re.compile(r"[ऀ-ॿ]")
SYSTEM_FONTS = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
]
DEVANAGARI_FONTS = ["/System/Library/Fonts/Kohinoor.ttc", "/System/Library/Fonts/Supplemental/DevanagariMT.ttc"]


def hex_rgb(value: str, alpha: int = 255) -> tuple:
    value = value.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), alpha)


def load_font(path, size: int, text: str) -> ImageFont.FreeTypeFont:
    candidates = DEVANAGARI_FONTS if DEVANAGARI.search(text) else ([path] if path else []) + SYSTEM_FONTS
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size)


def wrap(text: str, font, max_width: float, max_chars: int) -> list:
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if line and (font.getlength(trial) > max_width or len(trial) > max_chars):
            lines.append(line)
            line = word
        else:
            line = trial
    if line:
        lines.append(line)
    return lines


def draw_block(draw, lines, font, center_x, top, fill, stroke_fill, stroke_width, spacing):
    y = top
    for line in lines:
        w = font.getlength(line)
        draw.text((center_x - w / 2, y), line, font=font, fill=fill, stroke_width=stroke_width, stroke_fill=stroke_fill)
        y += font.size + spacing
    return y


def block_height(lines, font, spacing):
    return len(lines) * font.size + max(0, len(lines) - 1) * spacing


def render(item, width, height, style):
    kind, text = item["kind"], item.get("text", "")
    safe = style["safe_zone"]
    side = width * safe["side_pct"] / 100
    max_w = width - 2 * side
    colors = style["colors"]
    opaque = kind in ("endcard", "placeholder")
    bg = hex_rgb(colors["primary"]) if kind == "endcard" else (hex_rgb("#1E1E24") if kind == "placeholder" else (0, 0, 0, 0))
    img = Image.new("RGBA", (width, height), bg)
    draw = ImageDraw.Draw(img)
    base = min(width, height)

    if kind == "caption":
        cap = style["caption"]
        font = load_font(style["font_body"], int(base * 0.058), text)
        lines = wrap(text, font, max_w, cap["max_chars_per_line"])
        spacing = int(font.size * 0.25)
        bottom = height * (1 - safe["bottom_pct"] / 100)
        top = bottom - block_height(lines, font, spacing)
        draw_block(draw, lines, font, width / 2, top, hex_rgb(cap["color"]), hex_rgb(cap["outline"]), max(2, font.size // 12), spacing)

    elif kind == "title":
        font = load_font(style["font_heading"], int(base * 0.075), text)
        lines = wrap(text, font, max_w * 0.9, 24)
        spacing = int(font.size * 0.2)
        h = block_height(lines, font, spacing)
        top = height * (safe["top_pct"] / 100) + base * 0.06
        pad = font.size * 0.45
        widest = max(font.getlength(l) for l in lines)
        draw.rounded_rectangle(
            (width / 2 - widest / 2 - pad, top - pad * 0.7, width / 2 + widest / 2 + pad, top + h + pad),
            radius=int(pad), fill=hex_rgb(colors["accent"], 235),
        )
        draw_block(draw, lines, font, width / 2, top, hex_rgb(colors["on_accent"]), None, 0, spacing)

    elif kind == "endcard":
        y = height * 0.38
        logo = style.get("logo")
        if logo and os.path.exists(logo):
            mark = Image.open(logo).convert("RGBA")
            scale = (base * 0.45) / max(mark.size)
            mark = mark.resize((int(mark.width * scale), int(mark.height * scale)), Image.LANCZOS)
            img.alpha_composite(mark, (int(width / 2 - mark.width / 2), int(y - mark.height / 2)))
            y += mark.height / 2 + base * 0.08
        else:
            font = load_font(style["font_heading"], int(base * 0.2), "Hyv")
            y = draw_block(draw, ["Hyv"], font, width / 2, y - font.size / 2, hex_rgb(colors["on_primary"]), None, 0, 0) + base * 0.05
        if text:
            font = load_font(style["font_heading"], int(base * 0.065), text)
            lines = wrap(text, font, max_w, 28)
            draw_block(draw, lines, font, width / 2, y, hex_rgb(colors["on_primary"]), None, 0, int(font.size * 0.25))

    elif kind == "placeholder":
        font = load_font(style["font_body"], int(base * 0.045), text)
        lines = wrap(text, font, max_w, 40)
        spacing = int(font.size * 0.3)
        top = height / 2 - block_height(lines, font, spacing) / 2
        draw_block(draw, lines, font, width / 2, top, (230, 230, 230, 255), None, 0, spacing)

    else:
        raise SystemExit(f"Unknown kind: {kind}")

    img.convert("RGB").save(item["out"]) if opaque else img.save(item["out"])


def main() -> None:
    spec = json.load(sys.stdin)
    for item in spec["items"]:
        render(item, spec["width"], spec["height"], spec["style"])


if __name__ == "__main__":
    main()
