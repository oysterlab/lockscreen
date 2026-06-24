#!/usr/bin/env python3
"""Build the nila2dio idle "smell" animation as per-frame 3D cat sprites.

Each frame is processed like the still 3D-photo so parallax stays correct while
the cat moves:
  * per-frame DEPTH - Depth Anything (scripts/depth.mjs via node), re-anchored so
    the cat's median depth is constant frame-to-frame (kills depth flicker).
  * cat matte       - differenced against the scene's EXISTING cat-free back plate
    (assets/photo3d_nila2dio/bg_color.png), gated by a dilated rest-cat prior. No
    LaMa / regeneration: that clean background already exists and is aligned.
  * sprite          - color(RGBA)+depth cropped to one shared bbox. The renderer
    draws it over the static scene, displaced by its own per-frame depth; where the
    cat moves away the bg_color back layer shows through.

Only the cat region is stored per frame. c1 (flower-smell) first.
Pure PIL+numpy + node depth (no venv/torch).  python3 scripts/build_nila_anim.py
"""
import json
import os
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path("/Users/shin/Desktop/lockscreen")
SCENE = ROOT / "assets" / "photo3d_nila2dio"
OUT = SCENE / "anim"
WORK = Path("/tmp/nila_build"); WORK.mkdir(exist_ok=True)
DEPTH_MJS = "/tmp/depthtool/depth.mjs"
CLIPS = {"c1": ROOT / "assets/nila_smell_loop_1.mp4"}   # flower-smell first
PLATE_W, PLATE_H = 864, 1536
FPS_OUT = 8
SCALE = 0.85
DEDUP_TH = 1.4
PAD = 18
NOISE, RAMP = 16.0, 42.0


def run_depth(src: Path, dst: Path):
    if dst.exists():
        return
    subprocess.run(["node", DEPTH_MJS, str(src), str(dst), "1024"], cwd="/tmp/depthtool",
                   env=dict(os.environ, DTYPE="q8"), check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*"):
        old.unlink()

    # the existing aligned cat-free back plate = matte reference AND disocclusion fill
    bg_np = np.asarray(Image.open(SCENE / "bg_color.png").convert("RGB")
                       .resize((PLATE_W, PLATE_H)), np.float32)
    subj = Image.open(SCENE / "subject.png").convert("L").resize((PLATE_W, PLATE_H))
    prior = np.asarray(subj.filter(ImageFilter.MaxFilter(75))
                       .filter(ImageFilter.GaussianBlur(14)), np.float32) / 255.0

    ref_med = None
    x0 = y0 = 10**9; x1 = y1 = -1
    per_clip = {}
    for tag, vid in CLIPS.items():
        if not list(WORK.glob(f"{tag}_[0-9][0-9][0-9].png")):
            subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(vid),
                            "-vf", f"fps={FPS_OUT}", str(WORK / f"{tag}_%03d.png")], check=True)
        frames = sorted(WORK.glob(f"{tag}_[0-9][0-9][0-9].png"))
        kept, timeline, last = [], [], None
        for f in frames:
            fr = np.asarray(Image.open(f).convert("RGB").resize((PLATE_W, PLATE_H)), np.float32)
            if last is not None and float(np.abs(fr - last).mean()) <= DEDUP_TH:
                timeline.append(len(kept) - 1)
                continue
            dist = np.sqrt(((fr - bg_np) ** 2).sum(2))
            a = np.clip((dist - NOISE) / RAMP, 0, 1) * prior
            am = Image.fromarray((a * 255).astype("uint8"))
            am = am.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
            am = am.filter(ImageFilter.GaussianBlur(2.0))
            a = np.asarray(am, np.float32) / 255.0

            src = WORK / f"{f.stem}_864.png"
            if not src.exists():
                Image.fromarray(fr.astype("uint8")).save(src)
            dcache = WORK / f"{f.stem}_depth.png"
            run_depth(src, dcache)
            dep = np.asarray(Image.open(dcache).convert("L").resize((PLATE_W, PLATE_H)), np.float32)

            m = a > 0.5
            if m.sum() > 200:
                med = float(np.median(dep[m]))
                if ref_med is None:
                    ref_med = med
                dep = np.clip(dep + (ref_med - med), 0, 255)
                ys, xs = np.where(m)
                x0 = min(x0, xs.min()); x1 = max(x1, xs.max())
                y0 = min(y0, ys.min()); y1 = max(y1, ys.max())
            kept.append({"rgb": fr.astype("uint8"), "a": (a * 255).astype("uint8"),
                         "d": dep.astype("uint8")})
            last = fr
            timeline.append(len(kept) - 1)
        per_clip[tag] = (kept, timeline)
        print(f"{tag}: frames={len(frames)} kept={len(kept)}")

    x0 = max(0, x0 - PAD); y0 = max(0, y0 - PAD)
    x1 = min(PLATE_W - 1, x1 + PAD); y1 = min(PLATE_H - 1, y1 + PAD)
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    sw, sh = round(bw * SCALE), round(bh * SCALE)
    rect = [x0 / PLATE_W, 1 - (y1 + 1) / PLATE_H, (x1 + 1) / PLATE_W, 1 - y0 / PLATE_H]

    manifest = {"kind": "sprite3d", "fps": FPS_OUT, "hold": 0,
                "rect": [round(float(v), 6) for v in rect], "clips": {}}
    total = 0
    for tag, (kept, timeline) in per_clip.items():
        for i, fr in enumerate(kept):
            rgba = np.dstack([fr["rgb"], fr["a"]])[y0:y1 + 1, x0:x1 + 1]
            dep = fr["d"][y0:y1 + 1, x0:x1 + 1]
            Image.fromarray(rgba).resize((sw, sh), Image.LANCZOS).save(OUT / f"{tag}_c{i:02d}.png")
            Image.fromarray(dep).resize((sw, sh), Image.LANCZOS).save(OUT / f"{tag}_d{i:02d}.png")
        manifest["clips"][tag] = {"count": len(kept), "frames": timeline}
        kb = sum(p.stat().st_size for p in OUT.glob(f"{tag}_*.png")) // 1024
        gpu = len(kept) * sw * sh * 4 * 2 // (1024 * 1024)
        total += kb
        print(f"{tag}: unique={len(kept)} png={kb}KB gpu~{gpu}MB")

    (OUT / "manifest.json").write_text(json.dumps(manifest))
    print(f"bbox=({x0},{y0},{x1},{y1}) sprite={sw}x{sh} rect={manifest['rect']} total={total}KB")


if __name__ == "__main__":
    main()
