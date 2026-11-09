/**
 * N5 Adapter — OpenAPI generated DTO(lib/api/n5-schema.ts) → N5 ViewModel.
 *
 *   OpenAPI DTO → N5 Adapter(이 파일) → N5 ViewModel → React Component
 *
 * 컴포넌트는 Api* 타입을 직접 import하지 않고 이 파일이 만든 ViewModel만 본다.
 * React는 이 단계에서 연결하지 않는다 — 순수 변환 함수만 모은다(lib/n5/coordinates.ts와
 * 같은 패턴, scripts/verify-n5-adapter.mjs로 Node에서 바로 검증할 수 있다).
 *
 * 1단계 조사에서 Adapter로 격리하기로 한 4개 항목을 여기서 흡수한다:
 *   - previewWidth      → getPreviewContainerWidth()
 *   - autoAdjust        → toAutoAdjustViewModel() (snake_case를 여기서만 다룬다)
 *   - renderedUrl===null → resolveSectionRenderState() (실패 단정 금지 — 이번 계약 키가 없는 응답의 기존 표시용)
 *   - renderInput·render → lib/n5/preview-state.ts (입력 상태·렌더 상태를 따로 판정) + syncPreviewWithBlocks() (지문 A/B)
 *   - error.code        → parseApiError()/isRevisionConflict() (열린 string 유지)
 */

// BLOCK_ROLE_LABELS는 런타임 값 import라 상대경로를 쓴다 — scripts/verify-n5-adapter.mjs가
// 이 파일을 plain Node(--experimental-strip-types)로 직접 불러오는데, '@/' alias는
// tsconfig paths 전용이라 Node 단독 실행에서는 풀리지 않는다(타입 전용 import는
// 실행 시 제거되므로 alias를 써도 무방하다 — 아래 BlockRole/Api* import 참고).
import { BLOCK_ROLE_LABELS, SECTION_WARNING_LABELS, getSignalLabel } from '../api/labels.ts';
import { VERDICT_BADGE_LABELS } from '../n3/verdict.ts';
import type { ApiSection } from '../api/n3-schema';
import type { BlockRole, BoundingBox } from '@/lib/api/types';
import type { N5TextAlign } from './layout-edit';
import type { TypesetServerStyle } from './typeset-rules';
import {
  compareFingerprintsAB,
  deriveSectionFingerprintA,
  resolvePreviewInputState,
  resolvePreviewRenderState,
  resolvePreviewSectionLabels,
  resolvePreviewSectionSemantic,
  toTypesetServerStyle,
  type FingerprintMatch,
  type PreviewInputState,
  type PreviewRenderState,
  type PreviewSectionLabels,
  type PreviewSectionSemantic,
  type SectionFingerprintA,
} from './preview-state.ts';
import { readStoredLayout, storedLayoutBox, storedLayoutFontScale, type N5StoredLayout } from './layout-adjust.ts';
import type {
  ApiBbox,
  ApiBlockPatchResponse,
  ApiConfirmRequest,
  ApiPreviewSection,
  ApiReviewPreview,
  ApiReviewSignal,
  ApiSectionBucket,
  ApiExcludedStage,
  ApiJobAsyncTaskItem,
  ApiSignalCode,
  ApiTextBlock,
} from '@/lib/api/n5-schema';

/* ------------------------------------------------------------------ *
 * 1. Signal → Badge
 * ------------------------------------------------------------------ */

/**
 * Badge 표시용 데이터. ReviewSignal DTO를 컴포넌트에 그대로 넘기지 않고 이 형태를
 * 거친다 — code에 대한 한글 라벨은 lib/api/labels.ts의 getSignalLabel()로 만든다.
 * 컴포넌트는 raw code를 직접 화면에 쓰지 않는다.
 */
export interface SignalBadge {
  code: ApiSignalCode;
  /** getSignalLabel()을 거친 한글 라벨. 컴포넌트는 code를 직접 화면에 쓰지 않는다. */
  label: string;
  reason: string | null;
  basisArticle: string | null;
  evidenceUrl: string | null;
  taskId: number | null;
  retryable: boolean | null;
}

export function toSignalBadges(signals: ApiReviewSignal[] | undefined): SignalBadge[] {
  if (!signals) return [];
  return signals.map((signal) => ({
    code: signal.code,
    label: getSignalLabel(signal.code),
    reason: signal.reason ?? null,
    basisArticle: signal.basisArticle ?? null,
    evidenceUrl: signal.evidenceUrl ?? null,
    taskId: signal.taskId ?? null,
    retryable: signal.retryable ?? null,
  }));
}

/**
 * 화면 표시용 톤(Figma Tag/Status Warning·Neutral). 서버 계약이 아니라 시각 매핑일 뿐이다 — 차단·확정 여부와 무관하다.
 * 계약에 severity가 없어, 금지 표현만 Warning으로 두고 나머지는 Neutral로 표시한다.
 */
export type SignalTone = 'warning' | 'neutral';

export function getSignalTone(code: ApiSignalCode): SignalTone {
  return code === 'prohibited_expression' ? 'warning' : 'neutral';
}

/** 재시도 대상 task. 재시도 가능 여부는 서버 값을 따른다 */
export interface RetryTarget {
  taskId: number;
  retryable: boolean;
}

/** 번역문 칸 안의 실패 문구로 표시하는 signal(Figma 1244:8238). 나머지는 번호 아래 [라벨] 사유 행으로 표시한다(1244:8031) */
const CELL_SIGNAL_CODES: ReadonlySet<ApiSignalCode> = new Set<ApiSignalCode>(['translation_failed', 'width_overflow']);

export function getSignalRows(badges: SignalBadge[]): SignalBadge[] {
  return badges.filter((badge) => !CELL_SIGNAL_CODES.has(badge.code));
}

export function hasWidthOverflowSignal(badges: SignalBadge[]): boolean {
  return badges.some((badge) => badge.code === 'width_overflow');
}

/** 번역 실패의 정본은 signals[].code=translation_failed다(blockStatus로 판단하지 않는다). taskId·retryable은 그 signal에 동봉된다 */
export function getTranslationFailure(badges: SignalBadge[]): { retry: RetryTarget | null } | null {
  const signal = badges.find((badge) => badge.code === 'translation_failed');
  if (!signal) return null;
  return { retry: signal.taskId != null ? { taskId: signal.taskId, retryable: signal.retryable === true } : null };
}

/* ------------------------------------------------------------------ *
 * 1-1. JOB-05 items → 검수 화면 실패 상태
 * ------------------------------------------------------------------ */

function toRetryTarget(item: ApiJobAsyncTaskItem): RetryTarget | null {
  return item.taskId != null ? { taskId: item.taskId, retryable: item.retryable === true } : null;
}

function findFailedItem(
  items: readonly ApiJobAsyncTaskItem[],
  taskType: ApiJobAsyncTaskItem['taskType'],
  unitType: ApiJobAsyncTaskItem['unitType'],
  unitId: number,
): ApiJobAsyncTaskItem | undefined {
  return items.find(
    (item) => item.taskType === taskType && item.unitType === unitType && item.unitId === unitId && item.status === 'failed',
  );
}

export interface BlockTaskFailures {
  /** 검사(verify) 실패 — 칸의 "검사하지 못했습니다" */
  verifyFailed: boolean;
  /** 블록 재렌더(render · text_block) 실패 — 칸의 "미리보기를 갱신하지 못했습니다" */
  previewFailure: RetryTarget | null;
}

export function getBlockTaskFailures(items: readonly ApiJobAsyncTaskItem[], blockId: number): BlockTaskFailures {
  const preview = findFailedItem(items, 'render', 'text_block', blockId);
  return {
    verifyFailed: findFailedItem(items, 'verify', 'text_block', blockId) != null,
    previewFailure: preview ? toRetryTarget(preview) : null,
  };
}

export interface SectionStatusViewModel {
  /** 실행 실패 단계. JOB-05 items 기준(섹션 렌더 실패는 warningBadge로 판별하지 않는다) */
  failedStages: ('render' | 'inpaint')[];
  /** 렌더 실패 task. 인페인팅은 재시도 계약(translate·render만)이 없어 대상이 아니다 */
  renderRetry: RetryTarget | null;
  /** N3에서 사용자가 되살린 섹션(Section.exclusionReason) */
  restoredInN3: boolean;
  /** 판정 배지 문구(Section.verdicts[].verdictType) */
  verdictLabels: string[];
  /** Section.warningBadge 문구 */
  warningLabel: string | null;
  /** PreviewSection.signals */
  signals: SignalBadge[];
  /** 실패가 아닌 진행·제외 상태 문구(렌더 대기 중 · 렌더링 중 · 제외된 섹션). renderedUrl=null만으로 실패로 보지 않는다 */
  progressLabel: string | null;
  /** 미리보기 안내(최신 미리보기 아님 · 미리보기 없음 · 미리보기 입력 오류 · 최신 내용을 불러오는 중). 이번 계약 키가 없으면 null */
  previewNotice: string | null;
  /** 입력 오류 원래 코드 — 화면 문구에는 쓰지 않고 개발·테스트 확인용 data 속성에만 둔다 */
  previewInputErrorCode: string | null;
  /** N5 미리보기 의미 상태(preview-state.ts resolvePreviewSectionSemantic) — 디자인 연결용. 이번 계약 키가 없으면 null */
  previewState: PreviewSectionSemantic | null;
}

function getSectionProgressLabel(
  sectionId: number,
  items: readonly ApiJobAsyncTaskItem[],
  renderStatus: SectionRenderState['status'] | undefined,
  renderFailed: boolean,
): string | null {
  if (renderStatus === 'excluded') return '제외된 섹션';
  if (renderStatus !== 'unresolved' || renderFailed) return null;
  const isRunning = items.some(
    (item) => item.taskType === 'render' && item.unitType === 'section' && item.unitId === sectionId && item.status === 'running',
  );
  return isRunning ? '렌더링 중' : '렌더 대기 중';
}

/** /preview 렌더 상태에서 온 섹션 상태 입력. 이번 계약 키가 없는(legacy) 섹션이면 넘기지 않는다 */
export interface PreviewSectionStatusInput {
  semantic: PreviewSectionSemantic;
  labels: PreviewSectionLabels;
  input: PreviewInputState;
}

/** 섹션의 입력·렌더 상태 → 의미 상태·임시 문구. 이번 계약 키가 없거나 조합이 계약 밖이면 undefined(기존 renderedUrl 기준 표시) */
export function toPreviewStatusInput(
  section: Pick<PreviewSectionViewModel, 'input' | 'renderState'>,
  match: FingerprintMatch,
): PreviewSectionStatusInput | undefined {
  const semantic = resolvePreviewSectionSemantic(section.input, section.renderState, match);
  if (!semantic) return undefined;
  return { semantic, labels: resolvePreviewSectionLabels(semantic), input: section.input };
}

export function buildSectionStatus(
  sectionId: number,
  signals: SignalBadge[],
  items: readonly ApiJobAsyncTaskItem[],
  section: Pick<ApiSection, 'exclusionReason' | 'verdicts' | 'warningBadge'> | undefined,
  renderStatus?: SectionRenderState['status'],
  preview?: PreviewSectionStatusInput,
): SectionStatusViewModel {
  const render = findFailedItem(items, 'render', 'section', sectionId);
  const inpaint = findFailedItem(items, 'inpaint', 'section', sectionId);
  const labels = (section?.verdicts ?? []).flatMap((verdict) => (verdict.verdictType ? [VERDICT_BADGE_LABELS[verdict.verdictType]] : []));
  // /tasks 실패와 /preview 시도 실패는 같은 「실행 실패 · 렌더링」 행 하나로 보인다(경고를 두 번 내지 않는다)
  // 재렌더 실패(failed·update-failed)의 다시 시도 대상은 기존 task retry 계약(attempt.taskId·retryable)이다
  const attemptRetry = preview?.labels.renderFailed === true ? preview.semantic.retry : null;
  const attemptFailed = attemptRetry != null;
  const renderRetry = render ? toRetryTarget(render) : attemptRetry;
  const isLegacy = preview == null || renderStatus === 'excluded';
  return {
    failedStages: [...(render || attemptFailed ? (['render'] as const) : []), ...(inpaint ? (['inpaint'] as const) : [])],
    renderRetry,
    restoredInN3: section?.exclusionReason === 'restored_by_user',
    verdictLabels: [...new Set(labels)],
    warningLabel: section?.warningBadge ? SECTION_WARNING_LABELS[section.warningBadge] : null,
    signals,
    progressLabel: isLegacy ? getSectionProgressLabel(sectionId, items, renderStatus, render != null) : preview.labels.progressLabel,
    previewNotice: isLegacy ? null : preview.labels.notice,
    previewInputErrorCode: isLegacy ? null : preview.input.errorCode,
    previewState: isLegacy ? null : preview.semantic,
  };
}

/** Figma 1244:8444 — 상태 행 수(signal 사유는 패널의 block 목록 위에만 그린다). 실패 / 되살림·판정 배지 / 품질 */
export function getSectionStatusRowCount(status: SectionStatusViewModel | undefined): number {
  if (!status) return 0;
  return (
    (status.failedStages.length > 0 ? 1 : 0) +
    (status.restoredInN3 || status.verdictLabels.length > 0 ? 1 : 0) +
    (status.warningLabel != null ? 1 : 0) +
    (status.previewNotice != null ? 1 : 0)
  );
}

/**
 * 좌측 canvas에서 section 이미지 위에 차지하는 높이(Figma 1244:8444 Frame 259). 태그 28 + 간격 16 + 행(26, 간격 4) +
 * 이미지까지 4 — 세 행이면 134다. 상태가 없으면 0(정상 화면과 같다).
 * 미리보기 안내(previewNotice)는 저장할 때마다 생겼다 사라져 viewer 를 밀어내므로 이 공간에 넣지 않는다 — canvas 에서는
 * section 위 absolute 자리(N5PreviewStatusSlot)에 보인다. 우측 패널의 행 수(getSectionStatusRowCount)는 그대로다.
 */
export function getSectionCanvasHeaderHeight(status: SectionStatusViewModel | undefined): number {
  const rows = getSectionStatusRowCount(status) - (status?.previewNotice != null ? 1 : 0);
  return rows === 0 ? 0 : 28 + 16 + rows * 26 + (rows - 1) * 4 + 4;
}

export function hasSectionStatus(status: SectionStatusViewModel | undefined): boolean {
  if (!status) return false;
  return (
    status.failedStages.length > 0 ||
    status.restoredInN3 ||
    status.verdictLabels.length > 0 ||
    status.warningLabel != null ||
    status.signals.length > 0 ||
    status.progressLabel != null ||
    status.previewNotice != null
  );
}

/* ------------------------------------------------------------------ *
 * 2. autoAdjust 격리
 *
 * 6단계 재확인: 최신 openapi.yaml은 AutoAdjust를 fontScale/lineBreakApplied
 * (camelCase)로 응답한다고 명시한다 — "DB JSONB(font_scale·line_break_applied)를
 * 응답 시 fontScale·lineBreakApplied로 매핑한다(직렬화 계층·저장값 불변·10차 #A)".
 * 1~4단계 당시 openapi.yaml에는 이 필드가 snake_case로 적혀 있었고(스펙
 * 오탈자인지 실제 계약인지 불확실하다고 그때 보고했었다) — 이번에 다시 받은
 * 최신 스펙에서 camelCase로 확정된 것을 확인해 반영한다. mock(n5-fixtures.ts,
 * msw/handlers.ts)과 검증 스크립트도 함께 camelCase로 맞췄다.
 * ------------------------------------------------------------------ */

export interface AutoAdjustViewModel {
  /**
   * 조정이 실제로 일어났는지. fontScale===1 && !lineBreakApplied면 "조정 시도는
   * 했으나 변화 없음"과 "조정 자체가 없었음"을 구분할 수 없으므로(lib/api/types.ts의
   * 기존 AutoAdjust 주석과 같은 이유) applied는 fontScale!==1 || lineBreakApplied로 계산한다.
   */
  applied: boolean;
  fontScale: number;
  lineBreakApplied: boolean;
}

const AUTO_ADJUST_DEFAULT: AutoAdjustViewModel = {
  applied: false,
  fontScale: 1,
  lineBreakApplied: false,
};

export function toAutoAdjustViewModel(
  autoAdjust: ApiTextBlock['autoAdjust'],
): AutoAdjustViewModel {
  if (!autoAdjust) return AUTO_ADJUST_DEFAULT;
  const fontScale = autoAdjust.fontScale ?? 1;
  const lineBreakApplied = autoAdjust.lineBreakApplied ?? false;
  return {
    applied: fontScale !== 1 || lineBreakApplied,
    fontScale,
    lineBreakApplied,
  };
}

/* ------------------------------------------------------------------ *
 * 3. TextBlock → BlockViewModel
 * ------------------------------------------------------------------ */

export interface BlockViewModel {
  id: number;
  sectionId: number;
  role: BlockRole;
  roleLabel: string;
  sourceText: string;
  translatedText: string;
  /**
   * 글자 정렬([+][-] 기준점·조판). /preview renderInput style.align 에서 온다(syncPreviewWithBlocks, 지문 A=B 일 때만).
   * 없으면 left 로 본다. text 내용이나 bbox 위치로 추측하지 않는다.
   */
  textAlign?: N5TextAlign;
  /** 지문 A(/blocks sectionInputFingerprint). 키가 없거나 null 이면 null — 비교하지 않는다 */
  sectionInputFingerprint: string | null;
  /** 같은 저장 입력(A=B)으로 확인된 /preview renderInput 블록. 없으면 null — 서버 style 을 쓰지 않는다 */
  renderBinding: N5RenderBinding | null;
  /**
   * 서버 넘침(getServerOverflow) — 소속 섹션의 최신 결과(isCurrent=true) overflow 만 값이다. 최신이 아니면 null(표시하지 않는다).
   * 'legacy' = 이번 계약 키가 없는 응답 — 기존 signals(width_overflow) 표시를 쓴다. FE DOM 측정값은 여기 들어오지 않는다.
   */
  serverOverflow: boolean | null | 'legacy';
  /** isExcluded(API 값, role=product_label 파생)로부터 editable = !isExcluded로 정리한다.
   *  role==='product_label' 여부를 FE에서 다시 계산하지 않는다 — isExcluded가 정본이다. */
  editable: boolean;
  revision: number;
  /** 원본 bbox — 셀러 조정으로 바뀌지 않는다 */
  bbox: BoundingBox | null;
  /** /blocks layoutAdjust(저장된 셀러 조정). 키가 없는 응답(서버 구현 전)은 'missing' — null(조정 없음)과 섞지 않는다 */
  storedLayout: N5StoredLayout;
  displayTop: number | null;
  badges: SignalBadge[];
  autoAdjust: AutoAdjustViewModel;
}

/**
 * ApiBbox{x,y,w,h} → 기존 좌표 유틸(lib/n5/coordinates.ts)이 쓰는
 * BoundingBox{x,y,width,height}로 바꾸는 단일 경계. bbox를 다루는 곳이 여러
 * 군데라도 이 변환은 여기 한 곳에서만 하고, 그 아래(coordinates.ts, 컴포넌트)는
 * 전부 BoundingBox만 본다 — 반복 변환하지 않는다.
 */
function apiBboxToBoundingBox(bbox: ApiBbox): BoundingBox {
  return { x: bbox.x ?? 0, y: bbox.y ?? 0, width: bbox.w ?? 0, height: bbox.h ?? 0 };
}

/**
 * TextBlock의 핵심 식별 필드(id/sectionId/role/revision)는 OpenAPI 스펙상 `required`로
 * 선언돼 있지 않다(1단계 조사에서 확인된 계약 공백). 값이 실제로 비어 있으면 임의
 * 기본값으로 조용히 채우지 않고 여기서 명시적으로 던진다 — 예를 들어 role을 'body'로
 * 잘못 채우면 price/caution 같은 규제 민감 블록을 오분류하게 된다.
 */
export function toBlockViewModel(dto: ApiTextBlock): BlockViewModel {
  if (dto.id == null) throw new Error('N5 Adapter: TextBlock.id가 없습니다');
  if (dto.sectionId == null) throw new Error('N5 Adapter: TextBlock.sectionId가 없습니다');
  if (dto.role == null) throw new Error('N5 Adapter: TextBlock.role이 없습니다');
  if (dto.revision == null) throw new Error('N5 Adapter: TextBlock.revision이 없습니다');

  const isExcluded = dto.isExcluded ?? false;

  return {
    id: dto.id,
    sectionId: dto.sectionId,
    role: dto.role,
    roleLabel: BLOCK_ROLE_LABELS[dto.role],
    sourceText: dto.sourceKo ?? '',
    translatedText: dto.trans1 ?? '',
    editable: !isExcluded,
    revision: dto.revision,
    bbox: dto.bbox ? apiBboxToBoundingBox(dto.bbox) : null,
    storedLayout: readStoredLayout(dto),
    displayTop: dto.displayTop ?? null,
    badges: toSignalBadges(dto.signals),
    autoAdjust: toAutoAdjustViewModel(dto.autoAdjust),
    sectionInputFingerprint: dto.sectionInputFingerprint ?? null,
    renderBinding: null,
    serverOverflow: 'legacy',
  };
}

/* ------------------------------------------------------------------ *
 * 4. previewWidth 격리
 * ------------------------------------------------------------------ */

/**
 * ReviewPreview.previewWidth는 v3.4.1 시점 FE 메모 기준으로는 "계약에 없음"이라고
 * 알려졌으나, 실제 v3.4.2 openapi.yaml에는 top-level 필드로 존재한다(1단계 조사 A).
 * 계약이 버전 사이에 흔들린 이력이 있으므로 컴포넌트가 preview.previewWidth를 직접
 * 읽지 않고 이 함수 하나만 거치게 한다 — previewWidth가 또 사라지거나 이름이 바뀌어도
 * 고칠 곳은 여기 하나뿐이다. 값이 없으면 maxOriginalWidth * scale로 대체 계산한다.
 */
export function getPreviewContainerWidth(preview: ApiReviewPreview): number {
  if (typeof preview.previewWidth === 'number') return preview.previewWidth;
  const maxOriginalWidth = preview.maxOriginalWidth ?? 0;
  const scale = preview.scale ?? 1;
  return maxOriginalWidth * scale;
}

/* ------------------------------------------------------------------ *
 * 5. renderedUrl===null 격리 — 렌더 전 / 제외 / 실패(또는 대기)를 구분한다.
 * ------------------------------------------------------------------ */

export type SectionRenderState =
  | { status: 'ready'; url: string }
  | { status: 'excluded' }
  /**
   * renderedUrl이 null이고 제외 상태도 아닌 경우. OpenAPI description은 null이
   * "렌더 전/실패/제외" 셋 중 하나라고만 밝히고 있어(1단계 조사 C), 제외가 아니라면
   * 남은 두 경우(렌더 전 vs 실패)를 ReviewPreview 한 응답만으로는 구분할 수 없다.
   * 실패로 단정하지 않고 'unresolved'로 남긴다 — 실제 구분은 GET /tasks 상태와
   * 함께 봐야 하며, 그 연결은 3단계(React 연결) 이후 범위다.
   */
  | { status: 'unresolved' };

export function resolveSectionRenderState(section: ApiPreviewSection): SectionRenderState {
  const isExcluded = section.bucket === 'exclude' || section.excludedStage != null;
  if (isExcluded) return { status: 'excluded' };
  if (section.renderedUrl) return { status: 'ready', url: section.renderedUrl };
  return { status: 'unresolved' };
}

/* ------------------------------------------------------------------ *
 * 6. ReviewPreview/PreviewSection → PreviewViewModel
 *
 * 컴포넌트(N5Viewport)는 ApiReviewPreview/ApiPreviewSection을 직접 소비하지
 * 않는다 — previewWidth/renderedUrl null 격리(위 4·5)를 포함해 이 ViewModel만
 * 본다. width/height/displayTop은 원본(un-scaled) px 그대로 둔다 — scale을
 * 곱하는 시점은 렌더링 시점(N5Viewport)의 몫이다(lib/n5/coordinates.ts의
 * getBlockDisplayRect가 scale을 인자로 받는 것과 같은 이유: 이 값들이 zoom과
 * 무관한 "원본 canvas 크기" 계산의 입력이 되기 때문).
 * ------------------------------------------------------------------ */

export interface PreviewSectionViewModel {
  id: number;
  sectionOrder: number;
  sourceImageId: number;
  bucket: ApiSectionBucket;
  excludedStage: ApiExcludedStage | null;
  /** 원본(un-scaled) px */
  width: number;
  /** 원본(un-scaled) px */
  height: number;
  /** 원본(un-scaled) px, include section만 누적된 서버 계산값 */
  displayTop: number;
  /** 번역 전(원문) 이미지. renderedUrl과 달리 "null=제외/렌더전" 같은 별도 의미가
   *  스펙에 명시돼 있지 않아 render 상태 판단에는 쓰지 않는다 — 있는 그대로 전달한다. */
  originalUrl: string | null;
  /** 서버 결과 이미지(이전 결과 포함). 최신인지는 renderState.kind 로 본다 */
  renderedUrl: string | null;
  /** renderedUrl 기준 기존 판정 — 제외 판정과 이번 계약 키가 없는(legacy) 응답의 표시에만 쓴다 */
  render: SectionRenderState;
  badges: SignalBadge[];
  /** 섹션 revision(Section.revision과 같음) — SEC-03 섹션 제외·복원 요청용. 키가 없으면 null */
  revision: number | null;
  /** 입력 상태(renderInput·inputFingerprint·inputError) */
  input: PreviewInputState;
  /** 렌더 상태(render.attempt·result·isCurrent) — 입력 상태와 따로 판정한다 */
  renderState: PreviewRenderState;
  /** renderInput.section.background — 글자 없는 바탕. source(inpaint/original)는 그대로 둔다 */
  background: { url: string; source: 'inpaint' | 'original'; sha256: string | null } | null;
  /** renderInput.blocks(렌더 대상만). style 형식이 계약 밖이면 그 블록 style 은 null */
  renderBlocks: N5RenderInputBlock[];
}

/** /preview renderInput 블록 하나 — FE 내부 모델. box 는 섹션 로컬 원본 px 그대로 */
export interface N5RenderInputBlock {
  blockId: number;
  revision: number;
  text: string;
  box: BoundingBox;
  style: TypesetServerStyle | null;
}

/** BlockViewModel 에 붙는 저장 입력(renderInput). 세션 local 편집값은 여기 두지 않고 위에 덮는다 */
export type N5RenderBinding = Omit<N5RenderInputBlock, 'style' | 'blockId'> & { style: TypesetServerStyle };

export interface PreviewViewModel {
  /** getPreviewContainerWidth()를 거친 값 — previewWidth 원본 필드를 컴포넌트에 노출하지 않는다 */
  containerWidth: number;
  scale: number;
  sections: PreviewSectionViewModel[];
  /** 서버 렌더러(opaque — 파싱하지 않고 같은지만 본다). 키가 없으면 null */
  renderer: { rendererId: string; bundleId: string | null } | null;
}

/**
 * PreviewSection의 핵심 식별/판단 필드(id/sourceImageId/bucket)가 비어 있으면
 * toBlockViewModel과 같은 이유로 조용히 기본값을 채우지 않고 던진다 — bucket을
 * 'include'로 잘못 기본값 처리하면 제외된 섹션이 일반 섹션처럼 보일 수 있다.
 */
function toPreviewSectionViewModel(section: ApiPreviewSection, renderer: ApiReviewPreview['renderer'] | undefined): PreviewSectionViewModel {
  if (section.id == null) throw new Error('N5 Adapter: PreviewSection.id가 없습니다');
  if (section.sourceImageId == null) throw new Error('N5 Adapter: PreviewSection.sourceImageId가 없습니다');
  if (section.bucket == null) throw new Error('N5 Adapter: PreviewSection.bucket이 없습니다');
  const input = resolvePreviewInputState(section);
  const renderInput = input.kind === 'ready' ? section.renderInput : null;

  return {
    id: section.id,
    sectionOrder: section.sectionOrder ?? 0,
    sourceImageId: section.sourceImageId,
    bucket: section.bucket,
    excludedStage: section.excludedStage ?? null,
    width: section.width ?? 0,
    height: section.height ?? 0,
    displayTop: section.displayTop ?? 0,
    originalUrl: section.originalUrl ?? null,
    renderedUrl: section.renderedUrl ?? null,
    render: resolveSectionRenderState(section),
    badges: toSignalBadges(section.signals),
    revision: typeof section.revision === 'number' ? section.revision : null,
    input,
    renderState: resolvePreviewRenderState(section, renderer, input.kind),
    background: renderInput
      ? {
          url: renderInput.section.background.url,
          source: renderInput.section.background.source,
          sha256: renderInput.section.background.sha256 ?? null,
        }
      : null,
    renderBlocks: (renderInput?.blocks ?? []).map((block) => ({
      blockId: block.blockId,
      revision: block.revision,
      text: block.text,
      box: apiBboxToBoundingBox(block.box),
      style: toTypesetServerStyle(block.style),
    })),
  };
}

export function toPreviewViewModel(preview: ApiReviewPreview): PreviewViewModel {
  const renderer = 'renderer' in preview && preview.renderer ? preview.renderer : undefined;
  return {
    containerWidth: getPreviewContainerWidth(preview),
    scale: preview.scale ?? 1,
    renderer: renderer ? { rendererId: renderer.rendererId, bundleId: renderer.bundleId ?? null } : null,
    sections: (preview.sections ?? [])
      .map((section) => toPreviewSectionViewModel(section, renderer))
      // job 전체 표시 순서 = sectionOrder 오름차순 (buildSectionSlices의 기존 규칙과 동일)
      .sort((a, b) => a.sectionOrder - b.sectionOrder),
  };
}

/** 섹션별 표(/blocks)·뷰어(/preview) 입력 일치 */
export interface SectionInputSync {
  a: SectionFingerprintA;
  match: FingerprintMatch;
  /** renderInput 블록 style 이 모두 계약 형식인지. 아니면 그 섹션은 HTML 조판을 만들지 않는다 */
  stylesValid: boolean;
  /** 같은 저장 입력으로 연결했는지(정상 입력 + A=B + style 정상) */
  bound: boolean;
}

/**
 * 지문 A(/blocks)와 B(/preview)가 같은 섹션만 renderInput 을 블록에 연결한다(textAlign·서버 style·적용 박스).
 * 같은 섹션의 A 가 서로 다르면 inconsistent, null 은 비교하지 않는다 — 어느 쪽도 하나를 골라 억지로 잇지 않는다.
 */
export function syncPreviewWithBlocks(
  blocks: BlockViewModel[],
  preview: PreviewViewModel,
): { blocks: BlockViewModel[]; syncBySection: Map<number, SectionInputSync> } {
  const fingerprintsBySection = new Map<number, (string | null)[]>();
  for (const block of blocks) {
    const list = fingerprintsBySection.get(block.sectionId);
    if (list) list.push(block.sectionInputFingerprint);
    else fingerprintsBySection.set(block.sectionId, [block.sectionInputFingerprint]);
  }
  const syncBySection = new Map<number, SectionInputSync>();
  const bindings = new Map<number, N5RenderBinding>();
  for (const section of preview.sections) {
    const a = deriveSectionFingerprintA(fingerprintsBySection.get(section.id) ?? []);
    const match = compareFingerprintsAB(a, section.input.fingerprint);
    const stylesValid = section.renderBlocks.every((block) => block.style !== null);
    const bound = section.input.kind === 'ready' && match === 'match' && stylesValid;
    syncBySection.set(section.id, { a, match, stylesValid, bound });
    if (!bound) continue;
    for (const { blockId, revision, text, box, style } of section.renderBlocks) {
      if (style) bindings.set(blockId, { revision, text, box, style });
    }
  }
  const sectionById = new Map(preview.sections.map((section) => [section.id, section]));
  return {
    blocks: blocks.map((block) => {
      const binding = bindings.get(block.id);
      const serverOverflow = getServerOverflow(sectionById.get(block.sectionId), block.id);
      return binding ? { ...block, renderBinding: binding, textAlign: binding.style.align, serverOverflow } : { ...block, serverOverflow };
    }),
    syncBySection,
  };
}

/**
 * 「번역 후」의 기준 박스 — 저장 입력(renderInput 적용 박스, 지문 A=B) > /blocks 저장 조정(layoutAdjust.box) > 원본 bbox.
 * 세션 초안은 호출부가 위에 덮는다. 원본 bbox 자체는 덮어쓰지 않는다.
 */
export function getTranslatedBaseBox(block: Pick<BlockViewModel, 'bbox' | 'renderBinding'> & { storedLayout?: N5StoredLayout }): BoundingBox | null {
  return block.renderBinding?.box ?? (block.storedLayout ? storedLayoutBox(block.storedLayout) : null) ?? block.bbox;
}

/** 세션 초안이 없을 때의 절대 글자 배율 — 저장 입력의 fontScale > /blocks layoutAdjust.fontScale > 1(null = 적용 배율 1.0) */
export function getBaseFontScale(block: Pick<BlockViewModel, 'renderBinding'> & { storedLayout?: N5StoredLayout }): number {
  return block.renderBinding?.style.fontScale ?? (block.storedLayout ? storedLayoutFontScale(block.storedLayout) : null) ?? 1;
}

/**
 * 서버 넘침 — 최신 결과(isCurrent=true)의 overflow 만 정본이다. 최신이 아니면 null(쓰지 않는다).
 * 이번 계약 키가 없는(legacy) 섹션이면 'legacy' — 호출부가 기존 signal 기준 표시를 쓴다.
 */
export function getServerOverflow(section: Pick<PreviewSectionViewModel, 'renderState'> | undefined, blockId: number): boolean | null | 'legacy' {
  if (!section || section.renderState.kind === 'invalid-contract') return 'legacy';
  const map = section.renderState.overflowByBlockId;
  return map ? map.get(blockId) === true : null;
}

/**
 * 6단계 — POST /jobs/{jobId}/confirm은 "전 섹션 제외 차단"이면 서버가 409
 * ALL_SECTIONS_EXCLUDED를 던진다. 이미 로드된 sections로 같은 조건을 미리
 * 계산해 두면 실패할 게 확실한 요청을 보내지 않고 버튼을 선제적으로 막을 수
 * 있다 — 단, 이건 서버가 실제로 검사하는 것과 동일한 규칙(최소 1개 include
 * section)을 그대로 옮긴 것이지 FE가 새로 지어낸 조건이 아니다. sections가
 * 비어 있으면(아직 로드 전) false를 반환한다 — 로드 전 상태를 "전부 제외"로
 * 단정하지 않는다.
 */
export function areAllSectionsExcluded(sections: PreviewSectionViewModel[]): boolean {
  if (sections.length === 0) return false;
  return sections.every((section) => section.bucket === 'exclude');
}

/**
 * N5 [되돌리기] 가능 여부. SEC-03 계약: "N5에서 excludedStage=N3 조작 시 409 INVALID_STATE" —
 * 서버가 거절하는 바로 그 조건만 옮긴다(새 판단 규칙을 만들지 않는다). CFM-03 계약상
 * N3 제외 섹션은 프리뷰에 오지 않지만, 오더라도 N5 에서 포함으로 바꾸는 버튼을 내지 않는다.
 */
export function canRestoreSectionInN5(section: Pick<PreviewSectionViewModel, 'render' | 'excludedStage'>): boolean {
  return section.render.status === 'excluded' && section.excludedStage !== 'N3';
}

/* ------------------------------------------------------------------ *
 * 7. POST /jobs/{jobId}/confirm — acknowledgedWarnings 구성
 *
 * ConfirmRequest.acknowledgedWarnings는 "개수가 아니라 식별자"({blockId, code}
 * 목록)이고, 서버의 현재 미해결 경고 집합과 정확히 같아야 한다(다르면 409
 * INVALID_STATE) — v3.4.2 openapi.yaml, ConfirmRequest.description. 이 앱에
 * signal별 "개별 확인" UI가 없으므로(Figma에도 없음), 저장하러 가기를 누르는
 * 행위 자체를 "지금 화면에 보이는 signal을 전부 확인했다"는 의미로 다룬다 —
 * 즉 현재 로드된 block 목록의 signals를 전부 모아 보낸다. FE가 판단을 새로
 * 만드는 게 아니라, 이미 화면에 표시 중인 badge(toSignalBadges 결과)를 그대로
 * 옮기는 것뿐이다.
 * ------------------------------------------------------------------ */

export function buildAcknowledgedWarnings(
  blocks: BlockViewModel[],
): NonNullable<ApiConfirmRequest['acknowledgedWarnings']> {
  return blocks.flatMap((block) => block.badges.map((badge) => ({ blockId: block.id, code: badge.code })));
}

/* ------------------------------------------------------------------ *
 * 8. error.code 격리 — 열린 string으로 유지하되 REVISION_CONFLICT 등은 구분
 * 가능하게 한다.
 *
 * 6단계 확인: 최신 openapi.yaml은 error.code를 15종 닫힌 enum으로 명시한다
 * (1단계 조사 당시엔 "TODO, 6종만 확인" 상태였다 — 그 사이 스펙이 확정됨).
 * 그래도 이 타입은 여전히 string으로 열어 둔다 — 스펙이 실제로 닫혔다고 해서
 * 이 Adapter의 서명을 바로 좁히는 건 이번 6단계 범위(confirm 연결)를 넘는
 * 별도 정리이고, 문자열 비교(isRevisionConflict 등)는 어느 쪽이든 그대로
 * 동작한다. 닫힌 15종 값: VALIDATION_ERROR, UNAUTHORIZED, TOKEN_EXPIRED,
 * NOT_FOUND, DUPLICATE, UNSUPPORTED_FORMAT, FILE_TOO_LARGE, INVALID_STATE,
 * ALL_SECTIONS_EXCLUDED, RETRY_NOT_ALLOWED, REVISION_CONFLICT,
 * CSV_SCHEMA_MISMATCH, RATE_LIMITED, INTERNAL_ERROR, SERVICE_UNAVAILABLE.
 * ------------------------------------------------------------------ */

/** N5 상단 정보(Figma 「N3 섹션 상단」 1507:21672). 실제 값이 있는 항목만 담고, 없으면 빈 값으로 둔다 */
export interface JobMetaViewModel {
  countryLabel: string | null;
  regulatoryClassLabel: string | null;
  categoryLabel: string | null;
}

export function toJobMetaViewModel(
  job: { targetCountry?: string | null; regulatoryClass?: string | null; categoryId?: number | null },
  countries: readonly { code?: string; name?: string }[],
  categories: readonly { id?: number; name?: string }[],
  regulatoryClassLabels: Readonly<Record<string, string>>,
): JobMetaViewModel {
  return {
    countryLabel: countries.find((country) => country.code === job.targetCountry)?.name ?? null,
    regulatoryClassLabel: job.regulatoryClass ? (regulatoryClassLabels[job.regulatoryClass] ?? null) : null,
    categoryLabel: categories.find((category) => category.id === job.categoryId)?.name ?? null,
  };
}

export interface ApiErrorInfo {
  /**
   * 열린 string으로 유지한다 — 위 코멘트 참고.
   */
  code: string;
  message: string;
  retryable: boolean;
  details: Record<string, unknown> | null;
  traceId: string;
}

// isRevisionConflict 내부에서만 쓴다 — 외부에서 import하는 곳이 없어 export하지 않는다.
const REVISION_CONFLICT_CODE = 'REVISION_CONFLICT';

/** 응답 body가 공통 Error 래퍼({error:{...}}) 형태가 아니면 null을 반환한다. */
export function parseApiError(body: unknown): ApiErrorInfo | null {
  if (!body || typeof body !== 'object' || !('error' in body)) return null;
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== 'object') return null;
  const e = err as Record<string, unknown>;
  if (
    typeof e.code !== 'string' ||
    typeof e.message !== 'string' ||
    typeof e.retryable !== 'boolean' ||
    typeof e.traceId !== 'string'
  ) {
    return null;
  }
  return {
    code: e.code,
    message: e.message,
    retryable: e.retryable,
    details: e.details && typeof e.details === 'object' ? (e.details as Record<string, unknown>) : null,
    traceId: e.traceId,
  };
}

export function isRevisionConflict(error: ApiErrorInfo): boolean {
  return error.code === REVISION_CONFLICT_CODE;
}

/**
 * REVISION_CONFLICT 응답의 error.details.current를 최신 TextBlock으로 꺼낸다.
 * REVISION_CONFLICT가 아니거나 details.current 형태가 아니면 null.
 */
export function getRevisionConflictLatestBlock(error: ApiErrorInfo): ApiTextBlock | null {
  if (!isRevisionConflict(error)) return null;
  const current = error.details?.current;
  if (!current || typeof current !== 'object') return null;
  return current as ApiTextBlock;
}

/**
 * BlockPatchResponse에서 rerenderTaskId를 꺼낸다(required · number|null). null 은 "이 요청이 새 task 를 만들지 않음"만 뜻한다 —
 * 렌더 완료·no-op·실패를 뜻하지 않으며, 진행 중인 시도는 /preview render.attempt 로 따로 추적한다.
 */
export function getRerenderTaskId(response: ApiBlockPatchResponse): number | null {
  return response.rerenderTaskId ?? null;
}

/** POST /jobs/{jobId}/confirm — 전 섹션 제외로 거절된 응답인지 */
export function isAllSectionsExcludedError(error: ApiErrorInfo): boolean {
  return error.code === 'ALL_SECTIONS_EXCLUDED';
}

/** POST /jobs/{jobId}/confirm — acknowledgedWarnings 불일치로 거절된 응답인지 */
export function isInvalidStateError(error: ApiErrorInfo): boolean {
  return error.code === 'INVALID_STATE';
}

/**
 * INVALID_STATE 응답의 "현재 경고 목록"을 꺼낸다. 정확한 details 키 이름은
 * openapi.yaml에 명시돼 있지 않다(ConfirmRequest.description은 "+현재 경고
 * 목록"이라고만 적혀 있다) — details.warnings를 시도하되, 형태가 다르면
 * null을 반환해 호출부가 임의로 지어낸 목록을 쓰지 않게 한다.
 */
export function getInvalidStateWarnings(
  error: ApiErrorInfo,
): { blockId: number; code: string }[] | null {
  if (!isInvalidStateError(error)) return null;
  const warnings = error.details?.warnings;
  return Array.isArray(warnings) ? (warnings as { blockId: number; code: string }[]) : null;
}
