# PET-R009 — plinth-centred cats

PET-R009 keeps the approved PET-R008 cat identity, chibi styling, scale, pose,
accessories, room, and lighting while correcting the cats' systematic rightward
placement. Dogs are intentionally unchanged.

## Placement contract

- The circular plinth's measured horizontal centre is native `x=544` on the
  `941x1672` frame (`57.81%`).
- Centre the visual bounding box of the **complete pet silhouette**—cat, tail,
  costume, hat, toy, and every attached accessory—on that line.
- Preserve the exact accepted subject scale and keep both feet on the same
  contact plane.
- Edit the complete flattened scene. Do not extract, mask, chroma-key, or paste
  a pet layer.

Build the reproducible spatial reference with:

```bash
uv run pet-identity-30/generation-r009/build_center_guide.py
```

## Built-in ImageGen prompt template

One built-in ImageGen edit is issued for each cat. Input roles are fixed:

- Image 1: current approved PET-R008 full-frame output (the edit target);
- Image 2: original identity and accessory reference;
- Image 3: golden chibi style/scale reference `target-latte.jpg`;
- Image 4: golden chibi style/scale reference `target-nila.jpg`;
- Image 5: the matching `center-guides/<PET-ID>.jpg`, which is Image 1 with
  only the centre annotation added. This prevents guide-induced background or
  plinth drift.

```text
Use case: precise-object-edit
Asset type: 9:16 mobile lock-screen wallpaper
Primary request: In Image 1, translate the complete cat group horizontally to
the left until the horizontal centre of its COMPLETE VISIBLE SILHOUETTE—the cat,
tail, costume, hat, toy, and every attached accessory—is aligned with Image 5's
green line at native x=544 (57.81%), the exact centre of the circular plinth.

Identity lock: {identity}
Required pet-related item: {required}

Preserve exactly: Image 1's cat identity, chibi design, expression, pose,
anatomy, fur detail, scale, pixel height and width, accessory design, room,
arch, curtain, plinth, floor, camera, perspective, palette, lighting, and depth.
Move the cat, all pet-related accessories, tail, paws, and its contact shadow as
one coherent group by the same horizontal amount. Keep the feet at the same
vertical coordinate and keep the entire silhouette on the plinth.

Reconstruct only the small vacated area behind the old subject position using
the matching wall and plinth texture from Image 1. The result must be one
flattened, naturally integrated full-frame scene—not a cutout, pasted layer,
collage, chroma-key result, or separate pet plate.

Constraints: No resizing, restyling, rep posing, redesign, camera change,
background change, added object, removed accessory, extra animal, text, logo,
watermark, halo, seam, smear, duplicate limb, malformed paw, or floating object.
Image 2 is identity evidence only; Images 3 and 4 are strict scale/style
invariants; Image 5 is geometry guidance only and its line/labels must not
appear in the output.
```

The first three edits cover a plain cat, a full-body costume, and a wide prop.
They are reviewed before the remaining cats are processed. Automatic checks
must never label aesthetics as PASS; owner review remains authoritative.
