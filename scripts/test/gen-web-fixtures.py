#!/usr/bin/env python3
"""Regenerate the web-e2e fixtures in /tmp/op-e2e/cli/in (wiped with /tmp).

Pillow builds the images; the release CLI then makes the HEIC/QOI
fixtures and the PDF fixtures (see the shell commands at the end).
The minimal PSD is hand-built bytes (this Pillow cannot save PSD);
its only job is signature detection (8BPS) + an honest
detection-only result.
"""
import os
import random
import struct

from PIL import Image, ImageDraw

IN = "/tmp/op-e2e/cli/in"
os.makedirs(IN, exist_ok=True)
random.seed(42)

# rgba.png — 256x192 RGBA gradient + shapes (the workhorse fixture)
img = Image.new("RGBA", (256, 192))
px = img.load()
for y in range(192):
    for x in range(256):
        px[x, y] = (x % 256, y % 256, (x * y) % 256, 255)
d = ImageDraw.Draw(img)
d.rectangle([20, 20, 120, 90], fill=(255, 0, 0, 255))
d.ellipse([140, 60, 230, 160], fill=(0, 0, 255, 128))
img.save(f"{IN}/rgba.png")

# photo.jpg — 1024x768 noisy photo-like image (for ICO resize + resize e2e)
photo = Image.new("RGB", (1024, 768))
pp = photo.load()
for y in range(768):
    for x in range(1024):
        pp[x, y] = (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))
photo.save(f"{IN}/photo.jpg", quality=92)

# lying.jpg — PNG bytes with a .jpg name (signature must win)
with open(f"{IN}/rgba.png", "rb") as f:
    data = f.read()
with open(f"{IN}/lying.jpg", "wb") as f:
    f.write(data)

# multi.tiff — 3-page TIFF
frames = []
for i, color in enumerate([(255, 0, 0), (0, 255, 0), (0, 0, 255)]):
    fr = Image.new("RGB", (128, 96), color)
    ImageDraw.Draw(fr).text((10, 10), f"page {i + 1}")
    frames.append(fr)
frames[0].save(f"{IN}/multi.tiff", save_all=True, append_images=frames[1:])

# checker-64.png — 64x64 checkerboard (HEIC source)
chk = Image.new("RGB", (64, 64))
cp = chk.load()
for y in range(64):
    for x in range(64):
        cp[x, y] = (255, 255, 255) if (x // 8 + y // 8) % 2 == 0 else (0, 0, 0)
chk.save(f"{IN}/checker-64.png")

# anim.gif — 2-frame animated GIF
g1 = Image.new("P", (64, 64))
g1.putpalette([255, 0, 0, 0, 255, 0] + [0, 0, 0] * 254)
g2 = Image.new("P", (64, 64))
g2.putpalette([255, 0, 0, 0, 255, 0] + [0, 0, 0] * 254)
for y in range(64):
    for x in range(64):
        g1.putpixel((x, y), 0 if x < 32 else 1)
        g2.putpixel((x, y), 1 if x < 32 else 0)
g1.save(f"{IN}/anim.gif", save_all=True, append_images=[g2], duration=200, loop=0)

# notes.txt — unsupported file for the batch skip check
with open(f"{IN}/notes.txt", "w") as f:
    f.write("hello, this is a plain text file, not an image\n")

# corrupt.png — PNG extension, garbage bytes
with open(f"{IN}/corrupt.png", "wb") as f:
    f.write(os.urandom(128))

# simple.svg — small vector fixture
with open(f"{IN}/simple.svg", "w") as f:
    f.write(
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">'
        '<rect width="120" height="80" fill="#2563eb"/>'
        '<circle cx="60" cy="40" r="24" fill="#f59e0b"/></svg>'
    )

# mini.psd — minimal valid PSD header (8BPS) + raw 4x4 RGB data.
# Detection is signature-first, so the header is what matters.
w, h, channels = 4, 4, 3
hdr = b"8BPS" + struct.pack(">H", 1) + b"\x00" * 6
hdr += struct.pack(">H", channels) + struct.pack(">I", h) + struct.pack(">I", w)
hdr += struct.pack(">H", 8) + struct.pack(">H", 3)  # depth 8, mode RGB
hdr += struct.pack(">I", 0)  # color mode data length
hdr += struct.pack(">I", 0)  # image resources length
hdr += struct.pack(">I", 0)  # reserved data length
hdr += struct.pack(">H", 0)  # compression: raw
pixels = bytes([255, 0, 0] * (w * h) + [0, 255, 0] * (w * h) + [0, 0, 255] * (w * h))
with open(f"{IN}/mini.psd", "wb") as f:
    f.write(hdr + pixels)

print("fixtures written to", IN)
for name in sorted(os.listdir(IN)):
    print(f"  {name} {os.path.getsize(os.path.join(IN, name))} B")
