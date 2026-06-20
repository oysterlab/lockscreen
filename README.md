# Cat Depth Lock

Interactive **3D-photo** lock screen built from a single still image
(`1000039271.png`). Tilt the phone (or move the pointer on desktop) and the scene
moves with true, continuous depth — the hatted cat has real 3D shape, far buildings
and Namsan tower drift behind it — with no stretching, ghosting or shredding.

## How it works

This is the "3D Photography using Layered Depth Inpainting" technique (Shih et al.).
A WebGL2 / Three.js renderer draws two depth-displaced meshes with a perspective
camera that orbits on tilt:

- **front mesh** — the plate displaced per-vertex by its depth, so it has a real
  continuous 3D surface. Triangles spanning a depth "cliff" (object silhouettes) are
  discarded instead of stretched.
- **back mesh** — a **LaMa-inpainted** plate (foreground + cliffs removed and filled
  in by ML) so the discarded holes reveal sharp, plausible background, not a smear.

Why this beats the earlier attempts (depth-displacement / rigid layers / LDI):
- **Continuous** — the mesh is displaced per-vertex, so depth is smooth, not stepped.
- **No smear / no distortion** — cliffs are cut geometrically; nothing is UV-stretched.
- **No shredding** — the mesh is continuous; cuts happen only at silhouettes.
- **Real shape, not a sticker** — the cat is displaced by its own depth.
- **Sharp reveals** — disoccluded regions are filled by LaMa, not blurry classical inpaint.

Runtime assets in `assets/photo3d/`:

| File | Role |
| --- | --- |
| `fg_color.png` / `fg_depth.png` | front mesh: plate + depth |
| `cliff.png` | depth-discontinuity mask (front-mesh cut) |
| `bg_color.png` / `bg_depth.png` | back mesh: LaMa-inpainted colour + depth |

Source assets in `assets/depth/`: `plate_clean.png` (source with all baked iOS UI
inpainted out), `depth.png` (Depth Anything V2), `subject_mask.png` (cat mask).

## Controls

- **Compass** — enable gyroscope motion on mobile (asks permission on iOS).
- **Maximize** — fullscreen (or add to Home Screen for full-bleed).
- **Reset** — recenter. Desktop uses pointer parallax; idle drift keeps it alive.

## Regenerating the assets

```bash
# depth map (Node + transformers.js, Depth Anything V2 BASE for crisp thin edges)
LOCAL_MODEL_DIR=/tmp/depthtool/models MODEL_NAME=depth-anything-v2-base DTYPE=q8 \
  node scripts/depth.mjs assets/depth/plate_clean.png assets/depth/depth.png

# 3D-photo layers (Python + OpenCV + torch + LaMa)
#   needs: torch, simple-lama-inpainting (downloads big-lama on first run)
python scripts/build_3dphoto.py     # -> assets/photo3d/*
```

`build_3dphoto.py` colour-guides the depth (a guided filter snaps depth edges onto
the photo's edges) so thin silhouettes (twigs, wires) cut cleanly.

## Quality notes

What it took to get artifact-free (verified by adversarial review at extreme tilt):
- **Pixel-precise, feathered cut in the shader** (not a precomputed mask) — discards
  only the stretched depth wall, with a soft 1px edge so nothing frays or halos.
- **Depth Anything V2 Base + colour-guided refine** — resolves thin twigs/wires.
- **LaMa inpaint** behind the cuts — sharp reveals, no blur band.
- **Restrained camera motion** (`orbit`) — keeps the hardest thin-edge cases
  (1px wires at max tilt) sub-visible, the way premium live wallpapers do.

## Notes

- Static files; needs WebGL2 (any modern phone/desktop). Works on GitHub Pages.
- `?ox=<-1..1>&oy=<-1..1>` freezes the camera; `?ct=&ds=&ob=` tune cut/depth/orbit.
- Tune motion in `VIEW` at the top of `app.js` (`depthScale`, `orbit`, `focus`, `cut`).
- QA needs WebGL2; headless Chrome works with
  `--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader`.
