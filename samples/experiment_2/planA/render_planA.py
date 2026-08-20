"""Plan A - AI-assisted deterministic 2.5D parallax.

The AI does the parts only AI can do (matte the subject, invent the wall behind
the podium, matte a sheer curtain) and then stops. The camera move itself is
arithmetic, so the cat's face and the room's proportions cannot drift.

Layer order and relative travel follow the brief. The one rule that matters most:
the cat and the podium are ONE group. Give them different travel and the cat
slides across the podium it is sitting on.
"""
import numpy as np, os, subprocess, sys
from PIL import Image
import cv2

S = 'samples/experiment_2/'; A = S + 'planA/'
EXAG = float(os.environ.get('EXAG', 1))   # 1 = shipping values; >1 only to SEE it
TAG = '' if EXAG == 1 else f'_x{int(EXAG)}'
OUT = A + f'frames{TAG}/'; os.makedirs(OUT, exist_ok=True)

W, H = 1080, 1920
FPS, SECONDS = 24, 8
N = FPS * SECONDS                       # 192 - loop closes on itself
AMP_X = 0.010 * W                       # brief: +/-0.8..1.2% of width
AMP_Y = 0.0018 * H                      # brief: +/-0.1..0.25% of height
OVERSCAN = 0.07                         # brief: 6..8%

# relative travel, back -> front (brief's table)
TRAVEL = {'wall': 0.25, 'group': 0.60, 'curtain': 0.95}

back = np.array(Image.open(A + 'backplate.png').convert('RGB'), float)
tgt  = np.array(Image.open(S + 'target_nila_9x16.png').convert('RGB'), float)
cur_a = np.array(Image.open(A + 'curtain_mask.png'), float) / 255.0
grp   = Image.open(A + 'cat_rembg.png').convert('RGBA')
grp_rgb = np.array(grp, float)[..., :3]; grp_a = np.array(grp, float)[..., 3] / 255.0

# The wall layer must not carry the curtain, or the curtain doubles up the moment
# the two layers separate. Rebuild the hidden wall by extending it leftward from
# the first fully-opaque wall column.
wall = back.copy()
x0 = int(np.nonzero((cur_a > 0.02).any(axis=0))[0].max()) + 4
wall[:, :x0] = back[:, x0:x0 + 1]
wall = cv2.GaussianBlur(wall, (0, 0), 2.0) * (cur_a[..., None] > 0.02) + wall * (cur_a[..., None] <= 0.02)

# A depth MAP would make these flat surfaces undulate; the brief says replace them
# with explicit geometry. For a pure lateral move that geometry reduces to one
# travel coefficient per plane, which is what TRAVEL is.
def shift(img, dx, dy):
    M = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(img, M, (img.shape[1], img.shape[0]),
                          flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)

def over(dst, rgb, a):
    return dst * (1 - a[..., None]) + rgb * a[..., None]

mx = int(W * OVERSCAN / 2); my = int(H * OVERSCAN / 2)
for i in range(N):
    # Half-step phase offset. On the bare i/N phase, frame 0 lands at cx == 0
    # exactly, warpAffine short-circuits to an identity, and that one frame skips
    # the Lanczos softening every other frame gets. It reads as a one-frame pop in
    # the loop -- measured 2.9x the median inter-frame delta. Offsetting by half a
    # step means no frame is ever an exact identity, and the loop still closes.
    t = 2 * np.pi * (i + 0.5) / N
    cx = np.sin(t) * AMP_X * EXAG
    cy = np.cos(t) * AMP_Y * EXAG             # 90 deg out of phase -> a slow ellipse
    f = shift(wall, -cx * TRAVEL['wall'], -cy * TRAVEL['wall'])
    dx, dy = -cx * TRAVEL['group'], -cy * TRAVEL['group']
    f = over(f, shift(grp_rgb, dx, dy), shift(grp_a, dx, dy))
    dx, dy = -cx * TRAVEL['curtain'], -cy * TRAVEL['curtain']
    f = over(f, shift(back, dx, dy), shift(cur_a, dx, dy))
    f = f[my:H - my, mx:W - mx]
    Image.fromarray(np.clip(f, 0, 255).astype('uint8')).resize((720, 1280), Image.LANCZOS)\
         .save(f'{OUT}c{i:04d}.png')
    if i % 48 == 0: print(f'  frame {i:3d}  camera ({cx:+.2f},{cy:+.2f}) px')

name = A + f'planA{TAG}.mp4'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', f'{OUT}c%04d.png',
                '-c:v', 'libx264', '-crf', '17', '-preset', 'slow', '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart', name], check=True)
print('wrote', name)
