#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow==11.3.0"]
# ///
"""Build a before/after owner-review sheet with the fixed plinth centre axis."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
BEFORE = ROOT.parent / "generation-r008" / "output-native"
AFTER = ROOT / "output-native"
OUTPUT = ROOT / "alignment-review.jpg"
PLINTH_CENTER_X = 544


def marked(path: Path, width: int, height: int) -> Image.Image:
    image = Image.open(path).convert("RGB")
    if image.size != (941, 1672):
        raise RuntimeError(f"unexpected native size {image.size}: {path}")
    draw = ImageDraw.Draw(image, "RGBA")
    draw.line((PLINTH_CENTER_X, 970, PLINTH_CENTER_X, 1470), fill=(20, 235, 90, 225), width=6)
    return image.resize((width, height), Image.Resampling.LANCZOS)


def main() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    items = [item for item in manifest["items"] if (AFTER / f"{item['id']}.png").is_file()]
    thumb_w, thumb_h = 212, 377
    label_h = 44
    rows = len(items)
    sheet = Image.new("RGB", (thumb_w * 2, (thumb_h + label_h) * rows), "#17130f")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=14)

    for row, item in enumerate(items):
        pet_id = item["id"]
        y = row * (thumb_h + label_h)
        sheet.paste(marked(BEFORE / f"{pet_id}.png", thumb_w, thumb_h), (0, y))
        sheet.paste(marked(AFTER / f"{pet_id}.png", thumb_w, thumb_h), (thumb_w, y))
        draw.text((8, y + thumb_h + 7), f"{pet_id}  BEFORE", font=font, fill="#f6eadc")
        draw.text((thumb_w + 8, y + thumb_h + 7), "CENTERED CANDIDATE", font=font, fill="#b9ffd0")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUTPUT, quality=92, optimize=True, progressive=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
