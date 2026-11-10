# pix/ate — Frontend

AI 상세페이지 로컬라이제이션 서비스의 프론트엔드입니다.

- **MVP 마일스톤** 2026-09-30 (중간발표)
- **최종 마일스톤** 2026-12-11 (최종발표)
- **기준 문서** [docs/reference/requirements.xlsx](docs/reference/requirements.xlsx) — 버전은 계속 바뀌므로 여기서 고정하지 않습니다. 현재 버전은 requirements.xlsx 내부 문서정보(00_문서정보 시트)를 기준으로 확인합니다.

## Requirements

| 항목 | 값 |
|---|---|
| Node | 20.9 이상 (Next.js 16 요구사항, `package.json`의 `engines` 참고) |
| 패키지 매니저 | npm — `package-lock.json` 하나만 사용합니다. 다른 lock file을 추가하지 마세요. |

## 기술 스택

| 영역 | 선택 |
|---|---|
| 프레임워크 | Next.js 16 (App Router) |
| 언어 | TypeScript (strict) |
| 스타일 | Tailwind CSS v4 — **스타일 시스템은 이것 하나만 사용** |
| 서버 데이터 | TanStack Query |
| 클라이언트 상태 | 기본은 `useState` / `useReducer`. 복잡한 에디터 상태만 Zustand |
| 폼 | React Hook Form + Zod |

같은 역할의 라이브러리를 중복해서 설치하지 않습니다.

## 시작하기

```bash
npm install
npm run dev
```

http://localhost:3000 에서 확인합니다.

## 환경 변수

```bash
cp .env.example .env.local
```

후 필요에 따라 값을 조정합니다.

| 변수 | 값 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_API_MOCKING` | `enabled` / 미설정(또는 그 외 값) | `enabled`면 MSW(Mock Service Worker)를 사용합니다. 미설정 또는 그 외 값이면 실제 backend를 사용합니다(`NODE_ENV`와는 무관합니다). |
| `NEXT_PUBLIC_DEV_SELLER_EMAIL` | 이메일 문자열 | 실백엔드 개발 세션 로그인용 이메일입니다. 미설정 시 코드 기본값을 사용합니다. |

인증 모드(`lib/auth/capability.ts`): Mock에서는 소셜 로그인(G1 → `/login/callback/{provider}` → M1)과 세션 복구(401 → refresh → `/auth/me` → 원 요청 1회 재시도)를 MSW로 확인할 수 있습니다. 실백엔드에서는 소셜 OAuth 서버가 아직 없어 소셜 버튼이 요청을 보내지 않고, 위 개발용 간이 로그인을 계속 씁니다. 어느 쪽이든 access token은 메모리에만 두고 브라우저 저장소에 쓰지 않습니다. Mock 인증 시험 시나리오는 `lib/mock-api/auth-fixtures.ts`의 `pixlate:mock-auth-scenario`(sessionStorage) 설명을 참고합니다.

Mock(`NEXT_PUBLIC_API_MOCKING=enabled`)에서만 동작하는 확인용 주소입니다. Mock이 꺼져 있으면 무시됩니다.

| 주소 | 용도 |
| --- | --- |
| `/jobs/1?qaTypeset=1` | N5 Mock 조판 미리보기. 렌더 이미지 대신 글자 없는 면 위에 조판 규칙으로 번역문을 그려 줄바꿈·Auto Height·글자 크기를 눈으로 확인합니다. |
| `/jobs/1?scenario=n2-error` · `/jobs/1?scenario=n4-error` | N2·N4 전체 오류 화면 고정 |

Secret(JWT, access token, password 등)은 절대 Git에 커밋하지 않습니다 (`.env`, `.env.local`은 `.gitignore` 처리됨).

## 명령어

| 명령어 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 |
| `npm run lint` | 코드 검사 |
| `npm run typecheck` | 타입 검사 (`tsc --noEmit`) |
| `npm run verify:coords` | **좌표 변환 자동 검증** (브라우저 불필요) |
| `npm run verify:n5-adapter` | N5 Adapter(OpenAPI DTO → ViewModel) 자동 검증 (브라우저 불필요) |
| `npm run verify:n5-preview-state` | N5 `/preview` 입력 상태·렌더 상태(시도·결과·최신)·지문 A/B·표시 규칙·서버 style 8키 변환 자동 검증 (브라우저 불필요) |
| `npm run verify:n5-layout-adjust` | N5 블록 배치 저장(layoutAdjust — 계약 확정·서버 구현 대기) 요청 조립(바꾼 필드만·소수 유지·빈 객체 금지)·서버값 읽기(키 없음 ≠ null)·편집 기준·렌더 대상·쓰기 허용(Mock 만)·Mock 서버 정규화 자동 검증 (브라우저 불필요) |
| `npx playwright test e2e/n5-layout-adjust.spec.ts --project=chromium` | N5 배치 저장 흐름(손 놓을 때·[+][−] 1회 저장, revision·409·500, rerenderTaskId, Undo/Redo 재저장, 혼합 이력, 초안 보호, 실서버 쓰기 차단, Mock 계약) 검증 — MSW Mock 기준이며 실서버 검증이 아니다 (Chromium, dev 서버 필요) |
| `npm run verify:n5-layout-edit` | N5 배치 영역 편집 순수 계산(이동·크기 조절·[+][-]·가운데선 snap, 섹션 경계) 자동 검증 (브라우저 불필요) |
| `npm run verify:n5-history` | N5 실행 취소·다시 실행 이력 엔진(저장 성공 뒤 commit, 실패 시 불변) 자동 검증 (브라우저 불필요) |
| `npm run verify:n5-failed-drafts` | N5 번역문 미저장 초안(편집·저장 성공/실패 전이, 실패 칸 집계) 자동 검증 (브라우저 불필요) |
| `npm run verify:n5-review-issues` | N5 저장 전 확인 항목 집계(F-CFM-09)·겹침 진단 계산 자동 검증 (브라우저 불필요) |
| `npm run verify:n5-typeset` | N5 HTML/CSS 조판 확정 규칙(역할별 기준 style·원본 폭 배율·사용자 글자 배율·박스 선택·ink overflow 경계와 방향·최종 이미지 경계 이탈 감지·CSS 계약) 순수 함수 자동 검증 (브라우저 불필요) |
| `npm run verify:n5-final-output` | 조판 최종 출력 좌표(include 섹션만 `sectionOrder` 순서로 누적)·최종 이미지 경계 평가·블록 넘침과의 분리·렌더 모델 변환 순수 함수 자동 검증 (브라우저 불필요) |
| `npx playwright test e2e/n5-typeset-measurement.spec.ts --project=chromium` | N5 조판 브라우저 측정 엔진(`lib/n5/typeset-measurement.ts`) 검증 — dev 전용 harness `/spike/typeset-measure`에서 실제 줄바꿈·DOM baseline·Canvas ink·Pretendard 로딩을 확인하고 픽셀·clean 문서와 대조 (Chromium, dev 서버·Pretendard CDN 필요) |
| `npx playwright test e2e/n5-typeset-qa-harness.spec.ts --project=chromium` | 조판 QA 화면(`/spike/typeset-measure`, dev 전용) 검증 — `TypesetBlock` 표시와 측정의 일치, 섹션 제외에 따른 `finalOutputOffset` 변화, 블록 넘침·이미지 이탈, 폰트 미준비·글리프 대체 실패 (Chromium, dev 서버 필요) |
| `npx playwright test e2e/s0-rail.spec.ts --project=chromium` | S0 전역 프로세스 바(N1~N6) 검증 — 위치, 단계 상태, 단계 이동 안내 툴팁, ✕ 나가기·작업 취소 확인창과 실패 처리 (Chromium, dev 서버 필요) |
| `npx playwright test e2e/processing-error.spec.ts --project=chromium` | N2·N4 전체 실패 화면 검증 — 표시 조건, 부분 실패 구분, 진행률 정지, 미연결 [다시 시도]·[중단], S0 취소 (Chromium, dev 서버 필요) |
| `npm run verify:library-adapter` | M1 보관함 Adapter(LibraryCard → 카드 ViewModel) 자동 검증 (브라우저 불필요) |
| `npm run verify:library-view` | M1 보관함 화면 로직(검색·국가 필터·최신순·선택·날짜 포맷) 자동 검증 (브라우저 불필요) |
| `npm run verify:m2-form` | M2 브랜드 정보 화면 로직(dirty 판정·필수값·변경 항목 열거·로고 파일 형식)과 Brand API Adapter(DTO→ViewModel·바뀐 항목만 PATCH·로고 추가/삭제 계획·저장 뒤 정합·brandId 결정) 자동 검증 (브라우저 불필요) |
| `npx playwright test e2e/m2-brand.spec.ts --project=chromium` | M2 브랜드 정보 화면(`/brand`) 화면·view/edit·dirty·이탈 확인 검증 (MSW Mock, Chromium, dev 서버 필요) |
| `npx playwright test e2e/m2-brand-api.spec.ts --project=chromium` | M2 Brand API 연결(조회·바뀐 항목만 PATCH·로고 POST/DELETE·저장 실패 시 입력 유지·중복 저장 방지·404/없음/여러 브랜드) 검증 — MSW Mock이 실제 계약 모양으로 응답하며 실서버 검증이 아니다 (Chromium, dev 서버 필요) |
| `npm run verify:msw-flag` | `isApiMockingEnabled()`(MSW on/off SSOT)가 `NEXT_PUBLIC_API_MOCKING` 값 조합에서 `NODE_ENV`와 무관하게 정확히 동작하는지 자동 검증 (브라우저 불필요) |
| `npm run verify:displayed-progress` | N2·N4 처리 화면 표시 %(관측 단계는 상한만 염·점프·감소 없음·처리 중 100 없음·실패 시 멈춤·완료 응답 뒤 100 표시) 순수 계산 자동 검증 (브라우저 불필요) |
| `npm run verify:n1-category` | N1 카테고리 트리(GET /master/categories → 트리, 하위 없는 항목만 leaf)와 [다음] 진행 조건 순수 함수 자동 검증 (브라우저 불필요) |
| `npm run verify:login-form` | G1 로그인 보조 문구 GIF 대비 판별(주황 판별·글자 전환 기준·cover 좌표), 개발용 자동 로그인 제외 경로 순수 함수 자동 검증 (브라우저 불필요) |
| `npm run verify:auth-session` | 인증 세션 FE 로직 자동 검증 — refresh single-flight·`/auth/me` 계정 확인·`refresh_rotated` 복구 상한·503과 세션 종료 구분·탭 사이 알림(토큰 미포함)·소셜 시작/콜백 중복 방어·로그아웃 전용 처리와 logout pending (브라우저 불필요) |
| `npx playwright test e2e/g1-login.spec.ts --project=chromium` | G1 로그인 화면(`/login`) 검증 — Figma 835:6511 위치, GIF 로드, 동의 고지, 키보드, 화면 진입 시 인증 요청 0건 (Chromium, dev 서버 필요) |
| `npx playwright test e2e/g1-social-auth.spec.ts --project=chromium` | Mock 소셜 로그인·세션 흐름 검증 — start→콜백→M1, 콜백 완료 1회(Strict Mode·새로고침), 시작/완료 오류, 401→refresh→`/auth/me`, 여러 탭 logout·계정 전환 (Chromium, Mock dev 서버 필요) |
| `E2E_REAL_BACKEND_MODE=1 npx playwright test e2e/g1-login-backend-mode.spec.ts --project=chromium` | Mock을 끈 dev 서버(`NEXT_PUBLIC_API_MOCKING=disabled npm run dev`)에서 `/login`은 인증 요청 0건, 다른 화면은 개발용 자동 로그인 유지·access 메모리 보관(브라우저 저장소 미사용)인지 검증 |
| `npm run generate:openapi-types` | 최신 OpenAPI 계약(`ai-pixlate.github.io/server/openapi.yaml`)에서 타입 재생성 → `lib/api/generated/openapi.d.ts` (직접 수정 금지, 재실행으로만 갱신) |
| `npm run make:ruler` | 스파이크용 눈금 테스트 이미지 재생성 |
| `npm run make:n5-section-fixtures` | N5 실제 계약(v3.4.2, 섹션별 원문/렌더 이미지) mock fixture 이미지 재생성 |

---

# FE Spike ① — 긴 원본 뷰어

세로 10,000px 원본을 브라우저에서 스크롤·확대하며 크롭할 수 있는지 검증하는 화면입니다.
**프로덕션 UI가 아닙니다.** 디자인은 회색 박스 수준이며 기능 검증이 목적입니다.

관련 요구사항: `F-CRP-01a` (P0 · must · MVP)

## 실행 방법

```bash
npm install          # 최초 1회
npm run dev
```

브라우저에서 아래 주소를 엽니다.

```
http://localhost:3000/spike/crop-viewer
```

## 사용법

| 조작 | 결과 |
|---|---|
| 이미지 위에서 **드래그** | 크롭 영역 생성 |
| 크롭 영역 **클릭** | 선택 (파란 테두리) |
| 우측 목록의 **[삭제]** | 크롭 삭제 |
| 상단 **[확대 +] [축소 −] [100%]** | 줌 변경 — 저장된 좌표는 변하지 않습니다 |
| 상단 **[브라우저 자체 검증 실행]** | 줌·스크롤을 자동으로 돌며 DOM 실측값과 계산값을 비교 |
| 상단 **[저장 후 비우기] → [복원]** | source 좌표만으로 같은 위치에 다시 그려지는지 확인 |
| 상단 **[zoom=0 (에러)]** | 잘못된 배율에서 차단되는지 확인 |

상단 회색 띠(HUD)에 `previewScale` · `zoomScale` · `displayScale` ·
마우스의 화면 좌표와 변환된 원본 좌표 · 왕복 오차가 실시간으로 표시됩니다.

## 테스트 이미지 변경 방법

상단 드롭다운에서 고릅니다.

| fixture | 검증 목적 |
|---|---|
| 7,000px · previewScale 1 | 기본 동작 |
| 10,000px · previewScale 1 | F-CRP-01a 수용기준 ① |
| 14,000px 원본 · previewScale 0.5 | **다운스케일 프리뷰 좌표 검증** |
| `[에러]` 로 시작하는 4개 | 로딩 실패 / previewScale 0 / previewScale 누락 / 크기 미수신 |

**새 이미지를 추가하려면** `lib/spike/fixtures.ts`의 배열에 항목을 추가합니다.

```ts
{
  sourceImageId: 'my-test',
  label: '내 테스트 이미지',
  previewUrl: '/spike/my-image.png',   // public/spike/ 아래에 파일을 둡니다
  originalWidth: 1200,                  // 원본 크기 (프리뷰 크기가 아님)
  originalHeight: 9000,
  previewScale: 0.5,                    // 프리뷰 폭 / 원본 폭
}
```

눈금 이미지를 다시 만들려면 `npm run make:ruler` 를 실행합니다.
크기를 바꾸려면 `scripts/make-ruler.mjs` 하단의 `targets` 배열을 수정합니다.

## 파일 구조

```
lib/spike/
  coordinates.ts    좌표 타입·변환·크롭 확정. React·브라우저 API 없음
  constants.ts      줌 범위, 모듈 규격, 경고 기준 등 바뀔 수 있는 값
  fixtures.ts       테스트 데이터. ★실제 API 교체 지점
app/spike/crop-viewer/
  page.tsx          검증 화면 (state 전부 이 파일의 useState)
scripts/
  verify-coordinates.mjs   좌표 자동 검증 87건
  make-ruler.mjs           눈금 이미지 생성 (외부 라이브러리 미사용)
public/spike/       생성된 눈금 이미지
docs/fe-spike-01/   결과 보고서·좌표 규약·에러 매트릭스·ERD 선행 확인
docs/reference/     PM 원본 문서 로컬 사본 보관 위치. requirements.xlsx만 Git에서 추적하고, 그 외 파일은 .gitignore 처리됨
```

## 문서

| 문서 | 내용 |
|---|---|
| [FE_SPIKE_01_RESULT.md](docs/fe-spike-01/FE_SPIKE_01_RESULT.md) | 검증 결과와 다음 단계 판단 |
| [COORDINATE_CONVENTION_DRAFT.md](docs/fe-spike-01/COORDINATE_CONVENTION_DRAFT.md) | source / piece / module 좌표계 규약 |
| [SCREEN_INPUT_ERROR_MATRIX.md](docs/fe-spike-01/SCREEN_INPUT_ERROR_MATRIX.md) | MVP 11개 화면의 입력값·에러 정리 |
| [ERD_FE_PRECHECK.md](docs/fe-spike-01/ERD_FE_PRECHECK.md) | ERD 확정 전 백엔드 확인 사항 |
