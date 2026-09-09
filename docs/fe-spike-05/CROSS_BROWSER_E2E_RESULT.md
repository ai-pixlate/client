# FE Spike ⑤ — 크로스브라우저 기본 플로우 E2E 결과

## 목적

Pixate의 현재 Mock 기본 사용자 흐름이 Chromium / Firefox / WebKit에서
동일하게 동작하는지 Playwright로 검증했다.

검증 대상은 현재 실제 구현 가능한:

N1 → N2 → N3 → N4 → N5

흐름이다.

N5 → N6는 현재 Mock 상태 머신에 구현되지 않았으므로 이번 E2E 실패 조건으로 보지 않았다.

## 환경

Playwright:

- `@playwright/test` 1.62.1

Browser:

- Chromium
- Firefox
- WebKit

Playwright config:

- testDir: `./e2e`
- retries: 0
- reporter: list
- screenshot: only-on-failure
- trace: on-first-retry
- video: off
- baseURL: `http://localhost:3000`
- webServer: `npm run dev`
- local `reuseExistingServer` 활성화

package.json:

```
"test:e2e": "playwright test"
```

## Smoke

기본 Playwright/dev server 연결 검증:

| Browser | Result |
|---|---|
| Chromium | PASS |
| Firefox | PASS |
| WebKit | PASS |

## Basic Flow

테스트 파일:

`e2e/basic-flow.spec.ts`

테스트 이름:

`N1에서 N5 검수 화면까지 기본 작업 흐름을 완료한다`

### N1

사용 brandId:

`brand_mock_001`

`lib/mock-api/fixtures.ts`의 `MOCK_BRAND_ID` 정의값을 사용했다. 추측한 ID를 하드코딩하지 않았다.

필수 select:

국가 → 언어 → 규제 분류 → 카테고리 순서로 입력.

현재 label 연결 구조상 `getByRole('combobox').nth(0~3)`을 사용했다. 각 select의 option 값 자체는 첫 번째 유효 non-empty option을 helper로 선택하여 하드코딩하지 않았다.

이미지 업로드:

`getByLabel('이미지 추가')`에 메모리 Buffer로 생성한 1×1 PNG(`e2e-test.png`)를 `setInputFiles`로 입력. repository에 binary fixture를 추가하지 않았다.

submit:

`다음 →` 클릭 후 `/jobs/job_mock_001` 형태로 이동 확인.

### N2

확인:

progressbar 표시.

Mock polling 간격은 production 값을 그대로 사용했다. 고정 `waitForTimeout`을 사용하지 않고 N3 고유 UI인 `번역 시작 →` 버튼이 나타날 때까지 timeout 기반으로 대기했다.

N2 → N3 자동 전환 확인.

### N3

fixture section: 5개

확인:

- article 5개
- 초기 자동 제외 section 존재
- 초기 되살리기 버튼 1개

interaction:

포함 section 하나에서 `제외` → `제외됨`/`되살리기` 확인 → `되살리기` → 원래 포함 상태 복원. section article 내부 locator로 범위를 제한했다.

그 후 `번역 시작 →` 클릭하여 N4 진입.

### N4

확인:

- progressbar
- "번역을 진행하고 있습니다" heading

N4 polling도 production 간격 유지. 고정 sleep 없이 N5의 `원문` 버튼이 나타날 때까지 기다려 N4 → N5 자동 전환을 확인했다.

### N5

확인:

- 원문 버튼
- 번역문 버튼
- textbox 6개
- 원문/번역문 toggle 정상 동작
- 저장 및 완료 버튼 존재

현재 `저장 및 완료 →` 버튼은 disabled 상태이며 `N6 저장 화면은 아직 구현되지 않았습니다.` title도 확인했다. 이를 현재 Mock flow의 정상 종료 조건으로 사용했다.

### N6

이번 E2E에서는 도달하지 않는다.

이유: 현재 N5 → N6 상태 전환이 Mock 상태 머신에 구현되지 않음.

N6 컴포넌트 존재 자체와 실제 N1→N5 browser flow 검증을 혼동하지 않았다. 테스트를 통과시키기 위해 N5→N6 mock 상태를 임의로 추가하지 않았다.

## 브라우저별 결과

Basic flow 결과:

| Browser | Result | Test time |
|---|---|---|
| Chromium | PASS | 약 5.9~6.0초 |
| Firefox | PASS | 약 6.3초 |
| WebKit | PASS | 약 6.0~6.2초 |

Firefox:

- selectOption 정상
- setInputFiles 정상
- N2/N4 polling 정상
- N3 interaction 정상
- N5 toggle 정상
- browser 특이점 없음

WebKit:

- 동일 flow PASS
- browser 특이점 없음

`selectOption`/`setInputFiles`는 Playwright API를 통해 DOM 값을 설정하므로 OS native select/file picker UI 자체의 시각적 차이는 이번 테스트 범위가 아니다.

## 전체 E2E

테스트 파일:

- `e2e/smoke.spec.ts`
- `e2e/basic-flow.spec.ts`

browser projects:

- chromium
- firefox
- webkit

총 6 tests

결과: PASS 6 / FAIL 0

3개 browser 병렬 실행에서도 충돌 없음.

## Selector 정책

우선순위:

1. getByRole
2. getByLabel
3. semantic text
4. 필요한 경우 제한적인 locator

이번 E2E를 위해 production 코드에 `data-testid`를 추가하지 않았다.

N1 select는 현재 label 연결이 부족하여 combobox nth selector를 사용했다. 향후 UI 접근성 개선으로 label이 연결되면 `getByLabel` 기반으로 개선할 수 있다.

## 테스트 안정성

다음은 사용하지 않았다.

- waitForTimeout 기반 단계 전환
- production polling 간격 변경
- browser별 production 조건문
- test.skip
- N5→N6 강제 상태 변경
- binary fixture commit

동적 Mock 전환은 Playwright expect timeout으로 실제 UI 출현을 기다렸다.

## production 영향

이번 Day 5 작업에서 production N1~N6 코드 수정 없음.

추가/변경 범위:

- Playwright dev dependency
- Playwright config
- E2E test
- Playwright 산출물 ignore
- 결과 문서

로 한정됨.

## 최종 판정

**Day 5 PASS**

현재 구현 가능한 N1 → N2 → N3 → N4 → N5 기본 흐름이 Chromium / Firefox / WebKit 모두 동일 E2E 시나리오에서 PASS했다.

현재 발견된 browser-specific blocker 없음.

N6는 미구현 상태이므로 향후 N5→N6 flow가 실제 구현된 뒤 동일 E2E에 추가한다.
