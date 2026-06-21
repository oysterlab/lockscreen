# Project status — Cat Diorama Lockscreen (resume here)

Last updated: 2026-06-21. Live: https://oysterlab.github.io/lockscreen/ (repo: oysterlab/lockscreen, branch main).

## What this is
An interactive iOS-style lockscreen: a single still cat-diorama image is turned into a
depth-parallax 3D scene you can tilt (gyro) or drag (touch). The end product is a
pipeline that takes a USER'S CAT PHOTO and produces a personalized interactive lockscreen.

## The product pipeline (end to end)
```
user's cat photo
  → [STEP 1] analyze photo into a "cat brief" (text)            ← ChatGPT now, API later
  → [STEP 2] generate a chibi diorama in the cherry style       ← ChatGPT/codex imagegen
              (inputs: cat photo + source.png style ref + brief)
  → [make_scene.sh] depth + subject mask + layers               ← fully local, automatic
  → 3D parallax lockscreen at ?scene=<name>
```

## The two-step generation prompt — THE key asset
`prompts/diorama-2step.md` is the tuned, working prompt. Finalized knobs:
- STEP 1 = analyze the cat photo → structured brief (coat, face, eyes, pose, etc.).
- STEP 2 = cat photo (Image 1, identity) + source.png (Image 2, style) + brief.
- Tuned values that WORK: cushion anchored small (~40% frame width); cat ~60% of the
  cushion (breathing room); cuteness 55% identity / 45% chibi; **PAWS rule** (hide paw
  pads, minimal/hidden paws — generators botch feet, gave 5–6 legs); white cats need a
  **dark backdrop behind the silhouette** (else they vanish / mask fails).
- Other prompt files: `chibi-cat-diorama.md` (figurine restyle), `diorama-generation.md`
  (from-scratch scene), `nb2-multiview.md` (abandoned — see below).

## The rendering pipeline (local, automatic)
- `scripts/make_scene.sh <photo> <name>`: resize 864×1536 → **Depth Anything V2 Large
  (fp16)** depth → **rembg/U2Net** auto subject mask → `build_3dphoto.py` → outputs to
  `assets/photo3d_<name>/`. View at `?scene=<name>`. Zero manual steps.
- `scripts/build_3dphoto.py`: colour-guided depth refine, subject depth FLATTEN (so the
  cat moves as one plane, no "split into two depths"), cliff cut + back-layer fill,
  `protect.png` (cut-protect map), optional `subject.png` (v3 soft matte). Env knobs:
  `SCENE_BG` (use a clean cat-free plate instead of LaMa), `SCENE_BG_DEPTH` (estimate
  back-layer depth from that plate directly), `SCENE_RIGID` (flatten a thin object like
  the tree so leaves don't stretch), `FAR_FLATTEN`, `PROTECT_PX`, `REFINE_MASK`.
- `app.js`: Three.js depth-mesh renderer. Gyro (sensitive) + touch drag + critically-
  damped spring. `SCENE_OVERRIDES` per scene (depthScale/farScale/focus). `VERT` does
  asymmetric relief; `FRAG_FRONT` does the feathered cliff cut.

## Key learnings (what works / what does NOT)
- **Codex/gpt-image CAN edit, CANNOT create-from-references reliably.** Good: erase the
  cat (→ base.png), cut out the cat (→ matte), outpaint to 9:16. Bad: depth maps,
  multi-view/novel angles, "this cat in that style" from two refs (wandered, went photoreal
  or unchanged). That's WHY the 2-step prompt + ChatGPT works better than one codex call.
- **Depth model matters most.** Base = blobby (scooter/leaves merge, warp). **Large** =
  crisp wires, real object structure, +76% scooter detail. Use Large.
- **base.png (real cat-free render) beats LaMa** for the back layer + its depth (LaMa
  guessed wrong behind the cat by ~18 gray levels).
- **Cat got too big** because the CUSHION was drawn big → anchor scale on the cushion.
- **"Wrong cat flash" on load** was `style.css` painting the MAIN plate as a CSS preload
  background (not scene-aware) — fixed to a solid colour. (Cache-buster `AV` must be
  bumped on every asset change; it had been stuck at `a=lv1`.)
- Abandoned: multi-view (codex can't), Zero123++ NVS (OOM on 16GB), 3-layer explicit
  composite lab3 (alignment/letterbox pain). The single-image + Large depth path won.

## Live scenes
- Production diorama set (tuned scale): `?scene=cherry2dio` / `latte2dio` / `nila2dio`.
- `cherry2` = refined origin (LaMa→base.png back, Large depth, ear-safe protect, deeper).
- Experiments kept for reference: `lab1` (v3 soft-LDI), `lab2`, `lab3`, `sd`, `latte`, `nila`.
- Main `/` = original v2 grey-bonnet cat (untouched).

## Assets
- `assets/<name>_source.png` = the generated diorama (input to make_scene).
- `assets/source.png` = the cherry diorama used as the STYLE reference in STEP 2.
- `assets/base.png` = cat-free clean back plate for cherry.
- `recipes/v1-*`, `recipes/v2-*` = frozen code snapshots to restore a known-good build.

## Next steps (resume candidates)
1. **API automation** — wrap STEP 1 + STEP 2 as two API calls (currently manual ChatGPT),
   then make_scene, so "upload cat photo → lockscreen" is one flow. (This is the product.)
2. **Gallery / scene picker UI** — one page to browse cherry/latte/nila + share links.
3. **Auto cache-buster** — make make_scene bump `AV` in app.js so deploys never serve stale.
4. **Per-cat clean URLs** — `/nila/` etc. if PWA/home-screen install is wanted.
5. **Optional quality**: codex-extract base.png + cat-only matte per new diorama (skips LaMa).

## How to add a new cat (today's manual flow)
1. Run STEP 1 prompt in ChatGPT with the cat photo → get the brief.
2. Run STEP 2 prompt with cat photo + `assets/source.png` + the brief → diorama image.
3. Save as `assets/<name>_source.png`.
4. `scripts/make_scene.sh assets/<name>_source.png <name>` → `?scene=<name>`.
5. Bump `AV` in app.js + `v=mesh-N` in index.html, commit, push.
