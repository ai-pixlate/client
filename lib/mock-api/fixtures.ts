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
  JobStatusResponse,
  SectionsResponse,
  ReviewResponse,
  JobResultResponse,
} from '@/lib/api/types';

// ─────────────────────────────────────────────
// 공통 ID 상수
// ─────────────────────────────────────────────

export const MOCK_JOB_ID = 'job_mock_001';
export const MOCK_BRAND_ID = 'brand_mock_001';

const SRC_A = 'src_mock_001'; // 상세페이지 A
const SRC_B = 'src_mock_002'; // 상세페이지 B

// ─────────────────────────────────────────────
// N2 — 분석 중 상태
// ─────────────────────────────────────────────

/** N2: 섹션 자동 분해 진행 중 */
export const mockN2ProcessingStatus: JobStatusResponse = {
  jobId: MOCK_JOB_ID,
  currentStep: 'N2',
  // TODO: 백엔드 ERD 확정 후 JobDbStatus union으로 좁힐 것
  dbStatus: 'processing',
  progress: 55,
  // TODO: 백엔드 파이프라인 명세 확정 후 N2 ProcessingSubStep union으로 좁힐 것
  processingSubStep: 'section_decomposition',
  activeSubSteps: [],
  hasFailed: false,
  failedItems: [],
};

/** N2: OCR 완료, 규제 판정 진행 중 */
export const mockN2VerdictStatus: JobStatusResponse = {
  jobId: MOCK_JOB_ID,
  currentStep: 'N2',
  dbStatus: 'processing',
  progress: 85,
  processingSubStep: 'verdict',
  activeSubSteps: [],
  hasFailed: false,
  failedItems: [],
};

// ─────────────────────────────────────────────
// N3 — 섹션 목록
// ─────────────────────────────────────────────

/**
 * N3 섹션 목록 fixture.
 *
 * 테스트 케이스:
 * - sec_01: 정상 include 섹션 (verdicts 없음)
 * - sec_02: 규제 warning 섹션 (verdicts 있음)
 * - sec_03: 자동 exclude 섹션
 * - sec_04: 정상 include 섹션 (두 번째 소스 이미지)
 * - sec_05: localization warning 섹션 (두 번째 소스 이미지)
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
      thumbnailUrl: '/mock/section-thumb-01.jpg',
      bucket: 'include',
      exclusionReason: null,
      excludedStage: null,
      bbox: { x: 0, y: 0, width: 1000, height: 600 },
      verdicts: [],
    },
    {
      sectionId: 'sec_02',
      sourceImageId: SRC_A,
      sectionOrder: 2,
      thumbnailUrl: '/mock/section-thumb-02.jpg',
      bucket: 'include',
      exclusionReason: null,
      excludedStage: null,
      bbox: { x: 0, y: 600, width: 1000, height: 500 },
      verdicts: [
        {
          verdictId: 'vrd_01',
          // TODO: 백엔드 확정 후 VerdictType union으로 좁힐 것
          verdictType: 'regulatory',
          // TODO: 백엔드 확정 후 VerdictStatus union으로 좁힐 것
          verdictStatus: 'warning',
          problemText: '최고의 수분 공급 효과',
          basis: '최상급 표현은 FTC 규정상 객관적 근거 없이 사용 불가',
        },
      ],
    },
    {
      sectionId: 'sec_03',
      sourceImageId: SRC_A,
      sectionOrder: 3,
      thumbnailUrl: '/mock/section-thumb-03.jpg',
      bucket: 'exclude',
      exclusionReason: '브랜드 로고 전용 영역 — 자동 제외',
      // N3에서 자동 제외된 섹션. N5 화면에 표시되지 않음.
      excludedStage: 'N3',
      bbox: { x: 0, y: 1100, width: 1000, height: 200 },
      verdicts: [],
    },
    {
      sectionId: 'sec_04',
      sourceImageId: SRC_B,
      sectionOrder: 4,
      thumbnailUrl: '/mock/section-thumb-04.jpg',
      bucket: 'include',
      exclusionReason: null,
      excludedStage: null,
      bbox: { x: 0, y: 0, width: 1000, height: 700 },
      verdicts: [],
    },
    {
      sectionId: 'sec_05',
      sourceImageId: SRC_B,
      sectionOrder: 5,
      thumbnailUrl: '/mock/section-thumb-05.jpg',
      bucket: 'include',
      exclusionReason: null,
      excludedStage: null,
      bbox: { x: 0, y: 700, width: 1000, height: 400 },
      verdicts: [
        {
          verdictId: 'vrd_02',
          verdictType: 'localization',
          verdictStatus: 'warning',
          problemText: '민감성 피부에 적합',
          basis: '미국 시장에서 "sensitive" 표기 시 피부과 테스트 결과 근거 권장',
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────────
// N4 — 번역 / 인페인팅 처리 중
// ─────────────────────────────────────────────

/** N4: 정상 처리 중 (인페인팅 + 번역 병렬) */
export const mockN4ProcessingStatus: JobStatusResponse = {
  jobId: MOCK_JOB_ID,
  currentStep: 'N4',
  dbStatus: 'processing',
  progress: 63,
  // TODO: 백엔드 파이프라인 명세 확정 후 N4 ProcessingSubStep union으로 좁힐 것
  processingSubStep: 'translation',
  activeSubSteps: ['inpainting', 'translation'],
  hasFailed: false,
  failedItems: [],
};

/** N4: 인페인팅 + 번역 완료, 렌더링 진행 중 (2일차 auto-progress 2번째 응답용) */
export const mockN4RenderingStatus: JobStatusResponse = {
  jobId: MOCK_JOB_ID,
  currentStep: 'N4',
  dbStatus: 'processing',
  progress: 90,
  processingSubStep: 'render',
  activeSubSteps: ['render'],
  hasFailed: false,
  failedItems: [],
};

/** N6: 렌더링 진행 중 (handler의 'n6-rendering' scenario용 최소 fixture) */
export const mockN6RenderingStatus: JobStatusResponse = {
  jobId: MOCK_JOB_ID,
  currentStep: 'N6',
  dbStatus: 'processing',
  progress: 80,
  processingSubStep: 'render',
  activeSubSteps: ['render'],
  hasFailed: false,
  failedItems: [],
};

/** N4: 부분 실패 케이스 — textBlock 1개 번역 타임아웃 */
export const mockN4PartialFailureStatus: JobStatusResponse = {
  jobId: MOCK_JOB_ID,
  currentStep: 'N4',
  dbStatus: 'processing',
  progress: 90,
  processingSubStep: 'render',
  activeSubSteps: ['render'],
  hasFailed: false, // 전체 실패가 아니라 부분 실패이므로 false
  failedItems: [
    {
      id: 'blk_04',
      type: 'textBlock',
      reason: 'TRANSLATION_TIMEOUT',
    },
  ],
};

// ─────────────────────────────────────────────
// N5 — 검수 (ReviewResponse)
// ─────────────────────────────────────────────

/**
 * N5 검수 fixture.
 *
 * 테스트 케이스:
 * 1. blk_01 — 정상 번역 블록 (needsReview: false)
 * 2. blk_02 — 확인 필요 블록 (needsReview: true, complianceFlags 포함)
 * 3. blk_03 — 다른 번역 후보 2개가 있는 블록
 * 4. blk_04 — N4 부분 실패로 blockStatus 'failed'인 블록
 * 5. blk_05 — 사용자 수정된 것처럼 표현 (translationStatus: 'userEdited')
 */
export const mockReviewResponse: ReviewResponse = {
  job: {
    jobId: MOCK_JOB_ID,
    targetCountry: 'US',
    targetLanguage: 'en',
  },

  // 좌측 뷰어: 소스 이미지 단위 원문/번역문 전환
  sourceImages: [
    {
      sourceImageId: SRC_A,
      originalPreviewUrl: '/mock/detail-a-original.jpg',
      translatedPreviewUrl: '/mock/detail-a-translated.jpg',
    },
    {
      sourceImageId: SRC_B,
      originalPreviewUrl: '/mock/detail-b-original.jpg',
      translatedPreviewUrl: '/mock/detail-b-translated.jpg',
    },
  ],

  // 우측 패널: 섹션 단위 텍스트 블록
  sections: [
    // ── 섹션 01: 정상 섹션 (SRC_A)
    {
      sectionId: 'sec_01',
      sourceImageId: SRC_A,
      sectionOrder: 1,
      bucket: 'include',
      excludedStage: null,
      textBlocks: [
        {
          // 케이스 1: 정상 번역 블록
          blockId: 'blk_01',
          sectionId: 'sec_01',
          sourceText: '수분 충전 앰플',
          translatedText: 'Moisture Ampoule',
          translationStatus: 'machine',
          role: 'title',
          // TODO: 백엔드 text_block.block_status 확정 후 union으로 좁힐 것
          blockStatus: 'done',
          needsReview: false,
          complianceFlags: [],
          autoAdjust: false,
          basis: '브랜드 톤에 맞게 간결하게 번역했습니다.',
          bbox: { x: 200, y: 80, width: 600, height: 80 },
          candidates: [],
        },
        {
          // 케이스 5: 사용자 수정된 블록 (translationStatus: userEdited)
          blockId: 'blk_05',
          sectionId: 'sec_01',
          sourceText: '피부 깊숙이 침투하는 성분',
          translatedText: 'Deeply penetrating ingredients (edited)',
          translationStatus: 'userEdited',
          role: 'body',
          blockStatus: 'done',
          needsReview: true,
          // TODO: 백엔드 규제 DB 기준 코드값 확정 후 union으로 좁힐 것
          complianceFlags: ['USER_EDITED_PENDING_REVIEW'],
          autoAdjust: false,
          basis: '원문의 과학적 주장을 그대로 번역했습니다.',
          bbox: { x: 100, y: 200, width: 800, height: 120 },
          candidates: [],
        },
      ],
    },

    // ── 섹션 02: 규제 warning 섹션 (SRC_A)
    {
      sectionId: 'sec_02',
      sourceImageId: SRC_A,
      sectionOrder: 2,
      bucket: 'include',
      excludedStage: null,
      textBlocks: [
        {
          // 케이스 2: 확인 필요 블록 (needsReview: true)
          blockId: 'blk_02',
          sectionId: 'sec_02',
          sourceText: '최고의 수분 공급 효과',
          translatedText: 'The best moisturizing effect',
          translationStatus: 'machine',
          role: 'body',
          blockStatus: 'done',
          needsReview: true,
          complianceFlags: ['PROHIBITED_EXPRESSION'],
          autoAdjust: false,
          basis: '최상급 표현을 포함해 수정이 권장됩니다.',
          bbox: { x: 100, y: 120, width: 800, height: 100 },
          candidates: [],
        },
        {
          // 케이스 3: 다른 번역 후보 2개가 있는 블록
          blockId: 'blk_03',
          sectionId: 'sec_02',
          sourceText: '임상 시험 완료',
          translatedText: 'Clinically tested',
          translationStatus: 'machine',
          role: 'caption',
          blockStatus: 'done',
          needsReview: false,
          complianceFlags: [],
          autoAdjust: false,
          basis: '공인된 임상 시험 문구를 사용했습니다.',
          bbox: { x: 300, y: 400, width: 400, height: 60 },
          candidates: [
            {
              candidateId: 'cand_03_a',
              translatedText: 'Dermatologically tested',
              isSelected: false,
            },
            {
              candidateId: 'cand_03_b',
              translatedText: 'Clinical trial completed',
              isSelected: false,
            },
          ],
        },
      ],
    },

    // ── 섹션 03: N3에서 자동 제외된 섹션 — review 응답에서 필터링됨
    {
      sectionId: 'sec_03',
      sourceImageId: SRC_A,
      sectionOrder: 3,
      bucket: 'exclude',
      excludedStage: 'N3',
      textBlocks: [],
    },

    // ── 섹션 04: 정상 섹션 (SRC_B)
    {
      sectionId: 'sec_04',
      sourceImageId: SRC_B,
      sectionOrder: 4,
      bucket: 'include',
      excludedStage: null,
      textBlocks: [
        {
          // 케이스 4: N4 부분 실패 블록 (blockStatus: 'failed')
          blockId: 'blk_04',
          sectionId: 'sec_04',
          sourceText: '순수 비타민 C 15% 함유',
          translatedText: '',
          translationStatus: 'machine',
          role: 'body',
          blockStatus: 'failed',
          needsReview: true,
          complianceFlags: [],
          autoAdjust: false,
          basis: '',
          bbox: { x: 150, y: 300, width: 700, height: 80 },
          candidates: [],
        },
      ],
    },

    // ── 섹션 05: localization warning 섹션 (SRC_B)
    {
      sectionId: 'sec_05',
      sourceImageId: SRC_B,
      sectionOrder: 5,
      bucket: 'include',
      excludedStage: null,
      textBlocks: [
        {
          blockId: 'blk_06',
          sectionId: 'sec_05',
          sourceText: '민감성 피부에 적합',
          translatedText: 'Suitable for sensitive skin',
          translationStatus: 'machine',
          role: 'body',
          blockStatus: 'done',
          needsReview: true,
          complianceFlags: ['LOCALIZATION_WARNING'],
          autoAdjust: false,
          basis: '미국 시장에서 "sensitive skin" 표기 시 피부과 테스트 결과 근거 권장',
          bbox: { x: 100, y: 150, width: 800, height: 80 },
          candidates: [],
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────────
// N6 — 최종 결과
// ─────────────────────────────────────────────

/** N6: 렌더링 완료, 전체 검증 통과 */
export const mockJobResultResponse: JobResultResponse = {
  jobId: MOCK_JOB_ID,
  // TODO: 백엔드 확정 후 union으로 좁힐 것
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
