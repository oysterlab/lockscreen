#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow==11.3.0"]
# ///
"""Build the labeled PET-R007 ImageGen review sheet."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "manifest.json"
SOURCE = ROOT / "output-native"
OUTPUT = ROOT / "contact-sheet.jpg"


def main() -> None:
    items = json.loads(MANIFEST.read_text(encoding="utf-8"))["items"]
    columns = 5
    thumb_w, thumb_h = 235, 418
    label_h = 30
    rows = (len(items) + columns - 1) // columns
    sheet = Image.new("RGB", (thumb_w * columns, (thumb_h + label_h) * rows), "#17130f")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=15)

    for index, item in enumerate(items):
        image_path = SOURCE / f"{item['id']}.png"
        if not image_path.is_file():
            raise RuntimeError(f"missing generated image: {image_path}")
        image = Image.open(image_path).convert("RGB")
        if image.size != (941, 1672):
            raise RuntimeError(f"unexpected native size {image.size}: {image_path}")
        image = image.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        col, row = index % columns, index // columns
        x = col * thumb_w
        y = row * (thumb_h + label_h)
        sheet.paste(image, (x, y))
        draw.text((x + 7, y + thumb_h + 7), item["id"], font=font, fill="#f6eadc")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUTPUT, quality=92, optimize=True, progressive=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
