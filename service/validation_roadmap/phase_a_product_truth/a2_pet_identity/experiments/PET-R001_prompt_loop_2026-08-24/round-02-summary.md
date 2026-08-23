# Round 02 Summary

- Started: 2026-08-24 02:57 KST
- Completed: 2026-08-24 03:07 KST
- Generated: 15 / 15
- Mean total score: **81.0 / 100** (`+0.8` vs Round 01)
- Mean Identity likeness: **27.1 / 35** (`+0.4`)
- Hard Fail: **3 / 15 (20.0%)** (unchanged)
- Hard Pass: **12 / 15 (80.0%)** (unchanged)
- Mean background top-region SSIM: **0.961** (`+0.005`)
- Output resolution: **941x1672** instead of canonical **1080x1920**

## Round 02 판정

Image 2를 disposable layout map으로 부르고 Image 3을 먼저 분석하도록 한 변경은 평균 Identity를 0.4점만 높였고 Hard Fail 수를 줄이지 못했다. 특히 서로 다른 두 Nala 사진이 모두 공간 참조 고양이 쪽으로 평준화됐으며 RC-CAT-126의 넓은 눈과 광각 얼굴도 다시 일반적인 주황 고양이로 바뀌었다. 따라서 모델 내부에서 알아서 Identity Spec을 만들라는 자연어 지시는 강한 시각 참조 간섭을 제거하기에 부족하다.

상단 배경 SSIM은 0.956에서 0.961로 소폭 올랐지만 모든 이미지가 다시 그려졌고 해상도도 941x1672로 고정됐다. 엄격한 Background Lock은 여전히 실패다.

## Round 03 단일 변경

각 Image 3에서 사람이 검증한 한 줄짜리 **Identity Capsule**을 사전에 만들고 프롬프트에 명시적으로 주입한다. 입력 이미지와 공간 참조는 그대로 유지한다. 내부 추론에 맡겼던 정체성 특징을 외부의 감사 가능한 텍스트 조건으로 바꾸는 것만이 이번 변경이며, 실제 제품에서는 사용자 사진 전처리 단계로 구현할 수 있다.
