#!/usr/bin/env python3
"""Build PET-R007 previews with dense full-frame depth and normal lighting.

The generated 9:16 image is immutable. Dense scene geometry may bend the light field
and modulate surface shading, but never cuts out, warps, replaces, or composites pet
pixels. Curtain motion remains limited to a left-side room-only safe zone.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "pet-identity-30"
PREVIEW = PAGE / "preview"
NATIVE_OUTPUT = PAGE / "assets/output-native"
TEMPLATE = PREVIEW / "assets/photo3d_pet_r004_cz_cat_006/view.json"
SHARED = PREVIEW / "assets/photo3d_pet_r004_shared"
ASSET_VERSION = "pet-r007-curtain-clear-pets-1"


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
    depth_map = scene / "surface-depth.png"
    normal_map = scene / "surface-normal.png"
    if depth_map.exists() and normal_map.exists():
        view["surfaceLighting"] = {
            "depth": depth_map.name,
            "normal": normal_map.name,
            "depthPivot": 0.34,
            "projectionGain": 0.55,
            "normalGain": 0.55,
            "lightDirection": [-0.52, 0.28, 0.806],
        }
    else:
        view.pop("surfaceLighting", None)
    view["_note"] = (
        f"PET-R007 curtain-clear preview for {pet_id}. The native generated PNG remains at "
        "its original UV. Dense full-frame depth bends only the sampled light field and "
        "dense normals apply bounded multiplicative shading. No subject mask, cutout, "
        "reference-pixel displacement, subject lift, or pet-local compositing is loaded. "
        "The pet group was generated clear of the curtain corridor; current-vs-rest motion "
        "matting and dense-depth occlusion remain as renderer safety layers."
    )
    (scene / "view.json").write_text(
        json.dumps(view, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return scene_id


def main() -> None:
    PREVIEW.mkdir(parents=True, exist_ok=True)
    # The published preview runtime is committed with this page. Do not depend on
    # untracked root-level app files; a clean checkout must be sufficient to rebuild.
    required_runtime = (
        PREVIEW / "viewer.html",
        PREVIEW / "app.js",
        PREVIEW / "style.css",
        PREVIEW / "vendor/three.module.js",
    )
    missing = [str(path.relative_to(ROOT)) for path in required_runtime if not path.exists()]
    if missing:
        raise RuntimeError(f"committed preview runtime is incomplete: {missing}")

    preview_app = PREVIEW / "app.js"
    preview_app.write_text(
        re.sub(
            r'const AV = location\.protocol === "file:" \? "" : "\?a=[^"]+";',
            f'const AV = location.protocol === "file:" ? "" : "?a={ASSET_VERSION}";',
            preview_app.read_text(encoding="utf-8"),
            count=1,
        ),
        encoding="utf-8",
    )
    preview_viewer = PREVIEW / "viewer.html"
    preview_viewer.write_text(
        re.sub(
            r'\./app\.js\?v=[^"\']+',
            f'./app.js?v={ASSET_VERSION}',
            preview_viewer.read_text(encoding="utf-8"),
            count=1,
        ),
        encoding="utf-8",
    )

    curtain_target = PREVIEW / "assets/curtain_exp1"
    curtain_files = tuple(curtain_target / name for name in (
        "meta.json", "light.webp", "motion.mp4", "f006.webp"
    ))
    if missing_curtain := [path.name for path in curtain_files if not path.exists()]:
        raise RuntimeError(f"committed curtain assets are incomplete: {missing_curtain}")
    curtain_meta_path = curtain_target / "meta.json"
    curtain_meta = json.loads(curtain_meta_path.read_text(encoding="utf-8"))
    # A large gust can carry the curtain beyond the former x=0.320 hard cutoff. Let the
    # motion reach its measured extent, but admit only pixels that differ from the rest
    # frame and use dense scene depth to keep the pet, accessories, and plinth in front.
    curtain_meta["maxX"] = 0.58
    curtain_meta["edgeFeather"] = 0.035
    curtain_meta["motionDeltaLow"] = 0.035
    curtain_meta["motionDeltaHigh"] = 0.12
    curtain_meta["foregroundDepthLow"] = 0.24
    curtain_meta["foregroundDepthHigh"] = 0.36
    curtain_meta["_safeZone"] = (
        "PET-R006: current-vs-rest motion delta opens only genuinely moving curtain pixels "
        "through x=0.580, with a 0.035 outer feather. Full-frame dense depth occludes pet, "
        "accessory, and plinth foreground pixels; no pet mask or cutout is used."
    )
    curtain_meta_path.write_text(
        json.dumps(curtain_meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    overlay_target = PREVIEW / "assets/overlay_branch"
    if missing_overlay := [
        name for name in ("meta.json", "motion.mp4") if not (overlay_target / name).exists()
    ]:
        raise RuntimeError(f"committed overlay assets are incomplete: {missing_overlay}")

    shared_light = SHARED / "light"
    expected_light = [shared_light / "ref.webp"] + [
        shared_light / f"l{index:03d}.webp" for index in range(96)
    ]
    if missing_light := [path.name for path in expected_light if not path.exists()]:
        raise RuntimeError(f"committed light field is incomplete: {missing_light}")

    template = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    images = sorted(NATIVE_OUTPUT.glob("*.png"))
    if len(images) != 30:
        raise RuntimeError(f"expected 30 native PET-R004 PNGs, found {len(images)}")

    report = []
    for image in images:
        scene_id = write_scene(image, template)
        scene_dir = PREVIEW / f"assets/photo3d_{scene_id}"
        has_surface = all(
            (scene_dir / name).exists()
            for name in ("surface-depth.png", "surface-normal.png")
        )
        report.append(
            {
                "id": image.stem,
                "scene": scene_id,
                "reference": f"assets/output-native/{image.name}",
                "mask": None,
                "relief": None,
                "surfaceDepth": (
                    f"preview/assets/photo3d_{scene_id}/surface-depth.png"
                    if has_surface else None
                ),
                "surfaceNormal": (
                    f"preview/assets/photo3d_{scene_id}/surface-normal.png"
                    if has_surface else None
                ),
            }
        )
        print(f"{image.stem}: {scene_id}, native PNG, no mask/relief")
    (PREVIEW / "scenes.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (PREVIEW / "mask-contact-sheet.jpg").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
