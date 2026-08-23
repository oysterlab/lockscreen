# PET-R001 Final Report

## 결과

| Round | 변경 | 총점 | Identity / 35 | Hard pass | BG top SSIM |
|---|---|---:|---:|---:|---:|
| 01 | 세 입력 역할 명시 | 80.2 | 26.7 | 80.0% | 0.956 |
| 02 | Identity-first + Image 2를 layout map으로 재정의 | 81.0 | 27.1 | 80.0% | 0.961 |
| 03 | 외부 human-verified Identity Capsule 주입 | **87.5** | **30.7** | **86.7%** | **0.963** |

Round 03이 최선이다. Round 01 대비 총점은 7.3점, Identity는 4.0점, Hard pass는 6.7%p 개선됐다. 그러나 Hard Fail 2건과 15/15 배경 재렌더링이 남아 현재의 3-image full-frame prompt-only 레시피는 생산 승인하지 않는다.

## 결정

다음 생산 구조는 역할을 분리한다.

1. 사용자 사진에서 검증 가능한 Identity Capsule을 만든다.
2. 사용자 사진과 Capsule로 **고양이 전용 투명 자산**을 생성한다. 정체성이 섞이는 Image 2 고양이는 이 단계에 넣지 않는다.
3. 고정 좌표·스케일·마스크·그림자 규칙으로 원본 1080x1920 배경에 결정론적으로 합성한다.
4. Identity < 25/35 또는 배경 픽셀 변경을 자동 반려하고 재생성한다.

이 구조는 Round 03의 정체성 개선을 유지하면서, 프롬프트로 해결되지 않은 배경 잠금과 공간 참조 정체성 누출을 제거한다.

## 실행 조건

- 15개 고정 사용자 입력, 3회, 시작 간격 2시간
- 총 45개 생성물
- Codex built-in ImageGen
- quality: `auto`; API 미사용
- 사용자 소유·공개 게시 권한 확인: 2026-08-24 KST
