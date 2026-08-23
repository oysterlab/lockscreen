# Round 01 — Baseline

## 변경 가설

입력 이미지의 역할을 번호로 고정하고, Image 2가 고양이 정체성에 영향을 주지 못하도록 명시하면 배경·배치와 사용자 고양이 정체성을 분리할 수 있다.

## Prompt

The three input images have strict, non-interchangeable roles, in this exact order:

1. IMAGE 1 = LOCKED BACKGROUND PLATE. It is the canonical `SM-S001 — Sunday Morning` scene.
2. IMAGE 2 = COMPOSITION REFERENCE ONLY. It controls only the cat's placement, scale, seated pose family, contact shadow, left-window lighting, and premium semi-realistic 3D rendering finish.
3. IMAGE 3 = THE ONLY PET IDENTITY SOURCE. It controls the cat's face, head shape, eye color and spacing, nose, ears, coat colors, permanent markings, fur length, body build, and distinctive asymmetry.

Create one finished vertical 9:16 lock-screen image.

Preserve IMAGE 1 as an immutable plate: same canvas and crop, curtain folds, arched wall, pedestal geometry and texture, floor, warm cream palette, sunlight direction, and large clean upper area. Do not redesign, repaint, relight, crop, zoom, or add objects to the room.

Add exactly one cat, fully supported on the round pedestal in the same location and approximately the same scale as IMAGE 2. Match IMAGE 2's natural seated placement, grounded contact shadow, soft left-side sunlight, and premium tactile semi-realistic 3D finish, but never copy its cat identity, tabby pattern, facial proportions, eye color, or expression.

The finished cat must unmistakably be the individual cat in IMAGE 3. Preserve permanent identity traits precisely, including unusual eye colors, facial asymmetry, split-color or bicolor markings, muzzle shape, ear proportions, fur length, and body build. Translate photographic traits into the scene's polished semi-realistic 3D finish without beautifying the cat into a generic breed and without enlarging the eyes into a chibi style.

Ignore the original room, camera crop, human hands, blankets, hats, clothing, tags, harnesses, and temporary accessories in IMAGE 3. Reconstruct only occluded body areas as normal cat anatomy consistent with the visible pet. Keep exactly two eyes, two ears, four anatomically plausible legs/paws, and one tail. No duplicate animal, extra limbs, fused paws, floating body, text, logo, signature, watermark, border, or UI.

The result must look like IMAGE 3's real cat was carefully placed into IMAGE 1 using IMAGE 2 only as a staging guide.

