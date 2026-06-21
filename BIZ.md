# Business notes — Cat Diorama Lockscreen

"Your pet, as an interactive collectible." Upload a cat photo → get a cute chibi-diorama
version of YOUR cat as a live, tilt-reactive phone lockscreen.

## The product in one line
Personalized, interactive 3D lockscreen generated from a single pet photo — recognizably
your cat, restyled as a premium handcrafted-figurine diorama, that moves with parallax.

## Why it can work
- **Emotional hook**: people love their pets and love seeing them "made cute."
  Recognition ("that's MY cat") + charm (chibi figurine) is the wedge. Verified across 3
  very different cats (grey tabby, ginger longhair, white munchkin) — each recognizable.
- **Differentiator vs. plain AI pet art**: it's not a flat image, it's an INTERACTIVE
  depth lockscreen (gyro + touch). That motion is the "wow" a screenshot can't copy.
- **Repeatable pipeline**: photo → diorama (prompt) → 3D scene (automatic). Marginal cost
  per cat is one image-gen call + a few seconds of local compute.

## What's proven (tech de-risked)
- The 2-step prompt reliably turns a real cat into an on-style diorama (identity + pose +
  accessory preserved; size/cuteness tuned). See `prompts/diorama-2step.md`.
- The local pipeline turns any such diorama into a clean, artifact-free parallax
  lockscreen (Large depth + auto mask + layered render). See `STATUS.md`.
- Runs today as a manual flow; the only gap to a product is wiring the two prompt steps
  to an API.

## Open product questions (decide later)
- **Delivery**: web link per cat? installable wallpaper? iOS Live Wallpaper / video
  export for the actual lock screen? (Current output is a web page; a native lock screen
  needs a video / Live Photo export path — worth scoping.)
- **Monetization**: one-off per cat? subscription for a rotating / seasonal set (the scene
  is swappable: hat, flowers, holidays)? print / figurine upsell (the chibi render is
  literally a figurine mockup)?
- **Style catalog**: one cherry-alley style now. The style ref is swappable, so "scene
  packs" (cafe, beach, christmas) are a natural catalog.
- **Input quality**: needs a reasonably clear pet photo; dark/cluttered photos may need
  guidance. Onboarding should nudge a good photo.

## Cost / unit economics (rough, to validate)
- Generation: ~1 image-gen call per cat (plus retries) → cents per cat.
- Rendering: local/GPU seconds per cat → negligible at small scale.
- Main cost driver if automated: image-gen API + hosting per-cat assets (~5–6 MB each).

## Status & next business step
- Tech: working end-to-end (manual). Quality tuned and verified on 3 cats.
- Next: (1) automate STEP1+STEP2 via API → self-serve "upload photo" demo; (2) decide the
  delivery format for an actual phone lock screen (web vs. Live Wallpaper export);
  (3) test willingness-to-pay with a small landing page + the 3 existing demos.

(Resume technical work from `STATUS.md`.)
