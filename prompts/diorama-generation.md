# Diorama generation prompt — optimized for the depth-parallax pipeline

Use this to generate NEW cat-diorama scenes (like cherry/latte/nila) with codex
imagegen so they feed our depth-parallax lockscreen well. These rules come from what
actually helped vs broke the pipeline (depth estimate → subject matte → layer cut →
3-plane parallax).

**Why each rule exists (our pipeline's needs):**
- We estimate a depth map (Depth Anything Large) and split the scene into planes.
  Scenes with clear depth ordering + distinct objects parallax beautifully; flat
  walls of clutter read as cardboard.
- We matte the cat (rembg/grabcut/codex). A silhouette that contrasts with whatever
  is directly behind it mattes cleanly; a cat ear in front of a same-color object
  gets missed (we hit exactly this: a grey ear over a green gate).
- Thin structures (wires, twigs) that span near→far STRETCH under parallax.
- The subject parallaxes vertically; if it touches the top/bottom edge its ears/paws
  clip.

---

## The prompt

> A cozy miniature diorama in a soft chibi 3D-render style, vertical 9:16 portrait.
>
> HERO SUBJECT: one cute cat as the single clear foreground hero, in the LOWER-CENTER
> of the frame, sitting/lying on a small cushion or mat that is fully underneath it.
> The cat is the nearest object and clearly pops forward from the scene. Leave a clear
> margin of empty space around the whole cat — its ears do NOT touch the top of the
> cushion area and nothing crowds its outline. The cat must NOT touch any frame edge.
>
> SILHOUETTE CONTRAST (important): directly behind the cat's outline — especially
> behind the ears and head — keep a SIMPLE, CONTRASTING background tone (e.g. open sky,
> a plain wall, soft bokeh) so the cat's silhouette reads clearly and is never the same
> colour as what is right behind it. Do not place busy same-colour objects directly
> kissing the cat's edge.
>
> DEPTH IN THREE CLEAR LAYERS:
>   1) Foreground: the cat + cushion (nearest).
>   2) Midground: a few distinct props with clear GAPS between them (e.g. a gate, a
>      little stall, a parked scooter, potted plants) — each readable as its own solid
>      object, not overlapping into a cluttered mush.
>   3) Far background: open sky and a distant city / hills / a tower, clearly far away.
> Make the distances obviously different so the scene has real depth, not a flat wall.
>
> GROUND: a paved ground plane that recedes into the distance (gentle perspective),
> giving a smooth near-to-far depth gradient.
>
> MATERIALS: solid, matte, opaque surfaces only. NO glass, mirrors, water, windows
> with reflections, or transparent/translucent objects (they break depth). Soft, even
> golden-hour lighting; avoid heavy backlit haze that would blur the cat's outline into
> the background.
>
> THIN STRUCTURES: avoid thin wires/twigs that cross from the foreground to the far
> distance. If you include power lines or branches, keep them confined to the FAR plane
> (silhouetted against the sky only), never passing in front of the cat or midground.
>
> STYLE: warm, cozy, handcrafted miniature; appealing, photogenic.
>
> STRICT: no text, no clock, no phone UI, no status bar, no icons, no watermark, no
> people. Output one full vertical 9:16 image, subject lower-center, sky in the upper
> third. Print the absolute file path.

---

## After generating, also ask codex for the matching assets (same framing)

Our pipeline wants these aligned to the generated scene (all same WxH, no redraw):
1. **cat-free background** — "remove ONLY the cat + cushion, seamlessly fill behind
   them, keep everything else identical." -> `base.png` (clean back layer + its depth).
2. **cat-only cutout** — "keep ONLY the cat (BOTH ears fully, the hat, scarf),
   everything else transparent." -> exact subject matte for masking/protect.

These two are cheap, well-aligned edits codex does reliably (unlike depth maps or new
viewpoints, which it cannot do). With them we skip LaMa guessing entirely.

See also [[chibi-cat-diorama]] (a different prompt: stylize an existing real cat into a
figurine).
