#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow==11.3.0"]
# ///
"""Build the fixed plinth-centre guide used by PET-R009 ImageGen edits."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
REFERENCE = ROOT.parent / "assets" / "reference" / "target-latte.jpg"
OUTPUT = ROOT / "center-guide.png"

# Measured from the stable 941 px-wide plinth used by the approved outputs.
# Visible plinth edges are about x=291 and x=797, yielding x=544.
PLINTH_CENTER_X = 544


def main() -> None:
    image = Image.open(REFERENCE).convert("RGB")
    # Repository reference JPEGs are web-sized; ImageGen's native edit canvas
    # and the reviewed outputs are 941x1672.
    if image.size != (941, 1672):
        image = image.resize((941, 1672), Image.Resampling.LANCZOS)

    draw = ImageDraw.Draw(image, "RGBA")
    font = ImageFont.load_default(size=18)
    x = PLINTH_CENTER_X

    # The green axis marks the visual centre of the complete visible pet group,
    # including its tail and any worn/held accessory.
    draw.line((x, 1040, x, 1465), fill=(20, 230, 90, 235), width=8)
    draw.ellipse((x - 18, 1320 - 18, x + 18, 1320 + 18), outline=(20, 230, 90, 255), width=7)
    draw.line((x - 80, 1320, x + 80, 1320), fill=(20, 230, 90, 220), width=5)

    label = "PET SILHOUETTE CENTER = PLINTH CENTER (x=544 / 57.81%)"
    box = draw.textbbox((0, 0), label, font=font)
    label_w = box[2] - box[0]
    draw.rounded_rectangle(
        (x - label_w / 2 - 12, 1000, x + label_w / 2 + 12, 1034),
        radius=8,
        fill=(8, 35, 18, 210),
    )
    draw.text((x - label_w / 2, 1008), label, font=font, fill=(225, 255, 232, 255))

    ROOT.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
