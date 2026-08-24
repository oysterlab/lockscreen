#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11,<3.12"
# dependencies = [
#   "numpy==2.0.2",
#   "pillow==11.3.0",
#   "safetensors==0.6.2",
#   "torch==2.8.0",
#   "transformers==4.55.2",
# ]
# ///
"""Estimate dense full-frame depth and normals for PET-R004 scenes.

Run with uv so the pinned model runtime is isolated and reproducible:

    uv run pet-identity-30/build_depth_normals.py

The generated maps describe the already-integrated native scene. They are never
used as a cutout or a replacement layer. The browser only uses them to bend the
light field and apply bounded multiplicative surface shading.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as functional
from PIL import Image, ImageDraw
from transformers import AutoImageProcessor, AutoModelForDepthEstimation


PAGE = Path(__file__).resolve().parent
SOURCE = PAGE / "assets/output-native"
PREVIEW_ASSETS = PAGE / "preview/assets"
MODEL_ID = "depth-anything/Depth-Anything-V2-Small-hf"
PIPELINE_VERSION = "pet-r005-depth-normal-1"
NORMAL_SLOPE = 32.0
NORMAL_GRADIENT_CLIP = 0.012
CONTACT_SHEET = PAGE / "preview/surface-contact-sheet.jpg"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--ids",
        nargs="*",
        help="Optional PET IDs. Omit to build all native scenes.",
    )
    parser.add_argument("--force", action="store_true")
    parser.add_argument(
        "--device",
        choices=("auto", "cpu", "mps"),
        default="auto",
    )
    return parser.parse_args()


def scene_dir(pet_id: str) -> Path:
    slug = pet_id.lower().replace("-", "_")
    return PREVIEW_ASSETS / f"photo3d_pet_r004_{slug}"


def choose_device(requested: str) -> torch.device:
    if requested == "cpu":
        return torch.device("cpu")
    if requested == "mps":
        if not torch.backends.mps.is_available():
            raise RuntimeError("MPS requested but unavailable")
        return torch.device("mps")
    return torch.device("mps" if torch.backends.mps.is_available() else "cpu")


def robust_unit_depth(depth: np.ndarray) -> tuple[np.ndarray, float, float]:
    finite = depth[np.isfinite(depth)]
    if finite.size == 0:
        raise RuntimeError("model returned no finite depth values")
    low, high = np.percentile(finite, (1.0, 99.0))
    if high - low < 1e-6:
        raise RuntimeError("model returned a flat depth field")
    unit = np.clip((depth - low) / (high - low), 0.0, 1.0)
    # Depth Anything V2 emits larger relative values for nearer surfaces.
    return unit.astype(np.float32), float(low), float(high)


def smooth_for_normals(unit_depth: np.ndarray) -> np.ndarray:
    # Keep the derivative in float. Quantising before differentiation creates contour
    # rings in nearly flat walls, which then become false lighting bands in the viewer.
    sigma = 2.2
    radius = int(np.ceil(sigma * 3))
    axis = torch.arange(-radius, radius + 1, dtype=torch.float32)
    kernel = torch.exp(-(axis * axis) / (2 * sigma * sigma))
    kernel /= kernel.sum()
    field = torch.from_numpy(unit_depth)[None, None]
    field = functional.conv2d(
        functional.pad(field, (radius, radius, 0, 0), mode="reflect"),
        kernel.reshape(1, 1, 1, -1),
    )
    field = functional.conv2d(
        functional.pad(field, (0, 0, radius, radius), mode="reflect"),
        kernel.reshape(1, 1, -1, 1),
    )
    return field[0, 0].numpy()


def normals_from_depth(unit_depth: np.ndarray) -> np.ndarray:
    smooth = smooth_for_normals(unit_depth)
    dy, dx = np.gradient(smooth)
    dx = np.clip(dx, -NORMAL_GRADIENT_CLIP, NORMAL_GRADIENT_CLIP)
    dy = np.clip(dy, -NORMAL_GRADIENT_CLIP, NORMAL_GRADIENT_CLIP)

    # Image rows increase downward while the viewer's world Y increases upward.
    nx = -dx * NORMAL_SLOPE
    ny = dy * NORMAL_SLOPE
    nz = np.ones_like(smooth)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    normals = np.stack((nx / length, ny / length, nz / length), axis=-1)
    return np.round((normals * 0.5 + 0.5) * 255).astype(np.uint8)


def save_maps(pet_id: str, depth: np.ndarray, model_range: tuple[float, float]) -> None:
    target = scene_dir(pet_id)
    target.mkdir(parents=True, exist_ok=True)
    depth_path = target / "surface-depth.png"
    normal_path = target / "surface-normal.png"
    meta_path = target / "surface-meta.json"

    Image.fromarray(np.round(depth * 255).astype(np.uint8)).save(
        depth_path, optimize=True
    )
    Image.fromarray(normals_from_depth(depth)).save(
        normal_path, optimize=True
    )
    meta_path.write_text(
        json.dumps(
            {
                "pipeline": PIPELINE_VERSION,
                "model": MODEL_ID,
                "depthConvention": "near=1, far=0",
                "source": f"../../../assets/output-native/{pet_id}.png",
                "normalSlope": NORMAL_SLOPE,
                "normalGradientClip": NORMAL_GRADIENT_CLIP,
                "modelPercentileRange": [model_range[0], model_range[1]],
                "invariants": [
                    "full-frame dense maps only",
                    "no pet mask or alpha matte",
                    "no reference pixel displacement or replacement",
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def build_contact_sheet(images: list[Path]) -> None:
    columns = 5
    map_width = 158
    map_height = round(map_width * 1672 / 941)
    gutter = 10
    label_height = 28
    cell_width = map_width * 2 + gutter
    cell_height = map_height + label_height
    rows = int(np.ceil(len(images) / columns))
    sheet = Image.new("RGB", (cell_width * columns, cell_height * rows), "#16130f")
    draw = ImageDraw.Draw(sheet)

    for index, image_path in enumerate(images):
        pet_id = image_path.stem
        target = scene_dir(pet_id)
        depth = Image.open(target / "surface-depth.png").convert("RGB")
        normal = Image.open(target / "surface-normal.png").convert("RGB")
        depth.thumbnail((map_width, map_height), Image.Resampling.LANCZOS)
        normal.thumbnail((map_width, map_height), Image.Resampling.LANCZOS)
        col, row = index % columns, index // columns
        x = col * cell_width
        y = row * cell_height
        sheet.paste(depth, (x, y))
        sheet.paste(normal, (x + map_width + gutter, y))
        draw.text((x + 6, y + map_height + 7), f"{pet_id}  DEPTH | NORMAL", fill="#f0e4d6")

    CONTACT_SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(CONTACT_SHEET, quality=90, optimize=True, progressive=True)
    print(f"Contact sheet: {CONTACT_SHEET.relative_to(PAGE)}")


def main() -> None:
    args = parse_args()
    requested = set(args.ids or [])
    images = sorted(SOURCE.glob("*.png"))
    if requested:
        images = [path for path in images if path.stem in requested]
        missing = requested - {path.stem for path in images}
        if missing:
            raise RuntimeError(f"unknown PET IDs: {sorted(missing)}")
    if not images:
        raise RuntimeError("no native PNGs selected")

    device = choose_device(args.device)
    print(f"Loading {MODEL_ID} on {device} for {len(images)} scene(s)")
    processor = AutoImageProcessor.from_pretrained(MODEL_ID)
    model = AutoModelForDepthEstimation.from_pretrained(MODEL_ID).to(device).eval()

    for index, image_path in enumerate(images, 1):
        target = scene_dir(image_path.stem)
        outputs = (target / "surface-depth.png", target / "surface-normal.png")
        if not args.force and all(path.exists() for path in outputs):
            print(f"[{index:02d}/{len(images):02d}] {image_path.stem}: cached")
            continue

        image = Image.open(image_path).convert("RGB")
        inputs = processor(images=image, return_tensors="pt")
        inputs = {name: value.to(device) for name, value in inputs.items()}
        with torch.inference_mode():
            prediction = model(**inputs).predicted_depth
        prediction = functional.interpolate(
            prediction.unsqueeze(1),
            size=(image.height, image.width),
            mode="bicubic",
            align_corners=False,
        ).squeeze()
        raw = prediction.detach().float().cpu().numpy()
        depth, low, high = robust_unit_depth(raw)
        save_maps(image_path.stem, depth, (low, high))
        print(
            f"[{index:02d}/{len(images):02d}] {image_path.stem}: "
            f"{image.width}x{image.height}, model range {low:.4f}..{high:.4f}"
        )

    all_images = sorted(SOURCE.glob("*.png"))
    if len(all_images) == 30 and all(
        all((scene_dir(path.stem) / name).exists() for name in (
            "surface-depth.png", "surface-normal.png"
        ))
        for path in all_images
    ):
        build_contact_sheet(all_images)


if __name__ == "__main__":
    main()
