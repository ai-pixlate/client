# 긴 상세페이지 N3/N5 성능 Baseline 결과

## 검증 목적

실제 긴 상품 상세페이지를 사용해 N3 섹션 목록과 N5 번역 검수 화면이 현재 비최적화 상태에서 어느 규모까지 버티는지 확인했다.

이번 검증에서는 의도적으로 다음 최적화를 적용하지 않았다.

- virtualization
- lazy loading
- IntersectionObserver
- React.memo
- content-visibility

즉 선제 최적화 전 baseline 검증이다.

## 실제 테스트 자산

`perf-assets/long-pages/` 아래 실제 제품 5개를 사용했다.

static image:

- 제품 5개
- JPG/JPEG/PNG/WEBP 127장
- 총 이미지 크기 약 46.83MB
- 총 세로 길이 203,900px

제품별:

| alias | image count | total height | total size |
|---|---|---|---|
| P-01 | 6 | 19,040px | 2.05MB |
| P-02 | 29 | 30,125px | 5.80MB |
| P-03 | 54 | 80,226px | 22.94MB |
| P-04 | 34 | 63,857px | 13.54MB |
| P-05 | 4 | 10,652px | 2.51MB |

GIF는 일부 실제 상세페이지에 존재하지만 이번 baseline에서는 제외했다.

이유:

- 현재 입력 지원 여부가 아직 확정되지 않음
- animated GIF 자체의 decode/render 부하가 baseline 목적을 왜곡할 수 있음

GIF 파일은 삭제하지 않았고, 향후 필요하면 별도 stress case로 검증할 수 있다.

## N3 Baseline

| 시나리오 | sections | mount→paint |
|---|---|---|
| N3-10 | 10 | 약 3.0ms |
| N3-30 | 30 | 약 4.4ms |
| N3-50 | 50 | 약 5.4ms |
| N3-100 | 100 | 약 7.6ms |
| N3-150 | 150 | 약 11.2ms |

Performance recording에서 100/150 section까지 스크롤 시 Main thread가 지속적인 long task로 막히는 현상은 관찰되지 않았다. Frames도 전반적으로 안정적으로 유지됐다.

**판정: PASS**

현재 규모에서는 N3에 virtualization을 선제 적용할 근거가 없다.

## N5 Baseline

**Case A**

- product: P-02
- images: 29
- total image height: 30,125px
- total image size: 5.80MB
- textBlocks/textarea: 30
- mount→paint 약 13.0ms

**Case B**

- products: P-05 + P-02 + P-03
- images: 87
- total image height: 121,003px
- total image size: 약 31.25MB
- textBlocks/textarea: 90
- mount→paint 약 23.6ms

주의: 이전 중간 보고의 120,603px는 계산 오류였고 정확한 값은 121,003px이다.

**Case C**

- products: 전체 5개
- images: 127
- total image height: 203,900px
- total image size: 46.83MB
- textBlocks/textarea: 300
- mount→paint 약 34.4ms

스크롤 Performance 기록에서 Case C까지 Main thread가 장시간 지속적으로 막히는 패턴은 관찰되지 않았다. Frames도 대부분 정상적으로 유지됐다.

**판정: PASS**

현재 규모에서는 N5에도 virtualization/lazy loading 등을 선제 적용하지 않는다.

## N5 Cold Load

N5-C에서 Disable cache + Record and reload 조건으로 최초 로딩을 추가 측정했다.

결과:

- 127 static images
- 46.83MB
- 300 textarea
- cold load mount→paint 약 65.8ms

Network에서 perf-assets 필터 결과:

- 129 requests
- 약 49,181kB transferred
- 약 49,146kB resources

129개의 구성은:

- 실제 이미지 127개
- perf asset manifest 요청 2개

로 확인됐다.

실제 이미지가 2번씩 다운로드되는 중복 요청은 없었다. Service Worker/MSW가 요청 initiator로 표시되지만, 실제 이미지 전송량은 준비된 46.83MB 자산과 일치하는 수준이었다.

따라서 기존 Performance 화면에서 보였던 약 99~103MB 전체 resource 값은 127개 이미지가 실제로 두 번 다운로드된 증거가 아니라고 기록한다.

## Console 확인

측정 과정에서 반복되었던:

- Next.js HMR WebSocket ERR_CONNECTION_REFUSED
- MSW passthrough Failed to fetch

로그는 dev server 재시작 과정에서 발생한 일시적 개발환경 로그였다.

개발 서버를 정상 재기동하고 Console clear → 일반 reload 후 확인한 결과:

- errors: 0
- warnings: 0
- HMR connected
- MSW Mocking enabled

상태를 확인했다. N3/N5 애플리케이션 기능 오류로 판단하지 않는다.

## 최종 판정

**Day 3 PASS**

N3:

- 150 sections까지 현재 구조 유지 가능
- virtualization 선제 도입 불필요

N5:

- 127 images
- 203,900px
- 46.83MB
- 300 textarea

규모까지 현재 구조로 baseline 동작을 확인했다.

현재 단계에서는 다음 최적화를 하지 않는다.

- virtualization
- lazy loading
- IntersectionObserver
- React.memo
- content-visibility

향후 실제 운영 데이터가 이 baseline을 넘어가거나 측정 가능한 병목이 확인될 때 최적화를 도입한다.

## 검증 환경

- 개발용 harness: `/perf/long-page`
- 실제 perf-assets는 Git에 포함하지 않음
- dev asset route(`/api/dev/perf-assets`, `/api/dev/perf-assets/[...path]`)는 development에서만 동작하며 production에서는 404 처리
- GIF baseline 제외
