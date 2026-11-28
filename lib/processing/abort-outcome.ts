// ─────────────────────────────────────────────────────────────────
// N2·N4 [중단] 결과 판단 (API-JOB-07 POST /jobs/{jobId}/abort) — React·브라우저 API 를 쓰지 않는 순수 로직.
//
// 중단 성공의 정본은 abort 응답이 아니라 그 뒤 다시 받은 JOB-05(GET /jobs/{jobId}/tasks)의 currentStep 이다.
// - 응답 본문(returnTo·job·jobId)은 명세(returnTo·job)와 현재 서버(returnTo·jobId)가 달라 화면 전환 근거로 쓰지 않는다.
// - 409·응답 유실도 실패로 단정하지 않는다 — 서버가 이미 이전 단계로 돌렸을 수 있다(재조회 결과로 정한다).
// - 멱등성이 계약에 없어 자동 재전송하지 않는다. 다시 누르는 것은 사용자가 고른 새 요청이다.
// 화면 전환은 page.tsx 가 재조회로 갱신된 currentStep 을 그대로 그려서 일어난다(FE 가 단계를 만들지 않는다).
// ─────────────────────────────────────────────────────────────────

export type AbortFromStep = 'N2' | 'N4';

/** 계약상 복귀 단계 — N2 → draft/N1 · N4 → review/N3 */
export const ABORT_RETURN_STEP: Record<AbortFromStep, 'N1' | 'N3'> = { N2: 'N1', N4: 'N3' };

/**
 * abort 요청이 어떻게 끝났는가.
 * - ok: 2xx
 * - invalid-state: 409(INVALID_STATE 등) — 서버가 지금 상태에서 중단을 받지 않았다
 * - not-found: 404 — 없는 작업 또는 다른 계정의 작업(둘을 구분하지 않는다)
 * - server: 그 밖의 4xx·5xx 응답을 받았다
 * - auth: 인증 복구 실패(AuthRecoveryError) — 요청이 서버에 닿았는지 알 수 없다
 * - unknown: 응답을 끝까지 받지 못했다(네트워크·시간 초과·중단) — 서버가 처리했는지 알 수 없다
 */
export type AbortRequestResult = 'ok' | 'invalid-state' | 'not-found' | 'server' | 'auth' | 'unknown';

/** 재조회 결과. null = 재조회 실패(서버 상태를 모름). notFound = 재조회가 404 */
export type AbortRecheck =
  | { kind: 'status'; currentStep: string | null | undefined; isCancelled: boolean }
  | { kind: 'not-found' }
  | { kind: 'failed' };

export type AbortOutcome =
  /** 서버가 계약대로 이전 단계에 있다 — page 가 그 화면을 그린다 */
  | { kind: 'returned' }
  /** 서버가 다른 단계·취소·없는 작업이다 — page 가 서버 상태 그대로(다른 화면·취소 안내·없는 작업)를 그린다 */
  | { kind: 'server-moved' }
  /** 서버가 아직 같은 처리 단계다 — 오류 화면에 머물고 안내한다 */
  | { kind: 'stayed'; notice: string }
  /** 재조회에 실패해 서버 상태를 모른다 — 오류 화면에 머물고 안내한다(복귀했다고 추정하지 않는다) */
  | { kind: 'unverified'; notice: string };

export const ABORT_NOTICE = {
  /** 200 이었지만 재조회한 서버가 아직 처리 단계다 */
  acceptedButStayed: '중단 요청은 접수되었지만 아직 이전 단계로 돌아가지 않았습니다. 잠시 후 다시 시도해 주세요.',
  invalidState: '지금 작업 상태에서는 중단할 수 없습니다.',
  unknown: '중단 요청 결과를 확인하지 못했습니다. 다시 시도해 주세요.',
  server: '작업을 중단하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  auth: '로그인 상태를 확인하지 못해 작업을 중단하지 못했습니다. 다시 로그인한 뒤 시도해 주세요.',
  unverified: '작업 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
} as const;

const STAYED_NOTICE: Record<AbortRequestResult, string> = {
  ok: ABORT_NOTICE.acceptedButStayed,
  'invalid-state': ABORT_NOTICE.invalidState,
  // 요청은 404 였는데 재조회는 같은 단계다 — 서버 상태가 엇갈린다. 일반 실패로 안내한다
  'not-found': ABORT_NOTICE.server,
  server: ABORT_NOTICE.server,
  auth: ABORT_NOTICE.auth,
  unknown: ABORT_NOTICE.unknown,
};

export function resolveAbortOutcome(from: AbortFromStep, request: AbortRequestResult, recheck: AbortRecheck): AbortOutcome {
  if (recheck.kind === 'not-found') return { kind: 'server-moved' };
  if (recheck.kind === 'failed') return { kind: 'unverified', notice: ABORT_NOTICE.unverified };
  if (recheck.isCancelled) return { kind: 'server-moved' };
  if (recheck.currentStep === ABORT_RETURN_STEP[from]) return { kind: 'returned' };
  // currentStep 을 모르는 응답은 이동했다고 보지 않는다 — 같은 단계에 머문 것으로 안내한다
  if (recheck.currentStep === from || recheck.currentStep == null) return { kind: 'stayed', notice: STAYED_NOTICE[request] };
  return { kind: 'server-moved' };
}

/** HTTP status → 요청 결과. status 를 모르면(응답 없음) unknown */
export function abortRequestResultOf(status: number | null): AbortRequestResult {
  if (status == null) return 'unknown';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 409) return 'invalid-state';
  if (status === 404) return 'not-found';
  return 'server';
}
