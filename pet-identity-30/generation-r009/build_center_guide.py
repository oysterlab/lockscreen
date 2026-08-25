#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow==11.3.0"]
# ///
"""Build fixed and per-scene plinth-centre guides for PET-R009 edits."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
REFERENCE = ROOT.parent / "assets" / "reference" / "target-latte.jpg"
OUTPUT = ROOT / "center-guide.png"
SCENE_SOURCE = ROOT.parent / "generation-r008" / "output-native"
SCENE_DEPTH = ROOT.parent / "preview" / "assets"
SCENE_GUIDES = ROOT / "center-guides"

# Measured from the stable 941 px-wide plinth used by the approved outputs.
# Visible plinth edges are about x=291 and x=797, yielding x=544.
PLINTH_CENTER_X = 544
ROI = (280, 900, 860, 1365)
NEAR_THRESHOLD = 110
PET_CONTACT_Y = 1435


def scene_depth_path(pet_id: str) -> Path:
    slug = pet_id.lower().replace("-", "_")
    return SCENE_DEPTH / f"photo3d_pet_r004_{slug}" / "surface-depth.png"


def upper_pet_box(pet_id: str) -> tuple[int, int, int, int]:
    depth = Image.open(scene_depth_path(pet_id)).convert("L")
    left, top, right, bottom = ROI
    crop = depth.crop(ROI)
    pixels = crop.load()
    points = [
        (x + left, y + top)
        for y in range(crop.height)
        for x in range(crop.width)
        if pixels[x, y] > NEAR_THRESHOLD
    ]
    if not points:
        raise RuntimeError(f"no pet depth found for {pet_id}")
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return min(xs), min(ys), max(xs), PET_CONTACT_Y


def mark(image: Image.Image, pet_id: str | None = None) -> Image.Image:
    image = image.convert("RGB")
    draw = ImageDraw.Draw(image, "RGBA")
    font = ImageFont.load_default(size=18)
    x = PLINTH_CENTER_X

    # The green axis marks the visual centre of the complete visible pet group.
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

    if pet_id is not None:
        old_x0, box_top, old_x1, box_bottom = upper_pet_box(pet_id)
        width = old_x1 - old_x0 + 1
        target_x0 = round(PLINTH_CENTER_X - width / 2)
        target_x1 = target_x0 + width - 1
        draw.rectangle(
            (old_x0, box_top, old_x1, box_bottom),
            outline=(245, 70, 70, 225),
            width=4,
        )
        draw.rectangle(
            (target_x0, box_top, target_x1, box_bottom),
            outline=(20, 235, 90, 255),
            width=6,
        )
        old_center = round((old_x0 + old_x1) / 2)
        arrow_y = max(950, box_top - 24)
        draw.line((old_center, arrow_y, x, arrow_y), fill=(255, 238, 120, 255), width=6)
        draw.polygon(
            ((x, arrow_y), (x + 15, arrow_y - 10), (x + 15, arrow_y + 10)),
            fill=(255, 238, 120, 255),
        )
        size_label = f"SAME {width}px WIDTH / SAME TOP+CONTACT Y"
        size_box = draw.textbbox((0, 0), size_label, font=font)
        size_w = size_box[2] - size_box[0]
        draw.rounded_rectangle(
            (x - size_w / 2 - 10, arrow_y - 45, x + size_w / 2 + 10, arrow_y - 12),
            radius=7,
            fill=(20, 48, 28, 220),
        )
        draw.text((x - size_w / 2, arrow_y - 38), size_label, font=font, fill=(225, 255, 232, 255))

    return image


def main() -> None:
    image = Image.open(REFERENCE)
    # Repository reference JPEGs are web-sized; ImageGen's native edit canvas
    # and the reviewed outputs are 941x1672.
    if image.size != (941, 1672):
        image = image.resize((941, 1672), Image.Resampling.LANCZOS)

    ROOT.mkdir(parents=True, exist_ok=True)
    mark(image).save(OUTPUT)
    print(OUTPUT)

    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    SCENE_GUIDES.mkdir(parents=True, exist_ok=True)
    for item in manifest["items"]:
        pet_id = item["id"]
        source = SCENE_SOURCE / f"{pet_id}.png"
        if not source.is_file():
            raise RuntimeError(f"missing approved scene: {source}")
        guide = mark(Image.open(source), pet_id)
        output = SCENE_GUIDES / f"{pet_id}.jpg"
        guide.save(output, quality=94, optimize=True, progressive=True)
    print(f"{SCENE_GUIDES}: {len(manifest['items'])} per-scene guides")


if __name__ == "__main__":
    main()
