/**
 * N5 /preview 렌더 입력·시도·결과 판정(server PR #108, reviewPreview 「렌더 입력과 시도·결과」).
 *
 * 두 축을 섞지 않는다.
 *   입력 상태 = renderInput · inputFingerprint · inputError   (resolvePreviewInputState)
 *   렌더 상태 = render.attempt · render.result · render.isCurrent (resolvePreviewRenderState)
 * 예: 입력 준비 중이면서 이전 시도는 실패 — 두 사실을 함께 가진다.
 *
 * 이미지 최신성은 서버 render.isCurrent 가 정본이다(FE 가 B·C 를 다시 비교해 덮지 않는다). 넘침은 isCurrent=true 인 결과의
 * overflow 만 정본이다. 표와 뷰어를 같은 저장 입력으로 보는 것은 지문 A(/blocks) = B(/preview) 일 때뿐이고, null 은 비교하지 않는다.
 * rendererId·bundleId 는 opaque 문자열이다 — 같은지만 본다.
 *
 * 순수 모듈이다(React·브라우저 API 없음, scripts/verify-n5-preview-state.mjs 로 Node 에서 검증).
 */

import type { ApiPreviewRenderer, ApiPreviewRenderStyle, ApiPreviewSection, ApiRenderStatus } from '../api/n5-schema';
import type { TypesetServerStyle, TypesetTextAlign } from './typeset-rules';
import { N5_PREVIEW_NOTICE_COPY, N5_PREVIEW_PROGRESS_COPY } from './preview-copy.ts';

/* ------------------------------------------------------------------ *
 * 입력 상태
 * ------------------------------------------------------------------ */

export type PreviewInputKind = 'ready' | 'preparing' | 'error' | 'excluded' | 'invalid-contract';

export interface PreviewInputState {
  kind: PreviewInputKind;
  /** 지문 B — ready 일 때만 값 */
  fingerprint: string | null;
  /** 입력 오류 코드(task errorCode 와 같은 값 공간, HTTP error.code 가 아니다). 다시 시도 대상이 아니다 */
  errorCode: string | null;
  errorBlockIds: number[];
  /** invalid-contract 일 때 이유(개발 진단용) */
  problem: string | null;
}

/** 이번 계약이 항상 내야 하는 섹션 키. 하나라도 빠지면 계약 위반이며 정상 상태로 해석하지 않는다 */
const REQUIRED_PREVIEW_SECTION_KEYS = ['renderInput', 'inputFingerprint', 'inputError', 'render'] as const;

export function isPreviewSectionExcluded(section: Pick<ApiPreviewSection, 'bucket' | 'excludedStage'>): boolean {
  return section.bucket === 'exclude' || section.excludedStage != null;
}

function missingKeys(section: object): string[] {
  return REQUIRED_PREVIEW_SECTION_KEYS.filter((key) => !(key in section));
}

export function resolvePreviewInputState(section: ApiPreviewSection): PreviewInputState {
  const base = { fingerprint: null, errorCode: null, errorBlockIds: [], problem: null };
  if (isPreviewSectionExcluded(section)) return { ...base, kind: 'excluded' };
  const missing = missingKeys(section);
  if (missing.length > 0) return { ...base, kind: 'invalid-contract', problem: `missing keys: ${missing.join(',')}` };

  const { renderInput, inputFingerprint, inputError } = section;
  if (renderInput != null && inputFingerprint != null && inputError == null) {
    return { ...base, kind: 'ready', fingerprint: inputFingerprint };
  }
  if (renderInput == null && inputFingerprint == null && inputError == null) return { ...base, kind: 'preparing' };
  if (renderInput == null && inputFingerprint == null && inputError != null) {
    return { ...base, kind: 'error', errorCode: inputError.code, errorBlockIds: inputError.blockIds ?? [] };
  }
  return {
    ...base,
    kind: 'invalid-contract',
    problem: `renderInput=${renderInput == null ? 'null' : 'value'} inputFingerprint=${inputFingerprint == null ? 'null' : 'value'} inputError=${
      inputError == null ? 'null' : 'value'
    }`,
  };
}

/* ------------------------------------------------------------------ *
 * 렌더 상태
 * ------------------------------------------------------------------ */

/**
 * current = 최신 결과 / waiting·running = 시도 진행 중(pending·running) / failed = 시도 실패 /
 * stale = 진행·실패 중인 시도 없이 이전 결과만 있음 / missing = 결과 없음.
 * waiting·running·failed 이어도 result 가 있으면 그 이전 이미지를 보일 수 있다(최신 아님).
 */
export type PreviewRenderKind = 'current' | 'waiting' | 'running' | 'failed' | 'stale' | 'missing' | 'excluded' | 'invalid-contract';

/** 응답만으로 다시 판정하기 전에 /preview 를 다시 받아야 하는 경우. once = d·e 의 한 번, limited = g 의 제한 재조회 */
export type PreviewRefetchRule = 'none' | 'once' | 'limited';

export interface PreviewRenderAttemptView {
  taskId: number;
  status: ApiRenderStatus;
  errorCode: string | null;
  retryable: boolean;
}

export interface PreviewRenderResultView {
  taskId: number;
  /** 지문 C */
  inputFingerprint: string;
  rendererId: string;
}

export interface PreviewRenderState {
  kind: PreviewRenderKind;
  attempt: PreviewRenderAttemptView | null;
  /** 지금 표시할 수 있는 서버 결과(이전 결과 포함). 최신인지는 kind === 'current' 로만 본다 */
  result: PreviewRenderResultView | null;
  /** 서버 넘침 정본 — kind === 'current' 일 때만 값이 있다. 이전 결과의 넘침은 쓰지 않는다 */
  overflowByBlockId: ReadonlyMap<number, boolean> | null;
  refetch: PreviewRefetchRule;
  /** stale·missing 이 된 경로(진단·재조회 서명용) */
  staleReason: 'adoption-pending' | 'renderer-changed' | 'input-changed' | null;
  problem: string | null;
}

function toOverflowMap(overflow: Record<string, boolean>): Map<number, boolean> | null {
  const map = new Map<number, boolean>();
  for (const [key, value] of Object.entries(overflow)) {
    const id = Number(key);
    if (!Number.isInteger(id) || typeof value !== 'boolean') return null;
    map.set(id, value);
  }
  return map;
}

/**
 * 렌더 판정(같은 응답 안에서 위에서부터 처음 맞는 것) — a 최신 / b 진행 중 / c 실패 / d 채택 직후 / g 렌더러 갱신 / e 나머지.
 * @param inputKind 같은 섹션의 입력 상태 — e② 의 한 번 재조회(정상 입력인데 시도도 없음)에만 쓴다
 */
export function resolvePreviewRenderState(
  section: ApiPreviewSection,
  renderer: ApiPreviewRenderer | null | undefined,
  inputKind: PreviewInputKind,
): PreviewRenderState {
  const base = { attempt: null, result: null, overflowByBlockId: null, refetch: 'none' as const, staleReason: null, problem: null };
  if (isPreviewSectionExcluded(section)) return { ...base, kind: 'excluded' };
  const missing = missingKeys(section);
  if (missing.length > 0) return { ...base, kind: 'invalid-contract', problem: `missing keys: ${missing.join(',')}` };
  const render = section.render;
  if (render == null) return { ...base, kind: 'invalid-contract', problem: 'render=null on include section' };
  if (!('attempt' in render) || !('result' in render) || typeof render.isCurrent !== 'boolean') {
    return { ...base, kind: 'invalid-contract', problem: 'render keys missing' };
  }

  const attempt: PreviewRenderAttemptView | null = render.attempt
    ? {
        taskId: render.attempt.taskId,
        status: render.attempt.status,
        errorCode: render.attempt.errorCode ?? null,
        retryable: render.attempt.retryable === true,
      }
    : null;
  const result: PreviewRenderResultView | null = render.result
    ? { taskId: render.result.taskId, inputFingerprint: render.result.inputFingerprint, rendererId: render.result.rendererId }
    : null;
  const withParts = { ...base, attempt, result };

  // a 최신 — result 와 overflow 객체가 함께 있어야 한다
  if (render.isCurrent) {
    const overflow = render.result?.overflow;
    const map = overflow && typeof overflow === 'object' ? toOverflowMap(overflow) : null;
    if (!result || !map) return { ...withParts, kind: 'invalid-contract', problem: 'isCurrent=true without result/overflow' };
    return { ...withParts, kind: 'current', overflowByBlockId: map };
  }
  // b·c — 진행 중이거나 실패한 시도. 이전 결과가 있어도 최신이 아니다
  if (attempt?.status === 'pending') return { ...withParts, kind: 'waiting' };
  if (attempt?.status === 'running') return { ...withParts, kind: 'running' };
  if (attempt?.status === 'failed') return { ...withParts, kind: 'failed' };
  // d 채택 직후·채택 거절 — 한 번 다시 받고, 그대로면 e 로 이어진다
  if (attempt?.status === 'done' && (!result || attempt.taskId !== result.taskId)) {
    return { ...withParts, kind: result ? 'stale' : 'missing', refetch: 'once', staleReason: 'adoption-pending' };
  }
  // g 렌더러 갱신 뒤 새 시도 등록 대기 — 제한된 자동 재조회
  if (result && renderer && result.rendererId !== renderer.rendererId) {
    return { ...withParts, kind: 'stale', refetch: 'limited', staleReason: 'renderer-changed' };
  }
  // e① 입력이 바뀌었는데 새 시도가 없다
  if (result) return { ...withParts, kind: 'stale', refetch: 'once', staleReason: 'input-changed' };
  // e② 결과 없음. 정상 입력인데 시도도 없으면 한 번 다시 받는다
  return { ...withParts, kind: 'missing', refetch: inputKind === 'ready' && attempt == null ? 'once' : 'none' };
}

/** 개발 진단 — 서버 계약 위반으로 볼 조합. 화면 판정을 바꾸지 않고 경고만 남긴다 */
export function diagnosePreviewSection(input: PreviewInputState, render: PreviewRenderState): string[] {
  const problems: string[] = [];
  if (input.problem) problems.push(`input: ${input.problem}`);
  if (render.problem) problems.push(`render: ${render.problem}`);
  // isCurrent=true 인데 C !== B — 서버 계산과 응답이 어긋났다(FE 는 isCurrent 를 그대로 따른다)
  if (render.kind === 'current' && render.result && input.fingerprint != null && render.result.inputFingerprint !== input.fingerprint) {
    problems.push('render: isCurrent=true but result.inputFingerprint !== inputFingerprint');
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * 지문 A/B
 * ------------------------------------------------------------------ */

/** 한 섹션 블록들의 sectionInputFingerprint 를 모은 지문 A */
export type SectionFingerprintA =
  | { kind: 'value'; value: string }
  /** 비교 불가 — 블록이 없거나 모두 null */
  | { kind: 'none' }
  /** 같은 섹션에서 서로 다른 값 — 하나를 고르지 않는다 */
  | { kind: 'inconsistent'; values: string[] };

export function deriveSectionFingerprintA(values: readonly (string | null | undefined)[]): SectionFingerprintA {
  const distinct = [...new Set(values.filter((value): value is string => typeof value === 'string'))];
  if (distinct.length === 0) return { kind: 'none' };
  if (distinct.length === 1) return { kind: 'value', value: distinct[0] };
  return { kind: 'inconsistent', values: distinct };
}

/** match 일 때만 표와 뷰어를 같은 저장 입력으로 연결한다. null 끼리는 incomparable 이다 */
export type FingerprintMatch = 'match' | 'mismatch' | 'incomparable' | 'inconsistent';

export function compareFingerprintsAB(a: SectionFingerprintA, b: string | null): FingerprintMatch {
  if (a.kind === 'inconsistent') return 'inconsistent';
  if (a.kind === 'none' || b == null) return 'incomparable';
  return a.value === b ? 'match' : 'mismatch';
}

/* ------------------------------------------------------------------ *
 * 렌더 입력 블록 → FE 조판 입력
 * ------------------------------------------------------------------ */

const TEXT_ALIGNS: ReadonlySet<string> = new Set<TypesetTextAlign>(['left', 'center', 'right']);
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/**
 * 서버 style 8키를 그대로 옮긴다(역할 기본값으로 다시 계산하지 않는다). 색은 받은 문자열 그대로 쓴다(소문자화·alpha 추가 없음).
 * 형식이 계약 밖이면 null — 그 섹션은 HTML 조판을 만들지 않고 서버 이미지로 둔다.
 */
export function toTypesetServerStyle(style: ApiPreviewRenderStyle): TypesetServerStyle | null {
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  if (
    typeof style.fontFamily !== 'string' ||
    style.fontFamily === '' ||
    !finite(style.fontWeight) ||
    !finite(style.fontSizePx) ||
    !(style.fontSizePx > 0) ||
    !finite(style.fontScale) ||
    !(style.fontScale > 0) ||
    typeof style.fontColor !== 'string' ||
    !HEX_COLOR.test(style.fontColor) ||
    typeof style.align !== 'string' ||
    !TEXT_ALIGNS.has(style.align) ||
    !finite(style.letterSpacingEm) ||
    !finite(style.lineHeightRatio) ||
    !(style.lineHeightRatio > 0)
  ) {
    return null;
  }
  return {
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontSizePx: style.fontSizePx,
    fontScale: style.fontScale,
    fontColor: style.fontColor,
    align: style.align as TypesetTextAlign,
    letterSpacingEm: style.letterSpacingEm,
    lineHeightRatio: style.lineHeightRatio,
  };
}

/* ------------------------------------------------------------------ *
 * 화면 표시 — N5 「번역 후」 뷰어(검수용 preview). N6 최종 렌더(/render) 진행 상태와 섞지 않는다
 * ------------------------------------------------------------------ */

/**
 * N5 「번역 후」 섹션 면에 무엇을 그리는지 — 컴포넌트는 renderedUrl·renderInput·isCurrent 를 따로 보지 않고 이 값만 본다.
 * - local-typeset: renderInput 배경 + FE HTML 번역문(글자가 구워진 renderedUrl 위에 겹치지 않는다)
 * - current-rendered-image: 최신 서버 결과지만 HTML 로 그릴 수 없음(지문 A≠B·글꼴 미준비·style 계약 밖)
 * - previous-rendered-image: 최신이 아닌 이전 서버 결과. 새 번역문을 HTML 로 얹지 않는다
 * - original-image: 서버 결과 없음 → 원본. 번역문 HTML 을 얹지 않는다
 * - excluded: 제외 섹션 / legacy: 이번 계약 키가 없거나 조합이 계약 밖 — 기존 renderedUrl 기준 표시
 */
export type N5PreviewDisplaySource = 'local-typeset' | 'current-rendered-image' | 'previous-rendered-image' | 'original-image';
export type PreviewSectionDisplaySource = N5PreviewDisplaySource | 'excluded' | 'legacy';

export function resolvePreviewSectionDisplay(options: {
  input: PreviewInputState;
  render: PreviewRenderState;
  match: FingerprintMatch;
  /** 서버 style 로 그릴 수 있음(모든 블록 style 형식 정상 + 폰트 준비) */
  canTypeset: boolean;
}): PreviewSectionDisplaySource {
  const { input, render, match, canTypeset } = options;
  if (input.kind === 'excluded' || render.kind === 'excluded') return 'excluded';
  if (input.kind === 'invalid-contract' || render.kind === 'invalid-contract') return 'legacy';
  if (render.kind === 'current') {
    return input.kind === 'ready' && match === 'match' && canTypeset ? 'local-typeset' : 'current-rendered-image';
  }
  // 최신이 아니다 — 이전 결과가 있으면 그대로(진행 중·실패·입력 오류·준비 중이어도), 없으면 원본
  return render.result ? 'previous-rendered-image' : 'original-image';
}

/**
 * 디자인 연결용 의미 상태 — 문구·아이콘·위치와 1:1 로 묶지 않는다(문구는 preview-copy.ts).
 * render:
 * - current · stale(이전 결과, 진행 중 시도 없음)
 * - updating(이전 결과 + 새 시도 pending/running) · update-failed(이전 결과 + 새 시도 실패 — N5 수정 후 재렌더 실패, F-CFM-02)
 * - waiting · running(이전 결과 없이 시도 진행) · failed(이전 결과 없이 실패 — N4 최초 생성 실패와 같은 표시)
 * - missing(결과 없음 + 시도 없음·done) — renderedUrl=null 만으로 실패로 보지 않는다
 * input 은 render 와 따로 둔다(preparing + failed 를 함께 가진다).
 */
export type PreviewRenderSemantic = 'current' | 'stale' | 'updating' | 'update-failed' | 'waiting' | 'running' | 'failed' | 'missing';
export type PreviewInputSemantic = 'ready' | 'preparing' | 'input-error';

export interface PreviewSectionSemantic {
  input: PreviewInputSemantic;
  render: PreviewRenderSemantic;
  /** 진행 중 시도의 단계(updating·waiting·running 에서 pending/running 구분) */
  attemptStatus: ApiRenderStatus | null;
  /** 지문 A≠B(또는 A 불일치) — 다시 불러온 뒤에도 표와 뷰어를 잇지 않은 상태 */
  syncing: boolean;
  /** 재렌더 다시 시도 대상 — failed·update-failed 일 때만. 기존 task retry 계약(attempt.taskId·retryable)을 쓴다 */
  retry: { taskId: number; retryable: boolean } | null;
}

/** 제외·계약 밖 섹션은 null(기존 표시 규칙을 따른다) */
export function resolvePreviewSectionSemantic(input: PreviewInputState, render: PreviewRenderState, match: FingerprintMatch): PreviewSectionSemantic | null {
  if (input.kind === 'excluded' || input.kind === 'invalid-contract' || render.kind === 'excluded' || render.kind === 'invalid-contract') return null;
  const hasPrevious = render.result != null;
  const renderSemantic: PreviewRenderSemantic =
    render.kind === 'current'
      ? 'current'
      : render.kind === 'waiting' || render.kind === 'running'
        ? hasPrevious
          ? 'updating'
          : render.kind
        : render.kind === 'failed'
          ? hasPrevious
            ? 'update-failed'
            : 'failed'
          : render.kind;
  const failed = renderSemantic === 'failed' || renderSemantic === 'update-failed';
  return {
    input: input.kind === 'error' ? 'input-error' : input.kind,
    render: renderSemantic,
    attemptStatus: render.attempt?.status ?? null,
    syncing: input.kind === 'ready' && (match === 'mismatch' || match === 'inconsistent'),
    retry: failed && render.attempt ? { taskId: render.attempt.taskId, retryable: render.attempt.retryable } : null,
  };
}

/** 섹션 상태 문구 — 진행(progress)·안내(notice)·실패를 따로 둔다. 실패는 기존 「실행 실패」 행 하나로만 보인다 */
export interface PreviewSectionLabels {
  progressLabel: string | null;
  notice: string | null;
  renderFailed: boolean;
}

const NO_LABELS: PreviewSectionLabels = { progressLabel: null, notice: null, renderFailed: false };

/** 의미 상태 → 임시 문구(preview-copy.ts). 디자인이 오면 문구 표만 바꾼다 */
export function resolvePreviewSectionLabels(semantic: PreviewSectionSemantic | null): PreviewSectionLabels {
  if (!semantic) return NO_LABELS;
  const { input, render, attemptStatus, syncing } = semantic;
  const hasPrevious = render === 'current' || render === 'stale' || render === 'updating' || render === 'update-failed';
  const renderFailed = render === 'failed' || render === 'update-failed';
  const progressKey =
    render === 'waiting' || render === 'running'
      ? render
      : render === 'updating'
        ? attemptStatus === 'running'
          ? 'running'
          : 'waiting'
        : input === 'preparing' && !renderFailed && !hasPrevious
          ? 'preparing'
          : null;
  const noticeKey =
    input === 'input-error'
      ? 'input-error'
      : syncing
        ? 'syncing'
        : hasPrevious && render !== 'current'
          ? 'previous-result'
          : render === 'missing' && input === 'ready'
            ? 'missing'
            : null;
  return {
    progressLabel: progressKey ? N5_PREVIEW_PROGRESS_COPY[progressKey] : null,
    notice: noticeKey ? N5_PREVIEW_NOTICE_COPY[noticeKey] : null,
    renderFailed,
  };
}
