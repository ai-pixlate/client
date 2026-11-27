/**
 * 블록·섹션 PATCH 멱등 저장 — blockPatch·sectionPatch 「저장 공통」(OpenAPI v3.5.10) 의 FE 쪽 규칙. 순수 함수(scripts/verify-save-idempotency.mjs).
 *
 * 서버 규칙 요약
 * - 같은 키 · 같은 대상 · 같은 본문(revision 포함) → 최초 2xx 응답 재생(헤더 `Idempotent-Replayed: true`, 다시 적용하지 않음)
 * - 같은 키 · 다른 요청 → 409 DUPLICATE(idempotency_key_reused), 아무것도 적용하지 않음
 * - 기록은 2xx 응답만(값 변경 · no-op 모두) 24시간. 4xx·5xx 는 기록하지 않아 같은 키로 다시 보내면 그때 상태로 다시 판정한다
 * - 소유 확인(404) · 작업 상태(409 INVALID_STATE job_not_editable) 검사가 재생보다 먼저다 — 확정·취소된 작업은 재전송으로 복구되지 않는다
 * - 503 SERVICE_UNAVAILABLE(작업 잠금 대기 초과)은 아무것도 적용하지 않았다 — 같은 키·같은 본문 재전송이 안전하다
 *
 * FE 규칙
 * - 사용자 조작 한 번 = 요청 기록 하나(대상 · 키 · 실제 보낸 본문 · 요청 시점 revision · 시작 시각 · 인증 세대). 기록은 바꾸지 않는다(freeze)
 * - 결과를 알 수 없으면(연결 끊김 · 응답 유실 · 시간 초과 · 커밋 여부가 불명확한 5xx) 같은 기록을 그대로 다시 보낸다 — 새 키 · 새 revision 금지
 * - 재전송 응답이 재생이면 「최초 요청 성공」 확인일 뿐이다. 본문은 그때 값이라 화면 캐시를 덮지 않고 서버를 다시 조회한다
 * - 409 REVISION_CONFLICT 만으로 최초 요청이 반영되지 않았다고 단정하지 않는다(결과 불명 — 서버 현재 상태만 보여 준다)
 * - 재조회 결과는 현재 상태 확인용이다. 과거 요청의 성공 증명으로 쓰지 않는다
 * - 보관 기한이 지났거나 계정·세션이 바뀌었으면 재전송하지 않는다(서버 상태만 확인)
 */

import type { ApiLayoutAdjustPatch } from './n5-schema.ts';

/** 서버 멱등 기록 보관 기간(OpenAPI 「저장 공통」 — 24시간) */
export const IDEMPOTENCY_RECORD_RETENTION_MS = 24 * 60 * 60 * 1000;
/** FE 구현값 — 보관 기한 직전에 보낸 재전송이 서버에 닿을 때 이미 만료됐을 수 있어 그만큼 일찍 재전송을 멈춘다 */
export const IDEMPOTENT_RESEND_MARGIN_MS = 10 * 60 * 1000;
/** FE 구현값 — 저장 요청 한 번의 응답 대기 상한. 넘으면 결과 불명으로 보고 같은 기록으로 복구한다(잠금은 풀지 않는다) */
export const IDEMPOTENT_PATCH_TIMEOUT_MS = 30_000;

export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

export type IdempotentPatchOperation = 'blockPatch' | 'sectionPatch';

export interface IdempotentPatchRequest<TBody> {
  readonly operation: IdempotentPatchOperation;
  readonly jobId: string;
  /** 경로의 대상 ID(blockId · sectionId) */
  readonly targetId: number;
  readonly key: string;
  /** 실제 보낸 본문 — 재전송은 이 값을 그대로 직렬화한다 */
  readonly body: Readonly<TBody>;
  /** 요청 시점 revision(본문의 revision 과 같다) */
  readonly revision: number;
  readonly startedAt: number;
  /** 요청을 만든 인증 세대(lib/auth/session-store.ts epoch) — 바뀌면 이전 계정 요청을 다시 보내지 않는다 */
  readonly authEpoch: number;
}

export type CreateIdempotentPatchResult<TBody> =
  | { ok: true; request: IdempotentPatchRequest<TBody> }
  | { ok: false; reason: 'key-unavailable' | 'invalid-revision' | 'invalid-body'; problems?: string[] };

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/**
 * 사용자 조작 한 번의 요청 기록을 만든다. revision 은 서버가 준 현재 값만 받는다(정수가 아니면 만들지 않는다 — 임의 revision 금지).
 * 키를 만들 수 없으면 기록을 만들지 않는다 — 호출부는 키 없이 보내지 않고 저장 실패로 알린다.
 */
export function createIdempotentPatchRequest<TBody extends { revision?: number }>(
  input: { operation: IdempotentPatchOperation; jobId: string; targetId: number; body: TBody; authEpoch: number },
  deps: { now: () => number; createKey: () => string | null },
): CreateIdempotentPatchResult<TBody> {
  const revision = input.body.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision)) return { ok: false, reason: 'invalid-revision' };
  const key = deps.createKey();
  if (!key || !/^[!-~]{1,128}$/.test(key)) return { ok: false, reason: 'key-unavailable' };
  const body = deepFreeze(structuredClone(input.body));
  return {
    ok: true,
    request: Object.freeze({
      operation: input.operation,
      jobId: input.jobId,
      targetId: input.targetId,
      key,
      body,
      revision,
      startedAt: deps.now(),
      authEpoch: input.authEpoch,
    }),
  };
}

/** 이 기록을 같은 키로 다시 보내도 되는가 — 같은 인증 세대이고 서버 보관 기한(여유 포함) 안일 때만 */
export function canResendIdempotentPatch(request: Pick<IdempotentPatchRequest<unknown>, 'startedAt' | 'authEpoch'>, now: number, authEpoch: number): boolean {
  if (request.authEpoch !== authEpoch) return false;
  return now - request.startedAt < IDEMPOTENCY_RECORD_RETENTION_MS - IDEMPOTENT_RESEND_MARGIN_MS;
}

/* ------------------------------------------------------------------ *
 * 블록 PATCH 본문 형식 — NaN·Infinity·undefined 를 보내지 않는다. 잘못된 값을 0·null 로 바꾸거나 반올림하지 않는다
 * (null 은 「조정 해제」라는 뜻이 있다). 고칠 수 없으면 보내지 않고 저장 실패로 둔다.
 * ------------------------------------------------------------------ */

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** layoutAdjust 형식 문제 목록(없으면 빈 배열). 범위(섹션 밖 등 400 업무 검증)는 서버가 판단하고 여기서 보정하지 않는다 */
export function findLayoutAdjustProblems(layoutAdjust: ApiLayoutAdjustPatch | null | undefined): string[] {
  if (layoutAdjust === undefined || layoutAdjust === null) return [];
  if (typeof layoutAdjust !== 'object') return ['layoutAdjust'];
  const problems: string[] = [];
  const keys = Object.keys(layoutAdjust);
  if (keys.length === 0) problems.push('layoutAdjust(빈 객체)');
  for (const key of keys) {
    if (key !== 'box' && key !== 'fontScale') problems.push(`layoutAdjust.${key}(정의되지 않은 키)`);
  }
  if ('box' in layoutAdjust) {
    const box = layoutAdjust.box;
    if (box === undefined) problems.push('layoutAdjust.box(undefined)');
    else if (box !== null) {
      for (const coord of ['x', 'y', 'w', 'h'] as const) {
        if (!isFiniteNumber((box as Record<string, unknown>)[coord])) problems.push(`layoutAdjust.box.${coord}`);
      }
    }
  }
  if ('fontScale' in layoutAdjust) {
    const fontScale = layoutAdjust.fontScale;
    if (fontScale !== null && !(isFiniteNumber(fontScale) && fontScale > 0)) problems.push('layoutAdjust.fontScale');
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * 응답 · 실패 분류
 * ------------------------------------------------------------------ */

/** 재생 헤더 — `true` 일 때만 최초 응답 재생이다. 헤더 없는 200 은 이번 요청의 결과다 */
export function isReplayedResponse(headers: Pick<Headers, 'get'> | null | undefined): boolean {
  return headers?.get(IDEMPOTENT_REPLAYED_HEADER)?.trim().toLowerCase() === 'true';
}

/**
 * 성공 응답의 뜻. changed — 응답 revision 이 보낸 revision 보다 크면 실제 변경, 같으면 no-op(같은 값 저장 · 이미 같은 상태).
 * 응답에 revision 이 없으면 null(알 수 없음 — 변경으로 추정하지 않는다).
 */
export function describePatchSuccess(sentRevision: number, responseRevision: number | null | undefined, replayed: boolean): { replayed: boolean; changed: boolean | null } {
  return { replayed, changed: typeof responseRevision === 'number' ? responseRevision > sentRevision : null };
}

export type PatchFailureKind =
  /** 결과 불명 — 연결 끊김 · 응답 유실 · 시간 초과 · 커밋 여부가 불명확한 5xx */
  | 'uncertain'
  /** 409 REVISION_CONFLICT */
  | 'revision-conflict'
  /** 409 DUPLICATE — 같은 키를 다른 요청에 썼다(FE 오류). 아무것도 적용되지 않았다 */
  | 'duplicate'
  /** 409 INVALID_STATE job_not_editable — 작업이 이미 확정 · 취소됐다 */
  | 'not-editable'
  /** 서버가 이 요청을 적용하지 않았다고 분명히 답했다(503 SERVICE_UNAVAILABLE · 그 밖 4xx · 인증 복구 실패) */
  | 'not-applied'
  /** 계정 · 세션이 바뀌어 응답을 버렸다 — 새 계정에 반영하지 않는다 */
  | 'session-changed';

export interface PatchFailure {
  kind: PatchFailureKind;
  status: number | null;
  code: string | null;
  reason: string | null;
}

function readErrorBody(body: unknown): { code: string | null; reason: string | null } {
  const error = body && typeof body === 'object' ? (body as { error?: { code?: unknown; details?: { reason?: unknown } | null } }).error : undefined;
  return {
    code: typeof error?.code === 'string' ? error.code : null,
    reason: typeof error?.details?.reason === 'string' ? error.details.reason : null,
  };
}

/** lib/api/pixlate.ts ApiRequestError 와 같은 모양(그 파일은 '@/' 경로를 써서 순수 검증 스크립트가 import 하지 못한다) */
function asHttpError(err: unknown): { status: number; body: unknown } | null {
  if (!(err instanceof Error) || err.name !== 'ApiRequestError') return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' ? { status, body: (err as { body?: unknown }).body } : null;
}

export function classifyPatchFailure(err: unknown): PatchFailure {
  const http = asHttpError(err);
  if (http) {
    const { code, reason } = readErrorBody(http.body);
    const base = { status: http.status, code, reason };
    if (http.status === 409 && code === 'REVISION_CONFLICT') return { ...base, kind: 'revision-conflict' };
    if (http.status === 409 && code === 'DUPLICATE') return { ...base, kind: 'duplicate' };
    if (http.status === 409 && code === 'INVALID_STATE' && reason === 'job_not_editable') return { ...base, kind: 'not-editable' };
    // 서버 JSON 의 503 SERVICE_UNAVAILABLE 은 「아무것도 적용하지 않음」이다. 그 밖 5xx(프록시 오류 · 본문 없음 등)는 커밋 여부를 알 수 없다
    if (http.status === 503 && code === 'SERVICE_UNAVAILABLE') return { ...base, kind: 'not-applied' };
    if (http.status >= 500) return { ...base, kind: 'uncertain' };
    return { ...base, kind: 'not-applied' };
  }
  const base = { status: null, code: null, reason: null };
  if (err instanceof Error) {
    if (err.name === 'AuthSessionChangedError') return { ...base, kind: 'session-changed' };
    // 401 뒤 인증 복구가 끝나지 않았다 — 원 요청은 처리되지 않았다(401)
    if (err.name === 'AuthRecoveryError') return { ...base, kind: 'not-applied' };
  }
  // 네트워크 실패(TypeError) · 시간 초과(TimeoutError) · 중단(AbortError) · 응답을 끝까지 받지 못함 — 서버가 커밋했는지 알 수 없다
  return { ...base, kind: 'uncertain' };
}

/**
 * 결과 불명이던 요청을 같은 기록으로 다시 보낸 한 번의 결과 → 다음 단계.
 * - applied: 재전송이 성공했다(재생이면 최초 요청 성공 확인, 재생이 아니면 이번 재전송이 반영됨) — 어느 쪽이든 이 조작은 한 번 반영됐다
 * - still-uncertain: 다시 결과를 알 수 없다(또는 서버가 이번엔 처리하지 않았다고만 답했다 — 최초 요청의 결과는 여전히 모른다). 잠금 유지
 * - unknown: 서버 현재 상태만 확인하고 끝낸다 — 최초 요청 반영 여부를 단정하지 않는다(409 REVISION_CONFLICT · 404 · 그 밖 4xx)
 * - duplicate / job-closed: 그 이유로 끝낸다(서버 상태를 다시 확인한다)
 * - abandon: 계정 · 세션이 바뀌었다 — 아무것도 반영하지 않고 끝낸다
 */
export type RecoveryStep = 'applied' | 'still-uncertain' | 'unknown' | 'duplicate' | 'job-closed' | 'abandon';

export function nextRecoveryStep(result: { ok: true } | { ok: false; failure: PatchFailure }): RecoveryStep {
  if (result.ok) return 'applied';
  const { failure } = result;
  switch (failure.kind) {
    case 'uncertain':
      return 'still-uncertain';
    case 'not-applied':
      // 503(잠금 대기 초과) · 인증 복구 실패는 「이번 재전송을 처리하지 않음」일 뿐 최초 요청의 결과를 알려 주지 않는다
      return failure.status === 503 || failure.status === null ? 'still-uncertain' : 'unknown';
    case 'revision-conflict':
      return 'unknown';
    case 'duplicate':
      return 'duplicate';
    case 'not-editable':
      return 'job-closed';
    case 'session-changed':
      return 'abandon';
  }
}

/** 이력 중복 기록 방지 — 같은 요청 기록(키)의 성공은 한 번만 이력에 남긴다. 처음이면 true */
export function recordCommitOnce(ledger: Set<string>, key: string): boolean {
  if (ledger.has(key)) return false;
  ledger.add(key);
  return true;
}

/* ------------------------------------------------------------------ *
 * 결과 불명 복구 루프(React 없음 — lib/queries/use-save-recovery.ts 가 상태 표시와 재확인 대기를 붙인다)
 * ------------------------------------------------------------------ */

export type SaveRunResult<T> =
  /** 반영됐다. recovered = 결과 불명 뒤 재전송으로 확인했다 */
  | { kind: 'applied'; response: T; recovered: boolean }
  /** 서버가 분명히 거절했다(첫 전송의 409 · 4xx · 503, 또는 복구 중 DUPLICATE · job_not_editable) */
  | { kind: 'failed'; failure: PatchFailure; error: unknown; recovered: boolean }
  /** 결과 불명 뒤 반영 여부를 단정할 수 없다 — 서버 현재 상태만 다시 받았다 */
  | { kind: 'unknown'; failure: PatchFailure | null; error: unknown }
  /** 계정 · 세션이 바뀌었다 — 새 계정에 아무것도 반영하지 않는다 */
  | { kind: 'abandoned' };

export interface SaveRecoveryDeps {
  /** 서버 현재 상태 다시 받기 한 번 — true 면 받았다(실패 · 상한 초과면 false) */
  refetchServerState: () => Promise<boolean>;
  /** 사용자가 [서버 상태 다시 확인]을 누를 때까지 기다린다(이 동안 「확인하지 못함」) */
  waitForRetry: () => Promise<void>;
  /** 「확인 중」 표시 */
  onChecking: () => void;
  getAuthEpoch: () => number;
  now: () => number;
}

/**
 * 1. 첫 전송. 결과가 분명하면(성공 · 409 · 4xx · 503 SERVICE_UNAVAILABLE) 그대로 돌려준다.
 * 2. 결과 불명이면 같은 기록(대상 · 키 · 본문 · revision)을 다시 보낸다 — nextRecoveryStep 으로 다음 단계를 정한다.
 *    결과가 정해지면(재생 성공 · 거절) 서버 현재 상태를 다시 받은 뒤 끝낸다. 다시 결과 불명이면 사용자 재확인을 기다린다.
 * 3. 보관 기한이 지났으면 재전송하지 않고 현재 상태만 확인한다(unknown). 계정 · 세션이 바뀌면 끝낸다(abandoned).
 * 끝날 때까지 호출부의 저장 잠금이 유지된다 — 시간이 지났다는 이유로 끝내지 않는다.
 */
export async function runSaveWithRecovery<T extends { replayed: boolean }>(
  request: Pick<IdempotentPatchRequest<unknown>, 'startedAt' | 'authEpoch'>,
  send: () => Promise<T>,
  deps: SaveRecoveryDeps,
): Promise<SaveRunResult<T>> {
  const confirmServerState = async (): Promise<boolean> => {
    for (;;) {
      if (deps.getAuthEpoch() !== request.authEpoch) return false;
      deps.onChecking();
      if (await deps.refetchServerState()) return true;
      await deps.waitForRetry();
    }
  };

  try {
    const response = await send();
    // 새 키의 첫 전송이 재생일 수는 없지만, 재생이면 같은 규칙으로 현재 상태를 다시 받는다
    if (response.replayed && !(await confirmServerState())) return { kind: 'abandoned' };
    return { kind: 'applied', response, recovered: false };
  } catch (error) {
    const failure = classifyPatchFailure(error);
    if (failure.kind === 'session-changed') return { kind: 'abandoned' };
    if (failure.kind !== 'uncertain') return { kind: 'failed', failure, error, recovered: false };
  }

  for (;;) {
    if (request.authEpoch !== deps.getAuthEpoch()) return { kind: 'abandoned' };
    deps.onChecking();
    if (!canResendIdempotentPatch(request, deps.now(), deps.getAuthEpoch())) {
      // 보관 기한이 지났다 — 같은 키로 다시 보내면 새 요청으로 처리될 수 있어 보내지 않는다. 현재 상태만 확인한다
      return (await confirmServerState()) ? { kind: 'unknown', failure: null, error: null } : { kind: 'abandoned' };
    }
    let outcome: { ok: true; response: T } | { ok: false; failure: PatchFailure; error: unknown };
    try {
      outcome = { ok: true, response: await send() };
    } catch (error) {
      outcome = { ok: false, failure: classifyPatchFailure(error), error };
    }
    const step = nextRecoveryStep(outcome.ok ? { ok: true } : { ok: false, failure: outcome.failure });
    if (step === 'abandon') return { kind: 'abandoned' };
    if (step === 'still-uncertain') {
      await deps.waitForRetry();
      continue;
    }
    // 결과가 정해졌다 — 재생 응답이든 거절이든 서버 현재 상태를 다시 받은 뒤 끝낸다(재조회는 현재 상태 확인용이다)
    if (!(await confirmServerState())) return { kind: 'abandoned' };
    if (outcome.ok) return { kind: 'applied', response: outcome.response, recovered: true };
    if (step === 'unknown') return { kind: 'unknown', failure: outcome.failure, error: outcome.error };
    return { kind: 'failed', failure: outcome.failure, error: outcome.error, recovered: true };
  }
}
