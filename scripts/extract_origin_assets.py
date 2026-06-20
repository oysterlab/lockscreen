from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "origin.png"
TRIPO_DIR = ROOT / "assets" / "tripo"
LAYER_DIR = ROOT / "assets" / "layers"
MATTE = (244, 226, 200)


def load_source() -> Image.Image:
    return Image.open(SOURCE).convert("RGB")


def _draw_cat(draw: ImageDraw.ImageDraw) -> None:
    # Smaller overlapping shapes avoid baking the gate/wall pixels into the Tripo input.
    draw.ellipse((386, 858, 470, 940), fill=255)  # pom-pom
    draw.ellipse((324, 888, 552, 1036), fill=255)  # bonnet crown
    draw.polygon(
        (
            (250, 1014),
            (292, 965),
            (338, 970),
            (376, 1016),
            (418, 974),
            (456, 1016),
            (497, 973),
            (535, 1018),
            (580, 969),
            (625, 1011),
            (621, 1070),
            (574, 1080),
            (535, 1065),
            (494, 1092),
            (452, 1067),
            (410, 1090),
            (369, 1068),
            (328, 1092),
            (285, 1064),
            (248, 1068),
        ),
        fill=255,
    )

    draw.polygon(((260, 967), (329, 895), (366, 1040), (306, 1060)), fill=255)
    draw.polygon(((525, 1040), (593, 902), (626, 980), (595, 1064)), fill=255)
    draw.ellipse((280, 974, 610, 1196), fill=255)  # face
    draw.ellipse((270, 1102, 604, 1290), fill=255)  # chest and belly

    draw.ellipse((177, 1130, 335, 1264), fill=255)  # curled tail
    draw.ellipse((214, 1097, 335, 1228), fill=255)
    draw.ellipse((332, 1168, 456, 1302), fill=255)
    draw.ellipse((452, 1160, 576, 1302), fill=255)
    draw.ellipse((312, 1124, 411, 1235), fill=255)
    draw.ellipse((512, 1118, 604, 1236), fill=255)


def _draw_cushion_and_props(draw: ImageDraw.ImageDraw) -> None:
    draw.polygon(
        (
            (197, 1226),
            (618, 1204),
            (714, 1253),
            (675, 1328),
            (235, 1354),
            (160, 1282),
        ),
        fill=255,
    )
    draw.polygon(((179, 1308), (690, 1278), (681, 1346), (232, 1370)), fill=255)
    draw.ellipse((541, 1125, 671, 1248), fill=255)  # yarn ball
    draw.line((625, 1243, 715, 1293), fill=255, width=30)
    draw.ellipse((668, 1245, 775, 1315), fill=255)  # fish toy
    draw.ellipse((746, 1276, 795, 1322), fill=255)


def make_mask(size: tuple[int, int], include_cushion: bool) -> Image.Image:
    width, height = size
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)

    _draw_cat(draw)

    if include_cushion:
        _draw_cushion_and_props(draw)

    mask = mask.filter(ImageFilter.GaussianBlur(3))
    mask = mask.point(lambda value: 0 if value < 12 else min(255, int(value * 1.32)))
    return mask


def crop_to_alpha(source: Image.Image, mask: Image.Image, padding: int = 32) -> Image.Image:
    bbox = mask.getbbox()
    if bbox is None:
        raise RuntimeError("Empty mask")

    left, top, right, bottom = bbox
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(source.width, right + padding)
    bottom = min(source.height, bottom + padding)

    crop = source.crop((left, top, right, bottom)).convert("RGBA")
    alpha = mask.crop((left, top, right, bottom))
    crop.putalpha(alpha)
    return crop


def square_for_tripo(cutout: Image.Image, out_size: int = 1024, fill=MATTE) -> Image.Image:
    canvas = Image.new("RGB", (out_size, out_size), fill)
    subject = cutout.copy()
    bbox = subject.getbbox()
    if bbox is None:
        return canvas

    subject = subject.crop(bbox)
    max_subject = int(out_size * 0.78)
    scale = min(max_subject / subject.width, max_subject / subject.height)
    new_size = (max(1, int(subject.width * scale)), max(1, int(subject.height * scale)))
    subject = subject.resize(new_size, Image.Resampling.LANCZOS)

    x = (out_size - subject.width) // 2
    y = int((out_size - subject.height) * 0.56)
    canvas.paste(subject.convert("RGB"), (x, y), subject.getchannel("A"))
    return canvas


def square_transparent(cutout: Image.Image, out_size: int = 1024) -> Image.Image:
    canvas = Image.new("RGBA", (out_size, out_size), (0, 0, 0, 0))
    subject = cutout.copy()
    bbox = subject.getbbox()
    if bbox is None:
        return canvas

    subject = subject.crop(bbox)
    max_subject = int(out_size * 0.78)
    scale = min(max_subject / subject.width, max_subject / subject.height)
    new_size = (max(1, int(subject.width * scale)), max(1, int(subject.height * scale)))
    subject = subject.resize(new_size, Image.Resampling.LANCZOS)

    x = (out_size - subject.width) // 2
    y = int((out_size - subject.height) * 0.56)
    canvas.alpha_composite(subject, (x, y))
    return canvas


def make_background_clean(source: Image.Image, subject_mask: Image.Image) -> Image.Image:
    # A pragmatic first pass: remove lock-screen UI with a warm sky wash, then fill the
    # subject zone with blurred local color. The 3D subject will sit in front of this.
    bg = source.copy().convert("RGB")
    arr = np.asarray(bg).astype(np.float32)
    h, w = arr.shape[:2]

    top = np.array([239, 169, 100], dtype=np.float32)
    mid = np.array([214, 132, 78], dtype=np.float32)
    sky_limit = int(h * 0.42)
    for y in range(sky_limit):
        t = y / max(1, sky_limit - 1)
        color = top * (1 - t) + mid * t
        alpha = 0.72 if 70 < y < 390 else 0.42
        arr[y, :, :] = arr[y, :, :] * (1 - alpha) + color * alpha

    # Soften UI remnants in the lower control strip.
    bottom_start = int(h * 0.86)
    bottom_color = np.array([67, 38, 23], dtype=np.float32)
    for y in range(bottom_start, h):
        t = (y - bottom_start) / max(1, h - bottom_start - 1)
        alpha = 0.45 + t * 0.35
        arr[y, :, :] = arr[y, :, :] * (1 - alpha) + bottom_color * alpha

    bg = Image.fromarray(np.clip(arr, 0, 255).astype("uint8"), "RGB")

    mask = subject_mask.filter(ImageFilter.GaussianBlur(18))
    blurred = bg.filter(ImageFilter.GaussianBlur(22))
    warm_plate = Image.new("RGB", bg.size, (187, 128, 82))
    fill = Image.blend(blurred, warm_plate, 0.22)
    bg.paste(fill, (0, 0), mask)
    return bg


def make_background_blur_plate(source: Image.Image, subject_mask: Image.Image) -> Image.Image:
    bg = make_background_clean(source, subject_mask)
    return bg.filter(ImageFilter.GaussianBlur(8))


def make_foreground_floor(source: Image.Image, subject_mask: Image.Image) -> Image.Image:
    layer = Image.new("RGBA", source.size, (0, 0, 0, 0))
    floor = source.convert("RGBA")
    alpha = Image.new("L", source.size, 0)

    grad = np.zeros((source.height, source.width), dtype=np.uint8)
    for y in range(1220, source.height):
        t = min(1, max(0, (y - 1220) / 210))
        grad[y, :] = int(t * 255)
    alpha = Image.fromarray(np.maximum(np.asarray(alpha), grad), "L")

    remove_subject = subject_mask.filter(ImageFilter.GaussianBlur(12))
    alpha_arr = np.asarray(alpha).astype(np.float32)
    remove_arr = np.asarray(remove_subject).astype(np.float32) / 255.0
    alpha_arr *= 1.0 - remove_arr
    alpha = Image.fromarray(np.clip(alpha_arr, 0, 255).astype("uint8"), "L")
    alpha = alpha.filter(ImageFilter.GaussianBlur(2))
    floor.putalpha(alpha)
    layer.alpha_composite(floor)
    return layer


def write_prompts() -> None:
    (TRIPO_DIR / "tripo_prompts.md").write_text(
        """# Tripo3D source prompts

Upload priority:

1. `cat_cushion_tripo_clean.png` - best source for Tripo image-to-3D. It keeps the cat, cushion, yarn ball, and fish toy on a simple warm background.
2. `cat_cushion_tripo.png` - local extraction from `origin.png`; useful as a reference, but some original background can remain.
3. `cat_subject_tripo.png` - cat-focused fallback if the cushion/base should be excluded.

Use `multiview_clean/contact_sheet.png` or the four separate images in that folder when a model workflow supports multi-view references.

## Cat + cushion

front-facing chubby tabby cat wearing a green knitted bonnet, sitting on a square yellow cushion, cute miniature diorama figurine, warm golden-hour lighting, full body visible, include cushion and yarn ball, isolated object, no room, no street background, no text

## Cat only

front-facing chubby tabby cat wearing a green knitted bonnet, cute miniature 3D figurine, warm golden-hour lighting, full body visible, isolated object, no room, no street background, no text
""",
        encoding="utf-8",
    )


def save_all() -> None:
    source = load_source()
    cat_mask = make_mask(source.size, include_cushion=False)
    cat_cushion_mask = make_mask(source.size, include_cushion=True)

    cat_cutout = crop_to_alpha(source, cat_mask, padding=40)
    cat_cushion_cutout = crop_to_alpha(source, cat_cushion_mask, padding=44)

    cat_cutout.save(TRIPO_DIR / "cat_subject_cutout.png")
    cat_cushion_cutout.save(TRIPO_DIR / "cat_cushion_cutout.png")
    square_for_tripo(cat_cutout).save(TRIPO_DIR / "cat_subject_tripo.png")
    square_for_tripo(cat_cushion_cutout).save(TRIPO_DIR / "cat_cushion_tripo.png")
    square_transparent(cat_cutout).save(TRIPO_DIR / "cat_subject_tripo_alpha.png")
    square_transparent(cat_cushion_cutout).save(TRIPO_DIR / "cat_cushion_tripo_alpha.png")

    make_background_clean(source, cat_cushion_mask).save(LAYER_DIR / "background_clean.png")
    make_background_blur_plate(source, cat_cushion_mask).save(LAYER_DIR / "background_blur_plate.png")
    make_foreground_floor(source, cat_cushion_mask).save(LAYER_DIR / "foreground_floor.png")
    write_prompts()

    # Debug masks are useful for quick iteration and can be ignored by the app.
    cat_mask.save(TRIPO_DIR / "cat_subject_mask.png")
    cat_cushion_mask.save(TRIPO_DIR / "cat_cushion_mask.png")


if __name__ == "__main__":
    save_all()
