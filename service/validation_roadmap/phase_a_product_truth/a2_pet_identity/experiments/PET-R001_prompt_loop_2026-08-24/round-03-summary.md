# Round 03 Summary

- Started: 2026-08-24 04:57 KST
- Completed: 2026-08-24 05:06 KST
- Generated: 15 / 15
- Mean total score: **87.5 / 100** (`+7.3` vs Round 01, `+6.5` vs Round 02)
- Mean Identity likeness: **30.7 / 35** (`+4.0` vs Round 01, `+3.6` vs Round 02)
- Hard Fail: **2 / 15 (13.3%)**
- Hard Pass: **13 / 15 (86.7%)**
- Mean background top-region SSIM: **0.963**
- Output resolution: **941x1672** instead of canonical **1080x1920**

## 판정

외부 Identity Capsule은 세 회차 중 가장 큰 개선을 만들었다. 특히 RC-CAT-081의 큰 누운 체형, RC-CAT-105의 큰 귀와 날씬한 벵갈 체형, RC-CAT-117의 긴 앞발, RC-CAT-126의 큰 눈·앞으로 나온 주둥이·젖은 털 단서가 회복됐다. RC-CAT-126은 처음으로 Hard Fail을 벗어났다.

그러나 Nala의 서로 다른 두 입력은 모두 25/35 미만이었다. 캡슐이 큰 눈과 둥근 얼굴을 강화했지만 Image 2의 고양이 골격과 자세가 여전히 더 강하게 남았다. 따라서 이 세 이미지 전체를 한 번에 넣는 단일 프롬프트는 평균 품질은 높아도 개체 정체성의 최악 사례를 막지 못한다.

배경은 세 회차 모두 다시 렌더링됐고 941x1672로 출력됐다. 상단 SSIM 0.963은 육안 유사성을 뜻할 뿐 원본 픽셀 잠금을 뜻하지 않는다.
