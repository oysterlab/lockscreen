"""Automatic subject mask (no human intervention) via rembg / U2Net saliency.
Usage: python auto_subject_rembg.py <image> <out_mask>"""
import sys
import cv2
import numpy as np
from PIL import Image
from rembg import remove, new_session

inp, out = sys.argv[1], sys.argv[2]
img = Image.open(inp).convert("RGB")
mask = np.array(remove(img, session=new_session("u2net"), only_mask=True).convert("L"))

m = (mask > 128).astype(np.uint8) * 255
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
n, lbl, st, _ = cv2.connectedComponentsWithStats(m)
if n > 1:
    m = (lbl == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8) * 255
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)))
# fill holes
ff = m.copy(); h, w = m.shape; fm = np.zeros((h + 2, w + 2), np.uint8)
cv2.floodFill(ff, fm, (0, 0), 255)
m = cv2.bitwise_or(m, cv2.bitwise_not(ff))

Image.fromarray(m).save(out)
print("auto subject mask % =", round(100 * (m > 127).mean(), 1))
