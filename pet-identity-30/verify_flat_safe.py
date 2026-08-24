#!/usr/bin/env python3
"""Fail if PET-R004 reintroduces pet-local masking or non-native references."""

from __future__ import annotations

import json
import struct
from pathlib import Path


PAGE = Path(__file__).resolve().parent
PREVIEW = PAGE / "preview"
VERSION = "pet-r004-flat-safe-1"


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as stream:
        if stream.read(8) != b"\x89PNG\r\n\x1a\n":
            raise AssertionError(f"not a PNG: {path}")
        length = struct.unpack(">I", stream.read(4))[0]
        chunk = stream.read(4)
        if chunk != b"IHDR" or length < 8:
            raise AssertionError(f"missing PNG IHDR: {path}")
        return struct.unpack(">II", stream.read(8))


def main() -> None:
    manifest = json.loads((PREVIEW / "scenes.json").read_text(encoding="utf-8"))
    assert len(manifest) == 30, f"expected 30 scenes, found {len(manifest)}"

    scene_dirs = sorted(PREVIEW.glob("assets/photo3d_pet_r004_*/view.json"))
    assert len(scene_dirs) == 30, f"expected 30 view.json files, found {len(scene_dirs)}"

    ids = {item["id"] for item in manifest}
    assert len(ids) == 30, "scene manifest contains duplicate IDs"
    for view_path in scene_dirs:
        view = json.loads(view_path.read_text(encoding="utf-8"))
        assert "subject" not in view, f"subject mask reintroduced: {view_path}"
        assert "relief" not in view, f"subject relief reintroduced: {view_path}"
        assert view.get("indirectLight", {}).get("subjectLift") == 0.0, view_path
        reference = view.get("reference", "")
        assert reference.startswith("../../../assets/output-native/"), (
            f"non-native reference: {view_path}: {reference}"
        )
        native = (view_path.parent / reference).resolve()
        assert native.is_file(), f"missing native reference: {native}"
        assert png_size(native) == (941, 1672), f"unexpected native dimensions: {native}"
        assert not (view_path.parent / "subject.webp").exists(), view_path.parent
        assert not (view_path.parent / "relief.webp").exists(), view_path.parent

    assert not list(PREVIEW.glob("assets/**/subject.webp")), "subject mask files remain"
    assert not list(PREVIEW.glob("assets/**/relief.webp")), "subject relief files remain"
    assert not (PREVIEW / "mask-contact-sheet.jpg").exists(), "mask QA artifact remains"

    curtain = json.loads(
        (PREVIEW / "assets/curtain_exp1/meta.json").read_text(encoding="utf-8")
    )
    assert curtain["x1"] == 0.285, curtain
    assert curtain["feather"] == 0.035, curtain
    assert curtain["x1"] + curtain["feather"] <= 0.3200001, curtain

    assert VERSION in (PREVIEW / "app.js").read_text(encoding="utf-8")
    assert f"app.js?v={VERSION}" in (PREVIEW / "viewer.html").read_text(encoding="utf-8")
    assert f"build={VERSION}" in (PAGE / "index.html").read_text(encoding="utf-8")
    print("PASS: 30 native PNG scenes; zero pet masks/relief; curtain safe zone <= x=0.320")


if __name__ == "__main__":
    main()
