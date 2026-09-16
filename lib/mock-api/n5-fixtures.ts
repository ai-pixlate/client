/**
 * N5 실제 계약(v3.4.2) mock fixture — GET /jobs/:jobId, GET /jobs/:jobId/blocks,
 * GET /jobs/:jobId/preview.
 *
 * lib/mock-api/fixtures.ts(구 /review·/preview 계약, v3.4.1 FE 메모 기준)는 건드리지
 * 않는다 — e2e/n5-viewport.spec.ts와 stress job이 여전히 그 계약을 참조한다. N5 화면은
 * 이제 이 파일의 실제 계약(v3.4.2) 데이터를 쓴다. jobId route slug는 기존과 같은
 * MOCK_JOB_ID('job_mock_001')를 재사용한다 — job 목록/상태 polling 등 다른 N-단계와
 * 같은 job으로 이어지는 흐름을 유지하기 위함이다.
 *
 * 이미지 파일: scripts/make-n5-section-fixture-images.mjs(npm run make:n5-section-fixtures)로
 * public/mock/n5/sections/{id}-{original,translated}.png 생성. 섹션 505는 renderedUrl
 * 없이(=null) 렌더 전 상태를 시뮬레이션한다 — translated 파일 자체를 만들지 않았다.
 *
 * scale=0.4, maxOriginalWidth=1000(raw) — 섹션별 원본 폭/높이도 이 배율로 미리 축소해 둔
 * "preview 이미지"를 파일로 만들었다(백엔드가 이미 다운스케일된 이미지를 내려준다는
 * 계약과 동일한 방식). width/height/displayTop 필드 자체는 원본(raw) px 값을 담아
 * scale과 함께 내려준다 — FE(Adapter)가 재계산하지 않고 그대로 쓴다.
 */

import type { ApiJob, ApiTextBlock } from '@/lib/api/n5-schema';

const SECTION_IMG_BASE = '/mock/n5/sections';

export const N5_SCALE = 0.4;
export const N5_MAX_ORIGINAL_WIDTH = 1000;

export const mockN5Job: ApiJob = {
  id: 1,
  status: 'review',
  currentStep: 'N5',
  userFacingStatus: 'reviewing',
  productName: '비타민C 세럼',
  productCode: null,
  brandId: 1,
  targetCountry: 'US',
  regulatoryClass: 'cosmetic',
  targetLanguage: 'en',
  specType: 'original',
  channelSpecId: null,
  categoryId: 1,
  internalCategory: null,
  keywords: [],
  imageType: 'multi_section',
  isSaved: false,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
};

/**
 * 원본(raw) px 기준 section 목록. include만 displayTop 커서를 누적한다 — 503(N5 제외)은
 * 커서를 전진시키지 않으므로 504의 displayTop이 503과 같은 값(1600)에서 시작한다
 * (lib/n5/coordinates.ts의 computeSectionDisplayTops와 동일한 규칙, 여기서는 계산기를
 * 다시 쓰지 않고 mock 응답 생성 시점에 미리 손으로 채운다).
 */
export const mockN5PreviewSections = [
  {
    id: 501,
    sectionOrder: 1,
    bucket: 'include' as const,
    excludedStage: null,
    sourceImageId: 9001,
    width: 1000,
    height: 900,
    displayTop: 0,
    originalUrl: `${SECTION_IMG_BASE}/501-original.png`,
    renderedUrl: `${SECTION_IMG_BASE}/501-translated.png`,
    signals: [],
  },
  {
    id: 502,
    sectionOrder: 2,
    bucket: 'include' as const,
    excludedStage: null,
    sourceImageId: 9001,
    width: 1000,
    height: 700,
    displayTop: 900,
    originalUrl: `${SECTION_IMG_BASE}/502-original.png`,
    renderedUrl: `${SECTION_IMG_BASE}/502-translated.png`,
    signals: [],
  },
  {
    // N5에서 제외된 섹션(F-CFM-14) — bucket=exclude, excludedStage='N5'.
    // displayTop은 502까지 누적된 값(1600)에서 멈춘다.
    id: 503,
    sectionOrder: 3,
    bucket: 'exclude' as const,
    excludedStage: 'N5' as const,
    sourceImageId: 9001,
    width: 1000,
    height: 500,
    displayTop: 1600,
    originalUrl: `${SECTION_IMG_BASE}/503-original.png`,
    renderedUrl: `${SECTION_IMG_BASE}/503-translated.png`,
    signals: [],
  },
  {
    // 렌더 전(null) 시나리오 — 제외 상태는 아니다. renderedUrl===null을 실패로
    // 단정하지 않는다는 계약(resolveSectionRenderState)을 mock에서도 검증한다.
    id: 504,
    sectionOrder: 4,
    bucket: 'include' as const,
    excludedStage: null,
    sourceImageId: 9001,
    width: 1000,
    height: 600,
    displayTop: 1600,
    originalUrl: `${SECTION_IMG_BASE}/504-original.png`,
    renderedUrl: null,
    signals: [],
  },
  {
    // 다른 sourceImage, 다른 원본 폭(900) — align=left 다폭 대응 검증.
    id: 505,
    sectionOrder: 5,
    bucket: 'include' as const,
    excludedStage: null,
    sourceImageId: 9002,
    width: 900,
    height: 800,
    displayTop: 2200,
    originalUrl: `${SECTION_IMG_BASE}/505-original.png`,
    renderedUrl: `${SECTION_IMG_BASE}/505-translated.png`,
    signals: [],
  },
];

export const mockN5PreviewHeight =
  mockN5PreviewSections
    .filter((s) => s.bucket === 'include')
    .reduce((sum, s) => sum + s.height, 0) * N5_SCALE;

export function buildMockN5Preview() {
  return {
    maxOriginalWidth: N5_MAX_ORIGINAL_WIDTH,
    originalHeight: mockN5PreviewHeight / N5_SCALE,
    previewWidth: N5_MAX_ORIGINAL_WIDTH * N5_SCALE,
    previewHeight: mockN5PreviewHeight,
    scale: N5_SCALE,
    align: 'left' as const,
    sections: mockN5PreviewSections,
  };
}

/**
 * 6종 seller signal 코드를 전부 최소 1건씩 exercise하도록 구성했다(admin 2종
 * low_ocr_confidence/inpaint_residual_flag는 서버가 이미 제외하므로 mock에도 넣지 않는다).
 * role 6종(product_label 포함)도 전부 최소 1건씩 포함한다.
 */
export const mockN5Blocks: ApiTextBlock[] = [
  {
    id: 9101,
    sectionId: 501,
    displayTop: 0,
    blockOrder: 1,
    role: 'title',
    isExcluded: false,
    sourceKo: '순수 비타민 C 세럼',
    trans1: 'Pure Vitamin C Serum',
    blockStatus: 'machine',
    bbox: { x: 40, y: 40, w: 900, h: 120 },
    charCount: 21,
    charLimit: null,
    overflow: false,
    autoAdjust: null,
    signals: [],
    alternativeExpression: null,
    revision: 1,
  },
  {
    id: 9102,
    sectionId: 501,
    displayTop: 0,
    blockOrder: 2,
    role: 'body',
    isExcluded: false,
    sourceKo: '피부 톤을 환하게 밝혀주는 고농축 비타민C 세럼입니다.',
    trans1: 'A high-concentration vitamin C serum that brightens skin tone.',
    blockStatus: 'machine',
    bbox: { x: 40, y: 200, w: 900, h: 200 },
    charCount: 63,
    charLimit: 200,
    overflow: false,
    autoAdjust: null,
    signals: [],
    alternativeExpression: null,
    revision: 1,
  },
  {
    id: 9111,
    sectionId: 501,
    displayTop: 0,
    blockOrder: 3,
    role: 'caption',
    isExcluded: false,
    sourceKo: '정품인증 로고',
    trans1: 'Authenticity logo',
    blockStatus: 'machine',
    bbox: { x: 40, y: 420, w: 300, h: 80 },
    charCount: 10,
    charLimit: null,
    overflow: false,
    autoAdjust: null,
    signals: [{ code: 'logo_match_failed', reason: '정품 로고 매칭에 실패했습니다' }],
    alternativeExpression: null,
    revision: 1,
  },
  {
    id: 9103,
    sectionId: 502,
    displayTop: 900,
    blockOrder: 1,
    role: 'price',
    isExcluded: false,
    sourceKo: '29,000원',
    trans1: '$21.90',
    blockStatus: 'machine',
    bbox: { x: 40, y: 40, w: 300, h: 80 },
    charCount: 6,
    charLimit: null,
    overflow: false,
    autoAdjust: null,
    signals: [],
    alternativeExpression: null,
    revision: 1,
  },
  {
    id: 9104,
    sectionId: 502,
    displayTop: 900,
    blockOrder: 2,
    role: 'caution',
    isExcluded: false,
    sourceKo: '민감성 피부는 사용 전 패치 테스트를 권장합니다.',
    trans1:
      'Sensitive skin: patch test recommended before use — this translated caution text runs deliberately long to exercise the overflow badge and the auto-adjust font-scale indicator in the block list.',
    blockStatus: 'machine',
    bbox: { x: 40, y: 150, w: 900, h: 120 },
    charCount: 180,
    charLimit: 120,
    overflow: true,
    autoAdjust: { fontScale: 0.85, lineBreakApplied: true },
    signals: [{ code: 'width_overflow', reason: '번역문이 영역보다 깁니다' }],
    alternativeExpression: null,
    revision: 1,
  },
  {
    id: 9112,
    sectionId: 502,
    displayTop: 900,
    blockOrder: 3,
    role: 'caution',
    isExcluded: false,
    sourceKo: '즉시 효과',
    trans1: 'Instant effect guaranteed',
    blockStatus: 'machine',
    bbox: { x: 40, y: 300, w: 500, h: 80 },
    charCount: 9,
    charLimit: null,
    overflow: false,
    autoAdjust: null,
    signals: [
      {
        code: 'prohibited_expression',
        reason: "'즉시 효과' 표현은 과장광고에 해당합니다",
        basisArticle: '표시광고법 제3조',
        evidenceUrl: 'https://example.com/evidence/prohibited-01',
      },
    ],
    alternativeExpression: '눈에 띄는 효과',
    revision: 1,
  },
  {
    id: 9105,
    sectionId: 502,
    displayTop: 900,
    blockOrder: 4,
    role: 'product_label',
    isExcluded: true,
    sourceKo: 'NATURE CO.',
    trans1: null,
    blockStatus: 'machine',
    bbox: { x: 700, y: 500, w: 200, h: 60 },
    charCount: null,
    charLimit: null,
    overflow: false,
    autoAdjust: null,
    signals: [],
    alternativeExpression: null,
    revision: 1,
  },
  {
    id: 9106,
    sectionId: 503,
    displayTop: 1600,
    blockOrder: 1,
    role: 'caption',
    isExcluded: false,
    sourceKo: '한정판 패키지',
    trans1: 'Limited edition package',
    blockStatus: 'machine',
    bbox: { x: 40, y: 40, w: 500, h: 80 },
    charCount: 8,
    charLimit: null,
    overflow: false,
    autoAdjust: null,
    signals: [],
    alternativeExpression: null,
    revision: 1,
  },
  {
    id: 9107,
    sectionId: 504,
    displayTop: 1600,
    blockOrder: 1,
    role: 'body',
    isExcluded: false,
    sourceKo: '유통기한: 제조일로부터 24개월',
    trans1: null,
    blockStatus: 'machine',
    bbox: { x: 40, y: 40, w: 800, h: 100 },
    charCount: null,
    charLimit: null,
    overflow: false,
    autoAdjust: null,
    signals: [
      { code: 'translation_failed', reason: '번역 엔진 응답 시간 초과', taskId: 70001, retryable: true },
    ],
    alternativeExpression: null,
    revision: 1,
  },
  {
    id: 9108,
    sectionId: 504,
    displayTop: 1600,
    blockOrder: 2,
    role: 'caption',
    isExcluded: false,
    sourceKo: '',
    trans1: '',
    blockStatus: 'machine',
    bbox: { x: 40, y: 160, w: 400, h: 60 },
    charCount: 0,
    charLimit: null,
    overflow: false,
    autoAdjust: null,
    signals: [{ code: 'empty_block', reason: '원문이 비어 있습니다' }],
    alternativeExpression: null,
    revision: 1,
  },
  {
    id: 9109,
    sectionId: 505,
    displayTop: 2200,
    blockOrder: 1,
    role: 'title',
    isExcluded: false,
    sourceKo: '선물 세트 구성',
    trans1: 'Gift Set Includes',
    blockStatus: 'machine',
    bbox: { x: 30, y: 30, w: 800, h: 100 },
    charCount: 17,
    charLimit: null,
    overflow: false,
    autoAdjust: null,
    signals: [],
    alternativeExpression: null,
    revision: 1,
  },
  {
    id: 9110,
    sectionId: 505,
    displayTop: 2200,
    blockOrder: 2,
    role: 'body',
    isExcluded: false,
    sourceKo: '해외 배송 시 통관 규정을 확인하세요.',
    trans1: 'Check customs regulations for international shipping.',
    blockStatus: 'machine',
    bbox: { x: 30, y: 150, w: 800, h: 100 },
    charCount: 54,
    charLimit: null,
    overflow: false,
    autoAdjust: null,
    signals: [
      { code: 'mandatory_term_unapplied', reason: '필수 고지 문구가 누락됐습니다', basisArticle: '화장품법 제10조' },
    ],
    alternativeExpression: null,
    revision: 1,
  },
];

export function getMockN5BlocksBySection(sectionId?: number): ApiTextBlock[] {
  if (sectionId == null) return mockN5Blocks;
  return mockN5Blocks.filter((block) => block.sectionId === sectionId);
}
