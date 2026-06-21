# Recipe v2 — 3D-photo lockscreen, flatten + motion + auto pipeline (2026-06-21)

Safe fallback before the v3 soft-LDI rewrite. Frozen source in `./code/`.
Restore by copying `code/app.js`, `code/index.html`, `code/scripts/*` back.

## What v2 adds over v1
- **Subject depth flatten** (`build_3dphoto.py`): compress the cat's internal depth to
  0.45 of its range toward the mean, so it moves as one plane (no "split into two depths").
- **Fully-automatic pipeline** (`make_scene.sh` + `auto_subject_rembg.py`): photo ->
  resize -> Depth Anything -> rembg/U2Net auto subject -> build. Zero manual steps.
- **Motion**: gyro range 9deg (sensitive), touch drag (relative, overrides gyro while
  held), `orbit 0.44` horizontal, `orbitYScale 0.7` vertical (gentler so a bottom-
  anchored subject isn't pushed off-screen), critically-damped spring.
- **SD inpaint variant**: `?scene=sd` uses a Stable Diffusion back layer (vs LaMa default).
- **Scenes**: main (LaMa), `?scene=latte` / `latte2` / `nila` (auto), `?scene=sd`.

## Renderer params (`app.js` VIEW)
```
camZ 6, fov 36, depthScale 1.45, farScale 0.42, focus 0.34,
orbit 0.44, orbitYScale 0.7, cutLow 0.04, cutHigh 0.14,
overscan 0.08, pad 1.15, springFreq 8.5
SENSOR { betaRange 9, gammaRange 9, gravityRange 2.3, deadZone 0.02 }, TOUCH_SENS 2.6
```

## Known limits (what v3 targets)
Still a 2-mesh approach (front plate cut at cliffs + LaMa back). At large angles a
moderate mid-depth gradient can still stretch slightly, and the subject silhouette is
a feathered cut (not a true soft matte). v3 = 3-layer soft LDI (SLIDE-style): separate
soft-alpha-matted subject layer over an inpainted scene over a filled far layer.

## Commit
Snapshot at the commit in `SNAPSHOT.txt` (a24e075 era).
