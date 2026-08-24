#!/usr/bin/env python3
"""Build lightweight PET-R004 scenes for the existing fullday mobile renderer.

The 96 room light maps, moving curtain and branch-shadow clips are shared once.  Each
pet scene contributes only its view metadata, a subject/foreground mask, a soft relief
map and the low-frequency light field baked into that result image.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "pet-identity-30"
PREVIEW = PAGE / "preview"
EXPERIMENT = (
    ROOT
    / "service/validation_roadmap/phase_a_product_truth/a2_pet_identity/experiments"
    / "PET-R004_cat_dog_30_direct_base_2026-08-24"
)
BASE = ROOT / "samples/experiment_1/base_9x16.png"
TEMPLATE = ROOT / "assets/photo3d_exp1_latte/view.json"
LIGHT_SOURCE = ROOT / "assets/photo3d_exp1/light"
SHARED = PREVIEW / "assets/photo3d_pet_r004_shared"
QUALITY = [int(cv2.IMWRITE_WEBP_QUALITY), 94]


def slug(pet_id: str) -> str:
    return pet_id.lower().replace("-", "_")


def subject_mask(result: np.ndarray, base: np.ndarray) -> np.ndarray:
    """Find the newly generated pet/props while ignoring gentle room redraws."""
    height, width = result.shape[:2]
    # A smooth per-pixel gain absorbs global exposure/colour differences between the
    # generated frame and the clean base.  The pet and its props remain as sharp residuals.
    sigma = max(width, height) * 0.045
    gain = cv2.GaussianBlur(result + 1.0, (0, 0), sigma) / np.maximum(
        cv2.GaussianBlur(base + 1.0, (0, 0), sigma), 1.0
    )
    residual = np.abs(result - base * gain).mean(axis=2)
    residual = cv2.GaussianBlur(residual, (0, 0), 2.2)

    roi = np.zeros((height, width), np.uint8)
    roi[int(height * 0.54) : int(height * 0.91), int(width * 0.22) : int(width * 0.98)] = 1
    values = residual[roi > 0]
    threshold = max(10.0, float(np.percentile(values, 85.5)))
    binary = ((residual > threshold) & (roi > 0)).astype(np.uint8)
    binary = cv2.morphologyEx(
        binary, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))
    )
    binary = cv2.morphologyEx(
        binary, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    )

    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    candidates: list[tuple[int, int]] = []
    for label in range(1, count):
        x, y, w, h, area = stats[label]
        cy = y + h / 2
        if area >= width * height * 0.001 and cy > height * 0.58:
            candidates.append((area, label))
    if not candidates:
        raise RuntimeError("no foreground component found")

    candidates.sort(reverse=True)
    main_label = candidates[0][1]
    main = (labels == main_label).astype(np.uint8)
    near = cv2.dilate(
        main, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (81, 81))
    )
    selected = main.copy()
    # Keep detached hats, toys, flowers and sticks when they sit close to the animal.
    for _, label in candidates[1:]:
        component = (labels == label).astype(np.uint8)
        if np.any(component & near):
            selected |= component

    selected = cv2.morphologyEx(
        selected, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))
    )
    return cv2.GaussianBlur(selected.astype(np.float32), (0, 0), 3.2)


def write_scene(image_path: Path, template: dict) -> tuple[str, float]:
    pet_id = image_path.stem
    scene_id = f"pet_r004_{slug(pet_id)}"
    scene = PREVIEW / f"assets/photo3d_{scene_id}"
    scene.mkdir(parents=True, exist_ok=True)
    # Do not derive a denominator by cutting the pet out and filling that hole. Even a
    # smooth fill leaves a pet-shaped low-frequency change; division turns it into the
    # recycled-looking stain seen around subjects. All PET-R004 frames share the same
    # base illumination, so they use the source room's exact clean reference light.
    if (scene / "light").exists():
        shutil.rmtree(scene / "light")

    result_u8 = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if result_u8 is None:
        raise RuntimeError(f"cannot read {image_path}")
    result = result_u8.astype(np.float32)
    height, width = result.shape[:2]
    base_u8 = cv2.imread(str(BASE), cv2.IMREAD_COLOR)
    base = cv2.resize(base_u8, (width, height), interpolation=cv2.INTER_AREA).astype(np.float32)

    mask = subject_mask(result, base)
    mask_u8 = np.clip(mask * 255, 0, 255).astype(np.uint8)
    cv2.imwrite(str(scene / "subject.webp"), mask_u8, QUALITY)

    solid = mask > 0.18
    distance = cv2.distanceTransform(solid.astype(np.uint8), cv2.DIST_L2, 5)
    distance /= max(float(distance.max()), 1.0)
    relief = mask * (34.0 + 62.0 * np.sqrt(distance))
    cv2.imwrite(str(scene / "relief.webp"), np.clip(relief, 0, 255).astype(np.uint8), QUALITY)

    view = json.loads(json.dumps(template))
    view["scene"] = scene_id
    view["reference"] = f"../../../assets/output/{pet_id}.jpg"
    view["referenceLight"] = "../photo3d_pet_r004_shared/light/ref.webp"
    view["lightFrom"] = "pet_r004_shared"
    view["subject"] = "subject.webp"
    view["relief"] = "relief.webp"
    # The template's night subject lift paints a cool tint through the soft subject
    # matte. On dark pets that feathered matte becomes a visible pet-shaped halo at
    # night (most obvious around 02:42). Keep the room/plinth night treatment, but do
    # not add any colour through the pet silhouette itself.
    view.setdefault("indirectLight", {})["subjectLift"] = 0.0
    view["_note"] = (
        f"PET-R004 mobile preview for {pet_id}. Uses the shared exp1 96-slot light field "
        "and its exact clean reference denominator (no subject-shaped light fill), moving "
        "curtain, indirect room light and branch-shadow overlay. Subject-shaped night "
        "bounce is disabled to prevent a feathered halo around the pet."
    )
    (scene / "view.json").write_text(
        json.dumps(view, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return scene_id, float(solid.mean())


def main() -> None:
    PREVIEW.mkdir(parents=True, exist_ok=True)
    (PREVIEW / "vendor").mkdir(parents=True, exist_ok=True)
    for source, target in (
        (ROOT / "viewer.html", PREVIEW / "viewer.html"),
        (ROOT / "app.js", PREVIEW / "app.js"),
        (ROOT / "style.css", PREVIEW / "style.css"),
        (ROOT / "vendor/three.module.js", PREVIEW / "vendor/three.module.js"),
    ):
        shutil.copy2(source, target)
    # The runtime's asset cache key must change when scene metadata changes; otherwise a
    # browser can keep the old per-pet denominator URL after those files are removed.
    preview_app = PREVIEW / "app.js"
    preview_app.write_text(
        preview_app.read_text(encoding="utf-8").replace(
            'const AV = location.protocol === "file:" ? "" : "?a=blue18";',
            'const AV = location.protocol === "file:" ? "" : "?a=pet-r004-nohalo-2";',
        ),
        encoding="utf-8",
    )

    curtain_target = PREVIEW / "assets/curtain_exp1"
    curtain_target.mkdir(parents=True, exist_ok=True)
    for name in ("meta.json", "light.webp", "motion.mp4", "f006.webp"):
        shutil.copy2(ROOT / f"assets/curtain_exp1/{name}", curtain_target / name)

    overlay_target = PREVIEW / "assets/overlay_branch"
    overlay_target.mkdir(parents=True, exist_ok=True)
    for name in ("meta.json", "motion.mp4"):
        shutil.copy2(ROOT / f"assets/overlay_branch/{name}", overlay_target / name)

    shared_light = SHARED / "light"
    if shared_light.exists():
        shutil.rmtree(shared_light)
    shutil.copytree(LIGHT_SOURCE, shared_light)

    template = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    images = sorted((EXPERIMENT / "final/cat").glob("*.png")) + sorted(
        (EXPERIMENT / "final/dog").glob("*.png")
    )
    if len(images) != 30:
        raise RuntimeError(f"expected 30 PET-R004 images, found {len(images)}")

    report = []
    for image in images:
        scene_id, coverage = write_scene(image, template)
        report.append({"id": image.stem, "scene": scene_id, "maskCoverage": round(coverage, 4)})
        print(f"{image.stem}: {scene_id}, mask {coverage * 100:.1f}%")
    (PREVIEW / "scenes.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    tiles = []
    for image, item in zip(images, report):
        frame = cv2.imread(str(image), cv2.IMREAD_COLOR)
        mask = cv2.imread(
            str(PREVIEW / f"assets/photo3d_{item['scene']}/subject.webp"),
            cv2.IMREAD_GRAYSCALE,
        )
        overlay = frame.copy()
        green = np.zeros_like(frame)
        green[:, :, 1] = 255
        alpha = (mask.astype(np.float32) / 255.0 * 0.62)[:, :, None]
        overlay = np.clip(overlay * (1 - alpha) + green * alpha, 0, 255).astype(np.uint8)
        tile = cv2.resize(overlay, (235, 418), interpolation=cv2.INTER_AREA)
        cv2.rectangle(tile, (0, 0), (235, 30), (18, 18, 18), -1)
        cv2.putText(
            tile,
            image.stem,
            (8, 21),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )
        tiles.append(tile)
    rows = [cv2.hconcat(tiles[index : index + 5]) for index in range(0, len(tiles), 5)]
    cv2.imwrite(str(PREVIEW / "mask-contact-sheet.jpg"), cv2.vconcat(rows), [cv2.IMWRITE_JPEG_QUALITY, 90])


if __name__ == "__main__":
    main()
