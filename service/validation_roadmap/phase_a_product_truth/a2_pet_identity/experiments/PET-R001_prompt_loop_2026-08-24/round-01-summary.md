# Round 01 Summary

- Started: 2026-08-24 00:57 KST
- Completed: 2026-08-24 01:08 KST
- Generated: 15 / 15
- Mean total score: **80.2 / 100**
- Mean Identity likeness: **26.7 / 35**
- Hard Fail: **3 / 15 (20.0%)**
- Hard Pass: **12 / 15 (80.0%)**
- Mean background top-region SSIM: **0.956**
- Output resolution: **941×1672** instead of canonical **1080×1920**

## 가장 큰 프롬프트 대응 가능 Identity 실패 군집

전체 빈도만 보면 `background_repaint`와 `resolution_mismatch`가 각각 15/15로 가장 크다. 그러나 이는 내장 ImageGen이 전체 캔버스를 다시 렌더링하는 출력 구조의 문제라 프롬프트 한 줄로 해결될 가능성이 낮고, 아래 배경 판정에서 별도 구조적 결론으로 다룬다. Pet Identity 영역에서 가장 큰 프롬프트 대응 가능 실패는 `Image 2`의 고양이 정체성이 `Image 3`보다 강하게 복사되는 reference identity leakage다. Nala의 두 입력에서 반복됐으므로 우연한 단일 실패가 아니라 입력 역할 분리의 재현성 문제다. RC-CAT-126도 강한 근접 왜곡 특징이 일반적인 주황 고양이 얼굴로 평준화됐다.

## 배경 판정

육안상 배경은 매우 비슷하지만 모든 출력이 941×1672로 재생성됐고 상단 영역도 픽셀 동일하지 않다. 따라서 로드맵의 “Canonical Scene을 AI로 다시 생성하지 않는다”는 의미의 엄격한 Background Lock은 통과하지 못했다. 이번 3회 루프에서는 프롬프트만으로 SSIM과 구도 안정성이 개선되는지 계속 측정하되, 최종 생산 레시피는 고양이 자산 생성 후 원본 배경에 결정론적으로 합성하는 구조가 필요할 가능성이 높다.

## Round 02 단일 변경

Image 2의 고양이를 긍정적 시각 참고로 부르지 않고, **좌표·바운딩 박스·접지 위치만 추출한 뒤 고양이 외형 픽셀은 폐기해야 하는 layout map**으로 재정의한다. Image 3을 먼저 독립적으로 분석해 Identity Spec을 만든 다음 합성하도록 순서를 강제한다.
