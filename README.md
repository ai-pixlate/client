# Pix/ate — Frontend

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

현재 이 스파이크 단계에서는 필요한 환경 변수가 없습니다 (API·외부 서비스 미연동, 모두 mock).
실제 API가 붙으면 `.env.example`에 필요한 키를 추가하고 여기 표로 정리합니다.
Secret은 절대 Git에 커밋하지 않습니다 (`.env`, `.env.local`은 `.gitignore` 처리됨).

## 명령어

| 명령어 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 |
| `npm run lint` | 코드 검사 |
| `npm run typecheck` | 타입 검사 (`tsc --noEmit`) |
| `npm run verify:coords` | **좌표 변환 자동 검증** (브라우저 불필요) |
| `npm run make:ruler` | 스파이크용 눈금 테스트 이미지 재생성 |

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
