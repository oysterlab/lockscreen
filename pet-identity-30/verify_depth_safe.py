#!/usr/bin/env python3
"""Regression checks for PET-R005's mask-free depth/normal relighting."""

from __future__ import annotations

import hashlib
import json
import re
import struct
from pathlib import Path


PAGE = Path(__file__).resolve().parent
PREVIEW = PAGE / "preview"
SURFACE_VERSION = "pet-r005-depth-normal-1"
RUNTIME_VERSION = "pet-r009-centered-cats-1"
MAP_SIZE = (941, 1672)


def png_info(path: Path) -> tuple[int, int, int, int]:
    with path.open("rb") as stream:
        if stream.read(8) != b"\x89PNG\r\n\x1a\n":
            raise AssertionError(f"not a PNG: {path}")
        length = struct.unpack(">I", stream.read(4))[0]
        chunk = stream.read(4)
        if chunk != b"IHDR" or length < 13:
            raise AssertionError(f"missing PNG IHDR: {path}")
        width, height, bit_depth, color_type = struct.unpack(">IIBB", stream.read(10))
        return width, height, bit_depth, color_type


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    current_manifest = json.loads(
        (PAGE / "generation-r008/manifest.json").read_text(encoding="utf-8")
    )
    centered_manifest = json.loads(
        (PAGE / "generation-r009/manifest.json").read_text(encoding="utf-8")
    )
    centered_qa = json.loads(
        (PAGE / "generation-r009/qa-measurements.json").read_text(encoding="utf-8")
    )
    previous_manifest = json.loads(
        (PAGE / "generation-r007/manifest.json").read_text(encoding="utf-8")
    )
    current_ids = {item["id"] for item in current_manifest["items"]}
    previous_ids = {item["id"] for item in previous_manifest["items"]}
    assert len(current_ids) == 30, "PET-R008 manifest does not contain 30 distinct IDs"
    assert not current_ids & previous_ids, "PET-R008 repeats PET-R007 IDs"
    centered_ids = {item["id"] for item in centered_manifest["items"]}
    assert len(centered_ids) == 15, "PET-R009 does not contain exactly 15 cats"
    assert centered_ids <= current_ids, "PET-R009 cat IDs differ from PET-R008"
    assert all(pet_id.startswith(("CZ-CAT-", "RC-CAT-")) for pet_id in centered_ids)
    qa_items = centered_qa["items"]
    assert {item["id"] for item in qa_items} == centered_ids, "PET-R009 QA ID mismatch"
    assert all(item["sizeGate"] == "size-maintained" for item in qa_items)
    assert max(item["widthRatio"] for item in qa_items) <= 1.015
    assert min(item["widthRatio"] for item in qa_items) >= 0.96
    assert max(item["alignmentErrorPixels"] for item in qa_items) <= 24

    input_ids = {path.stem for path in (PAGE / "assets/input").glob("*.jpg")}
    native_ids = {path.stem for path in (PAGE / "assets/output-native").glob("*.png")}
    jpeg_ids = {path.stem for path in (PAGE / "assets/output").glob("*.jpg")}
    page_ids = set(
        re.findall(
            r"\{id:'([^']+)', species:'(?:cat|dog)'",
            (PAGE / "index.html").read_text(encoding="utf-8"),
        )
    )
    assert input_ids == current_ids, "public input IDs differ from PET-R008 manifest"
    assert native_ids == current_ids, "native output IDs differ from PET-R008 manifest"
    assert jpeg_ids == current_ids, "gallery output IDs differ from PET-R008 manifest"
    assert page_ids == current_ids, "page IDs differ from PET-R008 manifest"
    for pet_id in centered_ids:
        assert digest(PAGE / "assets/output-native" / f"{pet_id}.png") == digest(
            PAGE / "generation-r009/output-native" / f"{pet_id}.png"
        ), f"public cat is not PET-R009: {pet_id}"
    for pet_id in current_ids - centered_ids:
        assert digest(PAGE / "assets/output-native" / f"{pet_id}.png") == digest(
            PAGE / "generation-r008/output-native" / f"{pet_id}.png"
        ), f"PET-R008 dog changed unexpectedly: {pet_id}"

    manifest = json.loads((PREVIEW / "scenes.json").read_text(encoding="utf-8"))
    assert len(manifest) == 30, f"expected 30 scenes, found {len(manifest)}"
    assert len({item["id"] for item in manifest}) == 30, "duplicate scene IDs"
    assert {item["id"] for item in manifest} == current_ids, "scene IDs differ from PET-R008"

    views = sorted(PREVIEW.glob("assets/photo3d_pet_r004_*/view.json"))
    assert len(views) == 30, f"expected 30 view.json files, found {len(views)}"
    depth_hashes: set[str] = set()
    normal_hashes: set[str] = set()

    for view_path in views:
        view = json.loads(view_path.read_text(encoding="utf-8"))
        assert "subject" not in view, f"subject mask reintroduced: {view_path}"
        assert "relief" not in view, f"pet-only relief reintroduced: {view_path}"
        assert view.get("indirectLight", {}).get("subjectLift") == 0.0, view_path

        reference = view.get("reference", "")
        assert reference.startswith("../../../assets/output-native/"), view_path
        native = (view_path.parent / reference).resolve()
        assert native.is_file(), f"missing native reference: {native}"
        assert png_info(native)[:2] == MAP_SIZE, native

        surface = view.get("surfaceLighting")
        assert isinstance(surface, dict), f"missing dense surface lighting: {view_path}"
        assert 0.0 <= float(surface["depthPivot"]) <= 0.5, view_path
        assert 0.0 < float(surface["projectionGain"]) <= 0.6, view_path
        assert 0.0 < float(surface["normalGain"]) <= 0.6, view_path
        assert len(surface["lightDirection"]) == 3, view_path

        depth = view_path.parent / surface["depth"]
        normal = view_path.parent / surface["normal"]
        meta = view_path.parent / "surface-meta.json"
        assert png_info(depth) == (*MAP_SIZE, 8, 0), depth
        assert png_info(normal) == (*MAP_SIZE, 8, 2), normal
        assert depth.stat().st_size > 12_000, f"suspiciously small depth map: {depth}"
        assert normal.stat().st_size > 18_000, f"suspiciously small normal map: {normal}"
        depth_hashes.add(digest(depth))
        normal_hashes.add(digest(normal))

        metadata = json.loads(meta.read_text(encoding="utf-8"))
        assert metadata["pipeline"] == SURFACE_VERSION, meta
        assert metadata["depthConvention"] == "near=1, far=0", meta
        assert "no pet mask or alpha matte" in metadata["invariants"], meta

        assert not (view_path.parent / "subject.webp").exists(), view_path.parent
        assert not (view_path.parent / "relief.webp").exists(), view_path.parent

    assert len(depth_hashes) == 30, "depth maps are not scene-specific"
    assert len(normal_hashes) == 30, "normal maps are not scene-specific"
    assert not list(PREVIEW.glob("assets/**/subject.webp")), "subject mask files remain"
    assert not list(PREVIEW.glob("assets/**/relief.webp")), "pet relief files remain"

    curtain = json.loads(
        (PREVIEW / "assets/curtain_exp1/meta.json").read_text(encoding="utf-8")
    )
    assert 0.45 <= curtain["maxX"] <= curtain["stripWidth"], curtain
    assert 0.02 <= curtain["edgeFeather"] <= 0.05, curtain
    assert 0.0 < curtain["motionDeltaLow"] < curtain["motionDeltaHigh"] < 0.2, curtain
    assert 0.0 < curtain["foregroundDepthLow"] < curtain["foregroundDepthHigh"] < 0.5, curtain

    app = (PREVIEW / "app.js").read_text(encoding="utf-8")
    assert "vec3 ref = texture2D(uRef, vUv).rgb;" in app
    assert "max(rawDepth - uDepthPivot, 0.0)" in app
    assert "surfaceConfidence = smoothstep" in app
    assert "ratio *= clamp(shape, 0.88, 1.12);" in app
    assert "motionDelta = max" in app
    assert "background = mix(1.0, background, uHasRelief);" in app
    assert RUNTIME_VERSION in app
    assert f"app.js?v={RUNTIME_VERSION}" in (PREVIEW / "viewer.html").read_text(encoding="utf-8")
    assert f"build={RUNTIME_VERSION}" in (PAGE / "index.html").read_text(encoding="utf-8")
    assert (PREVIEW / "surface-contact-sheet.jpg").stat().st_size > 100_000

    print(
        "PASS: PET-R009 has 15 centred, size-bounded cats and 15 byte-identical "
        "PET-R008 dogs; PET-R008/PET-R007 ID intersection 0; 30 synchronized inputs, "
        "outputs, page cards, and dense depth + normal scenes; native reference UV immutable; "
        "zero pet masks/relief; unclipped depth-occluded curtain motion; "
        "normal shading clamped to 0.88..1.12"
    )


if __name__ == "__main__":
    main()
