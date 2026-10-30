# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow"]
# ///
"""Renders the soft light-ray texture used behind the calligraphy.

White rays with the radial fade baked into alpha, so the page only rotates a
texture instead of re-masking a conic gradient every frame.

    uv run scripts/art/rays.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

SIZE = 1400
OUT = Path(__file__).resolve().parents[2] / "public" / "art" / "rays.webp"


def main() -> None:
    y, x = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    c = (SIZE - 1) / 2
    dx, dy = x - c, y - c
    r = np.hypot(dx, dy) / c
    theta = np.arctan2(dy, dx)
    # Two interleaved ray families with soft (cosine) edges and a slow
    # brightness wobble so the rays don't read as a mechanical fan.
    major = np.clip(np.cos(theta * 26), 0, 1) ** 5
    minor = 0.45 * np.clip(np.cos(theta * 26 + np.pi), 0, 1) ** 9
    wobble = 0.7 + 0.3 * np.cos(theta * 7 + 1.3) * np.cos(theta * 3)
    rays = (major + minor) * wobble
    fade = np.clip(1 - r, 0, 1) ** 1.6 * np.clip(r / 0.1, 0, 1)
    alpha = np.clip(rays * fade * 255, 0, 255).astype(np.uint8)
    # Warm white: reads as sunlight over photos and gold over the takeover.
    rgb = [np.full_like(alpha, v) for v in (255, 243, 222)]
    rgba = np.dstack(rgb + [alpha])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(OUT, "WEBP", quality=82, method=6)
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
