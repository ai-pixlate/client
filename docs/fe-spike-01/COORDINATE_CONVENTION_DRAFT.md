# 좌표계 규약 (초안)

- **작성** 2026-08-22 · FE Spike ① 산출물
- **상태** 초안 — 백엔드(김도연)·AI(강예람) 확인 후 확정
- **근거 문서** 요구사항정의서 v2.3 (F-CRP-01a, F-INP-02, F-INP-02c, NFR-13) · pixate-frontend-data-spec.md 0-1
- **구현** `lib/spike/coordinates.ts` · 검증 `scripts/verify-coordinates.mjs`

---

## 0. 최우선 원칙

> **source 좌표를 canonical 값으로 유지하고, 화면 좌표를 영구 저장하지 않는다.**

화면에 보이는 위치는 배율에 따라 계속 변합니다. 그 값을 저장하면 줌을 바꿀 때마다
저장값을 고쳐야 하고, 고칠 때마다 반올림 오차가 쌓입니다.
저장값은 원본 픽셀 하나뿐이고, 화면 좌표는 그릴 때마다 새로 계산합니다.

---

## 1. 좌표계 3종

| 좌표계 | 원점 | 단위 | 필드명 | 누가 만드는가 | Spike① 범위 |
|---|---|---|---|---|---|
| **source** | 업로드한 원본 이미지의 좌상단 | 원본 픽셀 (정수) | `sourceX` `sourceY` `sourceWidth` `sourceHeight` | 프론트 (S2 크롭 시) | 구현 |
| **piece** | 크롭된 조각의 좌상단 `(0,0)` | 원본 픽셀 | `pieceX` `pieceY` `pieceWidth` `pieceHeight` | 백엔드 (F-INP-02 OCR 결과) | 타입만 정의 |
| **module** | 모듈 캔버스(970×300)의 좌상단 | 모듈 픽셀 | `moduleX` `moduleY` `moduleWidth` `moduleHeight` | 백엔드 (F-INP-02c 변환) | 타입만 정의 |

필드명에 좌표계를 반드시 넣습니다. `x` 하나만 쓰면 어느 기준인지 알 수 없고,
실무 좌표 버그의 대부분이 여기서 나옵니다.

### 화면 전용 값 (저장 금지)

| 이름 | 의미 |
|---|---|
| `DisplayRect { left, top, width, height }` | 지금 화면에 그릴 위치. 매 렌더마다 계산 |
| `DisplayPoint { displayX, displayY }` | 마우스 위치 등 화면 기준 한 점 |

`SourceRect`와 이름을 일부러 다르게 지었습니다. `left/top`이 보이면 "이건 화면 값이라
저장하면 안 된다"는 것이 바로 드러납니다.

---

## 2. 배율 3종

```
displayScale = previewScale × zoomScale
```

| 이름 | 의미 | 결정 주체 | 사용자가 바꿀 수 있는가 |
|---|---|---|---|
| `previewScale` | 원본을 다운스케일한 프리뷰의 배율 (`previewWidth / originalWidth`) | **백엔드** (업로드 응답에 포함) | 아니오 |
| `zoomScale` | 사용자가 화면에서 확대·축소한 배율 | 프론트 | 예 |
| `displayScale` | 실제 화면 배율. 위 둘의 곱 | 계산값 | — |

**이 둘을 한 변수에 합치면 안 됩니다.** 합치면 줌을 바꿀 때 `previewScale`까지
덮어써져 원본과의 관계가 끊어집니다.

### previewScale 제공 주체

`pixate-frontend-data-spec.md` S1 업로드 응답에 명시되어 있습니다.

> `previewScale`을 백엔드가 명시해주면 프론트의 좌표 변환 오차가 사라집니다.
> 프론트가 계산하면 반올림 차이로 1~2px씩 어긋납니다.

프론트는 `previewWidth / originalWidth`를 **직접 계산하지 않습니다.**
`<img>`의 `naturalWidth`는 브라우저가 디코딩한 뒤에야 확정되고, 그 값으로 나누면
이미지 로드 타이밍에 따라 좌표가 달라집니다.

---

## 3. 변환 규칙

### display → source (크롭을 만들 때, 딱 한 번)

```
sourceX = displayX / displayScale
sourceY = displayY / displayScale
```

### source → display (화면에 그릴 때, 매 렌더마다)

```
displayX = sourceX × displayScale
displayY = sourceY × displayScale
```

### 금지 사항

- 저장된 source 값에 배율을 **다시 곱하거나 나누어 덮어쓰지 않는다.**
  줌을 바꿀 때마다 저장값을 갱신하는 구조는 오차가 누적됩니다.
- 화면 좌표를 계산할 때 `scrollTop`을 직접 더하고 빼지 않는다.
  `getBoundingClientRect()`가 스크롤을 이미 반영한 값을 돌려줍니다.

---

## 4. 반올림 정책

크롭 확정 시 **딱 한 번만** 반올림하며, 순서가 정해져 있습니다.

```
1) 두 점을 source 좌표(실수)로 변환
2) 역방향 드래그 정규화 (min/max)
3) 이미지 경계로 clamp
4) 네 모서리를 각각 Math.round()          ← 반올림은 여기 한 번
5) width = round(right) − round(left)
   height = round(bottom) − round(top)
```

**5번이 핵심입니다.** `width`를 따로 반올림하면 `left + width`가 `right`와 어긋나
1px 틈이 생깁니다. 모서리를 먼저 정수로 만들고 그 차이로 크기를 구하면
`left + width === right`가 항상 성립합니다.

- 중간 계산은 실수(double)로 둡니다. 단계마다 반올림하면 오차가 쌓입니다.
- 저장 형식은 **정수 원본 픽셀**입니다. 서버 크롭 연산이 정수 픽셀 단위이기 때문입니다.

---

## 5. 경계 clamp 정책

| 상황 | 처리 |
|---|---|
| 음수 좌표 | `0`으로 clamp, `clamped: true` 반환 |
| 이미지 오른쪽·아래 초과 | `originalWidth` / `originalHeight`로 clamp, `clamped: true` |
| 드래그가 **전부** 이미지 바깥 | 크롭 생성 실패 (`OUT_OF_BOUNDS`) |
| clamp 후 width 또는 height가 0 | 생성 실패 (`ZERO_SIZE`) |
| clamp 후 `MIN_CROP_SOURCE_PX` 미만 | 생성 실패 (`TOO_SMALL`) — 클릭 오조작 방지용 |
| `displayScale`이 0·음수·NaN·Infinity | 생성 실패 (`INVALID_SCALE`) |

clamp가 발생하면 사용자에게 "이미지 경계를 넘어 잘라냈습니다"라고 알립니다.
조용히 잘라내면 사용자가 의도한 영역과 다른 결과가 나옵니다.

---

## 6. canonical 저장 좌표

서버에 보내고 DB에 저장하는 값은 **source 좌표뿐**입니다.

```ts
type Crop = {
  id: string;              // 실제로는 서버가 발급하는 pieceId
  sourceImageId: string;
  sourceX: number;         // 원본 픽셀, 정수
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
};
```

`zoomScale`, `displayScale`, 화면상의 `left/top/width/height`는 저장하지 않습니다.
`previewScale`은 서버가 이미 갖고 있으므로 프론트가 되돌려 보내지 않습니다.

---

## 7. Spike①에서 검증된 것

`scripts/verify-coordinates.mjs` — 87건 전부 PASS.

| 검증 | 결과 |
|---|---|
| `displayScale = previewScale × zoomScale` (36조합) | PASS |
| 줌 0.1~4배 전 구간에서 왕복 오차 `< 1e-9` | PASS |
| 줌 100회 변경 후 저장값 완전 동일 | PASS |
| 같은 화면 위치 드래그 → 전 줌에서 동일한 source 사각형 | PASS |
| 역방향 드래그 == 정방향 드래그 | PASS |
| 무작위 500건 — 전부 정수 · 경계 초과 0건 | PASS |

부동소수점 최대 잔차는 `previewScale=0.333333, zoom=4`에서 `2.84e-14 px`였습니다.
원본 픽셀 기준으로 소수점 14자리 아래이므로 반올림 후에는 사라집니다.

---

## 8. 확인 필요

### ① NFR-13 허용 오차 수치 미확정 — OI-27 (긴급도: 최우선)

NFR-13은 "텍스트 좌표 오차가 원본 대비 허용치 이내"라고만 하고, 허용치 정의를
OI-27로 미뤄두고 있습니다. Spike①은 자체 기준으로 `0px`만 썼습니다.

**프론트 좌표 변환의 오차는 `0`입니다.** 따라서 OI-27의 허용치는 프론트가 아니라
OCR 인식 정확도와 조각→모듈 변환(F-INP-02c)에 대해 정하시면 됩니다.
프론트 몫으로 예산을 배분할 필요가 없습니다.

### ② piece → module 변환 주체

`pixate-frontend-data-spec.md` 0-1은 "모듈 좌표는 F-INP-02c에 따라 백엔드가 계산한다"
고 적었고, 요구사항정의서 v2.3 F-INP-02c도 백엔드 산출로 읽힙니다.
**프론트는 `moduleX/moduleY`를 계산하지 않고 받아 쓰는 것으로 가정하고 진행합니다.**
다르면 알려주십시오.

### ③ bbox 필드가 어느 좌표계인지 (API 명세에 아직 없음)

현재 API 명세(`API_SPEC.MD`)는 F-ACC 계정 영역만 작성되어 있어
S2·S4 좌표 필드가 정의되어 있지 않습니다. 위 3종 명명 규칙을 그대로 쓰는 것을 제안합니다.

### ④ 문서 간 기준 버전 차이

`pixate-frontend-data-spec.md`는 요구사항정의서 **v1.8.1** 기준(2026-08-20)이라
v2.3의 변경(되돌림 12월 이월, 신뢰도 점수 폐기, 상태값 9종)이 반영돼 있지 않습니다.
좌표계 규약(0-1)만 채택했고 나머지는 v2.3을 우선했습니다.
