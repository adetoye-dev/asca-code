#!/usr/bin/env python3
"""Generate placeholder app icons (stdlib only, no Pillow).

Why this exists: `.tauri/icons/` shipped five 0-byte files and a truncated
69-byte `icon.png`, so `tauri build` failed at the bundling step with
"Format error decoding Png: IDAT or fDAT chunk does not have enough data for
image" — i.e. no bundle, and therefore no installable or updatable app.

These are deliberately generic placeholders that make the bundle succeed.
Replace them with real brand artwork before shipping to users:

    npx tauri icon path/to/brand-512x512.png --output .tauri/icons

Usage: python3 scripts/generate_placeholder_icon.py [output_dir]
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

BACKGROUND = (11, 11, 13)       # near-black, matches the app's dark theme
FOREGROUND = (229, 231, 235)    # off-white mark
SUPERSAMPLE = 3                 # 3x3 subpixel samples for smooth edges

# Rounded-square plate geometry, as fractions of the icon size.
PLATE_INSET = 0.055
PLATE_RADIUS = 0.235

# A ">" chevron: two round-capped strokes meeting at the centre.
CHEVRON = ((0.375, 0.335), (0.605, 0.5), (0.375, 0.665))
CHEVRON_WIDTH = 0.085


def _rounded_rect_contains(x: float, y: float, size: float) -> bool:
    inset = size * PLATE_INSET
    radius = size * PLATE_RADIUS
    left, top, right, bottom = inset, inset, size - inset, size - inset
    if x < left or x > right or y < top or y > bottom:
        return False
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= radius * radius


def _distance_to_segment(px, py, ax, ay, bx, by) -> float:
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    length_sq = vx * vx + vy * vy
    t = 0.0 if length_sq == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / length_sq))
    dx, dy = px - (ax + t * vx), py - (ay + t * vy)
    return (dx * dx + dy * dy) ** 0.5


def _chevreon_contains(x: float, y: float, size: float) -> bool:
    half = size * CHEVRON_WIDTH / 2
    (ax, ay), (bx, by), (cx, cy) = ((p[0] * size, p[1] * size) for p in CHEVRON)
    return (
        _distance_to_segment(x, y, ax, ay, bx, by) <= half
        or _distance_to_segment(x, y, bx, by, cx, cy) <= half
    )


def render_rgba(size: int) -> bytearray:
    """Render one square RGBA icon at `size` px with supersampled edges."""
    buf = bytearray(size * size * 4)
    step = 1.0 / SUPERSAMPLE
    offset = step / 2
    samples = SUPERSAMPLE * SUPERSAMPLE

    for py in range(size):
        for px in range(size):
            plate_hits = 0
            mark_hits = 0
            for sy in range(SUPERSAMPLE):
                fy = py + offset + sy * step
                for sx in range(SUPERSAMPLE):
                    fx = px + offset + sx * step
                    if _rounded_rect_contains(fx, fy, size):
                        plate_hits += 1
                        if _chevreon_contains(fx, fy, size):
                            mark_hits += 1

            i = (py * size + px) * 4
            if not plate_hits:
                buf[i : i + 4] = b"\x00\x00\x00\x00"
                continue

            plate_cov = plate_hits / samples
            mark_cov = mark_hits / samples
            r = BACKGROUND[0] + (FOREGROUND[0] - BACKGROUND[0]) * mark_cov
            g = BACKGROUND[1] + (FOREGROUND[1] - BACKGROUND[1]) * mark_cov
            b = BACKGROUND[2] + (FOREGROUND[2] - BACKGROUND[2]) * mark_cov
            buf[i] = int(r + 0.5)
            buf[i + 1] = int(g + 0.5)
            buf[i + 2] = int(b + 0.5)
            buf[i + 3] = int(plate_cov * 255 + 0.5)
    return buf


def write_png(path: Path, size: int, rgba: bytes) -> None:
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter type 0 (None)
        raw.extend(rgba[y * stride : (y + 1) * stride])

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> int:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".tauri/icons")
    out_dir.mkdir(parents=True, exist_ok=True)

    # Tauri requires at least one valid icon; these cover the standard set.
    for name, size in (
        ("32x32.png", 32),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
        ("icon.png", 1024),
    ):
        write_png(out_dir / name, size, render_rgba(size))
        print(f"wrote {out_dir / name} ({size}x{size})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
