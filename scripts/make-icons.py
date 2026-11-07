# Draws the Quizzle app icons: a tilted yellow tile with a "Q" on the app's dark background.
from PIL import Image, ImageDraw, ImageFont
import sys, os

BG = (27, 27, 58)
TILE = (255, 207, 74)
INK = (27, 27, 58)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def icon(size, maskable=False):
    s = size * 4  # draw large, then shrink for smooth edges
    img = Image.new("RGBA", (s, s), BG + (255,))
    tile_size = int(s * (0.52 if maskable else 0.66))
    tile = Image.new("RGBA", (tile_size, tile_size), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    d.rounded_rectangle([0, 0, tile_size - 1, tile_size - 1], radius=int(tile_size * 0.24), fill=TILE)
    font = ImageFont.truetype(FONT, int(tile_size * 0.62))
    box = d.textbbox((0, 0), "Q", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((tile_size - w) / 2 - box[0], (tile_size - h) / 2 - box[1] - tile_size * 0.02), "Q", font=font, fill=INK)
    tile = tile.rotate(6, resample=Image.BICUBIC, expand=True)
    img.alpha_composite(tile, ((s - tile.width) // 2, (s - tile.height) // 2))
    return img.resize((size, size), Image.LANCZOS).convert("RGB")

out = sys.argv[1] if len(sys.argv) > 1 else "."
icon(192).save(os.path.join(out, "icon-192.png"))
icon(512).save(os.path.join(out, "icon-512.png"))
icon(512, maskable=True).save(os.path.join(out, "icon-maskable-512.png"))
icon(180).save(os.path.join(out, "apple-touch-icon.png"))
