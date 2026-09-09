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
  Section,
  ReviewResponse,
  ReviewSection,
  JobResultResponse,
} from '@/lib/api/types';
import { computeSectionDisplayTops } from '@/lib/n5/coordinates';
import { getVerdictType } from '@/lib/n3/verdict';

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
 * - sec_02: regulated 판정 섹션 (verdicts 있음, bucket은 include 유지 — 정본은 section.bucket)
 * - sec_03: 현지 무의미 자동 exclude 섹션 (카카오톡 상담 안내)
 * - sec_04: 정상 include 섹션 (두 번째 소스 이미지)
 * - sec_05: regulated 판정 섹션 (두 번째 소스 이미지, sensitive claim)
 *
 * N3 verdictStatus 5종 계약 케이스는 mockN3VerdictContractSections 참고
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
          verdictType: getVerdictType('regulated'),
          verdictStatus: 'regulated',
          isTeaser: false,
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
      // 카카오톡 상담 안내 — 미국(도착 시장)에서 의미 없는 채널이라 자동 제외.
      // 표시 문구는 코드값 그대로 노출하지 않고 EXCLUSION_REASON_LABELS를 거친다.
      exclusionReason: 'auto_local_irrelevant',
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
          verdictType: getVerdictType('regulated'),
          verdictStatus: 'regulated',
          isTeaser: false,
          problemText: '민감성 피부에 적합',
          basis: '미국 시장에서 "sensitive" 표기 시 피부과 테스트 결과 근거 권장',
        },
      ],
    },
  ],
};

/**
 * N3 verdictStatus 5종 계약 검증용 Mock.
 *
 * 기본 흐름(mockSectionsResponse)과 분리한 이유: 여기 섹션들을 그 목록에
 * 섞으면 e2e/basic-flow.spec.ts의 n3-thumb-include-/n3-thumb-exclude- count
 * 단언이 깨진다. scripts/verify-n3-verdict-contract.mjs 전용으로 쓴다.
 *
 * bucket은 verdictStatus/isTeaser로부터 계산한 값이 아니라 계약서에 명시된
 * "정본" 값을 그대로 하드코딩한다 — section.bucket이 UI 상태의 유일한 정본이라는
 * 규칙을 fixture 레벨에서도 지킨다.
 *
 * - regulated / exclude
 * - conditional / include (조건부 규제는 항상 include 쪽)
 * - irrelevant / exclude
 * - needs_fix / include
 * - policy + isTeaser=true / include (배지만 표시, exclude로 보내지 않음)
 * - policy + isTeaser=false / exclude (실제 채널 정책 판정, 기본 exclude 대상)
 */
export const mockN3VerdictContractSections: Section[] = [
  {
    sectionId: 'vc_sec_regulated',
    sourceImageId: SRC_A,
    sectionOrder: 101,
    thumbnailUrl: '/mock/section-thumb-01.jpg',
    bucket: 'exclude',
    exclusionReason: 'auto_regulatory',
    excludedStage: 'N3',
    bbox: { x: 0, y: 0, width: 1000, height: 300 },
    verdicts: [
      {
        verdictId: 'vc_vrd_regulated',
        verdictType: getVerdictType('regulated'),
        verdictStatus: 'regulated',
        isTeaser: false,
        problemText: '효능 과장 표현',
        basis: '객관적 근거 없이 최상급 표현 사용 — 규제 위반',
      },
    ],
  },
  {
    sectionId: 'vc_sec_conditional',
    sourceImageId: SRC_A,
    sectionOrder: 102,
    thumbnailUrl: '/mock/section-thumb-02.jpg',
    bucket: 'include',
    exclusionReason: null,
    excludedStage: null,
    bbox: { x: 0, y: 300, width: 1000, height: 300 },
    verdicts: [
      {
        verdictId: 'vc_vrd_conditional',
        verdictType: getVerdictType('conditional'),
        verdictStatus: 'conditional',
        isTeaser: false,
        problemText: '조건부 사용 가능 표현',
        basis: '면책 문구 병기 시 사용 가능 — 조건부 규제',
      },
    ],
  },
  {
    sectionId: 'vc_sec_irrelevant',
    sourceImageId: SRC_A,
    sectionOrder: 103,
    thumbnailUrl: '/mock/section-thumb-03.jpg',
    bucket: 'exclude',
    exclusionReason: 'auto_local_irrelevant',
    excludedStage: 'N3',
    bbox: { x: 0, y: 600, width: 1000, height: 300 },
    verdicts: [
      {
        verdictId: 'vc_vrd_irrelevant',
        verdictType: getVerdictType('irrelevant'),
        verdictStatus: 'irrelevant',
        isTeaser: false,
        problemText: '카카오톡 상담 안내',
        basis: '도착 시장에서 의미 없는 채널 — 현지 무의미',
      },
    ],
  },
  {
    sectionId: 'vc_sec_needs_fix',
    sourceImageId: SRC_B,
    sectionOrder: 104,
    thumbnailUrl: '/mock/section-thumb-04.jpg',
    bucket: 'include',
    exclusionReason: null,
    excludedStage: null,
    bbox: { x: 0, y: 0, width: 1000, height: 300 },
    verdicts: [
      {
        verdictId: 'vc_vrd_needs_fix',
        verdictType: getVerdictType('needs_fix'),
        verdictStatus: 'needs_fix',
        isTeaser: false,
        problemText: '단위 표기 미변환 (g -> oz)',
        basis: '현지 기준 단위로 수정 필요',
      },
    ],
  },
  {
    sectionId: 'vc_sec_policy_teaser',
    sourceImageId: SRC_B,
    sectionOrder: 105,
    thumbnailUrl: '/mock/section-thumb-05.jpg',
    bucket: 'include',
    exclusionReason: null,
    excludedStage: null,
    bbox: { x: 0, y: 300, width: 1000, height: 300 },
    verdicts: [
      {
        verdictId: 'vc_vrd_policy_teaser',
        verdictType: getVerdictType('policy'),
        verdictStatus: 'policy',
        isTeaser: true,
        problemText: '채널 정책상 제한 가능 표현 (티저)',
        basis: '실제 판정 전 배지만 표시 — exclude 대상 아님',
      },
    ],
  },
  {
    sectionId: 'vc_sec_policy_real',
    sourceImageId: SRC_B,
    sectionOrder: 106,
    thumbnailUrl: '/mock/section-thumb-06.jpg',
    bucket: 'exclude',
    exclusionReason: 'auto_channel',
    excludedStage: 'N3',
    bbox: { x: 0, y: 600, width: 1000, height: 300 },
    verdicts: [
      {
        verdictId: 'vc_vrd_policy_real',
        verdictType: getVerdictType('policy'),
        verdictStatus: 'policy',
        isTeaser: false,
        problemText: '채널 정책 위반 표현',
        basis: '실제 채널 정책 판정 — 기본 exclude 대상',
      },
    ],
  },
];

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
 * 6. blk_06 — 확인 필요 블록 (두 번째 소스 이미지)
 * 7. blk_07 — N5에서 사용자가 수동 제외한 section에 속한 블록 (displayTop 누적 제외 검증용)
 *
 * displayTop은 손으로 계산해 넣지 않고 computeSectionDisplayTops(lib/n5/coordinates.ts)로
 * 구한다 — 실제로는 백엔드가 계산해 내려주는 값이라, 여기서도 같은 계산 로직을 거쳐야
 * "API 계산값"이라는 계약과 fixture 값이 어긋나지 않는다.
 *
 * displayTop은 job 전체 기준으로 누적된다 (v3.3.3). N5 좌측 뷰어가 여러
 * sourceImage를 하나의 스택으로 이어 보여주므로, sourceImage가 바뀐다고
 * 누적을 0으로 리셋하지 않는다 — computeSectionDisplayTops는 sourceImage를
 * 아예 모르는 순수 함수이고, 반드시 job 전체 section을 한 배열로 모아
 * "한 번만" 호출해야 한다. (sourceImage별로 나눠 여러 번 호출하면 그때마다
 * cursor가 0부터 다시 시작해 리셋된 것처럼 보이므로 주의)
 *
 * 초장축 검증: SRC_A 원본 8500px, SRC_B 원본 7000px(각 이미지 자체의 픽셀
 * 크기 — scale 계산용, displayTop 누적과는 별개). include section만 누적한
 * job 전체 stack height는 12,700px.
 *
 * topOffset(원본 이미지 내부 절대 위치)은 displayTop과 달리 손으로 직접
 * 채워 넣는다 — DB section.top_offset을 그대로 내려주는 값이라 API 계산값이
 * 아니고, section.height를 누적해서 역산하지 않는다(그 가정은 계약에 없다).
 * 이 mock에서는 SRC_A/SRC_B 각각 0부터 시작해 실제 페이지 레이아웃과 맞게
 * 손으로 지정했다 — Before/After 비교 viewer가 preview 이미지에서 이
 * section에 해당하는 부분을 topOffset 기준으로 crop해서 보여준다
 * (public/mock/n5/*.png, scripts/make-n5-fixture-images.mjs로 생성한
 * 눈금 이미지 — 실제 브라우저에서 crop 위치를 눈으로 검증할 수 있다).
 */

// SRC_A: sec_01(include) → sec_02(include) → sec_07(N5 exclude, 높이 누적 안 됨) → sec_03(N3 exclude, 응답 자체에서 필터링)
const srcASectionDrafts: Omit<ReviewSection, 'displayTop'>[] = [
  {
    sectionId: 'sec_01',
    sourceImageId: SRC_A,
    sectionOrder: 1,
    bucket: 'include',
    excludedStage: null,
    // topOffset: DB section.top_offset 그대로 — SRC_A 원본 이미지에서 이
    // section이 실제로 위치한 절대 y. height 누적으로 역산하지 않는다.
    topOffset: 0,
    height: 2500,
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
  {
    sectionId: 'sec_02',
    sourceImageId: SRC_A,
    sectionOrder: 2,
    bucket: 'include',
    excludedStage: null,
    topOffset: 2500,
    height: 3200,
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
  {
    // 케이스 7: N5에서 사용자가 수동 제외한 section — 회색으로 표시되고,
    // 뒤따르는 section은 이 section의 height를 건너뛰고 이어서 시작한다.
    sectionId: 'sec_07',
    sourceImageId: SRC_A,
    sectionOrder: 3,
    bucket: 'exclude',
    excludedStage: 'N5',
    // exclude 여부와 무관하게 원본 이미지 안의 실제 위치는 그대로 유지된다
    // (5700 = sec_01.height + sec_02.height — 이 페이지 레이아웃에서는 우연히
    // 빈틈없이 이어지지만, 이는 fixture 저자가 정한 값이지 FE가 계산한 값이 아니다).
    topOffset: 5700,
    height: 1600,
    textBlocks: [
      {
        blockId: 'blk_07',
        sectionId: 'sec_07',
        sourceText: '정기구독 시 10% 할인',
        translatedText: 'Subscribe & save 10%',
        translationStatus: 'machine',
        role: 'caption',
        blockStatus: 'done',
        needsReview: false,
        complianceFlags: [],
        autoAdjust: false,
        basis: '정기구독 안내는 도착 시장 채널 정책과 무관해 검수자가 N5에서 제외했습니다.',
        bbox: { x: 100, y: 100, width: 600, height: 60 },
        candidates: [],
      },
    ],
  },
  {
    // 섹션 03: N3에서 자동 제외된 섹션 — review 응답에서 필터링됨.
    // topOffset/displayTop/height는 타입상 필요해 채워두지만, handler가 응답
    // 전에 걸러내므로 FE에는 절대 도달하지 않는다 (아래 msw 핸들러 참고).
    sectionId: 'sec_03',
    sourceImageId: SRC_A,
    sectionOrder: 4,
    bucket: 'exclude',
    excludedStage: 'N3',
    topOffset: 7300,
    height: 1200,
    textBlocks: [],
  },
];

// SRC_B: sec_04(include) → sec_05(include).
// displayTop은 job 전체 기준이므로 SRC_A 마지막 include 누적값(5700)에서 이어진다 —
// sourceImage가 바뀐다고 0으로 리셋하지 않는다.
const srcBSectionDrafts: Omit<ReviewSection, 'displayTop'>[] = [
  {
    sectionId: 'sec_04',
    sourceImageId: SRC_B,
    sectionOrder: 5,
    bucket: 'include',
    excludedStage: null,
    // SRC_B 원본 이미지 기준 — SRC_A와는 별개 이미지이므로 여기서 0부터 시작한다.
    topOffset: 0,
    height: 4200,
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
  {
    // complianceFlags: ['LOCALIZATION_WARNING']는 ComplianceFlag(미확정 string) 값이며
    // VerdictType(section_verdict 계약)과는 무관하다.
    sectionId: 'sec_05',
    sourceImageId: SRC_B,
    sectionOrder: 6,
    bucket: 'include',
    excludedStage: null,
    topOffset: 4200,
    height: 2800,
    textBlocks: [
      {
        // 케이스 6: 확인 필요 블록 (두 번째 소스 이미지)
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
];

// displayTop은 job 전체 기준으로 누적되므로, sourceImage별로 나눠 각각 호출하면
// 안 된다 — 그러면 SRC_B의 첫 section이 0부터 다시 시작하는 잘못된 리셋이 생긴다.
// 반드시 job 전체 section을 표시 순서(= sourceImage 순서 → 그 안에서 sectionOrder
// 순서)대로 한 배열로 모아 한 번만 호출한다.
const allSectionDrafts = [...srcASectionDrafts, ...srcBSectionDrafts];
const allDisplayTops = computeSectionDisplayTops(allSectionDrafts);

export const mockReviewResponse: ReviewResponse = {
  job: {
    jobId: MOCK_JOB_ID,
    targetCountry: 'US',
    targetLanguage: 'en',
  },

  // 좌측 뷰어: 소스 이미지 단위 원문/번역문 전환.
  // 원본/번역 프리뷰는 같은 크기를 공유한다 — 슬라이더가 같은 좌표계 위에서
  // 두 레이어를 겹쳐 그려야 하므로 서로 다른 크기를 주지 않는다.
  //
  // /mock/n5/*.png는 실제 서비스 asset이 아니라 Before/After 비교 viewer
  // 검증용 test fixture다 (scripts/make-n5-fixture-images.mjs로 생성).
  // 원본 이미지 좌표를 라벨로 적은 눈금 이미지라, section.topOffset이
  // 가리키는 지점이 실제로 그 위치를 crop해서 보여주는지 눈으로 확인할 수
  // 있고, 원본/번역은 배경색으로 구분된다.
  sourceImages: [
    {
      sourceImageId: SRC_A,
      originalPreviewUrl: '/mock/n5/detail-a-original.png',
      translatedPreviewUrl: '/mock/n5/detail-a-translated.png',
      // 원본 8500px(초장축) → 미리보기 3400px, scaleX = scaleY = 0.4
      preview: {
        originalWidth: 1000,
        originalHeight: 8500,
        previewWidth: 400,
        previewHeight: 3400,
      },
    },
    {
      sourceImageId: SRC_B,
      originalPreviewUrl: '/mock/n5/detail-b-original.png',
      translatedPreviewUrl: '/mock/n5/detail-b-translated.png',
      // 원본 7000px(초장축) → 미리보기 2800px, scaleX = scaleY = 0.4
      preview: {
        originalWidth: 1000,
        originalHeight: 7000,
        previewWidth: 400,
        previewHeight: 2800,
      },
    },
  ],

  // 우측 패널: 섹션 단위 텍스트 블록. displayTop은 job 전체 기준 누적값이다.
  sections: allSectionDrafts.map((section, i) => ({ ...section, displayTop: allDisplayTops[i] })),
};

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
