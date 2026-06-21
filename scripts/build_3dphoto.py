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
import os
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

ROOT = Path("/Users/shin/Desktop/lockscreen")
# scene paths are env-overridable so the same pipeline runs on new dioramas
PLATE = Path(os.environ.get("SCENE_PLATE", ROOT / "assets/depth/plate_clean.png"))
DEPTH = Path(os.environ.get("SCENE_DEPTH", ROOT / "assets/depth/depth.png"))
CATM = Path(os.environ.get("SCENE_CAT", ROOT / "assets/depth/subject_mask.png"))
OUT = Path(os.environ.get("SCENE_OUT", ROOT / "assets/photo3d"))
OUT.mkdir(parents=True, exist_ok=True)

CLIFF_T = 14   # depth-gradient magnitude above this is a discontinuity ("cliff")
# piecewise-flat depth: a DEPTH-domain bilateral flattens depth-smooth interiors
# (an object body, the ground) so they translate rigidly under parallax (no warp),
# while keeping depth cliffs (object silhouettes) sharp -> objects stay at distinct
# depths (3D between them) but don't shear within themselves (diorama / pop-up book).
FLAT_SC = float(os.environ.get("FLAT_SC", 26))    # bilateral range sigma (depth units)
FLAT_SS = float(os.environ.get("FLAT_SS", 32))    # bilateral spatial sigma (px)
FLAT_ITERS = int(os.environ.get("FLAT_ITERS", 3))
FLAT_MIX = float(os.environ.get("FLAT_MIX", 0.7))  # 0 = full relief, 1 = fully flat


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
    # piecewise-flat pass: a DEPTH-domain bilateral flattens depth-smooth interiors
    # (object bodies, the ground) toward a constant depth so they translate RIGIDLY
    # under parallax instead of warping, while keeping depth cliffs (silhouettes)
    # sharp. Unlike a colour-guided filter, this ignores in-object texture, so a
    # textured midground object (the scooter) actually flattens.
    d8 = np.clip(dep * 255.0, 0, 255).astype(np.uint8)
    for _ in range(FLAT_ITERS):
        d8 = cv2.bilateralFilter(d8, 0, FLAT_SC, FLAT_SS)  # d=0 -> kernel from sigmaSpace
    flat = d8.astype(np.float32) / 255.0
    dep = dep * (1.0 - FLAT_MIX) + flat * FLAT_MIX
    depth_s = np.clip(dep * 255.0, 0, 255).astype(np.uint8)

    # The colour guide bakes the cat's knit-hat / fur texture into the depth, which
    # makes the per-pixel cut stipple a dotted "noise" line along the cat silhouette.
    # Smooth depth INSIDE the cat only (its outer silhouette wall stays sharp), so
    # the cut is a clean edge instead of speckle.
    catm = cv2.morphologyEx((cat > 100).astype(np.uint8) * 255, cv2.MORPH_CLOSE, ell(15))
    catf = (cv2.GaussianBlur(catm, (0, 0), 2.5).astype(np.float32) / 255.0)
    # smooth out knit/fur stipple AND compress the subject's internal depth toward
    # its mean, so it moves as ONE coherent plane instead of the near centre and far
    # edges shearing apart ("split into two depths").
    mask = catm > 127
    cat_smooth = cv2.GaussianBlur(depth_s, (0, 0), 3.5).astype(np.float32)
    if mask.sum() > 500:
        mean = float(cat_smooth[mask].mean())
        cat_smooth = mean + (cat_smooth - mean) * 0.45  # 0.45 = flatten internal depth
    depth_s = (depth_s * (1 - catf) + cat_smooth * catf).astype(np.uint8)

    # extra RIGID objects (thin foreground structures such as the tree) flattened to
    # a near-constant depth so they translate as ONE plane under parallax instead of
    # the thin leaves/twigs shearing. SCENE_RIGID = comma-separated matte PNGs (alpha).
    for rp in filter(None, os.environ.get("SCENE_RIGID", "").split(",")):
        ralpha = np.array(Image.open(rp.strip()).convert("RGBA"))[:, :, 3]
        rm = ralpha > 40
        if rm.sum() < 200:
            continue
        rf = cv2.GaussianBlur(rm.astype(np.uint8) * 255, (0, 0), 2.5).astype(np.float32) / 255.0
        rmean = float(depth_s[rm].mean())
        flatr = rmean + (depth_s.astype(np.float32) - rmean) * 0.30
        depth_s = (depth_s * (1 - rf) + flatr * rf).astype(np.uint8)
        print("rigid-flattened:", rp.strip())

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

    scene_bg = os.environ.get("SCENE_BG")
    if scene_bg:
        # use a pre-made background plate (e.g. a Codex generative inpaint of the
        # cat-removed scene) instead of LaMa for the colour back layer.
        print("using external background:", scene_bg)
        bg_color = np.array(Image.open(scene_bg).convert("RGB").resize(plate_rgb.shape[1::-1]))
    else:
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

    # v3 soft-LDI: a SOFT subject matte. The renderer draws the subject as its own
    # alpha-matted layer over the filled back layer, so the silhouette composites
    # with a soft edge instead of a feathered depth-cut. This removes BOTH the
    # stipple (no cut on the subject) AND the rubber-sheet stretch at the subject
    # edge (the protect map used to trade stipple for stretch). Feather the matte
    # over a few px; the back layer (LaMa) shows through behind the moving subject.
    subject = cv2.GaussianBlur(catm, (0, 0), 2.4)
    Image.fromarray(subject).save(OUT / "subject.png")

    Image.fromarray(plate_rgb).save(OUT / "fg_color.png")
    Image.fromarray(depth_s).save(OUT / "fg_depth.png")
    Image.fromarray(cliff).save(OUT / "cliff.png")
    Image.fromarray(bg_color).save(OUT / "bg_color.png")
    Image.fromarray(bg_depth).save(OUT / "bg_depth.png")

    print("cliff %", round(100 * (cliff > 127).mean(), 1))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
