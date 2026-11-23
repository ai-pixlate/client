import { AUTH_ORIGINAL_REQUEST_MAX_RETRIES } from './constants.ts';
import type { RecoveryOutcome } from './refresh.ts';
import { recoverSession } from './runtime.ts';
import { getAuthEpoch, getAuthEpochSignal } from './session-store.ts';

/** 본문을 가질 수 없는 status — new Response(body) 가 body 를 받지 않는다 */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * 요청을 보낸 뒤 계정·세션이 바뀌어(계정 전환·로그아웃·세션 종료) 응답을 버린다는 뜻의 오류.
 * 이전 계정 응답이 새 계정 화면에 섞이지 않게 한다. 화면은 이미 M1·G1 로 이동 중이다. React Query 는 자동 재시도하지 않는다.
 */
export class AuthSessionChangedError extends Error {
  constructor() {
    super('auth session changed');
    this.name = 'AuthSessionChangedError';
  }
}

/**
 * 인증 계층이 이미 최종 판단한 복구 실패 — 이 요청을 자동으로 다시 시도해도 같은 결과(또는 새 refresh)만 만든다.
 *   failed            = origin_not_allowed·422 등 설정·요청 오류
 *   unavailable       = 503·5xx·네트워크·탭 잠금 시간 초과(세션 유지, auth-unavailable 안내)
 *   rotated-exhausted = 사건당 refresh 상한을 다 씀
 *   retry-exhausted   = 같은 계정 확인 뒤 다시 보낸 원 요청도 401
 * React Query 는 이 오류를 자동 재시도하지 않는다(lib/auth/query-retry.ts). 사용자가 다시 시도하는 것은 새 요청이다.
 */
export type AuthRecoveryFailure = 'failed' | 'unavailable' | 'rotated-exhausted' | 'retry-exhausted';

export class AuthRecoveryError extends Error {
  readonly failure: AuthRecoveryFailure;
  constructor(failure: AuthRecoveryFailure) {
    super(`auth recovery failed: ${failure}`);
    this.name = 'AuthRecoveryError';
    this.failure = failure;
  }
}

/**
 * 'session' 모드의 일반 API 요청. 401 이면 인증 복구(refresh → /auth/me)를 기다리고,
 * 같은 계정으로 확인됐을 때만 원 요청을 다시 보낸다(최대 AUTH_ORIGINAL_REQUEST_MAX_RETRIES 회). send 는 부를 때마다 최신 access 로 헤더를 만들고,
 * 받은 signal(보낼 때 세대의 AbortSignal)을 fetch 에 붙인다 — 세대가 바뀌면 요청이 네트워크에서 끊긴다.
 *
 * 인증 세대(epoch) — 요청을 보낼 때의 세대에 묶는다:
 *   401 을 받았을 때 이미 세대가 바뀌었으면 refresh 를 시작하지 않는다(이전 세대의 늦은 401 이 새 세션의 refresh 쿠키를 회전시키지 않게)
 *   복구는 그 세대에 묶여(recover(epoch)) 다른 세대의 진행 중 복구와 합치지 않는다
 *   세대가 바뀌면 응답을 버리고 AuthSessionChangedError — abort 로 끊긴 요청도 같다
 *   응답 본문도 이 안에서 끝까지 받은 뒤 세대를 다시 확인한다. 호출부가 나중에 res.json() 을 기다리는 사이 세대가 바뀌어
 *   이전 계정 본문이 cache 로 들어가는 틈을 없앤다(돌려주는 Response 는 이미 받은 본문을 담은 사본이다)
 * 복구가 같은 계정 확인으로 끝나지 않으면 401 응답을 일반 오류로 돌려주지 않고 AuthRecoveryError 를 던진다 — 쿼리 재시도가 새 refresh 를 만들지 않게.
 */
export async function fetchWithSessionRecovery(
  send: (signal: AbortSignal) => Promise<Response>,
  recover: (expectedEpoch: number) => Promise<RecoveryOutcome> = recoverSession,
): Promise<Response> {
  const epoch = getAuthEpoch();
  const signal = getAuthEpochSignal();
  // 세대가 바뀐 뒤의 실패(abort 포함)는 원인과 상관없이 「응답 폐기」로 통일한다. 같은 세대의 실패(네트워크 등)는 그대로 던진다
  const withinEpoch = async <T>(task: () => Promise<T>): Promise<T> => {
    try {
      return await task();
    } catch (error) {
      if (getAuthEpoch() !== epoch) throw new AuthSessionChangedError();
      throw error;
    }
  };
  let res = await withinEpoch(() => send(signal));
  let recovered = false;
  for (let retry = 0; res.status === 401 && retry < AUTH_ORIGINAL_REQUEST_MAX_RETRIES; retry += 1) {
    if (getAuthEpoch() !== epoch) throw new AuthSessionChangedError();
    const outcome = await recover(epoch);
    // 계정 전환·세션 종료·로그아웃은 세대를 올린다(account-changed·session-ended·restore-suppressed·stale)
    if (getAuthEpoch() !== epoch || outcome.kind === 'stale') throw new AuthSessionChangedError();
    if (outcome.kind === 'failed' || outcome.kind === 'unavailable' || outcome.kind === 'rotated-exhausted') throw new AuthRecoveryError(outcome.kind);
    if (outcome.kind !== 'same-account') throw new AuthSessionChangedError();
    recovered = true;
    res = await withinEpoch(() => send(signal));
  }
  if (getAuthEpoch() !== epoch) throw new AuthSessionChangedError();
  if (res.status === 401 && recovered) throw new AuthRecoveryError('retry-exhausted');
  const received = res;
  const body = NULL_BODY_STATUSES.has(received.status) ? null : await withinEpoch(() => received.arrayBuffer());
  if (getAuthEpoch() !== epoch) throw new AuthSessionChangedError();
  return new Response(body, { status: received.status, statusText: received.statusText, headers: received.headers });
}
