"""Split the clean plate into 3 rigid parallax layers (LDI / 3D-photo style).

far  : sky + distant buildings + tower         (opaque backdrop)
mid  : gate, walls, stall, pole, tree, houses  (RGBA cutout, extended under cat)
near : the hatted cat                           (RGBA cutout)

Occluded regions behind each foreground layer are inpainted so that when a layer
slides during parallax, real filled background is revealed instead of a smear.
Run with the opencv venv:
  /private/tmp/image-clean-venv/bin/python scripts/build_layers.py
"""
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

ROOT = Path("/Users/shin/Desktop/lockscreen")
PLATE = ROOT / "assets/depth/plate_clean.png"
DEPTH = ROOT / "assets/depth/depth.png"
CATM = ROOT / "assets/depth/subject_mask.png"
OUT = ROOT / "assets/layers3"
OUT.mkdir(exist_ok=True)

FAR_T = 95   # depth < FAR_T  -> far
MID_T = 95   # depth >= MID_T -> mid (minus near)


def feather(mask_u8, sigma):
    return cv2.GaussianBlur(mask_u8, (0, 0), sigma)


def dilate(mask_u8, px):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (px * 2 + 1, px * 2 + 1))
    return cv2.dilate(mask_u8, k)


def main():
    plate = cv2.cvtColor(np.array(Image.open(PLATE).convert("RGB")), cv2.COLOR_RGB2BGR)
    depth = np.array(Image.open(DEPTH).convert("L"))
    cat = np.array(Image.open(CATM).convert("L"))
    H, W = depth.shape

    # --- region masks ---
    # tighten the loose cat mask to the actual (near-depth) cat body so we don't
    # drag a halo of mid-depth gate/stall pixels along with the cat.
    near = (((cat > 110) & (depth >= 130))).astype(np.uint8) * 255
    near = cv2.morphologyEx(near, cv2.MORPH_CLOSE,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)))
    near = cv2.morphologyEx(near, cv2.MORPH_OPEN,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    near = dilate(near, 3)

    far_region = ((depth < FAR_T) & (near == 0)).astype(np.uint8) * 255
    mid_region = ((depth >= MID_T) & (near == 0)).astype(np.uint8) * 255

    # --- inpaints (fill what each layer occludes) ---
    # FAR: fill everything that mid+near cover, so the sliver revealed at the
    # mid silhouette comes from real adjacent sky. Interior blur stays hidden.
    far_fill = dilate(cv2.bitwise_or(mid_region, near), 3)
    far_bg = cv2.inpaint(plate, far_fill, 6, cv2.INPAINT_TELEA)

    # MID: extend mid content under the cat so the cat reveals ground/gate,
    # not sky, when it slides.
    mid_fill = dilate(near, 3)
    mid_extended = cv2.inpaint(plate, mid_fill, 6, cv2.INPAINT_TELEA)

    # --- compose layer colours ---
    near_a = feather(near, 2.2)
    mid_a = feather(cv2.bitwise_or(mid_region, near), 2.2)  # mid covers behind cat

    # mid colour = plate, but inpainted where the cat sits
    near_norm = (near.astype(np.float32) / 255.0)[..., None]
    mid_color = (plate * (1 - near_norm) + mid_extended * near_norm).astype(np.uint8)

    def save_rgba(bgr, alpha_u8, path):
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        rgba = np.dstack([rgb, alpha_u8])
        Image.fromarray(rgba, "RGBA").save(path)

    Image.fromarray(cv2.cvtColor(far_bg, cv2.COLOR_BGR2RGB)).save(OUT / "far.png")
    save_rgba(mid_color, mid_a, OUT / "mid.png")
    save_rgba(plate, near_a, OUT / "near.png")

    # debug masks
    Image.fromarray(near).save(OUT / "_mask_near.png")
    Image.fromarray(mid_region).save(OUT / "_mask_mid.png")
    Image.fromarray(far_region).save(OUT / "_mask_far.png")

    print("near px %", round(100 * (near > 127).mean(), 1))
    print("mid  px %", round(100 * (mid_region > 127).mean(), 1))
    print("far  px %", round(100 * (far_region > 127).mean(), 1))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
