#!/usr/bin/env python3
"""Generate the OCR accuracy fixtures for OpenPixel Studio Phase 4.

Renders KNOWN text (English + Bengali) to PNGs at a few sizes /
qualities, with a .txt ground-truth file next to each PNG. The
accuracy test (tests/accuracy.rs) OCRs every fixture in every
preprocess mode and reports CER/WER; docs/OCR.md carries the
measured table.

Bengali needs correct complex-script shaping (conjuncts, vowel
signs): Pillow renders with raqm (features.check('raqm') must be
True — it is on this VM) and Noto Sans Bengali. Without raqm the
Bengali fixtures would be wrong, so the script refuses to run.

Regenerate: python3 crates/openpixel-ocr/tests/gen_fixtures.py
Output: crates/openpixel-ocr/tests/fixtures/ (committed, small PNGs).
"""
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, features

HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures"

ENG_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BEN_FONT = "/usr/share/fonts/truetype/noto/NotoSansBengali-Regular.ttf"

ENG_TEXT = (
    "The quick brown fox jumps over the lazy dog.\n"
    "OpenPixel Studio reads scanned documents and turns them into searchable text.\n"
    "Monitoring and evaluation reports must be accurate, timely and complete."
)

BEN_TEXT = (
    "আমি ঢাকায় থাকি।\n"
    "ওপেনপিক্সেল স্টুডিও স্ক্যান করা নথি পড়তে পারে।\n"
    "স্বচ্ছতা ও জবাবদিহিতা উন্নয়নের মূল ভিত্তি।"
)


def render(text: str, font_path: str, size: int, path: Path) -> None:
    font = ImageFont.truetype(font_path, size, layout_engine=ImageFont.Layout.RAQM)
    # Measure first so the canvas fits the text.
    probe = Image.new("L", (10, 10))
    d = ImageDraw.Draw(probe)
    bbox = d.multiline_textbbox((0, 0), text, font=font, spacing=10)
    w, h = bbox[2] - bbox[0] + 80, bbox[3] - bbox[1] + 80
    img = Image.new("L", (w, h), 255)
    d = ImageDraw.Draw(img)
    d.multiline_text((40, 40), text, font=font, fill=0, spacing=10)
    img.save(path)
    print(f"wrote {path} ({w}x{h})")


def add_noise(img: Image.Image, fraction: float = 0.02) -> Image.Image:
    px = img.load()
    w, h = img.size
    n = int(w * h * fraction)
    for _ in range(n):
        x, y = random.randrange(w), random.randrange(h)
        px[x, y] = 0 if random.random() < 0.5 else 255
    return img.filter(ImageFilter.GaussianBlur(0.5))


def main() -> int:
    if not features.check("raqm"):
        print("ERROR: Pillow was built without raqm — Bengali would render "
              "with broken shaping. Refusing to generate fixtures.", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    random.seed(42)

    # Clean renders (44 px font — a sharp 200-DPI-ish scan).
    render(ENG_TEXT, ENG_FONT, 44, OUT / "eng-clean.png")
    render(BEN_TEXT, BEN_FONT, 44, OUT / "ben-clean.png")
    (OUT / "eng-clean.txt").write_text(ENG_TEXT, encoding="utf-8")
    (OUT / "ben-clean.txt").write_text(BEN_TEXT, encoding="utf-8")

    # Noisy: salt-and-pepper + slight blur on the clean render.
    for name in ("eng-clean", "ben-clean"):
        img = Image.open(OUT / f"{name}.png").convert("L")
        add_noise(img).save(OUT / f"{name.split('-')[0]}-noisy.png")
        (OUT / f"{name.split('-')[0]}-noisy.txt").write_text(
            (OUT / f"{name}.txt").read_text(encoding="utf-8"), encoding="utf-8")
        print(f"wrote {OUT / (name.split('-')[0] + '-noisy.png')}")

    # Low-DPI: the same text rendered small (20 px font).
    render(ENG_TEXT, ENG_FONT, 20, OUT / "eng-lowdpi.png")
    render(BEN_TEXT, BEN_FONT, 20, OUT / "ben-lowdpi.png")
    (OUT / "eng-lowdpi.txt").write_text(ENG_TEXT, encoding="utf-8")
    (OUT / "ben-lowdpi.txt").write_text(BEN_TEXT, encoding="utf-8")

    # Skewed: the clean English render rotated +3 degrees (white
    # fill) — the Full preprocess mode's deskew should recover it.
    img = Image.open(OUT / "eng-clean.png").convert("L")
    img.rotate(-3, expand=True, fillcolor=255).save(OUT / "eng-skewed.png")
    (OUT / "eng-skewed.txt").write_text(ENG_TEXT, encoding="utf-8")
    print(f"wrote {OUT / 'eng-skewed.png'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
