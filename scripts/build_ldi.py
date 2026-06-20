"""Build a continuous Layered Depth Image (LDI) for the lock screen.

Three colour layers + a packed per-layer depth map. The renderer displaces each
layer per-pixel by its own (continuous) depth, and composites near over mid over
far. Big depth jumps (cat<->scene, pole<->sky) fall on the layer boundaries, which
are inpainted, so they don't smear; small jumps inside a layer move continuously,
so the scene still has smooth depth. Cuts are at natural edges (cat silhouette,
sky gap) so no object is split.

Run with the opencv venv:
  /private/tmp/image-clean-venv/bin/python scripts/build_ldi.py
"""
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

ROOT = Path("/Users/shin/Desktop/lockscreen")
PLATE = ROOT / "assets/depth/plate_clean.png"
DEPTH = ROOT / "assets/depth/depth.png"
CATM = ROOT / "assets/depth/subject_mask.png"
OUT = ROOT / "assets/ldi"
OUT.mkdir(exist_ok=True)

FAR_T = 70   # depth < FAR_T -> far layer (sky + distant city + tower)


def ell(px):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (px, px))


def feather(mask_u8, sigma):
    return cv2.GaussianBlur(mask_u8, (0, 0), sigma)


def grabcut_cat(bgr, cat, depth):
    H, W = cat.shape
    loose = (cat > 90).astype(np.uint8)
    gc = np.full((H, W), cv2.GC_PR_BGD, np.uint8)
    gc[loose > 0] = cv2.GC_PR_FGD
    core = cv2.erode(loose, ell(25))
    gc[(core > 0) & (depth > 150)] = cv2.GC_FGD
    keep = cv2.dilate(loose, ell(35))
    gc[keep == 0] = cv2.GC_BGD
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(bgr, gc, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
    ref = (((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD))).astype(np.uint8) * 255
    ref = cv2.morphologyEx(ref, cv2.MORPH_OPEN, ell(7))
    ref = cv2.morphologyEx(ref, cv2.MORPH_CLOSE, ell(15))
    return ref


def main():
    plate = cv2.cvtColor(np.array(Image.open(PLATE).convert("RGB")), cv2.COLOR_RGB2BGR)
    depth = np.array(Image.open(DEPTH).convert("L"))
    cat = np.array(Image.open(CATM).convert("L"))

    # smooth depth so within-layer motion is continuous and free of speckle tears
    depth_s = cv2.medianBlur(depth, 5)
    depth_s = cv2.GaussianBlur(depth_s, (0, 0), 2.5)

    # --- region masks (cuts only at natural edges) ---
    near = grabcut_cat(plate, cat, depth)                  # cat + hat, intact
    far_region = ((depth_s < FAR_T) & (near == 0)).astype(np.uint8) * 255
    mid_region = ((depth_s >= FAR_T) & (near == 0)).astype(np.uint8) * 255

    # tight cat matte: erode just inside the silhouette to drop the grabCut fringe,
    # then a thin feather. This kills the soft "sticker" halo around the cat.
    near_core = cv2.erode(near, ell(5))
    near_a = feather(near_core, 1.3)
    mid_a = feather(cv2.bitwise_or(mid_region, near), 2.6)  # mid covers behind cat

    # --- colour layers ---
    mid_under = cv2.inpaint(plate, dilate := cv2.dilate(near, ell(7)), 6, cv2.INPAINT_TELEA)
    near_norm = (near.astype(np.float32) / 255.0)[..., None]
    mid_color = (plate * (1 - near_norm) + mid_under * near_norm).astype(np.uint8)

    far_fill = cv2.dilate(cv2.bitwise_or(mid_region, near), ell(7))
    far_color = cv2.inpaint(plate, far_fill, 6, cv2.INPAINT_TELEA)

    # --- per-layer depth (filled under each foreground so reveals move correctly) ---
    near_depth = depth_s   # raw smooth depth (amplifying it warps the cat)
    mid_depth = cv2.inpaint(depth_s, cv2.dilate(near, ell(7)), 6, cv2.INPAINT_TELEA)
    far_depth = cv2.inpaint(depth_s, far_fill, 6, cv2.INPAINT_TELEA)
    pack = np.dstack([far_depth, mid_depth, near_depth])    # R=far, G=mid, B=near

    def save_rgba(bgr, a, path):
        Image.fromarray(np.dstack([cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), a]), "RGBA").save(path)

    Image.fromarray(cv2.cvtColor(far_color, cv2.COLOR_BGR2RGB)).save(OUT / "far.png")
    save_rgba(mid_color, mid_a, OUT / "mid.png")
    save_rgba(plate, near_a, OUT / "near.png")
    Image.fromarray(pack).save(OUT / "depthpack.png")

    print("near %", round(100 * (near > 127).mean(), 1),
          "mid %", round(100 * (mid_region > 127).mean(), 1),
          "far %", round(100 * (far_region > 127).mean(), 1))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
