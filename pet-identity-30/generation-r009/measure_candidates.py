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
"""Measure PET-R009 placement candidates against accepted PET-R008 size.

This QA uses dense whole-scene depth only. It does not create or ship a pet
alpha mask. The upper-silhouette measurements are an objective rejection gate;
they are not an automatic aesthetic PASS.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as functional
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForDepthEstimation


ROOT = Path(__file__).resolve().parent
PAGE = ROOT.parent
BEFORE_DEPTH = PAGE / "preview" / "assets"
AFTER = ROOT / "output-native"
QA_DEPTH = ROOT / "qa-depth"
OUTPUT = ROOT / "qa-measurements.json"
MODEL_ID = "depth-anything/Depth-Anything-V2-Small-hf"

# The wall is far/dark; the pet is near/bright. The ROI ends above the plinth
# top so the platform cannot inflate the measured pet width.
ROI = (280, 900, 860, 1365)
NEAR_THRESHOLD = 110
PLINTH_CENTER_X = 544
MAX_WIDTH_RATIO = 1.015
MIN_WIDTH_RATIO = 0.98
MAX_UPWARD_TOP_DRIFT_PX = 6


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ids", nargs="*")
    parser.add_argument("--device", choices=("auto", "cpu", "mps"), default="auto")
    return parser.parse_args()


def choose_device(requested: str) -> torch.device:
    if requested == "cpu":
        return torch.device("cpu")
    if requested == "mps":
        if not torch.backends.mps.is_available():
            raise RuntimeError("MPS requested but unavailable")
        return torch.device("mps")
    return torch.device("mps" if torch.backends.mps.is_available() else "cpu")


def normalize_depth(depth: np.ndarray) -> np.ndarray:
    finite = depth[np.isfinite(depth)]
    low, high = np.percentile(finite, (1.0, 99.0))
    if high - low < 1e-6:
        raise RuntimeError("flat depth field")
    return np.clip((depth - low) / (high - low), 0.0, 1.0)


def infer_depth(
    image: Image.Image,
    processor: AutoImageProcessor,
    model: AutoModelForDepthEstimation,
    device: torch.device,
) -> np.ndarray:
    inputs = processor(images=image.convert("RGB"), return_tensors="pt")
    inputs = {name: value.to(device) for name, value in inputs.items()}
    with torch.inference_mode():
        prediction = model(**inputs).predicted_depth
    prediction = functional.interpolate(
        prediction.unsqueeze(1),
        size=(image.height, image.width),
        mode="bicubic",
        align_corners=False,
    ).squeeze()
    return normalize_depth(prediction.detach().float().cpu().numpy())


def metrics(depth_u8: np.ndarray) -> dict[str, float | int]:
    left, top, right, bottom = ROI
    crop = depth_u8[top:bottom, left:right]
    ys, xs = np.where(crop > NEAR_THRESHOLD)
    if not len(xs):
        raise RuntimeError("no near-pet pixels in measurement ROI")
    x0 = int(xs.min() + left)
    x1 = int(xs.max() + left)
    y0 = int(ys.min() + top)
    return {
        "upperSilhouetteLeft": x0,
        "upperSilhouetteRight": x1,
        "upperSilhouetteWidth": x1 - x0 + 1,
        "upperSilhouetteCenterX": round((x0 + x1) / 2, 1),
        "topY": y0,
    }


def before_path(pet_id: str) -> Path:
    slug = pet_id.lower().replace("-", "_")
    return BEFORE_DEPTH / f"photo3d_pet_r004_{slug}" / "surface-depth.png"


def main() -> None:
    args = parse_args()
    available = sorted(path.stem for path in AFTER.glob("*.png"))
    ids = args.ids or available
    missing = sorted(set(ids) - set(available))
    if missing:
        raise RuntimeError(f"missing R009 candidates: {missing}")

    device = choose_device(args.device)
    print(f"Loading {MODEL_ID} on {device} for {len(ids)} candidate(s)")
    processor = AutoImageProcessor.from_pretrained(MODEL_ID)
    model = AutoModelForDepthEstimation.from_pretrained(MODEL_ID).to(device).eval()
    QA_DEPTH.mkdir(parents=True, exist_ok=True)

    results = []
    for index, pet_id in enumerate(ids, 1):
        accepted_depth = np.array(Image.open(before_path(pet_id)).convert("L"))
        image = Image.open(AFTER / f"{pet_id}.png").convert("RGB")
        candidate_depth = infer_depth(image, processor, model, device)
        candidate_u8 = np.round(candidate_depth * 255).astype(np.uint8)
        Image.fromarray(candidate_u8).save(QA_DEPTH / f"{pet_id}.png", optimize=True)

        before = metrics(accepted_depth)
        after = metrics(candidate_u8)
        width_ratio = after["upperSilhouetteWidth"] / before["upperSilhouetteWidth"]
        upward_top_drift = before["topY"] - after["topY"]
        size_ok = (
            MIN_WIDTH_RATIO <= width_ratio <= MAX_WIDTH_RATIO
            and upward_top_drift <= MAX_UPWARD_TOP_DRIFT_PX
        )
        alignment_error = abs(after["upperSilhouetteCenterX"] - PLINTH_CENTER_X)
        result = {
            "id": pet_id,
            "before": before,
            "candidate": after,
            "widthRatio": round(width_ratio, 4),
            "upwardTopDriftPixels": int(upward_top_drift),
            "alignmentErrorPixels": round(alignment_error, 1),
            "sizeGate": "size-maintained" if size_ok else "reject-size-drift",
        }
        results.append(result)
        print(
            f"[{index:02d}/{len(ids):02d}] {pet_id}: "
            f"width {width_ratio:.3f}x, top drift {upward_top_drift:+d}px, "
            f"center error {alignment_error:.1f}px, {result['sizeGate']}"
        )

    OUTPUT.write_text(
        json.dumps(
            {
                "round": "PET-R009",
                "purpose": "objective rejection gate only; not an aesthetic PASS",
                "plinthCenterX": PLINTH_CENTER_X,
                "sizeUpperBounds": {
                    "maxWidthRatio": MAX_WIDTH_RATIO,
                    "minWidthRatio": MIN_WIDTH_RATIO,
                    "maxUpwardTopDriftPixels": MAX_UPWARD_TOP_DRIFT_PX,
                },
                "items": results,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(OUTPUT)


if __name__ == "__main__":
    main()
