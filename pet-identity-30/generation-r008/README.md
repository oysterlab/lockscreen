# PET-R008 — disjoint source set

PET-R008 corrects the PET-R007 selection error. PET-R007 regenerated the same
30 source IDs. PET-R008 uses 15 cat and 15 dog source-photo IDs whose
intersection with PET-R007 is exactly zero.

The supplied pool contains multiple posts from the same influencer accounts,
so a different source ID does not always imply a biologically different pet.
The selected posts emphasize visibly different poses and accessories.

## Prepare and verify inputs

```bash
uv run pet-identity-30/generation-r008/prepare_inputs.py \
  --pool /Users/shin/Desktop/wallpaper/service/resources/a2_pet_identity/influencer_daily_pool/good_inputs/images
```

The command refuses to continue unless all of these hold:

- exactly 15 cats and 15 dogs;
- 30 distinct IDs and source filenames;
- zero ID overlap with `generation-r007/manifest.json`;
- zero exact source-file hash overlap with PET-R007 sources in the supplied pool;
- 30 distinct SHA-256 source hashes.

## Built-in ImageGen prompt template

One built-in ImageGen call is issued for each asset. Input roles are fixed:

- Image 1: edit target — `assets/reference/base.jpg`;
- Image 2: identity and accessory reference — `input/<source filename>`;
- Image 3: golden chibi style/scale reference — `assets/reference/target-latte.jpg`;
- Image 4: golden chibi style/scale reference — `assets/reference/target-nila.jpg`;
- Image 5: spatial constraint map — `placement-guide.png`.

```text
Use case: compositing
Asset type: 9:16 mobile lock-screen wallpaper
Primary request: Modify Image 1 by adding exactly one chibi pet based on Image 2.
Produce one flattened, fully integrated scene—not a cutout, collage, pasted layer,
chroma-key result, or separate pet plate.

Identity lock: {identity}
Required pet-related item: {required}

Scene/backdrop: Preserve Image 1's room, arch, curtain, floor, circular plinth,
camera, perspective, color, texture, and lighting. Do not redesign them.
Subject: The pet must unmistakably match Image 2 while becoming irresistibly cute:
oversized round head and eyes, compact toy-like chibi body, short legs, soft dense
touchable fur, clean anatomy, and a warm gentle expression. It must not remain an
ordinary photoreal adult animal.
Composition/framing: Put the entire pet and every accessory on the circular plinth
inside Image 5's green allowed region. Nothing may enter the red forbidden curtain
corridor. Keep a clearly visible background gap between the moving curtain and the
leftmost pet/accessory pixel. The complete pet-plus-accessory silhouette must remain
compact and no larger than the pets in Images 3 and 4.
Lighting/mood: Integrate warm window light, contact shadow, soft bounce light, and
plausible depth into the single full-frame image.
Constraints: Preserve identity-defining coat colors, facial markings, eye colors,
ear shape, muzzle, and the required pet-related item. Keep all limbs, ears, tail,
costume, hat, collar, toy, and props complete and uncut. Exclude people and unrelated
objects from Image 2. No readable text, logo, watermark, extra animal, halo, seam,
smear, duplicate limb, malformed paw, or floating object.
```

Only `{identity}` and `{required}` vary by item. If a first output violates the
green placement region or drops a required accessory, repeat the same prompt with
one targeted correction and archive that regeneration in the manifest.

## Review result

- 30 native outputs are present at `941x1672`, with 30 distinct SHA-256 hashes.
- `RC-CAT-039` accepted a targeted smaller/rightward regeneration for its wide
  clownfish ring. `RC-CAT-090` and `RC-CAT-102` accepted fresh base-scene
  regenerations with compact scythe and maple-leaf props.
- Move edits for `RC-CAT-090` and `RC-CAT-102` were rejected because the model
  enlarged the subjects; those intermediate variants were discarded.
- The contact sheet is an owner-review set, not an automatic aesthetic PASS.

## Promote reviewed candidates

```bash
uv run pet-identity-30/generation-r008/promote.py
```

This replaces only the public gallery's pet input/output files, writes the
844x1500 JPEG previews, and copies the reviewed contact sheet. Previous assets
remain recoverable through Git history.
