"""Rebuild the original procedural raster pack. Requires Pillow, no remote assets."""
from pathlib import Path
import math
import random
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "dist" / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)

THEMES = {
    "dawn": ("#718dc7", "#344a7c"),
    "dusk": ("#8d8bba", "#49466f"),
    "lagoon": ("#72adba", "#2d6478"),
    "rose": ("#bd8e9c", "#77576f"),
    "night": ("#435579", "#1b2849"),
    "sand": ("#c5b498", "#8a7962"),
}
SKINS = {
    "classic": ("#ffda10", "dawn"),
    "mint": ("#a9e5ce", "lagoon"),
    "coral": ("#ff9b87", "rose"),
    "lilac": ("#c8b1ee", "dusk"),
    "midnight": ("#465473", "night"),
    "honey": ("#eeb14b", "sand"),
}


def rgb(color):
    return tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))


def gradient(size, top, bottom, grain=True, seed=1):
    width, height = size
    a, b = rgb(top), rgb(bottom)
    rng = random.Random(seed)
    image = Image.new("RGB", size)
    data = []
    for y in range(height):
        t = y / max(1, height - 1)
        row = [a[i] * (1 - t) + b[i] * t for i in range(3)]
        for x in range(width):
            noise = rng.choice((-0.6, 0, 0, 0, 0.6)) if grain else 0
            data.append(tuple(max(0, min(255, round(channel + noise))) for channel in row))
    image.putdata(data)
    return image


def texture(name, color):
    """256px textures deliberately quiet enough to remain legible on a small block."""
    image = Image.new("RGB", (256, 256), color)
    if name == "classic":
        return image
    layer = Image.new("RGBA", image.size)
    draw = ImageDraw.Draw(layer)
    rng = random.Random(93 + list(SKINS).index(name))
    if name == "mint":
        for _ in range(480):
            x, y = rng.randrange(256), rng.randrange(256)
            radius = rng.choice((0.5, 0.7, 1.1))
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(49, 115, 100, rng.randrange(12, 30)))
    elif name == "coral":
        for y in range(18, 256, 39):
            draw.line((0, y, 256, y), fill=(255, 238, 220, 40), width=2)
    elif name == "lilac":
        for x in range(256):
            alpha = int(32 * math.exp(-((x - 94) / 54) ** 2))
            draw.line((x, 0, x, 255), fill=(255, 255, 255, alpha))
        draw.line((45, 0, 45, 255), fill=(255, 255, 255, 38), width=2)
    elif name == "midnight":
        for _ in range(38):
            x, y = rng.randrange(8, 248), rng.randrange(8, 248)
            draw.ellipse((x, y, x + 1.7, y + 1.7), fill=(235, 228, 182, rng.randrange(70, 150)))
        for x, y in ((49, 54), (181, 137), (104, 219)):
            draw.line((x - 3, y, x + 3, y), fill=(244, 234, 197, 130), width=1)
            draw.line((x, y - 3, x, y + 3), fill=(244, 234, 197, 130), width=1)
    elif name == "honey":
        for row, y in enumerate(range(-20, 290, 40)):
            for x in range(-24 + (row % 2) * 24, 290, 48):
                points = [(x + 20 * math.cos(math.pi / 3 * k), y + 20 * math.sin(math.pi / 3 * k)) for k in range(6)]
                draw.line(points + [points[0]], fill=(137, 89, 27, 24), width=1)
    return Image.alpha_composite(image.convert("RGBA"), layer).convert("RGB")


def textured_face(canvas, points, skin, brightness):
    """Project a square texture onto a parallelogram with an inverse affine map."""
    p0, p1, _, p3 = points
    ax, ay = p1[0] - p0[0], p1[1] - p0[1]
    bx, by = p3[0] - p0[0], p3[1] - p0[1]
    det = ax * by - ay * bx
    scale = skin.width - 1
    coefficients = (by * scale / det, -bx * scale / det, (-by * p0[0] + bx * p0[1]) * scale / det,
                    -ay * scale / det, ax * scale / det, (ay * p0[0] - ax * p0[1]) * scale / det)
    source = ImageEnhance.Brightness(skin).enhance(brightness)
    mapped = source.transform(canvas.size, Image.Transform.AFFINE, coefficients, Image.Resampling.BICUBIC)
    mask = Image.new("L", canvas.size)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    canvas.paste(mapped, (0, 0), mask)


def block_art(name, size=(400, 280), icon=False):
    scale = 3
    width, height = size
    theme = "dawn" if icon else SKINS[name][1]
    canvas = gradient((width * scale, height * scale), *THEMES[theme], grain=False).convert("RGBA")
    # The artwork is composed in a 400×280 design space, then supersampled.
    sx, sy = width * scale / 400, height * scale / 280
    def pt(pair):
        return (round(pair[0] * sx), round(pair[1] * sy))
    shadow = Image.new("RGBA", canvas.size)
    ImageDraw.Draw(shadow).ellipse([pt((127, 214)), pt((274, 253))], fill=(13, 27, 52, 65))
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(9 * sx)))
    draw = ImageDraw.Draw(canvas)
    # One small white platform echoes the original game board.
    tile_top = [pt(p) for p in [(201, 190), (278, 229), (218, 265), (141, 226)]]
    tile_front = [tile_top[2], tile_top[3], pt((141, 234)), pt((218, 273))]
    tile_right = [tile_top[1], tile_top[2], pt((218, 273)), pt((278, 237))]
    draw.polygon(tile_front, fill="#e2e6eb", outline="#9aa4b2", width=max(1, round(1.2 * sx)))
    draw.polygon(tile_right, fill="#edf0f3", outline="#9aa4b2", width=max(1, round(1.2 * sx)))
    draw.polygon(tile_top, fill="#fbfcff", outline="#9aa4b2", width=max(1, round(1.3 * sx)))
    # 1×1×2 cuboid, oriented exactly like the little upright block on the board.
    back, right, front, left = [pt(p) for p in [(192, 35), (249, 65), (205, 97), (148, 67)]]
    bottom_front, bottom_left, bottom_right = [pt(p) for p in [(205, 234), (148, 204), (249, 202)]]
    skin = texture(name, SKINS[name][0])
    textured_face(canvas, [left, front, bottom_front, bottom_left], skin, 0.98)
    textured_face(canvas, [front, right, bottom_right, bottom_front], skin, 0.86)
    textured_face(canvas, [back, right, front, left], skin, 1.06)
    draw = ImageDraw.Draw(canvas)
    outline = {"classic": "#a18a26", "mint": "#678d80", "coral": "#bc7061", "lilac": "#8e7baa", "midnight": "#2d374e", "honey": "#a3742f"}[name]
    line_width = max(1, round(1.7 * sx))
    draw.line([back, right, bottom_right, bottom_front, bottom_left, left, back], fill=outline, width=line_width, joint="curve")
    draw.line([left, front, right], fill=outline, width=line_width, joint="curve")
    draw.line([front, bottom_front], fill=outline, width=line_width)
    def midpoint(a, b):
        return ((a[0] + b[0]) // 2, (a[1] + b[1]) // 2)
    draw.line([midpoint(left, bottom_left), midpoint(front, bottom_front), midpoint(right, bottom_right)], fill=outline, width=max(1, round(1.2 * sx)), joint="curve")
    image = canvas.resize(size, Image.Resampling.LANCZOS).convert("RGB")
    if icon:
        # Rounded PNG icon with a fully opaque centre and transparent corners.
        image = image.convert("RGBA")
        mask = Image.new("L", size)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, height - 1), radius=round(width * 0.2), fill=255)
        image.putalpha(mask)
    return image


def main():
    for index, (name, colors) in enumerate(THEMES.items()):
        gradient((600, 1100), *colors, seed=19 + index).save(ASSETS / f"{name}.webp", quality=93, method=6)
    for name, (color, _) in SKINS.items():
        texture(name, color).save(ASSETS / f"{name}.png", optimize=True)
        block_art(name).save(ASSETS / f"skin-{name}.webp", quality=95, method=6)
    # Square projection preserves the block's proportions inside the app icon.
    icon = block_art("classic")
    square = gradient((280, 280), *THEMES["dawn"], grain=False).convert("RGBA")
    square.alpha_composite(icon.convert("RGBA"), (-60, 0))
    square = square.resize((192, 192), Image.Resampling.LANCZOS)
    mask = Image.new("L", square.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 191, 191), radius=38, fill=255)
    square.putalpha(mask)
    square.save(ASSETS / "icon.png", optimize=True)
    square.resize((48, 48), Image.Resampling.LANCZOS).save(ASSETS / "favicon.png", optimize=True)
    (ASSETS / "LICENSE.txt").write_text(
        "КУБОХОД — original project assets\n\n"
        "All raster backgrounds, textures, skin previews, and app icons in this folder "
        "are original procedural artwork created for this project with scripts/create-assets.py.\n"
        "No downloaded photographs, stock illustrations, external icon sets, or remote fonts are used.\n"
        "You may use, modify, and distribute these project assets together with the game or separately.\n"
        "The interface uses the system sans-serif font installed on the player's device.\n"
        "Audio effects and optional music are synthesized locally using Web Audio.\n",
        encoding="utf-8",
    )
    print(f"Created {len(list(ASSETS.iterdir()))} original raster assets in {ASSETS}")


if __name__ == "__main__":
    main()
