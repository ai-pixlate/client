/**
 * Pixate N1~N6 Mock fixture 데이터
 *
 * - job_mock_001 하나를 기준으로 N2~N6 전 화면을 재사용합니다.
 * - detail 이미지 2장만 사용합니다. thumbnail fixture는 파이프라인 미확정으로 제외합니다.
 * - 이미지 URL은 실제 파일 없이 placeholder 경로를 사용합니다.
 *   실제 파일을 public/mock/에 넣으면 곧바로 연결됩니다.
 * - 이 파일은 MSW handler에서 import해서 사용합니다.
 */

import type {
  SectionsResponse,
  Section,
  JobResultResponse,
} from '@/lib/api/types';

// ─────────────────────────────────────────────
// 공통 ID 상수
// ─────────────────────────────────────────────

export const MOCK_JOB_ID = 'job_mock_001';
export const MOCK_BRAND_ID = 'brand_mock_001';

// SRC_A/SRC_B는 N3 mockSectionsResponse/mockN3VerdictContractSections 등이
// sourceImageId로 계속 쓴다 — image_key/render_image_key 상수(구 N5 /review
// 전용, SRC_A_IMAGE_KEY 등)는 5단계에서 그 사용처(mockReviewResponse)와 함께
// 제거했다.
const SRC_A = 'src_mock_001'; // 상세페이지 A
const SRC_B = 'src_mock_002'; // 상세페이지 B

/**
 * N3 section 이미지(Section.thumbnailUrl/imageKey/renderImageKey) 실측 크기
 * fixture (실데이터 방어 검증, 10일차). scripts/make-n3-fixture-images.mjs로
 * 생성한 실제 PNG 파일이며(npm run make:n3-fixtures), 숫자만 선언해 둔 게
 * 아니라 브라우저가 실제로 로드했을 때 naturalWidth/naturalHeight가 그대로
 * 이 값이 된다. 이미지 내용은 색상 채움뿐이라 실서비스 asset이 아니다.
 *
 * 212x8000(SECTION_IMG_EXTREME_TALL)은 긴 상세페이지 극단값 — 성능 방어
 * 검증(스크롤/zoom/pan, 브라우저 멈춤 여부) 전용이다. sec_03(유일한 exclude
 * bucket section, DetailPanel에 크게 표시됨)에 배정해 실제로 로드되게 한다.
 */
const SECTION_IMG_1000x1360 = '/mock/n3/section-1000x1360.png';
const SECTION_IMG_EXTREME_TALL = '/mock/n3/section-212x8000.png';
const SECTION_IMG_830x3225 = '/mock/n3/section-830x3225.png';
const SECTION_IMG_800x220 = '/mock/n3/section-800x220.png';

// N2 — 분석 중 상태(구 GET /api/jobs/:jobId/status 전용 mockN2ProcessingStatus/
// mockN2VerdictStatus)는 오늘(N1→N6 happy path) 작업에서 실제 계약인 GET
// /jobs/:jobId/tasks(JobTaskStatus) 기반 진행으로 교체하며 제거했다 —
// lib/msw/handlers.ts의 advanceJobProcessing()이 고정 fixture 대신 poll count로
// 그 자리를 대신한다.

// ─────────────────────────────────────────────
// N3 — 섹션 목록
// ─────────────────────────────────────────────

/**
 * N3 섹션 목록 fixture.
 *
 * 테스트 케이스:
 * - sec_01: 정상 include 섹션 (verdicts 없음)
 * - sec_02: regulated 판정 섹션 (verdicts 있음, bucket은 include 유지 — 정본은 section.bucket)
 * - sec_03: 현지 무의미 자동 exclude 섹션 (카카오톡 상담 안내)
 * - sec_04: 정상 include 섹션 (두 번째 소스 이미지)
 * - sec_05: regulated 판정 섹션 (두 번째 소스 이미지, sensitive claim)
 *
 * N3 verdictType 계약 케이스(9월 표시 5종)는 mockN3VerdictContractSections 참고
 * (이 목록에 섞으면 e2e/basic-flow.spec.ts의 include/exclude count 단언이 깨진다).
 */
export const mockSectionsResponse: SectionsResponse = {
  sections: [
    {
      sectionId: 'sec_01',
      sourceImageId: SRC_A,
      /**
       * TODO: sectionOrder 기준을 백엔드와 협의 필요.
       * 현재는 job 전체 기준 1~N으로 임시 사용.
       */
      sectionOrder: 1,
      thumbnailUrl: SECTION_IMG_1000x1360,
      imageKey: SECTION_IMG_1000x1360,
      renderImageKey: SECTION_IMG_1000x1360,
      bucket: 'include',
      exclusionReason: null,
      excludedStage: null,
      bbox: { x: 0, y: 0, width: 1000, height: 600 },
      verdicts: [],
      warningBadge: null,
      originalVerdict: null,
    },
    {
      sectionId: 'sec_02',
      sourceImageId: SRC_A,
      sectionOrder: 2,
      thumbnailUrl: SECTION_IMG_830x3225,
      imageKey: SECTION_IMG_830x3225,
      renderImageKey: SECTION_IMG_830x3225,
      bucket: 'include',
      exclusionReason: null,
      excludedStage: null,
      bbox: { x: 0, y: 600, width: 1000, height: 500 },
      verdicts: [
        {
          verdictId: 'vrd_01',
          verdictType: 'regulatory',
          verdictStatus: 'regulated',
          problemText: '최고의 수분 공급 효과',
          basis: '최상급 표현은 FTC 규정상 객관적 근거 없이 사용 불가',
          alternativeExpression: null,
          evidenceUrl: '/mock/evidence/ftc-superlative-claims.pdf',
        },
      ],
      // 처리 자체는 정상 완료됐지만 판정 검토 품질 경고가 있는 케이스 (데모용)
      warningBadge: 'quality_warning',
      originalVerdict: null,
    },
    {
      sectionId: 'sec_03',
      sourceImageId: SRC_A,
      sectionOrder: 3,
      // 유일한 exclude bucket section — DetailPanel(N3 가운데 상세 보기)에
      // 크게 표시되므로, 212x8000 극단값 실측 검증을 여기 배정한다.
      thumbnailUrl: SECTION_IMG_EXTREME_TALL,
      imageKey: SECTION_IMG_EXTREME_TALL,
      renderImageKey: SECTION_IMG_EXTREME_TALL,
      bucket: 'exclude',
      // 카카오톡 상담 안내 — 미국(도착 시장)에서 의미 없는 채널이라 자동 제외.
      // 표시 문구는 코드값 그대로 노출하지 않고 EXCLUSION_REASON_LABELS를 거친다.
      exclusionReason: 'auto_local_irrelevant',
      // N3에서 자동 제외된 섹션. N5 화면에 표시되지 않음.
      excludedStage: 'N3',
      bbox: { x: 0, y: 1100, width: 1000, height: 200 },
      verdicts: [],
      warningBadge: null,
      originalVerdict: null,
    },
    {
      sectionId: 'sec_04',
      sourceImageId: SRC_B,
      sectionOrder: 4,
      thumbnailUrl: SECTION_IMG_800x220,
      imageKey: SECTION_IMG_800x220,
      renderImageKey: SECTION_IMG_800x220,
      bucket: 'include',
      exclusionReason: null,
      excludedStage: null,
      bbox: { x: 0, y: 0, width: 1000, height: 700 },
      verdicts: [],
      // 처리 파이프라인 부분 실패 데모 (N4 partial failure, blk_04와 같은 맥락)
      warningBadge: 'processing_failed',
      originalVerdict: null,
    },
    {
      sectionId: 'sec_05',
      sourceImageId: SRC_B,
      sectionOrder: 5,
      // 4장만 생성했으므로(요구사항) 하나는 재사용한다 — 내용은 무관하다.
      thumbnailUrl: SECTION_IMG_1000x1360,
      imageKey: SECTION_IMG_1000x1360,
      renderImageKey: SECTION_IMG_1000x1360,
      bucket: 'include',
      exclusionReason: null,
      excludedStage: null,
      bbox: { x: 0, y: 700, width: 1000, height: 400 },
      verdicts: [
        {
          verdictId: 'vrd_02',
          verdictType: 'regulatory',
          verdictStatus: 'regulated',
          problemText: '민감성 피부에 적합',
          basis: '미국 시장에서 "sensitive" 표기 시 피부과 테스트 결과 근거 권장',
          alternativeExpression: null,
          evidenceUrl: null,
        },
      ],
      warningBadge: null,
      originalVerdict: null,
    },
  ],
};

/**
 * N3 verdictType 계약 검증용 Mock (v3.4.1, 9월 표시 5종).
 *
 * 기본 흐름(mockSectionsResponse)과 분리한 이유: 여기 섹션들을 그 목록에
 * 섞으면 e2e/basic-flow.spec.ts의 n3-thumb-include-/n3-thumb-exclude- count
 * 단언이 깨진다. scripts/verify-n3-verdict-contract.mjs 전용으로 쓴다.
 *
 * bucket은 verdictType으로부터 계산한 값이 아니라 계약서에 명시된 "정본" 값을
 * 그대로 하드코딩한다 — section.bucket이 UI 상태의 유일한 정본이라는 규칙을
 * fixture 레벨에서도 지킨다.
 *
 * channel_policy는 VerdictType에는 존재하지만 12월 전용이므로 이 목록에는
 * 판정 행을 만들지 않는다.
 *
 * - regulatory / exclude (대체 표현 없음 — 기본 exclude)
 * - regulatory_replaceable / include — verdictStatus는 'regulated'로 위 regulatory
 *   케이스와 같다. 대체 표현이 있어 verdictType만 갈리는 v3.4.1 핵심 케이스라,
 *   status 하나만 보고 type을 계산할 수 없다는 것을 이 fixture가 직접 증명한다.
 *   대체 표현이 있으므로 기본 bucket은 include다.
 * - regulatory_conditional / include (조건부 규제는 항상 include 쪽)
 * - local_irrelevant / exclude
 * - needs_fix / include
 */
export const mockN3VerdictContractSections: Section[] = [
  {
    sectionId: 'vc_sec_regulatory',
    sourceImageId: SRC_A,
    sectionOrder: 101,
    thumbnailUrl: '/mock/section-thumb-01.jpg',
    imageKey: '/mock/vc-regulatory-original.jpg',
    renderImageKey: '/mock/vc-regulatory-render.jpg',
    bucket: 'exclude',
    exclusionReason: 'auto_regulatory',
    excludedStage: 'N3',
    bbox: { x: 0, y: 0, width: 1000, height: 300 },
    verdicts: [
      {
        verdictId: 'vc_vrd_regulatory',
        verdictType: 'regulatory',
        verdictStatus: 'regulated',
        problemText: '효능 과장 표현',
        basis: '객관적 근거 없이 최상급 표현 사용, 대체 표현 없음 — 규제 위반',
        alternativeExpression: null,
        evidenceUrl: '/mock/evidence/ftc-superlative-claims.pdf',
      },
    ],
    warningBadge: null,
    originalVerdict: null,
  },
  {
    sectionId: 'vc_sec_regulatory_replaceable',
    sourceImageId: SRC_A,
    sectionOrder: 102,
    thumbnailUrl: '/mock/section-thumb-02.jpg',
    imageKey: '/mock/vc-regulatory-replaceable-original.jpg',
    renderImageKey: '/mock/vc-regulatory-replaceable-render.jpg',
    bucket: 'include',
    exclusionReason: null,
    excludedStage: null,
    bbox: { x: 0, y: 300, width: 1000, height: 300 },
    verdicts: [
      {
        verdictId: 'vc_vrd_regulatory_replaceable',
        verdictType: 'regulatory_replaceable',
        verdictStatus: 'regulated',
        problemText: '임상적으로 입증됨',
        basis: '근거 없는 표현이나 "임상 테스트 결과 보고됨" 등 대체 표현으로 교체 가능 — 규제 표현',
        // 대체 표현이 있어 verdictType이 갈리는 v3.4.1 핵심 케이스 — basis에
        // 언급된 대체 문구를 구조화된 필드로도 내려준다.
        alternativeExpression: '임상 테스트 결과 보고됨',
        evidenceUrl: null,
      },
    ],
    warningBadge: null,
    originalVerdict: null,
  },
  {
    sectionId: 'vc_sec_regulatory_conditional',
    sourceImageId: SRC_A,
    sectionOrder: 103,
    thumbnailUrl: '/mock/section-thumb-03.jpg',
    imageKey: '/mock/vc-regulatory-conditional-original.jpg',
    renderImageKey: '/mock/vc-regulatory-conditional-render.jpg',
    bucket: 'include',
    exclusionReason: null,
    excludedStage: null,
    bbox: { x: 0, y: 600, width: 1000, height: 300 },
    verdicts: [
      {
        verdictId: 'vc_vrd_regulatory_conditional',
        verdictType: 'regulatory_conditional',
        verdictStatus: 'conditional',
        problemText: '조건부 사용 가능 표현',
        basis: '면책 문구 병기 시 사용 가능 — 조건부 규제',
        alternativeExpression: null,
        evidenceUrl: null,
      },
    ],
    warningBadge: null,
    originalVerdict: null,
  },
  {
    sectionId: 'vc_sec_local_irrelevant',
    sourceImageId: SRC_B,
    sectionOrder: 104,
    thumbnailUrl: '/mock/section-thumb-04.jpg',
    imageKey: '/mock/vc-local-irrelevant-original.jpg',
    renderImageKey: '/mock/vc-local-irrelevant-render.jpg',
    bucket: 'exclude',
    exclusionReason: 'auto_local_irrelevant',
    excludedStage: 'N3',
    bbox: { x: 0, y: 0, width: 1000, height: 300 },
    verdicts: [
      {
        verdictId: 'vc_vrd_local_irrelevant',
        verdictType: 'local_irrelevant',
        verdictStatus: 'irrelevant',
        problemText: '카카오톡 상담 안내',
        basis: '도착 시장에서 의미 없는 채널 — 현지 무의미',
        alternativeExpression: null,
        evidenceUrl: null,
      },
    ],
    warningBadge: null,
    originalVerdict: null,
  },
  {
    sectionId: 'vc_sec_needs_fix',
    sourceImageId: SRC_B,
    sectionOrder: 105,
    thumbnailUrl: '/mock/section-thumb-05.jpg',
    imageKey: '/mock/vc-needs-fix-original.jpg',
    renderImageKey: '/mock/vc-needs-fix-render.jpg',
    bucket: 'include',
    exclusionReason: null,
    excludedStage: null,
    bbox: { x: 0, y: 300, width: 1000, height: 300 },
    verdicts: [
      {
        verdictId: 'vc_vrd_needs_fix',
        verdictType: 'needs_fix',
        verdictStatus: 'needs_fix',
        problemText: '단위 표기 미변환 (g -> oz)',
        basis: '현지 기준 단위로 수정 필요',
        alternativeExpression: null,
        evidenceUrl: null,
      },
    ],
    warningBadge: null,
    originalVerdict: null,
  },
];

// N4/N6 — 처리 중 상태(구 mockN4ProcessingStatus/mockN4RenderingStatus/
// mockN6RenderingStatus/mockN4PartialFailureStatus)도 위 N2 fixture와 같은
// 이유로 오늘 제거했다 — GET /jobs/:jobId/tasks 기반 진행으로 대체됐다.
// 중간 실패/재시도 시나리오(부분 실패 포함)는 오늘 작업 범위가 아니다.

// N5 — 검수(구 /review·/preview, v3.4.1 계약)는 3단계부터 lib/mock-api/n5-fixtures.ts의
// 실제 계약(v3.4.2, GET /jobs/{jobId}/blocks·/preview)으로 대체됐다. 이 fixture
// 블록(mockReviewResponse/mockPreviewResponse, N5 stress job 2종)은 5단계에서
// 사용처가 전무함을 확인하고 제거했다 — SRC_A/SRC_B(sourceImageId 상수)는
// mockSectionsResponse(N3) 등 다른 fixture가 계속 쓰므로 위에 그대로 남아 있다.

// ─────────────────────────────────────────────
// N6 — 최종 결과
// ─────────────────────────────────────────────

/** N6: 렌더링 완료, 전체 검증 통과 */
export const mockJobResultResponse: JobResultResponse = {
  jobId: MOCK_JOB_ID,
  renderStatus: 'done',

  // 화면에 표시할 결과 이미지 (exportArtifacts 다운로드 파일과 별개)
  deliverables: [
    {
      deliverableId: 'dlv_001',
      sourceImageId: SRC_A,
      imageUrl: '/mock/result-a.jpg',
      format: 'JPG',
      colorSpace: 'RGB',
      fileSizeBytes: 1_843_200,
      renderStatus: 'done',
      // 9월 MVP: FORMAT_CHECK + COLOR_SPACE_CHECK만 검증
      validationResult: {
        passed: true,
        items: [
          {
            ruleId: 'FORMAT_CHECK',
            name: '지원 포맷',
            passed: true,
            actualValue: 'JPG',
            violationReason: null,
          },
          {
            ruleId: 'COLOR_SPACE_CHECK',
            name: '색공간',
            passed: true,
            actualValue: 'RGB',
            violationReason: null,
          },
        ],
      },
    },
    {
      deliverableId: 'dlv_002',
      sourceImageId: SRC_B,
      imageUrl: '/mock/result-b.jpg',
      format: 'JPG',
      colorSpace: 'RGB',
      fileSizeBytes: 2_105_344,
      renderStatus: 'done',
      // 색공간 검증 실패 케이스 — 파일 용량은 실측 표시만, 통과/실패 판정 없음
      validationResult: {
        passed: false,
        items: [
          {
            ruleId: 'FORMAT_CHECK',
            name: '지원 포맷',
            passed: true,
            actualValue: 'JPG',
            violationReason: null,
          },
          {
            ruleId: 'COLOR_SPACE_CHECK',
            name: '색공간',
            passed: false,
            actualValue: 'CMYK',
            violationReason: 'CMYK 색공간은 지원하지 않습니다. RGB로 변환하세요.',
          },
        ],
      },
    },
  ],

  // 다운로드 산출물 구성요소.
  // manifest.json: 서버 내부용 — 이 목록에 포함 안 함.
  // export_zip: 구성요소가 아니라 묶음 다운로드 동작 — exportZipUrl 사용.
  // PSD: 12월 예정 — 배열에 넣지 않고 UI에서 비활성으로만 표시.
  exportArtifacts: [
    {
      type: 'images',
      downloadUrl: '/mock/download/images/',
      fileCount: 2,
    },
    {
      type: 'content_csv',
      downloadUrl: '/mock/download/content.csv',
    },
    // html은 9월 should
    {
      type: 'html',
      downloadUrl: '/mock/download/content.html',
    },
  ],

  // 선택 구성요소를 ZIP으로 묶어 받는 URL.
  // TODO: 백엔드 확정 후 필드명·동작 방식 조율 필요.
  exportZipUrl: '/mock/download/export.zip',

  saved: false,
};

/** N6: 렌더링 완료 후 보관함 저장된 상태 */
export const mockJobResultSaved: JobResultResponse = {
  ...mockJobResultResponse,
  saved: true,
};
