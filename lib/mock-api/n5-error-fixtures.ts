/**
 * N5 오류 표시 확인용 Mock 시나리오(Figma 388:3814). /jobs/1?mockScenario=n5-errors 로 들어왔을 때만 쓰인다.
 * 기본 fixture(n5-fixtures.ts)는 바꾸지 않고, 응답을 만들 때 그 위에 덮는다. Mock 전용이며 실제 API 데이터가 아니다.
 */

import type { ApiJobAsyncTaskItem, ApiReviewSignal, ApiTextBlock } from '@/lib/api/n5-schema';
import type { ApiSection } from '@/lib/api/n3-schema';

export const N5_ERROR_SCENARIO = 'n5-errors';

/** 요청을 보낸 화면 주소에 시나리오가 있을 때만 켠다(MSW request.referrer) */
export function isN5ErrorScenario(referrer: string): boolean {
  if (!referrer) return false;
  try {
    return new URL(referrer).searchParams.get('mockScenario') === N5_ERROR_SCENARIO;
  } catch {
    return false;
  }
}

/** 번역 실패 signal에 동봉되는 task */
const TRANSLATE_TASK_ID = 80101;

const SIGNALS_BY_BLOCK: Record<number, ApiReviewSignal[]> = {
  9101: [
    { code: 'prohibited_expression', reason: '번역문의 표현이 금지 표현 목록에 있습니다', basisArticle: '화장품법 제13조' },
    { code: 'prohibited_expression', reason: '번역문의 다른 표현은 시험 결과가 있을 때만 쓸 수 있습니다' },
  ],
  9102: [
    { code: 'mandatory_term_unapplied', reason: '번역문에 강제 용어가 적용되지 않았습니다' },
    { code: 'empty_block', reason: '원문을 잘못 읽었을 수 있습니다 — 이미지와 비교해 주세요' },
  ],
  9111: [{ code: 'translation_failed', reason: '번역 엔진 응답 시간 초과', taskId: TRANSLATE_TASK_ID, retryable: true }],
  9103: [{ code: 'width_overflow', reason: '번역문이 영역보다 깁니다' }],
};

/** 요청을 보낸 화면 주소의 Mock 시나리오 이름 */
function scenarioOf(referrer: string): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).searchParams.get('mockScenario');
  } catch {
    return null;
  }
}

/** n5-overlap — 겹침 진단 확인용. 9102(body)와 9111(caption)이 실제로 겹친다 */
export function isN5OverlapScenario(referrer: string): boolean {
  return scenarioOf(referrer) === 'n5-overlap';
}

export function applyN5OverlapBlock(block: ApiTextBlock): ApiTextBlock {
  return block.id === 9111 ? { ...block, bbox: { x: 40, y: 300, w: 300, h: 80 } } : block;
}

/** n5-clean — 저장 전 확인 항목이 하나도 없는 상태. 번역 실패·금지 표현 signal을 뺀다 */
export function isN5CleanScenario(referrer: string): boolean {
  return scenarioOf(referrer) === 'n5-clean';
}

export function applyN5CleanBlock(block: ApiTextBlock): ApiTextBlock {
  const signals = (block.signals ?? []).filter((s) => s.code !== 'translation_failed' && s.code !== 'prohibited_expression');
  return { ...block, signals, trans1: block.trans1 ?? 'Mock translation' };
}

/** n3-card-variants — N3 카드 7종 확인용. section 1~5의 상태를 덮는다(선택 variant는 클릭으로 본다) */
export function isN3CardVariantsScenario(referrer: string): boolean {
  return scenarioOf(referrer) === 'n3-card-variants';
}

export function applyN3CardVariant(section: ApiSection): ApiSection {
  switch (section.id) {
    case 1:
      return { ...section, bucket: 'include', exclusionReason: null, excludedStage: null, verdicts: [] };
    case 2:
      return { ...section, bucket: 'exclude', exclusionReason: 'auto_regulatory', excludedStage: 'N3' };
    case 3:
      return { ...section, bucket: 'exclude', exclusionReason: 'user_manual', excludedStage: 'N3', verdicts: [] };
    case 4:
      return { ...section, bucket: 'exclude', exclusionReason: 'auto_local_failed', excludedStage: 'N3', verdicts: [] };
    default:
      return { ...section, bucket: 'include', exclusionReason: 'restored_by_user', excludedStage: null };
  }
}

export function applyN5ErrorBlocks(block: ApiTextBlock): ApiTextBlock {
  const signals = SIGNALS_BY_BLOCK[block.id as number];
  if (!signals) return block;
  const failedTranslation = signals.some((s) => s.code === 'translation_failed');
  // 번역이 생성되지 않은 칸(사용자가 직접 저장하면 그 값을 보여 준다)
  const isUntouched = (block.revision ?? 1) <= 1;
  return { ...block, signals, ...(failedTranslation && isUntouched ? { trans1: null } : {}) };
}

function failedItem(
  taskId: number,
  taskType: ApiJobAsyncTaskItem['taskType'],
  unitType: ApiJobAsyncTaskItem['unitType'],
  unitId: number,
  retryable: boolean,
): ApiJobAsyncTaskItem {
  return {
    taskId,
    taskType,
    unitType,
    unitId,
    status: 'failed',
    uiStatus: 'failed',
    retryCount: 0,
    maxRetry: 3,
    retryable,
    errorCode: 'MOCK_FAILED',
    revision: null,
  };
}

const FAILED_ITEMS: ApiJobAsyncTaskItem[] = [
  failedItem(80001, 'render', 'section', 501, true),
  failedItem(80002, 'inpaint', 'section', 501, false),
  failedItem(TRANSLATE_TASK_ID, 'translate', 'text_block', 9111, true),
  failedItem(80003, 'verify', 'text_block', 9111, false),
  failedItem(80004, 'verify', 'text_block', 9103, false),
  failedItem(80005, 'render', 'text_block', 9103, true),
  failedItem(80007, 'render', 'section', 505, true),
  { ...failedItem(80006, 'render', 'section', 504, false), status: 'running', uiStatus: 'running', errorCode: null },
];

export function getN5ErrorFailedItems(): ApiJobAsyncTaskItem[] {
  return FAILED_ITEMS;
}

/** 섹션 501 — N3에서 되살린 섹션. 목록(SEC-01)의 포함 섹션은 verdicts가 비고, 상세(SEC-02)에 판정 근거가 있다 */
const RESTORED_SECTION_BASE = {
  id: 501,
  sectionOrder: 1,
  sourceImageId: 9001,
  topOffset: null,
  displayTop: null,
  height: null,
  bbox: null,
  category: null,
  bucket: 'include',
  exclusionReason: 'restored_by_user',
  excludedStage: null,
  inpaintStatus: 'failed',
  warningBadge: 'quality_warning',
  signals: [],
} satisfies ApiSection;

export const n5ErrorRestoredSectionListItem: ApiSection = { ...RESTORED_SECTION_BASE, verdicts: [] };

const VERDICT_TYPES = ['regulatory', 'channel_policy', 'regulatory_replaceable', 'regulatory_conditional', 'local_irrelevant', 'needs_fix'] as const;
const VERDICT_STATUS_BY_TYPE = {
  regulatory: 'regulated',
  channel_policy: 'policy',
  regulatory_replaceable: 'regulated',
  regulatory_conditional: 'conditional',
  local_irrelevant: 'irrelevant',
  needs_fix: 'needs_fix',
} as const;

export const n5ErrorRestoredSectionDetail: ApiSection = {
  ...RESTORED_SECTION_BASE,
  verdicts: VERDICT_TYPES.map((verdictType, i) => ({
    id: 8000 + i,
    verdictStatus: VERDICT_STATUS_BY_TYPE[verdictType],
    verdictType,
    problemText: null,
    alternativeExpression: null,
    basisArticle: null,
    evidenceUrl: null,
    reason: null,
  })),
};

/**
 * ?scenario=n2-error · n4-error — 처리 오류 화면 직접 진입(Mock 전용). MSW 핸들러만 읽으므로 Mock이 꺼진 환경에서는
 * 이 값을 읽는 코드 자체가 없다. 해당 단계의 전체 실패로 고정한다.
 */
const PROCESSING_ERROR_SCENARIO_STEPS: Record<string, 'N2' | 'N4'> = { 'n2-error': 'N2', 'n4-error': 'N4' };

export function getProcessingErrorScenarioStep(referrer: string): 'N2' | 'N4' | null {
  if (!referrer) return null;
  try {
    return PROCESSING_ERROR_SCENARIO_STEPS[new URL(referrer).searchParams.get('scenario') ?? ''] ?? null;
  } catch {
    return null;
  }
}
