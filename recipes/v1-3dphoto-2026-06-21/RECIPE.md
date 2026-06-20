# Recipe v1 — 3D-photo lockscreen (2026-06-21)

Frozen, adversarially-verified-clean build. A frozen copy of the exact source is in
`./code/`. Restore by copying those files back over the project root / `scripts/`.

**Verification (harsh adversarial review at extreme tilt, 4 regions):**
cat 9/9 · gate 9/9 · pole clean (wire single line) · tree ~clean (only a sub-bokeh
leaf-tip fringe at the very steepest corner tilt). User's "번짐/잔상/노이즈" resolved.

## Technique
3D Photo / Layered Depth Inpainting (Shih et al.). Two depth-displaced meshes +
perspective camera that orbits on tilt. Front = plate displaced by depth, cut at
cliffs (per-pixel feathered). Back = LaMa-inpainted plate shows through the cuts.

## Models (one-time downloads, cached)
- Depth: **Depth Anything V2 Base**, onnx-community quantized (~102MB) at
  `/tmp/depthtool/models/depth-anything-v2-base`. Run via `scripts/depth.mjs`
  (`@huggingface/transformers@3` + `sharp`, Node).
- Inpaint: **LaMa** `big-lama.pt` (~200MB) at `~/.cache/torch/hub/checkpoints/`,
  via `simple-lama-inpainting` (torch). venv: `/private/tmp/image-clean-venv`.

## Renderer params (`app.js` VIEW + shader)
```
camZ: 6, fov: 36
depthScale: 1.45   // foreground relief (near pop)
farScale:   0.42   // far band moves this fraction (keeps thin distant edges calm)
focus:      0.42   // still plane
orbit:      0.30   // camera xy travel at full tilt
cutLow:     0.04   // scene cut threshold (cut tree/sky edges)
cutHigh:    0.14   // cat-region cut threshold (protect.png; don't cut -> no stipple)
overscan:   0.08, pad: 1.15
```
- Vertex displacement: `z += rel * depthScale * (rel<0 ? farScale : 1)`, `rel = depth-focus`.
  → ASYMMETRIC: strong near pop, compressed far (no thin-wire smear).
- Front fragment: per-pixel depth-gradient cut, threshold = `mix(cutLow, cutHigh, protect)`,
  FEATHERED alpha `1 - smoothstep(cut*0.82, cut*1.08, grad)`; material transparent +
  depthWrite:false. texel = 1.6/imgSize. Mesh density = round(planeW*150) segments.
- Colour: textures RAW (no SRGBColorSpace) + `outputColorSpace = LinearSRGBColorSpace`
  (ShaderMaterial does no colour conversion, else it darkens).

## Asset build params (`scripts/build_3dphoto.py`)
- `CLIFF_T = 14`.
- Depth: median(5) → colour-guided `guided_filter` (r=4 then r=2, eps=1e-4) to snap
  depth edges onto photo edges → crisp thin twig/wire cuts. THEN smooth depth INSIDE
  the cat mask (GaussianBlur σ3.5, feathered) to remove knit-texture stipple noise.
- `cliff` = grad>CLIFF_T*4, close(5)+dilate(5). `fill` = cliff ∪ dilate(cat,7), dilate(3).
- `bg_color`/`bg_depth` = LaMa inpaint of `fill`. `protect.png` = GaussBlur(dilate(catm,11),σ5).

## Regenerate
```
LOCAL_MODEL_DIR=/tmp/depthtool/models MODEL_NAME=depth-anything-v2-base DTYPE=q8 \
  node scripts/depth.mjs assets/depth/plate_clean.png assets/depth/depth.png
/private/tmp/image-clean-venv/bin/python scripts/build_3dphoto.py   # ~35s (LaMa on CPU)
```
Runtime assets land in `assets/photo3d/` (fg_color, fg_depth, protect, bg_color, bg_depth, cliff).

## Known tradeoff (next idea)
Background (non-cat) reads slightly "flat / planar" because `focus=0.42` + far
compression give the midground little differential parallax. Lowering `focus`
(~0.28) + raising `farScale` spreads depth across the whole scene — improve there,
keep this recipe as the safe fallback.
