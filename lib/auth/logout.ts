import { postAuthLogout } from '../api/auth.ts';
import { AUTH_LOGOUT_INVALID_TOKEN_MAX_RETRIES } from './constants.ts';
import { clearLogoutPending, markLogoutPending } from './logout-pending.ts';
import { endSessionLocally, getAuthChannel } from './runtime.ts';
import { getAccessToken, setAuthNotice } from './session-store.ts';
import type { AuthApiResult, AuthErrorInfo } from './types.ts';

/**
 * 로그아웃 전용 처리. 일반 API 의 401 → refresh → 재시도 경로를 쓰지 않는다(logout 401 → refresh → logout … 재귀 방지).
 * 서버 결과와 상관없이 화면은 로그아웃하고 모든 탭을 G1 로 보낸다. 서버 폐기를 확인하지 못하면 「로그아웃 대기」를 남긴다.
 *
 *   204                                   → 완료
 *   401 invalid_token                     → Authorization 없이 정확히 1회 다시 보냄
 *   401(사유 없음) = 끝낼 세션 없음 후보  → 완료로 본다
 *   401 origin_not_allowed · 422 · 503 · 네트워크 → 화면 로그아웃 + 서버 로그아웃 미완료(logout pending). 자동 반복 없음
 *
 * TODO(AUTH-CONTRACT): BE to decide no-session logout = 204 vs 401 — 둘 다 「완료」로 처리하도록 두었다
 * TODO(AUTH-CONTRACT): confirm cookie-only logout contract with BE — invalid_token 뒤 재시도와 대기 재시도는 쿠키만으로 보낸다
 */
export type LogoutResult = { kind: 'done' } | { kind: 'pending'; error: AuthErrorInfo };

export interface LogoutDeps {
  logout: (options: { accessToken?: string | null }) => Promise<AuthApiResult<true>>;
}

const defaultDeps: LogoutDeps = { logout: postAuthLogout };

function isNoSession(error: AuthErrorInfo): boolean {
  return error.status === 401 && error.reason !== 'invalid_token' && error.reason !== 'origin_not_allowed';
}

/** 서버에 로그아웃을 보낸다(화면 상태는 바꾸지 않는다) */
export async function requestServerLogout(accessToken: string | null, deps: LogoutDeps = defaultDeps): Promise<LogoutResult> {
  let result = await deps.logout({ accessToken });
  for (let retry = 0; !result.ok && result.error.status === 401 && result.error.reason === 'invalid_token' && retry < AUTH_LOGOUT_INVALID_TOKEN_MAX_RETRIES; retry += 1) {
    result = await deps.logout({});
  }
  if (result.ok || isNoSession(result.error)) return { kind: 'done' };
  return { kind: 'pending', error: result.error };
}

let inflight: Promise<LogoutResult> | null = null;

/** 사용자가 로그아웃을 눌렀을 때. 두 번 눌러도 요청은 하나다 */
export function logout(deps: LogoutDeps = defaultDeps): Promise<LogoutResult> {
  if (inflight) return inflight;
  inflight = (async () => {
    const result = await requestServerLogout(getAccessToken(), deps);
    if (result.kind === 'done') clearLogoutPending();
    else markLogoutPending();
    endSessionLocally();
    getAuthChannel().post({ type: 'logout' });
    if (result.kind === 'pending') setAuthNotice('logout-pending');
    return result;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * 「서버 로그아웃 미완료」를 다시 보낸다(사용자의 [다시 시도] 또는 앱 진입 — 진입 자동 실행은 capability 로 막혀 있다).
 * 화면은 이미 로그아웃 상태라 access 없이 쿠키로만 보낸다.
 */
export async function retryPendingLogout(deps: LogoutDeps = defaultDeps): Promise<LogoutResult> {
  const result = await requestServerLogout(null, deps);
  if (result.kind === 'done') clearLogoutPending();
  return result;
}
