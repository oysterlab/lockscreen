# Diorama generation — 2-step prompt (analyze → generate)

Pipeline for turning a user's real cat photo into an algorithm-friendly chibi diorama.
Run by hand in ChatGPT now; later automate as two API calls.

- STEP 1 = analyze the cat photo into a structured "cat brief" (text only).
- STEP 2 = generate the diorama from: the STEP-1 brief + Image 1 (cat photo, identity)
  + Image 2 (source.png, the chibi style + scene).

Version: v1 (2026-06-21).

---

## STEP 1 — Analyze (input: the cat photo only; output: text brief)

```
Analyze the attached cat photo and extract a structured "diorama brief" — the specific,
recognizable features we must preserve when turning THIS cat into a chibi miniature-
diorama figurine. Do NOT generate any image. Output ONLY this filled-in list:

- Coat length: (long-haired / short-haired)
- Fur colour & markings: (exact colour/tone, stripe or patch pattern, any white)
- Face: head shape, cheeks, muzzle, nose
- Eyes: shape, colour
- Ears: shape, set
- Body build: (slim / chunky / fluffy)
- Tail: (length, fluffiness)
- POSE & action: exactly what the cat is doing (e.g. lying on its side, hugging a toy)
- Accessory / object it interacts with: (e.g. a grey plush mouse toy — colour, where held)
- 3 most identifying traits the owner would recognize
- The "memorable moment" of the photo, in one sentence

Be specific and visual. This brief will be pasted into a diorama image-generation prompt.
```

---

## STEP 2 — Generate (inputs: Image 1 = cat photo, Image 2 = source.png; paste the brief)

```
Create ONE chibi miniature-diorama figurine portrait, vertical 9:16 (864x1536).

THE CAT (identity + action) — from Image 1 and this brief:
<<< PASTE THE STEP-1 BRIEF HERE >>>
Reproduce this specific cat and its pose/action and the object it hugs, so the owner
recognizes THIS cat and THIS moment. No hat unless the brief says so.

PAWS & LEGS (important — generators botch feet): keep paws MINIMAL and mostly HIDDEN
under the thick fluffy coat — show as few paws as possible (ideally only the front
paws involved in the action). Do NOT show paw pads / paw beans or the undersides of
the feet. The cat must look anatomically normal: do NOT add extra, duplicate, or
floating paws/legs. When unsure, hide a paw in the fur rather than drawing it.

THE STYLE + SCENE — from Image 2 (source.png):
Render the cat as a cute CHIBI COLLECTIBLE FIGURINE in Image 2's exact craft style:
chunky chibi proportions (big rounded head, large eyes, small stubby body), soft
felted-wool / knitted handcrafted toy texture, matte — NOT photoreal fur, NOT a real
animal. Place it on the woven cushion in the same warm golden-hour Korean alley diorama
as Image 2 (green gate, brick walls, lantern, potted daisies, striped food stall,
scooter, recycling crate, leafy tree, utility pole, distant rooftops and Namsan tower),
same palette, lighting and framing.

Balance ~60% Image-1 cat identity + its pose/action, 40% Image-2 chibi craft style.
Do NOT just recolour Image 2's cat — give it the brief's pose, build and action.

LAYOUT for 3D parallax: the cat is the single foreground hero on the cushion, LOWER-
CENTER, clear empty margin all around, NOT touching any frame edge. Keep a simple
contrasting tone right behind the cat's outline so its silhouette reads. Three clear
depth layers (near cat / midground props with gaps / far sky + tower). Solid matte
opaque materials only; thin wires/branches only in the far sky plane.

No text, no clock, no UI, no watermark, no people. Output ONE vertical 9:16 image.
```

---

## Tuning log (update as we test)
- Balance knob: 60/40 identity/style. More "my cat" -> 65/35; more chibi -> 55/45.
- If the cat comes out realistic: strengthen "felted-wool figurine, NOT real fur".
- If it comes out as the source cat unchanged: strengthen "do NOT recolour, change pose".
