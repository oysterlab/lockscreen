#!/usr/bin/env python3
"""Build PET-R004 previews without any pet-derived mask or relief texture.

The generated 9:16 image is immutable. Time-of-day relighting is sampled at the same
UV for every pixel, and curtain motion is limited to a left-side room-only safe zone.
No subject pixels are segmented, warped, replaced, brightened, or composited.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "pet-identity-30"
PREVIEW = PAGE / "preview"
NATIVE_OUTPUT = PAGE / "assets/output-native"
TEMPLATE = ROOT / "assets/photo3d_exp1_latte/view.json"
LIGHT_SOURCE = ROOT / "assets/photo3d_exp1/light"
SHARED = PREVIEW / "assets/photo3d_pet_r004_shared"
ASSET_VERSION = "pet-r004-flat-safe-1"


def slug(pet_id: str) -> str:
    return pet_id.lower().replace("-", "_")


def write_scene(image_path: Path, template: dict) -> str:
    pet_id = image_path.stem
    scene_id = f"pet_r004_{slug(pet_id)}"
    scene = PREVIEW / f"assets/photo3d_{scene_id}"
    scene.mkdir(parents=True, exist_ok=True)

    # Remove every artifact from the former subject-mask pipeline. Their absence is an
    # invariant: the runtime cannot cut, bend, lift, or protect pixels through a pet matte.
    for stale in (scene / "subject.webp", scene / "relief.webp"):
        stale.unlink(missing_ok=True)
    if (scene / "light").exists():
        shutil.rmtree(scene / "light")

    view = json.loads(json.dumps(template))
    view["scene"] = scene_id
    view["reference"] = f"../../../assets/output-native/{pet_id}.png"
    view["referenceLight"] = "../photo3d_pet_r004_shared/light/ref.webp"
    view["lightFrom"] = "pet_r004_shared"
    view.pop("subject", None)
    view.pop("relief", None)
    view.setdefault("indirectLight", {})["subjectLift"] = 0.0
    view["_note"] = (
        f"PET-R004 flat-safe preview for {pet_id}. The native generated PNG is immutable. "
        "Time light uses one continuous full-frame field; no subject mask, subject relief, "
        "subject lift, cutout, or pet-local UV displacement is loaded. Curtain replacement "
        "is restricted to the room-only left safe zone by shared metadata."
    )
    (scene / "view.json").write_text(
        json.dumps(view, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return scene_id


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

    preview_app = PREVIEW / "app.js"
    preview_app.write_text(
        preview_app.read_text(encoding="utf-8").replace(
            'const AV = location.protocol === "file:" ? "" : "?a=blue18";',
            f'const AV = location.protocol === "file:" ? "" : "?a={ASSET_VERSION}";',
        ),
        encoding="utf-8",
    )
    preview_viewer = PREVIEW / "viewer.html"
    preview_viewer.write_text(
        preview_viewer.read_text(encoding="utf-8").replace(
            './app.js?v=mesh-89', f'./app.js?v={ASSET_VERSION}'
        ),
        encoding="utf-8",
    )

    curtain_target = PREVIEW / "assets/curtain_exp1"
    curtain_target.mkdir(parents=True, exist_ok=True)
    for name in ("meta.json", "light.webp", "motion.mp4", "f006.webp"):
        shutil.copy2(ROOT / f"assets/curtain_exp1/{name}", curtain_target / name)
    curtain_meta_path = curtain_target / "meta.json"
    curtain_meta = json.loads(curtain_meta_path.read_text(encoding="utf-8"))
    # Keep the clip's original source mapping, but fade its replacement out before the
    # arch/podium area. Every pet and accessory remains outside this room-only zone.
    curtain_meta["x1"] = 0.285
    curtain_meta["feather"] = 0.035
    curtain_meta["_safeZone"] = (
        "Flat-safe PET-R004: motion is fully applied only left of x=0.285 and fades to "
        "zero by x=0.320. stripWidth stays unchanged so the curtain is cropped, not squeezed."
    )
    curtain_meta_path.write_text(
        json.dumps(curtain_meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    overlay_target = PREVIEW / "assets/overlay_branch"
    overlay_target.mkdir(parents=True, exist_ok=True)
    for name in ("meta.json", "motion.mp4"):
        shutil.copy2(ROOT / f"assets/overlay_branch/{name}", overlay_target / name)

    shared_light = SHARED / "light"
    if shared_light.exists():
        shutil.rmtree(shared_light)
    shutil.copytree(LIGHT_SOURCE, shared_light)

    template = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    images = sorted(NATIVE_OUTPUT.glob("*.png"))
    if len(images) != 30:
        raise RuntimeError(f"expected 30 native PET-R004 PNGs, found {len(images)}")

    report = []
    for image in images:
        scene_id = write_scene(image, template)
        report.append(
            {
                "id": image.stem,
                "scene": scene_id,
                "reference": f"assets/output-native/{image.name}",
                "mask": None,
                "relief": None,
            }
        )
        print(f"{image.stem}: {scene_id}, native PNG, no mask/relief")
    (PREVIEW / "scenes.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (PREVIEW / "mask-contact-sheet.jpg").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
