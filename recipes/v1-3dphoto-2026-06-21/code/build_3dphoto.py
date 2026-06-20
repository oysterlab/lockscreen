"""Build assets for the 3D-photo (depth-mesh) renderer.

Front mesh = original plate displaced by depth, with depth "cliffs" cut out.
Back  mesh = a LaMa-inpainted plate (foreground + cliffs removed and filled) so
the cut holes reveal sharp, plausible background instead of a stretched smear.

Outputs to assets/photo3d/:
  fg_color.png  (= plate)            cliff.png  (front-mesh cut mask)
  fg_depth.png  (= depth)            bg_color.png / bg_depth.png (LaMa filled)

Run with the opencv+torch venv:
  /private/tmp/image-clean-venv/bin/python scripts/build_3dphoto.py
"""
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

ROOT = Path("/Users/shin/Desktop/lockscreen")
PLATE = ROOT / "assets/depth/plate_clean.png"
DEPTH = ROOT / "assets/depth/depth.png"
CATM = ROOT / "assets/depth/subject_mask.png"
OUT = ROOT / "assets/photo3d"
OUT.mkdir(exist_ok=True)

CLIFF_T = 14   # depth-gradient magnitude above this is a discontinuity ("cliff")


def ell(px):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (px, px))


def guided_filter(guide, src, r, eps):
    """Edge-aware filter that snaps `src` (depth) edges onto `guide` (colour) edges,
    so thin silhouettes (twigs, wires) get a crisp depth wall -> a precise cut."""
    g = guide.astype(np.float32)
    p = src.astype(np.float32)
    k = (r, r)
    mean_g = cv2.boxFilter(g, -1, k)
    mean_p = cv2.boxFilter(p, -1, k)
    mean_gp = cv2.boxFilter(g * p, -1, k)
    cov = mean_gp - mean_g * mean_p
    mean_gg = cv2.boxFilter(g * g, -1, k)
    var = mean_gg - mean_g * mean_g
    a = cov / (var + eps)
    b = mean_p - a * mean_g
    return cv2.boxFilter(a, -1, k) * g + cv2.boxFilter(b, -1, k)


def lama_inpaint(rgb_u8, mask_u8):
    """Sharp ML inpaint via LaMa; mask: 255 = fill."""
    from simple_lama_inpainting import SimpleLama
    lama = SimpleLama()
    out = lama(Image.fromarray(rgb_u8), Image.fromarray(mask_u8).convert("L"))
    return np.asarray(out.convert("RGB"))


def main():
    plate_rgb = np.array(Image.open(PLATE).convert("RGB"))
    depth = np.array(Image.open(DEPTH).convert("L"))
    cat = np.array(Image.open(CATM).convert("L"))
    H, W = depth.shape

    # colour-guided depth refine: snap depth edges onto the photo's edges so thin
    # silhouettes (twigs, wires, lamp arm) get a crisp depth wall and cut cleanly,
    # instead of a fuzzy depth ramp that stretches/ghosts at the cut.
    gray = cv2.cvtColor(plate_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    dep = cv2.medianBlur(depth, 5).astype(np.float32) / 255.0
    dep = guided_filter(gray, dep, r=4, eps=1e-4)
    dep = guided_filter(gray, dep, r=2, eps=1e-4)
    depth_s = np.clip(dep * 255.0, 0, 255).astype(np.uint8)

    # The colour guide bakes the cat's knit-hat / fur texture into the depth, which
    # makes the per-pixel cut stipple a dotted "noise" line along the cat silhouette.
    # Smooth depth INSIDE the cat only (its outer silhouette wall stays sharp), so
    # the cut is a clean edge instead of speckle.
    catm = cv2.morphologyEx((cat > 100).astype(np.uint8) * 255, cv2.MORPH_CLOSE, ell(15))
    catf = (cv2.GaussianBlur(catm, (0, 0), 2.5).astype(np.float32) / 255.0)
    cat_smooth = cv2.GaussianBlur(depth_s, (0, 0), 3.5)
    depth_s = (depth_s * (1 - catf) + cat_smooth * catf).astype(np.uint8)

    # cliff mask: where depth changes sharply (object silhouettes). Keep the cut
    # band THIN so only a sliver of the softer inpainted back shows through.
    gx = cv2.Sobel(depth_s.astype(np.float32), cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(depth_s.astype(np.float32), cv2.CV_32F, 0, 1, ksize=3)
    grad = cv2.magnitude(gx, gy)
    cliff = (grad > CLIFF_T * 4).astype(np.uint8) * 255
    cliff = cv2.morphologyEx(cliff, cv2.MORPH_CLOSE, ell(5))
    cliff = cv2.dilate(cliff, ell(5))

    # region the back layer must reconstruct: the whole cat + every cliff band
    catm = (cat > 100).astype(np.uint8) * 255
    fill = cv2.bitwise_or(cliff, cv2.dilate(catm, ell(7)))
    fill = cv2.dilate(fill, ell(3))

    print("inpainting colour with LaMa ...")
    bg_color = lama_inpaint(plate_rgb, fill)
    print("inpainting depth with LaMa ...")
    depth_rgb = cv2.cvtColor(depth_s, cv2.COLOR_GRAY2RGB)
    bg_depth_rgb = lama_inpaint(depth_rgb, fill)
    bg_depth = cv2.cvtColor(bg_depth_rgb, cv2.COLOR_RGB2GRAY)

    # cat "protect" map: where the cut should be CONSERVATIVE. The cat's moderate
    # edges (hat brim vs gate) must not be cut (cutting them stipples a dotted
    # noise line), while the rest of the scene (tree vs sky) must be cut to avoid
    # smear. A single global threshold can't separate the two -> spatial map.
    protect = cv2.GaussianBlur(cv2.dilate(catm, ell(11)), (0, 0), 5)
    Image.fromarray(protect).save(OUT / "protect.png")

    Image.fromarray(plate_rgb).save(OUT / "fg_color.png")
    Image.fromarray(depth_s).save(OUT / "fg_depth.png")
    Image.fromarray(cliff).save(OUT / "cliff.png")
    Image.fromarray(bg_color).save(OUT / "bg_color.png")
    Image.fromarray(bg_depth).save(OUT / "bg_depth.png")

    print("cliff %", round(100 * (cliff > 127).mean(), 1))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
