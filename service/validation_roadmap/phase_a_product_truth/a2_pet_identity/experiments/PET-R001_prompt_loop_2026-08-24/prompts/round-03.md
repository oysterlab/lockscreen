# Round 03 — External Identity Capsule

## Round 02에서 바꾼 단 한 가지

Image 3을 모델이 내부적으로 해석하게만 두지 않고, 각 소스에서 사람이 검증한 한 줄짜리 `IDENTITY CAPSULE`을 프롬프트에 명시적으로 주입한다. 세 이미지와 그 순서, 배경·배치 조건, 출력 조건은 그대로다.

## Prompt template

The three input images have strict, non-interchangeable roles, in this exact order:

1. IMAGE 1 = LOCKED BACKGROUND PLATE. It is the canonical `SM-S001 — Sunday Morning` scene.
2. IMAGE 2 = A LAYOUT MAP WITH A DISPOSABLE CAT. Extract only the cat bounding box, paw landing coordinates, overall scale, contact-shadow direction, and left-window light direction. Mentally erase every pixel and every identity trait of the cat in IMAGE 2 after extracting those coordinates. Its tabby stripes, colors, face, eyes, ears, body build, expression, and breed appearance are forbidden content and must never appear unless independently present in IMAGE 3.
3. IMAGE 3 = THE ONLY PET IDENTITY SOURCE. It controls the cat's face, head shape, eye color and spacing, nose, ears, coat colors, permanent markings, fur length, body build, and distinctive asymmetry.

HUMAN-VERIFIED IDENTITY CAPSULE FOR IMAGE 3:
{{IDENTITY_CAPSULE}}

Treat every visible permanent trait in this capsule as a hard constraint. Verify it against IMAGE 3. The capsule never authorizes inventing a trait that is absent from IMAGE 3; it only tells you which source-specific details must not be averaged away.

Create one finished vertical 9:16 lock-screen image.

Preserve IMAGE 1 as an immutable plate: same canvas and crop, curtain folds, arched wall, pedestal geometry and texture, floor, warm cream palette, sunlight direction, and large clean upper area. Do not redesign, repaint, relight, crop, zoom, or add objects to the room.

Add exactly one cat, fully supported on the round pedestal at the layout coordinates extracted from IMAGE 2. Use the extracted location, approximate scale, grounded contact shadow, and soft left-side sunlight, but construct the animal exclusively from IMAGE 3 and its Identity Capsule. Use a premium tactile semi-realistic 3D finish without importing the disposable cat's appearance.

The finished cat must unmistakably be the individual cat in IMAGE 3. Preserve the capsule traits precisely. Translate photographic traits into the scene's polished semi-realistic 3D finish without beautifying the cat into a generic breed and without enlarging the eyes unless the capsule and IMAGE 3 prove that unusually large eyes are an identity trait.

Ignore the original room, camera crop, human hands, blankets, hats, clothing, tags, harnesses, and temporary accessories in IMAGE 3. Reconstruct only occluded body areas as normal cat anatomy consistent with the visible pet. Keep exactly two eyes, two ears, four anatomically plausible legs/paws, and one tail. No duplicate animal, extra limbs, fused paws, floating body, text, logo, signature, watermark, border, or UI.

Before returning the result, compare the finished cat against IMAGE 3, the Identity Capsule, and the disposable cat in IMAGE 2. If it violates any capsule trait or is closer to IMAGE 2 than IMAGE 3, reject that draft and rebuild the cat while keeping only Image 2's layout coordinates.

The result must look like IMAGE 3's real cat was carefully placed into IMAGE 1, with IMAGE 2 reduced to an invisible positioning grid.
