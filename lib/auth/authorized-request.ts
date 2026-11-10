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
 * 같은 계정으로 확인됐을 때만 원 요청을 다시 보낸다(최대 AUTH_ORIGINAL_REQUEST_MAX_RETRIES 회).
 * 다른 계정·세션 종료·일시 오류면 다시 보내지 않는다. send 는 부를 때마다 최신 access 로 헤더를 만든다.
 */
export async function fetchWithSessionRecovery(
  send: () => Promise<Response>,
  recover: () => Promise<RecoveryOutcome> = recoverSession,
): Promise<Response> {
  const epoch = getAuthEpoch();
  let res = await send();
  for (let retry = 0; res.status === 401 && retry < AUTH_ORIGINAL_REQUEST_MAX_RETRIES; retry += 1) {
    const outcome = await recover();
    if (outcome.kind !== 'same-account' || getAuthEpoch() !== epoch) break;
    res = await send();
  }
  if (getAuthEpoch() !== epoch) throw new AuthSessionChangedError();
  return res;
}
