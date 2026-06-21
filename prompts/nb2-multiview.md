# Nano Banana 2 — multi-view source prompts (for deeper parallax)

Goal: generate the SAME scene from a few camera angles so the 3D-photo pipeline has
REAL disocclusion + depth data (not single-photo guesses). Then `?scene=lab2` is
built from these.

**Input image:** `assets/depth/plate_clean.png` (the clean, UI-removed scene,
864×1536). NOT cherry.png — that one has the iOS clock/buttons baked in.

**Settings:** keep the same 9:16 aspect and framing. Start at ~12–15° of camera
rotation; if NB2 distorts or invents detail, drop to 8–10°. Generate the LEFT and
RIGHT views (horizontal parallax is what the lockscreen uses most); UP/DOWN optional.

Shared scene-lock (every prompt starts with this so identity holds):

> The image is a cozy golden-hour Korean alley diorama in a soft chibi 3D style: a
> small tabby cat wearing a knitted lime-green bonnet sitting on a woven straw
> cushion with a green ball of yarn beside it; a green metal gate in a brick wall
> with a blue "22" plate, a lantern and a small white cat figurine on the wall; a
> sparrow; a street-food stall with a red-and-white striped awning and skewers; a
> parked cream scooter; a blue recycling bin; potted white daisies; a leafy tree; a
> wooden utility pole with power lines and a street lamp; distant hanok tiled
> rooftops and the Namsan tower under a warm hazy amber sunset.

---

## LEFT view

> [paste scene-lock above, then:]
> Re-render this EXACT scene from a camera viewpoint moved about 15° to the LEFT,
> orbiting left around the scene and still looking at the same cat. Photograph the
> identical, unchanged 3D scene from the new angle: every object stays in its exact
> world position, same pose, same expression, same colours, same warm lighting,
> same art style, same framing and crop. Render the natural PARALLAX of the new
> angle — the near objects (cat, cushion, gate, stall, scooter) shift RIGHT relative
> to the distant rooftops and tower, and reveal the thin slivers of background that
> were hidden just behind their LEFT edges (a little more wall behind the cat's left
> side, a little more ground, a little more behind the gate and stall). Nothing in
> the scene moves or changes except the camera angle.
> Keep it photorealistic and identical in style, detail and lighting to the input.
> Do NOT add, remove, or restyle any object. Do NOT change the cat. No text, no
> clock, no phone UI, no status bar, no home indicator, no icons, no watermark.
> Output one full vertical 9:16 image at the same framing.

## RIGHT view

> [paste scene-lock above, then:]
> Re-render this EXACT scene from a camera viewpoint moved about 15° to the RIGHT,
> orbiting right around the scene and still looking at the same cat. Photograph the
> identical, unchanged 3D scene from the new angle: every object stays in its exact
> world position, same pose, expression, colours, lighting, art style, framing and
> crop. Render the natural PARALLAX — the near objects shift LEFT relative to the
> distant rooftops and tower, revealing the thin slivers of background hidden just
> behind their RIGHT edges. Nothing moves or changes except the camera angle.
> Keep it photorealistic and identical to the input. Do NOT add, remove or restyle
> any object. Do NOT change the cat. No text, no clock, no UI, no status bar, no
> home indicator, no icons, no watermark. Output one full vertical 9:16 image at the
> same framing.

## (optional) Camera-LOWER view, for vertical parallax

> [paste scene-lock, then:]
> Re-render this EXACT scene from a camera viewpoint moved slightly DOWN and looking
> a touch upward (about 10°), same scene unchanged. Natural parallax: the near
> objects rise relative to the far rooftops/tower; reveal the slivers hidden just
> under the foreground edges. Same style, lighting, framing. No text/UI/watermark.
> One full vertical 9:16 image.

---

Hand the resulting images back (name them `mv_left.png`, `mv_right.png`,
`mv_down.png`); they get aligned + fused into a layered depth representation for
`?scene=lab2`.
