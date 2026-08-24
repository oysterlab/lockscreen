#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# ///
"""Copy the locked PET-R008 source set and prove it is disjoint from PET-R007."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "manifest.json"
PREVIOUS = ROOT.parent / "generation-r007" / "manifest.json"
PREVIOUS_INPUT = ROOT.parent / "assets" / "input"
OUTPUT = ROOT / "input"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pool", required=True, type=Path)
    args = parser.parse_args()

    current = json.loads(MANIFEST.read_text(encoding="utf-8"))["items"]
    previous = json.loads(PREVIOUS.read_text(encoding="utf-8"))["items"]
    ids = [item["id"] for item in current]
    sources = [item["source"] for item in current]
    previous_ids = {item["id"] for item in previous}
    species = Counter(item["species"] for item in current)

    assert len(current) == 30, f"expected 30 items, got {len(current)}"
    assert species == {"cat": 15, "dog": 15}, f"unexpected species counts: {species}"
    assert len(set(ids)) == 30, "duplicate PET-R008 IDs"
    assert len(set(sources)) == 30, "duplicate PET-R008 source filenames"
    overlap = sorted(set(ids) & previous_ids)
    assert not overlap, f"PET-R007 ID overlap: {overlap}"

    matches: list[tuple[dict[str, str], Path]] = []
    for item in current:
        found = list(args.pool.rglob(item["source"]))
        assert len(found) == 1, f"expected one source for {item['id']}, got {found}"
        matches.append((item, found[0]))

    hashes = [sha256(path) for _, path in matches]
    assert len(set(hashes)) == 30, "duplicate source contents detected by SHA-256"
    previous_hashes = {sha256(path) for path in PREVIOUS_INPUT.glob("*.jpg")}
    hash_overlap = sorted(set(hashes) & previous_hashes)
    assert not hash_overlap, f"PET-R007 source hash overlap: {hash_overlap}"

    OUTPUT.mkdir(parents=True, exist_ok=True)
    expected = set(sources)
    for stale in OUTPUT.glob("*.jpg"):
        if stale.name not in expected:
            stale.unlink()
    for _, source in matches:
        shutil.copy2(source, OUTPUT / source.name)

    result = {
        "count": len(matches),
        "species": species,
        "previousIdIntersection": overlap,
        "previousSourceHashIntersection": hash_overlap,
        "distinctSourceHashes": len(set(hashes)),
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
