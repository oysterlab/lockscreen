#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow==11.3.0"]
# ///
"""Promote the reviewed PET-R008 source and output set into the public gallery."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
PAGE = ROOT.parent
MANIFEST = ROOT / "manifest.json"
INPUT = ROOT / "input"
NATIVE = ROOT / "output-native"
PUBLIC_INPUT = PAGE / "assets" / "input"
PUBLIC_NATIVE = PAGE / "assets" / "output-native"
PUBLIC_JPEG = PAGE / "assets" / "output"


def clear_stale(directory: Path, suffix: str, expected: set[str]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for path in directory.glob(f"*{suffix}"):
        if path.name not in expected:
            path.unlink()


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert manifest["status"] in {"ready-for-promotion", "promoted-to-production"}
    items = manifest["items"]
    assert len(items) == 30

    input_names = {f"{item['id']}.jpg" for item in items}
    native_names = {f"{item['id']}.png" for item in items}
    jpeg_names = {f"{item['id']}.jpg" for item in items}
    clear_stale(PUBLIC_INPUT, ".jpg", input_names)
    clear_stale(PUBLIC_NATIVE, ".png", native_names)
    clear_stale(PUBLIC_JPEG, ".jpg", jpeg_names)

    for item in items:
        pet_id = item["id"]
        source = INPUT / item["source"]
        native = NATIVE / f"{pet_id}.png"
        assert source.is_file(), source
        assert native.is_file(), native

        shutil.copy2(source, PUBLIC_INPUT / f"{pet_id}.jpg")
        shutil.copy2(native, PUBLIC_NATIVE / f"{pet_id}.png")
        with Image.open(native) as image:
            assert image.size == (941, 1672), (native, image.size)
            preview = image.convert("RGB").resize((844, 1500), Image.Resampling.LANCZOS)
            preview.save(
                PUBLIC_JPEG / f"{pet_id}.jpg",
                quality=92,
                optimize=True,
                progressive=True,
            )

    shutil.copy2(ROOT / "contact-sheet.jpg", PAGE / "assets" / "contact-sheet.jpg")
    print("Promoted PET-R008: 30 inputs, 30 native PNGs, 30 gallery JPEGs")


if __name__ == "__main__":
    main()
