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
 *   - renderedUrl===null → resolveSectionRenderState() (실패 단정 금지)
 *   - error.code        → parseApiError()/isRevisionConflict() (열린 string 유지)
 */

// BLOCK_ROLE_LABELS는 런타임 값 import라 상대경로를 쓴다 — scripts/verify-n5-adapter.mjs가
// 이 파일을 plain Node(--experimental-strip-types)로 직접 불러오는데, '@/' alias는
// tsconfig paths 전용이라 Node 단독 실행에서는 풀리지 않는다(타입 전용 import는
// 실행 시 제거되므로 alias를 써도 무방하다 — 아래 BlockRole/Api* import 참고).
import { BLOCK_ROLE_LABELS, getSignalLabel } from '../api/labels.ts';
import type { BlockRole, BoundingBox } from '@/lib/api/types';
import type {
  ApiBbox,
  ApiBlockPatchResponse,
  ApiConfirmRequest,
  ApiPreviewSection,
  ApiReviewPreview,
  ApiReviewSignal,
  ApiSectionBucket,
  ApiExcludedStage,
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
  /** isExcluded(API 값, role=product_label 파생)로부터 editable = !isExcluded로 정리한다.
   *  role==='product_label' 여부를 FE에서 다시 계산하지 않는다 — isExcluded가 정본이다. */
  editable: boolean;
  revision: number;
  bbox: BoundingBox | null;
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
    displayTop: dto.displayTop ?? null,
    badges: toSignalBadges(dto.signals),
    autoAdjust: toAutoAdjustViewModel(dto.autoAdjust),
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
  render: SectionRenderState;
  badges: SignalBadge[];
}

export interface PreviewViewModel {
  /** getPreviewContainerWidth()를 거친 값 — previewWidth 원본 필드를 컴포넌트에 노출하지 않는다 */
  containerWidth: number;
  scale: number;
  sections: PreviewSectionViewModel[];
}

/**
 * PreviewSection의 핵심 식별/판단 필드(id/sourceImageId/bucket)가 비어 있으면
 * toBlockViewModel과 같은 이유로 조용히 기본값을 채우지 않고 던진다 — bucket을
 * 'include'로 잘못 기본값 처리하면 제외된 섹션이 일반 섹션처럼 보일 수 있다.
 */
function toPreviewSectionViewModel(section: ApiPreviewSection): PreviewSectionViewModel {
  if (section.id == null) throw new Error('N5 Adapter: PreviewSection.id가 없습니다');
  if (section.sourceImageId == null) throw new Error('N5 Adapter: PreviewSection.sourceImageId가 없습니다');
  if (section.bucket == null) throw new Error('N5 Adapter: PreviewSection.bucket이 없습니다');

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
    render: resolveSectionRenderState(section),
    badges: toSignalBadges(section.signals),
  };
}

export function toPreviewViewModel(preview: ApiReviewPreview): PreviewViewModel {
  return {
    containerWidth: getPreviewContainerWidth(preview),
    scale: preview.scale ?? 1,
    sections: (preview.sections ?? [])
      .map(toPreviewSectionViewModel)
      // job 전체 표시 순서 = sectionOrder 오름차순 (buildSectionSlices의 기존 규칙과 동일)
      .sort((a, b) => a.sectionOrder - b.sectionOrder),
  };
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

/** BlockPatchResponse에서 rerenderTaskId를 꺼낸다. 없으면 null(스펙상 optional). */
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
