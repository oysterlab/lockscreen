# Round 02 — Source-first identity firewall

Everything from Round 01 was held constant. The only conceptual change was the identity firewall below.

```text
Use case: stylized-concept
Asset type: pet-only 3D chibi cutout for a 9:16 lock-screen composite
Input roles: Image 1 is the ONLY identity, pose-trait, condition, and accessory source. Images 2 and 3 are style/proportion references ONLY. Never copy their cat identity, coat color, markings, face, eye color, expression, accessory, or environment.
Primary request: Transform the exact cat in Image 1 into one premium tactile 3D chibi cat while keeping it unmistakably the same individual.

IDENTITY FIREWALL: Before rendering, compare every identity trait against Image 1. Copy ZERO identity traits from Images 2 and 3. Their skull, face, eye shape/color, muzzle, ears, coat, markings, fur, body mass, pose, and accessories are forbidden identity sources. If any instruction conflicts, Image 1 always wins. Do not normalize this cat into Latte or Nila. Preserve the exact eye spacing and expression, source-specific skull roundness, muzzle width and length, ear geometry, bilateral marking topology, fur density, and body mass.

Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for later removal.
Subject: exactly one full-body cat in the per-sample pose manifest; tail visible when anatomically appropriate; natural paws; the entire cat and every required cat-related item fully inside frame.
Style/medium: match only the global chibi language of Images 2 and 3: large round head and clear eyes, very short legs, low compact body, soft dense touchable plush fur, refined premium 3D render. Stylized chibi throughout, never a real cat with merely enlarged eyes.
Lighting/mood: warm soft key light from viewer-left; sweet, calm, irresistibly cute and touchable.
Composition/framing: centered low-and-wide silhouette with generous padding; whole cat plus required accessories visible.
Identity lock: {{identity_manifest from manifests.csv}}
Accessory lock: {{accessory_manifest from manifests.csv}}
Constraints: preserve source-side marking topology, eye colors, distinctive expression, wet/dry appearance condition, and named pose traits; no extra accessory; no extra animal; no duplicate face, eyes, ears, paws, legs, or tail; no text except source accessory lettering; no logo, watermark, border, floor, pedestal, shadow, reflection, or environment.
Chroma contract: background must be one uniform #00ff00 with no gradient, texture, floor plane, shadow, reflection, or lighting variation. Do not use #00ff00 in the cat or accessory. Keep crisp separated edges and generous padding.
```

The same fifteen source files, two 9:16 golden style references, locked background, chroma removal, and deterministic composite geometry were used.
