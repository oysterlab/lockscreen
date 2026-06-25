#!/usr/bin/env python3
"""Build the nila2dio idle animations as PACKED VIDEOS (low GPU memory).

Earlier this emitted one GPU texture per frame (552 textures, ~150MB). Instead,
each clip becomes ONE h264 mp4 the browser decodes frame-by-frame, so only the
PLAYING clip's current frame lives in GPU (~a few MB total) — and h264 at a high
quality is visually lossless for this.

Each video frame packs three stacked panels (so colour + the per-frame matte +
the per-frame depth travel together, all frame-accurate):
    [ colour RGB ]
    [ alpha gray ]   (grayscale -> stored in luma, stays sharp under 4:2:0)
    [ depth gray ]
The renderer samples the three panels to composite the cat sprite, displaced by
its own per-frame depth (parallax stays right mid-motion). Disocclusion shows the
static bg_color back layer.

Per-frame depth = Depth Anything (node depth.mjs), re-anchored to a constant cat
median (no flicker) and flattened (no internal cliff to smear). Matte = frame
differenced against the existing aligned cat-free plate bg_color (no LaMa). Depth
is recomputed only when the frame changes (reused for near-dups) to bound cost;
COLOUR is per-frame so playback is full 24fps.

Outputs assets/photo3d_nila2dio/anim/: c1.mp4 m1.mp4 m2.mp4 + manifest.json.
Run with system python3 (PIL+numpy) + node depth; ffmpeg for encode.
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
CLIPS = {
    "c1": ROOT / "assets/nila_smell_loop_1.mp4",
    "m1": ROOT / "assets/nila_motion_1.mp4",
    "m2": ROOT / "assets/nila_motion_2.mp4",
}
PLATE_W, PLATE_H = 864, 1536
FPS_OUT = 24
DEPTH_TH = 1.0       # recompute depth when frame changes more than this (else reuse)
PAD = 18
NOISE, RAMP = 18.0, 26.0
CRF = 16             # h264 quality (lower = better; 16 ~ visually lossless here)


def run_depth(src: Path, dst: Path):
    if dst.exists():
        return
    subprocess.run(["node", DEPTH_MJS, str(src), str(dst), "512"], cwd="/tmp/depthtool",
                   env=dict(os.environ, DTYPE="q8"), check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def even(n):
    return n - (n % 2)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*"):
        old.unlink()

    bg_np = np.asarray(Image.open(SCENE / "bg_color.png").convert("RGB")
                       .resize((PLATE_W, PLATE_H)), np.float32)
    subj = Image.open(SCENE / "subject.png").convert("L").resize((PLATE_W, PLATE_H))
    prior = np.asarray(subj.filter(ImageFilter.MaxFilter(75))
                       .filter(ImageFilter.GaussianBlur(14)), np.float32) / 255.0

    def matte(fr):
        dist = np.sqrt(((fr - bg_np) ** 2).sum(2))
        a = np.clip((dist - NOISE) / RAMP, 0, 1) * prior
        am = Image.fromarray((a * 255).astype("uint8"))
        am = am.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(7))
        am = am.filter(ImageFilter.GaussianBlur(1.2))
        return np.asarray(am, np.float32) / 255.0

    def frames_of(tag, vid):
        if not list(WORK.glob(f"{tag}_[0-9][0-9][0-9].png")):
            subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(vid),
                            "-vf", f"fps={FPS_OUT}", str(WORK / f"{tag}_%03d.png")], check=True)
        return sorted(WORK.glob(f"{tag}_[0-9][0-9][0-9].png"))

    # pass 1: union bbox from mattes (sample every other frame to keep it quick)
    x0 = y0 = 10**9; x1 = y1 = -1
    for tag, vid in CLIPS.items():
        for f in frames_of(tag, vid)[::2]:
            fr = np.asarray(Image.open(f).convert("RGB").resize((PLATE_W, PLATE_H)), np.float32)
            ys, xs = np.where(matte(fr) > 0.5)
            if len(xs):
                x0 = min(x0, xs.min()); x1 = max(x1, xs.max())
                y0 = min(y0, ys.min()); y1 = max(y1, ys.max())
    x0 = max(0, x0 - PAD); y0 = max(0, y0 - PAD)
    x1 = min(PLATE_W, x1 + PAD); y1 = min(PLATE_H, y1 + PAD)
    bw, bh = even(x1 - x0), even(y1 - y0)
    x1, y1 = x0 + bw, y0 + bh
    rect = [x0 / PLATE_W, 1 - y1 / PLATE_H, x1 / PLATE_W, 1 - y0 / PLATE_H]

    # pass 2: per clip, emit all frames packed [colour|alpha|depth] -> mp4
    ref_med = None
    manifest = {"kind": "video3d", "fps": FPS_OUT, "panels": 3,
                "rect": [round(float(v), 6) for v in rect], "clips": list(CLIPS)}
    for tag, vid in CLIPS.items():
        fdir = WORK / f"pack_{tag}"; fdir.mkdir(exist_ok=True)
        for p in fdir.glob("*.png"):
            p.unlink()
        last_color = None
        last_depth = None
        frames = frames_of(tag, vid)
        for i, f in enumerate(frames):
            fr = np.asarray(Image.open(f).convert("RGB").resize((PLATE_W, PLATE_H)), np.float32)
            a = matte(fr)
            if last_color is None or float(np.abs(fr - last_color).mean()) > DEPTH_TH:
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
                    sm = np.asarray(Image.fromarray(dep.astype("uint8")).filter(ImageFilter.GaussianBlur(4)), np.float32)
                    cmean = float(sm[m].mean())
                    dep = np.clip(cmean + (sm - cmean) * 0.4, 0, 255)
                last_depth = dep
                last_color = fr
            dep = last_depth
            col = fr.astype("uint8")[y0:y1, x0:x1]
            al = (a * 255).astype("uint8")[y0:y1, x0:x1]
            d8 = dep.astype("uint8")[y0:y1, x0:x1]
            packed = np.vstack([col, np.dstack([al] * 3), np.dstack([d8] * 3)])
            Image.fromarray(packed).save(fdir / f"{i:04d}.png")
        # PALINDROME (forward + reverse) so each clip starts AND ends on frame 0 —
        # the source videos don't loop (their last frame differs from the first by
        # ~12-18), which made the hold pose jump to the next clip's start. Out-and-back
        # returns to rest seamlessly (and reads naturally: lean in to smell, lean out).
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS_OUT),
                        "-i", str(fdir / "%04d.png"),
                        "-filter_complex", "[0:v]reverse[r];[0:v][r]concat=n=2:v=1[v]", "-map", "[v]",
                        "-c:v", "libx264", "-crf", str(CRF),
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT / f"{tag}.mp4")],
                       check=True)
        kb = (OUT / f"{tag}.mp4").stat().st_size // 1024
        print(f"{tag}: {len(frames)} frames -> {tag}.mp4 {kb}KB")

    (OUT / "manifest.json").write_text(json.dumps(manifest))
    total = sum((OUT / f"{t}.mp4").stat().st_size for t in CLIPS) // 1024
    print(f"bbox=({x0},{y0},{x1},{y1}) panel={bw}x{bh} rect={manifest['rect']} total={total}KB")


if __name__ == "__main__":
    main()
