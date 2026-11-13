import { AUTH_ORIGINAL_REQUEST_MAX_RETRIES } from './constants.ts';
import type { RecoveryOutcome } from './refresh.ts';
import { recoverSession } from './runtime.ts';
import { getAuthEpoch } from './session-store.ts';

/**
 * 요청을 보낸 뒤 계정·세션이 바뀌어(계정 전환·로그아웃·세션 종료) 응답을 버린다는 뜻의 오류.
 * 이전 계정 응답이 새 계정 화면에 섞이지 않게 한다. 화면은 이미 M1·G1 로 이동 중이다.
 */
export class AuthSessionChangedError extends Error {
  constructor() {
    super('auth session changed');
    this.name = 'AuthSessionChangedError';
  }
}

/**
 * 'session' 모드의 일반 API 요청. 401 이면 인증 복구(refresh → /auth/me)를 기다리고,
 * 같은 계정으로 확인됐을 때만 원 요청을 다시 보낸다(최대 AUTH_ORIGINAL_REQUEST_MAX_RETRIES 회). send 는 부를 때마다 최신 access 로 헤더를 만든다.
 *
 * 인증 세대(epoch) — 요청을 보낼 때의 세대에 묶는다:
 *   401 을 받았을 때 이미 세대가 바뀌었으면 refresh 를 시작하지 않는다(이전 세대의 늦은 401 이 새 세션의 refresh 쿠키를 회전시키지 않게)
 *   복구는 그 세대에 묶여(recover(epoch)) 다른 세대의 진행 중 복구와 합치지 않는다
 *   세대가 바뀌면 응답을 버리고 AuthSessionChangedError
 */
export async function fetchWithSessionRecovery(
  send: () => Promise<Response>,
  recover: (expectedEpoch: number) => Promise<RecoveryOutcome> = recoverSession,
): Promise<Response> {
  const epoch = getAuthEpoch();
  let res = await send();
  for (let retry = 0; res.status === 401 && retry < AUTH_ORIGINAL_REQUEST_MAX_RETRIES; retry += 1) {
    if (getAuthEpoch() !== epoch) throw new AuthSessionChangedError();
    const outcome = await recover(epoch);
    // 계정 전환·세션 종료·로그아웃은 세대를 올린다(account-changed·session-ended·restore-suppressed·stale)
    if (getAuthEpoch() !== epoch || outcome.kind === 'stale') throw new AuthSessionChangedError();
    if (outcome.kind !== 'same-account') break;
    res = await send();
  }
  if (getAuthEpoch() !== epoch) throw new AuthSessionChangedError();
  return res;
}
