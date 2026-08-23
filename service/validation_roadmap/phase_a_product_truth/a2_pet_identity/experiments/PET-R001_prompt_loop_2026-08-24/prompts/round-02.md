# Round 02 — Identity First

## Round 01에서 바꾼 단 한 가지

`Image 2`를 고양이 시각 레퍼런스가 아니라 **고양이 픽셀을 버리고 위치 좌표만 읽는 layout map**으로 재정의한다. 합성 전에 `Image 3`만으로 독립적인 Identity Spec을 먼저 만들고, 최종 결과가 Image 2의 고양이를 닮으면 내부적으로 거부하고 다시 구성하도록 한다.

## Prompt

The three input images have strict, non-interchangeable roles, in this exact order:

1. IMAGE 1 = LOCKED BACKGROUND PLATE. It is the canonical `SM-S001 — Sunday Morning` scene.
2. IMAGE 2 = A LAYOUT MAP WITH A DISPOSABLE CAT. Extract only the cat bounding box, paw landing coordinates, overall scale, contact-shadow direction, and left-window light direction. Mentally erase every pixel and every identity trait of the cat in IMAGE 2 after extracting those coordinates. Its tabby stripes, colors, face, eyes, ears, body build, expression, and breed appearance are forbidden content and must never appear unless independently present in IMAGE 3.
3. IMAGE 3 = THE ONLY PET IDENTITY SOURCE. It controls the cat's face, head shape, eye color and spacing, nose, ears, coat colors, permanent markings, fur length, body build, and distinctive asymmetry.

Before composing, perform an identity-first pass using IMAGE 3 alone. Build a private Identity Spec for this individual: left and right eye color, eye shape and spacing, forehead marks, left and right cheek colors, nose color and shape, muzzle width, ear size and angle, fur length, coat pattern, permanent asymmetry, and body build. Do not borrow or average any of these fields from IMAGE 2.

Create one finished vertical 9:16 lock-screen image.

Preserve IMAGE 1 as an immutable plate: same canvas and crop, curtain folds, arched wall, pedestal geometry and texture, floor, warm cream palette, sunlight direction, and large clean upper area. Do not redesign, repaint, relight, crop, zoom, or add objects to the room.

Add exactly one cat, fully supported on the round pedestal at the layout coordinates extracted from IMAGE 2. Use the extracted location, approximate scale, grounded contact shadow, and soft left-side sunlight, but construct the animal exclusively from the IMAGE 3 Identity Spec. Use a premium tactile semi-realistic 3D finish without importing the disposable cat's appearance.

The finished cat must unmistakably be the individual cat in IMAGE 3. Preserve permanent identity traits precisely, including unusual eye colors, facial asymmetry, split-color or bicolor markings, muzzle shape, ear proportions, fur length, and body build. Translate photographic traits into the scene's polished semi-realistic 3D finish without beautifying the cat into a generic breed and without enlarging the eyes into a chibi style.

Ignore the original room, camera crop, human hands, blankets, hats, clothing, tags, harnesses, and temporary accessories in IMAGE 3. Reconstruct only occluded body areas as normal cat anatomy consistent with the visible pet. Keep exactly two eyes, two ears, four anatomically plausible legs/paws, and one tail. No duplicate animal, extra limbs, fused paws, floating body, text, logo, signature, watermark, border, or UI.

Before returning the result, compare the finished cat against IMAGE 3 and against the disposable cat in IMAGE 2. If its face, coat, or expression is closer to IMAGE 2 than IMAGE 3, reject that draft and rebuild the cat from the Identity Spec while keeping only the layout coordinates.

The result must look like IMAGE 3's real cat was carefully placed into IMAGE 1, with IMAGE 2 reduced to an invisible positioning grid.

