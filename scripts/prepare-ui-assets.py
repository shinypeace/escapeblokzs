"""Split and normalize the original ImageGen UI atlas without losing transparency.

Usage: python scripts/prepare-ui-assets.py path/to/generated-atlas.png
The atlas is an original generated image: four columns, three rows, no text.
"""
from collections import deque
from pathlib import Path
import argparse
import json

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "assets" / "ui"
NAMES = ["pause", "restart", "undo", "hint", "levels", "shop", "rules", "settings", "back", "play", "star", "star-empty"]

PROMPT = """Production game UI sprite atlas, four equal columns and three equal rows,
transparent alpha. Premium minimalist console puzzle style: ivory porcelain,
rounded ceramic bevels, soft blue-grey shadows, warm gold accents, clean readable
silhouettes. No text, grid, background plates or logos. Row 1: pause bars,
clockwise restart arrow, left return undo arrow, gold lightbulb. Row 2: four
level tiles with one gold tile, open white shop box with gold cube, white rules
book with gold cube, white settings gear. Row 3: white back chevron, golden play
triangle, polished gold five-point star, matching muted blue-grey inset star.
Centered separate icons, generous padding, mild depth, upper-left lighting."""


def clean_alpha(image):
    """Remove detached generation specks, retaining the icon and anti-aliased rim."""
    rgba = np.array(image.convert("RGBA"))
    seed = rgba[:, :, 3] >= 96
    seen = np.zeros(seed.shape, dtype=bool)
    keep = np.zeros(seed.shape, dtype=np.uint8)
    height, width = seed.shape
    for y, x in zip(*np.nonzero(seed)):
        if seen[y, x]:
            continue
        queue = deque([(y, x)])
        seen[y, x] = True
        component = []
        while queue:
            cy, cx = queue.popleft()
            component.append((cy, cx))
            for ny in range(max(0, cy - 1), min(height, cy + 2)):
                for nx in range(max(0, cx - 1), min(width, cx + 2)):
                    if seed[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((ny, nx))
        if len(component) >= 650:
            ys, xs = zip(*component)
            keep[ys, xs] = 255
    rim = np.array(Image.fromarray(keep).filter(ImageFilter.MaxFilter(11)))
    rgba[:, :, 3] = np.minimum(rgba[:, :, 3], rim)
    image = Image.fromarray(rgba)
    bounds = image.getchannel("A").getbbox()
    if not bounds:
        raise ValueError("No opaque icon found")
    return image.crop(bounds)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("atlas", type=Path)
    args = parser.parse_args()
    atlas = Image.open(args.atlas).convert("RGBA")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    atlas.save(OUTPUT / "source-atlas.png", optimize=True)
    width, height = atlas.size
    sizes = {}
    for i, name in enumerate(NAMES):
        col, row = i % 4, i // 4
        cell = atlas.crop((round(col * width / 4), round(row * height / 3), round((col + 1) * width / 4), round((row + 1) * height / 3)))
        icon = clean_alpha(cell)
        icon.thumbnail((224, 224), Image.Resampling.LANCZOS)
        square = Image.new("RGBA", (256, 256))
        square.alpha_composite(icon, ((256 - icon.width) // 2, (256 - icon.height) // 2))
        square.save(OUTPUT / f"{name}.png", optimize=True)
        square.save(OUTPUT / f"{name}.webp", quality=92, method=6)
        sizes[name] = [icon.width, icon.height]
    (OUTPUT / "provenance.json").write_text(json.dumps({"generator": "OpenAI built-in image_gen", "original": "source-atlas.png", "prompt": PROMPT, "icons": sizes}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Prepared {len(NAMES)} transparent raster icons in {OUTPUT}")


if __name__ == "__main__":
    main()
