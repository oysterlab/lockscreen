# PET-R007 — curtain-clear 30-pet regeneration

## Goal

Regenerate the same 15 cats and 15 dogs as native, flattened 9:16 scenes while
keeping every pet, accessory, toy, and contact shadow clear of the animated
curtain corridor.

## Image roles

1. `assets/reference/base.jpg` — immutable edit target.
2. `assets/input/<PET-ID>.jpg` — only pet identity and pet-related accessory source.
3. `assets/reference/target-latte.jpg` — style, scale, pose, and placement only.
4. `assets/reference/target-nila.jpg` — style, scale, pose, and placement only.

## Shared generation contract

- Edit Image 1 into one flattened integrated scene. Never make a cutout,
  chroma-key asset, pasted layer, or separate subject plate.
- Preserve the room framing, curtain, arch, podium, palette, light direction,
  shadows, texture, negative space, and camera.
- The complete pet group—including ears, fur, tail, paws, clothing, hats,
  collars, toys, and contact shadow—must fit inside normalized canvas box
  `x=0.43..0.82`, `y=0.66..0.87`.
- Nothing pet-related may enter the left `43%` curtain-motion corridor.
- Keep the group no larger than the two golden references and fully supported
  by the podium.
- Use a premium tactile chibi 3D finish: rounded head, compact body, short legs,
  soft touchable fur, cute expression, and recognizable input identity. Do not
  copy the golden cats' identities.
- Preserve every pet-related accessory named in `manifest.json`; add no
  unrelated props.
- Exactly one animal with plausible anatomy. No people, text, logo, watermark,
  border, or UI.

## Output policy

Built-in ImageGen outputs are copied to `output-native/` first. The production
`assets/output-native/` directory is replaced only after all 30 candidates pass
the composition and integrity review. Depth and normals are rebuilt from the
approved flattened scene; no pet mask is generated.

