#!/usr/bin/env python3
"""Tile the sixteen scene renders into one sheet, so the palettes are judged by eye rather than
by description. Needs Pillow; no other dependency.

Usage: scene_sheet.py <dir-of-season-phase.png> <out.png>

Each tile is cropped to the picture band. The readout below it is identical in every scene - that is
the point of the design - so including it would quadruple the sheet without showing anything new.
"""
import hashlib
import os
import sys

from PIL import Image, ImageDraw, ImageFont

SEASONS = ["winter", "spring", "summer", "autumn"]
PHASES = ["night", "dawn", "day", "dusk"]
TILE_W = 300
LABEL_W = 74
LABEL_H = 26
BG = (14, 14, 16)


def font(size):
    for path in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
    return ImageFont.load_default()


def rendered(path, thresh=12):
    """True when the file holds an actual picture rather than the black of a failed capture."""
    try:
        im = Image.open(path).convert("L")
    except OSError:
        return False
    hist = im.crop((0, 0, im.width, round(im.height * 0.56))).histogram()  # "L" mode: 256 buckets
    return any(hist[thresh:])


def check(name, band, seen):
    """Catch a failed capture rather than publishing a sheet with holes in it.

    A blank page and a raced screenshot both come out either uniformly dark or as a byte-for-byte
    copy of a scene that did render, and since every one of the sixteen palettes differs, two
    identical tiles can only mean one of them is not the scene it claims to be.
    """
    if not any(band.convert("L").histogram()[12:]):
        raise SystemExit(f"{name}: the render is black - the capture raced or the page never painted")
    digest = hashlib.sha256(band.tobytes()).hexdigest()
    if digest in seen:
        raise SystemExit(f"{name}: identical to {seen[digest]} - the screenshot captured the wrong scene")
    seen[digest] = name


def main(src, out):
    tiles = {}
    seen = {}
    for season in SEASONS:
        for phase in PHASES:
            path = os.path.join(src, f"{season}-{phase}.png")
            img = Image.open(path).convert("RGB")
            band = img.crop((0, 0, img.width, round(img.height * 0.56)))  # the picture band
            check(f"{season}.{phase}", band, seen)
            tiles[(season, phase)] = band.resize(
                (TILE_W, round(TILE_W * band.height / band.width)),
                getattr(Image, "Resampling", Image).NEAREST,  # PIL < 9.1 keeps the enum on Image
            )

    tile_h = max(t.height for t in tiles.values())
    sheet = Image.new("RGB", (LABEL_W + TILE_W * len(SEASONS), LABEL_H + tile_h * len(PHASES)), BG)
    draw = ImageDraw.Draw(sheet)
    seasons_font = font(15)
    phase_font = font(13)

    for col, season in enumerate(SEASONS):
        draw.text((LABEL_W + col * TILE_W + 6, 6), season, fill=(220, 220, 225), font=seasons_font)
    for row, phase in enumerate(PHASES):
        y = LABEL_H + row * tile_h
        draw.text((6, y + tile_h // 2 - 8), phase, fill=(190, 190, 198), font=phase_font)
        for col, season in enumerate(SEASONS):
            sheet.paste(tiles[(season, phase)], (LABEL_W + col * TILE_W, y))

    sheet.save(out)
    print(f"{out}  {sheet.width}x{sheet.height}")


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--check":
        # Used by scene-sheet.sh after every launch: a headless capture occasionally comes back black
        # (a cold start, or a screenshot taken before the canvas reached the compositor) and re-running
        # it is cheaper than debugging a sheet with holes in it.
        sys.exit(0 if rendered(sys.argv[2]) else 1)
    main(sys.argv[1], sys.argv[2])
