#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow==11.3.0"]
# ///
"""Promote the 15 reviewed PET-R009 cats while leaving PET-R008 dogs intact."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
PAGE = ROOT.parent
PUBLIC_NATIVE = PAGE / "assets" / "output-native"
PUBLIC_JPEG = PAGE / "assets" / "output"


def main() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["status"] in {"ready-for-promotion", "promoted-to-production"}
    items = manifest["items"]
    assert len(items) == 15
    assert all(item["id"].split("-")[1] == "CAT" for item in items)

    for item in items:
        pet_id = item["id"]
        native = ROOT / "output-native" / f"{pet_id}.png"
        assert native.is_file(), native
        with Image.open(native) as image:
            assert image.size == (941, 1672), (native, image.size)
            shutil.copy2(native, PUBLIC_NATIVE / native.name)
            preview = image.convert("RGB").resize((844, 1500), Image.Resampling.LANCZOS)
            preview.save(
                PUBLIC_JPEG / f"{pet_id}.jpg",
                quality=92,
                optimize=True,
                progressive=True,
            )

    shutil.copy2(ROOT / "contact-sheet.jpg", PAGE / "assets" / "contact-sheet.jpg")
    shutil.copy2(ROOT / "alignment-review.jpg", PAGE / "assets" / "alignment-review.jpg")
    print("Promoted PET-R009: 15 centred cats; 15 PET-R008 dogs unchanged")


if __name__ == "__main__":
    main()
