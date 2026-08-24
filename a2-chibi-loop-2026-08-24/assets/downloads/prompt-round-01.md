# Round 01 — Role-labelled manifest baseline

Built-in ImageGen was called once per asset with the source cat as Image 1 and `target_latte_9x16.png` / `target_nila_9x16.png` as Images 2–3.

```text
Use case: stylized-concept
Asset type: pet-only 3D chibi cutout for a 9:16 lock-screen composite
Input images: Image 1 is the ONLY identity and accessory source. Images 2 and 3 are style/proportion references ONLY; never copy their coat color, markings, face, accessory, or environment.
Primary request: Transform the exact cat in Image 1 into one premium tactile 3D chibi cat while keeping it unmistakably the same individual.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for later removal.
Subject: exactly one full-body cat in a low, compact seated three-quarter pose, tail visible when anatomically appropriate, natural paws, fully inside frame.
Style/medium: match the Latte/Nila references: large round head and clear eyes, very short legs, low compact body, soft dense touchable plush fur, refined premium 3D render. Stylized chibi throughout, never a real cat with enlarged eyes.
Lighting/mood: warm soft key light from viewer-left; sweet, calm, irresistibly cute and touchable.
Composition/framing: centered low-and-wide silhouette with generous padding; whole cat plus required accessories visible.
Identity lock: {{identity_manifest from manifests.csv}}
Accessory lock: {{accessory_manifest from manifests.csv}}
Constraints: preserve source-side marking topology, eye colors, distinctive expression and named pose traits; no extra accessory; no extra animal; no duplicate face, eyes, ears, paws, legs, or tail; no text except source accessory lettering; no logo, watermark, border, floor, pedestal, shadow, reflection, or environment.
Chroma contract: the background must be one uniform #00ff00 with no gradient, texture, floor plane, shadow, reflection, or lighting variation. Do not use #00ff00 in the cat or accessory. Keep crisp separated edges and generous padding.
```

### Controlled exception

`RC-CAT-028` was rejected once because the original frame included a person. A deterministic crop containing only the cat and grey fabric was used on retry. No cat pixels or cat-related fabric were altered.
